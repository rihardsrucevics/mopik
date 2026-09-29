import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EDIT_TIP_KEY, NEAR_MARKER_PX, editTipDue, lineSheetRows, lineSpotAt, lineTapAction, markEditTipSeen, markerNear, passOnLine,
} from "../lib/map/line-sheet";
import { stepShape, type ShapePending } from "../lib/map/shape-pending";
import { applyShapeEdit, isShape, nearestAlong, type RidePlace, type RidePlaces } from "../lib/routing/reroute-leg";
import { cumulative } from "../lib/routing/detour";
import { MAX_SHAPE_POINTS } from "../lib/chat/ride-limits";
import type { Point } from "../lib/geo/geometry";

/**
 * Tap the line (rider, 2026-09-28): nobody found out the line can be moved —
 * the only way was a 350 ms hold and a drag. In edit mode a tap on the line
 * opens its sheet: „Virzīt caur citu vietu” (the drag's own edit, one tap
 * later) and „Pievienot punktu šeit” (a pass-through point on the line, the
 * line unchanged, one undo step). The result and shared maps keep the card;
 * a tap on or beside a pin or a gate is that marker's.
 *
 * `npx tsx --test scripts/line-sheet.test.ts`
 */

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const routeMap = src("components/route-map.tsx");
const composer = src("components/ride-composer.tsx");
const home = src("components/home-page.tsx");

// A straight east-west ride at 57°N: 0.01° of longitude every ~606 m.
const LAT = 57;
const line: Point[] = Array.from({ length: 11 }, (_, i) => [24 + i * 0.01, LAT]);
const at = (i: number) => ({ lat: LAT, lon: 24 + i * 0.01 });
const place = (i: number, name: string): RidePlace => ({ name, label: name, ...at(i) });
const ride: RidePlaces = { start: place(0, "S"), vias: [place(3, "A"), place(7, "B")], finish: place(10, "F"), roundTrip: false };

