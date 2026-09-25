import test from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_WINDOW_M,
  SNAP_SILENT_M,
  applyShapeEdit,
  insertStopsByAlong,
  isShape,
  mergeShapes,
  placesFromRide,
  placesFromRows,
  planEdit,
  planWithPlaces,
  resolvedOf,
  rowsOf,
  shapePointsOf,
  shapesOf,
  snapToLine,
  spliceIsSound,
  stopsOf,
  type EditPlan,
  type RidePlace,
  type RidePlaces,
} from "../lib/routing/reroute-leg";
import { interleaveShapes, shapesAfterPlaces } from "../lib/routing/shape-points";
import { cumulative, lineMeters } from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";
import type { RouteSegmentProperties } from "../lib/types";
import { RidePlanSchema, type RidePlan } from "../lib/chat/ride-plan";
import { carryShapePoints, planForFullSearch } from "../lib/chat/compose-plan";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "../lib/chat/ride-limits";
import { decodePlanPlaces, decodePlanShare, decodeRouteShare, encodePlanShare, encodeRouteShare } from "../lib/share/route-code";
import { rideId } from "../lib/share/saved-rides";
import { rideWaypoints } from "../lib/gpx/waypoints";
import type { GeneratedRoute } from "../lib/types";

/**
 * Shaping points („maršruta punkti”, rider, 2026-09-25), as arithmetic.
 *
 * `npx tsx --test scripts/shape-points.test.ts`
 *
 * A grab of the drawn line used to make a numbered stop with a row; the rider
 * wanted „just a moved route”. What must hold, and is checked here:
 *
 * 1. **The router sees a via, everything else sees nothing.** A shaping point
 *    is re-routed exactly like a stop (the same windows, the same loop test,
 *    the same neighbour caps), and it has no row, no name, no share-code
 *    place and no GPX waypoint.
 * 2. **Every gesture is one step:** add, move, remove, make it a stop.
 * 3. **Old links do not change.** A plan without shaping points encodes to
 *    the very code it did before, so no saved ride's id moves.
 * 4. **The full search drops them**, and says so (the panel's job; the plan
 *    it is given is checked here).
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const M_PER_DEG_LAT = 110_540;

function eastLine(km: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i <= Math.round(km * 10); i++) out.push([24.0 + (i * 100) / M_PER_DEG_LON, LAT]);
  return out;
}
const LINE = eastLine(20);
const CUM = cumulative(LINE);

const closeTo = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected ~${expected}, got ${actual}`);

const at = (km: number, northM = 0, name = `${km} km`): RidePlace => ({
  name, label: name, lat: LAT + northM / M_PER_DEG_LAT, lon: 24.0 + (km * 1000) / M_PER_DEG_LON,
});
const onLine = (km: number): Point => [24.0 + (km * 1000) / M_PER_DEG_LON, LAT];

/** Sigulda (0 km) → Turaida (8 km) → Cēsis (20 km), one way. */
const ONE_WAY: RidePlaces = { start: at(0, 0, "Sigulda"), vias: [at(8, 0, "Turaida")], finish: at(20, 0, "Cēsis"), roundTrip: false };

function plan(before: RidePlaces, after: RidePlaces, line = LINE): EditPlan {
  const result = planEdit({ line, cum: cumulative(line), before, after });
  assert.ok(result && !("error" in result), "the edit must produce a plan");
  return result;
}
function ok<T extends object>(value: T): Exclude<T, { error: unknown }> {
  assert.ok(!("error" in value), `unexpected ${JSON.stringify(value)}`);
  return value as Exclude<T, { error: unknown }>;
}

const PLAN: RidePlan = RidePlanSchema.parse({
  startPlace: "Sigulda", viaPlaces: ["Turaida"], destinationPlace: "Cēsis", directionPlace: null, returnToStart: false,
  budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null }, difficulty: "adventure", rideStyle: "explore",
  gravelPreference: 55, trailPreference: "some", accessPolicy: "verified", preferForest: false, noSand: false, avoidTowns: false,
  avoidMainRoads: false, includeTet: false, includeSightseeing: false,
});

