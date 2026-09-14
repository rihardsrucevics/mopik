import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { loadPois, poiName, type Poi } from "@/lib/geo/poi";
// The shapes and the kind table live in a file with no `fs` import, so a
// client component can use them without pulling the dataset reader into the
// browser bundle. Re-exported here so server callers have one import.
import { POI_KIND, type PoiCategory, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";
export { POI_KIND };
export type { PoiCategory, RoutePoi, RoutePois };

/**
 * Places worth stopping at along a ride that has already been routed.
 *
 * This is the other half of the POI dataset's job. `lib/routing/loop.ts` uses
 * it *before* routing, to plan a loop through real places; this uses it
 * *after*, to answer "what did I just ride past?" — the suggestions in
 * Detaļas, where a nearby one can be promoted to a via point and the ride
 * regenerated through it.
 *
 * Two lists, because they are two different offers:
 *   - `onRoute` — within `ON_ROUTE_M` of the line. The rider passes these
 *     whether they mean to or not; the only useful thing to say is where
 *     along the ride they are, so they are ordered by that.
 *   - `nearby` — between `ON_ROUTE_M` and `NEARBY_M`. These cost a detour, so
 *     they are ranked and capped: a list of forty villages is not a
 *     suggestion.
 *
 * Baltics only, because that is what `public/poi-baltics.geojson` covers
 * (backlog item 8 is the Europe build). Outside it both lists come back empty
 * rather than as an error — a München ride is not broken, it is unannotated,
 * and the panel simply shows nothing.
 */

/** Closer than this to the line and the ride already passes it. */
export const ON_ROUTE_M = 150;

/** Past this a stop is a different ride, not a detour. */
export const NEARBY_M = 3000;

/** A list of forty villages is not a suggestion. */
export const MAX_NEARBY = 8;

/** The same cap on the passed-by list, which can otherwise run to hundreds. */
export const MAX_ON_ROUTE = 12;


/**
 * What a rider actually stops for, as a multiplier on the dataset's own
 * `score`.
 *
 * The dataset scores a POI by how much of a detour it is worth *as a loop
 * anchor* — a ferry is a 10 because routing through one shapes the whole
 * ride. That is not the same question as "is this worth getting off the bike
 * for". Villages are 9,822 of the 16,410 points and are what a ride is made
 * of rather than a reason to stop, so they are damped hard; the things the
 * rider named — viewpoints, hillforts, manors, waterfalls — are lifted.
 *
 * Fuel, cafés and beaches are in the brief but not in this dataset (its
 * categories are the eleven below). They will rank themselves when the
 * Europe build adds them; nothing here needs to change.
 */
const STOP_APPEAL: Record<PoiCategory, number> = {
  viewpoint: 2.0,
  hillfort: 1.9,
  waterfall: 1.9,
  // A named cave is worth as much of a stop as a waterfall — Gūtmaņa ala is
  // the single most-visited natural object in Latvia. A named cliff slightly
  // less: the Baltic ones are riverbank sandstone you look at from the road,
  // not somewhere you stop and walk to.
  cave: 1.9,
  cliff: 1.6,
  manor: 1.7,
  lighthouse: 1.6,
  tower: 1.4,
  mill: 1.3,
  ferry: 1.2,
  ford: 1.0,
  reserve: 0.9,
  village: 0.25,
};

/**
 * What a second place of a kind already suggested costs, in the same units as
 * the rank above (dataset score x appeal, minus km of detour).
 *
 * Roughly one strong place's worth: enough that a waterfall displaces a third
 * hillfort, not so much that a genuinely better second hillfort is refused.
 */
const KIND_REPEAT_PENALTY = 4;

/** Two entries of the same name this close together are one place. */
const SAME_PLACE_M = 250;

const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  haversineMeters([a.lon, a.lat], [b.lon, b.lat]) < SAME_PLACE_M;

/**
 * Cumulative distance along the line, in metres, per vertex.
 *
 * Computed once for the whole route rather than per POI: a 200 km ride is a
 * few thousand vertices and several hundred candidate points, and doing this
 * inside the per-POI loop is what turns a millisecond into a second.
 */
function cumulative(line: Point[]): number[] {
  const out = new Array<number>(line.length);
  out[0] = 0;
  for (let i = 1; i < line.length; i++) {
    out[i] = out[i - 1] + haversineMeters(line[i - 1], line[i]);
  }
  return out;
}

/**
 * Distance from a point to a segment, and how far along the segment the foot
 * of the perpendicular lands, in a local flat projection.
 *
 * Flat rather than spherical on purpose: this runs once per (POI, segment)
 * pair and the distances involved are metres to kilometres, where the error
 * is far below the 150 m threshold. The x axis is scaled by `cosLat` — the
 * mistake `tet-coverage.ts` made was hard-coding that for Latvia, so it is a
 * parameter here and derived from the route's own latitude.
 */
function segmentDistance(
  p: Point,
  a: Point,
  b: Point,
  cosLat: number
): { meters: number; t: number } {
  const M_PER_DEG = 111_320;
  const ax = a[0] * cosLat * M_PER_DEG;
  const ay = a[1] * M_PER_DEG;
  const bx = b[0] * cosLat * M_PER_DEG;
  const by = b[1] * M_PER_DEG;
  const px = p[0] * cosLat * M_PER_DEG;
  const py = p[1] * M_PER_DEG;

  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  // A zero-length segment (the router does emit repeated coordinates) is just
  // its own endpoint.
  const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return { meters: Math.hypot(px - cx, py - cy), t };
}

/**
 * A grid over the route's own segments, so a POI is tested against the handful
 * of segments near it rather than against all of them.
 *
 * Without this the lookup is |POIs in bbox| x |route vertices| — for a 200 km
 * Latvian ride that is roughly 2,000 x 6,000 = 12M distance calls, which is
 * the "full scan per point" the brief rules out. With it each POI touches the
 * nine cells around it and the whole lookup stays in single-digit
 * milliseconds.
 *
 * The cell is `NEARBY_M` wide, so the three-by-three block around a point is
 * guaranteed to contain every segment within the search radius.
 */
type SegmentGrid = {
  cells: Map<string, number[]>;
  cellDegLon: number;
  cellDegLat: number;
};

const gridKey = (ix: number, iy: number) => `${ix}:${iy}`;

function buildGrid(line: Point[], cosLat: number): SegmentGrid {
  const cellDegLat = NEARBY_M / 111_320;
  const cellDegLon = cellDegLat / cosLat;
  const cells = new Map<string, number[]>();

  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    // Every cell the segment's bounding box touches. A segment is short
    // relative to a 3 km cell, so this is one or two cells in practice.
    const x0 = Math.floor(Math.min(ax, bx) / cellDegLon);
    const x1 = Math.floor(Math.max(ax, bx) / cellDegLon);
    const y0 = Math.floor(Math.min(ay, by) / cellDegLat);
    const y1 = Math.floor(Math.max(ay, by) / cellDegLat);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        const key = gridKey(ix, iy);
        const bucket = cells.get(key);
        if (bucket) bucket.push(i);
        else cells.set(key, [i]);
      }
    }
  }

  return { cells, cellDegLon, cellDegLat };
}

