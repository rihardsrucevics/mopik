import { t } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locale";
import { stopNumbers } from "@/lib/poi/kinds";
import { interleaveShapes, type ShapePoint } from "@/lib/routing/shape-points";
import { plainName, sightName, isSightKind, splitPlace, type RideWaypointPlace } from "@/lib/gpx/waypoints";

/**
 * The ride's anchors, in riding order, for the GPX `<rte>` (route editing
 * Phase 1, design §C).
 *
 * ## Why a route as well as a track
 *
 * The `<trk>` is the line Mopik rode for the rider, and it stays the
 * authoritative one. But a Garmin (zūmo, BaseCamp, Tread) plans with a
 * *route*: a list of points it navigates between, where a **via** is an
 * announced stop and a **shaping point** only bends the line and is never
 * announced. That is exactly Mopik's „Pietura” / „Caurbraucams punkts”, so the
 * `<rte>` carries the same distinction onto the device instead of flattening
 * every pass-through point into a stop (or dropping it).
 *
 * ## The rules
 *
 * - Start, stops, finish: **via**, named in the ride's locale — „Starts · …”,
 *   „Pietura 2 · …”, „Finišs · …”.
 * - A stop that is a known sight takes no number (the map's `stopNumbers`) and
 *   reads as its wpt does, „Ūdenskritums · …”.
 * - Pass-through points: **shape**, slotted after the place they follow
 *   (`afterPlace`) by the same `interleaveShapes` the generator routes with.
 *   Never a waypoint — this module is the only place they reach the file.
 * - **A round trip repeats the start at the end**: a Garmin route ends at its
 *   last point, and one that stopped at the last stop would cut the ride short.
 * - Ticked sights (spliced detours) are vias too, placed where the line
 *   actually visits them — without them a Garmin that recalculates from the
 *   `<rte>` would ride past the sight the `<trk>` goes to.
 */
export type GpxRoutePoint = {
  lat: number;
  lon: number;
  name?: string;
  kind: "via" | "shape";
};

export { MAX_ROUTE_POINTS } from "@/lib/gpx/parse-route-points";

export type RideRoutePointsInput = {
  /** Start, stops and (one-way) the finish, in riding order — `resolvedPlaces`. */
  places: readonly RideWaypointPlace[];
  /** The plan's pass-through points; `afterPlace` indexes `[start, ...stops]`. */
  shapePoints?: readonly ShapePoint[];
  returnToStart: boolean;
  locale: UiLocale;
  /** Ticked sights whose detour is spliced into `line`. Ignored without `line`. */
  sights?: readonly RideWaypointPlace[];
  /** The exported track, `[lon, lat]`, used only to place the sights in order. */
  line?: readonly (readonly number[])[];
};

const usable = (p: { lat: number; lon: number }) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;

/** Equirectangular metres — plenty to rank vertices by nearness. */
function metres(a: { lat: number; lon: number }, lon: number, lat: number): number {
  const x = (lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(x, lat - a.lat) * 111_320;
}

/**
 * The vertex of `line` at or after `from` where the line passes `p`.
 *
 * The *earliest* close pass rather than the nearest one: a stop on a road the
 * ride uses twice (out along a corridor and back) is visited the first time,
 * and the later anchors are searched from there. "Close" is within 150 m of
 * the best pass, so GPS-scale noise does not pick a far pass over a near one.
 */
function passIndex(line: readonly (readonly number[])[], p: { lat: number; lon: number }, from: number): number {
  let best = Infinity;
  const d = new Array<number>(line.length);
  for (let i = from; i < line.length; i++) {
    d[i] = metres(p, line[i][0], line[i][1]);
    if (d[i] < best) best = d[i];
  }
  for (let i = from; i < line.length; i++) if (d[i] <= best + 150) return i;
  return from;
}

export function rideRoutePoints({ places, shapePoints, returnToStart, locale, sights, line }: RideRoutePointsInput): GpxRoutePoint[] {
  const named = places.filter((p) => usable(p) && plainName(splitPlace(p).name).length > 0);
  if (named.length === 0) return [];

  // Same reading as `rideWaypoints`: `returnToStart` decides, never the count.
  const hasFinish = !returnToStart && named.length >= 2;
  const start = named[0];
  const stops = named.slice(1, hasFinish ? -1 : undefined);
  const finish = hasFinish ? named[named.length - 1] : null;
  const numbers = stopNumbers(stops.map((p) => ({ label: splitPlace(p).name, category: p.kind })));

  const via = (p: RideWaypointPlace, name: string): GpxRoutePoint => ({ lat: p.lat, lon: p.lon, name, kind: "via" });
  const nameOf = (p: RideWaypointPlace) => plainName(splitPlace(p).name);
  const startPoint = via(start, `${t(locale, "mapStart")} · ${nameOf(start)}`);
  const stopPoints = stops.map((p, i) => {
    const n = numbers[i];
    if (n === null && isSightKind(p.kind)) return via(p, sightName(p.kind!, nameOf(p), locale));
    return via(p, `${fi(t(locale, "pointStopTitle"), { n: n ?? "" }).trim()} · ${nameOf(p)}`);
  });

  const shapeName = t(locale, "shapePointName");
  const middle = interleaveShapes<GpxRoutePoint>(
    stopPoints,
    (shapePoints ?? []).filter(usable),
    (s) => ({ lat: s.lat, lon: s.lon, name: shapeName, kind: "shape" }),
  );
  const end = finish
    ? via(finish, `${t(locale, "mapFinish")} · ${nameOf(finish)}`)
    : returnToStart ? { ...startPoint } : null;
  const anchors = [startPoint, ...middle, ...(end ? [end] : [])];

  // Ticked sights, slotted between the anchors the line visits them between.
  const ticked = (sights ?? []).filter((p) => usable(p) && nameOf(p).length > 0);
  if (!ticked.length || !line || line.length < 2) return anchors;
  let from = 0;
  const at = anchors.map((a, i) => {
    // The first anchor is the line's start and the end anchor its end — a
    // round trip's repeated start must not be matched back to vertex 0.
    if (i === 0) return 0;
    if (i === anchors.length - 1 && end) return line.length - 1;
    from = passIndex(line, a, from);
    return from;
  });
  const placed = ticked
    .map((p) => ({ point: via(p, isSightKind(p.kind) ? sightName(p.kind!, nameOf(p), locale) : nameOf(p)), index: passIndex(line, p, 0) }))
    .sort((a, b) => a.index - b.index);
  const out: GpxRoutePoint[] = [];
  let k = 0;
  anchors.forEach((a, i) => {
    // Everything visited before this anchor goes in front of it — but never in
    // front of the start: a sight is on the way, not before the ride begins.
    if (i > 0) while (k < placed.length && placed[k].index < at[i]) out.push(placed[k++].point);
    out.push(a);
  });
  // A one-way ride with no finish anchor: sights past the last stop still count.
  while (k < placed.length) {
    if (end) out.splice(out.length - 1, 0, placed[k++].point);
    else out.push(placed[k++].point);
  }
  return out;
}
