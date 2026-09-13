"use client";

import { encodeRouteShare, decodeRouteShare, type SharedRoute } from "@/lib/share/route-code";
import type { ResolvedPlace } from "@/lib/chat/places";
import type { GeneratedRoute } from "@/lib/types";
import type { RidePlan } from "@/lib/chat/ride-plan";

/**
 * An id for a saved ride. The first 24 characters of a share code are the
 * metadata prefix, which is identical for the three versions of one request —
 * using them as the id meant saving the winding version silently replaced the
 * straight one. Hash the whole code instead.
 */
export function rideId(code: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < code.length; i++) {
    h1 = Math.imul(h1 ^ code.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 + code.charCodeAt(i), 0x85ebca6b) ^ (h2 >>> 13);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

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
  /** "shared" when it arrived as someone else's link. */
  from?: "shared";
  /**
   * The other versions of the same request, as their own share codes. Saving
   * keeps all three, so a rider who liked the ride but wants the straighter
   * version of it does not have to spend another generation to get it back.
   */
  alternatives?: { code: string; name: string; km: number; minutes: number; unpavedPercent: number; variant: string }[];
  /** What was asked for, so the list reads like a history of requests. */
  prompt?: string;
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

/**
 * Save a ride that arrived as a link — someone else's route, decoded from
 * `/r/<code>`. Same store, same list, same id rule as a ride of one's own;
 * `from` marks where it came from so the list can say so.
 */
export function saveSharedRide(code: string, share: { name: string; km: number; minutes: number; unpavedPercent: number; variant: string }): SavedRide {
  const entry: SavedRide = {
    id: rideId(code),
    code,
    name: share.name,
    km: share.km,
    minutes: share.minutes,
    unpavedPercent: share.unpavedPercent,
    variant: share.variant,
    savedAt: Date.now(),
    from: "shared",
  };
  write([entry, ...read().filter((r) => r.id !== entry.id)]);
  return entry;
}

export function isCodeSaved(code: string): boolean {
  const id = rideId(code);
  return read().some((r) => r.id === id);
}

/** The id is the route's own code, so saving the same ride twice is one entry. */
export function saveRide(route: GeneratedRoute, startLabel: string, plan: RidePlan | null, context?: { alternatives?: GeneratedRoute[]; prompt?: string; places?: ResolvedPlace[] | null }): SavedRide {
  const code = encodeRouteShare(route, startLabel, plan, context?.places);
  const alternatives = (context?.alternatives ?? [])
    .filter((r) => r.id !== route.id)
    .map((r) => ({
      code: encodeRouteShare(r, startLabel, plan, context?.places),
      name: r.name, km: Math.round(r.distanceMeters / 1000), minutes: Math.round(r.durationSeconds / 60),
      unpavedPercent: r.surfaces.gravelPercent + r.surfaces.dirtPercent, variant: r.variant,
    }));
  const entry: SavedRide = {
    id: rideId(code),
    code,
    name: route.name,
    km: Math.round(route.distanceMeters / 1000),
    minutes: Math.round(route.durationSeconds / 60),
    unpavedPercent: route.surfaces.gravelPercent + route.surfaces.dirtPercent,
    variant: route.variant,
    savedAt: Date.now(),
    ...(alternatives.length ? { alternatives } : {}),
    ...(context?.prompt ? { prompt: context.prompt } : {}),
  };
  write([entry, ...read().filter((r) => r.id !== entry.id)]);
  return entry;
}

export function removeRide(id: string): void {
  write(read().filter((r) => r.id !== id));
}

export function isSaved(route: GeneratedRoute, startLabel: string, plan: RidePlan | null, places?: ResolvedPlace[] | null): boolean {
  return isCodeSaved(encodeRouteShare(route, startLabel, plan, places));
}

export function decodeSaved(ride: SavedRide): SharedRoute | null {
  return decodeRouteShare(ride.code);
}
