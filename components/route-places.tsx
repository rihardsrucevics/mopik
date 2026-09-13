"use client";


import { ChevronDown, ChevronUp, LocateFixed, MapPin, Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/place-input";
import { track } from "@/lib/analytics";
import { MIN_ROWS } from "@/lib/chat/compose-plan";
import type { ResolvedPlace } from "@/lib/chat/places";

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
export function RoutePlaces({ places, oneWay, busy, onChange, onPick, onUseLocation, locating }: {
  places: string[];
  oneWay: boolean;
  busy?: boolean;
  /** Fill the start from the device's location. Absent = no button. */
  onUseLocation?: () => void;
  locating?: boolean;
  onChange: (places: string[]) => void;
  /** Called with the new index order so picked coordinates travel with the row. */
  onPick: (index: number, place: ResolvedPlace | null) => void;
}) {


  const addStop = (list: string[], toDestination: boolean) => {
    if (!toDestination || list.length < 2) return [...list, ""];
    // Before the finish, keeping it last.
    return [...list.slice(0, -1), "", list[list.length - 1]];
  };

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
  const label = (i: number) => {
    if (i === 0) return "No";
    if (oneWay && i === places.length - 1) return "Līdz";
    return `Caur (${i})`;
  };

  // No placeholder may look like a value. "Rīga" in the empty start field read
  // as a filled-in answer — the rider hit generate, was told a place was
  // missing, and could not see which one, because a grey "Rīga" and a black
  // "Baldone" are the same shape on a phone in daylight. The start says what
  // to type; the optional rows say that they are optional.
  const placeholder = (i: number) => (i === 0 ? "Pilsēta, adrese vai vieta" : "Nav obligāts — man vienalga");

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
        <div key={i}>
          <PlaceInput
            value={place}
            onChange={(v) => onChange(places.map((p, j) => (j === i ? v : p)))}
            onPick={(p) => { if (p) track("place_picked", { row: i, start: i === 0 }); onPick(i, p); }}
            icon={<MapPin className="size-3" />}
            label={label(i)}
            placeholder={placeholder(i)}
            trailing={i === 0 ? (
              // The start is the one field a rider fills in every time, and it
              // is almost always where they are standing. Offered, never
              // assumed: the browser only asks for the location on the tap.
              onUseLocation && !place.trim() ? (
                // The crosshair alone: every map app uses it, so the label was
                // spending a third of the field's width saying what the icon
                // already says. The name still reaches a screen reader.
                <button type="button" disabled={busy || locating} onClick={onUseLocation}
                  aria-label="Aizpildīt ar manu atrašanās vietu"
                  title="Mana atrašanās vieta"
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg text-[#bd4b00] transition hover:bg-stone-100 disabled:opacity-40">
                  <LocateFixed className={`size-4 ${locating ? "animate-pulse" : ""}`} />
                </button>
              ) : null
            ) : (
              // Inside the field, and only when there is something to do:
              // an empty optional row shows nothing at all, so the field runs
              // the full width instead of leaving a column of blank space
              // beside it. Clearing appears with the text; reordering appears
              // once there is more than one row that can move.
              <span className="flex shrink-0 items-center">
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
                      aria-label={`Pārvietot ${place || "vietu"} augstāk`}
                      className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-20"
                    >
                      <ChevronUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      disabled={busy || i >= places.length - 1}
                      onClick={() => move(i, i + 1, "tap")}
                      aria-label={`Pārvietot ${place || "vietu"} zemāk`}
                      className="flex size-8 items-center justify-center rounded-lg text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-20"
                    >
                      <ChevronDown className="size-4" />
                    </button>
                  </>
                )}
                {place.trim() && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => remove(i)}
                    aria-label={`Noņemt ${place}`}
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

      {/* A round trip ends where it began; saying so beats an empty field the
          rider has to interpret. */}
      {!oneWay && places.length > 0 && (
        <p className="flex items-center gap-1.5 pl-3 text-[11px] text-stone-500">
          <span className="text-stone-400">↩</span>
          Atpakaļ uz {places[0]?.trim() || "sākumu"}
        </p>
      )}

      {/* A stop goes between the start and the finish. Appending it made the
          new empty row the last one — which on a one-way ride *is* the
          destination, so adding a stop silently threw the finish away. On a
          round trip the last row is already a waypoint, so the end is right. */}
      <button type="button" onClick={() => onChange(addStop(places, oneWay))} disabled={busy || places.length >= 6}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#bd4b00] disabled:opacity-40">
        <Plus className="size-3.5" />{oneWay ? "Pievienot pieturvietu" : "Pievienot vietu"}
      </button>
    </div>
  );
}
