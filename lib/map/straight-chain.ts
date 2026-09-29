import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import { connector, drawnSeconds } from "@/lib/routing/drawn";
import {
  anchorsAlong, anchorsOf, insertStopsByAlong, nearestAlong, nearestWithin,
  type EditRun, type RidePlace, type RidePlaces, type RoutedRun,
} from "@/lib/routing/reroute-leg";

/**
 * „Vest pa taisno caur visiem” (rider, 2026-09-29): several points in a row
 * in a forest with no road. One chain, not one snap per point: by roads as
 * near as any road goes toward the first, straight 1 → 2 → 3, and after the
 * last straight back to the nearest road point that leads on to the next
 * kept place — rejoining the ride, not retracing the way in. Drawn geometry
 * (`lib/routing/drawn.ts`): ridden exactly, never re-routed, a fixed interval
 * for later edits (`drawnIntervals`), shared and exported like any drawn
 * stretch.
 */

type Feature = GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>;

/** A pending point this far or more from the line its batch landed on is off any road. */
export const CHAIN_OFF_M = 150;

/** Straight metres above which the guidance adds the risk („pāri mežam vai ūdenim”). */
export const CHAIN_RISK_M = 1_000;

/** Two road ends this close are the same road end (the way in is the way out). */
export const SAME_END_M = 30;

/**
 * The runs of consecutive off-road points, as inclusive index ranges into
 * `off` (the ride's points in order, true where one is off-road): only runs
 * of `min` or more — a lone point keeps its own „Vest pa taisno”.
 */
export function offRoadRuns(off: boolean[], min = 2): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= off.length; i++) {
    if (i < off.length && off[i]) { if (start < 0) start = i; continue; }
    if (start >= 0 && i - start >= min) out.push([start, i - 1]);
    start = -1;
  }
  return out;
}

/** Metres straight through `points`, one to the next. */
export function chainMeters(points: Point[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return m;
}

/**
 * What the chain will draw, before any road is asked: the line to the first
 * point from the nearest point of the ride, through all, and back from the
 * last — the guidance line's „taisni ~1,4 km” (the proposal says it exactly).
 */
export function chainEstimate(points: Point[], line: Point[]): number {
  if (!points.length || line.length < 2) return 0;
  const cum = cumulative(line);
  return nearestAlong(points[0], line, cum).meters + chainMeters(points) + nearestAlong(points[points.length - 1], line, cum).meters;
}

/**
 * The chain's points put into the ride's places: the first where the line
 * meets it (`insertStopsByAlong`), the rest right after it in the order the
 * rider has them — consecutive, so nothing is ridden between them.
 */
export function insertChain(line: Point[], before: RidePlaces, points: RidePlace[]): RidePlaces {
  if (!points.length) return before;
  const first = insertStopsByAlong(line, before, [points[0]]);
  const at = first.vias.indexOf(points[0]);
  if (at < 0) return first;
  return { ...first, vias: [...first.vias.slice(0, at + 1), ...points.slice(1), ...first.vias.slice(at + 1)] };
}

/**
 * Where the chain leaves the ride and where it comes back, metres along
 * `line`: the nearest points to the first and the last, between the kept
 * places either side (the chain's own places are not on the line yet).
 */
export function chainJoins(line: Point[], before: RidePlaces, points: Point[]): { entryAlong: number; exitAlong: number; entry: Point; exit: Point } {
  const cum = cumulative(line);
  const along = anchorsAlong(anchorsOf(before, line[line.length - 1]), line, cum);
  const first = points[0];
  const last = points[points.length - 1];
  const near = nearestAlong(first, line, cum).alongMeters;
  // The kept places either side of where the chain begins.
  let lo = 0;
  let hi = cum[cum.length - 1];
  for (const a of along) { if (a <= near) lo = Math.max(lo, a); else { hi = Math.min(hi, a); break; } }
  const entryAlong = nearestWithin(first, line, cum, lo, hi).alongMeters;
  // Back on to the ride toward the next kept place, never behind the way in.
  const exitAlong = nearestWithin(last, line, cum, entryAlong, hi).alongMeters;
  return {
    entryAlong,
    exitAlong,
    entry: pointAtDistance(line, cum, entryAlong).point as Point,
    exit: pointAtDistance(line, cum, exitAlong).point as Point,
  };
}

/**
 * The stretch that replaces the ride between the two joins: the road the
 * router found from the entry join toward the first point (ending where the
 * road ends — used only when that is nearer the point than the ride is), the
 * drawn line through every point, and the road from where one begins near
 * the last point back to the exit join. As one run for `applyRuns`.
 */
export function chainRun(params: {
  points: Point[];
  entryAlong: number; exitAlong: number; entry: Point; exit: Point;
  /** The router's answer from the entry join toward the first point. */
  entryRoad?: RoutedRun | null;
  /** The router's answer from the last point to the exit join. */
  exitRoad?: RoutedRun | null;
}): {
  run: EditRun;
  routed: RoutedRun;
  /** Every drawn metre: onto the first point, through all, off the last. */
  drawnMeters: number;
  /** The way out meets the road where the way in left it. */
  sameEnd: boolean;
  /** Where the drawn line leaves the road, and where it comes back to one. */
  from: Point; to: Point;
} {
  const { points, entry, exit } = params;
  const first = points[0];
  const last = points[points.length - 1];
  const lineOf = (r?: RoutedRun | null) => (r?.segments.features ?? []).filter((f) => f.geometry.coordinates.length >= 2) as Feature[];
  const inRoad = lineOf(params.entryRoad);
  const outRoad = lineOf(params.exitRoad);
  const inEnd = inRoad.length ? (inRoad[inRoad.length - 1].geometry.coordinates.at(-1) as Point) : null;
  const outStart = outRoad.length ? (outRoad[0].geometry.coordinates[0] as Point) : null;
  // A road helps only if it ends nearer the point than the ride does.
  const useIn = Boolean(inEnd && haversineMeters(inEnd, first) + 1 < haversineMeters(entry, first));
  const useOut = Boolean(outStart && haversineMeters(outStart, last) + 1 < haversineMeters(exit, last));
  const from = useIn ? (inEnd as Point) : entry;
  const to = useOut ? (outStart as Point) : exit;
  const drawn: Feature[] = [connector(from, first)];
  for (let i = 1; i < points.length; i++) drawn.push(connector(points[i - 1], points[i]));
  drawn.push(connector(last, to));
  const drawnMeters = drawn.reduce((s, f) => s + f.properties.distanceMeters, 0);
  const features: Feature[] = [...(useIn ? inRoad : []), ...drawn, ...(useOut ? outRoad : [])];
  const roadMeters = (useIn ? params.entryRoad!.distanceMeters : 0) + (useOut ? params.exitRoad!.distanceMeters : 0);
  const roadSeconds = (useIn ? params.entryRoad!.durationSeconds : 0) + (useOut ? params.exitRoad!.durationSeconds : 0);
  return {
    run: { fromMeters: params.entryAlong, toMeters: params.exitAlong, points: [entry, ...points, exit] },
    routed: {
      segments: { type: "FeatureCollection", features },
      distanceMeters: Math.round(roadMeters + drawnMeters),
      durationSeconds: Math.round(roadSeconds + drawnSeconds(drawnMeters)),
    },
    drawnMeters,
    sameEnd: haversineMeters(from, to) <= SAME_END_M,
    from,
    to,
  };
}
