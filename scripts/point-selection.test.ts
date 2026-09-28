import test from "node:test";
import assert from "node:assert/strict";
import {
  demoteInPlan, livePlanDots, neighboursAlong, planDotsFromPlan, planShapePoints, pointActions, promoteInPlan, selectionLive,
  type PlanDot, type PointSelection,
} from "../lib/map/point-selection";
import { composeRidePlan, placesFromPlan } from "../lib/chat/compose-plan";
import { interleaveShapes } from "../lib/routing/shape-points";
import { RidePlanSchema } from "../lib/chat/ride-plan";
import { DEFAULT_PROFILE } from "../lib/chat/ride-profile";
import { stepShape } from "../lib/map/shape-pending";
import { messages } from "../lib/i18n/messages";

for (const mode of ["plan", "edit"] as const) {
  test(`${mode}: the start and the finish can only be moved`, () => {
    assert.deepEqual(pointActions({ kind: "pin", role: "start" }, mode), ["move"]);
    assert.deepEqual(pointActions({ kind: "pin", role: "finish" }, mode), ["move"]);
  });

  test(`${mode}: a stop is moved, made pass-through or removed; a pass-through point moved, made a stop or removed — Izņemt last`, () => {
    assert.deepEqual(pointActions({ kind: "pin", role: "via" }, mode), ["move", "demote", "remove"]);
    assert.deepEqual(pointActions({ kind: "shape" }, mode), ["move", "promote", "remove"]);
  });
}

test("a pending removal lives like the menu: while no row has the map, and while the dot exists", () => {
  const pin: PointSelection = { kind: "pin", role: "via", row: 1, phase: "remove" };
  assert.equal(selectionLive(pin, { activeRow: null, shapeCount: 0 }), pin);
  assert.equal(selectionLive(pin, { activeRow: 1, shapeCount: 0 }), null, "a row focused ends it");
  const dot: PointSelection = { kind: "shape", index: 0, phase: "remove" };
  assert.equal(selectionLive(dot, { activeRow: null, shapeCount: 1 }), dot);
  assert.equal(selectionLive(dot, { activeRow: null, shapeCount: 0 }), null);
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
    for (const key of ["pointMoveHint", "pointMove", "pointStopTitle", "shapePointName", "pointSheetClose", "pointDemote", "previewConfirm", "previewCancel"] as const) assert.ok(m[key].trim(), `${locale} ${key}`);
    assert.ok(m.pointStopTitle.includes("{n}"), locale);
  }
  assert.equal(messages("lv").pointMoveHint, "Izvēlies jaunu vietu kartē");
  assert.equal(messages("lv").pointMove, "Pārvietot");
  assert.equal(messages("lv").pointDemote, "Padarīt caurbraucamu");
  assert.equal(messages("lv").shapePointName, "Caurbraucams punkts");
  assert.ok(!/piesit/i.test(Object.values(messages("lv")).join(" ")));
});

// ── Planning: „Padarīt caurbraucamu” / „Padarīt par pieturu” (B1) ──

type P = { name: string; lat: number; lon: number };
const at = (name: string, lat: number, lon: number): P => ({ name, lat, lon });
const RIGA = at("Rīga", 56.95, 24.1), OGRE = at("Ogre", 56.82, 24.6), LIELVARDE = at("Lielvārde", 56.72, 24.8), AIZKRAUKLE = at("Aizkraukle", 56.6, 25.25), JEKABPILS = at("Jēkabpils", 56.5, 25.86);
const plan = (rows: string[], dots: PlanDot[], oneWay = true) => {
  const base = composeRidePlan({ places: rows, tripType: oneWay ? "one_way" : "round_trip", durationMode: "flexible", hours: 4, profile: DEFAULT_PROFILE });
  const shapes = planShapePoints(rows, dots, oneWay, 20);
  return RidePlanSchema.parse(shapes.length ? { ...base, shapePoints: shapes } : base);
};
/** The router's vias for a plan: names for stops, "•lat" for a dot. */
const vias = (p: ReturnType<typeof plan>) => interleaveShapes(p.viaPlaces, p.shapePoints, (s) => `•${s.lat}`);

test("demoting a planned stop: its row leaves, the plan rides through its spot in the same place in the order", () => {
  const rows = ["Rīga", "Ogre", "Lielvārde", "Jēkabpils"];
  const picked: Record<number, P | null> = { 0: RIGA, 1: OGRE, 2: LIELVARDE, 3: JEKABPILS };
  const d = demoteInPlan({ rows, picked, dots: [], oneWay: true, row: 1 })!;
  assert.deepEqual(d.rows, ["Rīga", "Lielvārde", "Jēkabpils"]);
  assert.deepEqual(d.picked, { 0: RIGA, 1: LIELVARDE, 2: JEKABPILS }, "the picks follow their rows");
  assert.deepEqual(d.dots, [{ lat: OGRE.lat, lon: OGRE.lon, after: null }], "a white dot after the start");
  const p = plan(d.rows, d.dots);
  assert.deepEqual(p.shapePoints, [{ lat: OGRE.lat, lon: OGRE.lon, afterPlace: 0 }]);
  assert.deepEqual(vias(p), [`•${OGRE.lat}`, "Lielvārde"], "Rīga → (Ogre) → Lielvārde → Jēkabpils, as before");
});

