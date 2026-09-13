"use client";

import { useEffect, useRef, useState } from "react";
import { GripVertical, LocateFixed, MapPin, Plus, X } from "lucide-react";
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
  // The row being dragged and the row it is currently over, so the list can
  // show where it would land.
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  // Touch drags do not fire dragover; the pointer position is matched against
  // the row rectangles instead.
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The live drag, kept in a ref because the native listeners below are
  // registered once and would otherwise close over a stale render.
  const drag = useRef<{ from: number; moved: boolean } | null>(null);


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

  // The row the finger is over — or, between rows and past the ends, the
  // nearest one. A strict hit test dropped the gesture whenever the finger sat
  // in a gap, which on a phone is most of the time.
  const rowAt = (clientY: number) => {
    let best: number | null = null;
    let bestDistance = Infinity;
    for (let i = 1; i < places.length; i += 1) {
      const rect = rowRefs.current[i]?.getBoundingClientRect();
      if (!rect) continue;
      const distance = Math.abs(clientY - (rect.top + rect.height / 2));
      if (distance < bestDistance) { bestDistance = distance; best = i; }
    }
    return best;
  };

  // `endDrag` is called from listeners created at pointerdown, whose closure
  // still sees `dragging === null` — the state set in that same tick has not
  // been applied yet. So the source row is passed in rather than read back.
  const endDrag = (from: number | null, target: number | null) => {
    if (from !== null && target !== null) move(from, target);
    setDragging(null);
    setOver(null);
  };

  // Native, non-passive touch listeners. React attaches its touch handlers
  // passively, so `preventDefault` in `onTouchMove` is ignored and iOS scrolls
  // the page instead of letting the row follow the finger. Registered per
  // handle, re-registered whenever the rows change.
  useEffect(() => {
    const handles = handleRefs.current.slice(0, places.length);
    const cleanups: (() => void)[] = [];
    handles.forEach((el, i) => {
      if (!el || i === 0) return;
      const onStart = (e: TouchEvent) => {
        if (busy) return;
        drag.current = { from: i, moved: false };
        setDragging(i);
        e.stopPropagation();
      };
      const onMove = (e: TouchEvent) => {
        if (!drag.current) return;
        // Non-passive, so this actually stops the page scrolling.
        e.preventDefault();
        drag.current.moved = true;
        setOver(rowAt(e.touches[0].clientY));
      };
      const onEnd = (e: TouchEvent) => {
        const d = drag.current;
        drag.current = null;
        if (!d) return;
        // A tap (no movement) is handled by onClick; only a real drag lands here.
        if (d.moved) {
          e.preventDefault();
          endDrag(d.from, rowAt(e.changedTouches[0].clientY));
        } else {
          setDragging(null);
          setOver(null);
        }
      };
      el.addEventListener("touchstart", onStart, { passive: false });
      el.addEventListener("touchmove", onMove, { passive: false });
      el.addEventListener("touchend", onEnd, { passive: false });
      el.addEventListener("touchcancel", onEnd, { passive: false });
      cleanups.push(() => {
        el.removeEventListener("touchstart", onStart);
        el.removeEventListener("touchmove", onMove);
        el.removeEventListener("touchend", onEnd);
        el.removeEventListener("touchcancel", onEnd);
      });
    });
    return () => cleanups.forEach((fn) => fn());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, busy]);

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
        <div
          key={i}
          ref={(el) => { rowRefs.current[i] = el; }}
          onDragOver={(e) => { if (dragging !== null && i > 0) { e.preventDefault(); setOver(i); } }}
          onDrop={(e) => { e.preventDefault(); endDrag(dragging, i); }}
          className={`rounded-xl transition ${dragging === i ? "opacity-40" : ""} ${over === i && dragging !== i ? "ring-2 ring-[#f56300]/40" : ""}`}
        >
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
                {places.length > 2 && (
                  <button
                    ref={(el) => { handleRefs.current[i] = el; }}
                    type="button"
                    disabled={busy}
                    draggable={!busy}
                    onDragStart={(e) => { e.stopPropagation(); setDragging(i); }}
                    onDragEnd={() => endDrag(i, over)}
                    onMouseDown={(e) => e.preventDefault()}
                    // A tap moves the row up one place. Dragging a 32 px handle
                    // inside a scrolling form is fragile on iOS — Safari claims
                    // the gesture for scrolling often enough that the rider is
                    // left with a control that does nothing. A tap always
                    // works, and repeating it walks the row to the top; the
                    // drag stays for pointers that give us the gesture.
                    onClick={() => { if (!busy) move(i, i - 1, "tap"); }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1, "keyboard"); }
                      if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1, "keyboard"); }
                    }}
                    aria-label={`Pārvietot ${place || "vietu"} augstāk — vai velc, lai pārkārtotu`}
                    title="Pārvietot augstāk — vai velc"
                    className="flex size-8 touch-none items-center justify-center rounded-lg text-stone-300 transition hover:bg-stone-100 hover:text-stone-600 disabled:opacity-30"
                  >
                    <GripVertical className="size-4" />
                  </button>
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
