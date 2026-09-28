import test from "node:test";
import assert from "node:assert/strict";
import { CLOSE_DETOURS, FAR_FROM_LINE_M, ON_LINE_M, onLineElsewhere, placeNewPoint, stopNumbers, type Pt } from "../lib/map/insert-leg";
import { mergeAddedInOrder, mergeShapes, planEdit, type RidePlace, type RidePlaces } from "../lib/routing/reroute-leg";
import { cumulative } from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";

/**
 * Where a new point goes (Phase 1 addition, rider 2026-09-28): into the leg
 * it is nearest to by the smallest detour, numbered in riding order, with
 * two choices when Mopik is not sure; its kind switched while pending; and a
 * pass-through point moved onto the line elsewhere.
 *
 * `npx tsx --test scripts/insert-leg.test.ts`
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);
const M_PER_DEG_LAT = 110_540;
const lonAt = (km: number) => 24.0 + (km * 1000) / M_PER_DEG_LON;
const at = (km: number, northM = 0): Pt => ({ lat: LAT + northM / M_PER_DEG_LAT, lon: lonAt(km) });
const place = (km: number, name: string, northM = 0): RidePlace => ({ name, label: name, ...at(km, northM) });

/** A line east along 57° N, a point every 100 m, from `fromKm` to `toKm` (either way). */
function eastLine(fromKm: number, toKm: number): Point[] {
  const out: Point[] = [];
  const n = Math.round(Math.abs(toKm - fromKm) * 10);
  for (let i = 0; i <= n; i++) out.push([lonAt(fromKm + (Math.sign(toKm - fromKm) * i) / 10), LAT]);
  return out;
}
const LINE = eastLine(0, 30);
/** Rows of a one-way ride: Starts 0 km, „A” 10 km, „B” 20 km, Finišs 30 km. */
const ROWS: (Pt | null)[] = [at(0), at(10), at(20), at(30)];

test("editing: a new point goes into the leg whose line passes nearest — sure, no choices", () => {
  const p = placeNewPoint({ rows: ROWS, point: at(15, 300), oneWay: true, line: LINE })!;
  assert.equal(p.chosen.key, "leg:1");
  assert.equal(p.chosen.before, 1, "after „A”");
  assert.equal(p.chosen.after, 2, "before „B”");
  assert.equal(p.chosen.index, 2, "it takes row 2: between „A” and „B”");
  assert.ok(Math.abs(p.chosen.detour - 600) < 5, `detour is out to it and back: ${p.chosen.detour}`);
  assert.equal(p.unsure, null);
  assert.equal(p.options, null);
  assert.ok(p.chosen.onLine && Math.abs(p.chosen.onLine[0] - lonAt(15)) < 1e-4, "joins the line where the leg passes nearest");
});

test("planning: the legs are straight lines — dist(prev, p) + dist(p, next) − dist(prev, next)", () => {
  // Round trip Starts (0, 0) → „A” (10 km east) → „B” (10 km east, 10 km north) → back to Starts.
  const rows: (Pt | null)[] = [at(0), at(10), at(10, 10_000)];
  // Just off the return leg B → Starts, the diagonal.
  const p = placeNewPoint({ rows, point: at(5, 5_200), oneWay: false })!;
  assert.equal(p.chosen.key, "leg:2");
  assert.equal(p.chosen.before, 2);
  assert.equal(p.chosen.after, 0, "the return leg ends at the start");
  assert.equal(p.chosen.index, 3, "after the last stop, before the ride returns");
  assert.equal(p.chosen.extend, false);
  // Near the first leg instead.
  assert.equal(placeNewPoint({ rows, point: at(5, 200), oneWay: false })!.chosen.index, 1);
});

test("a tie — the best two detours within 15 % — offers both legs, the best preselected", () => {
  // 500 m north of „A” itself: before it or after it is the same detour.
  const p = placeNewPoint({ rows: ROWS, point: at(10, 500), oneWay: true, line: LINE })!;
  assert.equal(p.unsure, "close");
  assert.deepEqual(p.options!.map((o) => o.key).sort(), ["leg:0", "leg:1"]);
  assert.equal(p.chosen.key, p.options![0].key, "the first chip is the preselected one");
  // The other chip re-inserts it: the rows either side of „A”.
  const other = p.options![1].key;
  const again = placeNewPoint({ rows: ROWS, point: at(10, 500), oneWay: true, line: LINE, choose: other })!;
  assert.equal(again.chosen.key, other);
  assert.deepEqual(new Set([p.chosen.index, again.chosen.index]), new Set([1, 2]));
  assert.deepEqual(again.options!.map((o) => o.key), p.options!.map((o) => o.key), "the same two choices stay on offer");
  // Just outside the 15 %: sure.
  const clear = placeNewPoint({ rows: ROWS, point: at(12, 500), oneWay: true, line: LINE })!;
  assert.equal(clear.unsure, null);
  assert.ok(CLOSE_DETOURS === 0.15);
});

