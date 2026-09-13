"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark, Trash2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { listSaved, removeRide, type SavedRide } from "@/lib/share/saved-rides";

const VARIANT_LABELS: Record<string, string> = { direct: "Taisnākā", balanced: "Līkumotākā", complex: "Sarežģītākā" };

function duration(minutes: number): string {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;
}

/**
 * Saved rides, on the form screen only: the rider's own shortlist, opened as
 * a shared route page (same renderer, same GPX button).
 */
export function SavedRides() {
  const [rides, setRides] = useState<SavedRide[]>([]);
  useEffect(() => {
    const sync = () => setRides(listSaved());
    sync();
    window.addEventListener("mopik:saved-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("mopik:saved-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  if (!rides.length) return null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4" aria-label="Saglabātie maršruti">
      <div className="flex items-center gap-2">
        <Bookmark className="size-3.5 text-[#f56300]" />
        <h2 className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">Saglabātie ({rides.length})</h2>
        {rides.length > 1 && (
          <Link href="/saglabatie" onClick={() => track("saved_list_opened", { count: rides.length })}
            className="ml-auto text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-900">Visi</Link>
        )}
      </div>
      <ul className="mt-2 divide-y divide-stone-100">
        {rides.slice(0, 1).map((r) => (
          <li key={r.id} className="flex items-center gap-2 py-2">
            <Link href={`/r/${r.code}`} onClick={() => track("saved_ride_opened", { km: r.km })} className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-stone-900">{r.name}</div>
              <div className="truncate text-[11px] tabular-nums text-stone-500">
                {r.km} km · {duration(r.minutes)} · {r.unpavedPercent} % grants · {VARIANT_LABELS[r.variant] ?? r.variant}
              </div>
            </Link>
            <button type="button" aria-label={`Dzēst ${r.name}`} onClick={() => { removeRide(r.id); track("saved_ride_removed"); }}
              className="shrink-0 rounded-full p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-700">
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
      {rides.length > 1 && (
        <Link href="/saglabatie" onClick={() => track("saved_list_opened", { count: rides.length })}
          className="mt-1 block text-center text-[11px] font-medium text-[#bd4b00] hover:underline">Rādīt visus {rides.length} →</Link>
      )}
      <p className="mt-1 text-[10px] text-stone-400">Glabājas tikai šajā ierīcē un pārlūkā.</p>
    </section>
  );
}
