import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as addKind from "../lib/map/add-kind";
import { IDLE, batchOps, kindSwitch, offerAllowed, stateHasExit, stepAdd, stepOffer, stepPassBatch, type AddSession, type PassItem } from "../lib/map/add-kind";

/**
 * „+” adds pass-through points, no chooser (rider, 2026-09-30); several in a
 * row, one routing, one ✓, one ↶ (backlog 53); a tap on the empty map offers
 * „Pievienot punktu šeit”; the point sheet's one „Pietura | Caurbraucams”.
 *
 * `npx tsx --test scripts/add-kind.test.ts`
 */

test("idle → armed → pending → committed", () => {
  let s: AddSession = IDLE;
  s = stepAdd(s, { type: "plus" }).session;
  assert.deepEqual(s, { phase: "armed", count: 0 });
  // ✓ with nothing pending does not end it.
  assert.equal(stepAdd(s, { type: "confirm" }).session, s);
  s = stepAdd(s, { type: "mark" }).session;
  s = stepAdd(s, { type: "mark" }).session;
  s = stepAdd(s, { type: "mark" }).session;
  assert.deepEqual(s, { phase: "armed", count: 3 });
  s = stepAdd(s, { type: "unmark" }).session;
  assert.equal(s.phase === "armed" && s.count, 2);
  const done = stepAdd(s, { type: "confirm" });
  assert.deepEqual(done.session, IDLE);
  assert.equal(done.outcome, "committed");
});

test("cancelled from armed or pending; „+” again is the same session", () => {
  const armed = stepAdd(IDLE, { type: "plus" }).session;
  assert.equal(stepAdd(armed, { type: "plus" }).session, armed);
  const c = stepAdd(armed, { type: "cancel" });
  assert.deepEqual(c.session, IDLE);
  assert.equal(c.outcome, "cancelled");
  const pending = stepAdd(armed, { type: "mark" }).session;
  assert.equal(stepAdd(pending, { type: "cancel" }).outcome, "cancelled");
  // Marks outside a session change nothing.
  assert.equal(stepAdd(IDLE, { type: "mark" }).session, IDLE);
  assert.equal(stepAdd(IDLE, { type: "cancel" }).session, IDLE);
});

const item = (id: number): PassItem => ({ id, lat: 57 + id / 100, lon: 24 + id / 100, at: { lat: 57 + id / 100, lon: 24.001 + id / 100 } });

test("the batch: many taps add many, a tap while routing adds and never moves, ↶ pops the last, ✕ discards", () => {
  let b: PassItem[] = [];
  for (let i = 1; i <= 3; i++) b = stepPassBatch(b, { type: "add", item: item(i), max: 20 });
  assert.deepEqual(b.map((x) => x.id), [1, 2, 3]);
  // „While routing” is not a state the batch knows: the tap is an add, the points before it stay where they were.
  const before = b.map((x) => [x.lat, x.lon]);
  b = stepPassBatch(b, { type: "add", item: item(4), max: 20 });
  assert.equal(b.length, 4);
  assert.deepEqual(b.slice(0, 3).map((x) => [x.lat, x.lon]), before);
  b = stepPassBatch(b, { type: "pop" });
  assert.deepEqual(b.map((x) => x.id), [1, 2, 3]);
  // Moving is its own event (a drag), never a tap.
  b = stepPassBatch(b, { type: "move", id: 2, lat: 1, lon: 2, at: { lat: 1, lon: 2.001 } });
  assert.deepEqual([b[1].lat, b[1].lon], [1, 2]);
  assert.equal(b.length, 3);
  assert.deepEqual(stepPassBatch(b, { type: "drop", id: 2 }).map((x) => x.id), [1, 3]);
  assert.deepEqual(stepPassBatch(b, { type: "discard" }), []);
  // The cap: no more than the ride can take.
  assert.equal(stepPassBatch(b, { type: "add", item: item(9), max: 3 }).length, 3);
});

test("the batch is one proposal: the first add and the rest", () => {
  assert.equal(batchOps([]), null);
  const ops = batchOps([item(1), item(2), item(3)])!;
  assert.equal(ops.op.kind, "add");
  assert.deepEqual(ops.op.grabbedAt, [item(1).at.lon, item(1).at.lat]);
  assert.equal(ops.more.length, 2);
  assert.deepEqual(batchOps([item(1)])!.more, []);
});

test("the empty-map offer: edit mode only, the map otherwise idle; a tap elsewhere dismisses", () => {
  const idle = { editing: true, armed: false, pending: false, selection: false, rowActive: false, busy: false, atShapeCap: false };
  assert.ok(offerAllowed(idle));
  for (const k of ["armed", "pending", "selection", "rowActive", "busy", "atShapeCap"] as const) assert.ok(!offerAllowed({ ...idle, [k]: true }), k);
  assert.ok(!offerAllowed({ ...idle, editing: false }), "not on a result or shared map");
  let o = stepOffer(null, { type: "emptyTap", lat: 57, lon: 24, allowed: true }).offer;
  assert.deepEqual(o, { lat: 57, lon: 24 });
  // Tapping elsewhere dismisses — it does not jump.
  assert.equal(stepOffer(o, { type: "emptyTap", lat: 58, lon: 25, allowed: true }).offer, null);
  assert.equal(stepOffer(o, { type: "dismiss" }).offer, null);
  const acc = stepOffer(o, { type: "accept" });
  assert.equal(acc.offer, null);
  assert.deepEqual(acc.add, { lat: 57, lon: 24 });
  assert.equal(stepOffer(null, { type: "emptyTap", lat: 57, lon: 24, allowed: false }).offer, null);
  o = null;
  assert.equal(stepOffer(o, { type: "accept" }).add, undefined);
});