/** A shaping point grabbed on the line at `km` and let go `northM` north of it. */
function grabbed(places: RidePlaces, km: number, northM: number): RidePlaces {
  const to = at(km, northM);
  return ok(applyShapeEdit(places, { kind: "add", lat: to.lat, lon: to.lon, grabbedAt: onLine(km) }));
}

test("a grab of the line makes a shaping point, not a stop: no row, no name, no place", () => {
  const after = grabbed(ONE_WAY, 14, 400);
  assert.equal(shapesOf(after).length, 1);
  assert.equal(stopsOf(after).length, 1, "Turaida is still the only stop");
  assert.deepEqual(rowsOf(after).names, rowsOf(ONE_WAY).names, "the form gains no row");
  assert.deepEqual(resolvedOf(after).map((p) => p.name), ["Sigulda", "Turaida", "Cēsis"], "the share code's places are the stops");
  assert.equal(shapesOf(after)[0].name, "", "and it has no name to look up");
});

test("adding a shaping point re-routes like adding a stop, where it was grabbed", () => {
  const p = plan(ONE_WAY, grabbed(ONE_WAY, 14, 400));
  assert.equal(p.kind, "add-stop", "the same add path a stop takes");
  assert.equal(p.places.vias.length, 2);
  assert.ok(isShape(p.places.vias[1]), "slotted after Turaida, where the line was grabbed");
  closeTo(p.runs[0].fromMeters, 14_000 - EDIT_WINDOW_M, 80, "a window back from the grab");
  closeTo(p.runs[0].toMeters, 14_000 + EDIT_WINDOW_M, 80, "and on");
  // Three points: join, the dot, join — the shape `/api/reroute-leg` rides
  // through as two halves and fences for a loop, exactly as for a stop.
  assert.equal(p.runs[0].points.length, 3);
});

test("a shaping point is a neighbour like a stop: a stop's move window stops at it", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 10, 0)).places;
  const moved = { ...settled, vias: settled.vias.map((v) => (isShape(v) ? v : { ...v, lat: v.lat + 200 / M_PER_DEG_LAT })) };
  const p = plan(settled, moved);
  assert.equal(p.kind, "move-stop");
  closeTo(p.runs[0].toMeters, 10_000, 60, "capped at the shaping point 2 km on, not 3 km");
});

test("moving a shaping point is a move: a window around where it was", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places;
  const to = at(14, 600);
  const moved = ok(applyShapeEdit(settled, { kind: "move", index: 0, lat: to.lat, lon: to.lon }));
  const p = plan(settled, moved);
  assert.equal(p.kind, "move-stop");
  assert.deepEqual(p.runs[0].points[1], [to.lon, to.lat]);
  closeTo(p.runs[0].fromMeters, 11_000, 80, "from 3 km before it");
  assert.deepEqual(rowsOf(moved).names, rowsOf(ONE_WAY).names, "still no row");
});

test("removing a shaping point gives the line back over the stretch it re-routed", () => {
  const added = plan(ONE_WAY, grabbed(ONE_WAY, 14, 400));
  const joins: [Point, Point] = [added.runs[0].points[0], added.runs[0].points[2]];
  const withJoins = { ...added.places, vias: added.places.vias.map((v) => (isShape(v) ? { ...v, joins } : v)) };
  const removed = ok(applyShapeEdit(withJoins, { kind: "remove", index: 0 }));
  assert.deepEqual(removed, ONE_WAY, "the places are the ride's again");
  const p = plan(withJoins, removed);
  assert.equal(p.kind, "remove-stop");
  closeTo(p.runs[0].fromMeters, added.runs[0].fromMeters, 60, "the same stretch, from");
  closeTo(p.runs[0].toMeters, added.runs[0].toMeters, 60, "the same stretch, to");
});

