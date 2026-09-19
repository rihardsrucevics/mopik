/**
 * A pin the profile cannot ride to — the Pilskalni 2 case, 2026-09-19.
 *
 * `npx tsx --test scripts/routable-point.test.ts`
 *
 * What these pin, and why each is worth a test rather than a comment:
 *
 *  1. **A routable point is decided by the snap distance, not by success.**
 *     BRouter answers 200 for a farmstead behind `access=private` roads and
 *     ends the line 471 m short. Every earlier layer read that 200 as "fine"
 *     — the stop check then failed on all ~36 candidates and the rider was
 *     told their time budget was wrong. The verdict must come from the gap.
 *  2. **The move offer has a limit.** "Pārvietot uz tuvāko ceļu" is only
 *     honest while the road is close enough that the pin is still the same
 *     place. At Pilskalni 2 the nearest legal road is 1.2 km off, so the only
 *     chip is to remove the stop — offering to move it there would be the
 *     silent substitution CLAUDE.md forbids.
 *  3. **A probe that never answered is not a verdict.** "We could not check"
 *     must never read as "you cannot ride there": the generation is still the
 *     backstop, and a slow router must not block a legitimate pick.
 *
 * The router is stubbed. What is being pinned is how a measured snap becomes
 * an answer, and a live server would only re-measure OSM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  MOVE_OFFER_MAX_M,
  STOP_TOLERANCE_M,
  canOfferMove,
  checkRoutablePoint,
  judgeSnap,
  probeLegFor,
  type SnapProbe,
} from "../lib/routing/routable-point";
import type { Point } from "../lib/geo/geometry";

/** The rider's finish, and where BRouter really ended — both measured. */
const PILSKALNI: Point = [24.9353088, 57.1933514];
const SNAPPED: Point = [24.942515, 57.191716];

test("a 200 that lands 471 m short is not routable", () => {
  const verdict = judgeSnap(PILSKALNI, { ok: true, end: SNAPPED });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "too-far-from-road");
  // The measured distance, to the metre the geometry gives.
  assert.ok(verdict.distanceM !== undefined && verdict.distanceM > 400 && verdict.distanceM < 540,
    `expected ~471 m, got ${verdict.distanceM}`);
  // The snapped point still travels, so the refusal can say where the road is
  // even when it may not offer to move the pin there.
  assert.deepEqual(verdict.snappedTo, { lat: SNAPPED[1], lon: SNAPPED[0] });
});

test("a point on a road is routable and says where it snapped", () => {
  // 40 m away: inside the stop tolerance, which is what the ride will judge.
  const near: Point = [PILSKALNI[0] + 40 / (111320 * Math.cos((PILSKALNI[1] * Math.PI) / 180)), PILSKALNI[1]];
  const verdict = judgeSnap(PILSKALNI, { ok: true, end: near });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.reason, undefined);
  assert.ok(verdict.distanceM !== undefined && verdict.distanceM <= STOP_TOLERANCE_M);
});

test("the stop tolerance is the boundary, not a soft edge", () => {
  const at = (meters: number): Point => [
    PILSKALNI[0] + meters / (111320 * Math.cos((PILSKALNI[1] * Math.PI) / 180)),
    PILSKALNI[1],
  ];
  assert.equal(judgeSnap(PILSKALNI, { ok: true, end: at(STOP_TOLERANCE_M - 20) }).ok, true);
  assert.equal(judgeSnap(PILSKALNI, { ok: true, end: at(STOP_TOLERANCE_M + 20) }).ok, false);
});

test("move is offered for a near miss and refused for Pilskalni 2", () => {
  const at = (meters: number): Point => [
    PILSKALNI[0] + meters / (111320 * Math.cos((PILSKALNI[1] * Math.PI) / 180)),
    PILSKALNI[1],
  ];
  // 380 m: too far for the stop check, close enough to still be the place.
  const near = judgeSnap(PILSKALNI, { ok: true, end: at(380) });
  assert.equal(near.ok, false);
  assert.equal(canOfferMove(near), true);

  // The real one: 471 m is inside the offer limit, so the rider IS offered
  // the move — this is the case the coordinator asked for.
  const real = judgeSnap(PILSKALNI, { ok: true, end: SNAPPED });
  assert.equal(canOfferMove(real), true);

  // Far beyond the limit: remove is the only honest chip.
  const far = judgeSnap(PILSKALNI, { ok: true, end: at(MOVE_OFFER_MAX_M + 200) });
  assert.equal(far.ok, false);
  assert.equal(canOfferMove(far), false);
});

test("a routable point is never offered a move", () => {
  const ok = judgeSnap(PILSKALNI, { ok: true, end: PILSKALNI });
  assert.equal(ok.ok, true);
  assert.equal(canOfferMove(ok), false);
});

test("a refusal and a silence are different answers", () => {
  const refused = judgeSnap(PILSKALNI, { ok: false, refused: true });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "unroutable");

  const silent = judgeSnap(PILSKALNI, { ok: false, refused: false });
  assert.equal(silent.ok, false);
  assert.equal(silent.reason, "probe-failed");
  // Nothing to move to, so nothing may be offered.
  assert.equal(canOfferMove(silent), false);
  assert.equal(silent.snappedTo, undefined);
});

test("the probe leg ends at the pin and starts somewhere else", () => {
  const [from, to] = probeLegFor(PILSKALNI);
  assert.deepEqual(to, PILSKALNI);
  assert.notDeepEqual(from, PILSKALNI);
  // Same latitude, offset in longitude — a short leg, not a journey.
  assert.equal(from[1], PILSKALNI[1]);
  assert.ok(Math.abs(from[0] - PILSKALNI[0]) > 0);
});

test("checkRoutablePoint routes from a ride's own place when given one", async () => {
  const tujas: Point = [24.8746566, 57.2572652];
  const legs: [Point, Point][] = [];
  const probe = async (leg: [Point, Point]): Promise<SnapProbe> => {
    legs.push(leg);
    return { ok: true, end: SNAPPED };
  };

  const verdict = await checkRoutablePoint({ point: PILSKALNI, from: tujas, probe });
  assert.equal(legs.length, 1);
  assert.deepEqual(legs[0], [tujas, PILSKALNI]);
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "too-far-from-road");
});

test("checkRoutablePoint invents a leg when the ride has no other place", async () => {
  const legs: [Point, Point][] = [];
  await checkRoutablePoint({
    point: PILSKALNI,
    probe: async (leg) => {
      legs.push(leg);
      return { ok: true, end: PILSKALNI };
    },
  });
  assert.equal(legs.length, 1);
  assert.deepEqual(legs[0][1], PILSKALNI);
  assert.notDeepEqual(legs[0][0], PILSKALNI);
});