test("far from the line (> 2 km from every leg) offers the best two, even when one is clearly best", () => {
  const p = placeNewPoint({ rows: ROWS, point: at(15, 3_000), oneWay: true, line: LINE })!;
  assert.equal(p.unsure, "far");
  assert.equal(p.options!.length, 2);
  assert.equal(p.options![0].key, "leg:1", "the nearest leg first, preselected");
  assert.equal(p.chosen.key, "leg:1");
  assert.ok(p.chosen.distance > FAR_FROM_LINE_M);
  // Planning has no line to be far from: sure.
  assert.equal(placeNewPoint({ rows: ROWS, point: at(15, 3_000), oneWay: true })!.unsure, null);
});

test("beyond a one-way finish: the best leg preselected, „Beigās (jauns finišs)” the other chip", () => {
  const p = placeNewPoint({ rows: ROWS, point: at(31), oneWay: true, line: LINE })!;
  assert.equal(p.unsure, "beyond-finish");
  assert.deepEqual(p.options!.map((o) => o.key), ["leg:2", "extend"]);
  assert.equal(p.chosen.key, "leg:2", "a stop is what „+” asked for");
  assert.equal(p.chosen.index, 3, "before the finish");
  const extend = placeNewPoint({ rows: ROWS, point: at(31), oneWay: true, line: LINE, choose: "extend" })!;
  assert.equal(extend.chosen.extend, true);
  assert.equal(extend.chosen.index, 4, "the last row: the new finish; the old one becomes a stop");
  assert.equal(extend.chosen.before, 3);
  assert.equal(extend.chosen.after, null);
  // A round trip has no finish to ride past.
  const loop = placeNewPoint({ rows: [at(0), at(10), at(20)], point: at(31), oneWay: false })!;
  assert.ok(loop.options?.every((o) => !o.extend) ?? true);
  // Nor a pass-through point (`allowExtend` false): the leg, and sure.
  const pass = placeNewPoint({ rows: ROWS, point: at(31), oneWay: true, line: LINE, allowExtend: false, choose: "extend" })!;
  assert.equal(pass.chosen.key, "leg:2");
  assert.equal(pass.unsure, null);
});

test("new points in the same leg are ordered by where they meet it", () => {
  // „A” 10 km, a pending new point at 12 km (row 2), „B” 20 km.
  const rows: (Pt | null)[] = [at(0), at(10), at(12, 200), at(20), at(30)];
  const pending = [false, false, true, false, false];
  assert.equal(placeNewPoint({ rows, pending, point: at(17, 200), oneWay: true, line: LINE })!.chosen.index, 3, "after the pending one");
  assert.equal(placeNewPoint({ rows, pending, point: at(11, 200), oneWay: true, line: LINE })!.chosen.index, 2, "before it");
  // A pending point is not a place to measure legs by: still leg 1 (A–B).
  assert.equal(placeNewPoint({ rows, pending, point: at(17, 200), oneWay: true, line: LINE })!.chosen.key, "leg:1");
  // Planning, by where each projects onto the straight leg.
  assert.equal(placeNewPoint({ rows, pending, point: at(17, 200), oneWay: true })!.chosen.index, 3);
});

test("open ends while planning: an empty finish or start row is ridden to or from anywhere", () => {
  // One way, the finish row empty: after „A” is the open end.
  const p = placeNewPoint({ rows: [at(0), at(10), null], point: at(14), oneWay: true })!;
  assert.equal(p.chosen.before, 1);
  assert.equal(p.chosen.after, null);
  assert.equal(p.chosen.index, 2, "before the empty finish row");
  assert.equal(p.chosen.extend, false);
  // The start row empty: before the first place.
  const q = placeNewPoint({ rows: [null, at(10), at(20)], point: at(2), oneWay: true })!;
  assert.equal(q.chosen.before, null);
  assert.equal(q.chosen.after, 1);
  assert.equal(q.chosen.index, 1);
  // Nothing placed at all: nothing to put it between.
  assert.equal(placeNewPoint({ rows: [null, null], point: at(2), oneWay: true }), null);
});

test("renumbering: the stops after a pending new point move up one, and back when it goes", () => {
  // Starts, 1 „A”, NEW, „B” (was 2), a sight, „C” (was 3), Finišs.
  assert.deepEqual(stopNumbers(["none", "stop", "stop", "stop", "sight", "stop", "none"]), [null, 1, 2, 3, null, 4, null]);
  // The same rows with the new point gone (✕, or switched to „Caurbraucams”).
  assert.deepEqual(stopNumbers(["none", "stop", "stop", "sight", "stop", "none"]), [null, 1, 2, null, 3, null]);
});

