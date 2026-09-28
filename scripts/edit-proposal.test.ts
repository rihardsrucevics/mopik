import test from "node:test";
import assert from "node:assert/strict";
import {
  IDLE_PROPOSAL,
  editDelta,
  formatEditDelta,
  formatSignedMinutes,
  proposalReducer,
  type EditDelta,
  type EditProposal,
  type ProposalAction,
  type ProposalState,
} from "../lib/map/edit-proposal";
import {
  applyRuns,
  applyShapeEdit,
  placesFromRide,
  planWithPlaces,
  shapesOf,
  stopsOf,
  type EditedRide,
  type RidePlace,
  type RidePlaces,
} from "../lib/routing/reroute-leg";
import { RidePlanSchema, type RidePlan } from "../lib/chat/ride-plan";
import { MAX_SHAPE_POINTS } from "../lib/chat/ride-limits";
import { lineMeters } from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";
import type { RouteSegmentProperties } from "../lib/types";
import { messages } from "../lib/i18n/messages";
const MESSAGES = { lv: messages("lv"), lt: messages("lt"), et: messages("et"), en: messages("en") };

/**
 * Preview before commit — the pure half (docs/DESIGN-route-editing.md, B4,
 * Phase 1 P1-A): the proposal's state machine, the chip's numbers, and
 * „Padarīt caurbraucamu” (a stop demoted to a pass-through point).
 *
 * `npx tsx --test scripts/edit-proposal.test.ts`
 */

// ── the reducer ──

function proposal(token: number): EditProposal {
  return {
    token,
    how: "move-stop",
    before: PLACES,
    ride: {} as EditedRide,
    changed: [[100, 900]],
    delta: { kmBefore: 10, kmAfter: 11, secondsDelta: 60, repeatedBefore: 0, repeatedAfter: 0 },
    notes: [],
  };
}
const run = (state: ProposalState, ...actions: ProposalAction[]) => actions.reduce(proposalReducer, state);

test("idle → routing → proposed, and ✕ or a commit go back to idle", () => {
  const routing = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" });
  assert.deepEqual(routing, { phase: "routing", token: 1, how: "move-stop", confirmWhenReady: false });
  const landed = run(routing, { type: "landed", proposal: proposal(1) });
  assert.equal(landed.phase, "proposed");
  assert.ok(landed.phase === "proposed" && landed.confirmNow === false, "landing alone commits nothing");
  assert.equal(run(landed, { type: "discard" }), IDLE_PROPOSAL);
  assert.equal(run(landed, { type: "committed" }), IDLE_PROPOSAL);
  assert.equal(run(routing, { type: "discard" }), IDLE_PROPOSAL, "✕ while routing");
});

test("a refusal for the routing token is shown with its reason; ✓ does nothing there", () => {
  const refused = run(IDLE_PROPOSAL, { type: "route", token: 4, how: "remove-stop" }, { type: "refused", token: 4, reason: "Nevar" });
  assert.deepEqual(refused, { phase: "refused", token: 4, how: "remove-stop", reason: "Nevar" });
  assert.equal(proposalReducer(refused, { type: "confirm" }), refused);
  assert.equal(run(refused, { type: "discard" }), IDLE_PROPOSAL);
});

test("stale answers are dropped: an older token, or anything after ✕", () => {
  const routing2 = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" }, { type: "route", token: 2, how: "move-stop" });
  assert.equal(proposalReducer(routing2, { type: "landed", proposal: proposal(1) }), routing2, "old landed");
  assert.equal(proposalReducer(routing2, { type: "refused", token: 1, reason: "x" }), routing2, "old refusal");
  assert.equal(run(routing2, { type: "landed", proposal: proposal(2) }).phase, "proposed");
  // After ✕ the answer still arriving must not bring the proposal back.
  assert.equal(run(routing2, { type: "discard" }, { type: "landed", proposal: proposal(2) }), IDLE_PROPOSAL);
  // A landed proposal is not replaced by a late duplicate.
  const shown = run(routing2, { type: "landed", proposal: proposal(2) });
  assert.equal(proposalReducer(shown, { type: "landed", proposal: proposal(2) }), shown);
});

test("a new route supersedes what was routing, proposed or refused", () => {
  const shown = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" }, { type: "landed", proposal: proposal(1) }, { type: "confirm" });
  const again = run(shown, { type: "route", token: 2, how: "remove-stop" });
  assert.deepEqual(again, { phase: "routing", token: 2, how: "remove-stop", confirmWhenReady: false }, "a ✓ for the old line does not carry over");
  const refused = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" }, { type: "refused", token: 1, reason: "x" });
  assert.equal(run(refused, { type: "route", token: 2, how: "move-stop" }).phase, "routing");
  const queued = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" }, { type: "confirm" }, { type: "route", token: 2, how: "move-stop" });
  assert.ok(queued.phase === "routing" && !queued.confirmWhenReady);
});