test("demote then promote gives back the rows, the picks and a plan with no shapePoints", () => {
  const rows = ["Rīga", "Ogre", "Lielvārde", "Aizkraukle", "Jēkabpils"];
  const picked: Record<number, P | null> = { 0: RIGA, 1: OGRE, 2: LIELVARDE, 3: AIZKRAUKLE, 4: JEKABPILS };
  const before = vias(plan(rows, []));
  const d = demoteInPlan({ rows, picked, dots: [], oneWay: true, row: 2 })!;
  assert.deepEqual(vias(plan(d.rows, d.dots)), ["Ogre", `•${LIELVARDE.lat}`, "Aizkraukle"], "the leg is the same one");
  const live = livePlanDots(d.rows, d.dots, true);
  assert.equal(live.length, 1);
  assert.equal(live[0].afterRow, 1, "drawn after Ogre's row");
  const back = promoteInPlan({ rows: d.rows, picked: d.picked, dots: d.dots, oneWay: true, index: live[0].index, place: LIELVARDE })!;
  assert.equal(back.row, 2);
  assert.deepEqual(back.rows, rows);
  assert.deepEqual(back.picked, picked);
  assert.deepEqual(back.dots, []);
  const p = plan(back.rows, back.dots);
  assert.equal(p.shapePoints, undefined, "absent, not empty: the plan encodes as it always did");
  assert.deepEqual(vias(p), before);
});

test("two stops demoted in turn keep their riding order, and dots after a demoted stop move before it", () => {
  const rows = ["Rīga", "Ogre", "Lielvārde", "Aizkraukle", "Jēkabpils"];
  const picked: Record<number, P | null> = { 0: RIGA, 1: OGRE, 2: LIELVARDE, 3: AIZKRAUKLE, 4: JEKABPILS };
  const one = demoteInPlan({ rows, picked, dots: [], oneWay: true, row: 2 })!; // Lielvārde → dot after Ogre
  const two = demoteInPlan({ rows: one.rows, picked: one.picked, dots: one.dots, oneWay: true, row: 1 })!; // Ogre → dot after Rīga, before Lielvārde's
  assert.deepEqual(two.rows, ["Rīga", "Aizkraukle", "Jēkabpils"]);
  const p = plan(two.rows, two.dots);
  assert.deepEqual(p.shapePoints, [{ lat: OGRE.lat, lon: OGRE.lon, afterPlace: 0 }, { lat: LIELVARDE.lat, lon: LIELVARDE.lon, afterPlace: 0 }]);
  assert.deepEqual(vias(p), [`•${OGRE.lat}`, `•${LIELVARDE.lat}`, "Aizkraukle"]);
  // Promote the second dot back: Lielvārde returns between the Ogre dot and Aizkraukle.
  const live = livePlanDots(two.rows, two.dots, true);
  const back = promoteInPlan({ rows: two.rows, picked: two.picked, dots: two.dots, oneWay: true, index: live[1].index, place: LIELVARDE })!;
  assert.deepEqual(back.rows, ["Rīga", "Lielvārde", "Aizkraukle", "Jēkabpils"]);
  assert.deepEqual(vias(plan(back.rows, back.dots)), [`•${OGRE.lat}`, "Lielvārde", "Aizkraukle"]);
});

test("a dot follows its place by name when the rows move, and goes when its place goes", () => {
  const dots: PlanDot[] = [{ lat: 1, lon: 1, after: "lielvārde" }];
  // Aizkraukle moved above Lielvārde: the dot stays after Lielvārde.
  assert.deepEqual(vias(plan(["Rīga", "Aizkraukle", "Lielvārde", "Jēkabpils"], dots)), ["Aizkraukle", "Lielvārde", "•1"]);
  // Lielvārde removed: the dot is not planned, not guessed into another leg.
  assert.equal(plan(["Rīga", "Aizkraukle", "Jēkabpils"], dots).shapePoints, undefined);
  assert.deepEqual(livePlanDots(["Rīga", "Aizkraukle", "Jēkabpils"], dots, true), []);
});

test("a round trip: a dot after the last stop rides before the way home", () => {
  const rows = ["Rīga", "Ogre", "Lielvārde"];
  const picked: Record<number, P | null> = { 0: RIGA, 1: OGRE, 2: LIELVARDE };
  const d = demoteInPlan({ rows, picked, dots: [], oneWay: false, row: 2 })!;
  const p = plan(d.rows, d.dots, false);
  assert.equal(p.returnToStart, true);
  assert.deepEqual(vias(p), ["Ogre", `•${LIELVARDE.lat}`]);
});

test("a plan's own shapePoints come back as dots on the rows placesFromPlan makes, and plan the same", () => {
  const p = plan(["Rīga", "Ogre", "Lielvārde", "Jēkabpils"], [{ lat: 2, lon: 2, after: null }, { lat: 3, lon: 3, after: "ogre" }, { lat: 4, lon: 4, after: "lielvārde" }]);
  const rows = placesFromPlan(p);
  const dots = planDotsFromPlan(rows, p.shapePoints, true);
  assert.deepEqual(plan(rows, dots).shapePoints, p.shapePoints);
});

test("the plan never carries more pass-through points than the cap", () => {
  const dots: PlanDot[] = Array.from({ length: 25 }, (_, i) => ({ lat: i, lon: i, after: null }));
  assert.equal(planShapePoints(["Rīga", "Ogre"], dots, true, 20).length, 20);
});

test("demote refuses a row that is not a planned place", () => {
  assert.equal(demoteInPlan({ rows: ["Rīga", "", "Ogre"], picked: { 0: RIGA, 2: OGRE }, dots: [], oneWay: true, row: 1 }), null, "an empty row");
  assert.equal(demoteInPlan({ rows: ["Rīga", "Ogre"], picked: { 0: RIGA, 1: OGRE }, dots: [], oneWay: true, row: 0 }), null, "the start");
});
