"use client";

import { useSyncExternalStore } from "react";

/**
 * A CSS media query as a boolean, for the rare case where `md:hidden` will not
 * do: moving one element between two containers.
 *
 * The map is the reason this exists. On a phone it belongs inside the ride
 * block, under the places it confirms; on a desktop it is the sticky right
 * column. Rendering it in both places and hiding one with CSS would create two
 * MapLibre instances — two WebGL contexts, two tile budgets, and the hidden one
 * sized zero — so exactly one is rendered and this decides where.
 *
 * `useSyncExternalStore` rather than an effect: the server has no viewport, so
 * the server snapshot is `false` (the phone layout) and the first client render
 * already has the real answer, with no flash of the wrong placement.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Tailwind's `md` breakpoint, the one the layout switches on. */
export const DESKTOP_QUERY = "(min-width: 768px)";