test("✓ while routing is confirm-when-ready: the proposal lands with confirmNow", () => {
  const queued = run(IDLE_PROPOSAL, { type: "route", token: 7, how: "move-stop" }, { type: "confirm" });
  assert.deepEqual(queued, { phase: "routing", token: 7, how: "move-stop", confirmWhenReady: true });
  assert.equal(proposalReducer(queued, { type: "confirm" }), queued, "pressing twice is the same");
  const landed = run(queued, { type: "landed", proposal: proposal(7) });
  assert.ok(landed.phase === "proposed" && landed.confirmNow === true);
  // A refusal ends the wait: nothing is committed.
  const refused = run(queued, { type: "refused", token: 7, reason: "x" });
  assert.equal(refused.phase, "refused");
  // ✓ on a landed proposal sets confirmNow too.
  const shown = run(IDLE_PROPOSAL, { type: "route", token: 1, how: "move-stop" }, { type: "landed", proposal: proposal(1) }, { type: "confirm" });
  assert.ok(shown.phase === "proposed" && shown.confirmNow === true);
  assert.equal(proposalReducer(IDLE_PROPOSAL, { type: "confirm" }), IDLE_PROPOSAL, "✓ with nothing pending");
});

// ── the chip ──

const ride = (m: number, s: number, pct: number) => ({
  distanceMeters: m, durationSeconds: s, overlap: { repeatedKm: 0, distinctKm: 0, repeatedPercent: pct },
});

test("editDelta: km before and after, signed seconds, repeated percent", () => {
  assert.deepEqual(editDelta(ride(42_340, 3_600, 3), ride(45_180, 3_960, 7)), {
    kmBefore: 42.34, kmAfter: 45.18, secondsDelta: 360, repeatedBefore: 3, repeatedAfter: 7,
  });
  assert.equal(editDelta(ride(1, 500, 0), ride(1, 380, 0)).secondsDelta, -120);
});

const D: EditDelta = { kmBefore: 42.34, kmAfter: 45.18, secondsDelta: 360, repeatedBefore: 3.4, repeatedAfter: 6.6 };

test("the chip in all four languages: comma decimals in lv/lt/et, a point in en", () => {
  assert.equal(formatEditDelta(MESSAGES.lv.previewDelta, D, "lv"), "42,3 → 45,2 km · +6 min · atkārtoti 3 → 7 %");
  assert.equal(formatEditDelta(MESSAGES.lt.previewDelta, D, "lt"), "42,3 → 45,2 km · +6 min · kartojasi 3 → 7 %");
  assert.equal(formatEditDelta(MESSAGES.et.previewDelta, D, "et"), "42,3 → 45,2 km · +6 min · korduv 3 → 7 %");
  assert.equal(formatEditDelta(MESSAGES.en.previewDelta, D, "en"), "42.3 → 45.2 km · +6 min · retraced 3 → 7 %");
});

test("the chip's title fills every placeholder, in its own order", () => {
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    const out = formatEditDelta(MESSAGES[locale].previewDeltaTitle, D, locale);
    assert.doesNotMatch(out, /\{(a|b|t|r1|r2)\}/, locale);
    assert.match(out, locale === "en" ? /45\.2 km/ : /45,2 km/, locale);
  }
});

test("time is signed, with a real minus, whole minutes, hours past 60", () => {
  assert.equal(formatSignedMinutes(360), "+6 min");
  assert.equal(formatSignedMinutes(-120), "−2 min");
  assert.equal(formatSignedMinutes(-3_900), "−1 h 5 min");
  assert.equal(formatSignedMinutes(7_200), "+2 h");
  assert.equal(formatSignedMinutes(20), "±0 min", "under half a minute is no change");
  assert.equal(formatSignedMinutes(0), "±0 min");
  assert.equal(formatEditDelta("{a} km", { ...D, kmBefore: 0 }, "lv"), "0,0 km", "one decimal always");
});

// ── the chip's time is honest: every stretch's seconds counted once ──

