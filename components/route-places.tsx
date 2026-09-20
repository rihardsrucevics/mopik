"use client";


import type { ReactNode } from "react";
import { ChevronDown, ChevronUp, LocateFixed, MapPin, MapPinPlus, Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/place-input";
import { track } from "@/lib/analytics";
import { MIN_ROWS } from "@/lib/chat/compose-plan";
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
 * How many rows the form will carry.
 *
 * The plan's schema takes six via places; the form has always counted whole
 * rows against the same six, and the map's "+ Pietura" must hit exactly the
 * wall the form's "Pievienot pieturvietu" button hits — one enabled where the
 * other was greyed out would be two different answers to one question.
 */
export const MAX_ROWS = 6;

/**
 * Which row the map answers when it opens with none chosen.
 *
 * The planning map always has exactly one active row — a tap means "this point
 * → that row" and nothing else — so opening the map has to pick one, and the
 * choice has to be the one the rider would have made himself.
 *
 * **The first empty row, start first.** A rider who opens the map on a blank
 * form is going to point at where he is setting off from; a rider who has
 * already named a start and opens it again is answering the next unanswered
 * question. Falling through to row 0 when every row is full is deliberate: the
 * start is the row most often corrected, and "the map is answering something"
 * is never allowed to be false.
 *
 * Takes the row *text* rather than the picks, because a name typed without
 * being pinned is still an answer to that row — the API geocodes it — and
 * treating it as empty would send the rider back to a question he has already
 * answered.
 */
export function defaultActiveRow(places: string[]): number {
  const empty = places.findIndex((p) => !p.trim());
  return empty === -1 ? 0 : empty;
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
export function RoutePlaces({ places, picked, oneWay, busy, onChange, onPick, onUseLocation, locating, near, onPickOnMap, activeRow, pickSlot, preview }: {
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
   * Apstiprināt / Atcelt for the active row, rendered directly under it.
   *
   * It goes *here*, inside the list, rather than under the whole form: the two
   * ways out of a pick belong against the row they would answer. The map is no
   * longer in this slot — it stays where it is mounted for as long as the
   * rider is planning, because there is no idle mode for it to return to and
   * moving it would remount MapLibre on every pin press.
   *
   * Absent when there is nothing to confirm or cancel: a confirmed row stays
   * active so the next tap moves its place, and until that tap these buttons
   * would do nothing.
   */
  pickSlot?: ReactNode;
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
    onChange(next);
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
      className={`flex size-8 shrink-0 items-center justify-center rounded-lg transition disabled:opacity-40 ${activeRow === i ? "bg-[#f56300] text-white" : "text-[#bd4b00] hover:bg-stone-100"}`}
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
    // Only `onChange`. It re-keys the picked coordinates against the new list
    // (see `reorder` in the composer), so following it with `onPick(i, null)`
    // wrote a null at an index that now belongs to a different row — the
    // coordinates of an untouched place were dropped, and the rows and the
    // picks disagreed about how many places the ride had.
    if (places.length <= MIN_ROWS) {
      onChange(places.map((p, j) => (j === i ? "" : p)));
      return;
    }
    onChange(places.filter((_, j) => j !== i));
  };

  return (
    <div className="grid gap-2">
      {places.map((place, i) => (
        // The row being picked is ringed. On the desktop the map is in the
        // other column and there is no slot under the field, so this ring is
        // the only thing saying which of three identical fields the map is
        // currently answering.
        <div key={i} className={activeRow === i ? "rounded-xl ring-2 ring-[#f56300]/40" : undefined}>
          <PlaceInput
            // While this row is being picked the field reads the marker's own
            // place. It is a preview and nothing more: the ride still holds
            // whatever was there before until Apstiprināt is pressed.
            value={activeRow === i && preview ? preview.name : place}
            onChange={(v) => onChange(places.map((p, j) => (j === i ? v : p)))}
            onPick={(p) => { if (p) track("place_picked", { row: i, start: i === 0 }); onPick(i, p); }}
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
              {place.trim() ? (
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
                      onClick={() => move(i, i - 1, "tap")}
                      aria-label={`${t(locale, "moveUp")}: ${place || "—"}`}
                      className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-20"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i >= places.length - 1}
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
                {(place.trim() || places.length > MIN_ROWS) && (
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
          {/* Apstiprināt / Atcelt, under the row they answer. */}
          {activeRow === i && pickSlot}
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
      <button type="button" onClick={() => onChange(addStop(places, oneWay))} disabled={busy || places.length >= MAX_ROWS}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#bd4b00] disabled:opacity-40">
        <Plus className="size-3.5" />{oneWay ? t(locale, "addStop") : t(locale, "addPlace")}
      </button>
    </div>
  );
}
