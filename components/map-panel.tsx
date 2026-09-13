"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * The map with its full-screen control. Wherever a map is shown — the planner,
 * a shared route, a saved one — the rider can put it over the whole screen,
 * because on a phone the map is otherwise a quarter of the page and a forest
 * route is unreadable at that size. Phones only: on a desktop the map already
 * fills its column.
 */
export function MapPanel({ children, className = "", expandedClassName = "" }: {
  children: ReactNode;
  /** Height and frame while inline; the component owns the expanded state. */
  className?: string;
  /** Optional desktop-only overrides applied while expanded. */
  expandedClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [expanded]);

  return (
    <div className={expanded ? `fixed inset-0 z-40 bg-[#faf9f6] ${expandedClassName}` : `relative ${className}`}>
      {children}
      <button type="button" onClick={() => setExpanded((v) => { if (!v) track("map_fullscreen"); return !v; })}
        aria-label={expanded ? "Aizvērt pilnekrāna karti" : "Karte pa visu ekrānu"}
        className="absolute bottom-3 left-3 flex size-10 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-sm backdrop-blur md:hidden">
        {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}
