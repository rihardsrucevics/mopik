import test from "node:test";
import assert from "node:assert/strict";
import { stepShape, type ShapeEvent, type ShapePending } from "../lib/map/shape-pending";

/**
 * A shaping point's edit state, and every way out of it (rider, 2026-09-25:
 * he dragged the line, confirmed, and a point "stayed there" — still
 * draggable, impossible to remove, and the next thing he did broke the map).
 *
 * `npx tsx --test scripts/shape-pending.test.ts`
 *
 * The rule pinned here: after ✓ or ✕ — or „Izņemt”, „Padarīt par pieturu”, a
 * row taking the map, an undo — nothing is pending and the map takes no more
 * marks for a shaping point. Only a new grab starts the state again.
 */

const A = { lat: 56.9, lon: 24.0 };
const B = { lat: 56.91, lon: 24.02 };
const C = { lat: 56.92, lon: 24.04 };

const run = (events: ShapeEvent[], from: ShapePending | null = null) => {
  let pending = from;
  let last = { pending, picking: false, commit: null as ReturnType<typeof stepShape>["commit"] };
  for (const e of events) {
    last = stepShape(pending, e);
    pending = last.pending;
  }
  return last;
};

test("grab, mark, confirm: one commit, and the state is left completely", () => {
  const grabbed = stepShape(null, { type: "grab", at: A });
  assert.equal(grabbed.picking, true, "the map takes the next mark");
  const marked = stepShape(grabbed.pending, { type: "mark", at: B });
  assert.deepEqual(marked.pending, { kind: "add", at: A, to: B });
  const done = stepShape(marked.pending, { type: "confirm" });
  assert.deepEqual(done.commit, { kind: "add", lat: B.lat, lon: B.lon, grabbedAt: [A.lon, A.lat] });
  assert.equal(done.pending, null, "nothing pending after ✓");
  assert.equal(done.picking, false, "and no more marks: the pending marker and its connector go");
});

test("after ✓ a mark is not a shaping point's: the confirmed point cannot be dragged on", () => {
  const after = run([{ type: "grab", at: A }, { type: "mark", at: B }, { type: "confirm" }, { type: "mark", at: C }]);
  assert.equal(after.pending, null, "the mark that followed did not reopen anything");
  assert.equal(after.commit, null);
  assert.equal(after.picking, false);
});

test("✕ drops a waiting grab with nothing committed, and leaves the state", () => {
  for (const events of [
    [{ type: "grab", at: A }, { type: "cancel" }],
    [{ type: "grab", at: A }, { type: "mark", at: B }, { type: "cancel" }],
  ] as ShapeEvent[][]) {
    const r = run(events);
    assert.equal(r.pending, null);
    assert.equal(r.picking, false);
    assert.equal(r.commit, null);
  }
});

test("Confirm with no place yet keeps waiting and commits nothing", () => {
  const r = run([{ type: "grab", at: A }, { type: "confirm" }]);
  assert.equal(r.commit, null);
  assert.deepEqual(r.pending, { kind: "add", at: A, to: null });
  assert.equal(r.picking, true);
});

test("a row taking the map, „Izņemt”, „Padarīt par pieturu” or an undo each leave the state", () => {
  for (const type of ["row", "remove", "promote", "reseed"] as const) {
    const r = run([{ type: "grab", at: A }, { type: "mark", at: B }, { type }]);
    assert.equal(r.pending, null, type);
    assert.equal(r.picking, false, type);
    assert.equal(r.commit, null, `${type} commits nothing of the waiting grab`);
  }
});

test("a new grab replaces whatever was waiting, never stacks on it", () => {
  const r = run([{ type: "grab", at: A }, { type: "mark", at: B }, { type: "grab", at: C }]);
  assert.deepEqual(r.pending, { kind: "add", at: C, to: null }, "the new grab alone, with no place yet");
});

test("a moved dot waiting for ✓ commits its move once and then nothing more", () => {
  const moving: ShapePending = { kind: "move", index: 1, to: B };
  const done = stepShape(moving, { type: "confirm" });
  assert.deepEqual(done.commit, { kind: "move", index: 1, lat: B.lat, lon: B.lon });
  assert.equal(done.pending, null);
  assert.equal(stepShape(done.pending, { type: "confirm" }).commit, null, "a second ✓ does nothing");
});
