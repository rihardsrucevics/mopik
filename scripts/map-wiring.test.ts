import test from "node:test";
import assert from "node:assert/strict";
import { mapWiring } from "../lib/map/map-wiring";

/**
 * Which planning-map controls are live in which view.
 *
 * `npx tsx --test scripts/map-wiring.test.ts`
 *
 * The rider's report: on a generated ride, a tap on the map dropped a violet
 * pin that did nothing. The composer's "a row is waiting" flag outlived the
 * composer, and the page wired the pick flow on the flag alone. The first test
 * is that exact state — the flag still up, a ride on screen.
 */

test("the result map never picks, even with the composer's flag left up", () => {
  const w = mapWiring({ entryMode: "chat", hasResult: true, rowActive: true });
  assert.equal(w.pick, false);
  assert.equal(w.header, false);
  assert.equal(w.planning, false);
});

test("the form reopened over a result does not pick either", () => {
  // Its map draws the generated ride, not the form's rows, so a place
  // confirmed there would never be drawn as the pin it became.
  const w = mapWiring({ entryMode: "form", hasResult: true, rowActive: true });
  assert.equal(w.pick, false);
  assert.equal(w.header, false);
});

test("the chat before any result does not pick", () => {
  // While a ride is being generated the composer is gone; nothing on screen
  // would answer a marked point.
  assert.equal(mapWiring({ entryMode: "chat", hasResult: false, rowActive: true }).pick, false);
});

test("planning with an active row picks and shows the header", () => {
  assert.deepEqual(mapWiring({ entryMode: "form", hasResult: false, rowActive: true }), {
    planning: true, pick: true, header: true,
  });
});

test("planning with the map closed shows the header but does not pick", () => {
  // No active row means no row for a tap to go to. The header is harmless
  // here — the map that would draw it is not on screen — and is keyed on the
  // view so it and the pick flow cannot disagree while the map is open.
  assert.deepEqual(mapWiring({ entryMode: "form", hasResult: false, rowActive: false }), {
    planning: true, pick: false, header: true,
  });
});
