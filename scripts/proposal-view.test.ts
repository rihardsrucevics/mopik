import test from "node:test";
import assert from "node:assert/strict";
import { formatEditDelta, IDLE_PROPOSAL, type EditProposal, type ProposalState } from "../lib/map/edit-proposal";
import { changeKey, changedAlong, isKindSwitch, NOTE_JOINER, proposalView, proposeDelay, staleWhileRouting, unchangedEnds } from "../lib/map/proposal-view";
import { cumulative } from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";
import { messages } from "../lib/i18n/messages";
import type { EditedRide, RidePlaces } from "../lib/routing/reroute-leg";

/**
 * The page's half of preview-before-commit (P1-B): what the map is handed
 * for each phase, where the new line is, and when ✓ is the same change.
 *
 * `npx tsx --test scripts/proposal-view.test.ts`
 */

const ui = messages("lv");
const copy = { routing: ui.previewRouting, delta: ui.previewDelta, deltaTitle: ui.previewDeltaTitle };
const segments = { type: "FeatureCollection" as const, features: [] };
const place = { name: "Cēsis", label: "Cēsis", lat: 57.31, lon: 25.27 };
const before: RidePlaces = { start: place, vias: [], finish: null, roundTrip: true } as unknown as RidePlaces;

function proposal(notes: string[]): EditProposal {
  return {
    token: 3,
    how: "move-stop",
    before,
    ride: { segments, coordinates: [], distanceMeters: 75_100, durationSeconds: 3600, overlap: { repeatedPercent: 1 }, places: before, kind: "edit", how: "move-stop" } as unknown as EditedRide,
    changed: [[100, 900]],
    delta: { kmBefore: 72.4, kmAfter: 75.1, secondsDelta: 360, repeatedBefore: 4, repeatedAfter: 1 },
    notes,
  };
}

test("idle shows nothing", () => {
  assert.equal(proposalView(IDLE_PROPOSAL, copy, "lv"), null);
});

test("routing says „Pārrēķinu…” and draws no line", () => {
  const view = proposalView({ phase: "routing", token: 1, how: "move-stop", confirmWhenReady: false }, copy, "lv");
  assert.deepEqual(view, { text: "Pārrēķinu…", title: "Pārrēķinu…", tone: "routing", line: null, changed: [] });
});

test("refused says the reason and draws no line", () => {
  const view = proposalView({ phase: "refused", token: 1, how: "add-stop", reason: "Neizdevās." }, copy, "lv");
  assert.equal(view?.tone, "refused");
  assert.equal(view?.text, "Neizdevās.");
  assert.equal(view?.line, null);
});

test("landed: the chip, the new line and where it is new — no tone", () => {
  const state: ProposalState = { phase: "proposed", proposal: proposal([]), confirmNow: false };
  const view = proposalView(state, copy, "lv");
  assert.ok(view);
  assert.equal(view.tone, undefined);
  assert.equal(view.text, formatEditDelta(ui.previewDelta, state.proposal.delta, "lv"));
  assert.equal(view.text, "72,4 → 75,1 km · +6 min · atkārtoti 4 → 1 %");
  assert.equal(view.title, formatEditDelta(ui.previewDeltaTitle, state.proposal.delta, "lv"));
  assert.equal(view.line, segments);
  assert.deepEqual(view.changed, [[100, 900]]);
});

test("a proposal's notes are said with it and go with it", () => {
  const note = "Punkts pārvietots 40 m, lai tas būtu uz ceļa.";
  const withNote = proposalView({ phase: "proposed", proposal: proposal([note, ""]), confirmNow: false }, copy, "lv");
  // The notes are their own line under the numbers, not run on after them.
  assert.equal(withNote?.notes, note);
  assert.ok(!withNote?.text.includes(NOTE_JOINER));
  assert.ok(withNote?.title.endsWith(note));
  // The next state of the same mark — routing again, or ✕ — carries none of it.
  const again = proposalView({ phase: "routing", token: 4, how: "move-stop", confirmWhenReady: false }, copy, "lv");
  assert.ok(!again?.text.includes(note));
  assert.equal(proposalView(IDLE_PROPOSAL, copy, "lv"), null);
});

test("changedAlong: one stretch, kept line before it shifts nothing", () => {
  assert.deepEqual(changedAlong([{ fromMeters: 1000, toMeters: 2000 }], [1500]), [[1000, 2500]]);
});

test("changedAlong: two stretches, the second shifted by the first's growth; runs out of order", () => {
  const runs = [{ fromMeters: 5000, toMeters: 6000 }, { fromMeters: 1000, toMeters: 2000 }];
  // First (1000–2000) becomes 1500 m, second (5000–6000) becomes 500 m.
  assert.deepEqual(changedAlong(runs, [500, 1500]), [[1000, 2500], [5500, 6000]]);
});

test("changedAlong: a run from 0 (moved start)", () => {
  assert.deepEqual(changedAlong([{ fromMeters: 0, toMeters: 800 }], [300]), [[0, 300]]);
});

// A due-east road at 57° N, a vertex every 100 m.
const east = (fromM: number, toM: number, north = 0): Point[] => {
  const out: Point[] = [];
  for (let m = fromM; m <= toM + 1e-6; m += 100) out.push([24 + m / (111_320 * Math.cos((57 * Math.PI) / 180)), 57 + north / 110_540]);
  return out;
};

