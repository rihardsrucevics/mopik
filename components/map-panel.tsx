"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { track } from "@/lib/analytics";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";
import { mapPanelMounted, setMapFullscreen, useMapFullscreen, useMapPendingCount } from "@/lib/map/fullscreen";
import { fi } from "@/lib/i18n/format";
import { guardFullscreenZoom } from "@/lib/map/page-zoom";
import { lockPageScroll } from "@/lib/map/scroll-lock";

/**
 * The map with its full-screen control. Wherever a map is shown — the planner,
 * a shared route, a saved one — the rider can put it over the whole screen,
 * because on a phone the map is otherwise a quarter of the page and a forest
 * route is unreadable at that size. Phones only: on a desktop the map already
 * fills its column.
 */
export function MapPanel({ children, className = "", expandedClassName = "" }: {
  children: ReactNode;
  /** Height and frame while inline; full screen is `lib/map/fullscreen`. */
  className?: string;
  /** Optional desktop-only overrides applied while expanded. */
  expandedClassName?: string;
}) {
  const [locale] = useLocale();
  // Shared, not local: an action outside the panel („Labot”, a row's pin
  // button) opens it, and „Labot” remounts it on the way (lib/map/fullscreen).
  const expanded = useMapFullscreen();
  // Marks waiting for ✓: the collapse button works while they wait (it only
  // minimises the map — the composer keeps them), and the preview says so.
  const pendingCount = useMapPendingCount();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => mapPanelMounted(), []);
  // While a mark waits for ✓ or ✕ the map stays full screen (rider,
  // 2026-09-25: closing it must not lose the mark silently). The map says so
  // with `data-map-pending`; the close button is then not drawn, and Escape
  // is the map's own ✕ — the next Escape closes.
  const pendingMark = () => Boolean(rootRef.current?.querySelector("[data-map-pending]"));


  useEffect(() => {
    if (!expanded) return;
    // The page under it does not move while it is open — not by a touch,
    // not by a focus — and is where it was when it closes (lib/map/scroll-lock).
    const unlock = lockPageScroll(rootRef.current);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !pendingMark()) setMapFullscreen(false); };
    window.addEventListener("keydown", onKey);
    // The page itself must not zoom under the full-screen map, and a zoom
    // that happens anyway is undone — here, and on the way out
    // (lib/map/page-zoom; rider's iPhone, 2026-09-27).
    const unguard = guardFullscreenZoom();
    return () => { unlock(); window.removeEventListener("keydown", onKey); unguard(); };
  }, [expanded]);

  return (
    // `data-map-expanded` lets the map's own overlays react to full screen
    // without threading the state through — the legend is worth its space on a
    // full screen and not on a 26dvh strip, where it covers the route.
    //
    // `data-map-slot` is how anything outside finds the map's box without a
    // ref threaded through three parents: exactly one MapLibre instance
    // exists and `useMediaQuery` moves that single node between the composer
    // slot, the result panel and the desktop column, so a ref held by any one
    // of them would be null in the other two. The planner's "Kartē" on a
    // suggestion uses it to scroll the map into view on a phone, where it can
    // easily be above the fold the rider is reading.
    <div ref={rootRef} data-map-slot="true" data-map-expanded={expanded ? "true" : undefined}
      //
      // On a phone the inline map is a preview (rider, 2026-09-25): nothing is
      // edited on it. The map's own controls (`data-map-chrome`, MapLibre's
      // zoom stack) are not drawn, and one button over the whole map opens it
      // full screen — a tap anywhere, with „Atvērt karti” saying so. The
      // button takes every gesture, so no mark, drag or pin tap reaches the
      // map, and a swipe over it scrolls the page. `isolate` keeps the map's
      // own z-indices inside the preview's box.
      //
      // Full screen is `touch-none`: a pinch or a double-tap on the field, the
      // legend or a button zooms nothing — before, it zoomed the whole page,
      // and with the canvas taking every other touch there was nowhere left
      // to pinch it back (rider's iPhone, 2026-09-27). The map's own pinch is
      // on its canvas, which MapLibre already makes `touch-action: none` and
      // drives from touch events. The field's suggestion list still scrolls
      // (`pan-y`). Taps and clicks are not touch actions and are unaffected.
      className={expanded ? `group/panel fixed inset-0 z-40 flex touch-none flex-col bg-[#faf9f6] [&_[role=listbox]]:touch-pan-y ${expandedClassName}` : `relative ${className} max-md:isolate max-md:[&_.maplibregl-ctrl-top-right]:hidden max-md:[&_[data-map-chrome]]:hidden`}>
      {/* The map must fill the fixed layer itself. Inside the composer's flex
          column a plain child of `fixed inset-0` collapsed to zero height,
          which took the close button (positioned against it) down to 0 x 0 px
          and made leaving full screen impossible. `flex-1 min-h-0` gives the
          map the whole layer and the button something to sit on. */}
      <div className={expanded ? "relative min-h-0 flex-1" : "contents"}>{children}</div>
      {/* Bottom-left, the corner itself: the left slot of the full-screen
          bottom row, in every state (rider, 2026-09-27: when it disappeared
          while a mark was pending, "it looks like something vanished
          unnaturally"). A pending mark survives it — the map is only
          minimised, and the preview's chip says what is waiting. The legend
          is at the top on a phone now, so nothing needs clearing down here. */}
      {expanded ? (
        <button type="button" onClick={() => setMapFullscreen(false)}
          aria-label={t(locale, "mapExitFullscreen")}
          className="absolute bottom-3 left-3 flex size-14 items-center justify-center rounded-full border border-stone-200 bg-white/95 text-stone-700 shadow-md backdrop-blur md:hidden">
          <Minimize2 className="size-5" />
        </button>
      ) : (
        <button type="button" onClick={() => { track("map_fullscreen"); setMapFullscreen(true); }}
          aria-label={pendingCount > 0 ? `${t(locale, "mapFullscreen")} · ${pendingCount === 1 ? t(locale, "mapPreviewPendingOne") : fi(t(locale, "mapPreviewPendingMany"), { n: pendingCount })}` : t(locale, "mapFullscreen")}
          className="absolute inset-0 z-30 flex items-end justify-center pb-3 md:hidden">
          <span className="flex items-center gap-2 rounded-full border border-stone-200 bg-white/95 px-4 py-2.5 text-sm font-semibold text-stone-800 shadow-md backdrop-blur">
            <Maximize2 aria-hidden="true" className="size-4" />{t(locale, "mapOpenPreview")}
            {pendingCount > 0 && (
              <span data-preview-pending className="text-[#bd4b00]">
                {" · "}{pendingCount === 1 ? t(locale, "mapPreviewPendingOne") : fi(t(locale, "mapPreviewPendingMany"), { n: pendingCount })}
              </span>
            )}
          </span>
        </button>
      )}
    </div>
  );
}
