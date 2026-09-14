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

function read(): RecentPlace[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentPlace[]) : [];
    return Array.isArray(list)
      ? list.filter((p) => p && typeof p.name === "string" && typeof p.lat === "number")
      : [];
  } catch {
    return [];
  }
}

export function listRecentPlaces(): RecentPlace[] {
  return read().sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0)).slice(0, MAX);
}

/**
 * Remember a place the rider picked.
 *
 * Keyed on coordinates rounded to ~10 m rather than on the name: "Rīga" the
 * city and "Rīga" a street are different places with the same word, and two
 * entries that read identically in a list are worse than none.
 */
export function rememberPlace(place: ResolvedPlace): void {
  try {
    const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
    const next = [
      { ...place, usedAt: Date.now() },
      ...read().filter((p) => key(p) !== key(place)),
    ].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private window or full storage: the convenience is simply absent.
  }
}
