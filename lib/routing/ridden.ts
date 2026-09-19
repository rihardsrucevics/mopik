import fs from "fs";
import path from "path";
import { cumulativeDistances, haversineMeters, indexAtOffset, type Point } from "@/lib/geo/geometry";
import { createTetMatcher } from "./tet-coverage";

/**
 * Roads the rider has ridden — backlog item 6's first concrete step.
 *
 * The rider handed over GPX of roads he has ridden and said, of all of them,
 * that they are rideable. This is that claim as a reference layer:
 * `scripts/build-ridden.ts` turns the GPX into /public/ridden.geojson (the
 * router's copy) and /public/ridden/<CC>.geojson (per country, like TET).
 *
 * **Global, not per-rider history.** One rider's knowledge that a forest track
 * is passable is worth exactly as much to the next rider planning through it,
 * and the layer is built and shipped the same way TET is. Nothing here knows
 * who rode anything.
 *
 * It plugs into the same three places TET does — data, candidate vias, and
 * coverage — and it is the third that carries the real weight. A stretch of
 * road the rider has ridden is **verified access**: better evidence that a
 * motorcycle may use it than a missing OSM tag is evidence that it may not.
 * See `measureRiddenCoverage` and its use in `lib/routing/classify.ts`.
 *
 * Shape deliberately mirrors `lib/routing/tet.ts`: same loader contract, same
 * slice picker, and the *same matcher* (`createTetMatcher`), which is plain
 * geometry despite its name — sustained aligned proximity, projected per area.
 * Sharing it rather than copying it means the two layers can never drift into
 * disagreeing about what "on this road" means.
 */

export type RiddenSection = {
  name: string;
  lengthKm: number;
  coordinates: Point[];
  /** cumulative distance in metres at each coordinate */
  cumulative: number[];
};

let sectionsCache: RiddenSection[] | null = null;
/** Distinguishes "not loaded yet" from "loaded, and there is nothing". */
let loadFailed = false;

