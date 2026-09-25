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

// ---------------------------------------------------------------------------
// Near mirrors (item 28, second pass): the way back is a parallel way a few
// metres off, so no vertex repeats — the rider's Daugavgrīvas iela → Mālpils
// šoseja ride, 1.62 km out and back through a forest near Zušu purvs, read 3 %.
// ---------------------------------------------------------------------------

import { acceptSpurLoop, nearMirrorCut, pruneOrLoopSpurs, revisitedMeters, SpurLoopBudget, type Nogo } from "../lib/routing/prune-spurs";

/** A point `x` metres east and `y` metres north of 24.0 E, 57.0 N. */
const m = (x: number, y: number): P => [24 + x / (111195 * Math.cos((57 * Math.PI) / 180)), 57 + y / 111195];
const ys = (from: number, to: number, step: number) => {
  const out: number[] = [];
  for (let y = from; step > 0 ? y <= to : y >= to; y += step) out.push(y);
  if (out.at(-1) !== to) out.push(to);
  return out;
};
const lineMeters = (line: P[]) => line.slice(1).reduce((s, p, i) => s + Math.hypot(
  (p[0] - line[i][0]) * 111195 * Math.cos((57 * Math.PI) / 180), (p[1] - line[i][1]) * 111195), 0);

// The through road runs east along y = 0; the spur goes north from C (1000, 0)
// to a tip 1 km up, out on x = 1000 every 100 m and back on a parallel way
// `offset` metres east every 70 m, which rejoins the road at C itself.
const RA = m(0, 0), RB = m(500, 0), RC = m(1000, 0), RD = m(1500, 0), RE = m(2000, 0), RF = m(2500, 0), RG = m(3000, 0);
const TIP = m(1000, 1000);
function nearMirrorRide(offset: number): P[] {
  const out = ys(100, 900, 100).map((y) => m(1000, y));
  const back = ys(930, 70, -70).map((y) => m(1000 + offset, y));
  return [RA, RB, RC, ...out, TIP, ...back, RC, RD, RE, RF, RG];
}

test("a near-mirror spur — the way back 5–15 m off, other vertices — is cut at the base", () => {
  for (const offset of [5, 10, 15]) {
    const line = nearMirrorRide(offset);
    const path = pathOf(line);
    const clean = pruneSpurs(path, { protect: [RG], requireCircuit: false });
    assert.deepEqual(clean.coordinates, [RA, RB, RC, RD, RE, RF, RG], `offset ${offset} m`);
    // The ride continues from C over C→D's own edge (the last one of the spur's way back is gone).
    const cd = line.findIndex((p, i) => i > 3 && p === RD);
    assert.deepEqual(clean.edges.map((e) => e.tags?.marker), ["1", "2", String(cd), String(cd + 1), String(cd + 2), String(cd + 3)]);
    const ridden = lineMeters(line), kept = lineMeters(clean.coordinates);
    assert.ok(Math.abs(clean.distanceMeters - 10000 * (kept / ridden)) < 1, `${clean.distanceMeters}`);
    assert.ok(Math.abs(kept - 3000) < 1);
    // The panel's figure could not see it; the geometric one could.
    assert.equal(classifyRoute(path).overlap.repeatedKm, 0, "no vertex pair repeats");
    assert.ok(revisitedMeters(line) > 600, `${revisitedMeters(line)}`);
    assert.ok(revisitedMeters(clean.coordinates) === 0);
  }
});

test("a spur partly on the same vertices and partly on a parallel way goes whole", () => {
  // The rider's shape: 600 m in and out over identical vertices, then the
  // last 400 m out on one track and back on another 12 m east.
  const shared = ys(100, 600, 100).map((y) => m(1000, y));
  const outTop = ys(700, 900, 100).map((y) => m(1000, y));
  const backTop = ys(950, 650, -50).map((y) => m(1012, y));
  const line = [RA, RB, RC, ...shared, ...outTop, TIP, ...backTop, ...[...shared].reverse(), RC, RD, RE];
  const clean = pruneSpurs(pathOf(line), { requireCircuit: false });
  assert.deepEqual(clean.coordinates, [RA, RB, RC, RD, RE]);
});