test("the chooser and the remembered preference are gone", () => {
  const exported = Object.keys(addKind);
  for (const gone of ["readAddKind", "writeAddKind", "ADD_KIND_KEY", "browserStorage", "armedRunning"]) assert.ok(!exported.includes(gone), gone);
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  const map = readFileSync(new URL("../components/route-map.tsx", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../lib/i18n/messages.ts", import.meta.url), "utf8");
  for (const src of [composer, map, messages]) {
    assert.ok(!/addChooser|mopik\.addKind|addChooseWhat|data-add-chooser/.test(src));
  }
});

test("the segmented switch: the current kind, the other one, and why not", () => {
  const base = { passCount: 2, maxPass: 20, stopCount: 3, maxStops: 10 };
  assert.deepEqual(kindSwitch({ ...base, object: "stop" }), { current: "stop", to: "pass", enabled: true, reason: null });
  assert.deepEqual(kindSwitch({ ...base, object: "pass" }), { current: "pass", to: "stop", enabled: true, reason: null });
  assert.equal(kindSwitch({ ...base, object: "start" }).reason, "end");
  assert.equal(kindSwitch({ ...base, object: "finish" }).enabled, false);
  assert.equal(kindSwitch({ ...base, object: "stop", passCount: 20 }).reason, "shapeCap");
  assert.equal(kindSwitch({ ...base, object: "pass", passCount: 20 }).enabled, true);
  assert.equal(kindSwitch({ ...base, object: "pass", stopCount: 10 }).reason, "stopCap");
  assert.equal(kindSwitch({ ...base, object: "pass", atRowCap: true }).reason, "stopCap");
  assert.equal(kindSwitch({ ...base, object: "stop", stopCount: 10 }).enabled, true);
  assert.equal(kindSwitch({ ...base, object: "stop", busy: true }).reason, "busy");
  assert.equal(kindSwitch({ ...base, object: "start", busy: true }).reason, "end");
});

test("the copy: what is happening – what to do, in every locale", async () => {
  const { addPassGuide, passBatchLine, offerCopy, rowWaitingGuide, kindSwitchReason } = await import("../lib/map/edit-guidance");
  const { t } = await import("../lib/i18n/messages");
  const lv = (k: Parameters<typeof t>[1]) => t("lv", k);
  assert.equal(addPassGuide(lv), "Pieskaries kartei, lai pievienotu caurbraucamu punktu – ✓ apstiprina visus, ✕ atmet.");
  assert.equal(passBatchLine(lv, 3), "3 caurbraucami punkti – ✓ apstiprina visus, ↶ noņem pēdējo, ✕ atmet.");
  assert.equal(passBatchLine(lv, 1), "1 caurbraucams punkts – ✓ apstiprina visus, ↶ noņem pēdējo, ✕ atmet.");
  assert.equal(passBatchLine(lv, 21), "21 caurbraucams punkts – ✓ apstiprina visus, ↶ noņem pēdējo, ✕ atmet.");
  assert.equal(offerCopy(lv).label, "Pievienot punktu šeit");
  assert.equal(rowWaitingGuide(lv), "Meklē vietu vai pieskaries kartei – ✕ atceļ.");
  for (const loc of ["lv", "lt", "et", "en"] as const) {
    const tl = (k: Parameters<typeof t>[1]) => t(loc, k);
    for (const g of [addPassGuide(tl), passBatchLine(tl, 2), offerCopy(tl).guide, rowWaitingGuide(tl)]) {
      assert.ok(g.includes(" – "), `${loc}: en dash in ${g}`);
      assert.ok(!/ - /.test(g), `${loc}: no hyphen as a dash`);
      assert.ok(!/piesit/i.test(g));
    }
    assert.ok(kindSwitchReason(tl, "end", { shapeCap: "", stopCap: "" })!.length > 10);
  }
  assert.equal(kindSwitchReason(lv, null, { shapeCap: "a", stopCap: "b" }), null);
});

test("guard: every add/edit state that is not idle has ✕ on and a guidance line", () => {
  // The rider's stuck state (images/46.png): an empty stop row waiting, ✕ grey, no words.
  assert.ok(!stateHasExit({ idle: false, cancelEnabled: false, guide: null }));
  assert.ok(!stateHasExit({ idle: false, cancelEnabled: true, guide: "" }));
  assert.ok(!stateHasExit({ idle: false, cancelEnabled: false, guide: "x – y" }));
  assert.ok(stateHasExit({ idle: false, cancelEnabled: true, guide: "x – y" }));
  assert.ok(stateHasExit({ idle: true, cancelEnabled: false, guide: null }));
});
