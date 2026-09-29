import test from "node:test";
import assert from "node:assert/strict";
import { pendingChains, type LinkPoint } from "../lib/map/plan-line";

/**
 * Release B item 3 (images/27): while points are pending in edit mode, thin
 * grey dashed straight lines prev → new → next, for each affected leg only.
 *
 *   npx tsx --test scripts/pending-links.test.ts
 */

const P = (lon: number, id?: number): LinkPoint => ({ lat: 57, lon, ...(id !== undefined ? { id } : {}) });
const names = (chains: LinkPoint[][]) => chains.map((c) => c.map((p) => (p.id !== undefined ? `n${p.id}` : String(p.lon))).join(" → "));

test("one new stop: its leg only — the place before, the new point, the place after", () => {
  const rows = [P(0), P(10), P(15, -1), P(20), P(30)];
  assert.deepEqual(names(pendingChains({ rows, pending: [false, false, true, false, false], roundTrip: false })), ["10 → n-1 → 20"]);
});

test("a batch: one chain per leg, its pending points in riding order; untouched legs get none", () => {
  const rows = [P(0), P(3, 1), P(6, 2), P(10), P(20), P(25, 3), P(30)];
  const pending = [false, true, true, false, false, true, false];
  assert.deepEqual(names(pendingChains({ rows, pending, roundTrip: false })), ["0 → n1 → n2 → 10", "20 → n3 → 30"]);
});

test("a new finish past a one-way ride's end: the old finish → the new one", () => {
  const rows = [P(0), P(10), P(30), P(35, 4)];
  assert.deepEqual(names(pendingChains({ rows, pending: [false, false, false, true], roundTrip: false })), ["30 → n4"]);
});

test("a round trip: the last leg leads back to the start", () => {
  const rows = [P(0), P(10), P(20, 5)];
  assert.deepEqual(names(pendingChains({ rows, pending: [false, false, true], roundTrip: true })), ["10 → n5 → 0"]);
});

test("empty rows are skipped, and nothing pending draws nothing", () => {
  const rows = [P(0), null, P(10), P(12, 6), null, P(20)];
  assert.deepEqual(names(pendingChains({ rows, pending: [false, false, false, true, false, false], roundTrip: false })), ["10 → n6 → 20"]);
  assert.deepEqual(pendingChains({ rows: [P(0), P(10)], pending: [false, false], roundTrip: false }), []);
});

test("the map, the composer and the page speak one connector: no blue grab line, no second colour", async () => {
  const { readFileSync } = await import("node:fs");
  const map = readFileSync(new URL("../components/route-map.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(map, /addSource\("grab-line"/, "the grab's own blue connector is gone");
  assert.match(map, /PENDING_LINK_COLOR = "#57534e"/);
  const layer = map.slice(map.indexOf('id: "move-preview"'), map.indexOf('id: "move-preview"') + 400);
  assert.match(layer, /"line-color": PENDING_LINK_COLOR/);
  assert.doesNotMatch(map, /id: "move-preview-edge"/, "no white edge: a drawn straight stretch has the white dash, this does not");
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  assert.match(composer, /pendingChains\(/);
  // Gone once the proposal has landed: the proposed line says it then.
  assert.match(composer, /const movePreview = !edit \|\| proposalLanded \? null/);
});
