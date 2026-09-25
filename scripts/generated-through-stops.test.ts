/**
 * A generated ride's own stops are ridden through, not reached by an
 * out-and-back (2026-09-25) — `rideThroughStops`, with the router faked.
 *
 *   npx tsx --test scripts/generated-through-stops.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { rideThroughStops, stopSpurs } from "../lib/routing/generated-through-stops";
import { recomputeOverlap } from "../lib/routing/reroute-leg";
import type { RoutePath } from "../lib/types";

type P = [number, number];
/** A point `x` metres east and `y` metres north of 24.0 E, 57.0 N. */
const m = (x: number, y: number): P => [24 + x / (111195 * Math.cos((57 * Math.PI) / 180)), 57 + y / 111195];
const pathOf = (coordinates: P[], marker = "ride"): RoutePath => ({
  coordinates,
  distanceMeters: 10_000,
  durationSeconds: 1_000,
  edges: coordinates.slice(1).map((_, i) => ({ beginShapeIndex: i, endShapeIndex: i + 1, use: "track", tags: { highway: "track", marker } })),
});
const steps = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let v = from; step > 0 ? v <= to : v >= to; v += step) out.push(v);
  return out;
};

// The ride runs east along y = 0 for 10 km; the rider's stop is 800 m up a
// lane from (5000, 0), ridden in and out over the same vertices.
const STOP = m(5000, 800);
const lane = steps(100, 700, 100).map((y) => m(5000, y));
const spurRide: P[] = [
  ...steps(0, 5000, 250).map((x) => m(x, 0)),
  ...lane, STOP, ...[...lane].reverse(),
  ...steps(5000, 10000, 250).map((x) => m(x, 0)),
];

/** A router that rides from the window's start to the stop and on by the other side of a block. */
const loopRouter = (calls: P[][]) => async ({ points }: { points: P[] }) => {
  calls.push(points);
  const [from, tip, to] = points;
  return {
    path: pathOf([from, m(3000, 0), m(4000, 0), m(4500, 400), tip, m(5500, 400), m(6000, 0), m(7000, 0), to], "loop"),
    deadEndMeters: 0,
  };
};

test("a stop at the end of a lane is ridden through when the map has a way round", async () => {
  assert.equal(Math.round(stopSpurs(spurRide, [STOP])[0].spur), 800);
  const calls: P[][] = [];
  const result = await rideThroughStops({
    path: pathOf(spurRide), stops: [STOP], profileOptions: {} as never, deadlineAt: Date.now() + 5_000,
    through: loopRouter(calls) as never,
  });
  // The window: 3 km before the lane's base to 3 km after it, through the
  // ride's own vertex at the stop.
  assert.equal(calls.length, 1);
  assert.equal(calls[0].length, 3);
  assert.deepEqual(calls[0][1], STOP);
  const east = (p: P) => (p[0] - 24) * 111195 * Math.cos((57 * Math.PI) / 180);
  assert.ok(Math.abs(east(calls[0][0]) - 2000) <= 260 && Math.abs(east(calls[0][2]) - 8000) <= 260, JSON.stringify(calls[0].map(east)));
  assert.deepEqual(result.spurs, [{ stop: 0, beforeMeters: 800, afterMeters: 0 }]);
  assert.equal(result.deadEndMeters, 0);
  assert.equal(recomputeOverlap(result.path.coordinates).repeatedKm, 0);
  // The ride outside the window is its own, with its own edges.
  assert.deepEqual(result.path.coordinates.slice(0, 9), steps(0, 2000, 250).map((x) => m(x, 0)));
  assert.equal(result.path.edges[0].tags?.marker, "ride");
  assert.ok(result.path.edges.some((e) => e.tags?.marker === "loop"));
  assert.deepEqual(result.path.coordinates.at(-1), m(10000, 0));
});