test("two parallel roads 30–60 m apart are not a spur, even ridden out on one and back on the other", () => {
  // A divided road: east on the southern carriageway from J to the turn at
  // (2000, 0), across, and west on the northern one back to J's longitude,
  // then down through J again and on. J is a shared vertex, so only the
  // distance between the carriageways decides.
  for (const gap of [30, 40, 60]) {
    const J = m(1000, 0);
    const east = ys(1100, 2000, 100).map((x) => m(x, 0));
    const west = ys(1950, 1000, -75).map((x) => m(x, gap));
    const line = [m(0, 0), m(500, 0), J, ...east, ...west, J, m(1000, -500), m(1000, -1000)];
    const path = pathOf(line);
    assert.equal(pruneSpurs(path, { requireCircuit: false }), path, `gap ${gap} m`);
  }
  // And two roads side by side ridden the same way, one after the other.
  const loop = [m(0, 0), ...ys(100, 2000, 100).map((x) => m(x, 0)), m(2000, 40), m(2000, 500), m(0, 500), m(0, 40),
    ...ys(100, 1900, 100).map((x) => m(x, 40)), m(2500, 40)];
  assert.equal(pruneSpurs(pathOf(loop), { requireCircuit: false }).coordinates.length, loop.length);
});

test("a hairpin whose legs never share a vertex is never cut; nor a block ridden round", () => {
  // Legs 20 m apart for 500 m: a switchback, not a spur, and cutting it would
  // have to invent a 20 m road across the slope.
  const hairpin = [m(-500, -500), m(0, 0), ...ys(100, 500, 100).map((y) => m(0, y)), m(10, 515),
    ...ys(500, 0, -100).map((y) => m(20, y)), m(520, -500)];
  const path = pathOf(hairpin);
  assert.equal(pruneSpurs(path, { requireCircuit: false }), path);
  // A 420 m triangle of residential streets that closes at an acute corner,
  // as a Sigulda ride measured it (the corner vertex is ridden twice).
  const block: P[] = [[24.851132, 57.161579], [24.851225, 57.161471], [24.851053, 57.161471], [24.850978, 57.161471],
    [24.850485, 57.161493], [24.850429, 57.161535], [24.849784, 57.162015], [24.849254, 57.162386], [24.849083, 57.162468],
    [24.849053, 57.162404], [24.849001, 57.161658], [24.848985, 57.161559], [24.850485, 57.161493], [24.850978, 57.161471],
    [24.851053, 57.161471], [24.851225, 57.161471], [24.851356, 57.161472]];
  const blockPath = pathOf(block);
  // The stub to it is ridden in and out too, but it leads to a circuit, and
  // an access corridor to a circuit is left alone (A-B-C-D-B-A).
  assert.equal(pruneSpurs(blockPath, { requireCircuit: false }), blockPath);
  assert.equal(pruneSpurs(blockPath, { requireCircuit: false }), blockPath);
});

test("a rider's stop at the tip of a near-mirror spur keeps it", () => {
  const path = pathOf(nearMirrorRide(10));
  assert.equal(pruneSpurs(path, { protect: [TIP, RG], toleranceMeters: 300, requireCircuit: false }), path);
  // 200 m off the tip, still inside the stop tolerance and closer than the road.
  assert.equal(pruneSpurs(path, { protect: [m(1200, 1000), RG], requireCircuit: false }), path);
  // A stop on the through road does not protect the spur.
  assert.deepEqual(pruneSpurs(path, { protect: [RD, RG], requireCircuit: false }).coordinates, [RA, RB, RC, RD, RE, RF, RG]);
});

test("nearMirrorCut reports the base on both legs and the turn", () => {
  const line = nearMirrorRide(10);
  const cut = nearMirrorCut(line);
  assert.ok(cut);
  assert.equal(line[cut.a], RC);
  assert.equal(line[cut.b], RC);
  assert.equal(line[cut.tip], TIP);
});

