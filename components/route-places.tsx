"use client";

import { ChevronDown, ChevronUp, LocateFixed, MapPin, MapPinPlus, Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/place-input";
import { track } from "@/lib/analytics";
import { MIN_ROWS } from "@/lib/chat/compose-plan";
import { MAX_STOPS, maxRows } from "@/lib/chat/ride-limits";
import { fi } from "@/lib/i18n/format";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";
import type { ResolvedPlace } from "@/lib/chat/places";
import type { UiLocale } from "@/lib/i18n/locale";

/**
 * What a row is called, from its position and the trip type.
 *
 * Exported because the map's hint says the row's own name back to the rider —
 * „Atzīmē kartē → „Līdz”” — and a second copy of this rule in the composer
 * would be the thing that drifts when the labels change.
 */
export function rowLabel(locale: UiLocale, i: number, oneWay: boolean, rows: number): string {
  if (i === 0) return t(locale, "from");
  if (oneWay && i === rows - 1) return t(locale, "to");
  return `${t(locale, "via")} (${i})`;
}

// A new stop goes *before* the places already named, on both trip types.
//
// One way: appending made the new empty row the last one — which is the
// finish — so adding a stop silently threw the destination away.
//
// Round trip: appending put the stop after the last place the rider had
// named, which reads as "Rīga → Baldone → here". The rider asked for the
// opposite (Rīga, [stop], Baldone, ↩ Rīga): a stop added to a planned ride
// is far more often something to fit in on the way out than a new furthest
// point. Either way it can be moved afterwards, and the return row makes
// the last leg reachable.
//
// Exported, and out here rather than inside the component, because the map's
// own "+ Pietura" adds a stop too: the composer inserts the row and then makes
// it the active one. One rule, in one place — a second copy of "where does a
// stop go" is the thing that drifts, and the two ways in would then disagree
// about what the rider gets.
export function addStop(list: string[], toDestination: boolean): string[] {
  if (list.length < 2) return [...list, ""];
  // Keep the start first and, one way, the finish last.
  return toDestination
    ? [...list.slice(0, -1), "", list[list.length - 1]]
    : [list[0], "", ...list.slice(1)];
}

/**
 * How many rows the form will carry: `maxRows` in `lib/chat/ride-limits.ts`,
 * counted as stops so a one-way ride and a round trip both stop at the same
 * number of stops the plan's schema takes. The map's „+” must hit exactly the
 * wall the form's „Pievienot pieturvietu” button hits — one enabled where the
 * other was greyed out would be two different answers to one question.
 */
export { maxRows };

/**
 * Whether a row's pin button is drawn on the desktop (≥ 768 px).
 *
 * Off since 2026-09-25, the rider's call: on the desktop the map is always
 * beside the form, and focusing a field — a click, or Tab from the keyboard —
 * already makes its row the active one, flies the map to its pin and rings
 * the row, so the button was a second control for the same thing. On a phone
 * it stays: there it activates a row without opening the keyboard, and opens
 * the map. He may want it back — set this to true; nothing else changes.
 */
export const ROW_PIN_BUTTON_ON_DESKTOP = false;

/**
 * Which row the map answers when it opens with none chosen.
 *
 * **The first empty row, start first** — a rider who opens the map on a blank
 * form is going to point at where he is setting off from; one who has named a
 * start is answering the next unanswered question.
 *
 * **None when every row is filled.** This used to fall back to the start, so
 * "the map is answering something" was never false — and every mark after the
 * last Confirm quietly moved a place the rider had finished with. His report
 * (2026-09-25): start and finish confirmed, "+ Pievienot pieturvietu", a mark
 * on the map — and the finish moved, because it was still the active row. A
 * filled row is edited again only when he asks for it: its pin button, its
 * field, or dragging its pin. Until then a mark does nothing and the header
 * says what to do.
 *
 * Takes the row *text* rather than the picks, because a name typed without
 * being pinned is still an answer to that row — the API geocodes it.
 */
export function defaultActiveRow(places: string[]): number | null {
  const empty = places.findIndex((p) => !p.trim());
  return empty === -1 ? null : empty;
}

/**
 * The active row once a place has been confirmed in `row`: the first empty
 * row — the finish after the start — or none at all (rider, 2026-09-25).
 *
 * A confirmed stop used to open the next stop row by itself, so stop after
 * stop was mark, Confirm, mark, Confirm. Batch adding replaced that: with an
 * empty stop row active every mark adds another pending stop and one Confirm
 * takes them all (see the composer's `batch`), so the row a Confirm made was
 * a blank the rider then had to get rid of. `rows` must already hold the
 * confirmed place; `inserted` is kept in the answer for its callers and is
 * always null now.
 */
export function rowAfterConfirm(rows: string[], row: number, oneWay: boolean): { rows: string[]; active: number | null; inserted: number | null } {
  void row; void oneWay;
  return { rows, active: defaultActiveRow(rows), inserted: null };
}

/**
 * Where a stop added from the map lands in the list.
 *
 * `addStop` puts the blank row in position; this says which index that is, so
 * the composer can hand *that* row to the map. Derived from the same rule
 * rather than guessed: one way the new row is the one before the finish,
 * round trip it is the second row (the ride's first stop).
 */
export function addedStopIndex(list: string[], toDestination: boolean): number {
  if (list.length < 2) return list.length;
  return toDestination ? list.length - 1 : 1;
}

/**
 * What a structural change did to the rows: a row moved, one was removed or
 * inserted, or one was emptied in place (the two base rows are never removed).
 */
export type RowChange =
  | { kind: "move"; from: number; to: number }
  | { kind: "remove"; at: number }
  | { kind: "insert"; at: number }
  | { kind: "clear"; at: number };

/**
 * Where a row index points after a structural change — the same remapping
 * `reorder` does for the picked coordinates, for the one row the map answers.
 *
 * The active row is an index, and the rows are a list the arrows reorder.
 * Left alone, the index stayed where it was while the place moved away from
 * it: the rider activated a stop, pressed ↓, and the ring and the map's hint
 * moved on to whichever row slid into the old slot — a different place,
 * answering the next mark. The active row is a *place*, so it follows it.
 *
 * Null when the change removed the row itself; the composer then falls back
 * to the default rule, exactly as it does when a "+ Pietura" row is cancelled.
 */
export function followRow(index: number, change: RowChange): number | null {
  switch (change.kind) {
    case "move": {
      const { from, to } = change;
      if (index === from) return to;
      if (from < index && to >= index) return index - 1;
      if (from > index && to <= index) return index + 1;
      return index;
    }
    case "remove":
      if (change.at === index) return null;
      return change.at < index ? index - 1 : index;
    case "insert":
      return change.at <= index ? index + 1 : index;
    case "clear":
      return index;
  }
}

/**
 * The ride as an ordered list of places.
 *
 * One list, not start + destination + stops: on a round trip the old "Uz"
 * field was silently appended to the stops, so two fields did the same job
 * and nothing could be reordered. Here every row is the same kind of thing
 * and the labels come from position and trip type — on a round trip the last
 * row is a waypoint and the ride returns home; one way, it is the finish.
 *
 * Reordering is a drag handle rather than up/down arrows. Three 22 px targets
 * per row (↑ ↓ ✕) took more width than the field they belonged to and none of
 * them was comfortably tappable; one handle plus one remove leaves the place
 * name the room it needs. Keyboard users keep the same moves: the handle is a
 * button and ArrowUp/ArrowDown on it move the row.
 */
export function RoutePlaces({ places, picked, oneWay, busy, onChange, onPick, onUseLocation, locating, near, onPickOnMap, activeRow, preview, onStructure, fixedEnds = false, onAddStop, onFocusRow }: {
  places: string[];
  /**
   * The first place already pinned in this ride. Every other row searches
   * around it, so a start in Latvia does not offer a Sigulda in Bavaria.
   */
  near?: { lat: number; lon: number } | null;
  oneWay: boolean;
  busy?: boolean;
  /** Fill the start from the device's location. Absent = no button. */
  onUseLocation?: () => void;
  locating?: boolean;
  /**
   * Fill this row by tapping the map. Absent = no button.
   *
   * A button, never a long-press or a drag on the field: three gesture
   * attempts have already failed on the rider's own iPhone (see the reordering
   * note above), and Safari claims whatever gesture is left over. A tap is a
   * tap everywhere.
   */
  onPickOnMap?: (index: number) => void;
  /**
   * The one row the map is answering, so its pin reads as pressed and the row
   * is ringed. Null while no planning map is on screen.
   *
   * It is ringed even when there is nothing to Confirm yet, because that is
   * the invariant the rider was promised: while the map is open one row is
   * always the one a tap will fill, and the ring plus the map's own hint are
   * the two places that say which.
   */
  activeRow?: number | null;
  /**
   * The place under the marker, not yet committed to the row.
   *
   * Shown in the active row's field so the rider reads the name he is about to
   * accept — but it is deliberately not in `places` and not in `picked`, so a
   * ride generated without pressing Apstiprināt carries nothing from a pick
   * that was never finished.
   */
  preview?: ResolvedPlace | null;
  onChange: (places: string[]) => void;
  /** Called with the new index order so picked coordinates travel with the row. */
  onPick: (index: number, place: ResolvedPlace | null) => void;
  /**
   * The place confirmed for each row, if any. A typed word and a place picked
   * from the list looked identical — same black text, no way to tell whether
   * the ride knows where "Cēsis" is. The confirmed ones now carry their
   * region under the name.
   */
  picked: Record<number, ResolvedPlace | null>;
  /**
   * A row removed or moved, as opposed to a row typed into.
   *
   * Both reach `onChange` when this is absent, which is right for a form
   * being composed: nothing happens until Generate. Editing a generated ride
   * is different — a stop taken out or moved is a change to the ride itself,
   * re-routed at once — and typing a letter is not. So the edit passes this
   * and hears about exactly the changes it has to act on.
   */
  onStructure?: (next: string[], change: RowChange) => void;
  /**
   * The start and the finish cannot be removed, only moved.
   *
   * On a generated ride being edited, ✕ on the start would leave a ride with
   * nowhere to begin, and on the finish one with nowhere to end — two
   * controls with no ride behind them. A place there is changed by marking a
   * new one, which the pin button does.
   */
  fixedEnds?: boolean;
  /**
   * What the form's own "+ Pievienot pieturvietu" does. Absent: add a blank
   * row, as composing always has. The edit passes the map's "+ Pietura", so
   * both buttons make a row and hand it to the map — a blank row nobody is
   * answering would be a stop the ride cannot have.
   */
  onAddStop?: () => void;
  /** A row's field took focus — while the map is open, that row becomes active. */
  onFocusRow?: (index: number) => void;
}) {


  const [locale] = useLocale();

  const move = (from: number, to: number, how: "drag" | "tap" | "keyboard" = "drag") => {
    if (from === to || to < 1 || to >= places.length) return;
    // Which path riders actually manage to use. The touch drag has been
    // rewritten twice; this says whether it works on real phones or whether
    // the tap is carrying it.
    track("places_reordered", { how });
    const next = [...places];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    if (onStructure) onStructure(next, { kind: "move", from, to });
    else onChange(next);
    // Focus goes with the row, not with the slot. The rows are keyed by
    // position, so the arrow just pressed would otherwise keep focus in the
    // row that slid into the old slot — its field then wears the orange
    // focus border, and two rows look active at once: the rider's report.
    const dir = to > from ? "down" : "up";
    requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`[data-place-row="${to}"]`);
      const same = row?.querySelector<HTMLButtonElement>(`[data-move="${dir}"]:not(:disabled)`);
      const other = row?.querySelector<HTMLButtonElement>(`[data-move]:not(:disabled)`);
      (same ?? other)?.focus();
    });
  };

  // "No" and "Līdz" name the two rows the form always offers; anything added
  // between them is a waypoint and is numbered.
  const label = (i: number) => rowLabel(locale, i, oneWay, places.length);

  /**
   * The pin that hands this row to the map.
   *
   * It is in every row, including the start, because a place with no name is
   * as likely to be a finish or a forest crossroads as a starting point — and
   * it is the same size and shape as the crosshair beside it, so the two ways
   * of saying "here" look like one pair rather than two features.
   *
   * `MapPinPlus`, not the pin-with-a-dot: at 16 px the dot reads as a head in
   * a rounded body and the rider saw a person icon, which is exactly what the
   * crosshair beside it already means. The + says "put one here".
   */
  const pickButton = (i: number) => onPickOnMap && (
    <button
      type="button"
      disabled={busy}
      aria-pressed={activeRow === i}
      onClick={() => onPickOnMap(i)}
      aria-label={`${t(locale, "pickOnMap")}: ${label(i)}`}
      title={t(locale, "pickOnMap")}
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${ROW_PIN_BUTTON_ON_DESKTOP ? "" : "md:hidden"} ${activeRow === i ? "bg-[#f56300] text-white" : "text-[#bd4b00] hover:bg-stone-100"}`}
    >
      <MapPinPlus className="size-4" />
    </button>
  );

  // No placeholder may look like a value. "Rīga" in the empty start field read
  // as a filled-in answer — the rider hit generate, was told a place was
  // missing, and could not see which one, because a grey "Rīga" and a black
  // "Baldone" are the same shape on a phone in daylight. The start says what
  // to type; the optional rows say that they are optional.
  const placeholder = (i: number) => (i === 0 ? t(locale, "startPlaceholder") : t(locale, "optionalPlaceholder"));

  // Two rows is the floor: clearing one of them empties the field instead of
  // deleting the row, so the form never falls back to a single field the rider
  // has to expand again.
  const remove = (i: number) => {
    // Only `onChange` (or `onStructure`, which is the same list reported as a
    // change to the ride). It re-keys the picked coordinates against the new list
    // (see `reorder` in the composer), so following it with `onPick(i, null)`
    // wrote a null at an index that now belongs to a different row — the
    // coordinates of an untouched place were dropped, and the rows and the
    // picks disagreed about how many places the ride had.
    if (places.length <= MIN_ROWS) {
      const next = places.map((p, j) => (j === i ? "" : p));
      if (onStructure) onStructure(next, { kind: "clear", at: i });
      else onChange(next);
      return;
    }
    const next = places.filter((_, j) => j !== i);
    if (onStructure) onStructure(next, { kind: "remove", at: i });
    else onChange(next);
  };

  return (
    <div className="grid gap-2">
      {places.map((place, i) => (
        // The row being picked is ringed. On the desktop the map is in the
        // other column and there is no slot under the field, so this ring is
        // the only thing saying which of three identical fields the map is
        // currently answering.
        <div key={i} data-place-row={i} className={activeRow === i ? "rounded-xl ring-2 ring-[#f56300]/40" : undefined}>
          <PlaceInput
            // While this row is being picked the field reads the marker's own
            // place. It is a preview and nothing more: the ride still holds
            // whatever was there before until Apstiprināt is pressed.
            value={activeRow === i && preview ? preview.name : place}
            onChange={(v) => onChange(places.map((p, j) => (j === i ? v : p)))}
            onPick={(p) => { if (p) track("place_picked", { row: i, start: i === 0 }); onPick(i, p); }}
            onFocus={onFocusRow ? () => onFocusRow(i) : undefined}
            confirmed={activeRow === i && preview ? preview : picked[i] ?? null}
            near={near}
            icon={<MapPin className="size-3" />}
            label={label(i)}
            placeholder={placeholder(i)}
            trailing={i === 0 ? (
              <span className="flex shrink-0 items-center">
              {pickButton(i)}
              {/* The start is the one field a rider fills in every time, and it
                  is almost always where they are standing. Empty, it offers the
                  device's location — offered, never assumed, so the browser only
                  asks on the tap. Filled, it offers to clear: every other row
                  had a ✕ and this one did not, so the one field a rider most
                  often changes was the one he had to select-all and delete. */}
              {fixedEnds ? null : place.trim() ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(i)}
                  aria-label={`${t(locale, "remove")}: ${place}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                >
                  <X className="size-4" />
                </button>
              ) : onUseLocation ? (
                // The crosshair alone: every map app uses it, so the label was
                // spending a third of the field's width saying what the icon
                // already says. The name still reaches a screen reader.
                <button type="button" disabled={busy || locating} onClick={onUseLocation}
                  aria-label={t(locale, "useMyLocation")}
                  title={t(locale, "myLocation")}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#bd4b00] transition hover:bg-stone-100 disabled:opacity-40">
                  <LocateFixed className={`size-4 ${locating ? "animate-pulse" : ""}`} />
                </button>
              ) : null}
              </span>
            ) : (
              // Inside the field, and only when there is something to do:
              // an empty optional row shows nothing at all, so the field runs
              // the full width instead of leaving a column of blank space
              // beside it. Clearing appears with the text; reordering appears
              // once there is more than one row that can move.
              <span className="flex shrink-0 items-center">
                {/* The pin is unconditional where the arrows and the ✕ are
                    not: it is the only control that is useful on an *empty*
                    row, because a row with nothing in it is exactly the one
                    the rider cannot name and wants to point at. */}
                {pickButton(i)}
                {/* Arrows, not a drag handle. Dragging a small target inside
                    a scrolling form never worked on iOS — Safari kept the
                    gesture for scrolling — and three attempts to fix it failed
                    on the rider's own phone. An arrow is a tap: it works
                    everywhere, needs no gesture, and is its own affordance.
                    They appear only when there is something to reorder. */}
                {places.length > 2 && (
                  <>
                    <button
                      type="button"
                      disabled={busy || i <= 1}
                      data-move="up"
                      onClick={() => move(i, i - 1, "tap")}
                      aria-label={`${t(locale, "moveUp")}: ${place || "—"}`}
                      className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-20"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i >= places.length - 1}
                      data-move="down"
                      onClick={() => move(i, i + 1, "tap")}
                      aria-label={`${t(locale, "moveDown")}: ${place || "—"}`}
                      className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-20"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </>
                )}
                {/* Removing shows for a filled row and for any row beyond the
                    two the form always offers — a stop the rider has just
                    added but not yet typed into still has to be removable,
                    and without this it could only be left empty. The two base
                    rows keep the old rule: nothing to clear, nothing to show. */}
                {!(fixedEnds && oneWay && i === places.length - 1) && (place.trim() || places.length > MIN_ROWS) && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(i)}
                    aria-label={place.trim() ? `${t(locale, "remove")}: ${place}` : t(locale, "removeEmpty")}
                    className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </span>
            )}
          />
        </div>
      ))}

      {/* A round trip ends where it began. This is a row, not a footnote,
          because the ride has a leg between the last stop and home and the
          rider has to be able to put a place into it — with only a caption
          there was nothing after the last row to move past. It is deliberately
          not a `PlaceInput`: the return is wherever the start is, so editing
          it would mean two fields claiming the same place. */}
      {!oneWay && places.length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-stone-200 bg-stone-50/60 px-3 py-2">
          <span className="text-xs text-stone-400">↩</span>
          <span className="min-w-0 flex-1 truncate text-sm text-stone-500">
            {t(locale, "backTo")} {places[0]?.trim() || "—"}
          </span>
          {/* No control of its own: the last row already *is* the leg before
              home, so a stop reaches it with the same down-arrow as every
              other move. What was missing was seeing that the leg exists. */}
        </div>
      )}

      {/* A stop goes between the start and the finish. Appending it made the
          new empty row the last one — which on a one-way ride *is* the
          destination, so adding a stop silently threw the finish away. On a
          round trip the last row is already a waypoint, so the end is right. */}
      <button type="button" onClick={() => {
          if (onAddStop) { onAddStop(); return; }
          const next = addStop(places, oneWay);
          if (onStructure) onStructure(next, { kind: "insert", at: addedStopIndex(places, oneWay) });
          else onChange(next);
        }} disabled={busy || places.length >= maxRows(oneWay)}
        // At the cap the button says why it is greyed out, as the map's „+” does.
        title={places.length >= maxRows(oneWay) ? fi(t(locale, "mapAddStopFull"), { n: MAX_STOPS }) : undefined}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#bd4b00] disabled:opacity-40">
        <Plus className="size-3.5" />{oneWay ? t(locale, "addStop") : t(locale, "addPlace")}
      </button>
    </div>
  );
}
