import fs from "fs";
import path from "path";
import { cumulativeDistances, haversineMeters, indexAtOffset } from "@/lib/geo/geometry";

/**
 * TET (Trans Euro Trail) Latvia support.
 *
 * The TET is a community-maintained network of legal-to-ride adventure roads,
 * so "ride a part of the TET near town X" is a first-class request. We keep
 * the official GPX (downsampled) as GeoJSON in /public/tet-lv.geojson — the
 * same file the map overlay uses.
 *
 * We pick a slice of the nearest TET section and hand the router via points
 * sampled along it — the TET runs on routable roads, so the calculated route
 * follows it closely between via points. Valhalla accepts up to 50 locations,
 * so the slice can be sampled densely enough to track the trail faithfully.
 */

type TetSection = {
  name: string;
  lengthKm: number;
  coordinates: [number, number][]; // [lon, lat]
  /** cumulative distance in meters at each coordinate */
  cumulative: number[];
};

let sectionsCache: TetSection[] | null = null;

export function loadTetSections(): TetSection[] {
  if (sectionsCache) return sectionsCache;

  const file = path.join(process.cwd(), "public", "tet-lv.geojson");
  const fc = JSON.parse(fs.readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection<
    GeoJSON.LineString,
    { name: string; lengthKm: number }
  >;

  sectionsCache = fc.features.map((f) => {
    const coordinates = f.geometry.coordinates as [number, number][];
    return {
      name: f.properties.name,
      lengthKm: f.properties.lengthKm,
      coordinates,
      cumulative: cumulativeDistances(coordinates),
    };
  });
  return sectionsCache;
}

function nearestOnSection(
  section: TetSection,
  point: { lat: number; lon: number }
): { index: number; distMeters: number } {
  let best = { index: 0, distMeters: Infinity };
  // coordinates are ~80-150m apart; checking every 3rd point is plenty
  for (let i = 0; i < section.coordinates.length; i += 3) {
    const d = haversineMeters(section.coordinates[i], [point.lon, point.lat]);
    if (d < best.distMeters) best = { index: i, distMeters: d };
  }
  return best;
}

export type TetSlice = {
  sectionName: string;
  viaPoints: [number, number][]; // [lon, lat]
  sliceKm: number;
  entryDistanceKm: number;
};

/** Via points sampled along a TET slice. Valhalla allows 50 locations total. */
const DEFAULT_VIA_COUNT = 18;

/**
 * Pick a TET slice near `start` worth roughly `targetSliceMeters` of riding,
 * and sample via points along it. `variant` (0/1/2) shifts the slice:
 * forward along the section, backward, or centered — this is what makes the
 * three route alternatives genuinely different.
 */
/**
 * Roads wind: the ride to the trail and the ride back from its far end run
 * this much longer than the straight line.
 */
const APPROACH_DETOUR = 1.6;

/**
 * A TET slice sized so the WHOLE ride — riding to the trail, the slice, and
 * riding home from its far end — lands near `targetMeters`.
 *
 * The TET is a linear trail, so a "loop" along it is really out along the
 * trail and back by road. Sizing the slice alone at 0.8× target ignored the
 * way home: from Kuldīga a 120 km slice ended 82 km straight-line from the
 * start, the closing leg routed to 115 km, and a 150 km request delivered
 * 334-401 km. Here the slice shrinks until entry + slice + return fits.
 */
export function pickTetSliceForRide(
  start: { lat: number; lon: number },
  targetMeters: number,
  variant: 0 | 1 | 2,
  viaCount: number = DEFAULT_VIA_COUNT,
  roundTrip: boolean = true
): TetSlice | null {
  const origin: [number, number] = [start.lon, start.lat];
  let best: TetSlice | null = null;
  for (const share of [0.8, 0.65, 0.5, 0.4, 0.3, 0.22, 0.15]) {
    const slice = pickTetSlice(start, targetMeters * share, variant, viaCount);
    if (!slice) continue;
    const first = slice.viaPoints[0];
    const last = slice.viaPoints[slice.viaPoints.length - 1];
    const entry = haversineMeters(origin, first) * APPROACH_DETOUR;
    const back = roundTrip ? haversineMeters(last, origin) * APPROACH_DETOUR : 0;
    const estimate = entry + slice.sliceKm * 1000 + back;
    best = slice;
    if (estimate <= targetMeters) return slice;
  }
  return best;
}

export function pickTetSlice(
  start: { lat: number; lon: number },
  targetSliceMeters: number,
  variant: 0 | 1 | 2,
  viaCount: number = DEFAULT_VIA_COUNT
): TetSlice | null {
  const sections = loadTetSections();

  let bestSection: TetSection | null = null;
  let bestNearest = { index: 0, distMeters: Infinity };
  for (const s of sections) {
    const n = nearestOnSection(s, start);
    if (n.distMeters < bestNearest.distMeters) {
      bestNearest = n;
      bestSection = s;
    }
  }
  if (!bestSection) return null;

  const { cumulative, coordinates } = bestSection;
  const from = bestNearest.index;
  let startIdx: number, endIdx: number;
  if (variant === 0) {
    startIdx = from;
    endIdx = indexAtOffset(cumulative, from, targetSliceMeters);
  } else if (variant === 1) {
    startIdx = indexAtOffset(cumulative, from, -targetSliceMeters);
    endIdx = from;
  } else {
    startIdx = indexAtOffset(cumulative, from, -targetSliceMeters / 2);
    endIdx = indexAtOffset(cumulative, from, targetSliceMeters / 2);
  }
  if (endIdx - startIdx < 4) return null;

  const sliceMeters = cumulative[endIdx] - cumulative[startIdx];

  // Evenly spaced via points across the slice, inset from both ends so the
  // router approaches the trail rather than starting exactly on it.
  const count = Math.max(2, Math.min(viaCount, endIdx - startIdx));
  const viaPoints: [number, number][] = Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    return coordinates[indexAtOffset(cumulative, startIdx, sliceMeters * t)];
  });

  return {
    sectionName: bestSection.name,
    viaPoints,
    sliceKm: Math.round(sliceMeters / 100) / 10,
    entryDistanceKm: Math.round(bestNearest.distMeters / 100) / 10,
  };
}
