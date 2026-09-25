"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages, type MessageKey } from "@/lib/i18n/messages";

/**
 * The "route drawing itself" motif, in two sizes.
 *
 * Contour lines of a hill, an orange route being drawn across them, and a
 * motorcycle running along it with a headlight. The stroke changes character
 * along the way the same way the map legend does — solid, dashed, dotted —
 * so the animation is literally what the product does. Pure SVG + CSS, no
 * library; SMIL `animateMotion` drives the bike along the very path being
 * drawn, so the two never drift apart.
 */

const ROUTE_D =
  "M 12 108 C 40 96, 52 70, 82 74 S 128 110, 158 92 C 184 76, 176 40, 206 38 S 250 68, 272 54 C 292 42, 300 28, 314 22";

/** Status lines per phase, cycled while the work runs. */
/**
 * The loader's lines, as dictionary keys. They are the text a rider stares at
 * for the whole generation, so leaving them Latvian while the rest of the app
 * spoke four languages was the most visible gap of the lot.
 */
const STATUS: Record<"thinking" | "routing" | "lucky", MessageKey[]> = {
  thinking: ["loadThinking1", "loadThinking2"],
  lucky: ["loadLucky1", "loadLucky2", "loadLucky3", "loadLucky4", "loadRoute3"],
  routing: ["loadRoute1", "loadRoute2", "loadRoute3", "loadRoute4", "loadRoute5"],
};


/**
 * Cancelling is deliberately NOT here. It used to be a full-width row under
 * this card, but a rider looking for the way out looks at the bottom of the
 * chat column, where his thumb already rests on the input. `RoutePrompt` now
 * renders "Atcelt" in the input's own slot while a generation runs, so this
 * card is only the animation and its status line — and there is exactly one
 * cancel on screen.
 */
export function RouteLoader({ phase, className }: {
  phase: "thinking" | "routing" | "lucky";
  className?: string;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const lines = STATUS[phase];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % lines.length), 2200);
    return () => clearInterval(t);
  }, [lines.length]);
  // One frame of the loader is for sale. It shows a few seconds in — late
  // enough that a quick route never sees it, long enough to read.
  const ADVERT_AFTER_MS = 3000;
  const ADVERT_MS = 2400;
  const [advert, setAdvert] = useState(false);
  useEffect(() => {
    const show = setTimeout(() => setAdvert(true), ADVERT_AFTER_MS);
    const hide = setTimeout(() => setAdvert(false), ADVERT_AFTER_MS + ADVERT_MS);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, []);
  const line = lines[index];

  return (
    <div role="status" aria-live="polite" className={`overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] ${className ?? ""}`}>
      <div className="relative">
        <RouteScene className="h-28 w-full" />
        {/* The advert is a card of its own, inset with all four corners
            rounded. Laid edge to edge over the scene it had the outer card's
            rounded top and a square bottom that ran straight into the status
            line, which read as the banner — and the text under it — cut off. */}
        {advert && (
          <div className="mopik-fade-in absolute inset-2 flex flex-col items-center justify-center overflow-hidden rounded-xl bg-[#f56300] text-center shadow-[inset_0_-24px_40px_-24px_rgba(0,0,0,0.18)]">
            <svg viewBox="0 0 326 102" className="pointer-events-none absolute inset-0 h-full w-full" preserveAspectRatio="none" aria-hidden="true">
              <path d={ROUTE_D} fill="none" stroke="#fff" strokeOpacity="0.22" strokeWidth="3" strokeLinecap="round" strokeDasharray="10 8" />
            </svg>
            <span className="relative text-base font-bold tracking-tight text-white">{m.advertSlot}</span>
            <span className="relative mt-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium text-white">mopik.eu</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 pb-3 pt-1">
        <span className="size-1.5 animate-pulse rounded-full bg-[#f56300]" />
        <span key={line} className="mopik-fade-in min-w-0 flex-1 truncate text-xs font-medium text-stone-700">{m[line]}</span>
      </div>
    </div>
  );
}

export function RouteScene({ className, speed = 1 }: { className?: string; speed?: number }) {
  const seconds = 3.6 / speed;
  const dur = `${seconds}s`;
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);

  return (
    <svg ref={svgRef} viewBox="0 0 326 130" className={className} aria-hidden="true" style={{ ["--mopik-dur" as string]: dur }}>
      <defs>
        <radialGradient id="mopik-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#fff3d6" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#fff3d6" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Contour lines: a hill and a valley, the terrain the route reads. */}
      <g fill="none" stroke="#e4e0d8" strokeWidth="1">
        <path d="M -10 96 C 50 70, 90 70, 130 88 S 210 120, 260 96 S 320 72, 340 84" />
        <path d="M -10 78 C 40 50, 100 46, 140 66 S 200 104, 250 78 S 300 48, 340 62" />
        <path d="M 20 60 C 60 34, 110 30, 150 48 S 190 84, 240 60 S 290 30, 330 44" strokeDasharray="2 4" />
        <path d="M -10 116 C 60 100, 120 106, 180 118 S 280 130, 340 110" />
      </g>
      {/* A few trees on the hill, quietly. */}
      <g fill="#cfd8c8">
        <path d="M 58 58 l 4 -8 l 4 8 z M 66 54 l 3 -6 l 3 6 z M 232 50 l 4 -8 l 4 8 z M 244 46 l 3 -6 l 3 6 z M 120 46 l 3 -6 l 3 6 z" />
      </g>

      {/* Faint full route: where we are going. */}
      <path d={ROUTE_D} fill="none" stroke="#f56300" strokeOpacity="0.14" strokeWidth="3" strokeLinecap="round" />

      {/* The route being drawn: solid → dashed → dotted, like the legend. */}
      <path ref={pathRef} id="mopik-route" d={ROUTE_D} pathLength={1} fill="none" stroke="#f56300" strokeWidth="3" strokeLinecap="round" className="mopik-draw" />
      <path d={ROUTE_D} pathLength={1} fill="none" stroke="#faf9f6" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.02 0.03" strokeDashoffset="-0.42" className="mopik-draw-mask" />
      <path d={ROUTE_D} pathLength={1} fill="none" stroke="#faf9f6" strokeWidth="3" strokeLinecap="round" strokeDasharray="0.006 0.02" strokeDashoffset="-0.72" className="mopik-draw-mask" />

      {/* The bike, side view, nose along the path: two wheels, a tank and
          seat, a rider hunched forward, a headlight beam ahead. */}
      <g className="mopik-bike">
        <ellipse rx="22" ry="9" cx="14" fill="url(#mopik-glow)" />
        <g fill="#1c1917" stroke="#1c1917" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="-6.5" cy="2.5" r="3.2" fill="none" strokeWidth="1.8" />
          <circle cx="6.5" cy="2.5" r="3.2" fill="none" strokeWidth="1.8" />
          <path d="M -6.5 2.5 L -3 -2 L 3 -2 L 6.5 2.5 Z" strokeWidth="1.4" />
          <path d="M -4 -2 L -6 -5.5 M 3 -2 L 5.5 -5 L 8 -4.5" fill="none" strokeWidth="1.6" />
          <circle cx="-1.5" cy="-6.5" r="2.2" />
        </g>
        <path d="M 8.5 -4.5 L 26 -9 L 26 0 Z" fill="#fff3d6" fillOpacity="0.7" />
        <animateMotion dur={dur} repeatCount="indefinite" rotate="auto" keyPoints="0;1;1" keyTimes="0;0.78;1" calcMode="linear">
          <mpath href="#mopik-route" />
        </animateMotion>
      </g>
    </svg>
  );
}
