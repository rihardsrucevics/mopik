"use client";

import { useSyncExternalStore } from "react";

/**
 * Which of the map's optional layers the rider wants, remembered on the device.
 *
 * Both switches used to be plain `useState(false)` in the two pages that own a
 * map, which meant the rider re-flipped TET on every visit and would have had
 * to re-flip the sights too. The rider asked for the new one to be remembered
 * "like the TET toggle does" — TET did not actually remember anything, so the
 * honest way to mirror it was to give both the same store.
 *
 * `useSyncExternalStore`, the same shape as `use-locale`: `localStorage` is
 * nothing on the server, so reading it during render is a hydration mismatch
 * and writing it from an effect costs a second render pass with the wrong
 * layer visible for a frame. The server snapshot is the default, the client
 * swaps in the stored answer on the first commit.
 *
 * One key per layer rather than one JSON blob: a layer added later must not be
 * able to invalidate the answer the rider already gave about this one.
 */
export type MapLayer = "tet" | "sights";

const KEYS: Record<MapLayer, string> = {
  tet: "mopik.map.tet.v1",
  // The sights layer is on by default — the rider asked for it to show what is
  // around the ride without being asked. Only an explicit "off" is stored, and
  // `snapshot` reads the absence of a value as the default rather than as off.
  sights: "mopik.map.sights.v1",
};

/** What each layer does before the rider has ever said anything about it. */
const DEFAULTS: Record<MapLayer, boolean> = { tet: false, sights: true };

const current: Partial<Record<MapLayer, boolean>> = {};
const listeners = new Set<() => void>();

function snapshot(layer: MapLayer): boolean {
  const held = current[layer];
  if (held !== undefined) return held;
  let stored: string | null = null;
  try {
    stored = typeof window !== "undefined" ? window.localStorage.getItem(KEYS[layer]) : null;
  } catch {
    // Private windows and blocked site data throw rather than return null.
  }
  const value = stored === "1" ? true : stored === "0" ? false : DEFAULTS[layer];
  current[layer] = value;
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setMapLayer(layer: MapLayer, visible: boolean): void {
  current[layer] = visible;
  try {
    window.localStorage.setItem(KEYS[layer], visible ? "1" : "0");
  } catch {
    // A switch that does not persist is still better than a crash.
  }
  for (const listener of listeners) listener();
}

/**
 * One layer's switch: its current value and a setter that also stores it.
 *
 * Returned as a tuple in the order `useState` uses, so a page that had
 * `const [showTet, setShowTet] = useState(false)` changes one line.
 */
export function useMapLayer(layer: MapLayer): [boolean, (visible: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => snapshot(layer),
    () => DEFAULTS[layer],
  );
  return [value, (visible: boolean) => setMapLayer(layer, visible)];
}
