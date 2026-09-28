import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";

/**
 * Drawn geometry: a straight line the rider asked for where no road goes
 * (docs/DESIGN-route-editing.md, Phase 2's „Savienot taisni” / `reach:
 * "straight"`; rider, 2026-09-28: „ja braucējam tiešām vajag to punktu
 * kartē, lai tā būtu”). Ridden exactly as drawn, never re-routed, never
 * checked — Mopik has not seen whether it can be ridden or whether it is
 * allowed, and every surface says so.
 *
 * Its features carry `roadClass: "trail"`, `surface: "unknown"` and `drawn:
 * true` — the most conservative class for any consumer that does not know
 * `drawn` yet; every one that does checks `drawn` first (the speed, the
 * summary, the map's class layers and badges, the share code, the GPX).
 */

/** The speed drawn metres are timed at, km/h — stated wherever the time is. */
export const DRAWN_KMH = 15;

/** The longest step between two vertices of drawn geometry, metres (so a GPX follows it, not a chord). */
export const DENSIFY_M = 50;

/** `line` with a vertex at least every `maxStepM` metres, ends and corners kept. */
export function densify(line: Point[], maxStepM = DENSIFY_M): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    if (i === 0) { out.push(p); continue; }
    const a = line[i - 1];
    const steps = Math.ceil(haversineMeters(a, p) / maxStepM);
    for (let k = 1; k < steps; k++) out.push([a[0] + ((p[0] - a[0]) * k) / steps, a[1] + ((p[1] - a[1]) * k) / steps]);
    out.push(p);
  }
  return out;
}

type Feature = GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>;

/** A drawn feature along `line` (densified). */
export function drawnFeature(line: Point[]): Feature {
  const coordinates = densify(line);
  let meters = 0;
  for (let i = 1; i < coordinates.length; i++) meters += haversineMeters(coordinates[i - 1], coordinates[i]);
  return {
    type: "Feature",
    geometry: { type: "LineString", coordinates },
    properties: { roadClass: "trail", surface: "unknown", drawn: true, distanceMeters: Math.round(meters) },
  };
}

/** The straight connector from `from` to `to`, as a drawn feature. */
export function connector(from: Point, to: Point): Feature {
  return drawnFeature([from, to]);
}

/** Seconds to ride `meters` of drawn geometry. */
export function drawnSeconds(meters: number): number {
  return Math.round((meters / 1000 / DRAWN_KMH) * 3600);
}

/** Drawn metres in a collection. */
export function drawnMeters(features: { properties: RouteSegmentProperties }[]): number {
  return features.reduce((s, f) => s + (f.properties.drawn ? f.properties.distanceMeters : 0), 0);
}
