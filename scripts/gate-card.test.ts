/**
 * The gate card — one gate's OSM facts, carried from the published file to the
 * card the rider taps.
 *
 * `npx tsx --test scripts/gate-card.test.ts`
 *
 * The rider's rule is the one `gates.test.ts` holds: no guessing. So every
 * test here checks that a line appears only for a fact the file states — a
 * kind from `barrier=*`, an access line only where `access=*` is tagged, a
 * link only where the node id is known — and that a file or a saved ride from
 * before any of it still shows its gates, just without those lines.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { BARRIER_KINDS, GATE_HIGHWAYS, bboxOf, gateLookup, resetGateCache } from "@/lib/geo/gates";
import { classifyRoute } from "@/lib/routing/classify";
import { segmentsBetween } from "@/lib/routing/reroute-leg";
import { gatesAlong, gateHighlightLine, osmNodeUrl, type GateOnRide } from "@/lib/map/gates-along";
import { gateAccessLabel, gateAtLabel, gateCardHtml, gateGlyphFor, gateIconSvg, gateKindLabel, gateKm } from "@/components/gate-card";
import { messages } from "@/lib/i18n/messages";
import { UI_LOCALES } from "@/lib/i18n/locale";
import { haversineMeters } from "@/lib/geo/geometry";
import { decodeRouteShare, encodeRouteShare } from "@/lib/share/route-code";
import { enrich } from "./enrich-gates-osm";
import type { GeneratedRoute, RoutePath } from "@/lib/types";

const LAT = 56.6;
const LON = 24.18;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const at = (east: number, north: number): [number, number] => [LON + east / M_PER_DEG_LON, LAT + north / M_PER_DEG_LAT];

type Row = (number | undefined)[];

/** Publish a gate file in a temp cwd — raw rows, so both row shapes can be written. */
async function withGateFile<T>(rows: Row[], accessKinds: string[] | undefined, run: () => T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-card-test-"));
  const out = path.join(dir, "public", "gates");
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "XX.json"), JSON.stringify({
    country: "XX", barrierKinds: [...BARRIER_KINDS], highwayKinds: [...GATE_HIGHWAYS],
    ...(accessKinds ? { accessKinds } : {}), gates: rows,
  }));
  const cell = `${Math.floor(LON / 0.25)},${Math.floor(LAT / 0.25)}`;
  fs.writeFileSync(path.join(out, "index.json"), JSON.stringify({
    version: 1, source: "geofabrik", cellDegrees: 0.25,
    countries: [{ cc: "XX", count: rows.length, byBarrier: {}, byHighway: {}, bbox: [LON - 0.1, LAT - 0.1, LON + 0.1, LAT + 0.1], cells: [cell], builtAt: "", bytes: 0 }],
  }));
  const cwd = process.cwd();
  process.chdir(dir);
  resetGateCache();
  try {
    return run();
  } finally {
    process.chdir(cwd);
    resetGateCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const B = (k: (typeof BARRIER_KINDS)[number]) => BARRIER_KINDS.indexOf(k);
const TRACK = GATE_HIGHWAYS.indexOf("track");

function straightTrack(steps: number): RoutePath {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) coordinates.push(at(i * 50, 0));
  return {
    distanceMeters: steps * 50, durationSeconds: steps * 5, coordinates,
    edges: [{ beginShapeIndex: 0, endShapeIndex: steps, use: "track", tags: { highway: "track" } }],
  };
}

// --- the loader --------------------------------------------------------------

test("a six-element row gives the node id and access; -1 is no access; four elements is neither", async () => {
  const rows: Row[] = [
    [...at(100, 0), B("lift_gate"), TRACK, 123456789, 0],
    [...at(200, 0), B("gate"), TRACK, 987654321, -1],
    [...at(300, 0), B("chain"), TRACK],
  ];
  await withGateFile(rows, ["private"], () => {
    const lookup = gateLookup(bboxOf([at(0, 0), at(400, 0)]));
    const a = lookup.gateAt(at(100, 0)[1], at(100, 0)[0], 1.5)!;
    assert.equal(a.barrier, "lift_gate");
    assert.equal(a.id, 123456789);
    assert.equal(a.access, "private");
    const b = lookup.gateAt(at(200, 0)[1], at(200, 0)[0], 1.5)!;
    assert.equal(b.id, 987654321);
    assert.equal(b.access, undefined, "OSM tags no access: the card says nothing about it");
    const c = lookup.gateAt(at(300, 0)[1], at(300, 0)[0], 1.5)!;
    assert.equal(c.barrier, "chain");
    assert.equal("id" in c, false, "a file built before ids: no id, never a made-up one");
    assert.equal("access" in c, false);
  });
});

