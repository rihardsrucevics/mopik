"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";

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
  const [locale] = useLocale();
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
    // `data-map-expanded` lets the map's own overlays react to full screen
    // without threading the state through — the legend is worth its space on a
    // full screen and not on a 26dvh strip, where it covers the route.
    <div data-map-expanded={expanded ? "true" : undefined}
      className={expanded ? `fixed inset-0 z-40 flex flex-col bg-[#faf9f6] ${expandedClassName}` : `relative ${className}`}>
      {/* The map must fill the fixed layer itself. Inside the composer's flex
          column a plain child of `fixed inset-0` collapsed to zero height,
          which took the close button (positioned against it) down to 0 x 0 px
          and made leaving full screen impossible. `flex-1 min-h-0` gives the
          map the whole layer and the button something to sit on. */}
      <div className={expanded ? "relative min-h-0 flex-1" : "contents"}>{children}</div>
      <button type="button" onClick={() => setExpanded((v) => { if (!v) track("map_fullscreen"); return !v; })}
        aria-label={t(locale, expanded ? "mapExitFullscreen" : "mapFullscreen")}
        className="absolute bottom-3 left-3 flex size-10 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-sm backdrop-blur md:hidden">
        {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}