test("„Padarīt par pieturu”: the dot becomes a numbered stop with a row, in its own place", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places;
  const dot = shapesOf(settled)[0];
  const named = { name: "Kārļi", label: "Kārļi · Amatas pagasts", lat: dot.lat + 0.01, lon: dot.lon };
  const promoted = ok(applyShapeEdit(settled, { kind: "promote", index: 0, place: named }));
  assert.equal(shapesOf(promoted).length, 0);
  assert.deepEqual(stopsOf(promoted).map((v) => v.name), ["Turaida", "Kārļi"], "inserted where the dot was");
  assert.equal(stopsOf(promoted)[1].lat, dot.lat, "at the dot's coordinates, not the lookup's");
  assert.deepEqual(rowsOf(promoted).names, ["Sigulda", "Turaida", "Kārļi", "Cēsis"], "and now it has a row");
  assert.equal(planEdit({ line: LINE, cum: CUM, before: settled, after: promoted }), null, "the line does not change");
});

test("the caps: stops and shaping points each have their own", () => {
  const full: RidePlaces = { ...ONE_WAY, vias: Array.from({ length: MAX_STOPS }, (_, i) => at(1 + i, 0, `S${i}`)) };
  const withDot = grabbed(full, 15, 0);
  assert.deepEqual(applyShapeEdit(withDot, { kind: "promote", index: 0, place: { name: "X", label: "X", lat: 0, lon: 0 } }), { error: "stop-cap" });
  let many = ONE_WAY;
  for (let i = 0; i < MAX_SHAPE_POINTS; i++) many = grabbed(many, 9 + i * 0.5, 0);
  assert.equal(shapesOf(many).length, MAX_SHAPE_POINTS, "stops at the cap do not limit dots");
  assert.deepEqual(applyShapeEdit(many, { kind: "add", lat: LAT, lon: 24.1, grabbedAt: onLine(3) }), { error: "shape-cap" });
  assert.deepEqual(applyShapeEdit(ONE_WAY, { kind: "remove", index: 0 }), { error: "no-such-point" });
});

test("rows committed over a shaped ride keep the shaping points where they were", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places;
  const rows = rowsOf(settled);
  // Turaida moved 300 m north in the form: the dot stays after it.
  const movedRows = ok(placesFromRows({ picked: { ...rows.picked, 1: { ...rows.picked[1], lat: rows.picked[1].lat + 300 / M_PER_DEG_LAT } }, rowCount: 3, roundTrip: false, finishOptional: false }));
  const moved = mergeShapes(settled, movedRows);
  assert.equal(moved.vias.length, 2);
  assert.ok(isShape(moved.vias[1]));
  assert.equal(plan(settled, moved).kind, "move-stop", "one stop moved, nothing else");
  // Turaida taken out: the dot stays.
  const removed = mergeShapes(settled, { ...settled, vias: [] });
  assert.equal(removed.vias.length, 1);
  assert.ok(isShape(removed.vias[0]));
  assert.equal(plan(settled, removed).kind, "remove-stop");
  // A stop added from the form at 17 km: slotted after the dot by the line.
  const added = mergeShapes(settled, { ...settled, vias: [stopsOf(settled)[0], at(17, 0, "Jaunā")] });
  const p = plan(settled, added);
  assert.equal(p.kind, "add-stop");
  assert.deepEqual(p.places.vias.map((v) => (isShape(v) ? "•" : v.name)), ["Turaida", "•", "Jaunā"]);
});

