"use client";

import { useEffect, useRef, useState } from "react";

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
 * The loader is a small game: the bike rides the route that is being drawn,
 * a cigarette and a beer lie on the road ahead of it, and when it runs over
 * one the item pops, the counter ticks and the status line says "Uzpīpēju…"
 * or "Iedzeru aliņu…". One pickup per lap, alternating. The real work
 * continues underneath; the status lines keep cycling between pickups.
 */
const PICKUP_LINE: Record<Pickup, string> = { cigarette: "Uzpīpēju…", beer: "Iedzeru aliņu…" };

export function RouteLoader({ phase, className }: { phase: "thinking" | "routing" | "lucky"; className?: string }) {
  const lines = STATUS[phase];
  const [index, setIndex] = useState(0);
  const [override, setOverride] = useState<string | null>(null);
  // The big break scene laid over the route for a moment after a pickup.
  const [breakScene, setBreakScene] = useState<Pickup | null>(null);
  const [score, setScore] = useState<Record<Pickup, number>>({ cigarette: 0, beer: 0 });
  useEffect(() => {
    const t = setInterval(() => setIndex((i) => (i + 1) % lines.length), 2200);
    return () => clearInterval(t);
  }, [lines.length]);
  const BREAK_MS = 2400;
  const onPickup = (kind: Pickup) => {
    setScore((s) => ({ ...s, [kind]: s[kind] + 1 }));
    setOverride(PICKUP_LINE[kind]);
    setBreakScene(kind);
    setTimeout(() => { setOverride(null); setBreakScene(null); }, BREAK_MS);
  };
  const line = override ?? lines[index];

  return (
    <div role="status" aria-live="polite" className={`overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] ${className ?? ""}`}>
      <div className="relative">
        <RouteScene className="h-28 w-full" pickups={phase !== "thinking"} onPickup={onPickup} />
        {/* The ride keeps running underneath so the game state survives the break. */}
        {breakScene && (
          <div className="mopik-fade-in absolute inset-0 bg-[#faf9f6]">
            {breakScene === "cigarette" ? <CigaretteScene className="h-28 w-full" /> : <BeerScene className="h-28 w-full" />}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 pb-3">
        <span className="size-1.5 animate-pulse rounded-full bg-[#f56300]" />
        <span key={line} className={`mopik-fade-in text-xs font-medium ${override ? "text-[#bd4b00]" : "text-stone-700"}`}>{line}</span>
        {(score.cigarette > 0 || score.beer > 0) && (
          <span className="ml-auto text-[11px] tabular-nums text-stone-400" aria-label="Savāktais">
            🚬 {score.cigarette} · 🍺 {score.beer}
          </span>
        )}
      </div>
    </div>
  );
}

type Pickup = "cigarette" | "beer";
/** Where on the route the items lie (path fraction) and which lap each shows on. */
const PICKUPS: { kind: Pickup; at: number; lap: 0 | 1 }[] = [
  { kind: "cigarette", at: 0.36, lap: 0 },
  { kind: "beer", at: 0.7, lap: 1 },
];
/** The bike covers the whole path in this share of a lap (see keyTimes below). */
const RIDE_SHARE = 0.78;

/** The drawing itself, reused by the intro at a larger size. */
export function RouteScene({ className, speed = 1, pickups = false, onPickup }: { className?: string; speed?: number; pickups?: boolean; onPickup?: (kind: Pickup) => void }) {
  const seconds = 3.6 / speed;
  const dur = `${seconds}s`;
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const [points, setPoints] = useState<{ x: number; y: number }[] | null>(null);
  // Which items are lying on the road right now, and which are popping.
  const [state, setState] = useState<Record<Pickup, "road" | "pop" | "gone">>({ cigarette: "gone", beer: "gone" });
  const onPickupRef = useRef(onPickup);
  useEffect(() => { onPickupRef.current = onPickup; }, [onPickup]);

  useEffect(() => {
    if (!pickups) return;
    const path = pathRef.current;
    const svg = svgRef.current;
    if (!path || !svg) return;
    const total = path.getTotalLength();
    setPoints(PICKUPS.map((p) => { const pt = path.getPointAtLength(p.at * total); return { x: pt.x, y: pt.y }; }));
    // The bike is SMIL and runs on the SVG document clock, so the pickups
    // read that same clock: lap = floor(t / dur), progress = fraction ridden.
    const seen = new Set<string>();
    let current: Record<Pickup, "road" | "pop" | "gone"> = { cigarette: "gone", beer: "gone" };
    const commit = (next: typeof current) => {
      if (next.cigarette === current.cigarette && next.beer === current.beer) return;
      current = next;
      setState(next);
    };
    const tick = () => {
      const t = svg.getCurrentTime();
      const lap = Math.floor(t / seconds);
      const progress = Math.min(1, ((t % seconds) / seconds) / RIDE_SHARE);
      const next = { ...current };
      const collected: Pickup[] = [];
      for (const p of PICKUPS) {
        const key = `${p.kind}:${lap}`;
        if (lap % 2 !== p.lap) { if (current[p.kind] !== "pop") next[p.kind] = "gone"; continue; }
        if (progress < p.at) { if (!seen.has(key)) next[p.kind] = "road"; }
        else if (!seen.has(key)) { seen.add(key); next[p.kind] = "pop"; collected.push(p.kind); }
      }
      commit(next);
      // Callbacks and the pop timeout run here, outside any React render.
      for (const kind of collected) {
        onPickupRef.current?.(kind);
        setTimeout(() => commit({ ...current, [kind]: "gone" }), 500);
      }
    };
    const id = setInterval(tick, 80);
    return () => clearInterval(id);
  }, [pickups, seconds]);

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

      {/* Pickups on the road: a cigarette and a beer (no handle). Each pops
          when the bike reaches it; the burst is CSS. */}
      {pickups && points && PICKUPS.map((p, i) => {
        const st = state[p.kind];
        if (st === "gone") return null;
        const { x, y } = points[i];
        return (
          <g key={p.kind} transform={`translate(${x} ${y - 9})`} className={st === "pop" ? "mopik-pop" : "mopik-bob"} style={{ transformOrigin: `${x}px ${y - 9}px` }}>
            {p.kind === "cigarette" ? (
              <g transform="rotate(-20)">
                <rect x="-8" y="-2.2" width="16" height="4.4" rx="1.2" fill="#ffffff" stroke="#a8a29e" strokeWidth="0.8" />
                <rect x="3.5" y="-2.2" width="4.5" height="4.4" rx="1" fill="#d9a066" />
                <circle cx="-8.2" cy="0" r="1.6" fill="#f56300" />
                <path d="M -9 -4 c -2 -2, 2 -4, 0 -7" fill="none" stroke="#a8a29e" strokeWidth="0.8" strokeLinecap="round" />
              </g>
            ) : (
              <g>
                <path d="M -4.5 -6 L 4.5 -6 L 3.6 6 Q 0 7.2 -3.6 6 Z" fill="#f5b733" stroke="#a8a29e" strokeWidth="0.8" strokeLinejoin="round" />
                <path d="M -4.5 -6 L 4.5 -6 L 4.2 -2.5 L -4.2 -2.5 Z" fill="#fffaf0" />
                <circle cx="-2.5" cy="-6.5" r="1.6" fill="#fffaf0" /><circle cx="0.5" cy="-7.4" r="2" fill="#fffaf0" /><circle cx="3" cy="-6.5" r="1.5" fill="#fffaf0" />
              </g>
            )}
            {st === "pop" && (
              <g className="mopik-burst" fill="none" stroke="#f56300" strokeWidth="1" strokeLinecap="round">
                <path d="M 0 -12 v -3 M 8 -8 l 2 -2 M -8 -8 l -2 -2 M 11 0 h 3 M -11 0 h -3" />
              </g>
            )}
          </g>
        );
      })}

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

/** The big break: a cigarette burning down while the line says Uzpīpēju… */
export function CigaretteScene({ className }: { className?: string }) {
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

/** The big break: a beer (no handle) emptied while the line says Iedzeru aliņu… */
export function BeerScene({ className }: { className?: string }) {
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
    </svg>
  );
}
