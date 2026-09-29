import test from "node:test";
import assert from "node:assert/strict";
import { ADD_KIND_KEY, IDLE, armedRunning, kindSwitch, readAddKind, stepAdd, writeAddKind, type AddSession } from "../lib/map/add-kind";

/**
 * „+” asks what to add (rider, 2026-09-29), remembers the last choice, and
 * the point sheet's one „Pietura | Caurbraucams” control.
 *
 * `npx tsx --test scripts/add-kind.test.ts`
 */

test("idle → choose → armed → pending → committed", () => {
  let s: AddSession = IDLE;
  s = stepAdd(s, { type: "plus", remembered: null }).session;
  assert.deepEqual(s, { phase: "choose", preselected: "stop" });
  const chose = stepAdd(s, { type: "choose", kind: "pass" });
  assert.equal(chose.remember, "pass");
  s = chose.session;
  assert.deepEqual(s, { phase: "armed", kind: "pass", count: 0 });
  // ✓ with nothing pending does not end it.
  assert.equal(stepAdd(s, { type: "confirm" }).session, s);
  s = stepAdd(s, { type: "mark" }).session;
  s = stepAdd(s, { type: "mark" }).session;
  assert.deepEqual(s, { phase: "armed", kind: "pass", count: 2 });
  s = stepAdd(s, { type: "unmark" }).session;
  assert.equal(s.phase === "armed" && s.count, 1);
  const done = stepAdd(s, { type: "confirm" });
  assert.deepEqual(done.session, IDLE);
  assert.equal(done.outcome, "committed");
});

test("cancelled from armed or pending; dismissed from the chooser", () => {
  const choose = stepAdd(IDLE, { type: "plus", remembered: "pass" }).session;
  assert.deepEqual(choose, { phase: "choose", preselected: "pass" });
  assert.deepEqual(stepAdd(choose, { type: "dismiss" }).session, IDLE);
  assert.deepEqual(stepAdd(choose, { type: "cancel" }).session, IDLE);
  const armed = stepAdd(choose, { type: "choose", kind: "stop" }).session;
  const c = stepAdd(armed, { type: "cancel" });
  assert.deepEqual(c.session, IDLE);
  assert.equal(c.outcome, "cancelled");
  const pending = stepAdd(armed, { type: "mark" }).session;
  assert.equal(stepAdd(pending, { type: "cancel" }).outcome, "cancelled");
  // Dismiss is the chooser's only.
  assert.equal(stepAdd(pending, { type: "dismiss" }).session, pending);
});

test("„+” is not asked again while an armed session runs", () => {
  const armed: AddSession = { phase: "armed", kind: "pass", count: 1 };
  assert.ok(armedRunning(armed));
  assert.equal(stepAdd(armed, { type: "plus", remembered: "stop" }).session, armed);
  const choose: AddSession = { phase: "choose", preselected: "stop" };
  assert.equal(stepAdd(choose, { type: "plus", remembered: "pass" }).session, choose);
  assert.ok(!armedRunning(IDLE));
  // Marks outside a session change nothing.
  assert.equal(stepAdd(IDLE, { type: "mark" }).session, IDLE);
  assert.equal(stepAdd(IDLE, { type: "choose", kind: "pass" }).session, IDLE);
});

test("the remembered preference, and storage that throws", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(readAddKind(() => store), null);
  writeAddKind(() => store, "pass");
  assert.equal(map.get(ADD_KIND_KEY), "pass");
  assert.equal(readAddKind(() => store), "pass");
  map.set(ADD_KIND_KEY, "junk");
  assert.equal(readAddKind(() => store), null);
  // The accessor throws (Safari private mode, blocked site data).
  const throwing = () => { throw new Error("SecurityError"); };
  assert.equal(readAddKind(throwing), null);
  assert.doesNotThrow(() => writeAddKind(throwing, "stop"));
  // getItem / setItem throw.
  const bad = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("QuotaExceeded"); } };
  assert.equal(readAddKind(() => bad), null);
  assert.doesNotThrow(() => writeAddKind(() => bad, "pass"));
  assert.equal(readAddKind(() => null), null);
  // A throwing store still gives the default chip.
  assert.deepEqual(stepAdd(IDLE, { type: "plus", remembered: readAddKind(throwing) }).session, { phase: "choose", preselected: "stop" });
});

test("the segmented switch: the current kind, the other one, and why not", () => {
  const base = { passCount: 2, maxPass: 20, stopCount: 3, maxStops: 10 };
  assert.deepEqual(kindSwitch({ ...base, object: "stop" }), { current: "stop", to: "pass", enabled: true, reason: null });
  assert.deepEqual(kindSwitch({ ...base, object: "pass" }), { current: "pass", to: "stop", enabled: true, reason: null });
  assert.equal(kindSwitch({ ...base, object: "start" }).reason, "end");
  assert.equal(kindSwitch({ ...base, object: "finish" }).enabled, false);
  assert.equal(kindSwitch({ ...base, object: "stop", passCount: 20 }).reason, "shapeCap");
  // The pass-through cap does not stop a dot becoming a stop.
  assert.equal(kindSwitch({ ...base, object: "pass", passCount: 20 }).enabled, true);
  assert.equal(kindSwitch({ ...base, object: "pass", stopCount: 10 }).reason, "stopCap");
  assert.equal(kindSwitch({ ...base, object: "pass", atRowCap: true }).reason, "stopCap");
  assert.equal(kindSwitch({ ...base, object: "stop", stopCount: 10 }).enabled, true);
  assert.equal(kindSwitch({ ...base, object: "stop", busy: true }).reason, "busy");
  // The ends say „end” before anything else.
  assert.equal(kindSwitch({ ...base, object: "start", busy: true }).reason, "end");
});

test("the chooser's copy: what is happening – what to do, in every locale", async () => {
  const { addChooserCopy, addArmedGuide, kindSwitchReason } = await import("../lib/map/edit-guidance");
  const { t } = await import("../lib/i18n/messages");
  const lv = (k: Parameters<typeof t>[1]) => t("lv", k);
  const c = addChooserCopy(lv);
  assert.equal(c.guide, "Ko pievienot? – izvēlies veidu, tad pieskaries kartei.");
  assert.deepEqual(c.options.map((o) => [o.label, o.detail]), [["Pietura", "Mopik atradīs ceļu līdz tai"], ["Caurbraucams punkts", "Tikai virza līniju, bez numura"]]);
  assert.match(addArmedGuide(lv, "pass"), /^Pievieno caurbraucamu punktu – /);
  for (const loc of ["lv", "lt", "et", "en"] as const) {
    const tl = (k: Parameters<typeof t>[1]) => t(loc, k);
    const g = addChooserCopy(tl).guide;
    assert.ok(g.includes(" – "), `${loc}: en dash`);
    assert.ok(!/piesit/i.test(g + addArmedGuide(tl, "stop") + addArmedGuide(tl, "pass")));
    assert.ok(kindSwitchReason(tl, "end", { shapeCap: "", stopCap: "" })!.length > 10);
  }
  assert.equal(kindSwitchReason(lv, null, { shapeCap: "a", stopCap: "b" }), null);
});