test("the plan carries shaping points with the place each follows, and only when there are any", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 3, 0)).places;
  const shaped = planWithPlaces(PLAN, settled);
  assert.deepEqual(shaped.viaPlaces, ["Turaida"], "the names are the stops");
  assert.equal(shaped.shapePoints?.length, 1);
  assert.equal(shaped.shapePoints?.[0].afterPlace, 0, "after the start, before Turaida");
  const plain = planWithPlaces(shaped, ONE_WAY);
  assert.equal("shapePoints" in plain, false, "no key at all once they are gone");
  // …and a generated ride's places put them back between the stops.
  const back = placesFromRide({
    plan: shaped,
    start: { lat: ONE_WAY.start.lat, lon: ONE_WAY.start.lon, label: "Sigulda" },
    via: [{ lat: ONE_WAY.vias[0].lat, lon: ONE_WAY.vias[0].lon, label: "Turaida" }],
    destination: { lat: ONE_WAY.finish!.lat, lon: ONE_WAY.finish!.lon, label: "Cēsis" },
    picked: [],
  });
  assert.deepEqual(back.vias.map((v) => (isShape(v) ? "•" : v.name)), ["•", "Turaida"]);
  assert.deepEqual(shapePointsOf(back), shaped.shapePoints);
});

test("interleaving: each shaping point after its place, and the reverse is exact", () => {
  const shapes = [{ lat: 1, lon: 1, afterPlace: 0 }, { lat: 2, lon: 2, afterPlace: 2 }, { lat: 3, lon: 3, afterPlace: 2 }, { lat: 4, lon: 4, afterPlace: 9 }];
  const mixed = interleaveShapes(["A", "B"], shapes, (s) => `•${s.lat}`);
  assert.deepEqual(mixed, ["•1", "A", "B", "•2", "•3", "•4"], "past the last stop goes after it, in order");
  const back = shapesAfterPlaces(mixed, (v) => v.startsWith("•"), (v) => ({ lat: Number(v.slice(1)), lon: Number(v.slice(1)) }));
  assert.deepEqual(back.map((s) => s.afterPlace), [0, 2, 2, 2]);
  assert.deepEqual(interleaveShapes(["A"], undefined, () => "x"), ["A"]);
});

test("the router's line decides where a shaping point is, silently; a stop still gets refused", () => {
  const far = at(14, 900);
  const dot: RidePlace = { name: "", label: "", lat: far.lat, lon: far.lon, shape: true };
  const snapped = ok(snapToLine({ line: LINE, before: ONE_WAY, after: { ...ONE_WAY, vias: [...ONE_WAY.vias, dot] }, maxMoveMeters: 300 }));
  assert.equal(snapped.movedMeters, 0, "nothing is said about it");
  closeTo(snapped.places.vias[1].lat, LAT, 1e-7, "it is on the line");
  const stop = at(14, 900, "Laukā");
  const refused = snapToLine({ line: LINE, before: ONE_WAY, after: { ...ONE_WAY, vias: [...ONE_WAY.vias, stop] }, maxMoveMeters: 300 });
  assert.ok("error" in refused && refused.error === "too-far", "a stop 900 m off the ride is not the same place");
  closeTo(SNAP_SILENT_M, 25, 0, "the stop's silent margin is unchanged");
});

test("the continuous-line check holds shaping points to the line, not to a visit", () => {
  const segs = (line: Point[]): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> => ({
    type: "FeatureCollection",
    features: [{ type: "Feature", geometry: { type: "LineString", coordinates: line }, properties: { roadClass: "road", surface: "asphalt", distanceMeters: Math.round(lineMeters(line)) } }],
  });
  const far = at(14, 900);
  const withDot: RidePlaces = { ...ONE_WAY, vias: [...ONE_WAY.vias, { name: "", label: "", lat: far.lat, lon: far.lon, shape: true }] };
  assert.deepEqual(spliceIsSound({ segments: segs(LINE), original: segs(LINE), places: withDot, toleranceMeters: 300 }), { ok: true });
  const withStop: RidePlaces = { ...ONE_WAY, vias: [...ONE_WAY.vias, at(14, 900, "Laukā")] };
  assert.equal(spliceIsSound({ segments: segs(LINE), original: segs(LINE), places: withStop, toleranceMeters: 300 }).ok, false);
  // A broken line is broken whatever it passes.
  const broken = segs(LINE);
  broken.features = [
    { ...broken.features[0], geometry: { type: "LineString", coordinates: LINE.slice(0, 80) } },
    { ...broken.features[0], geometry: { type: "LineString", coordinates: LINE.slice(90) } },
  ];
  assert.equal(spliceIsSound({ segments: broken, original: segs(LINE), places: withDot, toleranceMeters: 300 }).ok, false);
});

