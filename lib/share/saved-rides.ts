"use client";

import { encodeRouteShare, decodeRouteShare, type SharedRoute } from "@/lib/share/route-code";
import type { GeneratedRoute } from "@/lib/types";
import type { RidePlan } from "@/lib/chat/ride-plan";

/**
 * "Saglabāt vēlākam" — rides kept on this device, nothing on a server.
 *
 * A saved ride is the same self-contained share code the link uses, so a
 * saved ride can be reopened, shared, or exported without asking anything of
 * the network, and the format already survives version changes. localStorage
 * rather than cookies: cookies travel on every request and are capped near
 * 4 KB, which one route already exceeds.
 */
const KEY = "mopik.saved.v1";
const MAX = 30;

export type SavedRide = {
  id: string;
  code: string;
  name: string;
  km: number;
  minutes: number;
  unpavedPercent: number;
  variant: string;
  savedAt: number;
};

function read(): SavedRide[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as SavedRide[]) : [];
    return Array.isArray(list) ? list.filter((r) => r && typeof r.code === "string") : [];
  } catch {
    return [];
  }
}

function write(list: SavedRide[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event("mopik:saved-changed"));
  } catch {
    // Storage full or blocked (private window): saving is a convenience.
  }
}

export function listSaved(): SavedRide[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/** The id is the route's own code, so saving the same ride twice is one entry. */
export function saveRide(route: GeneratedRoute, startLabel: string, plan: RidePlan | null): SavedRide {
  const code = encodeRouteShare(route, startLabel, plan);
  const entry: SavedRide = {
    id: code.slice(0, 24),
    code,
    name: route.name,
    km: Math.round(route.distanceMeters / 1000),
    minutes: Math.round(route.durationSeconds / 60),
    unpavedPercent: route.surfaces.gravelPercent + route.surfaces.dirtPercent,
    variant: route.variant,
    savedAt: Date.now(),
  };
  write([entry, ...read().filter((r) => r.id !== entry.id)]);
  return entry;
}

export function removeRide(id: string): void {
  write(read().filter((r) => r.id !== id));
}

export function isSaved(route: GeneratedRoute, startLabel: string, plan: RidePlan | null): boolean {
  const id = encodeRouteShare(route, startLabel, plan).slice(0, 24);
  return read().some((r) => r.id === id);
}

export function decodeSaved(ride: SavedRide): SharedRoute | null {
  return decodeRouteShare(ride.code);
}
