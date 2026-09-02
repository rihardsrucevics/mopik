import fs from "fs";
import path from "path";

/**
 * TET (Trans Euro Trail) Latvia support.
 *
 * The TET is a community-maintained network of legal-to-ride adventure roads,
 * so "ride a part of the TET near town X" is a first-class request. We keep
 * the official GPX (downsampled) as GeoJSON in /public/tet-lv.geojson — the
 * same file the map overlay uses.
 *
 * The free GraphHopper plan allows max 5 route points, so we can't follow the
 * TET point-by-point. Instead we pick a slice of the nearest TET section and
 * hand GraphHopper 3 via points along it — the TET runs on routable roads, so
 * the calculated route follows it closely between via points.
 */

type TetSection = {
  name: string;
  lengthKm: number;
  coordinates: [number, number][]; // [lon, lat]
  /** cumulative distance in meters at each coordinate */
  cumulative: number[];
};

let sectionsCache: TetSection[] | null = null;

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function loadTetSections(): TetSection[] {
  if (sectionsCache) return sectionsCache;

  const file = path.join(process.cwd(), "public", "tet-lv.geojson");
  const fc = JSON.parse(fs.readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection<
    GeoJSON.LineString,
    { name: string; lengthKm: number }
  >;

  sectionsCache = fc.features.map((f) => {
    const coordinates = f.geometry.coordinates as [number, number][];
    const cumulative = [0];
    for (let i = 1; i < coordinates.length; i++) {
      cumulative.push(cumulative[i - 1] + haversineMeters(coordinates[i - 1], coordinates[i]));
    }
    return {
      name: f.properties.name,
      lengthKm: f.properties.lengthKm,
      coordinates,
      cumulative,
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

/** index of the coordinate that lies `meters` along the section from `fromIndex` (can be negative). */
function indexAtOffset(section: TetSection, fromIndex: number, meters: number): number {
  const target = section.cumulative[fromIndex] + meters;
  if (target <= 0) return 0;
  const last = section.cumulative.length - 1;
  if (target >= section.cumulative[last]) return last;
  let lo = 0,
    hi = last;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (section.cumulative[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export type TetSlice = {
  sectionName: string;
  viaPoints: [number, number][]; // 3 points, [lon, lat]
  sliceKm: number;
  entryDistanceKm: number;
};

/**
 * Pick a TET slice near `start` worth roughly `targetSliceMeters` of riding,
 * and sample 3 via points along it. `variant` (0/1/2) shifts the slice:
 * forward along the section, backward, or centered — this is what makes the
 * three route alternatives genuinely different.
 */
export function pickTetSlice(
  start: { lat: number; lon: number },
  targetSliceMeters: number,
  variant: 0 | 1 | 2
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

  const from = bestNearest.index;
  let startIdx: number, endIdx: number;
  if (variant === 0) {
    startIdx = from;
    endIdx = indexAtOffset(bestSection, from, targetSliceMeters);
  } else if (variant === 1) {
    startIdx = indexAtOffset(bestSection, from, -targetSliceMeters);
    endIdx = from;
  } else {
    startIdx = indexAtOffset(bestSection, from, -targetSliceMeters / 2);
    endIdx = indexAtOffset(bestSection, from, targetSliceMeters / 2);
  }
  if (endIdx - startIdx < 4) return null;

  const sliceMeters =
    bestSection.cumulative[endIdx] - bestSection.cumulative[startIdx];

  // 3 evenly spaced via points across the slice
  const viaPoints: [number, number][] = [0.1, 0.5, 0.9].map((t) => {
    const idx = indexAtOffset(
      bestSection,
      startIdx,
      sliceMeters * t
    );
    return bestSection.coordinates[idx];
  });

  return {
    sectionName: bestSection.name,
    viaPoints,
    sliceKm: Math.round(sliceMeters / 100) / 10,
    entryDistanceKm: Math.round(bestNearest.distMeters / 100) / 10,
  };
}
