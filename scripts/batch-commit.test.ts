import test from "node:test";
import assert from "node:assert/strict";
import { editNotice, stepBatch } from "../lib/map/batch-commit";

/**
 * An edit batch that does not land must never leave its stops as pins off
 * the line with nothing to undo (2026-09-25, found twice at 375 x 812).
 *
 * `npx tsx --test scripts/batch-commit.test.ts`
 */

test("✓ sends the batch once, and the batch stays until the line lands", () => {
  const first = stepBatch({ committing: false }, { type: "confirm", busy: false });
  assert.equal(first.send, true);
  assert.equal(first.clearBatch, false, "still pending while it is routed");
  assert.equal(first.state.committing, true);
  const again = stepBatch(first.state, { type: "confirm", busy: false });
  assert.equal(again.send, false, "a second ✓ while routing sends nothing");
  const landed = stepBatch(first.state, { type: "landed" });
  assert.equal(landed.clearBatch, true);
  assert.equal(landed.state.committing, false);
});

test("a refused batch stays pending, to be confirmed again or dropped", () => {
  const sent = stepBatch({ committing: false }, { type: "confirm", busy: false });
  const refused = stepBatch(sent.state, { type: "refused" });
  assert.equal(refused.clearBatch, false);
  assert.equal(refused.state.committing, false);
  assert.equal(stepBatch(refused.state, { type: "confirm", busy: false }).send, true, "and ✓ works again");
});

test("✓ while another change is being routed is not taken — it used to be dropped silently", () => {
  const busy = stepBatch({ committing: false }, { type: "confirm", busy: true });
  assert.equal(busy.send, false);
  assert.equal(busy.clearBatch, false, "the stops stay pending");
  assert.equal(busy.state.committing, false);
});

test("the edit map says what is happening: routing first, then the verdict, else its own notice", () => {
  const cap = { text: "Maks. 10 pieturas", title: "…" };
  assert.equal(editNotice({ rerouting: true, note: "old", routingText: "Pārrēķinu posmu…", base: cap })?.text, "Pārrēķinu posmu…");
  assert.equal(editNotice({ rerouting: false, note: "Šeit neizdevās izbraukt", routingText: "x", base: cap })?.text, "Šeit neizdevās izbraukt");
  assert.equal(editNotice({ rerouting: false, note: null, routingText: "x", base: cap }), cap);
  assert.equal(editNotice({ rerouting: false, note: null, routingText: "x", base: null }), null);
});