test("the kind switch: a stop's leg is the same leg as a pass-through point, which joins the line there", () => {
  const stop = placeNewPoint({ rows: ROWS, point: at(10, 500), oneWay: true, line: LINE, choose: "leg:1" })!;
  const pass = placeNewPoint({ rows: ROWS, point: at(10, 500), oneWay: true, line: LINE, allowExtend: false, choose: stop.chosen.key })!;
  assert.equal(pass.chosen.key, "leg:1", "the leg carries over");
  assert.ok(pass.chosen.onLine, "where the grabbed line point sits");
  assert.ok(pass.chosen.onLine![0] >= lonAt(10) - 1e-6, "on the leg's own stretch of line (A → B)");
  // A new finish is not something a pass-through point can be: its leg is the one before.
  const ext = placeNewPoint({ rows: ROWS, point: at(33), oneWay: true, line: LINE, choose: "extend" })!;
  const back = placeNewPoint({ rows: ROWS, point: at(33), oneWay: true, line: LINE, allowExtend: false, choose: ext.chosen.extend ? null : ext.chosen.key })!;
  assert.equal(back.chosen.key, "leg:2");
});

test("the rows' order is kept for a new stop — among the pass-through points in its leg by the line", () => {
  const line = eastLine(0, 30);
  const shape: RidePlace = { name: "", label: "", ...at(15), shape: true };
  const before: RidePlaces = { start: place(0, "S"), vias: [place(10, "A"), shape, place(20, "B")], finish: place(30, "F"), roundTrip: false };
  const late = place(17, "Jaunā", 100);
  const early = place(12, "Agrā", 100);
  const rows = (v: RidePlace): RidePlaces => ({ ...before, vias: [before.vias[0], v, before.vias[2]] });
  assert.deepEqual(mergeAddedInOrder(before, rows(late), line)!.vias.map((v) => v.name || "·"), ["A", "·", "Jaunā", "B"]);
  assert.deepEqual(mergeAddedInOrder(before, rows(early), line)!.vias.map((v) => v.name || "·"), ["A", "Agrā", "·", "B"]);
  // Not a pure addition: mergeShapes decides, as before.
  assert.equal(mergeAddedInOrder(before, { ...before, vias: [before.vias[2], before.vias[0]] }, line), null);
  assert.equal(mergeAddedInOrder(before, { ...rows(late), finish: place(33, "G") }, line), null, "a new finish is not an addition in place");
  // …and the extension still ends in the right order through mergeShapes.
  const ext = mergeShapes(before, { ...before, vias: [before.vias[0], before.vias[2], before.finish!], finish: place(33, "G") });
  assert.deepEqual(ext.vias.map((v) => v.name || "·"), ["A", "·", "B", "F"]);
});

test("planEdit keeps the leg the rider chose on an out-and-back, where the line passes the spot twice", () => {
  // Round trip: out 0 → 10 km, back 10 → 0 km on the same road. „A” at the turn.
  const line = [...eastLine(0, 10), ...eastLine(10, 0).slice(1)];
  const before: RidePlaces = { start: place(0, "S"), vias: [place(10, "A")], finish: null, roundTrip: true };
  const p = place(5, "Jaunā", 100);
  // Both passes are the same detour: Mopik offers both.
  const rows: (Pt | null)[] = [at(0), at(10)];
  const choice = placeNewPoint({ rows, point: p, oneWay: false, line })!;
  assert.equal(choice.unsure, "close");
  // The rider chose the way back: after „A”.
  const after: RidePlaces = { ...before, vias: [before.vias[0], p] };
  const kept = planEdit({ line, cum: cumulative(line), before, after, keepOrder: true });
  assert.ok(kept && !("error" in kept));
  assert.deepEqual(kept.places.vias.map((v) => v.name), ["A", "Jaunā"], "kept after „A”");
  const mid = (kept.runs[0].fromMeters + kept.runs[0].toMeters) / 2;
  assert.ok(mid > 10_000, `re-routed on the way back, not the way out: ${Math.round(mid)} m`);
  // Without it the line's first pass wins, as it always did.
  const old = planEdit({ line, cum: cumulative(line), before, after });
  assert.ok(old && !("error" in old));
  assert.deepEqual(old.places.vias.map((v) => v.name), ["Jaunā", "A"]);
});

test("§3: a pass-through point moved onto the line elsewhere — within 20 m, outside the stretch it shapes", () => {
  const line = eastLine(0, 30);
  // „A” at 10 km, a pass-through point at 20 km: it shapes 10 → 30 km.
  const places: RidePlaces = { start: place(0, "S"), vias: [place(10, "A"), { name: "", label: "", ...at(20), shape: true }], finish: place(30, "F"), roundTrip: false };
  assert.equal(onLineElsewhere({ line, places, shapeIndex: 0, to: at(5, 10) }), true, "on the line before „A”");
  assert.equal(onLineElsewhere({ line, places, shapeIndex: 0, to: at(5, 50) }), false, "50 m off it");
  assert.equal(onLineElsewhere({ line, places, shapeIndex: 0, to: at(25, 5) }), false, "on its own stretch: that line changes anyway");
  assert.equal(onLineElsewhere({ line, places, shapeIndex: 3, to: at(5, 5) }), false, "no such point");
  assert.equal(ON_LINE_M, 20);
});