/** The route's bounding box, grown by the search radius. */
function searchBox(line: Point[], cosLat: number) {
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of line) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const padLat = NEARBY_M / 111_320;
  const padLon = padLat / cosLat;
  return {
    minLon: minLon - padLon,
    maxLon: maxLon + padLon,
    minLat: minLat - padLat,
    maxLat: maxLat + padLat,
  };
}

/**
 * The nearest point of the route to a POI: its distance and how far along the
 * ride it is.
 *
 * Returns null as soon as it is clear nothing is within `NEARBY_M`, so a POI
 * that only shares a grid cell costs nine map lookups and a few segment
 * tests.
 */
function nearestOnLine(
  poi: Point,
  line: Point[],
  cumMeters: number[],
  grid: SegmentGrid,
  cosLat: number
): { meters: number; alongMeters: number } | null {
  const ix = Math.floor(poi[0] / grid.cellDegLon);
  const iy = Math.floor(poi[1] / grid.cellDegLat);

  let best: { meters: number; alongMeters: number } | null = null;
  // A segment within NEARBY_M of the point must start or end in one of the
  // nine cells around it, because the cell is NEARBY_M wide.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      const bucket = grid.cells.get(gridKey(ix + dx, iy + dy));
      if (!bucket) continue;
      for (const i of bucket) {
        const { meters, t } = segmentDistance(poi, line[i], line[i + 1], cosLat);
        if (best && meters >= best.meters) continue;
        const alongMeters = cumMeters[i] + t * (cumMeters[i + 1] - cumMeters[i]);
        best = { meters, alongMeters };
      }
    }
  }

  return best && best.meters <= NEARBY_M ? best : null;
}

export type PoisForRouteOptions = {
  /** Which name to show; the dataset carries Latvian and English. */
  locale?: "lv" | "en";
  maxNearby?: number;
  maxOnRoute?: number;
};

/**
 * The two suggestion lists for a routed ride.
 *
 * `geometry` is the route's own polyline, exactly as it reaches the client in
 * `GeneratedRoute.geometry` — the client already has it, so the API takes it
 * rather than re-routing or looking up a share code.
 */
export function poisForRoute(
  geometry: { coordinates: [number, number][] } | null | undefined,
  opts: PoisForRouteOptions = {}
): RoutePois {
  return classifyPois(geometry, loadPois(), opts);
}

/**
 * The classification itself, against an explicit set of places.
 *
 * Split out from `poisForRoute` so the on-route/nearby boundary can be tested
 * against a synthetic polyline and a handful of points — pinning the rule
 * against the 16,410-point real dataset would be testing the data, not the
 * geometry.
 */
