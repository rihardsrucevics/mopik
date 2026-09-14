"use client";

import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Places the rider has picked before, newest first.
 *
 * Most riding starts from the same few places — home, the usual meeting point,
 * the cabin — and typing them out every time is work the app can save. An
 * empty field now offers them straight away, so the common case is one tap
 * rather than four letters and a wait for the geocoder.
 *
 * Stored with coordinates, like a picked place, so choosing one is exactly as
 * good as choosing it from the search: the ride is built on the place the
 * rider meant, not on whatever the name geocodes to today.
 *
 * On the device only, like the saved rides and the profile. Nothing about
 * where somebody rides belongs on a server we do not need.
 */
const KEY = "mopik.recentPlaces.v1";
const MAX = 6;

export type RecentPlace = ResolvedPlace & { usedAt: number };

/**
 * Latvian kind words that older builds baked into a place's `label` before
 * the API started answering with a machine kind.
 *
 * A label is stored on the device and read back whenever the rider opens a
 * field — including after they switch the interface to English — so a place
 * saved in 2026-09 would otherwise keep showing "· adrese ·" in every
 * language for as long as it stays in the list. Stripped on read rather than
 * migrated in place: reading is where the damage shows, and a rider who never
 * opens the app again has nothing to migrate.
 */
const LEGACY_KIND_WORDS = new Set([
  "adrese", "vieta", "degviela", "uzlāde", "ēstuve", "kafejnīca", "stāvvieta",
  "naktsmītne", "kempings", "apskates vieta", "skatu punkts", "muzejs", "pils",
  "drupas", "muiža", "piemineklis", "kalns", "pludmale", "ūdens", "ūdenskritums",
  "dabas liegums", "nacionālais parks", "aizsargājama teritorija", "pilskalns",
  "cietoksnis", "baznīca", "piemiņas vieta", "objekts", "ala", "klints", "avots",
  "parks",
]);

/** "Siguldas prospekts · adrese · Rīga" → "Siguldas prospekts · Rīga". */
function stripLegacyKind(label: string): string {
  const parts = label.split(" · ");
  if (parts.length < 2) return label;
  // Only the kind segment goes: a place genuinely *called* "Parks" is the
  // first segment, which is the name and is never dropped.
  const kept = [parts[0], ...parts.slice(1).filter((p) => !LEGACY_KIND_WORDS.has(p))];
  return kept.join(" · ");
}

function read(): RecentPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentPlace[]) : [];
    return Array.isArray(list)
      ? list
          .filter((p) => p && typeof p.name === "string" && typeof p.lat === "number")
          .map((p) => (typeof p.label === "string" ? { ...p, label: stripLegacyKind(p.label) } : p))
      : [];
  } catch {
    return [];
  }
}

export function listRecentPlaces(): RecentPlace[] {
  return read().sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)).slice(0, MAX);
}

/**
 * The list as an external store, so a field can render it without reading
 * `localStorage` during render (a hydration mismatch) or writing state from a
 * mount effect (a cascading render).
 *
 * `useSyncExternalStore` compares snapshots by identity, so the cached array
 * has to be the *same* array until something actually changes — rebuilding it
 * on every read would spin forever. `rememberPlace` is the only writer, and
 * it clears the cache; `refreshRecentPlaces` covers a write from another tab
 * or another component instance.
 */
let cached: RecentPlace[] | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): RecentPlace[] {
  if (!cached) cached = listRecentPlaces();
  return cached;
}

/** The server has no storage, and this must be one stable empty array. */
const EMPTY: RecentPlace[] = [];
const serverSnapshot = (): RecentPlace[] => EMPTY;

/**
 * Re-read the device and tell every field about it. A field used to do this
 * on focus, because a mount-only read went stale the moment a place was
 * picked in *another* field — the rider saved Sigulda in "From", opened "To",
 * and was offered nothing. Now every write publishes to every field, and the
 * focus re-read is only a safety net for a change made in another tab.
 */
export function refreshRecentPlaces(): void {
  cached = null;
  for (const listener of listeners) listener();
}

export const recentPlacesStore = { subscribe, snapshot, serverSnapshot };

/**
 * A name that is really just the coordinates the browser handed us.
 *
 * "Mana atrašanās vieta" resolves through `reverseGeocode`, which returns null
 * when the point has no name at any administrative level — mid-forest, at sea,
 * or when Photon is simply down. The form still fills the field, with
 * "56.9496, 24.1052", so the rider can generate from where they are standing.
 *
 * That is a fine thing to *ride* from and a useless thing to *remember*: a
 * recent place has to work later, from the sofa, with no GPS, and a row of
 * digits tells the rider nothing about where it was. So it is refused here
 * rather than at the call site — `rememberPlace` is the only writer, and the
 * rule should hold no matter who calls it.
 */
function isCoordinateName(name: string): boolean {
  return /^\s*-?\d{1,3}(\.\d+)?\s*,\s*-?\d{1,3}(\.\d+)?\s*$/.test(name);
}

/**
 * Is this place worth keeping? A real name, real coordinates — the two things
 * that make an entry usable months later without the GPS that produced it.
 */
export function isRememberable(place: ResolvedPlace | null | undefined): place is ResolvedPlace {
  if (!place) return false;
  if (typeof place.name !== "string" || !place.name.trim()) return false;
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return false;
  return !isCoordinateName(place.name);
}

/**
 * Remember a place the rider picked.
 *
 * Keyed on coordinates rounded to ~10 m rather than on the name: "Rīga" the
 * city and "Rīga" a street are different places with the same word, and two
 * entries that read identically in a list are worse than none.
 *
 * Called from every path that resolves a place to a point — the suggestion
 * dropdown and the "Mana atrašanās vieta" crosshair alike. The crosshair used
 * to be the exception, and the rider noticed: a place found by GPS was the one
 * kind of place the app forgot.
 */
export function rememberPlace(place: ResolvedPlace): void {
  if (!isRememberable(place)) return;
  try {
    const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const existing = read();
    // Already the newest entry, with the same name: re-storing it would only
    // move `usedAt`, publish to every field and re-render them for nothing.
    // Tapping the crosshair twice from the same spot is exactly this case.
    const newest = existing.sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))[0];
    if (newest && key(newest) === key(place) && newest.name === place.name) return;
    const next = [
      { ...place, usedAt: Date.now() },
      ...existing.filter((p) => key(p) !== key(place)),
    ].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    refreshRecentPlaces();
  } catch {
    // Private window or full storage: the convenience is simply absent.
  }
}