test("sights kept into a shaped ride: every dot stays, the stops are capped", () => {
  const withDot = grabbed(ONE_WAY, 14, 0);
  const sights = Array.from({ length: MAX_STOPS + 2 }, (_, i) => at(0.5 + i, 0, `Sight ${i}`));
  const next = insertStopsByAlong(LINE, withDot, sights);
  assert.equal(stopsOf(next).length, MAX_STOPS);
  assert.equal(shapesOf(next).length, 1);
});

function fakeRoute(): GeneratedRoute {
  const coords = LINE.slice(0, 40) as [number, number][];
  return {
    id: "x", name: "Sigulda → Cēsis", geometry: { type: "LineString", coordinates: coords },
    segments: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { roadClass: "road", surface: "asphalt", distanceMeters: 3900 } }] },
    distanceMeters: 3900, durationSeconds: 600, roadMix: {} as GeneratedRoute["roadMix"], surfaces: { asphaltPercent: 100, gravelPercent: 0, dirtPercent: 0, unknownPercent: 0 },
    quality: {} as GeneratedRoute["quality"], overlap: { repeatedKm: 0, distinctKm: 3.9, repeatedPercent: 0 }, profile: "moto", sourcePrompt: "", variant: "balanced",
  };
}

/**
 * The plan part of a code made by the encoder on main before shaping points
 * existed (e91e27c), for `PLAN` with its three places — produced by running
 * that version of `encodePlanShare`, not by this one.
 */
const OLD_PLAN_CODE = "eyJzIjoiU2lndWxkYSIsInYiOlsiVHVyYWlkYSJdLCJkIjoiQ8STc2lzIiwiZiI6bnVsbCwiYnMiOiJ0b3RhbCIsInIiOmZhbHNlLCJiIjp7Im1vZGUiOiJmbGV4aWJsZSIsInZhbHVlIjpudWxsLCJjb25zdHJhaW50IjoidGFyZ2V0IiwibWluaW11bVZhbHVlIjpudWxsfSwiZGYiOiJhZHZlbnR1cmUiLCJzdCI6ImV4cGxvcmUiLCJnIjo1NSwidCI6InNvbWUiLCJhIjoidmVyaWZpZWQiLCJwZiI6ZmFsc2UsImFtIjpmYWxzZSwic2kiOmZhbHNlLCJzdSI6InNvbWUiLCJwbCI6W1siU2lndWxkYSIsIlNpZ3VsZGEiLDU3LjE1LDI0Ljg1XSxbIlR1cmFpZGEiLCJUdXJhaWRhIiw1Ny4xOCwyNC44Ml0sWyJDxJNzaXMiLCJDxJNzaXMiLDU3LjMxLDI1LjI3XV19";
const OLD_PLACES = [{ name: "Sigulda", label: "Sigulda", lat: 57.15, lon: 24.85 }, { name: "Turaida", label: "Turaida", lat: 57.18, lon: 24.82 }, { name: "Cēsis", label: "Cēsis", lat: 57.31, lon: 25.27 }];