export function classifyPois(
  geometry: { coordinates: [number, number][] } | null | undefined,
  pois: Poi[],
  opts: PoisForRouteOptions = {}
): RoutePois {
  const line = (geometry?.coordinates ?? []) as Point[];
  const empty: RoutePois = { onRoute: [], nearby: [] };
  if (line.length < 2) return empty;

  if (!pois.length) return empty;

  const locale = opts.locale ?? "lv";
  const maxNearby = opts.maxNearby ?? MAX_NEARBY;
  const maxOnRoute = opts.maxOnRoute ?? MAX_ON_ROUTE;

  // Derived from the route, never hard-coded: the same mistake that put
  // `tet-coverage.ts` 26 % out in Spain.
  const midLat = line[Math.floor(line.length / 2)][1];
  const cosLat = Math.cos((midLat * Math.PI) / 180) || 1;

  const box = searchBox(line, cosLat);
  const cumMeters = cumulative(line);
  const grid = buildGrid(line, cosLat);

  const onRoute: RoutePoi[] = [];
  const nearby: { poi: RoutePoi; rank: number }[] = [];

  for (const poi of pois) {
    // The bbox prefilter is what keeps a 16,410-point dataset off the grid
    // entirely for all but the few hundred points near this ride.
    if (poi.lon < box.minLon || poi.lon > box.maxLon) continue;
    if (poi.lat < box.minLat || poi.lat > box.maxLat) continue;

    const name = poiName(poi, locale);
    if (!name) continue;

    const hit = nearestOnLine([poi.lon, poi.lat], line, cumMeters, grid, cosLat);
    if (!hit) continue;

    const entry: RoutePoi = {
      id: poi.id,
      name,
      category: poi.category,
      lat: poi.lat,
      lon: poi.lon,
      distanceMeters: Math.round(hit.meters),
      alongKm: Math.round(hit.alongMeters / 100) / 10,
    };

    if (hit.meters <= ON_ROUTE_M) {
      onRoute.push(entry);
    } else {
      // Appeal first, then how little of a detour it is: a viewpoint 400 m
      // off the line beats a village 200 m off it, but between two viewpoints
      // the nearer one wins.
      const appeal = (STOP_APPEAL[poi.category] ?? 1) * poi.score;
      nearby.push({ poi: entry, rank: appeal - hit.meters / 1000 });
    }
  }

  // Riding order, which is the only order that makes sense for something the
  // ride already passes.
  onRoute.sort((a, b) => a.alongKm - b.alongKm);
  // Same duplicate-object problem as below, and in riding order the pair is
  // adjacent, so one pass over the sorted list is enough.
  const deduped = onRoute.filter(
    (p, i) => !onRoute.slice(0, i).some((q) => q.name === p.name && near(q, p))
  );
  onRoute.length = 0;
  onRoute.push(...deduped);

  // Rank, then spread across kinds. Straight ranking was measured returning
  // eight hillforts for a 200 km Latvian loop — the dataset has 1,337 of them
  // and they all score alike, so the strongest list is also the dullest. Each
  // repeat of a kind already taken costs a place in the order, which lets a
  // second hillfort through when it is genuinely better than the best
  // waterfall and not otherwise.
  const takenKinds = new Map<PoiCategory, number>();
  const pickedNearby: RoutePoi[] = [];
  const pool = [...nearby].sort((a, b) => b.rank - a.rank);
  while (pickedNearby.length < maxNearby && pool.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const seen = takenKinds.get(pool[i].poi.category) ?? 0;
      const value = pool[i].rank - seen * KIND_REPEAT_PENALTY;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = i;
      }
    }
    const [chosen] = pool.splice(bestIndex, 1);
    // One place, one row. The dataset carries a tower and a viewpoint for the
    // same structure ("Kuvižu skatu tornis" was measured appearing twice, 0 m
    // apart, under two categories) because they are two OSM objects — which
    // is right for a loop anchor and wrong for a list a rider reads.
    if (pickedNearby.some((p) => p.name === chosen.poi.name && near(p, chosen.poi))) continue;
    takenKinds.set(chosen.poi.category, (takenKinds.get(chosen.poi.category) ?? 0) + 1);
    pickedNearby.push(chosen.poi);
  }
  pickedNearby.sort((a, b) => a.alongKm - b.alongKm);

  // The passed-by list is capped too, but by keeping the most notable and
  // then restoring riding order — a long ride can pass ninety villages.
  const pickedOnRoute =
    onRoute.length <= maxOnRoute
      ? onRoute
      : [...onRoute]
          .sort(
            (a, b) =>
              (STOP_APPEAL[b.category] ?? 1) * 10 - (STOP_APPEAL[a.category] ?? 1) * 10 ||
              a.distanceMeters - b.distanceMeters
          )
          .slice(0, maxOnRoute)
          .sort((a, b) => a.alongKm - b.alongKm);

  return { onRoute: pickedOnRoute, nearby: pickedNearby };
}
