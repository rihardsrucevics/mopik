import test from "node:test";
import assert from "node:assert/strict";
import { PIN_HIT_SLACK_PX, nearestUnder, type Box } from "../lib/map/pin-hit";

/**
 * Two stop pins that overlap: a tap means the one whose centre is nearer
 * (rider, 2026-09-25: his stops 4 and 5 sat 17 px apart on the phone, both
 * 22 px discs, and stop 5 could not be taken to move it).
 *
 * `npx tsx --test scripts/pin-hit.test.ts`
 */

type Pin = { name: string; box: Box };
const disc = (name: string, cx: number, cy: number, size = 22): Pin => ({ name, box: { left: cx - size / 2, top: cy - size / 2, width: size, height: size } });
const four = disc("4", 100, 100);
const five = disc("5", 96, 117); // 17 px away, as on the rider's screen
const pins = [four, five];
const hit = (x: number, y: number) => nearestUnder(pins, (p) => p.box, x, y)?.name ?? null;

test("a tap on the overlap goes to the pin whose centre is nearer", () => {
  assert.equal(hit(99, 104), "4", "just below 4's centre, inside both discs");
  assert.equal(hit(97, 112), "5", "just above 5's centre, inside both discs");
});

test("the pin underneath can be taken wherever it shows", () => {
  // 5 is drawn on top (added later). A tap on 4's own half still means 4.
  assert.equal(hit(100, 92), "4");
  assert.equal(hit(95, 125), "5");
});

test("a thumb a few pixels off a disc still takes it; far off takes nothing", () => {
  assert.equal(hit(100 + 11 + PIN_HIT_SLACK_PX - 1, 100), "4");
  assert.equal(hit(200, 200), null);
});

test("a pin with no box (not on the map) is never the answer", () => {
  assert.equal(nearestUnder([four, { name: "x", box: { left: 0, top: 0, width: 0, height: 0 } }], (p) => p.box, 1, 1), null);
});
