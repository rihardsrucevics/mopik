/**
 * Item 28: exact out-and-back excursions are removed on every ride — A to B
 * and sightseeing included — except where the excursion IS the visit to a
 * place the ride exists to reach.
 *
 *   npx tsx --test scripts/prune-spurs.test.ts
 *
 * Geometry is on a 0.01° grid near 57° N (≈ 605 m east-west, 1112 m
 * north-south), so tolerances below are in real metres.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneSpurs } from "../lib/routing/prune-spurs";
import { classifyRoute } from "../lib/routing/classify";
import type { RoutePath } from "../lib/types";

type P = [number, number];

/** A path over `coordinates` with one edge per segment, each tagged with its index. */
function pathOf(coordinates: P[], edge: (i: number) => Partial<RoutePath["edges"][number]> = () => ({})): RoutePath {
  return {
    coordinates,
    distanceMeters: 10000,
    durationSeconds: 1000,
    elevations: coordinates.map((_, i) => i * 10),
    edges: coordinates.slice(1).map((_, i) => ({
      beginShapeIndex: i,
      endShapeIndex: i + 1,
      use: "track",
      tags: { highway: "track", tracktype: "grade2", marker: String(i + 1) },
      ...edge(i),
    })),
  };
}

// The through road A–B–C–D–E runs east. F and G go north from C: a dead end.
const A: P = [24.0, 57.0], B: P = [24.01, 57.0], C: P = [24.02, 57.0], D: P = [24.03, 57.0], E: P = [24.04, 57.0];
const F: P = [24.02, 57.005], G: P = [24.02, 57.01];

test("a generated via's out-and-back is removed from an A-to-B ride", () => {
  // The Circle K → Jelgava shape: out along C-F-G and back, then on.
  const path = pathOf([A, B, C, F, G, F, C, D, E]);
  const clean = pruneSpurs(path, { protect: [E], requireCircuit: false });
  assert.deepEqual(clean.coordinates, [A, B, C, D, E]);
  // Surviving segments keep their ORIGINAL edges: C→D was edge 7.
  assert.deepEqual(clean.edges.map((e) => e.tags?.marker), ["1", "2", "7", "8"]);
  assert.deepEqual(clean.elevations, [0, 10, 20, 70, 80]);
  assert.deepEqual(pruneSpurs(clean, { protect: [E], requireCircuit: false }), clean);
});

test("a rider-named stop at the end of a dead end keeps its spur", () => {
  // The farmstead is at G; the through road passes it 1.1 km away at C.
  const path = pathOf([A, B, C, F, G, F, C, D, E]);
  const clean = pruneSpurs(path, { protect: [G, E], toleranceMeters: 300, requireCircuit: false });
  assert.equal(clean, path, "nothing removed, nothing rebuilt");
  // Just off the lane still counts: 200 m east of G, inside the 300 m tolerance.
  const nearG: P = [G[0] + 0.0033, G[1]];
  assert.equal(pruneSpurs(path, { protect: [nearG], requireCircuit: false }), path);
});

test("only the spur that is the visit is kept; a second, generated one still goes", () => {
  // Farmstead spur C-F-G-F-C, then a generated spur D-X-Y-X-D further on.
  const X: P = [24.03, 56.995], Y: P = [24.03, 56.99];
  const path = pathOf([A, B, C, F, G, F, C, D, X, Y, X, D, E]);
  const clean = pruneSpurs(path, { protect: [G, E], requireCircuit: false });
  assert.deepEqual(clean.coordinates, [A, B, C, F, G, F, C, D, E]);
});

