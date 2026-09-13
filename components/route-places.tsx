"use client";

import { useRef, useState } from "react";
import { GripVertical, MapPin, Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/place-input";
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
export function RoutePlaces({ places, picked, oneWay, busy, onChange, onPick }: {
  places: string[];
  picked: Record<number, ResolvedPlace | null>;
  oneWay: boolean;
  busy?: boolean;
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

  const move = (from: number, to: number) => {
    if (from === to || to < 1 || to >= places.length) return;
    const next = [...places];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };

  const rowAt = (clientY: number) => {
    for (let i = 1; i < places.length; i += 1) {
      const rect = rowRefs.current[i]?.getBoundingClientRect();
      if (rect && clientY >= rect.top && clientY <= rect.bottom) return i;
    }
    return null;
  };

  const endDrag = (target: number | null) => {
    if (dragging !== null && target !== null) move(dragging, target);
    setDragging(null);
    setOver(null);
  };

  // "No" and "Līdz" name the two rows the form always offers; anything added
  // between them is a waypoint and is numbered.
  const label = (i: number) => {
    if (i === 0) return "No";
    if (oneWay && i === places.length - 1) return "Līdz";
    return `Caur (${i})`;
  };

  // Nothing after the start is compulsory. "Man vienalga" says so in the
  // field itself, so a rider who only knows where he is leaving from can hit
  // generate without first working out whether the row may be left empty.
  const placeholder = (i: number) => (i === 0 ? "Rīga" : "Man vienalga");

  // Two rows is the floor: clearing one of them empties the field instead of
  // deleting the row, so the form never falls back to a single field the rider
  // has to expand again.
  const remove = (i: number) => {
    if (places.length <= MIN_ROWS) {
      onChange(places.map((p, j) => (j === i ? "" : p)));
      onPick(i, null);
      return;
    }
    onChange(places.filter((_, j) => j !== i));
    onPick(i, null);
  };

  return (
    <div className="grid gap-2">
      {places.map((place, i) => (
        <div
          key={i}
          ref={(el) => { rowRefs.current[i] = el; }}
          onDragOver={(e) => { if (dragging !== null && i > 0) { e.preventDefault(); setOver(i); } }}
          onDrop={(e) => { e.preventDefault(); endDrag(i); }}
          className={`rounded-xl transition ${dragging === i ? "opacity-40" : ""} ${over === i && dragging !== i ? "ring-2 ring-[#f56300]/40" : ""}`}
        >
          <PlaceInput
            value={place}
            onChange={(v) => onChange(places.map((p, j) => (j === i ? v : p)))}
            onPick={(p) => onPick(i, p)}
            icon={<MapPin className="size-3" />}
            label={label(i)}
            placeholder={placeholder(i)}
            trailing={i === 0 ? null : (
              // Inside the field, and only when there is something to do:
              // an empty optional row shows nothing at all, so the field runs
              // the full width instead of leaving a column of blank space
              // beside it. Clearing appears with the text; reordering appears
              // once there is more than one row that can move.
              <span className="flex shrink-0 items-center">
                {places.length > 2 && (
                  <button
                    type="button"
                    disabled={busy}
                    draggable={!busy}
                    onDragStart={() => setDragging(i)}
                    onDragEnd={() => endDrag(over)}
                    onPointerDown={(e) => {
                      if (busy || e.pointerType === "mouse") return;
                      // Touch: follow the finger by hit-testing the rows.
                      setDragging(i);
                      const target = e.currentTarget;
                      target.setPointerCapture(e.pointerId);
                      const onMove = (ev: PointerEvent) => setOver(rowAt(ev.clientY));
                      const onUp = (ev: PointerEvent) => {
                        target.releasePointerCapture(ev.pointerId);
                        target.removeEventListener("pointermove", onMove);
                        target.removeEventListener("pointerup", onUp);
                        endDrag(rowAt(ev.clientY));
                      };
                      target.addEventListener("pointermove", onMove);
                      target.addEventListener("pointerup", onUp);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") { e.preventDefault(); move(i, i - 1); }
                      if (e.key === "ArrowDown") { e.preventDefault(); move(i, i + 1); }
                    }}
                    aria-label={`Pārkārtot ${place || "vietu"} — velc vai lieto bultiņas`}
                    className="flex size-8 touch-none cursor-grab items-center justify-center rounded-lg text-stone-300 transition hover:bg-stone-100 hover:text-stone-600 active:cursor-grabbing disabled:opacity-30"
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

      <button type="button" onClick={() => onChange([...places, ""])} disabled={busy || places.length >= 6}
        className="inline-flex items-center gap-1 self-start text-xs font-medium text-[#bd4b00] disabled:opacity-40">
        <Plus className="size-3.5" />{oneWay ? "Pievienot pieturvietu" : "Pievienot vietu"}
      </button>
    </div>
  );
}