test("edit mode opens the line's sheet; the result and shared maps keep the card", () => {
  assert.equal(lineTapAction({ editing: true, nearMarker: false }), "sheet");
  assert.equal(lineTapAction({ editing: false, nearMarker: false }), "card");
  // The map only has `onLineTap` in edit mode: the composer passes it in its
  // edit branch, and nothing else builds map controls with it.
  const editBranch = composer.slice(composer.indexOf("...(edit ? {"), composer.indexOf("} : {\n        // Planning: the pass-through dots"));
  assert.match(editBranch, /onLineTap: batchActive[^?]*\? undefined :/);
  assert.equal(composer.split("onLineTap:").length - 1, 1, "only the edit branch offers it");
  for (const f of ["components/shared-route.tsx", "components/result-panel.tsx", "components/home-page.tsx"]) {
    assert.doesNotMatch(src(f), /onLineTap/, `${f} never asks for the line sheet`);
  }
  // Without it the tap opens the card, as before.
  const click = routeMap.slice(routeMap.indexOf("const onClick = (e: maplibregl.MapMouseEvent)"), routeMap.indexOf("const nearMarkers = ()"));
  assert.match(click, /const lineTap = lineTapRef\.current;\n\s+if \(lineTap\) \{/);
  assert.match(click, /\/\/ ── \/line-sheet ──\n\s+openCard\(e\.lngLat, id, props\);/);
});

test("the sheet's rows are always both there, off with a reason when they cannot act", () => {
  assert.deepEqual(lineSheetRows({ shapeCount: 0, rerouting: false }), [
    { action: "via", enabled: true, reason: null },
    { action: "pass", enabled: true, reason: null },
  ]);
  assert.deepEqual(lineSheetRows({ shapeCount: MAX_SHAPE_POINTS, rerouting: false }).map((r) => [r.action, r.enabled, r.reason]), [["via", false, "cap"], ["pass", false, "cap"]]);
  assert.deepEqual(lineSheetRows({ shapeCount: 1, rerouting: true }).map((r) => [r.enabled, r.reason]), [[false, "busy"], [false, "busy"]]);
});

test("„Virzīt caur citu vietu” is the same ShapeEdit as a drag let go at that place", () => {
  const tapped: Point = [24.052, LAT + 0.0002]; // ~22 m off the line, between A and B
  const target = { lat: LAT + 0.01, lon: 24.05 };
  // The drag: the press point on the line (`grabLineAt` → `lineSpotOf`), then the release as the mark.
  const grabSpot = lineSpotAt(line, tapped, ride.vias)!;
  const drag = (() => {
    let p: ShapePending | null = stepShape(null, { type: "grab", at: { lat: grabSpot.lat, lon: grabSpot.lon } }).pending;
    p = stepShape(p, { type: "mark", at: target }).pending;
    return stepShape(p, { type: "confirm" }).commit;
  })();
  // The sheet: the tap's spot (the same function), „Virzīt…”, then the next tap.
  const sheetSpot = lineSpotAt(line, tapped, ride.vias)!;
  const via = (() => {
    let p: ShapePending | null = stepShape(null, { type: "grab", at: { lat: sheetSpot.lat, lon: sheetSpot.lon } }).pending;
    p = stepShape(p, { type: "mark", at: target }).pending;
    return stepShape(p, { type: "confirm" }).commit;
  })();
  assert.deepEqual(via, drag);
  assert.deepEqual(applyShapeEdit(ride, via!), applyShapeEdit(ride, drag!));
  assert.equal(sheetSpot.slot, 1, "one stop (A) before the spot");
  assert.ok(Math.abs(sheetSpot.lat - LAT) < 1e-9, "the spot is on the line");
  // And the wiring: both paths take the spot from `lineSpotOf`, and the
  // sheet's row calls the drag's own `grabLine` with it.
  assert.match(routeMap, /const grabLineAt = [^]*?const spot = lineSpotOf\(lngLat\);/);
  assert.match(routeMap, /const spot = lineSpotOf\(e\.lngLat\);\n\s+if \(spot\) \{/);
  assert.match(composer, /const lineVia = \(\) => \{[^]*?grabLine\(\{ lat: sel\.spot\.lat, lon: sel\.spot\.lon, slot: sel\.spot\.slot \}\)/);
});

test("„Pievienot punktu šeit” puts a pass-through point on the line, in the tapped leg, nothing else changed", () => {
  const out = passOnLine(ride, line, { lat: LAT + 0.0001, lon: 24.055, alongMeters: 5.5 * 606 });
  assert.ok(!("error" in out));
  const vias = out.places.vias;
  assert.equal(vias.length, 3);
  assert.deepEqual([vias[0].name, isShape(vias[1]), vias[2].name], ["A", true, "B"], "between A and B, where it was tapped");
  assert.equal(nearestAlong([vias[1].lon, vias[1].lat], line, cumulative(line)).meters < 0.01, true, "exactly on the line");
  assert.deepEqual(out.places.start, ride.start);
  assert.deepEqual(out.places.finish, ride.finish);
  assert.deepEqual([vias[0], vias[2]], ride.vias, "the stops are untouched");
  // Before the first stop, and after the last.
  const first = passOnLine(ride, line, { ...at(1), alongMeters: 606 });
  assert.ok(!("error" in first) && isShape(first.places.vias[0]));
  const last = passOnLine(ride, line, { ...at(9), alongMeters: 9 * 606 });
  assert.ok(!("error" in last) && isShape(last.places.vias[2]));
  // At the cap it is refused, and said.
  const full: RidePlaces = { ...ride, vias: [...ride.vias, ...Array.from({ length: MAX_SHAPE_POINTS }, () => ({ name: "", label: "", ...at(8), shape: true as const }))] };
  assert.deepEqual(passOnLine(full, line, at(5)), { error: "shape-cap" });
});

test("„Pievienot punktu šeit” routes nothing and is one step of the undo", () => {
  const drop = home.slice(home.indexOf("function dropPassHere("), home.indexOf("// ── /line-sheet ──", home.indexOf("function dropPassHere(")));
  assert.doesNotMatch(drop, /proposePlaces|confirmChange|routeProposal|reroute/, "no routing");
  assert.equal(drop.split("commitPlacesOnLine(").length - 1, 1, "one commit");
  const commit = home.slice(home.indexOf("function commitPlacesOnLine("), home.indexOf("// ── line-sheet ──", home.indexOf("function commitPlacesOnLine(")));
  assert.equal(commit.split("pushEdit(").length - 1, 1, "one history step");
  assert.match(commit, /\? \{ \.\.\.edited, places: next, kind: "edit", how \}/, "the edited line is kept as it is");
  assert.match(commit, /coordinates: baseLine,\n\s+segments: route\.segments,/, "or the search's own line");
  assert.match(home, /onPassHere: dropPassHere,/);
});

test("the edit hint shows once per device, and a storage that throws never breaks it", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  assert.equal(editTipDue(store), true, "first time");
  markEditTipSeen(store);
  assert.equal(mem.get(EDIT_TIP_KEY), "seen");
  assert.equal(editTipDue(store), false, "never again on this device");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(editTipDue(broken), true, "no storage: the hint simply shows");
  assert.doesNotThrow(() => markEditTipSeen(broken));
  assert.equal(editTipDue(null), true);
  // It goes on its ✕ and on the first tap on the line, a pin or a dot.
  for (const fn of ["const tapLine = ", "const pressShape = ", "const pressPin = "]) {
    const body = composer.slice(composer.indexOf(fn), composer.indexOf("};", composer.indexOf(fn)));
    assert.match(body, /setTipOn\(false\);/, `${fn} dismisses the hint`);
  }
  assert.match(composer, /tipClose: \(\) => setTipOn\(false\)/);
  // Clear of the phone's button column.
  assert.match(routeMap, /data-edit-tip className="[^"]*max-md:mr-16/);
});

test("a tap on the line next to a pin or a gate is that marker's, never the line's", () => {
  type M = { name: string; box: { left: number; top: number; width: number; height: number } };
  const pin: M = { name: "Pietura 2", box: { left: 100, top: 100, width: 22, height: 22 } };
  const gate: M = { name: "gate", box: { left: 200, top: 100, width: 44, height: 44 } };
  const near = (x: number, y: number) => markerNear([pin, gate], (m) => m.box, x, y)?.name ?? null;
  assert.equal(near(111, 111), "Pietura 2", "on the disc");
  assert.equal(near(100 + 22 + NEAR_MARKER_PX - 2, 111), "Pietura 2", "just beside it");
  assert.equal(near(100 + 22 + NEAR_MARKER_PX + 6, 111), null, "further off, the line's");
  assert.equal(near(250, 122), "gate");
  assert.equal(lineTapAction({ editing: true, nearMarker: true }), "marker");
  // The map checks the ride's pins, its dots and its gates before the sheet,
  // and hands the tap to the marker itself (its own click: sheet or card).
  const markers = routeMap.slice(routeMap.indexOf("const nearMarkers = ()"), routeMap.indexOf("];", routeMap.indexOf("const nearMarkers = ()")));
  for (const ref of ["pinTargetsRef", "shapeMarkersRef", "gateMarkersRef"]) assert.match(markers, new RegExp(ref));
  assert.match(routeMap, /if \(action === "marker" && near\) \{[^]*?near\.dispatchEvent\(new MouseEvent\("click"/);
});

test("no hover label follows a finger: only a real pointer gets one", () => {
  // Rider's phone, 2026-09-28: „Nepārbaudīta piekļuve” popped up beside a tap
  // (the browser's made-up mousemove) and stayed under the sheet.
  const move = routeMap.slice(routeMap.indexOf("const onMouseMove = (e: maplibregl.MapMouseEvent)"), routeMap.indexOf("hover.style.display = \"grid\";"));
  assert.match(move, /const pointer = performance\.now\(\) - lastTouchEndAt > 800 && window\.matchMedia\("\(hover: hover\)"\)\.matches;/);
  assert.match(move, /if \(!pointer \|\| \(!warnings\.length && !tip\) \|\| !hover\) \{ if \(hover\) hover\.style\.display = "none"; return; \}/);
});