// --- through classify and the edit splitter -------------------------------------

test("classify carries each gate's facts on the segment, index for index with gatePoints", async () => {
  const rows: Row[] = [
    [...at(300, 0), B("lift_gate"), TRACK, 111, 1],
    [...at(600, 0), B("gate"), TRACK],
  ];
  const { segments, quality } = await withGateFile(rows, ["no", "permissive"], () => classifyRoute(straightTrack(20)));
  assert.equal(quality.gateCount, 2);
  const f = segments.features.find((x) => (x.properties?.gates ?? 0) > 0)!;
  assert.equal(f.properties.gatePoints?.length, 2);
  assert.deepEqual(f.properties.gateInfo, [
    { barrier: "lift_gate", id: 111, access: "permissive" },
    { barrier: "gate" },
  ]);
});

test("an edit that keeps half a stretch keeps the matching gates' facts", async () => {
  const rows: Row[] = [
    [...at(300, 0), B("lift_gate"), TRACK, 111, 0],
    [...at(700, 0), B("chain"), TRACK, 222, -1],
  ];
  const { segments } = await withGateFile(rows, ["private"], () => classifyRoute(straightTrack(20)));
  const kept = segmentsBetween(segments.features, 500, 1000);
  const f = kept.find((x) => (x.properties?.gates ?? 0) > 0)!;
  assert.equal(f.properties.gates, 1);
  assert.deepEqual(f.properties.gateInfo, [{ barrier: "chain", id: 222 }]);
});

// --- the kilometre ------------------------------------------------------------

test("a gate's position is the ride's length up to its vertex, across segments", () => {
  const line: [number, number][] = [];
  for (let i = 0; i <= 40; i++) line.push(at(i * 1000, 0));
  const first = line.slice(0, 21);
  const second = line.slice(20);
  const features = [
    { geometry: { coordinates: first }, properties: {} },
    { geometry: { coordinates: second }, properties: { gatePoints: [line[37]], gateInfo: [{ barrier: "gate" }] } },
  ];
  const [g] = gatesAlong(features);
  const expected = haversineMeters(line[0], line[37]);
  assert.ok(Math.abs(g.alongMeters - expected) < 1, `${g.alongMeters} vs ${expected}`);
  assert.equal(g.segmentIndex, 1);
  assert.equal(gateKm("lv", 37200), "37,2");
  assert.equal(gateKm("en", 37200), "37.2");
  assert.equal(gateKm("lv", 37000), "37,0", "a position keeps its decimal");
});

test("the highlight is ~50 m of line round the gate, not the stretch", () => {
  const line: [number, number][] = [];
  for (let i = 0; i <= 40; i++) line.push(at(i * 50, 0));
  const features = [{ geometry: { coordinates: line.slice(0, 21) } }, { geometry: { coordinates: line.slice(20) } }];
  const cut = gateHighlightLine(features, 1000);
  let len = 0;
  for (let i = 1; i < cut.length; i++) len += haversineMeters(cut[i - 1], cut[i]);
  assert.ok(Math.abs(len - 50) < 0.5, `${len} m`);
  // Near the start there is only what the ride has.
  const early = gateHighlightLine(features, 10);
  let e = 0;
  for (let i = 1; i < early.length; i++) e += haversineMeters(early[i - 1], early[i]);
  assert.ok(Math.abs(e - 35) < 0.5, `${e} m`);
});

// --- the card -------------------------------------------------------------------

const lv = messages("lv");
const gate = (info?: GateOnRide["info"]): GateOnRide => ({ point: at(0, 0), alongMeters: 37_240, segmentIndex: 0, ...(info ? { info } : {}) });

