import test from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_WINDOW_M,
  NO_EDITS,
  anchorsAlong,
  anchorsOf,
  applyRuns,
  coordinatesOf,
  insertStopsByAlong,
  LOOP_SHARED_MIN_M,
  chooseLoop,
  nogosAlong,
  MAX_NOGOS,
  sharedRoad,
  nearestAlong,
  placesFromRide,
  placesFromRows,
  planEdit,
  planWithPlaces,
  pushEdit,
  recomputeOverlap,
  resolvedOf,
  rowsOf,
  snapToLine,
  summariseSegments,
  undoEdit,
  type EditPlan,
  type EditedRide,
  type RidePlace,
  type RidePlaces,
  lineBreaks,
  spanRun,
  spliceIsSound,
  JOIN_GAP_M,
} from "../lib/routing/reroute-leg";
import { cumulative, lineMeters } from "../lib/routing/detour";
import { haversineMeters as haversineMetersPoint } from "../lib/geo/geometry";
import type { Point } from "../lib/geo/geometry";
import type { RouteSegmentProperties } from "../lib/types";
import type { RidePlan } from "../lib/chat/ride-plan";

/**
 * Correcting a ride on the map, as arithmetic — no router, no network.
 *
 * `npx tsx --test scripts/reroute-leg.test.ts`
 *
 * The half of the edit feature that has to be right before a single BRouter
 * request is worth making. What can go wrong silently, and is checked here:
 *
 * 1. **The wrong stretch is re-routed.** Each kind of edit — move the start, a
 *    stop or the finish, add a stop, take one out — replaces a specific
 *    stretch of the drawn line; a cut in the wrong place splices a routed leg
 *    onto a road it does not join, or throws away ride the rider kept.
 * 2. **The retraced figure stops describing the line.** The rider's one rule
 *    is not riding the same road twice, so an edit that raises retracing must
 *    say so, and the test that matters is the one where it gets WORSE.
 * 3. **The plan and the places drift apart**, so the share code or a later
 *    search carries a stop the line no longer goes through.
 * 4. **Undo restores something other than what was on screen.**
 *
 * The geometry is a due-east line at 57°N (Latvia's latitude), so distances
 * along it can be checked by hand.
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const M_PER_DEG_LAT = 110_540;

/** A due-east line of `km` kilometres, one vertex every 100 m. */
function eastLine(km: number, lat = LAT, lon0 = 24.0): Point[] {
  const out: Point[] = [];
  const steps = Math.round(km * 10);
  for (let i = 0; i <= steps; i++) out.push([lon0 + (i * 100) / M_PER_DEG_LON, lat]);
  return out;
}