export function loadRiddenSections(): RiddenSection[] {
  if (sectionsCache) return sectionsCache;
  if (loadFailed) return [];

  const file = path.join(process.cwd(), "public", "ridden.geojson");
  try {
    const fc = JSON.parse(fs.readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection<
      GeoJSON.LineString,
      { name: string; lengthKm: number; country?: string }
    >;
    sectionsCache = fc.features.map((f) => {
      const coordinates = f.geometry.coordinates as Point[];
      return {
        name: f.properties.name,
        lengthKm: f.properties.lengthKm,
        coordinates,
        cumulative: cumulativeDistances(coordinates),
      };
    });
    return sectionsCache;
  } catch {
    // An optional reference layer must never prevent planning a ride. Unlike
    // TET this file may genuinely be absent — it exists only where a rider has
    // contributed GPX — so this is an expected state, not an error.
    loadFailed = true;
    return [];
  }
}

/** Test seam: the module caches the file, and fixtures need a way in. */
export function setRiddenSectionsForTest(sections: { name: string; coordinates: Point[] }[] | null): void {
  loadFailed = false;
  sectionsCache = sections
    ? sections.map((s) => ({
        name: s.name,
        lengthKm: cumulativeDistances(s.coordinates).at(-1)! / 1000,
        coordinates: s.coordinates,
        cumulative: cumulativeDistances(s.coordinates),
      }))
    : null;
}

/**
 * Matchers by area, cached per rounded bounding box — the same reasoning as
 * `measureTetCoverage`, which the comment there spells out: one projection
 * scale averaged across a continent is wrong everywhere, and building a grid
 * over every section on a request that can touch a handful is waste.
 */
const matchers = new Map<string, ReturnType<typeof createTetMatcher>>();
/** Degrees of slack around the route: comfortably past the 35 m tolerance. */
const BOX_PAD_DEG = 0.05;

function matcherFor(coordinates: Point[]): ReturnType<typeof createTetMatcher> | undefined {
  const sections = loadRiddenSections();
  if (!sections.length) return undefined;
  const lons = coordinates.map((c) => c[0]);
  const lats = coordinates.map((c) => c[1]);
  const box = [
    Math.min(...lons) - BOX_PAD_DEG, Math.min(...lats) - BOX_PAD_DEG,
    Math.max(...lons) + BOX_PAD_DEG, Math.max(...lats) + BOX_PAD_DEG,
  ] as const;
  const key = box.map((v) => v.toFixed(1)).join(",");
  let matcher = matchers.get(key);
  if (!matcher) {
    const nearby = sections.filter((s) =>
      s.coordinates.some((c) => c[0] >= box[0] && c[0] <= box[2] && c[1] >= box[1] && c[1] <= box[3])
    );
    // No ridden road near this ride: an answer, not an error.
    if (!nearby.length) return undefined;
    matcher = createTetMatcher(nearby);
    if (matchers.size > 32) matchers.clear();
    matchers.set(key, matcher);
  }
  return matcher;
}

/** Drops every cached matcher. Only `setRiddenSectionsForTest` needs this. */
export function clearRiddenMatcherCache(): void {
  matchers.clear();
}

/**
 * How much of a route runs on roads the rider has ridden.
 *
 * Approximate geometry matching, exactly as `measureTetCoverage` is: sustained
 * aligned proximity, never a road-id assertion. Do not report this as proof
 * that a particular OSM way is the one he rode.
 */
export function measureRiddenCoverage(coordinates: Point[]): { sectionName: string; sliceKm: number } | undefined {
  try {
    if (!coordinates.length) return undefined;
    return matcherFor(coordinates)?.(coordinates);
  } catch (error) {
    console.warn("ridden coverage unavailable:", error);
    return undefined;
  }
}

/**
 * Which coordinate indices of a route lie on a ridden road.
 *
 * `measureRiddenCoverage` answers "how much", which is what the panel wants.
 * The verified-access rule needs "which", per edge — so this runs the same
 * matcher over each step and returns a per-index verdict the classifier can
 * intersect with an edge's shape range.
 *
 * It is deliberately built from the *same* matcher rather than a looser test:
 * a single coordinate that happens to pass within 35 m of a ridden road is not
 * evidence of anything, and the matcher's 300 m sustained-run rule is what
 * keeps a crossing from reading as a shared road. A step is marked only if a
 * window around it matched as a run.
 */
export function riddenStepFlags(coordinates: Point[]): boolean[] {
  const flags = new Array(Math.max(0, coordinates.length - 1)).fill(false);
  if (coordinates.length < 2) return flags;
  const matcher = matcherFor(coordinates);
  if (!matcher) return flags;

  // Walk the route in overlapping windows and ask the matcher about each. A
  // window is the unit because the matcher's verdict is about a sustained run,
  // not a point: asking it per step would always fail the 300 m rule, and
  // asking once about the whole route says nothing about where.
  const WINDOW_M = 400;
  const cumulative = cumulativeDistances(coordinates);
  let from = 0;
  while (from < coordinates.length - 1) {
    const to = Math.min(coordinates.length - 1, indexAtOffset(cumulative, from, WINDOW_M));
    if (to <= from) break;
    // The matcher needs more than the window itself to find a 300 m run, so it
    // is given a padded slice and the verdict applied to the window's own
    // steps. Without the pad, a genuinely ridden road reads as unmatched at
    // every window boundary.
    const padFrom = Math.max(0, indexAtOffset(cumulative, from, -WINDOW_M));
    const padTo = Math.min(coordinates.length - 1, indexAtOffset(cumulative, to, WINDOW_M));
    const matched = matcher(coordinates.slice(padFrom, padTo + 1));
    if (matched) for (let i = from; i < to; i++) flags[i] = true;
    from = to;
  }
  return flags;
}

/**
 * Metres of a coordinate list that lie on a ridden road, from step flags.
 * Shared by the classifier and the tests so both count it the same way.
 */
export function riddenMetersFrom(coordinates: Point[], flags: boolean[]): number {
  let meters = 0;
  for (let i = 1; i < coordinates.length; i++) {
    if (flags[i - 1]) meters += haversineMeters(coordinates[i - 1], coordinates[i]);
  }
  return meters;
}

export type RiddenSlice = {
  sectionName: string;
  viaPoints: Point[];
  sliceKm: number;
  entryDistanceKm: number;
};

/**
 * How far from the start a ridden road may be and still be worth offering.
 *
 * `pickTetSlice` has no such limit and relies on its caller to reject a distant
 * slice. That is a sharper edge here: the TET is continental, so its nearest
 * section is rarely absurd, while this layer is a handful of rides in two
 * countries — asked from Spain it would otherwise return a Latvian road and
 * offer via points 2000 km away. The caller still applies its own, tighter
 * `targetKm * 0.35` rule; this is the floor under it.
 */
const MAX_ENTRY_M = 150_000;

/**
 * Via points along a ridden road near `start`, sized like `pickTetSlice` and
 * used the same way: a candidate that competes with ordinary loops under the
 * same direction and quality rules, never a mode that overrides them.
 */
export function pickRiddenSlice(
  start: { lat: number; lon: number },
  targetSliceMeters: number,
  variant: 0 | 1 | 2,
  viaCount = 8
): RiddenSlice | null {
  const sections = loadRiddenSections();
  if (!sections.length) return null;

  let bestSection: RiddenSection | null = null;
  let bestIndex = 0;
  let bestDistance = Infinity;
  for (const section of sections) {
    // Coordinates are metres apart after simplification, so every third point
    // is plenty to find the nearest — the same sampling `tet.ts` uses.
    for (let i = 0; i < section.coordinates.length; i += 3) {
      const d = haversineMeters(section.coordinates[i], [start.lon, start.lat]);
      if (d < bestDistance) {
        bestDistance = d;
        bestIndex = i;
        bestSection = section;
      }
    }
  }
  if (!bestSection || bestDistance > MAX_ENTRY_M) return null;

  const { cumulative, coordinates } = bestSection;
  let startIdx: number;
  let endIdx: number;
  if (variant === 0) {
    startIdx = bestIndex;
    endIdx = indexAtOffset(cumulative, bestIndex, targetSliceMeters);
  } else if (variant === 1) {
    startIdx = indexAtOffset(cumulative, bestIndex, -targetSliceMeters);
    endIdx = bestIndex;
  } else {
    startIdx = indexAtOffset(cumulative, bestIndex, -targetSliceMeters / 2);
    endIdx = indexAtOffset(cumulative, bestIndex, targetSliceMeters / 2);
  }
  if (endIdx - startIdx < 4) return null;

  const sliceMeters = cumulative[endIdx] - cumulative[startIdx];
  const count = Math.max(2, Math.min(viaCount, endIdx - startIdx));
  const viaPoints: Point[] = Array.from({ length: count }, (_, i) => {
    const t = (i + 0.5) / count;
    return coordinates[indexAtOffset(cumulative, startIdx, sliceMeters * t)];
  });

  return {
    sectionName: bestSection.name,
    viaPoints,
    sliceKm: Math.round(sliceMeters / 100) / 10,
    entryDistanceKm: Math.round(bestDistance / 100) / 10,
  };
}
