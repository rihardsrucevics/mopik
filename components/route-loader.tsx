"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

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
const STATUS: Record<"thinking" | "routing" | "lucky", string[]> = {
  thinking: ["Lasu, ko vēlies mainīt…", "Precizēju plānu…"],
  lucky: [
    "Bez galamērķa un laika limita? Laimīgais!",
    "Atradīsim tev kaut ko foršu…",
    "Skatos, kur mežs ir dziļāks…",
    "Meklēju ceļus, pa kuriem vēl neesi bijis…",
    "Zīmēju trases versijas…",
  ],
  routing: [
    "Kalibrēju apkārtni…",
    "Meklēju meža ceļus…",
    "Zīmēju trases versijas…",
    "Pārbaudu, kur ceļi atkārtojas…",
    "Vērtēju segumu un pagriezienus…",
  ],
};


export function RouteLoader({ phase, className, onCancel }: {
  phase: "thinking" | "routing" | "lucky";
  className?: string;
  /** Call the generation off. Absent = no control, for callers with nothing to cancel. */
  onCancel?: () => void;
}) {
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

  const card = (
    <div role="status" aria-live="polite" className={`overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] ${onCancel ? "" : (className ?? "")}`}>
      <div className="relative">
        <RouteScene className="h-28 w-full" />
        {advert && (
          <div className="mopik-fade-in absolute inset-0 flex h-28 flex-col items-center justify-center bg-[#f56300] text-center">
            <span className="text-sm font-semibold tracking-tight text-white">Brīva vieta reklāmai</span>
            <span className="mt-0.5 text-[11px] text-white/80">mopik.eu</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 pb-3">
        <span className="size-1.5 animate-pulse rounded-full bg-[#f56300]" />
        <span key={line} className="mopik-fade-in min-w-0 flex-1 truncate text-xs font-medium text-stone-700">{line}</span>
      </div>
    </div>
  );

  if (!onCancel) return card;

  // Cancelling sits outside the animation, on its own full-width row. Inside
  // the card it was a small link competing with a moving picture for
  // attention — the rider asked for something he could actually hit. 44 px
  // is the thumb target a phone needs.
  return (
    <div className={`grid gap-2 ${className ?? ""}`}>
      {card}
      <button type="button" onClick={onCancel}
        className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900 active:bg-stone-50">
        <X className="size-4" />
        Atcelt
      </button>
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
