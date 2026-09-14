"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);

  // How tall the map's legend currently is, published as `--map-legend` so the
  // full-screen button can sit directly above it on a narrow screen.
  //
  // It has to be measured rather than assumed: the legend wraps onto one or
  // two rows depending on the viewport width and on how long the words are in
  // the rider's language, so any fixed offset is wrong for somebody. The
  // legend marks itself with `data-map-legend` and this only ever looks inside
  // MapPanel's own subtree — the map component stays free to lay its legend
  // out however it likes, as long as it keeps the marker.
  //
  // `getBoundingClientRect` (not offsetHeight) because the legend's height is
  // fractional at most text sizes, and a rounded-down offset leaves the button
  // a pixel into the legend. The 8 px gap between the two is folded in here
  // rather than added in the button's own `calc`, so that the variable is a
  // flat 0 px when there is no legend to clear — on the inline phone strip the
  // legend is hidden and the button keeps the corner to itself, with no stray
  // gap under it.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const legend = root.querySelector<HTMLElement>("[data-map-legend]");
    if (!legend) return;
    const apply = () => {
      const h = legend.offsetParent === null ? 0 : legend.getBoundingClientRect().height;
      root.style.setProperty("--map-legend", h ? `${h + 8}px` : "0px");
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(legend);
    observer.observe(root);
    return () => observer.disconnect();
  }, [expanded, locale]);

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
    // `--map-btn` is the full-screen button's own footprint (size + its 12 px
    // inset), published so the map's overlays can keep clear of a control they
    // do not own. Only the wide layout still needs it, to start the legend to
    // the right of the button; on a narrow screen the two are stacked instead
    // and it is `--map-legend`, measured above, that does the keeping-clear.
    <div ref={rootRef} data-map-expanded={expanded ? "true" : undefined}
      style={{ "--map-btn": "3.25rem" } as CSSProperties}
      className={expanded ? `fixed inset-0 z-40 flex flex-col bg-[#faf9f6] ${expandedClassName}` : `relative ${className}`}>
      {/* The map must fill the fixed layer itself. Inside the composer's flex
          column a plain child of `fixed inset-0` collapsed to zero height,
          which took the close button (positioned against it) down to 0 x 0 px
          and made leaving full screen impossible. `flex-1 min-h-0` gives the
          map the whole layer and the button something to sit on. */}
      <div className={expanded ? "relative min-h-0 flex-1" : "contents"}>{children}</div>
      {/* Bottom-left, above the legend. The button is what the thumb reaches
          for, so it takes the position nearest the corner that is still clear
          of the legend: 12 px inset, plus the legend's measured height and the
          8 px gap between them when there is a legend at all. `--map-legend`
          resolves to 0 px on the inline phone strip, where the legend is
          hidden, and the button falls back to the bare corner — as it does if
          the variable never gets set. `size-10` is the 40 px tap target and is
          not negotiable; the offset moves the button, never its size. */}
      <button type="button" onClick={() => setExpanded((v) => { if (!v) track("map_fullscreen"); return !v; })}
        aria-label={t(locale, expanded ? "mapExitFullscreen" : "mapFullscreen")}
        className="absolute bottom-[calc(0.75rem+var(--map-legend,0px))] left-3 flex size-10 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-sm backdrop-blur md:hidden">
        {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
      </button>
    </div>
  );
}
