import test from "node:test";
import assert from "node:assert/strict";
import { neighboursAlong, pointActions, selectionLive, type PointSelection } from "../lib/map/point-selection";
import { stepShape } from "../lib/map/shape-pending";
import { messages } from "../lib/i18n/messages";

test("the start and the finish can only be moved", () => {
  assert.deepEqual(pointActions({ kind: "pin", role: "start" }), ["move"]);
  assert.deepEqual(pointActions({ kind: "pin", role: "finish" }), ["move"]);
});

test("a stop can be moved or removed; a shaping point moved, made a stop or removed — Izņemt last", () => {
  assert.deepEqual(pointActions({ kind: "pin", role: "via" }), ["move", "remove"]);
  assert.deepEqual(pointActions({ kind: "shape" }), ["move", "promote", "remove"]);
});

test("a pin's menu lives while no row has the map; its move while its row is the active one", () => {
  const menu: PointSelection = { kind: "pin", role: "via", row: 2, phase: "menu" };
  assert.equal(selectionLive(menu, { activeRow: null, shapeCount: 0 }), menu);
  assert.equal(selectionLive(menu, { activeRow: 1, shapeCount: 0 }), null, "a field focused ends the menu");
  const move: PointSelection = { ...menu, phase: "move" };
  assert.equal(selectionLive(move, { activeRow: 2, shapeCount: 0 }), move);
  // ✓ moves the active row on or to none; ✕ clears it.
  assert.equal(selectionLive(move, { activeRow: 3, shapeCount: 0 }), null);
  assert.equal(selectionLive(move, { activeRow: null, shapeCount: 0 }), null);
});

test("a shaping point's selection ends when the dot is gone", () => {
  const sel: PointSelection = { kind: "shape", index: 1, phase: "menu" };
  assert.equal(selectionLive(sel, { activeRow: null, shapeCount: 2 }), sel);
  assert.equal(selectionLive(sel, { activeRow: null, shapeCount: 1 }), null);
  assert.equal(selectionLive(null, { activeRow: 1, shapeCount: 3 }), null);
});

test("„Pārvietot” on a dot, then a mark: one pending move, which ✓ commits and ✕ drops", () => {
  const moved = stepShape(null, { type: "move", index: 0, at: { lat: 56.9, lon: 24.1 } });
  assert.deepEqual(moved.pending, { kind: "move", index: 0, to: { lat: 56.9, lon: 24.1 } });
  assert.deepEqual(stepShape(moved.pending, { type: "confirm" }).commit, { kind: "move", index: 0, lat: 56.9, lon: 24.1 });
  assert.equal(stepShape(moved.pending, { type: "cancel" }).pending, null);
});

test("the move preview joins the place before and after in riding order", () => {
  const anchors = [{ point: "S", along: 0 }, { point: "A", along: 100 }, { point: "B", along: 300 }, { point: "F", along: 500 }];
  assert.deepEqual(neighboursAlong(anchors, 200, false), ["A", "B"]);
  assert.deepEqual(neighboursAlong(anchors, 50, false), ["S", "A"]);
  assert.deepEqual(neighboursAlong(anchors, 600, false), ["F"], "past the finish: only the finish");
  // A round trip leads back to the start after the last place.
  assert.deepEqual(neighboursAlong(anchors.slice(0, 3), 400, true), ["B", "S"]);
  // Rows as the order: a stop between rows 1 and 3.
  assert.deepEqual(neighboursAlong([{ point: 0, along: 0 }, { point: 1, along: 1 }, { point: 3, along: 3 }], 2, false), [1, 3]);
});

test("the sheet's words are said in four languages, and Latvian never says „piesit”", () => {
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    const m = messages(locale);
    for (const key of ["pointMoveHint", "pointMove", "pointStopTitle", "shapePointName", "pointSheetClose"] as const) assert.ok(m[key].trim(), `${locale} ${key}`);
    assert.ok(m.pointStopTitle.includes("{n}"), locale);
  }
  assert.equal(messages("lv").pointMoveHint, "Izvēlies jaunu vietu kartē");
  assert.equal(messages("lv").pointMove, "Pārvietot");
  assert.ok(!/piesit/i.test(Object.values(messages("lv")).join(" ")));
});
