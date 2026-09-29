import test from "node:test";
import assert from "node:assert/strict";
import { blockCause, blockingFrom, fixesFor, singleCause, type Blocking } from "../lib/map/blocking";
import { blockedGuide, blockedLine, fixWords, pointLabel } from "../lib/map/edit-guidance";
import { messages } from "../lib/i18n/messages";
import type { MessageKey } from "../lib/i18n/messages";

/**
 * Release B item 1 (rider 2026-09-28, images/25–27, 31): a refused or
 * warned proposal with several points names WHICH point stops it and what
 * to do — never the generic „neizdevās izbraukt” alone.
 *
 *   npx tsx --test scripts/blocking.test.ts
 */

const lv = (k: MessageKey) => messages("lv")[k];
const fmt = (n: number) => new Intl.NumberFormat("lv", { maximumFractionDigits: 1 }).format(n);
const at = { lat: 56.96, lon: 24.7 };

test("a point's probe becomes its verdict: far, then his profile, then failed, then detour; fine is none", () => {
  assert.deepEqual(blockCause({ tooFar: 588.4 }), { cause: "far", meters: 588 });
  assert.deepEqual(blockCause({ routed: "no-road" }), { cause: "profile" });
  assert.deepEqual(blockCause({ routed: "failed" }), { cause: "failed" });
  assert.deepEqual(blockCause({ routed: "ok", detourPlus: 15_240 }), { cause: "detour", meters: 15_240 });
  assert.equal(blockCause({ routed: "ok", detourPlus: null }), null);
  assert.equal(blockCause({}), null, "a probe that said nothing accuses nothing");
});

test("one point: the refusal's own reason is that point's", () => {
  assert.deepEqual(singleCause("no-road", 612.2), { cause: "far", meters: 612 });
  assert.deepEqual(singleCause("", null, "profile"), { cause: "profile" });
  assert.deepEqual(singleCause("", null, "detour", 9_800), { cause: "detour", meters: 9_800 });
  // The generic failures (a status, the network, a broken line) are still named — as „could not be joined”.
  assert.deepEqual(singleCause("502", null), { cause: "failed" });
  assert.deepEqual(singleCause("network", null), { cause: "failed" });
});

test("the spec's line: „Pietura 4 „Rīgas iela” – tuvākais ceļš ~N m nostāk – pārvieto, izņem vai „Vest pa taisno”.”", () => {
  const b: Blocking = { token: 1, probing: false, refused: true, total: 1, points: [{ ...at, title: "Pietura 4", name: "Rīgas iela", cause: "far", meters: 120 }] };
  assert.equal(blockedLine(lv, b, false, fmt), "Pietura 4 „Rīgas iela” – tuvākais ceļš ~120 m nostāk – pieskaries citur kartē, izņem vai „Vest pa taisno”.");
});

test("a batch with one bad point: named, and „Pievienot pārējās” offered for the rest", () => {
  const b: Blocking = { token: 2, probing: false, refused: true, total: 3, points: [{ ...at, title: "Pietura 2", name: "Kangari", cause: "far", meters: 588 }] };
  assert.deepEqual(fixesFor(b, false), { straight: true, override: false, rest: 2 });
  assert.equal(blockedLine(lv, b, false, fmt), "Pietura 2 „Kangari” – tuvākais ceļš ~588 m nostāk – pārvieto, izņem, „Vest pa taisno” vai „Pievienot pārējās”.");
});

test("profile or detour: „Tomēr braukt” is the fix on a warned proposal, never on a refused one", () => {
  const detour: Blocking = { token: 3, probing: false, refused: false, total: 3, points: [{ ...at, title: "Pietura 3", name: "Augšciems", cause: "detour", meters: 15_240 }] };
  assert.equal(blockedLine(lv, detour, true, fmt), "Pietura 3 „Augšciems” – tā pagarina braucienu par 15,2 km – pārvieto, izņem, „Tomēr braukt” vai „Pievienot pārējās”.");
  const profile: Blocking = { ...detour, points: [{ ...detour.points[0], cause: "profile" }] };
  assert.equal(fixesFor(profile, true).override, true);
  assert.equal(fixesFor(profile, false).override, false);
  assert.equal(fixesFor(profile, true).straight, false, "„Vest pa taisno” only when no road reaches it");
});

test("never the generic „neizdevās” without a point or a fix — probing says it is looking; together says what to do", () => {
  const probing: Blocking = { token: 4, probing: true, refused: true, total: 7, points: [] };
  const g = blockedGuide(lv, probing, false, fmt);
  assert.equal(g.what, "Meklēju, kurš punkts traucē");
  const together: Blocking = { ...probing, probing: false };
  assert.equal(blockedLine(lv, together, false, fmt), "Katru no 7 punktiem var pievienot atsevišķi, bet kopā tos neizdevās savienot – izņem kādu vai pievieno tos pa vienam.");
  const failed: Blocking = { token: 5, probing: false, refused: true, total: 1, points: [{ ...at, title: "Pietura 1", name: "56.9490, 24.4509", cause: "failed" }] };
  const line = blockedLine(lv, failed, false, fmt);
  assert.equal(line, "Pietura 1 – to neizdevās savienot ar maršrutu – pieskaries citur kartē vai izņem.", "a coordinate name is not said twice");
  assert.doesNotMatch(line, /Šeit neizdevās izbraukt/);
});

