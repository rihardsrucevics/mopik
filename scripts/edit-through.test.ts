import test from "node:test";
import assert from "node:assert/strict";
import {
  EDIT_WINDOW_M,
  LOOP_EXTRA_FLOOR_M,
  LOOP_EXTRA_PER_SHARED,
  THROUGH_SHARED_MIN_M,
  anchorsAlong,
  anchorsOf,
  chooseLoop,
  nogosAlong,
  planEdit,
  sharedRoad,
  shapeFlags,
  spurBaseIndex,
  type EditPlan,
  type RidePlace,
  type RidePlaces,
} from "../lib/routing/reroute-leg";
import { cumulative, lineMeters } from "../lib/routing/detour";
import { haversineMeters } from "../lib/geo/geometry";
import type { Point } from "../lib/geo/geometry";

/**
 * A stop the rider adds is ridden THROUGH, not out to and back (rider,
 * 2026-09-25: „pievienotās pieturvietas atkal veidojas kā atzari”).
 *
 * `npx tsx --test scripts/edit-through.test.ts`
 *
 * The routing half (`routeThroughPlaces`, BRouter) is measured on his ride
 * by `scripts/measure-edit-through.ts`; these pin the arithmetic it rests on:
 *
 * 1. A stretch never stops ON a place that sits at the tip of an
 *    out-and-back: it reaches past it and takes it in, or that spur can never
 *    be ridden through (his stop 2, a 650 m spur, with stops added beside it).
 * 2. A shaping point's spur is cut at its base.
 * 3. Short spurs are fenced at all, and a loop is not refused for costing
 *    more than a short spur's length.
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const M_PER_DEG_LAT = 110_540;
const E = (m: number) => 24.0 + m / M_PER_DEG_LON;
const N = (m: number) => LAT + m / M_PER_DEG_LAT;

/** Vertices every 100 m (every 50 m on the spur) along the given east/north legs, in metres. */
function polyline(...corners: [number, number][]): Point[] {
  const out: Point[] = [];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1], [bx, by] = corners[i];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / 50));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) out.push([E(ax + ((bx - ax) * k) / n), N(ay + ((by - ay) * k) / n)]);
  }
  return out;
}

/**
 * Sigulda (0) → east 8 km → a 600 m out-and-back north to „Galā” and back
 * down the same road → east to Cēsis (20 km). Exactly the rider's stop 2.
 */
const SPUR_LINE = polyline([0, 0], [8_000, 0], [8_000, 600], [8_000, 0], [20_000, 0]);
const place = (name: string, x: number, y = 0): RidePlace => ({ name, label: name, lat: N(y), lon: E(x) });
const TIP = place("Galā", 8_000, 600);
const RIDE: RidePlaces = { start: place("Sigulda", 0), vias: [TIP], finish: place("Cēsis", 20_000), roundTrip: false };

function planOn(line: Point[], before: RidePlaces, after: RidePlaces): EditPlan {
  const p = planEdit({ line, cum: cumulative(line), before, after });
  assert.ok(p && !("error" in p), "the edit must produce a plan");
  return p;
}
const has = (points: Point[], p: RidePlace) => points.some(([lon, lat]) => Math.abs(lon - p.lon) < 1e-9 && Math.abs(lat - p.lat) < 1e-9);

test("the fixture: the stop is the tip of a 600 m out-and-back", () => {
  const cum = cumulative(SPUR_LINE);
  const along = anchorsAlong(anchorsOf(RIDE, SPUR_LINE[SPUR_LINE.length - 1]), SPUR_LINE, cum);
  assert.ok(Math.abs(along[1] - 8_600) < 15, `the tip is 8.6 km along, got ${along[1]}`);
  assert.ok(Math.abs(lineMeters(SPUR_LINE) - 21_200) < 40);
});

test("a stop added before a spur's tip stop re-routes past that stop, taking it in", () => {
  const added = place("Pirms", 6_000, 40);
  const p = planOn(SPUR_LINE, RIDE, { ...RIDE, vias: [added, TIP] });
  assert.equal(p.kind, "add-stop");
  assert.equal(p.runs.length, 1);
  const run = p.runs[0];
  assert.ok(has(run.points, added) && has(run.points, TIP), "join → Pirms → Galā → join");
  assert.equal(run.points.length, 4);
  assert.ok(has([run.points[1]], added) && has([run.points[2]], TIP), "in the order the line reaches them");
  // Past the tip by the spur's length and a window: the stretch ends on the
  // far side of the spur's base, so the way out can be another road.
  assert.ok(run.toMeters > 8_600 + 600, `ends past the spur's base, got ${run.toMeters}`);
  assert.ok(Math.abs(run.toMeters - (8_600 + 600 + EDIT_WINDOW_M)) < 60, `spur + one window past the tip, got ${run.toMeters}`);
});

test("a stop added ON the spur takes the tip stop in too — the rider's stops 4 and 5", () => {
  // Half-way up the spur, on its way in (8.3 km along).
  const added = place("Uz atzara", 8_000, 300);
  const p = planOn(SPUR_LINE, RIDE, { ...RIDE, vias: [added, TIP] });
  const run = p.runs[0];
  assert.ok(has(run.points, TIP), "the tip stop is ridden through in the same stretch");
  assert.ok(run.fromMeters < 8_300 && run.toMeters > 9_200);
});