test("unchangedEnds: a 6 km window whose middle 600 m left the road is haloed on those 600 m only (rider, 2026-09-28)", () => {
  // Replaced: 0–6000 m of the road. Routed: the same road to 2700 m, a
  // detour 300 m north for 2700–3300 m, and the same road again to 6000 m.
  const replaced = east(0, 6000);
  const routed = [...east(0, 2700), ...east(2800, 3200, 300), ...east(3300, 6000)];
  const { head, tail } = unchangedEnds(routed, replaced);
  const total = cumulative(routed).at(-1)!;
  assert.ok(Math.abs(head - 2700) < 5, `head ${head}`);
  assert.ok(Math.abs(tail - 2700) < 5, `tail ${tail}`);
  const [[a, b]] = changedAlong([{ fromMeters: 10_000, toMeters: 16_000 }], [total], [{ head, tail }]);
  assert.ok(Math.abs(a - 12_700) < 5 && b - a < total - 5000, `halo ${a}–${b} of a ${Math.round(total)} m stretch`);
});

test("unchangedEnds: the same road ridden back the other way is new, and all-old road leaves no halo", () => {
  const replaced = east(0, 3000);
  // Out along the road to 1500 m and straight back to 0 — not the replaced direction after the turn.
  const uturn = [...east(0, 1500), ...east(0, 1400).reverse()];
  const { head } = unchangedEnds(uturn, replaced);
  assert.ok(head <= 1500 + 1, `head stops at the turn: ${head}`);
  const same = unchangedEnds(east(0, 3000), replaced);
  const [[a, b]] = changedAlong([{ fromMeters: 0, toMeters: 3000 }], [cumulative(east(0, 3000)).at(-1)!], [same]);
  assert.ok(b - a < 1, "nothing new, nothing haloed");
});

test("changeKey: the same rows are the same change, a moved row is not", () => {
  const a = { kind: "rows" as const, rows: { names: ["Cēsis", "Līgatne"], picked: { 0: place, 1: { ...place, name: "Līgatne", lat: 57.2 } } } };
  const sameOtherOrder = { kind: "rows" as const, rows: { names: ["Cēsis", "Līgatne"], picked: { 1: { ...place, name: "Līgatne", lat: 57.2, label: "x" }, 0: place } } };
  const moved = { kind: "rows" as const, rows: { names: ["Cēsis", "Līgatne"], picked: { 0: place, 1: { ...place, name: "Līgatne", lat: 57.21 } } } };
  assert.equal(changeKey(a), changeKey(sameOtherOrder));
  assert.notEqual(changeKey(a), changeKey(moved));
  const shape = { kind: "shape" as const, op: { kind: "move" as const, index: 0, lat: 57, lon: 25 } };
  assert.equal(changeKey(shape), changeKey({ kind: "shape", op: { kind: "move", index: 0, lat: 57, lon: 25 } }));
  assert.notEqual(changeKey(shape), changeKey({ kind: "shape", op: { kind: "move", index: 1, lat: 57, lon: 25 } }));
});

test("kind switches are never proposed", () => {
  assert.equal(isKindSwitch({ kind: "shape", op: { kind: "demote", stopIndex: 0 } }), true);
  assert.equal(isKindSwitch({ kind: "shape", op: { kind: "promote", index: 0, place } }), true);
  assert.equal(isKindSwitch({ kind: "shape", op: { kind: "remove", index: 0 } }), false);
});

test("proposeDelay: leading edge at once, a drag stream waits 250 ms", () => {
  assert.equal(proposeDelay(null, 1000), 0);
  assert.equal(proposeDelay(0, 1000), 0);
  assert.equal(proposeDelay(900, 1000), 250);
  assert.equal(proposeDelay(750, 1000), 0);
});

test("stale while it re-routes: the last landed proposal stays, with the spinner, until the next lands", () => {
  const landed = proposalView({ phase: "proposed", proposal: proposal(["Punkts pārvietots 40 m."]), confirmNow: false }, copy, "lv")!;
  const routing = proposalView({ phase: "routing", token: 4, how: "add-stops", confirmWhenReady: false }, copy, "lv")!;
  const shown = staleWhileRouting(landed, routing)!;
  assert.equal(shown.tone, "routing", "the spinner");
  assert.equal(shown.line, landed.line, "the line stays");
  assert.deepEqual(shown.changed, landed.changed, "and its halo");
  assert.equal(shown.text, landed.text, "and its numbers");
  assert.equal(shown.title, copy.routing, "said as routing");
  // The first proposal of all: nothing stale to show.
  assert.deepEqual(staleWhileRouting(null, routing), routing);
  // A refusal and no proposal are shown as they are — nothing stale survives ✕.
  const refused = proposalView({ phase: "refused", token: 4, how: "add-stops", reason: "Neizdevās." }, copy, "lv")!;
  assert.deepEqual(staleWhileRouting(landed, refused), refused);
  assert.equal(staleWhileRouting(landed, null), null);
  // The next landed replaces it.
  assert.equal(staleWhileRouting(landed, landed), landed);
});
