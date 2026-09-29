/**
 * „Vest pa taisno caur visiem” (rider, 2026-09-29): several pending points
 * in a row off any road become ONE chain — by roads toward the first, drawn
 * straight 1 → 2 → 3, and back from the last to the ride toward the next
 * kept place (`lib/map/straight-chain.ts`).
 *
 *   npx tsx --test scripts/straight-chain.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, lineMeters, pointAtDistance } from "@/lib/routing/detour";
import { drawnSeconds } from "@/lib/routing/drawn";
import { drawnIntervals } from "@/lib/map/straight";
import { CHAIN_OFF_M, chainEdit, chainEstimate, chainJoins, chainMeters, chainRun, chainsOf, insertChain, offRoadRuns } from "@/lib/map/straight-chain";
import { chainGuide, chainLine, GUIDE_DASH } from "@/lib/map/edit-guidance";
import { applyRuns, nearestAlong, outAndBacks, summariseSegments, type RidePlace, type RidePlaces, type RoutedRun } from "@/lib/routing/reroute-leg";
import { decodeRouteShare, encodeRouteShare, sharedRouteSegments } from "@/lib/share/route-code";
import { t, type MessageKey } from "@/lib/i18n/messages";
import type { GeneratedRoute, RouteSegmentProperties } from "@/lib/types";

const FX = JSON.parse(readFileSync(new URL("./fixtures/gailisu-purvs-2026-09-28.json", import.meta.url), "utf8")) as { track: Point[] };
type Segs = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
const segs = (coords: Point[]): Segs => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { roadClass: "track", surface: "dirt", distanceMeters: Math.round(lineMeters(coords)) }, geometry: { type: "LineString", coordinates: coords } }] });
const LINE = FX.track.slice(0, 35);
const CUM = cumulative(LINE);
const TOTAL = CUM[CUM.length - 1];
const off = (p: Point, north: number, east: number): Point => [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
const at = (m: number) => pointAtDistance(LINE, CUM, m).point as Point;
// Three points in a forest beside the ride, 400–500 m off it, in the ride's direction:
// each pushed the way (N, S, E, W) that leaves it farthest from the winding track.
const away = (m: number, d: number): Point => [off(at(m), d, 0), off(at(m), -d, 0), off(at(m), 0, d), off(at(m), 0, -d)]
  .reduce((best, p) => (nearestAlong(p, LINE, CUM).meters > nearestAlong(best, LINE, CUM).meters ? p : best));
const P1 = away(TOTAL * 0.35, 450);
const P2 = away(TOTAL * 0.5, 500);
const P3 = away(TOTAL * 0.65, 420);
const place = (p: Point, name: string, extra: object = {}): RidePlace => ({ name, label: name, lat: p[1], lon: p[0], ...extra }) as RidePlace;
const BEFORE: RidePlaces = { start: place(LINE[0], "A"), vias: [], finish: place(LINE[LINE.length - 1], "B"), roundTrip: false };

test("consecutive off-road points: runs of two or more; a lone one keeps its own offer", () => {
  assert.deepEqual(offRoadRuns([true, true, true]), [[0, 2]]);
  assert.deepEqual(offRoadRuns([false, true, true, false, true]), [[1, 2]], "a mixed batch: the run, not the lone point");
  assert.deepEqual(offRoadRuns([true, true, false, true, true, true]), [[0, 1], [3, 5]], "two runs, two chains");
  assert.deepEqual(offRoadRuns([true, false, true]), []);
  assert.deepEqual(offRoadRuns([]), []);
  assert.ok(CHAIN_OFF_M >= 100 && CHAIN_OFF_M <= 318, "the rider's 318 m snap counts as off-road");
});

test("the chain's places: consecutive in his order, where the line meets the first", () => {
  const stop = place(at(TOTAL * 0.8), "S");
  const before = { ...BEFORE, vias: [stop] };
  const chain = [place(P1, "1"), place(P2, "2"), place(P3, "3")];
  const after = insertChain(LINE, before, chain);
  assert.deepEqual(after.vias.map((v) => v.name), ["1", "2", "3", "S"]);
});

test("the joins: the entry nearest the first point, the exit nearest the last, toward the next kept place", () => {
  const j = chainJoins(LINE, BEFORE, [P1, P2, P3]);
  assert.ok(Math.abs(j.entryAlong - nearestAlong(P1, LINE, CUM).alongMeters) < 5);
  assert.ok(Math.abs(j.exitAlong - nearestAlong(P3, LINE, CUM).alongMeters) < 5);
  assert.ok(j.exitAlong > j.entryAlong, "rejoins the route further on, not back where it left");
  // Reversed order: the exit never goes behind the entry.
  const r = chainJoins(LINE, BEFORE, [P3, P2, P1]);
  assert.ok(r.exitAlong >= r.entryAlong);
});

test("with no road nearer than the ride: drawn from the ride to 1, 1 → 2 → 3, and from 3 back to the ride", () => {
  const j = chainJoins(LINE, BEFORE, [P1, P2, P3]);
  const c = chainRun({ points: [P1, P2, P3], ...j });
  const f = c.routed.segments.features;
  assert.equal(f.length, 4, "entry, 1→2, 2→3, exit");
  assert.ok(f.every((x) => x.properties.drawn && x.properties.roadClass === "trail" && x.properties.surface === "unknown"));
  const expect = haversineMeters(j.entry, P1) + chainMeters([P1, P2, P3]) + haversineMeters(P3, j.exit);
  assert.ok(Math.abs(c.drawnMeters - expect) < 5, `${c.drawnMeters} vs ${expect}`);
  assert.ok(Math.abs(c.drawnMeters - chainEstimate([P1, P2, P3], LINE)) < 10, "the guidance's estimate is the drawn length");
  assert.equal(c.routed.durationSeconds, drawnSeconds(c.drawnMeters), "15 km/h for every drawn metre");
  assert.equal(c.sameEnd, false);
  // Spliced: one continuous ride through all three, no out-and-back.
  const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [c.run], routed: [c.routed], keep: [LINE[0], LINE[LINE.length - 1]] });
  const oc = cumulative(out.coordinates);
  for (const p of [P1, P2, P3]) assert.ok(nearestAlong(p, out.coordinates, oc).meters < 1, "reaches each point exactly");
  const a1 = nearestAlong(P1, out.coordinates, oc).alongMeters, a2 = nearestAlong(P2, out.coordinates, oc).alongMeters, a3 = nearestAlong(P3, out.coordinates, oc).alongMeters;
  assert.ok(a1 < a2 && a2 < a3, "in his order");
  assert.equal(outAndBacks(out.coordinates, 100).length, 0, "back to the route, not back along the way in");
  assert.ok(Math.abs(summariseSegments(out.segments, false).drawnKm - c.drawnMeters / 1000) < 0.05);
  // The drawn chain is one fixed interval for later edits.
  assert.equal(drawnIntervals(out.segments).length, 1);
});

test("with roads toward the first and from the last: along them as far as they go; one road end is said", () => {
  const j = chainJoins(LINE, BEFORE, [P1, P2, P3]);
  const toward = (a: Point, b: Point, short: number): Point => { const k = 1 - short / haversineMeters(a, b); return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; };
  const inEnd = toward(j.entry, P1, 150);
  const outStart = toward(j.exit, P3, 120);
  const entryRoad: RoutedRun = { segments: segs([j.entry, inEnd]), distanceMeters: Math.round(haversineMeters(j.entry, inEnd)), durationSeconds: 60 };
  const exitRoad: RoutedRun = { segments: segs([outStart, j.exit]), distanceMeters: Math.round(haversineMeters(outStart, j.exit)), durationSeconds: 50 };
  const c = chainRun({ points: [P1, P2, P3], ...j, entryRoad, exitRoad });
  assert.deepEqual(c.routed.segments.features.map((f) => (f.properties.drawn ? "drawn" : "road")), ["road", "drawn", "drawn", "drawn", "drawn", "road"]);
  assert.deepEqual(c.from, inEnd);
  assert.deepEqual(c.to, outStart);
  assert.equal(c.routed.durationSeconds, Math.round(110 + drawnSeconds(c.drawnMeters)));
  assert.equal(c.routed.distanceMeters, Math.round(entryRoad.distanceMeters + exitRoad.distanceMeters + c.drawnMeters));
  // The exit's road starts where the entry's ended: in and out by one road end.
  // (A loop in the forest: 1 → 2 → back beside 1, out by the road end he came in by.)
  const back = off(P1, 25, 0);
  const jl = chainJoins(LINE, BEFORE, [P1, P2, back]);
  const same = chainRun({ points: [P1, P2, back], ...jl, entryRoad, exitRoad: { ...exitRoad, segments: segs([inEnd, jl.exit]) } });
  assert.equal(same.sameEnd, true);
  assert.equal(chainRun({ points: [P1, P2, P3], ...j, entryRoad, exitRoad }).sameEnd, false);
  // A road that ends no nearer than the ride is not used.
  const away: RoutedRun = { ...entryRoad, segments: segs([j.entry, [j.entry[0] - (P1[0] - j.entry[0]) * 0.5, j.entry[1] - (P1[1] - j.entry[1]) * 0.5]]) };
  assert.equal(chainRun({ points: [P1, P2, P3], ...j, entryRoad: away }).routed.segments.features[0].properties.drawn, true);
});

test("the share code carries the chain as trail|unknown|d with dk and reopens identically", () => {
  const j = chainJoins(LINE, BEFORE, [P1, P2, P3]);
  const c = chainRun({ points: [P1, P2, P3], ...j });
  const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [c.run], routed: [c.routed], keep: [] });
  const base = { name: "T", variant: "direct", distanceMeters: out.distanceMeters, durationSeconds: out.durationSeconds, surfaces: { asphaltPercent: 0, gravelPercent: 0, dirtPercent: 100, unknownPercent: 0 }, overlap: { repeatedKm: 0, distinctKm: 1, repeatedPercent: 0 }, roadMix: { roadPercent: 0, trackPercent: 100, trailPercent: 0, roadKm: 0, trackKm: 1, trailKm: 0 }, quality: { forestKm: 0, riversideKm: 0, ruralOpenKm: 0, unverifiedPathKm: 0, roughTrackKm: 0, sandKm: 0, streetKm: 0, coastKm: 0 } };
  const ride = { ...base, geometry: { type: "LineString", coordinates: out.coordinates }, segments: out.segments } as unknown as GeneratedRoute;
  const code = encodeRouteShare(ride, "A");
  const meta = JSON.parse(Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.ok(meta.d.includes("trail|unknown|d"));
  assert.ok(Math.abs(meta.dk - c.drawnMeters / 1000) < 0.06);
  const share = decodeRouteShare(code)!;
  const back = sharedRouteSegments(share);
  const drawnBack = back.features.filter((f) => f.properties.drawn).reduce((m, f) => m + lineMeters(f.geometry.coordinates as Point[]), 0);
  assert.ok(Math.abs(drawnBack - c.drawnMeters) < 30, `drawn back ${drawnBack} vs ${c.drawnMeters}`);
  // Reopened and shared again: the same code.
  const again = { ...ride, geometry: { type: "LineString", coordinates: back.features.flatMap((f, i) => (i ? f.geometry.coordinates.slice(1) : f.geometry.coordinates)) }, segments: back } as unknown as GeneratedRoute;
  assert.equal(decodeRouteShare(encodeRouteShare(again, "A"))!.drawnKm, share.drawnKm);
});

const KEYS: MessageKey[] = ["chainOffer", "chainLabel", "chainWhat", "chainRisk", "chainAct", "chainNote", "chainSameEnd"];

test("the guidance: what is happening – what to do, with the drawn length and the risk above 1 km", () => {
  const lv = (k: MessageKey) => t("lv", k);
  const fmt = (n: number) => new Intl.NumberFormat("lv", { maximumFractionDigits: 1 }).format(n);
  assert.equal(chainLine(lv, 3, 900, fmt), "3 punkti bez ceļa, taisni ~0,9 km – „Vest pa taisno caur visiem” vai pārvieto katru.");
  assert.equal(chainLine(lv, 3, 1_400, fmt), "3 punkti bez ceļa, taisni ~1,4 km pāri mežam vai ūdenim – „Vest pa taisno caur visiem” vai pārvieto katru.");
  const g = chainGuide(lv, 2, 500, fmt);
  assert.ok(!g.what.includes(GUIDE_DASH.trim()) && g.action.startsWith("„Vest pa taisno caur visiem”"));
  const en = (k: MessageKey) => t("en", k);
  assert.equal(chainLine(en, 3, 1_400, (n) => String(n)), "3 points off any road, ~1.4 km straight across forest or water – „Go straight through all” or move each one.");
});

test("the copy in four locales: en dashes, never em dashes, Latvian quotes and never „piesit”", () => {
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    for (const k of KEYS) {
      const v = t(locale, k);
      assert.ok(v && v !== k, `${locale}.${k}`);
      assert.doesNotMatch(v, /—/, `${locale}.${k} has no em dash`);
    }
    if (locale !== "lv") assert.notEqual(t(locale, "chainOffer"), t("lv", "chainOffer"), `${locale} is translated`);
  }
  for (const k of KEYS) {
    assert.doesNotMatch(t("lv", k), /piesit/i);
    assert.doesNotMatch(t("lv", k), /"|“/);
  }
  assert.equal(t("lv", "chainOffer"), "Vest pa taisno caur visiem");
});

test("the flow: offered for a batch's run, the chip proposes, the proposal is honest", () => {
  const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  assert.match(page, /onStraightChain: chainNow \? acceptChain : undefined,/);
  assert.match(composer, /else if \("chain" in act\) edit\?\.onStraightChain\?\.\(\);/);
  assert.match(page, /const offM = \(q: Point\) => nearestAlong\(q, landed, lc\)\.meters;\n\s*offerChain\(token, planned\.places, asked, \(q\) => offM\(q\) >= CHAIN_OFF_M, offM, level\);/);
  // Refused: the points the probe found too far from a road, with how far.
  assert.match(page, /offerChain\(token, ctx\.planned\.places, ctx\.asked, \(q\) => Boolean\(farAt\(q\)\), \(q\) => farAt\(q\)\?\.meters \?\? 0, 0\);/);
  assert.match(page, /notes\.push\(fi\(ui\.panelDrawn, \{ km \}\)\);/);
  // His own drawn line: no detour warning, no re-routing of it.
  assert.match(page, /const risk = p\.chain \? null : detourRisk\(/);
  assert.match(page, /const through = straight \|\| p\.chain \? null/);
});

// ── chain-polish ── a committed chain's point taken out or moved: the chain re-formed, never refused.
{
  const committed = () => {
    const pts = [place(P1, "1"), place(P2, "2"), place(P3, "3")];
    const j = chainJoins(LINE, BEFORE, [P1, P2, P3]);
    const c = chainRun({ points: [P1, P2, P3], ...j });
    const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [c.run], routed: [c.routed], keep: [LINE[0], LINE[LINE.length - 1]] });
    return { out, places: insertChain(LINE, BEFORE, pts), from: c.from, to: c.to };
  };
  const apply = (seg: Segs, e: NonNullable<ReturnType<typeof chainEdit>>) =>
    applyRuns({ segments: seg, distanceMeters: 10_000, durationSeconds: 3_600, runs: e.plan.runs, routed: e.kind === "reform" ? [e.routed] : [], keep: [] });
  const drawnCoords = (s: Segs) => s.features.filter((f) => f.properties.drawn).flatMap((f) => f.geometry.coordinates as Point[]);
  const without = (p: RidePlaces, i: number): RidePlaces => ({ ...p, vias: p.vias.filter((_, k) => k !== i) });

  test("the committed chain's points are found on its drawn stretch; a lone straight point is not a chain", () => {
    const { out, places } = committed();
    const cs = chainsOf(out.segments, places);
    assert.equal(cs.length, 1);
    assert.deepEqual(cs[0].vias, [0, 1, 2]);
    const lone = { ...places, vias: places.vias.map((v) => ({ ...v, reach: "straight" as const })) };
    assert.equal(chainsOf(out.segments, lone).length, 0);
  });

  for (const [which, i, left] of [["first", 0, [P2, P3]], ["middle", 1, [P1, P3]], ["last", 2, [P1, P2]]] as const) {
    test(`removing the ${which} of three: the chain re-forms through the other two, same way in and out, nothing routed`, () => {
      const { out, places, from, to } = committed();
      const e = chainEdit({ segments: out.segments, before: places, after: without(places, i) });
      assert.ok(e && e.kind === "reform", "re-formed, not refused");
      assert.equal(e.plan.kind, "remove-stop");
      assert.equal(e.points.length, 2);
      const s = apply(out.segments, e);
      const d = drawnCoords(s.segments);
      assert.deepEqual(d[0], from, "the same entry");
      assert.deepEqual(d[d.length - 1], to, "the same exit");
      const sc = cumulative(s.coordinates);
      for (const p of left) assert.ok(nearestAlong(p, s.coordinates, sc).meters < 1, "through the points left");
      const gone = [P1, P2, P3][i];
      assert.ok(!d.some((q) => haversineMeters(q, gone) < 1), "not through the one taken out");
      assert.equal(drawnIntervals(s.segments).length, 1, "still one drawn stretch");
      assert.ok(e.drawnMeters < chainRun({ points: [P1, P2, P3], ...chainJoins(LINE, BEFORE, [P1, P2, P3]) }).drawnMeters);
    });
  }

  test("moving a chain point: only its two straight legs change, nothing routed", () => {
    const { out, places } = committed();
    const moved = off(P2, 120, 80);
    const after = { ...places, vias: places.vias.map((v, k) => (k === 1 ? { ...v, lat: moved[1], lon: moved[0] } : v)) };
    const e = chainEdit({ segments: out.segments, before: places, after });
    assert.ok(e && e.kind === "reform");
    assert.equal(e.plan.kind, "move-stop");
    const s = apply(out.segments, e);
    const d = s.segments.features.filter((f) => f.properties.drawn);
    const before = out.segments.features.filter((f) => f.properties.drawn);
    assert.equal(d.length, 4);
    assert.deepEqual(d[0].geometry.coordinates, before[0].geometry.coordinates, "the way in is as it was");
    assert.deepEqual(d[3].geometry.coordinates, before[3].geometry.coordinates, "the way out is as it was");
    assert.deepEqual(d[1].geometry.coordinates.at(-1), moved);
    assert.deepEqual(d[2].geometry.coordinates[0], moved);
  });

  test("removing the only point left: the drawn stretch goes and the legs round it are joined by roads", () => {
    const { out, places } = committed();
    // Two taken out in turn: a chain of one.
    const e1 = chainEdit({ segments: out.segments, before: places, after: without(places, 0) });
    assert.ok(e1 && e1.kind === "reform");
    const s1 = apply(out.segments, e1);
    const one = without(without(places, 0), 0);
    const e2 = chainEdit({ segments: s1.segments, before: without(places, 0), after: one });
    assert.ok(e2 && e2.kind === "reform");
    const s2 = apply(s1.segments, e2);
    assert.equal(chainsOf(s2.segments, one)[0].vias.length, 1);
    const e3 = chainEdit({ segments: s2.segments, before: one, after: without(one, 0) });
    assert.ok(e3 && e3.kind === "rejoin", "a plain removal, routed by roads");
    assert.equal(e3.plan.kind, "remove-stop");
    const run = e3.plan.runs[0];
    const tot = lineMeters(s2.coordinates);
    assert.ok(run.fromMeters < 1 && run.toMeters > tot - 1, "from the kept place before to the one after");
    assert.equal(run.points.length, 2, "no place in between: the legs join");
    // Spliced with a road answer, nothing drawn is left.
    const road: RoutedRun = { segments: segs([run.points[0], run.points[1]]), distanceMeters: 1_000, durationSeconds: 60 };
    const back = applyRuns({ segments: s2.segments, distanceMeters: 10_000, durationSeconds: 3_600, runs: e3.plan.runs, routed: [road], keep: [] });
    assert.equal(drawnIntervals(back.segments).length, 0);
  });

  test("a change to no chain point is left to the ordinary plan", () => {
    const { out, places } = committed();
    const stop = place(at(TOTAL * 0.9), "S");
    const withStop = { ...places, vias: [...places.vias, stop] };
    assert.equal(chainEdit({ segments: out.segments, before: withStop, after: places }), null);
    assert.equal(chainEdit({ segments: segs(LINE), before: { ...BEFORE, vias: [stop] }, after: BEFORE }), null);
  });

  test("the page plans a chain point's change with `chainEdit` before `planEdit`", () => {
    const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
    assert.match(page, /const chained = chainEdit\(\{ segments: baseSegments, before, after: target\.after \}\);/);
    assert.match(page, /const planned = chained\?\.plan \?\? planEdit\(/);
    assert.match(page, /\.\.\.chainExtra, \.\.\.stacked \}\);/);
  });
}

