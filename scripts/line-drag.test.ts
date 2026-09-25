import test from "node:test";
import assert from "node:assert/strict";
import { LINE_DRAG_MIN_PX, LINE_HOLD_MS, LINE_HOLD_SLOP_PX, lineDragStep, type LineDragAction, type LineDragEvent, type LineDragState } from "../lib/map/line-drag";

/** Feed a gesture through the rule; every action it asked the map for, in order. */
function run(events: LineDragEvent[]): { actions: LineDragAction[]; state: LineDragState | null } {
  let state: LineDragState | null = null;
  const actions: LineDragAction[] = [];
  for (const ev of events) {
    const step = lineDragStep(state, ev);
    state = step.state;
    if (step.action) actions.push(step.action);
  }
  return { actions, state };
}
const touchDown = (x = 100, y = 100, fingers = 1, onLine = true): LineDragEvent => ({ type: "down", pointer: "touch", x, y, at: 0, onLine, fingers });
const mouseDown = (x = 100, y = 100): LineDragEvent => ({ type: "down", pointer: "mouse", x, y, at: 0, onLine: true, fingers: 1 });
const move = (x: number, y = 100, fingers = 1): LineDragEvent => ({ type: "move", x, y, fingers });
const hold: LineDragEvent = { type: "hold", at: LINE_HOLD_MS };
const up: LineDragEvent = { type: "up" };

test("a tap on the line makes nothing (the Mārupe white point)", () => {
  assert.deepEqual(run([touchDown(), up]).actions, ["abort"]);
  assert.deepEqual(run([touchDown(), move(102), up]).actions, ["abort"]);
});

test("the first tap of a double-tap zoom makes nothing, nor does the second", () => {
  assert.deepEqual(run([touchDown(), up, touchDown(103, 101), up]).actions, ["abort", "abort"]);
});

test("a one-finger pan that starts on the line pans; it never grabs", () => {
  const { actions } = run([touchDown(), move(100 + LINE_HOLD_SLOP_PX + 1), move(160), move(220), up]);
  assert.deepEqual(actions, ["abort"]);
  assert.ok(!actions.includes("grab"));
});

test("a pinch with a finger on the line never grabs, held or not", () => {
  assert.deepEqual(run([touchDown(), touchDown(200, 200, 2), move(140, 100, 2), up]).actions, ["abort"]);
  // Held first, then a second finger lands: still a pinch.
  const held = run([touchDown(), hold, move(101, 100, 2), move(150, 100, 2), up]);
  assert.deepEqual(held.actions, ["arm", "abort"]);
});

test("a press that does not start on the line is nothing", () => {
  assert.deepEqual(run([touchDown(100, 100, 1, false), hold, move(150), up]).actions, []);
});

test("touch: hold on the line, then drag past the threshold — the one way to grab", () => {
  const { actions } = run([touchDown(), hold, move(100 + LINE_DRAG_MIN_PX - 1), move(100 + LINE_DRAG_MIN_PX), move(140), up]);
  assert.deepEqual(actions, ["arm", "grab", "follow", "drop"]);
});

test("touch: a hold let go without the drag makes nothing", () => {
  assert.deepEqual(run([touchDown(), hold, move(100 + LINE_DRAG_MIN_PX - 1), up]).actions, ["arm", "abort"]);
});

test("touch: the hold only counts once it has lasted", () => {
  const early = run([touchDown(), { type: "hold", at: LINE_HOLD_MS - 1 }, move(140), up]);
  assert.deepEqual(early.actions, ["abort"]);
});

test("mouse: press on the line and drag ≥ 12 px grabs; a click or a 5 px wobble does not", () => {
  assert.deepEqual(run([mouseDown(), move(100 + LINE_DRAG_MIN_PX), move(130), up]).actions, ["grab", "follow", "drop"]);
  assert.deepEqual(run([mouseDown(), up]).actions, ["abort"]);
  assert.deepEqual(run([mouseDown(), move(105), move(100, 104), up]).actions, ["abort"]);
});

test("the threshold is measured from the press, in any direction", () => {
  const d = LINE_DRAG_MIN_PX / Math.SQRT2 + 0.1;
  assert.deepEqual(run([mouseDown(), move(100 + d, 100 + d)]).actions, ["grab"]);
  assert.equal(LINE_DRAG_MIN_PX >= 12, true, "the rider's floor");
});
