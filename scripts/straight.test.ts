/**
 * „Vest pa taisno” (rider, 2026-09-28): when no road reaches a point on any
 * profile, the ride goes as far as a road goes and then straight to it and
 * back — drawn geometry (`lib/routing/drawn.ts`, `lib/map/straight.ts`), the
 * design's `reach: "straight"` slice of Phase 2.
 *
 *   npx tsx --test scripts/straight.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, lineMeters, pointAtDistance } from "@/lib/routing/detour";
import { DRAWN_KMH, DENSIFY_M, connector, densify, drawnSeconds } from "@/lib/routing/drawn";
import { segmentSpeedKmh } from "@/lib/routing/speed";
import { drawnIntervals, straightRun } from "@/lib/map/straight";
import { applyRuns, coordinatesOf, nearestAlong, outAndBacks, planEdit, summariseSegments, type RidePlaces, type RoutedRun } from "@/lib/routing/reroute-leg";
import { decodeRouteShare, encodeRouteShare, sharedRouteSegments } from "@/lib/share/route-code";
import { messages } from "@/lib/i18n/messages";
import type { GeneratedRoute, RouteSegmentProperties } from "@/lib/types";

const FX = JSON.parse(readFileSync(new URL("./fixtures/gailisu-purvs-2026-09-28.json", import.meta.url), "utf8")) as { track: Point[] };
type Segs = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
const segs = (coords: Point[]): Segs => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { roadClass: "track", surface: "dirt", distanceMeters: Math.round(lineMeters(coords)) }, geometry: { type: "LineString", coordinates: coords } }] });
const LINE = FX.track.slice(0, 35); // up to the junction: no stub of its own
const CUM = cumulative(LINE);
const off = (p: Point, north: number, east: number): Point => [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
// A point 700 m into the forest beside the ride's middle.
const MID = pointAtDistance(LINE, CUM, CUM[CUM.length - 1] / 2).point as Point;
const LAKE = off(MID, 600, 360);

test("drawn geometry: densified to ≤ 50 m, trail|unknown|drawn, timed at 15 km/h", () => {
  const f = connector([24, 57], [24.02, 57.01]);
  assert.deepEqual([f.properties.roadClass, f.properties.surface, f.properties.drawn], ["trail", "unknown", true]);
  const c = f.geometry.coordinates as Point[];
  for (let i = 1; i < c.length; i++) assert.ok(haversineMeters(c[i - 1], c[i]) <= DENSIFY_M + 0.01);
  assert.ok(Math.abs(f.properties.distanceMeters - haversineMeters([24, 57], [24.02, 57.01])) < 1);
  assert.equal(densify([[24, 57], [24, 57]]).length, 2);
  assert.equal(segmentSpeedKmh(f.properties), DRAWN_KMH);
  assert.equal(drawnSeconds(15_000), 3600);
});

test("with no road nearer than the ride: straight from the ride's nearest point, and back along the same line", () => {
  const { run, routed, straightMeters, from } = straightRun({ line: LINE, point: LAKE });
  const near = nearestAlong(LAKE, LINE, CUM);
  assert.ok(Math.abs(straightMeters - near.meters) < 2, "the connector is the whole gap");
  assert.ok(haversineMeters(from, pointAtDistance(LINE, CUM, near.alongMeters).point) < 1);
  assert.equal(run.fromMeters, run.toMeters, "spliced in at one spot: nothing of the ride is thrown away");
  assert.deepEqual(run.points[1], LAKE);
  assert.ok(routed.segments.features.every((f) => f.properties.drawn));
  assert.equal(routed.durationSeconds, drawnSeconds(2 * straightMeters));
  const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [run], routed: [routed], keep: [LINE[0], LINE[LINE.length - 1]] });
  const c = out.coordinates;
  assert.ok(nearestAlong(LAKE, c, cumulative(c)).meters < 1, "the ride reaches the point exactly");
  const spurs = outAndBacks(c);
  assert.equal(spurs.length, 1, "one out-and-back: the deliberate straight one");
  assert.ok(Math.abs(spurs[0].meters - straightMeters) < 5);
  const sum = summariseSegments(out.segments, false);
  assert.ok(Math.abs(sum.drawnKm - (2 * straightMeters) / 1000) < 0.1, `drawn km ${sum.drawnKm}`);
  assert.ok(sum.roadMix.trailKm === 0, "drawn metres are not trail in the road mix");
});

test("with a road that goes nearer: along it as far as it goes, then straight", () => {
  // A track leaving the ride at the middle toward the point, ending 250 m short.
  const along = nearestAlong(LAKE, LINE, CUM).alongMeters;
  const start = pointAtDistance(LINE, CUM, along).point as Point;
  // …ending 250 m short of the point, on the way to it.
  const k = 1 - 250 / haversineMeters(start, LAKE);
  const end: Point = [start[0] + (LAKE[0] - start[0]) * k, start[1] + (LAKE[1] - start[1]) * k];
  const mid: Point = [(start[0] + end[0]) / 2 + 0.0005, (start[1] + end[1]) / 2];
  const road: RoutedRun = { segments: segs([start, mid, end]), distanceMeters: Math.round(lineMeters([start, mid, end])), durationSeconds: 120 };
  const { routed, straightMeters, from } = straightRun({ line: LINE, point: LAKE, road });
  assert.deepEqual(from, end);
  assert.ok(Math.abs(straightMeters - haversineMeters(end, LAKE)) < 1);
  const kinds = routed.segments.features.map((f) => (f.properties.drawn ? "drawn" : "road"));
  assert.deepEqual(kinds, ["road", "drawn", "drawn", "road"], "road out, straight there and back, road back");
  assert.equal(routed.distanceMeters, Math.round(2 * road.distanceMeters + 2 * straightMeters));
  // A road that ends no nearer than the ride is not used.
  const away: RoutedRun = { ...road, segments: segs([start, [start[0] - (LAKE[0] - start[0]) * 0.5, start[1] - (LAKE[1] - start[1]) * 0.5]]) };
  assert.ok(straightRun({ line: LINE, point: LAKE, road: away }).routed.segments.features.every((f) => f.properties.drawn));
});

test("a drawn stretch is a fixed interval: a later edit's window stops at it, and its point comes out whole", () => {
  const { run, routed } = straightRun({ line: LINE, point: LAKE });
  const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [run], routed: [routed], keep: [] });
  const line = coordinatesOf(out.segments);
  const cum = cumulative(line);
  const fixed = drawnIntervals(out.segments);
  assert.equal(fixed.length, 1);
  const join = pointAtDistance(LINE, CUM, run.fromMeters).point as Point;
  const place = (p: Point, name: string, extra: object = {}) => ({ name, label: name, lat: p[1], lon: p[0], ...extra });
  const straightPoint = place(LAKE, "", { shape: true, reach: "straight", joins: [join, join] });
  const before: RidePlaces = { start: place(line[0], "A"), vias: [straightPoint as never], finish: place(line[line.length - 1], "B"), roundTrip: false };
  // A stop added 300 m before the drawn stretch: its window ends where the drawn stretch begins.
  const stopAt = pointAtDistance(line, cum, fixed[0][0] - 300).point as Point;
  const added = place(off(stopAt, 60, 0), "C");
  const p = planEdit({ line, cum, before, after: { ...before, vias: [added, ...before.vias] }, fixed });
  assert.ok(p && !("error" in p), JSON.stringify(p));
  assert.ok(p!.runs[0].toMeters <= fixed[0][0] + 1, `stops at the drawn stretch: ${Math.round(p!.runs[0].toMeters)} vs ${Math.round(fixed[0][0])}`);
  // Taking the straight point out takes its whole stretch out, nothing routed.
  const r = planEdit({ line, cum, before, after: { ...before, vias: [] }, fixed });
  assert.ok(r && !("error" in r), JSON.stringify(r));
  assert.equal(r!.kind, "remove-stop", JSON.stringify(r!.runs));
  assert.equal(r!.runs[0].drop, true, JSON.stringify(r!.runs.map((x) => [x.fromMeters, x.toMeters, x.drop])));
  assert.ok(r!.runs[0].fromMeters <= fixed[0][0] + 1 && r!.runs[0].toMeters >= fixed[0][1] - 1, JSON.stringify({ run: [r!.runs[0].fromMeters, r!.runs[0].toMeters], fixed }));
  const back = applyRuns({ segments: out.segments, distanceMeters: out.distanceMeters, durationSeconds: out.durationSeconds, runs: r!.runs, routed: [{ segments: { type: "FeatureCollection", features: [] }, distanceMeters: 0, durationSeconds: 0 }], keep: [] });
  assert.ok(Math.abs(lineMeters(back.coordinates) - lineMeters(LINE)) < 5, "the ride as it was");
  assert.equal(summariseSegments(back.segments, false).drawnKm, 0);
});

test("the share code carries drawn stretches as trail|unknown|d with dk; a ride without keeps its code", () => {
  const { run, routed } = straightRun({ line: LINE, point: LAKE });
  const out = applyRuns({ segments: segs(LINE), distanceMeters: Math.round(lineMeters(LINE)), durationSeconds: 3_600, runs: [run], routed: [routed], keep: [] });
  const base = { name: "T", variant: "direct", distanceMeters: out.distanceMeters, durationSeconds: out.durationSeconds, surfaces: { asphaltPercent: 0, gravelPercent: 0, dirtPercent: 100, unknownPercent: 0 }, overlap: { repeatedKm: 0, distinctKm: 1, repeatedPercent: 0 }, roadMix: { roadPercent: 0, trackPercent: 100, trailPercent: 0, roadKm: 0, trackKm: 1, trailKm: 0 }, quality: { forestKm: 0, riversideKm: 0, ruralOpenKm: 0, unverifiedPathKm: 0, roughTrackKm: 0, sandKm: 0, streetKm: 0, coastKm: 0 } };
  const withDrawn = { ...base, geometry: { type: "LineString", coordinates: out.coordinates }, segments: out.segments } as unknown as GeneratedRoute;
  const code = encodeRouteShare(withDrawn, "A");
  const meta = JSON.parse(Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.ok(meta.d.includes("trail|unknown|d"));
  assert.ok(meta.dk > 0);
  const share = decodeRouteShare(code)!;
  assert.ok(Math.abs(share.drawnKm - meta.dk) < 1e-9);
  assert.ok(sharedRouteSegments(share).features.some((f) => f.properties.drawn), "the shared map draws it as drawn");
  const plain = { ...base, geometry: { type: "LineString", coordinates: LINE }, segments: segs(LINE) } as unknown as GeneratedRoute;
  const plainMeta = JSON.parse(Buffer.from(encodeRouteShare(plain, "A").split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  assert.equal(plainMeta.dk, undefined);
  assert.equal(decodeRouteShare(encodeRouteShare(plain, "A"))!.drawnKm, 0);
});

test("the flow: no road on any rung → the guidance line and „Vest pa taisno”; the chip proposes, ✓ commits", () => {
  const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
  const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
  assert.match(page, /return askStraight\(token, planned\.kind, fi\(ui\.editNoRoadStraight, \{ m: Math\.round\(bestOff\) \}\), p\.change, level\);/);
  assert.match(page, /proposePlaces\(ask\.change, \{ straight: ask\.level \}\);/);
  assert.match(page, /onStraight: straightOffered \? acceptStraight : undefined,/);
  assert.match(composer, /else if \("straight" in act\) edit\?\.onStraight\?\.\(\);/);
  // A straight proposal is an ordinary one: no „Tomēr braukt” for leaving the profile.
  assert.match(page, /rung && outsideM > 0 && !straight \? "profile"/);
  // Later edits: drawn stretches are fixed.
  assert.match(page, /fixed: drawnIntervals\(baseSegments\)/);
});

test("the map: drawn has its own style, no badges, and the class layers leave it out", () => {
  const map = readFileSync(new URL("../components/route-map.tsx", import.meta.url), "utf8");
  for (const rc of ["road", "track", "trail"]) assert.ok(map.includes(`filter: ["all", ["==", ["get", "roadClass"], "${rc}"], ["!=", ["get", "drawn"], true]],`), rc);
  assert.match(map, /id: "route-drawn",[\s\S]*?filter: \["==", \["get", "drawn"\], true\]/);
  assert.match(map, /id: "route-drawn-dash",[\s\S]*?"line-dasharray"/);
  assert.match(map, /if \(props\.drawn\) return out;/);
  assert.match(map, /\{m\.legendDrawn\}/);
});

test("the copy: four languages, en dashes, the rider's words", () => {
  const lv = messages("lv");
  assert.equal(lv.editNoRoadStraight.replace("{m}", "340"), "Pa ceļu šeit nevar izbraukt, tuvākais ceļš ir ~340 m nostāk.");
  assert.equal(lv.guideRefusedStraight, "spied „Vest pa taisno” vai ✕ atmet.");
  assert.equal(lv.editStraightNote.replace("{m}", "340").replace("{name}", "Caurbraucams punkts"), "Pēdējie 340 m līdz „Caurbraucams punkts” – taisni, bez ceļa, un atpakaļ pa to pašu līniju.");
  assert.equal(lv.legendDrawn, "Zīmēts taisni");
  assert.equal(lv.panelDrawn.replace("{km}", "0,7"), "Zīmēti posmi: 0,7 km · laiks rēķināts ar 15 km/h · Mopik nav pārbaudījis, vai tur var izbraukt un vai tas ir atļauts.");
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    const m = messages(locale);
    for (const k of ["editNoRoadStraight", "editStraightAccept", "editStraightNote", "editStraightRisk", "legendDrawn", "panelDrawn"] as const) {
      assert.ok(m[k]?.length > 1, `${locale}.${k}`);
      assert.ok(!/ - /.test(m[k]), `${locale}.${k}: en dash`);
    }
  }
});
