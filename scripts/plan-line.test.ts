import test from "node:test";
import assert from "node:assert/strict";
import { planLine } from "../lib/map/plan-line";
import type { Point } from "../lib/geo/geometry";

const A: Point = [24.1, 56.9], B: Point = [24.5, 57.1], C: Point = [24.8, 57.2], D: Point = [25.2, 57.3], P: Point = [24.6, 57.0];

test("the pins are joined in riding order, empty rows skipped", () => {
  assert.deepEqual(planLine({ rows: [A, null, B, C], roundTrip: false, pending: null }).confirmed, [A, B, C]);
  assert.deepEqual(planLine({ rows: [A, null], roundTrip: false, pending: null }).confirmed, [], "one pin is no line");
});

test("a round trip closes back to the start", () => {
  assert.deepEqual(planLine({ rows: [A, B, C], roundTrip: true, pending: null }).confirmed, [A, B, C, A]);
});

test("a pending stop is drawn from the place before it to the place after it", () => {
  // Rīga, [new stop pending], Cēsis: the pending line runs A → P → D.
  const r = planLine({ rows: [A, null, D], roundTrip: false, pending: { row: 1, point: P } });
  assert.deepEqual(r.confirmed, [A, D]);
  assert.deepEqual(r.pending, [A, P, D]);
  // Moving a stop that already has a place: the confirmed line keeps its old
  // place until Confirm, the pending one shows the new.
  const moving = planLine({ rows: [A, B, D], roundTrip: false, pending: { row: 1, point: P } });
  assert.deepEqual(moving.confirmed, [A, B, D]);
  assert.deepEqual(moving.pending, [A, P, D]);
  // A pending finish: from the last stop to it.
  assert.deepEqual(planLine({ rows: [A, B, null], roundTrip: false, pending: { row: 2, point: P } }).pending, [B, P]);
  // A round trip's last stop leads back to the start.
  assert.deepEqual(planLine({ rows: [A, B, null], roundTrip: true, pending: { row: 2, point: P } }).pending, [B, P, A]);
});