const M_PER_DEG_LON = 111_320 * Math.cos((57 * Math.PI) / 180);
/** `km` of line east from `fromKm`, one feature per km, of one kind. */
function stretch(fromKm: number, km: number, props: Pick<RouteSegmentProperties, "roadClass" | "surface">) {
  const pt = (k: number): Point => [24 + (k * 1000) / M_PER_DEG_LON, 57];
  const features = Array.from({ length: km }, (_, i) => {
    const coordinates = [pt(fromKm + i), pt(fromKm + i + 0.5), pt(fromKm + i + 1)];
    return { type: "Feature" as const, geometry: { type: "LineString" as const, coordinates }, properties: { ...props, distanceMeters: Math.round(lineMeters(coordinates)) } };
  });
  return { type: "FeatureCollection" as const, features };
}
const ASPHALT = { roadClass: "road", surface: "asphalt" } as const;
const TRAIL = { roadClass: "trail", surface: "ground" } as const;
const secs = (km: number, kmh: number) => (km / kmh) * 3600;

test("applyRuns: two runs, given out of order, each bring their time exactly once; kept time is the ride's own", () => {
  // 30 km: asphalt 0–10, trail 10–20, asphalt 20–30, timed at the table's speeds.
  const ride = { type: "FeatureCollection" as const, features: [...stretch(0, 10, ASPHALT).features, ...stretch(10, 10, TRAIL).features, ...stretch(20, 10, ASPHALT).features] };
  const drawn = lineMeters(ride.features.flatMap((f, i) => (i ? f.geometry.coordinates.slice(1) : f.geometry.coordinates)) as Point[]);
  const T = secs(20, 58) + secs(10, 15);
  const out = applyRuns({
    segments: ride, distanceMeters: Math.round(drawn), durationSeconds: T,
    // replace 2–4 km (asphalt) and 12–18 km (trail); listed back to front
    runs: [{ fromMeters: drawn * 12 / 30, toMeters: drawn * 18 / 30 }, { fromMeters: drawn * 2 / 30, toMeters: drawn * 4 / 30 }],
    routed: [
      { segments: stretch(12, 6, TRAIL), distanceMeters: 9_000, durationSeconds: 1_111 },
      { segments: stretch(2, 2, ASPHALT), distanceMeters: 2_000, durationSeconds: 222 },
    ],
  });
  const kept = T - secs(2, 58) - secs(6, 15);
  assert.ok(Math.abs(out.durationSeconds - (kept + 1_111 + 222)) <= 2, `got ${out.durationSeconds}, expected ${Math.round(kept + 1_333)}`);
  assert.ok(Math.abs(out.distanceMeters - (drawn - drawn * 8 / 30 + 11_000)) <= 2);
});

test("a longer re-route can honestly be quicker: 6 km of trail swapped for 9 km of asphalt", () => {
  const ride = { type: "FeatureCollection" as const, features: [...stretch(0, 10, ASPHALT).features, ...stretch(10, 6, TRAIL).features, ...stretch(16, 10, ASPHALT).features] };
  const T = secs(20, 58) + secs(6, 15);
  const drawn = lineMeters(ride.features.flatMap((f, i) => (i ? f.geometry.coordinates.slice(1) : f.geometry.coordinates)) as Point[]);
  const out = applyRuns({
    segments: ride, distanceMeters: Math.round(drawn), durationSeconds: T,
    runs: [{ fromMeters: drawn * 10 / 26, toMeters: drawn * 16 / 26 }],
    routed: [{ segments: stretch(10, 6, ASPHALT), distanceMeters: 9_000, durationSeconds: secs(9, 58) }],
  });
  const overlap = { repeatedKm: 0, distinctKm: 0, repeatedPercent: 0 };
  const d = editDelta({ distanceMeters: drawn, durationSeconds: T, overlap }, { ...out, overlap });
  assert.ok(d.kmAfter > d.kmBefore + 2.9, "3 km longer");
  // trail 6 km at 15 km/h = 24 min out, asphalt 9 km at 58 km/h ≈ 9.3 min in
  assert.equal(formatSignedMinutes(d.secondsDelta), "\u221215 min");
});

// ── „Padarīt caurbraucamu” ──

const at = (lat: number, lon: number, name: string, extra: Partial<RidePlace> = {}): RidePlace => ({ name, label: name, lat, lon, ...extra });
const JOINS: [[number, number], [number, number]] = [[24.1, 57.1], [24.3, 57.1]];
/** Sigulda → Turaida → (pass-through) → Līgatne (with joins) → Cēsis, one way. */
const PLACES: RidePlaces = {
  start: at(57.15, 24.85, "Sigulda"),
  vias: [
    at(57.18, 24.82, "Turaida"),
    { name: "", label: "", lat: 57.2, lon: 24.9, shape: true },
    at(57.23, 25.03, "Līgatne", { joins: JOINS, kind: "sight", poiId: "p1" } as Partial<RidePlace>),
  ],
  finish: at(57.31, 25.27, "Cēsis"),
  roundTrip: false,
};
const PLAN: RidePlan = RidePlanSchema.parse({
  startPlace: "Sigulda", viaPlaces: ["Turaida", "Līgatne"], destinationPlace: "Cēsis", directionPlace: null, returnToStart: false,
  budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null }, difficulty: "adventure", rideStyle: "explore",
  gravelPreference: 55, trailPreference: "some", accessPolicy: "verified", preferForest: false, noSand: false, avoidTowns: false,
  avoidMainRoads: false, includeTet: false, includeSightseeing: false,
});