test("a ride without shaping points encodes exactly as before: same code, same saved-ride id", () => {
  assert.equal(encodePlanShare(PLAN, OLD_PLACES), OLD_PLAN_CODE, "byte for byte the old encoder's");
  // …also after an edit round trip that added and removed a dot.
  const roundTrip = planWithPlaces(planWithPlaces(PLAN, grabbed(ONE_WAY, 14, 0)), ONE_WAY);
  assert.equal(encodePlanShare(roundTrip, OLD_PLACES), OLD_PLAN_CODE);
  const route = fakeRoute();
  assert.equal(rideId(encodeRouteShare(route, "Sigulda", roundTrip, OLD_PLACES)), rideId(encodeRouteShare(route, "Sigulda", PLAN, OLD_PLACES)));
  // An old code still decodes, to a plan with no shaping points.
  const old = decodePlanShare(OLD_PLAN_CODE);
  assert.equal(old?.startPlace, "Sigulda");
  assert.equal(old?.shapePoints, undefined);
  assert.equal(decodePlanPlaces(OLD_PLAN_CODE).length, 3);
});

test("shaping points survive the share code, and a bad row costs only itself", () => {
  const shaped = planWithPlaces(PLAN, plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places);
  const code = encodeRouteShare(fakeRoute(), "Sigulda", shaped, OLD_PLACES);
  assert.equal(code.split("~")[0], "1", "the share version is not bumped");
  const back = decodeRouteShare(code)!;
  assert.equal(back.plan?.shapePoints?.length, 1);
  assert.equal(back.plan?.shapePoints?.[0].afterPlace, 1, "after Turaida");
  closeTo(back.plan!.shapePoints![0].lon, shaped.shapePoints![0].lon, 1e-5, "to ~1 m");
  assert.notEqual(rideId(code), rideId(encodeRouteShare(fakeRoute(), "Sigulda", PLAN, OLD_PLACES)), "a shaped ride is a different ride");
  // A hand-edited code with one broken row: the plan still decodes.
  const raw = JSON.parse(Buffer.from(code.split("~")[4].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  raw.sp.push(["x", 1, 0], [95, 1, 0]);
  const tampered = Buffer.from(JSON.stringify(raw), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(decodePlanShare(tampered)?.shapePoints?.length, 1);
});

test("the GPX has a waypoint for every stop and none for a shaping point", () => {
  const settled = plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places;
  const dot = shapesOf(settled)[0];
  const w = rideWaypoints({ places: resolvedOf(settled), returnToStart: false, locale: "lv" });
  assert.deepEqual(w.map((x) => x.type), ["start", "stop", "finish"]);
  assert.ok(!w.some((x) => Math.abs(x.lat - dot.lat) < 1e-6 && Math.abs(x.lon - dot.lon) < 1e-6), "no <wpt> on the dot");
});

test("the full search keeps the stops and drops the shaping points", () => {
  const shaped = planWithPlaces(PLAN, plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places);
  const search = planForFullSearch(shaped);
  assert.deepEqual(search.viaPlaces, ["Turaida"]);
  assert.equal("shapePoints" in search, false);
});

test("a reopened ride keeps its shaping points while its places are the same, and not after", () => {
  const shaped = planWithPlaces(PLAN, plan(ONE_WAY, grabbed(ONE_WAY, 14, 0)).places);
  const { shapePoints: _s, ...fromRows } = shaped;
  void _s;
  assert.equal(carryShapePoints({ ...fromRows, budget: { ...fromRows.budget, mode: "duration", value: 3 } }, shaped).shapePoints?.length, 1, "a changed duration keeps them");
  assert.equal(carryShapePoints({ ...fromRows, viaPlaces: ["Līgatne"] }, shaped).shapePoints, undefined, "a changed stop drops them");
  assert.equal(carryShapePoints(fromRows, null).shapePoints, undefined);
});

test("the stop cap is one number the schema takes", () => {
  const ten = RidePlanSchema.safeParse({ ...PLAN, viaPlaces: Array.from({ length: MAX_STOPS }, (_, i) => `S${i}`) });
  assert.equal(ten.success, true);
  const eleven = RidePlanSchema.safeParse({ ...PLAN, viaPlaces: Array.from({ length: MAX_STOPS + 1 }, (_, i) => `S${i}`) });
  assert.equal(eleven.success, false);
  assert.equal(MAX_STOPS, 10);
});