test("every barrier kind has a name in every language, and Latvian names the rider's", () => {
  assert.equal(gateKindLabel(lv, "gate"), "Vārti");
  assert.equal(gateKindLabel(lv, "lift_gate"), "Barjera ar pacēlāju");
  assert.equal(gateKindLabel(lv, "chain"), "Ķēde");
  assert.equal(gateKindLabel(lv, undefined), lv.resGatesRow, "no kind known: the generic word, not a guess");
  for (const locale of UI_LOCALES) {
    const m = messages(locale);
    const names = BARRIER_KINDS.map((k) => gateKindLabel(m, k));
    assert.equal(new Set(names).size, names.length, `${locale}: each kind its own word`);
    for (const n of names) assert.ok(n && n !== m.resGatesRow, `${locale}: ${n}`);
  }
  for (const [k, v] of Object.entries(lv)) assert.ok(!/piesit/i.test(v), `lv ${k} says "piesit"`);
});

test("access in plain words; an unknown value verbatim; none means no line", () => {
  assert.equal(gateAccessLabel(lv, "private"), lv.gateAccessPrivate);
  assert.equal(gateAccessLabel(lv, "no"), lv.gateAccessNo);
  assert.equal(gateAccessLabel(lv, "permissive"), lv.gateAccessPermissive);
  assert.equal(gateAccessLabel(lv, "official"), "OSM piekļuve: official");
  assert.equal(gateAccessLabel(lv, undefined), null);
});

test("the card for each combination of facts shows exactly those facts", () => {
  const full = gateCardHtml(lv, "lv", gate({ barrier: "lift_gate", id: 42, access: "private" }));
  assert.match(full, /Barjera ar pacēlāju/);
  assert.match(full, /37,2 km no starta/);
  assert.match(full, new RegExp(lv.gateAccessPrivate));
  assert.match(full, /href="https:\/\/www\.openstreetmap\.org\/node\/42"/);
  assert.match(full, /Skatīt OSM/);

  const noAccess = gateCardHtml(lv, "lv", gate({ barrier: "gate", id: 42 }));
  assert.match(noAccess, /Vārti/);
  for (const k of Object.keys(lv).filter((k) => k.startsWith("gateAccess") && k !== "gateAccessRaw")) {
    assert.ok(!noAccess.includes(lv[k as keyof typeof lv]), `no access tag, yet "${k}" shown`);
  }
  assert.ok(!noAccess.includes("OSM piekļuve"));

  const noId = gateCardHtml(lv, "lv", gate({ barrier: "chain", access: "no" }));
  assert.match(noId, /Ķēde/);
  assert.match(noId, new RegExp(lv.gateAccessNo));
  assert.ok(!noId.includes("openstreetmap.org"), "no id, no link");

  const saved = gateCardHtml(lv, "lv", gate());
  assert.match(saved, new RegExp(lv.resGatesRow));
  assert.match(saved, /37,2 km no starta/);
  assert.ok(!saved.includes("<a "));

  // A tag value is data, never markup.
  const odd = gateCardHtml(lv, "lv", gate({ barrier: "gate", access: "<b>x</b>" }));
  assert.ok(!odd.includes("<b>x</b>"));
  assert.equal(osmNodeUrl(7), "https://www.openstreetmap.org/node/7");
});

test("a list row names the gate by kind and kilometre", () => {
  assert.equal(gateAtLabel(lv, "lv", gate({ barrier: "gate" })), "Vārti 37,2 km");
  assert.equal(gateAtLabel(messages("en"), "en", gate({ barrier: "lift_gate" })), "Boom barrier 37.2 km");
});

// --- the share code ---------------------------------------------------------------

