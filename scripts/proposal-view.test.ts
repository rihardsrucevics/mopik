import test from "node:test";
import assert from "node:assert/strict";
import { formatEditDelta, IDLE_PROPOSAL, type EditProposal, type ProposalState } from "../lib/map/edit-proposal";
import { changeKey, changedAlong, isKindSwitch, NOTE_JOINER, proposalView, proposeDelay, staleWhileRouting, newStretches, WIDE_ASK_M, WIDE_ASK_SHARE, wideNeedsAsking } from "../lib/map/proposal-view";
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

test("newStretches: a 6 km window whose middle 600 m left the road is haloed on those 600 m only (rider, 2026-09-28)", () => {
  // Ride: 0–10 km of the road. Routed over 2–8 km: the same road to 4700 m,
  // a detour 300 m north for 4700–5300 m, and the same road again to 8000 m.
  const ride = east(0, 10_000);
  const routed = [...east(2000, 4700), ...east(4800, 5200, 300), ...east(5300, 8000)];
  const parts = newStretches(routed, ride);
  assert.equal(parts.length, 1);
  const [[a, b]] = parts;
  assert.ok(Math.abs(a - 2700) < 5, `from ${a}`);
  const total = cumulative(routed).at(-1)!;
  assert.ok(Math.abs(total - b - 2700) < 5, `to ${b} of ${Math.round(total)}`);
  const [[x, y]] = changedAlong([{ fromMeters: 2000, toMeters: 8000 }], [total], [parts]);
  assert.ok(Math.abs(x - 4700) < 5 && Math.abs(y - (2000 + b)) < 1, `halo ${x}–${y}`);
});

test("newStretches: old road inside the stretch is not new — two detours, the road between them, and a way in past the cut (release check, 2026-09-28)", () => {
  // Measured on Sigulda → Līgatne → Cēsis: leaving the road, rejoining it
  // for 1,7 km and leaving again haloed the whole loop (3,9 km for +2 km);
  // a stop reached past the cut along the kept ride and back haloed 2,3 km
  // of old road. Only the pieces off the ride are new.
  const ride = east(0, 10_000);
  const routed = [
    ...east(2000, 3000),        // old road
    ...east(3100, 3400, 300),   // detour 1
    ...east(3500, 6000),        // old road again, 2,5 km
    ...east(6100, 6400, 300),   // detour 2
    ...east(6500, 9000),        // old road past the window's end
    ...east(8000, 8900).reverse(), // and back along it the other way
  ];
  const parts = newStretches(routed, ride);
  assert.equal(parts.length, 2, JSON.stringify(parts));
  const len = parts.reduce((s, [a, b]) => s + b - a, 0);
  // Each detour: 300 m out, 300 m along, 300 m back — no old road in the halo.
  assert.ok(len < 2 * 1000, `haloed ${Math.round(len)} m`);
});

test("newStretches: all-old road leaves no halo; no ride makes it all new", () => {
  assert.deepEqual(newStretches(east(0, 3000), east(0, 3000)), []);
  assert.deepEqual(newStretches(east(0, 3000).reverse(), east(0, 3000)), [], "the same road the other way is the same line on the map");
  const [[a, b]] = newStretches(east(0, 1000), []);
  assert.ok(a === 0 && Math.abs(b - cumulative(east(0, 1000)).at(-1)!) < 1e-6, `${a}–${b}`);
  // A crossing of the old road in the middle of a detour does not split it.
  const cross = [...east(0, 500, 200), ...east(600, 1000, -200)];
  const ride = [[24 + 550 / (111_320 * Math.cos((57 * Math.PI) / 180)), 56.99], [24 + 550 / (111_320 * Math.cos((57 * Math.PI) / 180)), 57.01]] as Point[];
  assert.equal(newStretches(cross, ride).length, 1);
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

test("the whole-span re-route is asked for when it changes the ride by > 20 % or > 5 km, proposed when less", () => {
  assert.equal(WIDE_ASK_SHARE, 0.2);
  assert.equal(WIDE_ASK_M, 5_000);
  // The measured case: 67 → 35 km.
  assert.equal(wideNeedsAsking(67_000, 35_000), true);
  // Over 5 km on a long ride, though under 20 %.
  assert.equal(wideNeedsAsking(100_000, 105_500), true);
  assert.equal(wideNeedsAsking(100_000, 94_400), true);
  // Over 20 % on a short ride, though under 5 km.
  assert.equal(wideNeedsAsking(10_000, 12_100), true);
  assert.equal(wideNeedsAsking(10_000, 7_900), true);
  // Within both: proposed as today (its chip shows the delta).
  assert.equal(wideNeedsAsking(100_000, 104_900), false);
  assert.equal(wideNeedsAsking(10_000, 11_900), false);
  assert.equal(wideNeedsAsking(10_000, 8_100), false);
  // On the lines themselves: not more than, so proposed.
  assert.equal(wideNeedsAsking(100_000, 105_000), false);
  assert.equal(wideNeedsAsking(10_000, 12_000), false);
});

test("the span's ends are named by the kept places it runs between", async () => {
  const { spanEnds } = await import("../lib/routing/reroute-leg");
  const line: Point[] = Array.from({ length: 301 }, (_, i) => [24 + (i * 100) / 60_630, 57]);
  const at = (km: number, name: string) => ({ name, label: name, lat: 57, lon: 24 + (km * 1000) / 60_630 });
  const places = { start: at(0, "Sigulda"), vias: [at(10, "Līgatne"), at(20, "Cēsis")], finish: at(30, "Valmiera"), roundTrip: false } as RidePlaces;
  const cum = cumulative(line);
  const mid = spanEnds({ line, cum, before: places, span: { fromMeters: cum[100], toMeters: cum[200] } });
  assert.equal(mid.from?.name, "Līgatne");
  assert.equal(mid.to?.name, "Cēsis");
  const whole = spanEnds({ line, cum, before: places, span: { fromMeters: 0, toMeters: cum[300] } });
  assert.deepEqual([whole.from?.name, whole.to?.name], ["Sigulda", "Valmiera"]);
  const open = spanEnds({ line, cum, before: { ...places, finish: null }, span: { fromMeters: cum[200], toMeters: cum[300] } });
  assert.equal(open.to, null, "the line's own end is no place");
});

test("a bend that brings the line no nearer to where it was dropped is not a bend (the measured worst re-routes)", async () => {
  const { bendMissed } = await import("../lib/map/proposal-view");
  // Antiņciems 21 %: dropped 416 m off, the re-routed line 416 m off — 12.4 km re-routed for nothing.
  assert.equal(bendMissed(416, 416), true);
  // Mālpils 21 %: 453 → 453; Antiņciems 45 %: 469 → 461 (8 m nearer is not a bend).
  assert.equal(bendMissed(453, 453), true);
  assert.equal(bendMissed(469, 461), true);
  // Real bends: Kaņieris 63 % 284 → 8 m; Antiņciems 60 % 340 → 195 m; Sigulda 60 % 222 → 118 m.
  assert.equal(bendMissed(284, 8), false);
  assert.equal(bendMissed(340, 195), false);
  assert.equal(bendMissed(222, 118), false);
  // At least 50 m nearer however close it was dropped, a quarter of the way when far.
  assert.equal(bendMissed(150, 101), true);
  assert.equal(bendMissed(150, 100), false);
  assert.equal(bendMissed(800, 650), true);
  // A point put on the line (or all but) is the composer's to answer, never refused here.
  assert.equal(bendMissed(55, 55), false);
});
