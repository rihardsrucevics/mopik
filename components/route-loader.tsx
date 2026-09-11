"use client";

import { useEffect, useState } from "react";

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

/**
 * Two breaks a rider takes while the map is being drawn. Slipped into the
 * status lines at random positions (never first), each once per loader,
 * and the scene changes with them: a cigarette burning down, a beer
 * emptying. The real work continues underneath.
 */
type Line = { text: string; scene: "route" | "cigarette" | "beer" };
const BREAKS: Line[] = [
  { text: "Uzpīpēju…", scene: "cigarette" },
  { text: "Iedzeru aliņu…", scene: "beer" },
];

function withBreaks(base: string[]): Line[] {
  const lines: Line[] = base.map((text) => ({ text, scene: "route" }));
  const breaks = Math.random() < 0.5 ? BREAKS : [...BREAKS].reverse();
  for (const b of breaks) {
    // Anywhere after the first line, so the loader always opens on the work.
    const at = 1 + Math.floor(Math.random() * lines.length);
    lines.splice(at, 0, b);
  }
  return lines;
}

export function RouteLoader({ phase, className }: { phase: "thinking" | "routing" | "lucky"; className?: string }) {
  // Thinking is a short phase; the breaks belong to the long one.
  const [lines] = useState<Line[]>(() => (phase === "thinking" ? STATUS.thinking.map((text) => ({ text, scene: "route" as const })) : withBreaks(STATUS[phase])));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % lines.length), 2200);
    return () => clearInterval(t);
  }, [lines.length]);
  const line = lines[index];

  return (
    <div role="status" aria-live="polite" className={`overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] ${className ?? ""}`}>
      {line.scene === "route" && <RouteScene className="h-28 w-full" />}
      {line.scene === "cigarette" && <CigaretteScene key={index} className="h-28 w-full" />}
      {line.scene === "beer" && <BeerScene key={index} className="h-28 w-full" />}
      <div className="flex items-center gap-2 px-4 pb-3">
        <span className="size-1.5 animate-pulse rounded-full bg-[#f56300]" />
        <span key={index} className="mopik-fade-in text-xs font-medium text-stone-700">{line.text}</span>
      </div>
    </div>
  );
}

/** A cigarette burning down over one status tick, smoke curling off the ember. */
function CigaretteScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 326 130" className={className} aria-hidden="true">
      <defs>
        <radialGradient id="mopik-ember" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#ffb347" />
          <stop offset="60%" stopColor="#f56300" />
          <stop offset="100%" stopColor="#f56300" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* the same hill, so the break happens on the same ride */}
      <g fill="none" stroke="#e4e0d8" strokeWidth="1">
        <path d="M -10 116 C 60 100, 120 106, 180 118 S 280 130, 340 110" />
        <path d="M -10 96 C 50 70, 90 70, 130 88 S 210 120, 260 96 S 320 72, 340 84" />
      </g>
      {/* filter */}
      <rect x="196" y="60" width="42" height="14" rx="3" fill="#d9a066" />
      <rect x="196" y="60" width="42" height="14" rx="3" fill="none" stroke="#b9874f" strokeWidth="1" />
      {/* paper, burning from the left towards the filter */}
      <g className="mopik-cig-body" style={{ transformOrigin: "196px 67px" }}>
        <rect x="90" y="60" width="106" height="14" rx="2" fill="#ffffff" stroke="#d6d3d1" strokeWidth="1" />
      </g>
      {/* ember and smoke travel with the burn line */}
      <g className="mopik-cig-ember">
        <rect x="86" y="60" width="6" height="14" rx="2" fill="#57534e" />
        <circle cx="89" cy="67" r="9" fill="url(#mopik-ember)" />
        <g fill="none" stroke="#a8a29e" strokeWidth="1.4" strokeLinecap="round">
          <path className="mopik-smoke" d="M 88 52 c -6 -6, 6 -10, 0 -18" style={{ animationDelay: "0s" }} />
          <path className="mopik-smoke" d="M 92 50 c -6 -6, 6 -10, 0 -18" style={{ animationDelay: "0.7s" }} />
          <path className="mopik-smoke" d="M 84 54 c -6 -6, 6 -10, 0 -18" style={{ animationDelay: "1.4s" }} />
        </g>
      </g>
    </svg>
  );
}

/** A glass of beer emptied over one status tick, bubbles rising while it lasts. */
function BeerScene({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 326 130" className={className} aria-hidden="true">
      <g fill="none" stroke="#e4e0d8" strokeWidth="1">
        <path d="M -10 116 C 60 100, 120 106, 180 118 S 280 130, 340 110" />
        <path d="M -10 96 C 50 70, 90 70, 130 88 S 210 120, 260 96 S 320 72, 340 84" />
      </g>
      <defs>
        <clipPath id="mopik-glass-clip"><path d="M 143 32 L 183 32 L 179 106 Q 163 112 147 106 Z" /></clipPath>
      </defs>
      {/* beer, draining towards the bottom */}
      <g clipPath="url(#mopik-glass-clip)">
        <g className="mopik-beer" style={{ transformOrigin: "163px 106px" }}>
          <rect x="140" y="44" width="46" height="64" fill="#f5b733" />
          <rect x="140" y="44" width="46" height="4" fill="#fde68a" />
        </g>
        <g fill="#fff7d6" fillOpacity="0.9">
          <circle className="mopik-bubble" cx="152" cy="100" r="1.6" style={{ animationDelay: "0s" }} />
          <circle className="mopik-bubble" cx="163" cy="104" r="1.2" style={{ animationDelay: "0.5s" }} />
          <circle className="mopik-bubble" cx="172" cy="98" r="1.4" style={{ animationDelay: "1s" }} />
          <circle className="mopik-bubble" cx="158" cy="102" r="1" style={{ animationDelay: "1.5s" }} />
        </g>
        {/* foam, riding down on the beer */}
        <g className="mopik-foam">
          <ellipse cx="163" cy="44" rx="23" ry="5" fill="#fffaf0" />
          <circle cx="150" cy="41" r="4" fill="#fffaf0" />
          <circle cx="163" cy="39" r="5" fill="#fffaf0" />
          <circle cx="176" cy="41" r="4" fill="#fffaf0" />
        </g>
      </g>
      {/* glass and handle */}
      <path d="M 143 32 L 183 32 L 179 106 Q 163 112 147 106 Z" fill="none" stroke="#a8a29e" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M 183 48 q 16 0 16 14 q 0 14 -14 16" fill="none" stroke="#a8a29e" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** The drawing itself, reused by the intro at a larger size. */
export function RouteScene({ className, speed = 1 }: { className?: string; speed?: number }) {
  const dur = `${3.6 / speed}s`;
  return (
    <svg viewBox="0 0 326 130" className={className} aria-hidden="true" style={{ ["--mopik-dur" as string]: dur }}>
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
      <path id="mopik-route" d={ROUTE_D} pathLength={1} fill="none" stroke="#f56300" strokeWidth="3" strokeLinecap="round" className="mopik-draw" />
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
