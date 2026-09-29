import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STRETCH_DRAG_MIN_PX, stretchDragStep, type StretchDragState } from "../lib/map/stretch-drag";
import { insideScroller } from "../lib/map/scroll-lock";
import { moveStretchEnd, STRETCH_MAX_M, STRETCH_MIN_M, type Stretch } from "../lib/routing/stretch";

/**
 * Backlog 51 (rider, 2026-09-30): after tapping a stretch the end handles
 * stopped following, the map stopped panning, „Atļaut atkal” could not be
 * reached, and on the phone the page scrolled under the full-screen map.
 *
 * `npx tsx --test scripts/stretch-drag.test.ts`
 */

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const layer = src("components/map/stretch-layer.ts");
const routeMap = src("components/route-map.tsx");
const composer = src("components/ride-composer.tsx");
const panel = src("components/map-panel.tsx");

const down = (pointerId = 1, end: "from" | "to" = "to", primary = true) => ({ type: "down" as const, pointerId, end, x: 100, y: 100, primary });

test("a press, a move and a release: start, follow, done — and then nothing is held", () => {
  let r = stretchDragStep(null, down());
  assert.equal(r.action, "start");
  r = stretchDragStep(r.state, { type: "move", pointerId: 1, x: 100 + STRETCH_DRAG_MIN_PX + 1, y: 100 });
  assert.equal(r.action, "follow");
  r = stretchDragStep(r.state, { type: "up", pointerId: 1 });
  assert.equal(r.action, "done");
  assert.equal(r.state, null);
});

test("the same handle can be dragged again and again — every drag ends clean", () => {
  let state: StretchDragState | null = null;
  for (let k = 0; k < 5; k++) {
    let r = stretchDragStep(state, down(10 + k));
    assert.equal(r.action, "start", `drag ${k} starts`);
    r = stretchDragStep(r.state, { type: "move", pointerId: 10 + k, x: 300, y: 300 });
    assert.equal(r.action, "follow");
    // Every way a drag can end: a release, a cancel (iOS took the touch), a lost capture.
    r = stretchDragStep(r.state, { type: k % 2 ? "cancel" : "up", pointerId: 10 + k });
    assert.equal(r.action, "done");
    state = r.state;
    assert.equal(state, null, `nothing held after drag ${k}`);
  }
});

test("a jitter under the threshold is a tap: nothing follows", () => {
  const r0 = stretchDragStep(null, down());
  const r1 = stretchDragStep(r0.state, { type: "move", pointerId: 1, x: 101, y: 101 });
  assert.equal(r1.action, null);
  assert.equal(r1.state?.moved, false);
});

test("a second finger ends the drag: the pinch is the map's", () => {
  const r0 = stretchDragStep(null, down(1));
  const r1 = stretchDragStep(r0.state, { type: "move", pointerId: 1, x: 150, y: 150 });
  const r2 = stretchDragStep(r1.state, down(2, "to", false));
  assert.equal(r2.action, "done");
  assert.equal(r2.state, null);
  // …and its later events are ignored.
  assert.equal(stretchDragStep(null, { type: "move", pointerId: 2, x: 0, y: 0 }).action, null);
  assert.equal(stretchDragStep(null, { type: "up", pointerId: 1 }).action, null);
});

test("another pointer's moves and releases do not steer or end the held handle", () => {
  const r0 = stretchDragStep(null, down(1));
  assert.equal(stretchDragStep(r0.state, { type: "move", pointerId: 7, x: 400, y: 400 }).action, null);
  const r1 = stretchDragStep(r0.state, { type: "up", pointerId: 7 });
  assert.equal(r1.action, null);
  assert.ok(r1.state, "still held");
});

test("the ends never cross, whichever is dragged, however far", () => {
  const total = 50_000;
  let s: Stretch = { fromMeters: 20_000, toMeters: 21_000 };
  // The far end dragged far back past the near one, then far forward.
  s = moveStretchEnd(s, "to", 0, total);
  assert.equal(s.toMeters - s.fromMeters, STRETCH_MIN_M);
  s = moveStretchEnd(s, "to", 25_000, total);
  assert.equal(s.toMeters, 25_000);
  // The near end dragged the whole way along, both ways.
  s = moveStretchEnd(s, "from", total, total);
  assert.ok(s.fromMeters <= s.toMeters - STRETCH_MIN_M);
  s = moveStretchEnd(s, "from", 0, total);
  assert.ok(s.toMeters - s.fromMeters <= STRETCH_MAX_M);
  assert.ok(s.fromMeters < s.toMeters);
});

test("the handles are not MapLibre's draggable markers, and own their pointer", () => {
  assert.doesNotMatch(layer, /draggable:\s*true/, "MapLibre's marker drag ends only on the map's mouseup");
  assert.match(layer, /setPointerCapture/);
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) assert.ok(layer.includes(`"${ev}"`), `${ev} ends the drag`);
  // The map never sees the handle's press.
  assert.match(layer, /"mousedown", stop/);
  assert.match(layer, /"touchstart", "touchmove", "touchend", "touchcancel"/);
  // A drag under way when the selection goes simply ends.
  assert.match(layer, /gesture = null;\s*\n\s*for \(const h of handles\) h\.remove\(\)/);
});

test("the bottom chrome column lets the map under it take the pointer", () => {
  const m = /<div ref=\{headerRef\} data-map-chrome className=\{controls \? "([^"]+)"/.exec(routeMap);
  assert.ok(m, "the column is found");
  assert.match(m![1], /(^| )pointer-events-none( |$)/);
  assert.match(m![1], /\[&>\*\]:pointer-events-auto/);
});

test("the tapped excluded stretch reaches the map's controls, and a settled tap does not close its sheet", () => {
  assert.match(composer, /const stretchKey = \[exSel/);
  assert.match(composer, /addKey, stretchKey\]\);/);
  const onClick = routeMap.slice(routeMap.indexOf("const onClick = (e: maplibregl.MapMouseEvent) => {"));
  assert.ok(onClick.indexOf("clickOnExcluded(map, e.point)") < onClick.indexOf('sheet?.mode === "menu"'), "excluded check first");
});

test("full screen locks the page scroll through lockPageScroll, and unlocks it", () => {
  assert.match(panel, /const unlock = lockPageScroll\(rootRef\.current\)/);
  assert.match(panel, /return \(\) => \{ unlock\(\);/);
});

test("a touch inside a list that really scrolls keeps its scroll; elsewhere it is the page's and is cancelled", () => {
  type El = { parentElement: El | null; scrollHeight: number; clientHeight: number; oy: string };
  const root: El = { parentElement: null, scrollHeight: 800, clientHeight: 800, oy: "visible" };
  const list: El = { parentElement: root, scrollHeight: 600, clientHeight: 200, oy: "auto" };
  const item: El = { parentElement: list, scrollHeight: 40, clientHeight: 40, oy: "visible" };
  const short: El = { parentElement: root, scrollHeight: 100, clientHeight: 100, oy: "auto" };
  const style = (e: Element) => ({ overflowY: (e as unknown as El).oy });
  const as = (e: El) => e as unknown as Element;
  assert.equal(insideScroller(as(item), as(root), style), true);
  assert.equal(insideScroller(as(short), as(root), style), false, "a list with nothing to scroll is not a scroller");
  assert.equal(insideScroller(as(root), as(root), style), false);
  assert.equal(insideScroller(null, as(root), style), false);
});
