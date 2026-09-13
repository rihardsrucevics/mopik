"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Bookmark } from "lucide-react";
import { track } from "@/lib/analytics";
import { listSaved } from "@/lib/share/saved-rides";

/**
 * An entrance to the saved rides, not a list of them. The block sits above
 * the form on the first screen, so it stays one line: naming a specific ride
 * here pushed the form down without helping anyone who came to plan a new
 * one. Hidden entirely until something is saved.
 */
export function SavedRides() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(listSaved().length);
    sync();
    window.addEventListener("mopik:saved-changed", sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("mopik:saved-changed", sync); window.removeEventListener("storage", sync); };
  }, []);
  if (!count) return null;

  return (
    <Link href="/saglabatie" onClick={() => track("saved_list_opened", { count })}
      className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-4 py-3 transition hover:border-stone-300 hover:bg-stone-50">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff3ea]">
        <Bookmark className="size-4 text-[#f56300]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-stone-900">Saglabātie maršruti</span>
        <span className="block text-[11px] text-stone-500">{count} {count === 1 ? "maršruts" : "maršruti"} šajā ierīcē</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-stone-400" />
    </Link>
  );
}
