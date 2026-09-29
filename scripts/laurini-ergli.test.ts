/**
 * The rider's Lauriņi → Ērgļi of 2026-09-28, on his own GPX: a pass-through
 * point moved across the Ogre onto a junction of a through road (east bank,
 * by Ogresgals / Turkalne), and the proposal said „Līdz šejienei ved tikai
 * strupceļš – atpakaļ pa to pašu ceļu 9,8 km”. „Tā nav taisnība.”
 *
 *   npx tsx --test scripts/laurini-ergli.test.ts
 *
 * Measured against production BRouter (`scripts/measure-shape-move.ts
 * scripts/fixtures/laurini-ergli-2026-09-28.gpx 56.811 24.688 56.816 24.710`):
 * the move's ±3 km window cut the ride at two points on the WEST bank; from
 * the junction the only way to the second cut was back up the east bank the
 * way in — 9.8 km twice. The fenced way round existed (33 km) and was only
 * too long for the loop bound, so "dead end" was never proved. Widened by
 * 15 km each way the stretch rides through the junction and on, 141.4 km,
 * no spur. These tests pin the geometry half: where the window cut, how it
 * is widened, and what may be said.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Point } from "@/lib/geo/geometry";
import { cumulative } from "@/lib/routing/detour";
import { WIDEN_STEPS_M, anchorsAlong, anchorsOf, nearestAlong, planEdit, widenRun, type RidePlaces } from "@/lib/routing/reroute-leg";
import { deadEndNoteKey } from "@/lib/map/edit-reach";

const GPX = readFileSync(new URL("./fixtures/laurini-ergli-2026-09-28.gpx", import.meta.url), "utf8");
const LINE: Point[] = [...GPX.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
const CUM = cumulative(LINE);
const TOTAL = CUM[CUM.length - 1];
const WAS: Point = [24.688, 56.811]; // the pass-through point, on the ride west of the river
const JUNCTION: Point = [24.71, 56.816]; // where he moved it: the V-road junction east of the Ogre

const on = (p: Point) => {
  const n = nearestAlong(p, LINE, CUM);
  return { at: n.alongMeters, off: n.meters };
};
const place = (lat: number, lon: number, name: string) => ({ name, label: name, lat, lon });
const shapeAt = (p: Point) => ({ name: "", label: "", lat: p[1], lon: p[0], shape: true as const });
const BEFORE: RidePlaces = {
  start: place(56.81077, 24.286293, "Lauriņi"),
  finish: place(56.896228, 25.639882, "Ērgļi"),
  roundTrip: false,
  vias: [shapeAt(WAS)],
};
const AFTER: RidePlaces = { ...BEFORE, vias: [shapeAt(JUNCTION)] };

test("the fixture: 136 km, the point on the ride, the junction 1.1 km across the river from it", () => {
  assert.ok(Math.abs(TOTAL - 135_800) < 500, `about 136 km, got ${Math.round(TOTAL)}`);
  assert.ok(on(WAS).off < 200, "the point was on the ride");
  const j = on(JUNCTION);
  assert.ok(j.off > 1_000 && j.off < 1_300, `the junction is ~1.1 km off the line, got ${Math.round(j.off)}`);
});

test("the move's window cut the ride on the far bank, both ends west of the junction", () => {
  const planned = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: AFTER });
  assert.ok(planned && !("error" in planned));
  assert.equal(planned.kind, "move-stop");
  assert.equal(planned.runs.length, 1);
  const run = planned.runs[0];
  assert.ok(run.toMeters - run.fromMeters <= 6_500, `a ±3 km window, got ${Math.round(run.toMeters - run.fromMeters)} m`);
  const [a, , b] = run.points;
  // Both cuts lie west of the junction: any way on from it to the second
  // cut is back towards where it came from — the out-and-back he saw.
  assert.ok(a[0] < JUNCTION[0] - 0.02 && b[0] < JUNCTION[0] - 0.02, `cuts at ${a[0]} and ${b[0]}`);
});

test("widened, the stretch reaches on along the ride — never past start or finish, never past a kept stop", () => {
  const planned = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: AFTER });
  assert.ok(planned && !("error" in planned));
  const run = planned.runs[0];
  const keptAlong = anchorsAlong(anchorsOf(BEFORE, LINE[LINE.length - 1]), LINE, CUM);
  const wide = widenRun({ run, line: LINE, cum: CUM, keptAlong, by: WIDEN_STEPS_M[WIDEN_STEPS_M.length - 1] });
  assert.ok(wide);
  assert.ok(Math.abs(wide.fromMeters - (run.fromMeters - 15_000)) < 1 && Math.abs(wide.toMeters - (run.toMeters + 15_000)) < 1);
  assert.deepEqual(wide.points[1], run.points[1], "the moved point stays the stretch's place");
  assert.ok(nearestAlong(wide.points[0], LINE, CUM).meters < 1 && nearestAlong(wide.points[2], LINE, CUM).meters < 1, "both ends are cuts on the line");
  // A stop at km 62 is kept: the widened stretch stops at it.
  const stop = LINE[CUM.findIndex((m) => m >= 62_000)];
  const withStop: RidePlaces = { ...BEFORE, vias: [...BEFORE.vias, place(stop[1], stop[0], "Pietura")] };
  const keptWithStop = anchorsAlong(anchorsOf(withStop, LINE[LINE.length - 1]), LINE, CUM);
  const clamped = widenRun({ run, line: LINE, cum: CUM, keptAlong: keptWithStop, by: 15_000 });
  assert.ok(clamped && Math.abs(clamped.toMeters - on(stop).at) < 1, `stops at the kept stop, got ${Math.round(clamped!.toMeters)}`);
  // A drawn straight stretch is fixed.
  const fixed: [number, number][] = [[run.toMeters + 2_000, run.toMeters + 2_500]];
  const drawn = widenRun({ run, line: LINE, cum: CUM, keptAlong, fixed, by: 15_000 });
  assert.ok(drawn && Math.abs(drawn.toMeters - (run.toMeters + 2_000)) < 1);
  // Nothing to widen: a stretch already from start to finish.
  assert.equal(widenRun({ run: { fromMeters: 0, toMeters: TOTAL, points: [LINE[0], JUNCTION, LINE[LINE.length - 1]] }, line: LINE, cum: CUM, keptAlong, by: 5_000 }), null);
});

test("a dead end is said only when the router proved it", () => {
  // His case: a way round was found and was too long — not proved.
  assert.equal(deadEndNoteKey({ deadEndAtShape: true }, true), "editNoWayThroughShape");
  assert.equal(deadEndNoteKey({ deadEndAtShape: true }), "editNoWayThroughShape");
  assert.equal(deadEndNoteKey({}), "editNoWayThrough");
  assert.equal(deadEndNoteKey({ deadEndAtShape: true, deadEndProved: true }, true), "editDeadEndShapeAsk");
  assert.equal(deadEndNoteKey({ deadEndAtShape: true, deadEndProved: true }), "editDeadEndShape");
  assert.equal(deadEndNoteKey({ deadEndProved: true }), "editDeadEnd");
  // Out of time: what the line does, never why.
  assert.equal(deadEndNoteKey({ deadEndUnchecked: true, deadEndProved: true }), "editSameWayBack");
  assert.equal(deadEndNoteKey({ deadEndUnchecked: true, deadEndAtShape: true }), "editSameWayBackShape");
});