// ---------------------------------------------------------------------------
// A loop instead of the cut, when one is cheap
// ---------------------------------------------------------------------------

test("the loop rule: at most 1.5 × the out-and-back plus what it rejoins beyond, and little ridden twice", () => {
  // The rider's spur, measured: 3232 m in and out; routed from the tip with
  // the way in fenced off, back to the base is 5504 m, to the ride 3 km on is 3733 m.
  const spur = { outAndBackMeters: 3232 };
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 0, loopMeters: 1616 + 5504, addedRevisitMeters: 0 }), false, "7.1 km for a 3.2 km out-and-back");
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 3048, loopMeters: 1616 + 3733, addedRevisitMeters: 0 }), true);
  // Exactly the bound: 1.5 × 3232 plus the skipped ride.
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 1000, loopMeters: 1000 + 4848, addedRevisitMeters: 0 }), true);
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 1000, loopMeters: 1000 + 4849, addedRevisitMeters: 0 }), false);
  // Riding the same road twice is what the loop is for not doing.
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 0, loopMeters: 3500, addedRevisitMeters: 300 }), true);
  assert.equal(acceptSpurLoop({ ...spur, skippedMeters: 0, loopMeters: 3500, addedRevisitMeters: 301 }), false);
  // A short spur may not be swapped for a shorter out-and-back.
  assert.equal(acceptSpurLoop({ outAndBackMeters: 700, skippedMeters: 0, loopMeters: 800, addedRevisitMeters: 200 }), false);
});

/**
 * A router that answers only "from the tip back to the road further east"
 * (the ride past the base), through `via(rejoin)`; everything else is
 * refused, as a fenced request with no other way is.
 */
function fakeRouter(via: (rejoin: P) => P[]) {
  const calls: { points: P[]; nogos: Nogo[] }[] = [];
  const route = async (points: P[], nogos: Nogo[]) => {
    calls.push({ points, nogos });
    const [from, to] = points;
    if (lineMeters([from, TIP]) > 1 || to[1] !== 57 || to[0] <= RC[0]) throw new Error("BRouter routing failed (400): no route");
    return pathOf([TIP, ...via(to), to], () => ({ tags: { highway: "track", marker: "loop" } }));
  };
  return { calls, route };
}
/** Straight east from the tip, then down to where the ride is rejoined. */
const eastThenDown = (height: number) => (to: P): P[] => [[to[0], TIP[1] + (height - 1000) / 111195]];
const viaNearTip = m(1030, 1040);

test("a spur that turned at a generated via becomes a loop when a cheap one exists", async () => {
  const path = pathOf(nearMirrorRide(10));
  const router = fakeRouter(eastThenDown(1000));
  const looped = await pruneOrLoopSpurs(path, {
    protect: [RG], requireCircuit: false,
    loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: router.route, budget: new SpurLoopBudget() },
  });
  // Out to the tip as before, then through the forest back to the road
  // further on, never back down the way in.
  const outLeg = ys(100, 900, 100).map((y) => m(1000, y));
  const at = looped.coordinates.indexOf(TIP);
  assert.deepEqual(looped.coordinates.slice(0, at + 1), [RA, RB, RC, ...outLeg, TIP]);
  const rejoin = looped.coordinates[at + 2];
  assert.deepEqual(looped.coordinates.slice(at + 1), [[rejoin[0], TIP[1]], rejoin, ...[RE, RF, RG].filter((p) => p[0] > rejoin[0])]);
  assert.equal(revisitedMeters(looped.coordinates), 0);
  assert.ok(looped.edges.some((e) => e.tags?.marker === "loop"), "the loop keeps its own tags");
  // Every request fenced the way in off, clear of the tip.
  assert.ok(router.calls.length > 0 && router.calls.length <= 2);
  for (const call of router.calls) {
    assert.ok(call.nogos.length > 0);
    for (const n of call.nogos) assert.ok(lineMeters([[n.lon, n.lat], TIP]) >= 250);
  }
  // Distance: the original's share for what is kept, the loop's own for itself.
  assert.ok(looped.distanceMeters > 10000 * (2 * 1000 + 1000) / lineMeters(nearMirrorRide(10)));
});