test("a real dead end keeps its out-and-back, and says how long it is", async () => {
  // The fenced router finds nothing better: the same lane back.
  const same = async ({ points }: { points: P[] }) => ({
    path: pathOf([points[0], ...steps(2250, 5000, 250).map((x) => m(x, 0)), ...lane, STOP, ...[...lane].reverse(), ...steps(5000, 8000, 250).map((x) => m(x, 0))]),
    deadEndMeters: 800,
  });
  const path = pathOf(spurRide);
  const kept = await rideThroughStops({ path, stops: [STOP], profileOptions: {} as never, deadlineAt: Date.now() + 5_000, through: same as never });
  assert.equal(kept.path, path);
  assert.equal(kept.deadEndMeters, 800);
  // A way round that is a detour — 12 km for a 1.6 km out-and-back — is not taken either.
  const detour = async ({ points }: { points: P[] }) => ({
    path: pathOf([points[0], m(2000, 3000), m(5000, 6000), points[1], m(8000, 6000), points[2]]),
    deadEndMeters: 0,
  });
  const long = await rideThroughStops({ path, stops: [STOP], profileOptions: {} as never, deadlineAt: Date.now() + 5_000, through: detour as never });
  assert.equal(long.path, path);
  assert.equal(long.deadEndMeters, 800);
});

test("out of time, or no spur, the ride is left exactly as it was", async () => {
  const calls: P[][] = [];
  const path = pathOf(spurRide);
  const late = await rideThroughStops({ path, stops: [STOP], profileOptions: {} as never, deadlineAt: Date.now() - 1, through: loopRouter(calls) as never });
  assert.equal(late.path, path);
  assert.equal(calls.length, 0);
  // A stop on the through road itself.
  const onRoad = await rideThroughStops({ path, stops: [m(2000, 10)], profileOptions: {} as never, deadlineAt: Date.now() + 5_000, through: loopRouter(calls) as never });
  assert.equal(onRoad.path, path);
  assert.equal(calls.length, 0);
  // A router that never answers does not hold the ride past its deadline.
  const started = Date.now();
  const hung = await rideThroughStops({ path, stops: [STOP], profileOptions: {} as never, deadlineAt: Date.now() + 200, through: (() => new Promise(() => {})) as never });
  assert.equal(hung.path, path);
  assert.ok(Date.now() - started < 1_000);
});

test("a window that would ride past the rider's shaping point is left alone", async () => {
  const calls: P[][] = [];
  const path = pathOf(spurRide);
  const kept = await rideThroughStops({
    path, stops: [STOP], keep: [m(3000, 0)], profileOptions: {} as never, deadlineAt: Date.now() + 5_000, through: loopRouter(calls) as never,
  });
  assert.equal(kept.path, path);
  assert.equal(calls.length, 0);
  assert.equal(kept.deadEndMeters, 800);
});

test("two stops close together are each ridden through, one pass after the other", async () => {
  // Lanes at x = 5000 and x = 6500, 800 m up each: their windows overlap.
  const A = m(5000, 800), B = m(6500, 800);
  const laneAt = (x: number) => steps(100, 700, 100).map((y) => m(x, y));
  const ride: P[] = [
    ...steps(0, 5000, 250).map((x) => m(x, 0)), ...laneAt(5000), A, ...laneAt(5000).reverse(),
    ...steps(5250, 6500, 250).map((x) => m(x, 0)), ...laneAt(6500), B, ...laneAt(6500).reverse(),
    ...steps(6750, 12000, 250).map((x) => m(x, 0)),
  ];
  const east = (p: P) => (p[0] - 24) * 111195 * Math.cos((57 * Math.PI) / 180);
  const calls: P[][] = [];
  // Round a block: from the window's start to 500 m short of the lane, up
  // to the stop, and down to the road 500 m past it.
  const round = async ({ points }: { points: P[] }) => {
    calls.push(points);
    const [from, tip, to] = points;
    const x = east(tip);
    // A window that ends at the other stop reaches it up its lane, as a
    // router would: that stop keeps its spur for the next pass.
    const up = to[1] > 57.001 ? [m(east(to), 0), ...laneAt(Math.round(east(to)))] : [];
    return { path: pathOf([from, m(x - 500, 0.5), tip, m(x + 500, 0.5), ...up, to], "loop"), deadEndMeters: 0 };
  };
  const result = await rideThroughStops({ path: pathOf(ride), stops: [A, B], profileOptions: {} as never, deadlineAt: Date.now() + 5_000, through: round as never });
  assert.deepEqual(result.spurs.map((s) => s.afterMeters), [0, 0]);
  assert.equal(calls.length, 2, "one window per stop, in two passes");
  // Neither window reaches past the other stop.
  for (const c of calls) {
    const x = Math.round(east(c[1]));
    assert.ok(x === 5000 ? east(c[2]) <= 6500 + 1 : east(c[0]) >= 5000 - 1, JSON.stringify(c.map(east)));
  }
  assert.equal(recomputeOverlap(result.path.coordinates).repeatedKm, 0);
});
