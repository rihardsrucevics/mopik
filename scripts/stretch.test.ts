import test from "node:test";
import assert from "node:assert/strict";
import {
  AVOID_POINTS, STRETCH_CLAMP_M, STRETCH_MAX_M, STRETCH_MIN_M, avoidOf, defaultStretch, fenceNogos, moveStretchEnd, planStretch, retracedPasses, stretchLine,
} from "../lib/routing/stretch";
import { cumulative } from "../lib/routing/detour";
import { planWithPlaces, placesFromRide, type RidePlace, type RidePlaces } from "../lib/routing/reroute-leg";
import { decodePlanShare, encodePlanShare } from "../lib/share/route-code";
import { haversineMeters, type Point } from "../lib/geo/geometry";
import type { RidePlan } from "../lib/chat/ride-plan";

/**
 * Backlog 36 („Izslēgt šo posmu”, „Atpakaļ pa citu ceļu”): the stretch a tap
 * selects and its handles, the fence, the run round it, the refusal with a
 * stop inside, the retraced pass, and the exclusion kept in the plan and the
 * share code (old codes byte-identical).
 */

/** A straight line east along 57° N, a vertex every ~100 m. */
const line: Point[] = Array.from({ length: 201 }, (_, i) => [24 + i * 0.00165, 57]);
const cum = cumulative(line);
const total = cum[cum.length - 1];
const at = (m: number): Point => line[cum.findIndex((c) => c >= m)];
const place = (p: Point, extra: Partial<RidePlace> = {}): RidePlace => ({ name: extra.name ?? "P", label: extra.name ?? "P", lat: p[1], lon: p[0], ...extra });

test("default stretch: between the nearest breaks, clamped to ±1.5 km", () => {
  const s = defaultStretch({ total, alongMeters: 5_000, breaks: [4_600, 5_300, 9_000] });
  assert.deepEqual(s, { fromMeters: 4_600, toMeters: 5_300 });
  const far = defaultStretch({ total, alongMeters: 10_000, breaks: [0, total] });
  assert.equal(far.fromMeters, 10_000 - STRETCH_CLAMP_M);
  assert.equal(far.toMeters, 10_000 + STRETCH_CLAMP_M);
  // A break under the finger is not an end; the line's own ends clamp.
  const edge = defaultStretch({ total, alongMeters: 100, breaks: [110] });
  assert.equal(edge.fromMeters, 0);
  assert.ok(edge.toMeters <= 100 + STRETCH_CLAMP_M);
});

test("handles: never cross, never leave the line, never past the cap", () => {
  const s = { fromMeters: 4_000, toMeters: 5_000 };
  assert.equal(moveStretchEnd(s, "from", 6_000, total).fromMeters, 5_000 - STRETCH_MIN_M);
  assert.equal(moveStretchEnd(s, "to", 100, total).toMeters, 4_000 + STRETCH_MIN_M);
  assert.equal(moveStretchEnd(s, "from", -50, total).fromMeters, 0);
  assert.equal(moveStretchEnd(s, "to", total + 99, total).toMeters, Math.min(total, 4_000 + STRETCH_MAX_M));
  assert.deepEqual(moveStretchEnd(s, "to", 4_500, total), { fromMeters: 4_000, toMeters: 4_500 });
});

test("fence: the stretch's own line, ≤ 24 points stored, circles clear of the run's ends", () => {
  const s = { fromMeters: 2_000, toMeters: 8_000 };
  const geo = stretchLine(line, cum, s);
  assert.ok(Math.abs(cumulative(geo).at(-1)! - 6_000) < 1);
  const stored = avoidOf(geo);
  assert.ok(stored.line.length <= AVOID_POINTS);
  assert.deepEqual(stored.line[0], [57, Number(geo[0][0].toFixed(5))]);
  const nogos = fenceNogos(geo, [geo[0]]);
  assert.ok(nogos.length > 20);
  assert.ok(nogos.every((n) => haversineMeters([n.lon, n.lat], geo[0]) >= 120));
});

test("planStretch: a run beyond the stretch, pass-through inside dropped, avoid grown", () => {
  const places: RidePlaces = {
    start: place(line[0], { name: "A" }),
    vias: [place(at(5_000), { name: "", shape: true })],
    finish: place(line[200], { name: "B" }),
    roundTrip: false,
  };
  const s = { fromMeters: 4_500, toMeters: 5_500 };
  const planned = planStretch({ places, line, cum, route: s, fence: stretchLine(line, cum, s), persist: true });
  assert.ok(!("error" in planned));
  if ("error" in planned) return;
  assert.equal(planned.dropped, 1);
  assert.equal(planned.places.vias.length, 0);
  assert.equal(planned.places.avoid?.length, 1);
  assert.ok(planned.run.fromMeters < s.fromMeters && planned.run.toMeters > s.toMeters);
  assert.equal(planned.run.fromMeters, 1_500);
  // Between the start and the finish (indices into the places before: vias.length is the finish).
  assert.deepEqual(planned.between, [-1, 1]);
  // Not across a drawn stretch.
  const clamp = planStretch({ places, line, cum, route: s, fence: [], persist: false, fixed: [[3_000, 3_500]] });
  assert.ok(!("error" in clamp) && clamp.run.fromMeters === 3_500);
  assert.deepEqual(planStretch({ places, line, cum, route: s, fence: [], persist: false, fixed: [[5_000, 5_100]] }), { error: "drawn" });
});

