/**
 * The rider's Kapseļu iela → Viduči → Upmaļi of 2026-09-29, on his own GPX
 * (101 km, hand-edited, five pass-through points): „Izņemt” on „Pietura 1 ·
 * Viduči”, which sits at the tip of a ~590 m spur up to the Rīga–Ērgļi road,
 * was refused with „Šo labojumu neizdevās savienot ar maršrutu vienā līnijā
 * … izvēlies citu vietu” — „dīvaini, ka neizdodas, apkārt ir daudz ceļu”.
 *
 *   npx tsx --test scripts/remove-stop.test.ts
 *
 * The removal's window was sound (both cuts on the line, past the spur); what
 * failed was the router's answer on the ride's own profile starting ~450 m
 * off the cut (the same break the kit's fixture shows removing its first
 * pass-through point: `mopik: edited line broke … meters: 450`), the whole
 * span breaking the same way, and a removal — unlike an add or a move —
 * never climbing the relaxed ladder: it was refused on rung 0. Now a removal
 * climbs it (`home-page.tsx` `routeProposal`, smoke „remove stop”), and past
 * car-fast says which two places it could not join. These tests pin the
 * geometry half on his line and what is said.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import {
  anchorsAlong, anchorsOf, applyRuns, planEdit, removedNeighbours, spanRun, spliceIsSound,
  type RidePlace, type RidePlaces, type RoutedRun,
} from "@/lib/routing/reroute-leg";
import { proposalView } from "@/lib/map/proposal-view";
import { proposalGuide } from "@/lib/map/edit-guidance";
import { messages } from "@/lib/i18n/messages";

const GPX = readFileSync(new URL("./fixtures/ride-kapselu-upmali-2026-09-29.gpx", import.meta.url), "utf8");
const LINE: Point[] = [...GPX.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
const CUM = cumulative(LINE);
const TOTAL = CUM[CUM.length - 1];
const RTE = [...GPX.matchAll(/<rtept lat="([\d.]+)" lon="([\d.]+)">\s*<name>([^<]*)<\/name>\s*<extensions><trp:(\w+)/g)]
  .map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), name: m[3], shape: m[4] === "ShapingPoint" }));
const via = (r: (typeof RTE)[number]): RidePlace => r.shape
  ? { name: "", label: "", lat: r.lat, lon: r.lon, shape: true }
  : { name: r.name.replace(/^.*· /, ""), label: r.name, lat: r.lat, lon: r.lon };
const BEFORE: RidePlaces = {
  start: { name: "Kapseļu iela", label: "Kapseļu iela, Rīga", lat: RTE[0].lat, lon: RTE[0].lon },
  vias: RTE.slice(1, -1).map(via),
  finish: { name: "Upmaļi", label: "Upmaļi, Suntažu pagasts", lat: RTE.at(-1)!.lat, lon: RTE.at(-1)!.lon },
  roundTrip: false,
};
const STOP = BEFORE.vias.findIndex((v) => !v.shape);
const without = (i: number): RidePlaces => ({ ...BEFORE, vias: BEFORE.vias.filter((_, k) => k !== i) });
const SEGMENTS = { type: "FeatureCollection" as const, features: [] as { type: "Feature"; geometry: { type: "LineString"; coordinates: Point[] }; properties: { roadClass: "road"; surface: "gravel"; distanceMeters: number } }[] };
for (let i = 0; i < LINE.length - 1; i += 40) {
  const c = LINE.slice(i, Math.min(LINE.length, i + 41));
  SEGMENTS.features.push({ type: "Feature", geometry: { type: "LineString", coordinates: c }, properties: { roadClass: "road", surface: "gravel", distanceMeters: CUM[i + c.length - 1] - CUM[i] } });
}
const slice = (from: number, to: number): Point[] => {
  const out: Point[] = [pointAtDistance(LINE, CUM, from).point as Point];
  for (let i = 0; i < LINE.length; i++) if (CUM[i] > from && CUM[i] < to) out.push(LINE[i]);
  out.push(pointAtDistance(LINE, CUM, to).point as Point);
  return out;
};
const routed = (coords: Point[]): RoutedRun => ({ segments: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { roadClass: "road", surface: "gravel", distanceMeters: 0 } }] }, distanceMeters: 0, durationSeconds: 0 });

test("the GPX: start, five pass-through points, „Pietura 1 · Viduči” on a ~590 m spur, finish", () => {
  assert.equal(BEFORE.vias.length, 6);
  assert.equal(BEFORE.vias.filter((v) => !v.shape).length, 1);
  assert.equal(BEFORE.vias[STOP].name, "Viduči");
  const along = anchorsAlong(anchorsOf(BEFORE, LINE.at(-1)!), LINE, CUM);
  const at = along[STOP + 1];
  assert.ok(Math.abs(at - 85_753) < 50, `stop at ${Math.round(at)} m`);
  // Out and back the same road: 400 m either side of the tip is the same place.
  assert.ok(Math.hypot(...[0, 1].map((k) => (pointAtDistance(LINE, CUM, at - 400).point[k] - pointAtDistance(LINE, CUM, at + 400).point[k]) * 1e5)) < 40);
});

test("removing Viduči: one window, both cuts on the line past the spur, inside its neighbours", () => {
  const plan = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: without(STOP) });
  assert.ok(plan && !("error" in plan));
  assert.equal(plan.kind, "remove-stop");
  assert.equal(plan.runs.length, 1);
  const [run] = plan.runs;
  const along = anchorsAlong(anchorsOf(BEFORE, LINE.at(-1)!), LINE, CUM);
  // The spur is 85 168 → 86 339 m along: both cuts beyond it — not on a road only the stop used.
  assert.ok(run.fromMeters < 85_168 - 2_000 && run.toMeters > 86_339 + 2_000, JSON.stringify(run));
  // Not pinned by the pass-through points either side: clear of them.
  assert.ok(run.fromMeters > along[STOP] && run.toMeters < along[STOP + 2]);
  // Anchored on the line, not on the removed stop: its ends are line points, nothing else in between.
  assert.equal(run.points.length, 2);
});

test("a merged leg that joins the cuts is sound — the removed stop is not counted", () => {
  const plan = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: without(STOP) });
  assert.ok(plan && !("error" in plan));
  const [run] = plan.runs;
  // What the router rode: the ride's own road to the spur's foot and on, the spur left out.
  const merged = [...slice(run.fromMeters, 85_168), ...slice(86_339, run.toMeters)];
  const spliced = applyRuns({ segments: SEGMENTS, distanceMeters: TOTAL, durationSeconds: 0, runs: plan.runs, routed: [routed(merged)], keep: anchorsOf(BEFORE, LINE.at(-1)!) });
  assert.ok(spliced.distanceMeters < TOTAL - 1_000, `${Math.round(spliced.distanceMeters)} m`);
  assert.deepEqual(spliceIsSound({ segments: spliced.segments, original: SEGMENTS, places: plan.places, before: BEFORE, toleranceMeters: 500 }), { ok: true });
});

test("the production failure: a merged leg that starts ~450 m off the cut is a break, window and span alike", () => {
  const plan = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: without(STOP) });
  assert.ok(plan && !("error" in plan));
  const [run] = plan.runs;
  const off = (c: Point[]): Point[] => [[c[0][0], c[0][1] + 0.004], ...c];
  const window = applyRuns({ segments: SEGMENTS, distanceMeters: TOTAL, durationSeconds: 0, runs: plan.runs, routed: [routed(off([...slice(run.fromMeters, 85_168), ...slice(86_339, run.toMeters)]))], keep: anchorsOf(BEFORE, LINE.at(-1)!) });
  const v1 = spliceIsSound({ segments: window.segments, original: SEGMENTS, places: plan.places, before: BEFORE, toleranceMeters: 500 });
  assert.equal(v1.ok, false);
  assert.ok(!v1.ok && v1.breaks.length === 1 && v1.breaks[0].meters > 400 && !v1.missesPlaces && !v1.offRoadMeters, JSON.stringify(v1));
  // The span is cut at the neighbouring pass-through points and breaks the same way.
  const span = spanRun({ line: LINE, cum: CUM, before: BEFORE, after: plan.places, runs: plan.runs });
  const along = anchorsAlong(anchorsOf(BEFORE, LINE.at(-1)!), LINE, CUM);
  assert.equal(Math.round(span.fromMeters), Math.round(along[STOP]));
  assert.equal(Math.round(span.toMeters), Math.round(along[STOP + 2]));
  // Nothing on rung 0 to offer — so the page climbs the ladder rather than refuse (and says so only past car-fast).
});

test("a refused removal names the nearest named places either side and says what to try", () => {
  const n = removedNeighbours(BEFORE, without(STOP));
  assert.ok(n);
  assert.equal(n.gone.name, "Viduči");
  assert.ok(n.from.shape && n.to?.shape, "its neighbours are pass-through points");
  assert.equal(n.named.from.name, "Kapseļu iela");
  assert.equal(n.named.to?.name, "Upmaļi");
  // Each pass-through point too.
  BEFORE.vias.forEach((v, i) => {
    if (!v.shape) return;
    const m = removedNeighbours(BEFORE, without(i));
    assert.ok(m && m.gone === v);
    const plan = planEdit({ line: LINE, cum: CUM, before: BEFORE, after: without(i) });
    assert.ok(plan && !("error" in plan) && plan.kind === "remove-stop" && plan.runs.length === 1, `pass-through ${i}`);
  });
  const lv = messages("lv");
  const g = proposalGuide((k) => lv[k]);
  const reason = lv.editBrokenLine;
  const view = proposalView({ phase: "refused", token: 1, how: "remove-stop", reason }, { routing: "", delta: "", deltaTitle: "", guide: g }, "lv");
  assert.equal(view?.guide, "mēģini pārvietot tuvējo punktu vai izņemt citu.");
  const moved = proposalView({ phase: "refused", token: 1, how: "move-stop", reason }, { routing: "", delta: "", deltaTitle: "", guide: g }, "lv");
  assert.equal(moved?.guide, lv.guideRefused);
});

test("editBrokenLine and editRemoveNoJoin: en dashes, never em dashes, in every locale", () => {
  for (const loc of ["lv", "lt", "et", "en"] as const) {
    const m = messages(loc);
    assert.ok(!m.editBrokenLine.includes("—"), `${loc}: ${m.editBrokenLine}`);
    assert.ok(m.editBrokenLine.includes(" – "), `${loc}: ${m.editBrokenLine}`);
    assert.ok(m.editRemoveNoJoin.includes("{a}") && m.editRemoveNoJoin.includes("{b}") && !m.editRemoveNoJoin.includes("—"), loc);
    assert.ok(m.guideRefusedRemove && !m.guideRefusedRemove.includes("—"), loc);
  }
});
