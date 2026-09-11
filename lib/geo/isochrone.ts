import {
  bearingDegrees,
  haversineMeters,
  pointInRing,
  ringAreaM2,
  sampleByDistance,
  type Point,
} from "./geometry";
import type { IsochroneFeatureProperties } from "@/lib/routing/valhalla";

/**
 * Turning a reachability contour into loop anchor directions.
 *
 * The point of using an isochrone rather than a circle is that its boundary
 * is computed with the same motorcycle costing as the route, so it follows
 * the road network: every sample sits on or beside routable road, and the
 * far side of a slow gravel region is correctly nearer than the far side of
 * a fast highway. A geometric circle knows none of that, which is why purely
 * geometric anchors produce loops that double back on themselves.
 */

export type IsoRing = {
  contour: number;
  /** exterior ring, [lon, lat], closed */
  coordinates: Point[];
  /** interior rings (unreachable holes) of the same polygon */
  holes: Point[][];
  areaM2: number;
};

export type Anchor = {
  point: Point;
  bearingDeg: number;
  radiusMeters: number;
};

/** Anchors are sampled along the ring at roughly this spacing. */
const SAMPLE_SPACING_M = 2000;

/**
 * Reject samples closer than this share of the ring's median radius: they are
 * thin tendrils reaching back toward the start along one fast road, and an
 * anchor there produces a hairpin rather than a loop.
 */
const MIN_RADIUS_SHARE = 0.25;

type IsochroneCollection = GeoJSON.FeatureCollection<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  IsochroneFeatureProperties
>;

/**
 * Parse an isochrone response into rings, largest area first per contour.
 *
 * Features come back sorted largest-value-first and one interval can emit
 * several features, so rings are grouped by `properties.contour` — never by
 * array position.
 */
export function parseIsochrone(fc: IsochroneCollection): Map<number, IsoRing[]> {
  const byContour = new Map<number, IsoRing[]>();

  for (const feature of fc.features ?? []) {
    const contour = feature.properties?.contour;
    if (contour === undefined) continue;

    const polygons: Point[][][] =
      feature.geometry.type === "Polygon"
        ? [feature.geometry.coordinates as Point[][]]
        : (feature.geometry.coordinates as Point[][][]);

    for (const rings of polygons) {
      if (rings.length === 0) continue;
      const exterior = rings[0];
      if (exterior.length < 4) continue;

      const ring: IsoRing = {
        contour,
        coordinates: exterior,
        holes: rings.slice(1),
        areaM2: Math.abs(ringAreaM2(exterior)),
      };
      const bucket = byContour.get(contour);
      if (bucket) bucket.push(ring);
      else byContour.set(contour, [ring]);
    }
  }

  for (const rings of byContour.values()) {
    rings.sort((a, b) => b.areaM2 - a.areaM2);
  }
  return byContour;
}

/**
 * Candidate anchor directions along a ring.
 *
 * Sampled by arc length rather than by vertex: marching-squares output is
 * dense along crinkly boundary (shoreline, bog edges) and sparse along
 * straight boundary, so taking raw vertices would crowd anchors onto exactly
 * the terrain a rider can't cross.
 */
export function ringAnchors(ring: IsoRing, start: { lat: number; lon: number }): Anchor[] {
  const origin: Point = [start.lon, start.lat];
  const samples = sampleByDistance(ring.coordinates, SAMPLE_SPACING_M);

  const candidates = samples
    .filter((p) => !ring.holes.some((hole) => pointInRing(p, hole)))
    .map((point) => ({
      point,
      bearingDeg: bearingDegrees(origin, point),
      radiusMeters: haversineMeters(origin, point),
    }));

  if (candidates.length === 0) return [];

  const radii = candidates.map((c) => c.radiusMeters).sort((a, b) => a - b);
  const median = radii[Math.floor(radii.length / 2)];
  const minRadius = median * MIN_RADIUS_SHARE;

  return candidates.filter((c) => c.radiusMeters >= minRadius);
}

/** The anchor whose bearing is closest to `bearingDeg`, or null if none. */
export function anchorNearestBearing(
  anchors: Anchor[],
  bearingDeg: number
): Anchor | null {
  let best: Anchor | null = null;
  let bestDiff = Infinity;
  for (const anchor of anchors) {
    const diff = Math.abs(((anchor.bearingDeg - bearingDeg + 540) % 360) - 180);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = anchor;
    }
  }
  return best;
}