test("moving a stop beside a spur's tip stop re-routes through the tip stop as well", () => {
  const cesis = place("Cēsis", 20_000);
  const near = place("Blakus", 10_000, 0);
  const ride: RidePlaces = { ...RIDE, vias: [TIP, near], finish: cesis };
  const moved = { ...near, lat: N(80) };
  const p = planOn(SPUR_LINE, ride, { ...ride, vias: [TIP, moved] });
  assert.equal(p.kind, "move-stop");
  const run = p.runs[0];
  assert.ok(has(run.points, TIP), "the stretch reaches back past the spur, through its tip");
  assert.ok(run.fromMeters < 8_000, `starts before the spur's base, got ${run.fromMeters}`);
});

test("a neighbour on a through road still bounds the stretch, as before", () => {
  const line = polyline([0, 0], [20_000, 0]);
  const turaida = place("Turaida", 8_000);
  const ride: RidePlaces = { ...RIDE, vias: [turaida] };
  const p = planOn(line, ride, { ...ride, vias: [place("Pirms", 6_500, 40), turaida] });
  const run = p.runs[0];
  assert.equal(run.points.length, 3, "join → Pirms → join: Turaida is not taken in");
  const turaidaAlong = anchorsAlong(anchorsOf(ride, line[line.length - 1]), line, cumulative(line))[1];
  assert.ok(Math.abs(run.toMeters - turaidaAlong) < 1, `stops at Turaida, got ${run.toMeters}`);
});

test("a batch on both sides of a spur's tip stop is one stretch through all of them", () => {
  const a = place("A", 6_000, 40), b = place("B", 10_000, 40);
  const p = planOn(SPUR_LINE, RIDE, { ...RIDE, vias: [a, TIP, b] });
  assert.equal(p.kind, "add-stops");
  assert.equal(p.runs.length, 1, "the two pieces meet through the tip stop");
  const pts = p.runs[0].points;
  assert.equal(pts.length, 5, "join → A → Galā → B → join");
  assert.ok(has([pts[1]], a) && has([pts[2]], TIP) && has([pts[3]], b));
});

test("where a spur begins on the way in: the index a shaping point is moved to", () => {
  const approach = polyline([0, 0], [1_000, 0], [1_000, 300]); // east, then up a 300 m spur
  const departure = [...polyline([1_000, 0], [1_000, 300])].reverse().concat(polyline([1_000, 0], [2_000, 0]).slice(1));
  const base = spurBaseIndex(approach, departure);
  assert.ok(haversineMeters(approach[base], [E(1_000), N(0)]) < 1, "the junction at 1 km");
  assert.ok(sharedRoad(approach, departure).meters > 290);
  // No spur: the last vertex.
  const through = polyline([1_000, 300], [1_000, 600]);
  assert.equal(spurBaseIndex(approach, through), approach.length - 1);
});

test("a stretch's points are flagged where they are shaping points, and only there", () => {
  const dot: RidePlace = { ...place("", 6_000, 0), name: "", label: "", shape: true };
  const places: RidePlaces = { ...RIDE, vias: [dot, TIP] };
  const flags = shapeFlags({ fromMeters: 0, toMeters: 1, points: [[E(5_000), N(0)], [dot.lon, dot.lat], [TIP.lon, TIP.lat], [E(9_000), N(0)]] }, places);
  assert.deepEqual(flags, [false, true, false, false]);
});

test("a short spur is fenced: the fences keep off the place by little more than their radius", () => {
  const spur = polyline([0, 0], [0, 200]); // 200 m, the place at its top
  const top: Point = spur[spur.length - 1];
  const wide = nogosAlong(spur, [top, spur[0]]);
  assert.equal(wide.length, 0, "the old 250 m clearance left a 200 m spur unfenced");
  const near = nogosAlong(spur, [top, spur[0]], { keepClearM: [80, 250], spacingM: 60 });
  assert.equal(near.length, 0, "…and the join's 250 m still covers all of a 200 m spur from its base");
  const longer = polyline([0, 0], [0, 450]);
  const fenced = nogosAlong(longer, [longer[longer.length - 1], longer[0]], { keepClearM: [80, 250], spacingM: 60 });
  assert.ok(fenced.length >= 2, `a 450 m spur is fenced between 250 m and 370 m, got ${fenced.length}`);
  for (const n of fenced) assert.ok(haversineMeters([n.lon, n.lat], longer[longer.length - 1]) >= 80);
});

test("a loop round a short spur is not refused for costing more than the spur", () => {
  const road = polyline([0, 0], [0, 300]);
  const base = { approach: { coordinates: road, distanceMeters: 300 }, departure: { coordinates: [...road].reverse(), distanceMeters: 300 } };
  // Out another way: 1.2 km more than riding back — more than the 300 m the
  // old per-metre bound allowed, within the floor.
  const around = polyline([0, 300], [600, 300], [600, 0], [0, 0]);
  const loop = { approach: base.approach, departure: { coordinates: around, distanceMeters: Math.round(lineMeters(around)) } };
  assert.ok(lineMeters(around) - 300 > LOOP_EXTRA_PER_SHARED * 300, "the old bound would refuse it");
  assert.ok(lineMeters(around) - 300 <= LOOP_EXTRA_FLOOR_M);
  assert.equal(chooseLoop(base, [loop]).index, 0, "the loop is taken");
  assert.ok(sharedRoad(road, [...road].reverse()).meters > THROUGH_SHARED_MIN_M, "and the spur was over the threshold that asks for one");
});
