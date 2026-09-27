import { useSyncExternalStore } from "react";

/**
 * Whether the map is full screen — one value for the whole page, not a
 * MapPanel's own state (rider, 2026-09-25).
 *
 * On a phone the inline map is a preview: nothing is edited on it, and every
 * action that needs the map — a row's pin button, "+ Pietura" when it goes to
 * the map, „Labot” — opens it full screen first. Those actions live outside
 * MapPanel, and „Labot” even moves the map to another parent, which remounts
 * MapPanel; a `useState` there lost the request on the way. Held here, the
 * request survives the remount, and the caller needs no ref.
 *
 * `openMapFullscreen` is a no-op from `md` up, where the map already fills its
 * column and there is no full-screen mode.
 */
const PHONE_QUERY = "(max-width: 767px)";

let open = false;
let mounted = 0;
const listeners = new Set<() => void>();

export function setMapFullscreen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const l of listeners) l();
}

export function openMapFullscreen() {
  if (typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches) setMapFullscreen(true);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export function useMapFullscreen(): boolean {
  return useSyncExternalStore(subscribe, () => open, () => false);
}

/**
 * MapPanel's mount, counted: when the last panel goes (the map hidden, the
 * page left) full screen ends with it — but not while one panel replaces
 * another in the same commit, which is exactly the „Labot” move.
 */
export function mapPanelMounted(): () => void {
  mounted += 1;
  return () => {
    mounted -= 1;
    queueMicrotask(() => { if (mounted === 0) setMapFullscreen(false); });
  };
}

/**
 * How many marks wait for ✓ on the map — published by the map, read by the
 * collapsed preview's chip (rider, 2026-09-27). Collapsing full screen with
 * something pending only minimises the map: the pending state lives in the
 * composer and survives, and the chip says it is there („Atvērt karti · 2
 * neapstiprinātas”), so nothing is lost silently.
 */
let pendingCount = 0;
const pendingListeners = new Set<() => void>();

export function setMapPendingCount(n: number) {
  const next = Math.max(0, Math.floor(n));
  if (next === pendingCount) return;
  pendingCount = next;
  for (const l of pendingListeners) l();
}

export function useMapPendingCount(): number {
  return useSyncExternalStore(
    (l) => { pendingListeners.add(l); return () => { pendingListeners.delete(l); }; },
    () => pendingCount,
    () => 0,
  );
}