test("a stop part-way along a generated spur: ride in as far as the stop, not to the via", () => {
  // The named place is 50 m past F; the via that made the spur was at G.
  const place: P = [F[0], F[1] + 0.00045];
  const path = pathOf([A, B, C, F, G, F, C, D, E]);
  const clean = pruneSpurs(path, { protect: [place, E], requireCircuit: false });
  assert.deepEqual(clean.coordinates, [A, B, C, F, G, F, C, D, E], "closest point is on F-G, so G is the first vertex past it");
  const beyond: P = [24.02, 57.015];
  const long = pathOf([A, B, C, F, G, beyond, G, F, C, D, E]);
  const cut = pruneSpurs(long, { protect: [place, E], requireCircuit: false });
  assert.deepEqual(cut.coordinates, [A, B, C, F, G, F, C, D, E]);
  // The way back from G keeps its own original edge (G→F was edge 7).
  assert.deepEqual(cut.edges.map((e) => e.tags?.marker), ["1", "2", "3", "4", "7", "8", "9", "10"]);
});

test("a spur beside a named stop goes when the ride's own road reaches the stop closer", () => {
  // The named village is at C, on the through road; the dead end starts there
  // and passes within 300 m of C on its first 555 m, but the road the ride
  // keeps goes through C itself.
  const path = pathOf([A, B, C, F, G, F, C, D, E]);
  const clean = pruneSpurs(path, { protect: [C, E], requireCircuit: false });
  assert.deepEqual(clean.coordinates, [A, B, C, D, E]);
});

test("the approach to a destination on a dead end is never cut", () => {
  // One way: the destination G is at the end of the lane from C. Nothing is
  // ridden back, so there is nothing to remove — and a generated spur on the
  // way still goes.
  const X: P = [24.01, 56.995];
  const oneWay = pathOf([A, B, X, B, C, F, G]);
  const clean = pruneSpurs(oneWay, { protect: [G], requireCircuit: false });
  assert.deepEqual(clean.coordinates, [A, B, C, F, G]);
  assert.deepEqual(clean.coordinates.at(-1), G);
  // Round trip from a start at the end of a lane: the access corridor out and
  // back is not an excursion, because a real circuit hangs off it.
  const H: P = [24.03, 57.005];
  const roundTrip = pathOf([G, F, C, D, H, C, F, G]);
  assert.equal(pruneSpurs(roundTrip), roundTrip);
});

test("an A-to-B ride may shrink below four points; a free loop that does is refused", () => {
  const oneWay = pathOf([A, B, F, B, E]);
  assert.deepEqual(pruneSpurs(oneWay, { requireCircuit: false }).coordinates, [A, B, E]);
  assert.throws(() => pruneSpurs(pathOf([A, B, C, B, A])), /no circuit/);
});

test("distance, time, surface and overlap are measured on what is left", () => {
  // The spur is a grade5 track; the ride is asphalt.
  const path = pathOf([A, B, C, F, G, F, C, D, E], (i): Partial<RoutePath["edges"][number]> =>
    i >= 2 && i < 6
      ? { use: "track", surface: "dirt", tags: { highway: "track", tracktype: "grade5", surface: "dirt" } }
      : { use: "tertiary", surface: "asphalt", tags: { highway: "tertiary", surface: "asphalt" } }
  );
  const before = classifyRoute(path);
  const clean = pruneSpurs(path, { requireCircuit: false });
  const after = classifyRoute(clean);
  // 4 × 605 m of road kept out of 4 × 605 m + 4 × 556 m ridden.
  const kept = 4 * 0.605, ridden = kept + 4 * 0.556;
  assert.ok(Math.abs(clean.distanceMeters - 10000 * (kept / ridden)) < 60, `${clean.distanceMeters}`);
  assert.ok(clean.durationSeconds < path.durationSeconds);
  assert.ok(Math.abs(clean.edges.reduce((s, e) => s + (e.lengthKm ?? 0), 0) - kept) < 0.01);
  assert.ok(after.durationSeconds < before.durationSeconds);
  assert.ok(before.overlap.repeatedKm > 1, "the spur's way back counts as repeated before");
  assert.equal(after.overlap.repeatedKm, 0);
  assert.equal(after.surfaces.asphaltPercent, 100);
  assert.ok(before.surfaces.asphaltPercent < 60);
});