const closeTo = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ~${expected}, got ${actual}`,
  );

type Segs = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;

/** One feature per `perFeature` vertices, so the cuts have joins to land on. */
function segmentsFor(line: Point[], perFeature = 10, surface: RouteSegmentProperties["surface"] = "asphalt"): Segs {
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];
  for (let i = 0; i < line.length - 1; i += perFeature) {
    const slice = line.slice(i, Math.min(i + perFeature + 1, line.length));
    if (slice.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      properties: { roadClass: "road", surface, distanceMeters: Math.round(lineMeters(slice)) },
    });
  }
  return { type: "FeatureCollection", features };
}

const LINE = eastLine(20);
const CUM = cumulative(LINE);
const SEGMENTS = segmentsFor(LINE);

/** A place `km` along the fixture line, `northM` metres off it. */
const at = (km: number, northM = 0, name = `${km} km`): RidePlace => ({
  name, label: name, lat: LAT + northM / M_PER_DEG_LAT, lon: 24.0 + (km * 1000) / M_PER_DEG_LON,
});

/** Sigulda (0 km) → Turaida (8 km) → Cēsis (20 km), one way. */
const ONE_WAY: RidePlaces = { start: at(0, 0, "Sigulda"), vias: [at(8, 0, "Turaida")], finish: at(20, 0, "Cēsis"), roundTrip: false };

function plan(before: RidePlaces, after: RidePlaces, line = LINE): EditPlan {
  const result = planEdit({ line, cum: cumulative(line), before, after });
  assert.ok(result && !("error" in result), "the edit must produce a plan");
  return result;
}

test("the fixture line is the length it claims", () => {
  closeTo(CUM[CUM.length - 1], 20_000, 30, "total length");
  closeTo(lineMeters(coordinatesOf(SEGMENTS)), 20_000, 30, "segments rebuild the same line");
});

test("a place beside the line is found at the right distance along it", () => {
  const found = nearestAlong([24.0 + 8_000 / M_PER_DEG_LON, LAT + 600 / M_PER_DEG_LAT], LINE, CUM);
  closeTo(found.alongMeters, 8_000, 60, "along the route");
  closeTo(found.meters, 600, 20, "distance from the route");
});

test("anchors are placed along the ride in riding order, never backwards", () => {
  const along = anchorsAlong(anchorsOf(ONE_WAY, LINE[LINE.length - 1]), LINE, CUM);
  closeTo(along[0], 0, 1, "the start is the beginning");
  closeTo(along[1], 8_000, 60, "the stop");
  closeTo(along[2], 20_000, 30, "the finish is the end");
  // An out-and-back: the stop is passed at 5 km going out and at 15 km coming
  // back. The second stop must be found on the way back, after the first.
  const out = eastLine(10);
  const there: Point[] = [...out, ...[...out].reverse().slice(1)];
  const cum = cumulative(there);
  const twice = anchorsAlong([there[0], at(8), at(5), there[there.length - 1]].map((p) => (Array.isArray(p) ? p : [p.lon, p.lat] as Point)), there, cum);
  assert.ok(twice[2] > twice[1], "the second stop comes after the first");
  closeTo(twice[2], 15_000, 60, "found on the way back");
});

test("a round trip's last anchor is the END of the line, not the nearest point to the start", () => {
  // The last anchor IS the start, so proximity would answer 0 m and the last
  // leg would run backwards. Measured: a 140 km loop became 6 km that way.
  const loop: RidePlaces = { start: at(0), vias: [at(10)], finish: null, roundTrip: true };
  const along = anchorsAlong(anchorsOf(loop, LINE[LINE.length - 1]), LINE, CUM);
  closeTo(along[2], 20_000, 30, "the loop closes at the line's end");
});

test("move a stop: a window around where it was, nothing beyond the places either side", () => {
  const moved = { ...ONE_WAY, vias: [at(8, 500, "Turaida")] };
  const p = plan(ONE_WAY, moved);
  assert.equal(p.kind, "move-stop");
  assert.equal(p.runs.length, 1);
  closeTo(p.runs[0].fromMeters, 8_000 - EDIT_WINDOW_M, 60, "starts one window back");
  closeTo(p.runs[0].toMeters, 8_000 + EDIT_WINDOW_M, 60, "ends one window on");
  assert.equal(p.runs[0].points.length, 3, "join → the moved stop → join");
  assert.deepEqual(p.runs[0].points[1], [moved.vias[0].lon, moved.vias[0].lat], "through the new spot");
  // Near a neighbour the window stops at it: the stop 1 km from the start.
  const early: RidePlaces = { ...ONE_WAY, vias: [at(1, 0, "A")] };
  const q = plan(early, { ...early, vias: [at(1, 300, "A")] });
  assert.equal(q.runs[0].fromMeters, 0, "never before the start");
});

test("a stop moved far re-routes a wider window, still capped at its neighbours", () => {
  const far = plan(ONE_WAY, { ...ONE_WAY, vias: [at(8, 4_000, "Turaida")] });
  // 4 km off: 8 km each way, which reaches the start (0 km) and 16 km.
  closeTo(far.runs[0].fromMeters, 0, 60, "capped at the start");
  closeTo(far.runs[0].toMeters, 16_000, 60, "twice the move, forwards");
});

test("move the start: from the new start to a point into the ride", () => {
  const p = plan(ONE_WAY, { ...ONE_WAY, start: at(0, 400, "Sigulda") });
  assert.equal(p.kind, "move-start");
  assert.equal(p.runs.length, 1);
  assert.equal(p.runs[0].fromMeters, 0);
  closeTo(p.runs[0].toMeters, EDIT_WINDOW_M, 60, "one window in");
  assert.deepEqual(p.runs[0].points[0], [ONE_WAY.start.lon, LAT + 400 / M_PER_DEG_LAT], "from the new start");
});

test("move a round trip's start: both ends of the loop, one run each", () => {
  const loop: RidePlaces = { start: at(0), vias: [at(10)], finish: null, roundTrip: true };
  const p = plan(loop, { ...loop, start: at(0, 400) });
  assert.equal(p.kind, "move-start");
  assert.equal(p.runs.length, 2, "the first leg and the last");
  assert.equal(p.runs[0].fromMeters, 0);
  closeTo(p.runs[1].toMeters, 20_000, 30, "the second ends at the loop's end");
  const newStart: Point = [loop.start.lon, LAT + 400 / M_PER_DEG_LAT];
  assert.deepEqual(p.runs[1].points[p.runs[1].points.length - 1], newStart, "and returns to the new start");
});

test("move the finish: from a point back from the end to the new finish", () => {
  const p = plan(ONE_WAY, { ...ONE_WAY, finish: at(20, 2_000, "Cēsis") });
  assert.equal(p.kind, "move-finish");
  closeTo(p.runs[0].toMeters, 20_000, 30, "to the end");
  // Moved 2 km: 4 km back from the end.
  closeTo(p.runs[0].fromMeters, 16_000, 60, "twice the move back");
});

test("add a stop: a window around where the line meets it, re-sequenced to riding order", () => {
  // The form puts a new stop before the finish; the line meets it at 3 km,
  // before Turaida. The ride visits it first, so the list says so.
  const added = at(3, 600, "Jaunā");
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, added] });
  assert.equal(p.kind, "add-stop");
  assert.deepEqual(p.places.vias.map((v) => v.name), ["Jaunā", "Turaida"], "in the order the line reaches them");
  closeTo(p.runs[0].fromMeters, 0, 60, "the start is nearer than a window back");
  closeTo(p.runs[0].toMeters, 3_000 + EDIT_WINDOW_M, 60, "one window on");
  assert.deepEqual(p.runs[0].points[1], [added.lon, added.lat], "through the new stop");
});

test("remove a stop: a window around it, never past the places either side", () => {
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [] });
  assert.equal(p.kind, "remove-stop");
  closeTo(p.runs[0].fromMeters, 8_000 - EDIT_WINDOW_M, 60, "one window back");
  closeTo(p.runs[0].toMeters, 8_000 + EDIT_WINDOW_M, 60, "one window on");
  assert.equal(p.runs[0].points.length, 2, "and through nothing");
  // Adding a stop and taking it out again re-routes the same stretch.
  const added = at(12, 0, "Jaunā");
  const add = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, added] });
  const remove = plan(add.places, ONE_WAY);
  closeTo(remove.runs[0].fromMeters, add.runs[0].fromMeters, 60, "same start of the stretch");
  closeTo(remove.runs[0].toMeters, add.runs[0].toMeters, 60, "same end of the stretch");
});

/** A polyline through metre offsets from the fixture origin, a vertex every 100 m. */
function path(...corners: [number, number][]): Point[] {
  const toLonLat = ([e, n]: [number, number]): Point => [24.0 + e / M_PER_DEG_LON, LAT + n / M_PER_DEG_LAT];
  const out: Point[] = [toLonLat(corners[0])];
  for (let i = 1; i < corners.length; i++) {
    const [e0, n0] = corners[i - 1];
    const [e1, n1] = corners[i];
    const steps = Math.max(1, Math.round(Math.hypot(e1 - e0, n1 - n0) / 100));
    for (let k = 1; k <= steps; k++) out.push(toLonLat([e0 + ((e1 - e0) * k) / steps, n0 + ((n1 - n0) * k) / steps]));
  }
  return out;
}

test("remove a loop's only stop: its spur is cut out, not the whole loop", () => {
  // A 30 km loop with the stop at the end of a 1 km dead-end at 5 km. The two
  // legs around it both run start → start, so routing them would give nothing.
  const line = path([0, 0], [5_000, 0], [5_000, 1_000], [5_000, 0], [10_000, 0], [10_000, 5_000], [0, 5_000], [0, 0]);
  const loop: RidePlaces = { start: at(0), vias: [{ ...at(5, 1_000), name: "Galā" }], finish: null, roundTrip: true };
  const p = plan(loop, { ...loop, vias: [] }, line);
  assert.equal(p.kind, "remove-stop");
  // The tip is 6 km along; the spur is 1 km each way, plus a window.
  closeTo(p.runs[0].fromMeters, 6_000 - 1_000 - EDIT_WINDOW_M, 150, "from before the spur");
  closeTo(p.runs[0].toMeters, 6_000 + 1_000 + EDIT_WINDOW_M, 150, "to after it");
  // A pure out-and-back is the one ride with nothing left once the stop goes.
  const out = eastLine(10);
  const there: Point[] = [...out, ...[...out].reverse().slice(1)];
  const spur: RidePlaces = { start: at(0), vias: [at(10)], finish: null, roundTrip: true };
  const refused = planEdit({ line: there, cum: cumulative(there), before: spur, after: { ...spur, vias: [] } });
  assert.ok(refused && "error" in refused, "and says so");
});

test("anything else — a reorder — re-routes the stretch between the first and last change", () => {
  const two: RidePlaces = { ...ONE_WAY, vias: [at(5, 0, "A"), at(12, 0, "B")] };
  const p = plan(two, { ...two, vias: [two.vias[1], two.vias[0]] });
  assert.equal(p.kind, "reorder");
  closeTo(p.runs[0].fromMeters, 0, 1, "from the start, the last unchanged place");
  closeTo(p.runs[0].toMeters, 20_000, 30, "to the finish");
  assert.equal(p.runs[0].points.length, 4, "start → B → A → finish");
});

test("a new place the line only comes near is moved onto it, and a far one refused", () => {
  // The stop 200 m north of the line at 8 km: the ride reaches the road below
  // it, so that is where the stop is, and the page says 200 m.
  const off = at(12, 200, "Laukā");
  const after = { ...ONE_WAY, vias: [...ONE_WAY.vias, off] };
  const snapped = snapToLine({ line: LINE, before: ONE_WAY, after, maxMoveMeters: 500 });
  assert.ok(!("error" in snapped));
  closeTo(snapped.movedMeters, 200, 5, "moved by the gap");
  closeTo(snapped.places.vias[1].lat, LAT, 1e-5, "onto the line");
  assert.equal(snapped.places.vias[0], ONE_WAY.vias[0], "places the edit did not touch stay exactly where they were");
  // 1.2 km off: a different place, not a correction.
  const far = snapToLine({ line: LINE, before: ONE_WAY, after: { ...ONE_WAY, finish: at(20, 1_200, "Tālu") }, maxMoveMeters: 500 });
  assert.ok("error" in far && far.meters > 1_000);
  // On the road already: nothing moves and nothing is said.
  const on = snapToLine({ line: LINE, before: ONE_WAY, after: { ...ONE_WAY, vias: [at(8, 10, "Turaida")] }, maxMoveMeters: 500 });
  assert.ok(!("error" in on) && on.movedMeters === 0);
});

test("nothing changed is no edit at all", () => {
  assert.equal(planEdit({ line: LINE, cum: CUM, before: ONE_WAY, after: { ...ONE_WAY } }), null);
});

/** A replacement that bulges 2 km north between two points on the line. */
function bulge(fromKm: number, toKm: number, surface: RouteSegmentProperties["surface"] = "gravel") {
  const from: Point = [24.0 + (fromKm * 1000) / M_PER_DEG_LON, LAT];
  const to: Point = [24.0 + (toKm * 1000) / M_PER_DEG_LON, LAT];
  const up = LAT + 2_000 / M_PER_DEG_LAT;
  const line: Point[] = [from, [from[0], up], [to[0], up], to];
  return { line, run: { segments: segmentsFor(line, 1, surface), distanceMeters: Math.round(lineMeters(line)), durationSeconds: 900 } };
}

test("a run replaces exactly its stretch, and the ride either side is the ride it was", () => {
  const b = bulge(5, 12);
  const edited = applyRuns({
    segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600,
    runs: [{ fromMeters: 5_000, toMeters: 12_000 }], routed: [b.run],
  });
  const expected = 5_000 + lineMeters(b.line) + 8_000;
  closeTo(edited.distanceMeters, expected, 60, "edited length");
  closeTo(lineMeters(edited.coordinates), expected, 60, "the drawn line is that length");
  assert.deepEqual(edited.coordinates[0], LINE[0], "the start did not move");
  assert.deepEqual(edited.coordinates[edited.coordinates.length - 1], LINE[LINE.length - 1], "the finish did not move");
  // Time: 13 km kept at the ride's own 3 min/km, plus the run's own 15 min.
  closeTo(edited.durationSeconds, 13_000 * (3_600 / 20_000) + 900, 20, "kept share plus the new leg's time");
});

test("a stretch thrown away takes its own time with it, not the ride's average", () => {
  // 10 km of asphalt then 10 km of trail, timed at the speed table's own
  // speeds. Replacing the trail with 10 km of asphalt must take the trail's
  // 40 minutes away — by distance alone it would take only half the ride's.
  const segments = segmentsFor(LINE);
  segments.features.forEach((f, i) => { if (i >= 10) f.properties = { ...f.properties, roadClass: "trail", surface: "ground" }; });
  const base = (10 / 58) * 3600 + (10 / 15) * 3600;
  const asphalt = eastLine(10, LAT, 24.0 + 10_000 / M_PER_DEG_LON);
  const edited = applyRuns({
    segments, distanceMeters: 20_000, durationSeconds: base,
    runs: [{ fromMeters: 10_000, toMeters: 20_000 }],
    routed: [{ segments: segmentsFor(asphalt), distanceMeters: 10_000, durationSeconds: (10 / 58) * 3600 }],
  });
  closeTo(edited.durationSeconds, 2 * (10 / 58) * 3600, 30, "two asphalt halves");
});

test("two runs at once — a round trip's two ends — are both applied", () => {
  const head = bulge(0, 3);
  const tail = bulge(17, 20);
  const edited = applyRuns({
    segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600,
    runs: [{ fromMeters: 17_000, toMeters: 20_000 }, { fromMeters: 0, toMeters: 3_000 }],
    routed: [tail.run, head.run],
  });
  closeTo(edited.distanceMeters, 14_000 + lineMeters(head.line) + lineMeters(tail.line), 80, "both replaced");
});

test("the surfaces follow the line: a gravel correction in an asphalt ride counts as gravel", () => {
  const b = bulge(5, 12, "gravel");
  const edited = applyRuns({
    segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600,
    runs: [{ fromMeters: 5_000, toMeters: 12_000 }], routed: [b.run],
  });
  const s = summariseSegments(edited.segments, false);
  const gravelShare = lineMeters(b.line) / (13_000 + lineMeters(b.line));
  closeTo(s.surfaces.gravelPercent, Math.round(gravelShare * 100), 1, "gravel share");
  assert.equal(s.gateCount, undefined, "gates not measured stay not measured");
});

test("an edit that doubles back reports retracing over the whole ride, and it is worse", () => {
  // Out to 12 km, back to 8 km, forward again: the rider must be shown this
  // rather than the original's 0 %.
  const backtrack: Point[] = [
    ...eastLine(7, LAT, 24.0 + 5_000 / M_PER_DEG_LON),
    ...eastLine(4, LAT, 24.0 + 8_000 / M_PER_DEG_LON).reverse().slice(1),
    ...eastLine(4, LAT, 24.0 + 8_000 / M_PER_DEG_LON).slice(1),
  ];
  const edited = applyRuns({
    segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600,
    runs: [{ fromMeters: 5_000, toMeters: 12_000 }],
    routed: [{ segments: segmentsFor(backtrack, 5), distanceMeters: Math.round(lineMeters(backtrack)), durationSeconds: 1_200 }],
  });
  const before = recomputeOverlap(LINE).repeatedPercent;
  const after = recomputeOverlap(edited.coordinates);
  assert.equal(before, 0);
  assert.ok(after.repeatedPercent > before, `retracing must rise, got ${after.repeatedPercent} %`);
  closeTo(after.repeatedKm, 8, 0.5, "4 km ridden three times over is 8 km repeated");
});

test("an out-and-back reports half of itself as retraced", () => {
  const out = eastLine(10);
  const overlap = recomputeOverlap([...out, ...[...out].reverse().slice(1)]);
  closeTo(overlap.repeatedPercent, 50, 1, "repeated percent");
});

const PLAN: RidePlan = {
  startPlace: "Sigulda", viaPlaces: ["Turaida"], destinationPlace: "Cēsis", returnToStart: false,
  destinationAny: false, budget: { mode: "flexible", value: null, constraint: "target" },
} as unknown as RidePlan;

test("the plan carries the edit: names in riding order, so share, save and a search agree", () => {
  const moved: RidePlaces = { ...ONE_WAY, vias: [at(3, 0, "Jaunā"), ...ONE_WAY.vias], finish: at(22, 0, "Rauna") };
  const next = planWithPlaces(PLAN, moved);
  assert.equal(next.startPlace, "Sigulda");
  assert.deepEqual(next.viaPlaces, ["Jaunā", "Turaida"]);
  assert.equal(next.destinationPlace, "Rauna");
  assert.deepEqual(resolvedOf(moved).map((p) => p.name), ["Sigulda", "Jaunā", "Turaida", "Rauna"], "the share code's places, in order");
});

test("a ride's places become the form's rows and come back unchanged", () => {
  const rows = rowsOf(ONE_WAY);
  assert.deepEqual(rows.names, ["Sigulda", "Turaida", "Cēsis"]);
  const back = placesFromRows({ picked: rows.picked, rowCount: rows.names.length, roundTrip: false, finishOptional: false });
  assert.ok(!("error" in back));
  assert.deepEqual(back, ONE_WAY);
  // A row typed but never pinned has no coordinates and is not a stop.
  const typed = placesFromRows({ picked: { ...rows.picked, 1: null }, rowCount: 3, roundTrip: false, finishOptional: false });
  assert.ok(!("error" in typed) && typed.vias.length === 0);
  // A start with no place cannot be ridden from.
  assert.deepEqual(placesFromRows({ picked: { 2: ONE_WAY.finish }, rowCount: 3, roundTrip: false, finishOptional: false }), { error: "no-start" });
});

test("a generated ride's places take the plan's names and the router's coordinates", () => {
  const places = placesFromRide({
    plan: PLAN,
    start: { lat: 57.15, lon: 24.85, label: "Sigulda, Siguldas novads" },
    via: [{ lat: 57.18, lon: 24.82, label: "Turaida · Krimuldas pagasts" }],
    destination: { lat: 57.31, lon: 25.27, label: "Cēsis, Cēsu novads" },
    picked: [],
  });
  assert.equal(places.start.name, "Sigulda");
  assert.equal(places.start.label, "Sigulda, Siguldas novads");
  assert.equal(places.vias[0].name, "Turaida");
  assert.equal(places.finish?.lat, 57.31);
});

test("added sights land in the list where the line reaches them", () => {
  const places = insertStopsByAlong(LINE, ONE_WAY, [at(15, 300, "Ūdenskritums"), at(2, 300, "Pilskalns")]);
  assert.deepEqual(places.vias.map((v) => v.name), ["Pilskalns", "Turaida", "Ūdenskritums"]);
});

function ride(km: number): EditedRide {
  const line = eastLine(km);
  const segments = segmentsFor(line);
  return {
    coordinates: line, segments, distanceMeters: km * 1000, durationSeconds: km * 180,
    overlap: recomputeOverlap(line), summary: summariseSegments(segments, false), places: ONE_WAY, kind: "edit", how: "move-stop",
  };
}

test("undo walks back edit by edit, to exactly what was on screen", () => {
  const first = ride(21);
  const second = ride(23);
  let h = pushEdit(NO_EDITS, first);
  assert.equal(h.current, first);
  assert.equal(h.previous, null, "before the first edit is the API's own ride");
  h = pushEdit(h, second);
  assert.equal(h.previous, first);
  h = undoEdit(h);
  assert.equal(h.current, first, "the previous ride, the very object");
  assert.equal(h.canUndo, true, "and one more step, to the API's ride");
  h = undoEdit(h);
  assert.equal(h.current, null);
  assert.equal(h.canUndo, false);
  assert.equal(undoEdit(h), h, "nothing before the API's ride");
  assert.equal(undoEdit(pushEdit(NO_EDITS, first)).current, null, "undoing the first edit returns the API's ride");
});

/**
 * The rider's Rīga → Vasara 46 → Annužas 1: the two halves of the added
 * stop's stretch rode the same 6.03 km in and out. These pin the detection and
 * the choice; `scripts/measure-edit-loop.ts` measures the real ride.
 */
const legOf = (line: Point[]) => ({ coordinates: line, distanceMeters: Math.round(lineMeters(line)) });

test("two halves that ride the same road are caught, whichever way they run", () => {
  // In along a 6 km road to the stop and out along the same road: every metre shared.
  const road = path([0, 0], [6_000, 0]);
  const back = [...road].reverse();
  closeTo(sharedRoad(road, back).meters, 6_000, 20, "the whole spur, direction removed");
  // Out another way: nothing shared but the stop itself.
  const other = path([6_000, 0], [6_000, 3_000], [0, 3_000]);
  assert.equal(sharedRoad(road, other).meters, 0);
  // Sharing only the last 200 m is below the threshold that triggers a search.
  const tail = path([6_000, 0], [5_800, 0], [5_800, 2_000]);
  assert.ok(sharedRoad(road, tail).meters < LOOP_SHARED_MIN_M);
});

test("the fences keep off the stop and the joins, so a real dead end is refused rather than routed round", () => {
  const road = path([0, 0], [6_000, 0]);
  const stop = road[road.length - 1];
  const nogos = nogosAlong(road, [stop, road[0]]);
  assert.ok(nogos.length >= 25 && nogos.length <= 30, `one every ~200 m, got ${nogos.length}`);
  for (const n of nogos) {
    assert.ok(haversineMetersPoint([n.lon, n.lat], stop) >= 250, "none on the stop");
    assert.ok(haversineMetersPoint([n.lon, n.lat], road[0]) >= 250, "none on the join");
  }
});

test("a long shared stretch gets its fences further apart, never a URL the server refuses", () => {
  // A stop ~80 km off the line shared 95 km of road with itself; at 200 m
  // that was 326 circles and nginx answered 414, read as "no other way".
  const road = path([0, 0], [95_000, 0]);
  const nogos = nogosAlong(road, [road[road.length - 1], road[0]]);
  assert.ok(nogos.length <= MAX_NOGOS, `capped, got ${nogos.length}`);
  assert.ok(nogos.length >= MAX_NOGOS * 0.8, `still covers the stretch, got ${nogos.length}`);
  const gaps = nogos.slice(1).map((n, i) => haversineMetersPoint([n.lon, n.lat], [nogos[i].lon, nogos[i].lat]));
  assert.ok(Math.max(...gaps) < 1_500, "no stretch left unfenced for more than ~1.5 km");
});

test("the loop wins when it rides less of the same road within the bound, and the spur stays when it does not", () => {
  const road = path([0, 0], [6_000, 0]);
  const base = { approach: legOf(road), departure: legOf([...road].reverse()) }; // 12 km, 6 km shared
  // A loop out another way, 3 km longer than riding back: within the bound (≤ 6 km more).
  const loop = { approach: legOf(road), departure: legOf(path([6_000, 0], [6_000, 1_500], [0, 1_500], [0, 0])) };
  const chosen = chooseLoop(base, [loop]);
  assert.equal(chosen.index, 0);
  assert.equal(chosen.sharedMeters, 0);
  // A "loop" 20 km longer to avoid 6 km of the same road is a detour, not a correction.
  const far = { approach: legOf(road), departure: legOf(path([6_000, 0], [6_000, 10_000], [0, 10_000], [0, 0])) };
  const kept = chooseLoop(base, [far, null]);
  assert.equal(kept.index, -1, "the out-and-back stays");
  closeTo(kept.sharedMeters, 6_000, 20, "and what it shares is reported for the dead-end note");
  // Of two loops within the bound, the one that shares least wins, then the shorter.
  const partial = { approach: legOf(road), departure: legOf(path([6_000, 0], [3_000, 0], [3_000, 1_500], [0, 1_500], [0, 0])) };
  assert.equal(chooseLoop(base, [partial, loop]).index, 1);
});

test("a stop the edit added is taken out over the stretch the addition re-routed", () => {
  // The addition re-routed 5 → 11 km around a stop 3 km off the line, and the
  // stop recorded those joins. Removing it must re-route that stretch, not
  // just a window round the stop — which kept both sides of its loop.
  const detour = path([0, 0], [5_000, 0], [8_000, 3_000], [11_000, 0], [20_000, 0]);
  const stop: RidePlace = { ...at(8, 3_000, "Laukā"), lat: LAT + 3_000 / M_PER_DEG_LAT, lon: 24.0 + 8_000 / M_PER_DEG_LON };
  const joins: [Point, Point] = [[24.0 + 5_000 / M_PER_DEG_LON, LAT], [24.0 + 11_000 / M_PER_DEG_LON, LAT]];
  const withStop: RidePlaces = { ...ONE_WAY, vias: [{ ...stop, joins }] };
  const p = plan(withStop, { ...ONE_WAY, vias: [] }, detour);
  const cum = cumulative(detour);
  closeTo(p.runs[0].fromMeters, nearestAlong(joins[0], detour, cum).alongMeters, 5, "from the join before");
  closeTo(p.runs[0].toMeters, nearestAlong(joins[1], detour, cum, p.runs[0].fromMeters).alongMeters, 5, "to the join after");
  // Without joins (a stop the search placed) the old window stands.
  const q = plan({ ...ONE_WAY, vias: [stop] }, { ...ONE_WAY, vias: [] }, detour);
  assert.ok(q.runs[0].toMeters - q.runs[0].fromMeters <= 2 * EDIT_WINDOW_M + 1, "a window round the stop");
});

test("a point grabbed on the line and moved enters the ride where it was grabbed", () => {
  // Grabbed at 14 km, moved 500 m north. The target alone is nearest the line
  // at 14 km too here, so move it along as well: 600 m back towards Turaida
  // and 500 m north — its nearest point is ~13.4 km, but it was grabbed at 14.
  const grabbed: Point = [24.0 + 14_000 / M_PER_DEG_LON, LAT];
  const target: RidePlace = { ...at(13.4, 500, "Laukā"), grabbedAt: grabbed };
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, target] });
  assert.equal(p.kind, "add-stop");
  // Between Turaida and Cēsis, after the stop it was grabbed beyond.
  assert.equal(p.places.vias[1].name, "Laukā");
  const run = p.runs[0];
  // The window is centred on the grab point, sized by the 0.5-0.8 km move.
  closeTo(run.fromMeters, 11_000, 80, "3 km before the grab point");
  closeTo(run.toMeters, 17_000, 80, "3 km after it");
  assert.deepEqual(run.points[1], [target.lon, target.lat], "routed through the new spot");
});

test("a batch of added stops: each where the line passes it, one stretch per place, nearby ones routed together", () => {
  // Sigulda (0) → Turaida (8) → Cēsis (20); three stops added at once:
  // 4 km (between Sigulda and Turaida), 12 km and 13 km (both between
  // Turaida and Cēsis, windows overlap), each 300 m off the line.
  const a = at(4, 300, "A"), b = at(12, 300, "B"), c = at(13, 300, "C");
  // In the form they were appended before the finish in click order: C, A, B.
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, c, a, b] });
  assert.equal(p.kind, "add-stops");
  assert.deepEqual(p.places.vias.map((v) => v.name), ["A", "Turaida", "B", "C"], "in riding order along the line");
  assert.equal(p.runs.length, 2, "one stretch before Turaida, one after it for the two close stops");
  closeTo(p.runs[0].fromMeters, 1_000, 80, "A's window starts 3 km before it");
  closeTo(p.runs[0].toMeters, 7_000, 80, "and ends 3 km after");
  assert.equal(p.runs[1].points.length, 4, "join → B → C → join");
  closeTo(p.runs[1].fromMeters, 9_000, 80, "B's window, never before Turaida");
  closeTo(p.runs[1].toMeters, 16_000, 80, "C's window end");
});


/**
 * The rider's broken line (2026-09-25): three stops added close together
 * around one place, and the line drawn with a gap between two of them and an
 * orphan stub. These build that shape and pin the rule the page now enforces
 * — one continuous line through every place in order, or no edit at all.
 */
function routedAlong(points: Point[], startOffsetNorthM = 0): { segments: Segs; distanceMeters: number; durationSeconds: number } {
  // A routed stretch: straight between its points, optionally starting some
  // metres off the cut (the nudged / snapped endpoint that broke the ride).
  const shifted: Point[] = points.map((p, i) => (i === 0 ? [p[0], p[1] + startOffsetNorthM / M_PER_DEG_LAT] as Point : p));
  const dense: Point[] = [];
  for (let i = 1; i < shifted.length; i++) {
    const [a, b] = [shifted[i - 1], shifted[i]];
    const n = Math.max(1, Math.round(haversineMetersPoint(a, b) / 100));
    for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  dense.push(shifted[shifted.length - 1]);
  const segments = segmentsFor(dense);
  return { segments, distanceMeters: Math.round(lineMeters(dense)), durationSeconds: 600 };
}

test("three close stops, one stretch that starts off the cut: the break is caught, the whole span fixes it", () => {
  // Two stops 200 m apart and one beside Turaida (8 km), all 250 m off the line.
  const a = at(7.8, 250, "A"), b = at(8.4, 250, "B"), c = at(8.6, 250, "C");
  const after = { ...ONE_WAY, vias: [...ONE_WAY.vias, a, b, c] };
  const p = plan(ONE_WAY, after);
  assert.equal(p.kind, "add-stops");
  const base = { segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600 };
  // Every stretch routed where it was cut: one continuous line.
  const good = applyRuns({ ...base, runs: p.runs, routed: p.runs.map((r) => routedAlong(r.points)) });
  assert.deepEqual(lineBreaks(good.segments, SEGMENTS), []);
  assert.equal(spliceIsSound({ segments: good.segments, original: SEGMENTS, places: p.places, toleranceMeters: 500 }).ok, true);
  // The last stretch starts 120 m off its cut — a nudged endpoint: a break.
  const bad = applyRuns({ ...base, runs: p.runs, routed: p.runs.map((r, i) => routedAlong(r.points, i === p.runs.length - 1 ? 120 : 0)) });
  const breaks = lineBreaks(bad.segments, SEGMENTS);
  assert.ok(breaks.length >= 1 && breaks.every((x) => x.meters > JOIN_GAP_M), "caught at the join");
  assert.equal(spliceIsSound({ segments: bad.segments, original: SEGMENTS, places: p.places, toleranceMeters: 500 }).ok, false);
  // The fallback: one run from the place before the first stretch (Sigulda)
  // to the place after the last (Cēsis), through every stop in order.
  const span = spanRun({ line: LINE, cum: CUM, before: ONE_WAY, after: p.places, runs: p.runs });
  assert.deepEqual(span.points.slice(1, -1).map((pt) => p.places.vias.find((v) => v.lon === pt[0] && v.lat === pt[1])?.name), ["A", "Turaida", "B", "C"]);
  const fixed = applyRuns({ ...base, runs: [span], routed: [routedAlong(span.points)] });
  assert.equal(spliceIsSound({ segments: fixed.segments, original: SEGMENTS, places: p.places, toleranceMeters: 500 }).ok, true);
});

test("a stretch that came back empty leaves a hole the check refuses", () => {
  const stop = at(12, 300, "Laukā");
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, stop] });
  const empty = { segments: { type: "FeatureCollection" as const, features: [] }, distanceMeters: 0, durationSeconds: 0 };
  const holed = applyRuns({ segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600, runs: p.runs, routed: [empty] });
  const verdict = spliceIsSound({ segments: holed.segments, original: SEGMENTS, places: p.places, toleranceMeters: 500 });
  assert.equal(verdict.ok, false);
  assert.ok(!verdict.ok && verdict.breaks[0].meters > 5_000, "the removed slice is a hole, not a join");
});

test("a loop variant whose halves miss the stop's neighbours does not pass", () => {
  // Routed through the stop, but ending 200 m short of the far cut.
  const stop = at(12, 300, "Laukā");
  const p = plan(ONE_WAY, { ...ONE_WAY, vias: [...ONE_WAY.vias, stop] });
  const [from, via, to] = p.runs[0].points;
  const short: Point = [to[0] - 200 / M_PER_DEG_LON, to[1]];
  const routed = routedAlong([from, via, short]);
  const out = applyRuns({ segments: SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600, runs: p.runs, routed: [routed] });
  assert.equal(spliceIsSound({ segments: out.segments, original: SEGMENTS, places: p.places, toleranceMeters: 500 }).ok, false);
});

test("a gap the original ride already had is not the edit's", () => {
  const gapped: Segs = { type: "FeatureCollection", features: [SEGMENTS.features[0], ...SEGMENTS.features.slice(2)] };
  assert.equal(lineBreaks(gapped).length, 1, "the ride's own gap");
  assert.equal(lineBreaks(gapped, gapped).length, 0, "not counted against an edit of it");
});
