"use client";

import { useEffect, useState } from "react";
import { RouteScene } from "@/components/route-loader";

/**
 * A two-second opening: the route draws itself across the hills while the
 * wordmark settles, then the curtain lifts. Once per browser session, never
 * for riders who asked their OS for reduced motion, and a tap skips it.
 */
const SESSION_KEY = "mopik.intro.seen";
const DURATION_MS = 2300;

/**
 * Decided once per page load. React's development StrictMode runs effects
 * twice; without this cache the first run marked the intro as seen and the
 * second run then skipped it, so it never played in development.
 */
let shouldPlay: boolean | null = null;
function decide(): boolean {
  if (shouldPlay !== null) return shouldPlay;
  let seen = false;
  let reduced = false;
  try {
    seen = window.sessionStorage.getItem(SESSION_KEY) === "1";
    reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    // storage blocked: play once anyway
  }
  shouldPlay = !seen && !reduced;
  if (shouldPlay) {
    try { window.sessionStorage.setItem(SESSION_KEY, "1"); } catch { /* fine */ }
  }
  return shouldPlay;
}

export function IntroSplash() {
  const [state, setState] = useState<"hidden" | "playing" | "leaving">("hidden");

  useEffect(() => {
    if (!decide()) return;
    const start = setTimeout(() => setState("playing"), 0);
    const leave = setTimeout(() => setState("leaving"), DURATION_MS);
    const done = setTimeout(() => setState("hidden"), DURATION_MS + 600);
    return () => { clearTimeout(start); clearTimeout(leave); clearTimeout(done); };
  }, []);

  if (state === "hidden") return null;

  return (
    <div
      role="presentation"
      onClick={() => setState("hidden")}
      className={`fixed inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-[#faf9f6] ${state === "leaving" ? "mopik-curtain-up" : ""}`}
    >
      <div className="w-[min(88vw,560px)]">
        <RouteScene className="h-auto w-full" speed={1.6} />
      </div>
      <div className="mt-2 flex items-baseline gap-3">
        <span className="mopik-wordmark text-4xl font-bold tracking-tight text-stone-900 md:text-5xl">Mopik<span className="text-[#f56300]">.</span></span>
      </div>
      <p className="mopik-tagline mt-3 text-sm text-stone-500">Mazāk plānošanas. Vairāk braukšanas.</p>
    </div>
  );
}