test("the share code does not change: gate facts stay out of it, old codes decode as before", () => {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 60; i++) coords.push([24.39 + i * 0.0006, 56.74]);
  const seg = (from: number, to: number, extra: object) => ({
    type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: coords.slice(from, to + 1) },
    properties: { roadClass: "track" as const, surface: "gravel" as const, distanceMeters: 1000, ...extra },
  });
  const route = (extra: object): GeneratedRoute => ({
    id: "x", name: "Vangaži", geometry: { type: "LineString", coordinates: coords },
    segments: { type: "FeatureCollection", features: [seg(0, 30, {}), seg(30, 60, extra)] },
    distanceMeters: 3200, durationSeconds: 5400, roadMix: {} as GeneratedRoute["roadMix"],
    surfaces: { asphaltPercent: 30, gravelPercent: 50, dirtPercent: 10, unknownPercent: 10 },
    quality: { gateCount: 1 } as GeneratedRoute["quality"], overlap: { repeatedKm: 0, distinctKm: 3, repeatedPercent: 0 },
    profile: "moto", sourcePrompt: "", variant: "complex",
  });
  const before = encodeRouteShare(route({ gates: 1, gatePoints: [coords[40]] }), "Vangaži");
  const after = encodeRouteShare(route({ gates: 1, gatePoints: [coords[40]], gateInfo: [{ barrier: "gate", id: 1, access: "private" }] }), "Vangaži");
  assert.equal(after, before, "same bytes: an old link and a new one are one format");
  assert.deepEqual(decodeRouteShare(after), decodeRouteShare(before));
  assert.equal(decodeRouteShare(before)?.details?.gateCount, 1);
});

// --- the enrichment script ----------------------------------------------------

test("enrichment adds an id only for exactly one node of the same kind at the spot", () => {
  const [lon, lat] = at(0, 0);
  const [lon2, lat2] = at(500, 0);
  const [lon3, lat3] = at(900, 0);
  const file = {
    barrierKinds: [...BARRIER_KINDS],
    gates: [
      [lon, lat, B("gate"), TRACK],
      [lon2, lat2, B("gate"), TRACK],
      [lon3, lat3, B("chain"), TRACK],
    ] as [number, number, number, number][],
  };
  const nodes: Parameters<typeof enrich>[1] = [
    { type: "node", id: 1, lon: lon + 0.000005, lat, tags: { barrier: "gate", access: "private" } },
    // Two gates at one spot: ambiguous, left alone.
    { type: "node", id: 2, lon: lon2, lat: lat2, tags: { barrier: "gate" } },
    { type: "node", id: 3, lon: lon2, lat: lat2 + 0.000005, tags: { barrier: "gate" } },
    // Retagged since the build: not the same fact, left alone.
    { type: "node", id: 4, lon: lon3, lat: lat3, tags: { barrier: "lift_gate" } },
  ];
  const out = enrich(file, nodes);
  assert.equal(out.matched, 1);
  assert.equal(out.ambiguous, 1);
  assert.deepEqual(out.file.gates![0].slice(4), [1, 0]);
  assert.equal(out.file.accessKinds![0], "private");
  assert.equal(out.file.gates![1].length, 4);
  assert.equal(out.file.gates![2].length, 4);
});

// --- the glyphs ---------------------------------------------------------------

test("a boom barrier for lift_gate and chain, a field gate for the rest and for unknown", () => {
  assert.equal(gateGlyphFor("lift_gate"), "boom");
  assert.equal(gateGlyphFor("chain"), "boom");
  for (const b of ["gate", "swing_gate", "bollard", "cattle_grid", "something_new", undefined]) {
    assert.equal(gateGlyphFor(b), "field", String(b));
  }
  // Inline SVG, no emoji and no external asset, and the card heads with it.
  for (const g of ["boom", "field"] as const) {
    const svg = gateIconSvg(g, 14);
    assert.match(svg, /^<svg [^>]*viewBox="0 0 14 14" width="14" height="14"/);
    assert.ok(!/href|url\(|🚪/.test(svg));
  }
  assert.notEqual(gateIconSvg("boom"), gateIconSvg("field"));
  assert.ok(gateCardHtml(lv, "lv", gate({ barrier: "chain" })).includes(gateIconSvg("boom", 16)));
  assert.ok(gateCardHtml(lv, "lv", gate({ barrier: "gate" })).includes(gateIconSvg("field", 16)));
  assert.ok(!gateCardHtml(lv, "lv", gate({ barrier: "gate" })).includes("🚪"));
});
