import type { Point } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";
import { cumulative, lineMeters } from "@/lib/routing/detour";
import { nearestAlong, segmentsBetween } from "@/lib/routing/reroute-leg";
import { newStretches } from "@/lib/map/proposal-view";

/**
 * What an edit that asks the ride to go somewhere is allowed to answer
 * (rider, 2026-09-28):
 *
 * 1. Whenever any road reaches the point, offer a solution — never a bare
 *    refusal.
 * 2. When only roads outside his profile reach it, the solution is routed on
 *    the least relaxed profile that does (`relaxedProfiles`), its new metres
 *    are marked ⚠️ outside the profile, and it waits for „Tomēr braukt”.
 * 3. When no road reaches it at all: „Šeit nevar izbraukt – tuvākais ceļš
 *    ir ~N m nostāk.”, ✓ disabled.
 * 4. A solution that lengthens the ride a lot or wanders far says so with
 *    numbers and waits for „Tomēr braukt” — never refused for it.
 * 5. Every solution is logical: no spurs, no loops for nothing — a bend
 *    that comes back no nearer the drop is not a solution (`bendMissed`).
 * 6. Every accepted override is one ↶ step (it is committed like ✓).
 *
 * The pure half lives here so the page and the measurements decide alike.
 */

type Segments = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;

/**
 * The new metres of a stretch routed on a relaxed profile, marked
 * `outsideProfile` — the map's ⚠️ and the segment card say so. Road the ride
 * already had (within `newStretches`' tolerance) is not marked: the rider's
 * profile rode it. A feature that is partly new is cut where the new road
 * begins and ends, so exactly the new metres carry the mark.
 */
export function markOutsideProfile(segments: Segments, ride: Point[]): { segments: Segments; meters: number } {
  let meters = 0;
  const features: Segments["features"] = [];
  for (const f of segments.features) {
    const coords = f.geometry.coordinates as Point[];
    const own = lineMeters(coords);
    const fresh = own > 0 ? newStretches(coords, ride).filter(([a, b]) => b - a >= 1) : [];
    if (!fresh.length) { features.push(f); continue; }
    // Cut as `segmentsBetween` cuts: each piece keeps the road's class and
    // surface, and the gates that stand on it.
    const piece = (from: number, to: number, outside: boolean) => {
      if (to - from < 1) return;
      for (const part of segmentsBetween([f], from, to)) {
        const m = lineMeters(part.geometry.coordinates as Point[]);
        if (outside) meters += m;
        features.push(outside ? { ...part, properties: { ...part.properties, outsideProfile: true } } : part);
      }
    };
    let at = 0;
    for (const [a, b] of fresh) { piece(at, a, false); piece(a, b, true); at = b; }
    piece(at, own, false);
  }
  return { segments: { ...segments, features }, meters };
}

/** The farthest any point of `stretch` lies from `ride`, metres. */
export function farthestFrom(stretch: Point[], ride: Point[]): number {
  if (ride.length < 2) return 0;
  const cum = cumulative(ride);
  let far = 0;
  for (const p of stretch) far = Math.max(far, nearestAlong(p, ride, cum).meters);
  return far;
}

/**
 * A detour worth the rider's say-so (rule 4): the ride longer by more than
 * `DETOUR_KM` or `DETOUR_SHARE`, or the new line farther than `WANDER_M` —
 * and more than `WANDER_PER_REACH` times as far as the point itself was from
 * the ride — from the line it had.
 */
export const DETOUR_KM = 10;
export const DETOUR_SHARE = 0.2;
export const WANDER_M = 2_000;
export const WANDER_PER_REACH = 4;

export function detourRisk(p: { metersBefore: number; metersAfter: number; farthestM: number; reachM: number }): { plusMeters: number; farthestM: number } | null {
  const plus = p.metersAfter - p.metersBefore;
  const long = plus > DETOUR_KM * 1000 || plus > DETOUR_SHARE * p.metersBefore;
  const wanders = p.farthestM > WANDER_M && p.farthestM > WANDER_PER_REACH * p.reachM;
  return long || wanders ? { plusMeters: plus, farthestM: p.farthestM } : null;
}

/** How far each changed place lies from `line` — the largest, metres (0 when none). */
export function reachOf(points: Point[], line: Point[]): number {
  if (!points.length || line.length < 2) return 0;
  const cum = cumulative(line);
  return Math.max(...points.map((p) => nearestAlong(p, line, cum).meters));
}