test("planStretch: a stop inside is refused, and named by its index", () => {
  const places: RidePlaces = {
    start: place(line[0], { name: "A" }),
    vias: [place(at(3_000), { name: "", shape: true }), place(at(5_000), { name: "Līgatne" })],
    finish: place(line[200], { name: "B" }),
    roundTrip: false,
  };
  assert.deepEqual(planStretch({ places, line, cum, route: { fromMeters: 4_500, toMeters: 5_500 }, fence: [], persist: true }), { error: "stop-inside", index: 1 });
  assert.deepEqual(planStretch({ places, line, cum, route: { fromMeters: 0, toMeters: 900 }, fence: [], persist: true }), { error: "stop-inside", index: -1 });
});

test("retracedPasses: out and back on the same road — the second pass found, nothing on a plain line", () => {
  const out = line.slice(0, 51);
  const back = [...out].reverse().slice(1);
  const loop = [...out, ...back, ...line.slice(1, 30).map(([lon, lat]): Point => [lon, lat + 0.01])];
  const lc = cumulative(loop);
  const passes = retracedPasses(loop, lc, { fromMeters: 1_000, toMeters: 2_000 });
  assert.ok(passes);
  assert.equal(passes!.first.fromMeters, 1_000);
  const half = lc[50];
  assert.ok(Math.abs(passes!.second.fromMeters - (2 * half - 2_000)) < 120);
  assert.ok(Math.abs(passes!.second.toMeters - (2 * half - 1_000)) < 120);
  // Tapping the second pass gives the same two passes.
  const again = retracedPasses(loop, lc, passes!.second);
  assert.ok(again && Math.abs(again.first.fromMeters - 1_000) < 120);
  assert.equal(retracedPasses(line, cum, { fromMeters: 1_000, toMeters: 2_000 }), null);
});

const basePlan = {
  startPlace: "Sigulda", viaPlaces: ["Līgatne"], destinationPlace: "Cēsis", directionPlace: null, focusArea: null, budgetScope: "total", returnToStart: false,
  budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null }, difficulty: "adventure", rideStyle: "explore", gravelPreference: 55,
  trailPreference: "some", accessPolicy: "verified", preferForest: false, maxRepeatedPercent: null, prioritizeLowOverlap: true, noSand: false, avoidTowns: false,
  avoidMainRoads: false, includeTet: false, includeSightseeing: false, surroundings: "some", destinationAny: false,
} as unknown as RidePlan;

test("share code: plan.avoid round-trips as `x`; a plan without it encodes to the very same code", () => {
  const places: RidePlaces = { start: place(line[0], { name: "Sigulda" }), vias: [place(at(9_000), { name: "Līgatne" })], finish: place(line[200], { name: "Cēsis" }), roundTrip: false };
  const plain = planWithPlaces(basePlan, places);
  assert.equal("avoid" in plain, false);
  // Pinned: the code a plan without exclusions always made.
  const oldCode = encodePlanShare(basePlan);
  assert.equal(encodePlanShare(plain), oldCode);
  assert.equal(oldCode.includes("eCI6"), false);
  const decodedOld = decodePlanShare(oldCode)!;
  assert.equal(decodedOld.avoid, undefined);
  assert.equal(encodePlanShare(decodedOld), oldCode);

  const withX = { ...places, avoid: [avoidOf(stretchLine(line, cum, { fromMeters: 2_000, toMeters: 3_000 }))] };
  const plan = planWithPlaces(basePlan, withX);
  assert.equal(plan.avoid?.length, 1);
  const code = encodePlanShare(plan);
  assert.notEqual(code, oldCode);
  const back = decodePlanShare(code)!;
  assert.deepEqual(back.avoid, plan.avoid);
  // Reopened: the ride's places remember it.
  const reopened = placesFromRide({ plan: back, start: { ...line[0] && { lat: 57, lon: 24, label: "Sigulda" } }, via: [{ lat: 57, lon: 24.1, label: "Līgatne" }], destination: { lat: 57, lon: 24.3, label: "Cēsis" }, picked: [] });
  assert.deepEqual(reopened.avoid, plan.avoid);
  // A bad line in a hand-made code costs that line only.
  const raw = JSON.parse(Buffer.from(code, "base64url").toString());
  raw.x.push([[999, 0], [1, 1]]);
  const bad = decodePlanShare(Buffer.from(JSON.stringify(raw)).toString("base64url"))!;
  assert.equal(bad.avoid?.length, 1);
});