function ok<T>(value: T): Exclude<T, { error: unknown }> {
  assert.ok(!(value && typeof value === "object" && "error" in value), `refused: ${JSON.stringify(value)}`);
  return value as Exclude<T, { error: unknown }>;
}

test("demote: the stop becomes a pass-through at its own spot, in its own place, joins kept", () => {
  const out = ok(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 1 }));
  assert.equal(out.vias.length, 3, "nothing added or dropped: the line does not change");
  assert.deepEqual(out.vias[2], { name: "", label: "", lat: 57.23, lon: 25.03, shape: true, joins: JOINS });
  assert.deepEqual(out.vias.slice(0, 2), PLACES.vias.slice(0, 2), "the others untouched");
  assert.equal(out.start, PLACES.start);
  assert.equal(out.finish, PLACES.finish);
  assert.deepEqual(stopsOf(out).map((v) => v.name), ["Turaida"]);
  // stopIndex counts stops only, skipping the pass-through before Līgatne.
  const first = ok(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 0 }));
  assert.equal(first.vias[0].shape, true);
  assert.equal("joins" in first.vias[0], false, "no joins invented");
});

test("demote refuses a stop that is not there, and at the pass-through cap", () => {
  assert.deepEqual(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 2 }), { error: "no-such-point" });
  assert.deepEqual(applyShapeEdit(PLACES, { kind: "demote", stopIndex: -1 }), { error: "no-such-point" });
  const full: RidePlaces = {
    ...PLACES,
    vias: [PLACES.vias[0], ...Array.from({ length: MAX_SHAPE_POINTS }, (_, i) => ({ name: "", label: "", lat: 57 + i / 100, lon: 24, shape: true as const }))],
  };
  assert.deepEqual(applyShapeEdit(full, { kind: "demote", stopIndex: 0 }), { error: "shape-cap" });
});

test("demote → promote gives back the stop at the very same coordinates, joins and all", () => {
  const demoted = ok(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 1 }));
  const promoted = ok(applyShapeEdit(demoted, { kind: "promote", index: 1, place: { name: "Līgatne", label: "Līgatne", lat: 0, lon: 0 } }));
  assert.equal(shapesOf(promoted).length, 1);
  const back = promoted.vias[2];
  assert.equal(back.lat, 57.23);
  assert.equal(back.lon, 25.03);
  assert.deepEqual(back.joins, JOINS);
  assert.equal(back.shape, undefined);
  assert.deepEqual(promoted.vias.map((v) => [v.lat, v.lon]), PLACES.vias.map((v) => [v.lat, v.lon]));
});

test("planWithPlaces after a demote: the name leaves viaPlaces, the point follows the right place", () => {
  const demoted = ok(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 1 }));
  const next = planWithPlaces(PLAN, demoted);
  assert.deepEqual(next.viaPlaces, ["Turaida"]);
  assert.equal(next.destinationPlace, "Cēsis");
  assert.deepEqual(next.shapePoints, [
    { lat: 57.2, lon: 24.9, afterPlace: 1 },
    { lat: 57.23, lon: 25.03, afterPlace: 1 },
  ], "both after Turaida (start = 0), in riding order");
  // Demoting the first stop instead: its point follows the start.
  const first = planWithPlaces(PLAN, ok(applyShapeEdit(PLACES, { kind: "demote", stopIndex: 0 })));
  assert.deepEqual(first.viaPlaces, ["Līgatne"]);
  assert.deepEqual(first.shapePoints?.map((s) => s.afterPlace), [0, 0]);
  // …and the plan builds the same places back.
  const rebuilt = placesFromRide({
    plan: next,
    start: { lat: 57.15, lon: 24.85, label: "Sigulda" },
    via: [{ lat: 57.18, lon: 24.82, label: "Turaida" }],
    destination: { lat: 57.31, lon: 25.27, label: "Cēsis" },
    picked: [],
  });
  assert.deepEqual(rebuilt.vias.map((v) => [v.lat, v.lon, v.shape === true]), demoted.vias.map((v) => [v.lat, v.lon, v.shape === true]));
});