test("two bad points are both named", () => {
  const b: Blocking = { token: 6, probing: false, refused: true, total: 4, points: [
    { ...at, title: "Pietura 1", name: "A", cause: "far", meters: 500 },
    { ...at, title: "Caurbraucams punkts", name: "", cause: "failed" },
  ] };
  assert.equal(blockedLine(lv, b, false, fmt), "Pietura 1 „A” – tuvākais ceļš ~500 m nostāk; Caurbraucams punkts – to neizdevās savienot ar maršrutu – pārvieto, izņem, „Vest pa taisno” vai „Pievienot pārējās”.");
  assert.equal(pointLabel({ title: "Finišs", name: "Finišs" }), "Finišs");
});

test("four languages, en dashes, no „piesit”", () => {
  const keys: MessageKey[] = ["blockFar", "blockProfile", "blockDetour", "blockFailed", "blockTogether", "blockTogetherAct", "blockProbing", "blockProbingAct", "blockActMove", "blockActRemove", "blockActStraight", "blockActOverride", "blockActRest", "blockOr", "blockChipLabel", "blockChipMove", "blockChipRemove", "blockChipRest", "blockMoveHint"];
  for (const l of ["lv", "lt", "et", "en"] as const) {
    for (const k of keys) {
      assert.ok(messages(l)[k].trim(), `${l}.${k}`);
      assert.doesNotMatch(messages(l)[k], /—/, `${l}.${k}: en dash, not em dash`);
    }
    const b: Blocking = { token: 1, probing: false, refused: true, total: 2, points: [{ ...at, title: "X", name: "", cause: "far", meters: 100 }] };
    assert.match(blockedLine((k) => messages(l)[k], b, false, fmt), / – /);
    assert.ok(fixWords((k) => messages(l)[k], { straight: true, override: true, rest: 1 }).endsWith("."));
  }
  for (const k of keys) assert.doesNotMatch(messages("lv")[k], /piesit/i);
});

test("a batch's verdicts: the points with a cause; a warned detour none explains alone is the one that adds most", () => {
  const pts = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(blockingFrom(pts, [{ routed: "ok", plusMeters: 2_000 }, { tooFar: 605 }, { routed: "ok", plusMeters: 4_000 }]), [{ id: "b", cause: "far", meters: 605 }]);
  // Refused, and each fine alone: nobody is accused (the line says they fail together).
  assert.deepEqual(blockingFrom(pts, [{ routed: "ok" }, { routed: "ok" }, {}]), []);
  // Warned for the detour, each alone within the bound: the biggest share is named.
  assert.deepEqual(blockingFrom(pts, [{ routed: "ok", plusMeters: 2_000 }, { routed: "ok", plusMeters: 8_100 }, { routed: "ok", plusMeters: 4_000 }], "detour"), [{ id: "b", cause: "detour", meters: 8_100 }]);
  // Warned for the profile: nothing to guess from lengths.
  assert.deepEqual(blockingFrom(pts, [{ routed: "ok", plusMeters: 2_000 }, {}, {}], "profile"), []);
});

test("the page: every refusal and every warned landing goes through the naming; the chips act per point", async () => {
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
  const body = (name: string) => page.slice(page.indexOf(name), page.indexOf("\n  }\n", page.indexOf(name)));
  assert.match(body("function refuseProposal("), /const named = reason === "timeout" \? joinGuide\(note, ui\.guideRefusedRetry\) : noteBlocking\(token, \{ reason, meters \}\);[\s\S]*setEditNote\(named \?\? note\)/);
  assert.match(body("function askStraight("), /noteBlocking\(token, \{ reason: "no-road", meters, straight: true \}\)/);
  assert.match(body("function askWide("), /noteBlocking\(token, \{ reason: "wide" \}\)/);
  assert.match(page, /if \(proposal\.accept === "profile" \|\| proposal\.accept === "detour"\) noteBlocking\(token, \{ accept: proposal\.accept, plus: riskPlus \}\);/);
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  assert.match(composer, /if \(act\.block === "rest"\) h\?\.dropBatchItems\(blockedItems\.map\(\(b\) => b\.id\)\);/);
  assert.match(composer, /\.\.\.\(blockedItems\.some\(\(x\) => x\.id === b\.id\) \? \{ blocked: true \} : \{\}\),/);
  const map = readFileSync(new URL("../components/route-map.tsx", import.meta.url), "utf8");
  assert.match(map, /else if \(b\.blocked\) el\.style\.boxShadow = blockedRing\(b\.finish \? FINISH_PIN_COLOR : STOP_RING_COLOR\);/);
});