test("a loop that is too long, or rides the way back anyway, leaves the cut", async () => {
  const path = pathOf(nearMirrorRide(10));
  const cut = [RA, RB, RC, RD, RE, RF, RG];
  const long = fakeRouter((to) => [m(1000, 3000), [to[0], m(0, 3000)[1]]]);
  const tooLong = await pruneOrLoopSpurs(path, {
    requireCircuit: false,
    loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: long.route, budget: new SpurLoopBudget() },
  });
  assert.deepEqual(tooLong.coordinates, cut);
  // Down the same forest road 5 m off, then across to E: 900 m ridden twice.
  const retrace = fakeRouter((to) => [m(1005, 900), m(1005, 100), [to[0], m(0, 100)[1]]]);
  const retraced = await pruneOrLoopSpurs(path, {
    requireCircuit: false,
    loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: retrace.route, budget: new SpurLoopBudget() },
  });
  assert.deepEqual(retraced.coordinates, cut);
});

test("no loop is tried for a rider's stop, a spur not made by a generated via, or past the ride's allowance", async () => {
  const path = pathOf(nearMirrorRide(10));
  // The rider's stop at the tip: the spur is the visit, nothing is cut or routed.
  const stop = fakeRouter(eastThenDown(1000));
  const kept = await pruneOrLoopSpurs(path, {
    protect: [TIP, RG], requireCircuit: false,
    loop: { waypoints: [RA, TIP, RG], generatedViaIndices: [], route: stop.route, budget: new SpurLoopBudget() },
  });
  assert.equal(kept, path);
  assert.equal(stop.calls.length, 0);
  // The nearest waypoint to the tip is not one the builder invented.
  const named = fakeRouter(eastThenDown(1000));
  const cutOnly = await pruneOrLoopSpurs(path, {
    requireCircuit: false,
    loop: { waypoints: [RA, viaNearTip, m(3000, 0)], generatedViaIndices: [], route: named.route, budget: new SpurLoopBudget() },
  });
  assert.deepEqual(cutOnly.coordinates, [RA, RB, RC, RD, RE, RF, RG]);
  assert.equal(named.calls.length, 0);
  // One ride's allowance is shared: once spent, spurs are cut without asking.
  const budget = new SpurLoopBudget(2);
  const first = fakeRouter(eastThenDown(1000));
  await pruneOrLoopSpurs(path, { requireCircuit: false, loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: first.route, budget } });
  const second = fakeRouter(eastThenDown(1000));
  const spent = await pruneOrLoopSpurs(path, { requireCircuit: false, loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: second.route, budget } });
  assert.ok(first.calls.length > 0);
  assert.equal(second.calls.length, 0);
  assert.deepEqual(spent.coordinates, [RA, RB, RC, RD, RE, RF, RG]);
});

test("a loop that comes onto the ride early joins it there, and the ride keeps its own road after", async () => {
  const path = pathOf(nearMirrorRide(10));
  // Asked for the road two spur lengths on, the router comes down onto it at
  // D and follows it: the loop ends at D, and D→E is the ride's own edge.
  const early = fakeRouter((to) => [m(1500, 1000), RD, ...[RE, RF, RG].filter((p) => p[0] < to[0])]);
  const looped = await pruneOrLoopSpurs(path, {
    requireCircuit: false,
    loop: { waypoints: [RA, viaNearTip, RG], generatedViaIndices: [1], route: early.route, budget: new SpurLoopBudget() },
  });
  const at = looped.coordinates.indexOf(TIP);
  assert.deepEqual(looped.coordinates.slice(at), [TIP, m(1500, 1000), RD, RE, RF, RG]);
  const markers = looped.edges.map((e) => e.tags?.marker);
  assert.equal(markers.at(-1), String(nearMirrorRide(10).length - 1), "F→G is the ride's last edge");
  assert.equal(markers.filter((x) => x === "loop").length, 2, "only tip→(1500,1000)→D is the loop's");
});
