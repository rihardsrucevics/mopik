"use client";

import { ArrowDown, ArrowUp, MapPin, Plus, X } from "lucide-react";
import { PlaceInput } from "@/components/place-input";
import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * The ride as an ordered list of places.
 *
 * One list, not start + destination + stops: on a round trip the old "Uz"
 * field was silently appended to the stops, so two fields did the same job
 * and nothing could be reordered. Here every row is the same kind of thing
 * and the labels come from position and trip type — on a round trip the last
 * row is a waypoint and the ride returns home; one way, it is the finish.
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
  const move = (from: number, to: number) => {
    if (to < 1 || to >= places.length) return;
    const next = [...places];
    const [row] = next.splice(from, 1);
    next.splice(to, 0, row);
    onChange(next);
  };

  const label = (i: number) => {
    if (i === 0) return "Sākums";
    if (oneWay && i === places.length - 1) return "Galamērķis";
    return `Caur (${i})`;
  };

  const placeholder = (i: number) =>
    i === 0 ? "Rīga" : oneWay && i === places.length - 1 ? "Ainaži" : "Pilsēta, adrese vai vieta";

  return (
    <div className="grid gap-2">
      {places.map((place, i) => (
        <div key={i} className="flex items-start gap-1.5">
          <PlaceInput
            className="min-w-0 flex-1"
            value={place}
            onChange={(v) => onChange(places.map((p, j) => (j === i ? v : p)))}
            onPick={(p) => onPick(i, p)}
            icon={<MapPin className="size-3" />}
            label={label(i)}
            placeholder={placeholder(i)}
          />
          {/* The start stays put; everything after it can be reordered or removed. */}
          {i > 0 && (
            <div className="mt-4 flex shrink-0 items-center gap-0.5">
              <button type="button" disabled={busy || i <= 1} onClick={() => move(i, i - 1)} aria-label={`Pārvietot ${place || "vietu"} augstāk`}
                className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 disabled:hover:bg-transparent">
                <ArrowUp className="size-3.5" />
              </button>
              <button type="button" disabled={busy || i >= places.length - 1} onClick={() => move(i, i + 1)} aria-label={`Pārvietot ${place || "vietu"} zemāk`}
                className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700 disabled:opacity-25 disabled:hover:bg-transparent">
                <ArrowDown className="size-3.5" />
              </button>
              <button type="button" disabled={busy} onClick={() => { onChange(places.filter((_, j) => j !== i)); onPick(i, null); }} aria-label={`Noņemt ${place || "vietu"}`}
                className="rounded-md p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700">
                <X className="size-3.5" />
              </button>
            </div>
          )}
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
