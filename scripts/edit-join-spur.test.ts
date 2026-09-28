/**
 * The rider's spur of 2026-09-28, on his own geometry: „while editing the
 * map, the spur problem shows up again”.
 *
 *   npx tsx --test scripts/edit-join-spur.test.ts
 *
 * His GPX (Antiņciems → Puķes → Rīgas apvedceļš, edited on the map) rides a
 * forest track south-east past Gailīšu purvs, turns up a side track at a
 * junction, rides 1.17 km north-east to a point in the middle of that track,
 * and comes back down the same 1.17 km — 2.34 km retraced, with NO place at
 * the tip: none of the ride's seven route points is within 2 km of it. The
 * track goes on north from the tip (BRouter, production, the ride's profile).
 * A tip in the middle of a through track with nothing there is a cut: the
 * edit window ended on the old line, which came down that track, and the new
 * stretch — which reached the old line at the junction below — was pinned to
 * the cut and rode up to it (`retraceAtJoins`).
 *
 * The second half pins the other way a bend made a spur (measured on real
 * rides against production BRouter, `scratch` sweep of 2026-09-28): the two
 * legs of a bend reached it at points 208-618 m apart, the stretch fell back
 * to one request, and that request rode out to the bend and back unchecked
 * (`routeThroughPlaces`). BRouter is stubbed there with a small graph of the
 * same two tracks, so the test pins which way the stretch is ridden, not
 * whatever the live router says today.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.BROUTER_BASE_URL ||= "http://brouter.test";

import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, lineMeters } from "@/lib/routing/detour";
import {
  applyRuns,

  nearestAlong,
  outAndBacks,
  recomputeOverlap,
  throughBlockedPlaces,
  type RidePlaces,
  type RoutedRun,
} from "@/lib/routing/reroute-leg";
import { routeThroughPlaces } from "@/lib/routing/through-stops";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";

const FX = JSON.parse(readFileSync(new URL("./fixtures/gailisu-purvs-2026-09-28.json", import.meta.url), "utf8")) as {
  track: Point[];
  index: { corner: number; junction: number; tip: number; backAtJunction: number; puķes: number };
  north: Point[];
  rte: Point[];
};
const T = FX.track;
const I = FX.index;
const TIP = T[I.tip];
const JUNCTION = T[I.junction];

type Segs = RoutedRun["segments"];
const segs = (coords: Point[]): Segs => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", properties: { roadClass: "track", surface: "gravel", distanceMeters: Math.round(lineMeters(coords)) } as never, geometry: { type: "LineString", coordinates: coords } }],
});
const routedOf = (coords: Point[]): RoutedRun => ({ segments: segs(coords), distanceMeters: Math.round(lineMeters(coords)), durationSeconds: Math.round(lineMeters(coords) / 10) });

/**
 * The line before the bend, as it must have been: kept as far as the track
 * before the corner, then (thrown away by the edit) out to the north and down
 * the side track, through the tip, to the junction, and on south-east to
 * Puķes — his ride from the junction on.
 */
const PREFIX = T.slice(0, 11); // gpx 880-890, kept
const OLD_MIDDLE: Point[] = [...[...FX.north].reverse().slice(0, -1)]; // north end → just above the tip
const KEPT_TAIL: Point[] = [TIP, ...T.slice(I.junction, I.tip).reverse(), ...T.slice(I.backAtJunction + 1)]; // tip → junction → Puķes
const OLD_LINE: Point[] = [...PREFIX, ...OLD_MIDDLE, ...KEPT_TAIL];
const OLD_CUM = cumulative(OLD_LINE);
const CUT_FROM = nearestAlong(PREFIX[PREFIX.length - 1], OLD_LINE, OLD_CUM).alongMeters;
const CUT_TO = nearestAlong(TIP, OLD_LINE, OLD_CUM, CUT_FROM + 1).alongMeters;
/** What the router drew for the bend: the corner, the dashed track to the junction, and up to the pinned cut. */
const ROUTED: Point[] = T.slice(10, I.tip + 1);
const BEND: Point = T[I.corner];

const place = (p: Point, name: string, shape = false) => ({ name, label: name, lat: p[1], lon: p[0], ...(shape ? { shape: true as const } : {}) });

test("the fixture: the rider's GPX has the 1.17 km out-and-back, and nothing at its tip", () => {
  const found = outAndBacks(T);
  assert.equal(found.length, 1, `one spur, got ${JSON.stringify(found)}`);
  assert.ok(Math.abs(found[0].meters - 1_170) < 30, `1.17 km each way, got ${Math.round(found[0].meters)}`);
  assert.ok(haversineMeters(T[found[0].apex], TIP) < 5, "its tip is the point up the side track");
  assert.ok(Math.min(...FX.rte.map((r) => haversineMeters(r, TIP))) > 2_000, "no route point within 2 km of the tip");
});

test("a stretch pinned to a cut up a side track joins the kept ride at the junction instead — no stub", () => {
  const out = applyRuns({
    segments: segs(OLD_LINE),
    distanceMeters: Math.round(lineMeters(OLD_LINE)),
    durationSeconds: 3_600,
    runs: [{ fromMeters: CUT_FROM, toMeters: CUT_TO, points: [PREFIX[PREFIX.length - 1], BEND, TIP] }],
    routed: [routedOf(ROUTED)],
    keep: [OLD_LINE[0], OLD_LINE[OLD_LINE.length - 1]],
  });
  const stubs = outAndBacks(out.coordinates);
  assert.deepEqual(stubs, [], `no out-and-back left, got ${JSON.stringify(stubs.map((s) => Math.round(s.meters)))}`);
  assert.equal(recomputeOverlap(out.coordinates).repeatedKm, 0, "nothing ridden twice");
  // Joined where the new stretch reached the old line: the junction.
  const cum = cumulative(out.coordinates);
  assert.ok(nearestAlong(JUNCTION, out.coordinates, cum).meters < 10, "the line passes the junction");
  assert.ok(nearestAlong(TIP, out.coordinates, cum).meters > 1_000, "and never goes up to the tip");
  assert.ok(Math.abs(out.runs[0].toMeters - (CUT_TO + 1_170)) < 40, `the kept ride now starts 1.17 km on, got ${Math.round(out.runs[0].toMeters - CUT_TO)} m`);
  // The 2.34 km of stub are gone from the distance too.
  const withStub = lineMeters(PREFIX) + lineMeters(ROUTED) + lineMeters(KEPT_TAIL);
  assert.ok(withStub - lineMeters(out.coordinates) > 2_250, `about 2.34 km shorter, got ${Math.round(withStub - lineMeters(out.coordinates))} m`);
  assert.deepEqual(out.blocked, [{ head: 0, tail: 0 }]);
});

test("the join never slides past a place on the kept ride", () => {
  // A stop half-way down the side track: the kept ride must still reach it.
  const stop = T[I.junction + 2];
  const out = applyRuns({
    segments: segs(OLD_LINE),
    distanceMeters: Math.round(lineMeters(OLD_LINE)),
    durationSeconds: 3_600,
    runs: [{ fromMeters: CUT_FROM, toMeters: CUT_TO, points: [PREFIX[PREFIX.length - 1], BEND, TIP] }],
    routed: [routedOf(ROUTED)],
    keep: [OLD_LINE[0], stop, OLD_LINE[OLD_LINE.length - 1]],
  });
  assert.ok(nearestAlong(stop, out.coordinates, cumulative(out.coordinates)).meters < 5, "the stop is still on the line");
  assert.ok(out.blocked[0].tail > 1_000, "and the retrace is reported, not hidden");
});

test("a cut AT a stop is not slid: the stretch is routed again through the stop and on", () => {
  // The same geometry with a stop at the tip: the window stopped on it.
  const before: RidePlaces = {
    start: place(OLD_LINE[0], "Starts"),
    vias: [place(TIP, "Pietura")],
    finish: place(OLD_LINE[OLD_LINE.length - 1], "Finišs"),
    roundTrip: false,
  };
  const runs = [{ fromMeters: CUT_FROM, toMeters: CUT_TO, points: [PREFIX[PREFIX.length - 1], BEND, TIP] }];
  const out = applyRuns({
    segments: segs(OLD_LINE), distanceMeters: Math.round(lineMeters(OLD_LINE)), durationSeconds: 3_600,
    runs, routed: [routedOf(ROUTED)], keep: [OLD_LINE[0], TIP, OLD_LINE[OLD_LINE.length - 1]],
  });
  assert.ok(Math.abs(out.runs[0].toMeters - CUT_TO) < 1, "the cut stays at the stop");
  assert.ok(out.blocked[0].tail > 1_000, "the stop left at the tip of a spur is reported");
  const through = throughBlockedPlaces({ line: OLD_LINE, cum: OLD_CUM, before, runs, blocked: out.blocked });
  assert.ok(through, "a second stretch is proposed");
  const run = through![0];
  assert.equal(run.points.length, 4, "join → bend → the stop → a join past it");
  assert.deepEqual(run.points[2], TIP);
  assert.ok(Math.abs(run.toMeters - (CUT_TO + 1_000)) < 2, `1 km past the stop, got ${Math.round(run.toMeters - CUT_TO)}`);
});

test("a join where the new stretch simply rides on is left exactly where it was", () => {
  const line = T.slice(0, I.junction + 1);
  const cum = cumulative(line);
  const from = cum[5], to = cum[25];
  const out = applyRuns({
    segments: segs(line), distanceMeters: Math.round(lineMeters(line)), durationSeconds: 600,
    runs: [{ fromMeters: from, toMeters: to, points: [line[5], line[15], line[25]] }],
    routed: [routedOf(line.slice(5, 26))],
    keep: [line[0], line[line.length - 1]],
  });
  assert.ok(Math.abs(out.runs[0].fromMeters - from) < 1 && Math.abs(out.runs[0].toMeters - to) < 1);
  assert.ok(Math.abs(lineMeters(out.coordinates) - lineMeters(line)) < 1);
});

// ── The bend itself: a stub BRouter over the two tracks ──

/** The through track (corner → junction → on south-east) and the side track (junction → tip → north, a dead end here). */
const THROUGH: Point[] = [...T.slice(I.corner - 2, I.junction + 1), ...T.slice(I.backAtJunction + 1, I.puķes + 1)];
const SIDE: Point[] = [...T.slice(I.junction, I.tip + 1), ...FX.north.slice(1)];

function graph() {
  const nodes: Point[] = [];
  const key = (p: Point) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
  const at = new Map<string, number>();
  const adj: number[][] = [];
  const id = (p: Point) => {
    const k = key(p);
    if (!at.has(k)) { at.set(k, nodes.length); nodes.push(p); adj.push([]); }
    return at.get(k)!;
  };
  for (const way of [THROUGH, SIDE]) {
    for (let i = 1; i < way.length; i++) {
      const a = id(way[i - 1]), b = id(way[i]);
      if (a === b) continue;
      adj[a].push(b); adj[b].push(a);
    }
  }
  return { nodes, adj };
}
const G = graph();
const nearestNode = (p: Point, skip: Set<number>) => {
  let best = -1, d = Infinity;
  G.nodes.forEach((n, i) => { if (skip.has(i)) return; const m = haversineMeters(n, p); if (m < d) { d = m; best = i; } });
  return best;
};
function shortest(a: number, b: number, banned: Set<number>): number[] | null {
  const dist = G.nodes.map(() => Infinity), prev = G.nodes.map(() => -1), done = new Set<number>();
  dist[a] = 0;
  while (true) {
    let u = -1;
    dist.forEach((d, i) => { if (!done.has(i) && d < Infinity && (u < 0 || d < dist[u])) u = i; });
    if (u < 0) return null;
    if (u === b) break;
    done.add(u);
    for (const v of G.adj[u]) {
      if (banned.has(v) && v !== b) continue;
      const nd = dist[u] + haversineMeters(G.nodes[u], G.nodes[v]);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; }
    }
  }
  const out = [b];
  while (out[0] !== a) out.unshift(prev[out[0]]);
  return out;
}

/**
 * BRouter over `G`: each waypoint to its nearest node, legs by shortest path,
 * no-go circles honoured. `shift(points, i)` may move where a waypoint lands —
 * the way a real start is nudged or snapped to another way than its end.
 */
function stubBrouter(shift: (pts: Point[], i: number) => number | null) {
  const asked: Point[][] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(typeof input === "object" && "url" in input ? input.url : input);
    if (url.includes("/brouter/profile")) return new Response(JSON.stringify({ profileid: "stub" }), { status: 200 });
    const pts = decodeURIComponent(/lonlats=([^&]*)/.exec(url)?.[1] ?? "").split("|").map((s) => s.split(",").map(Number) as Point);
    asked.push(pts);
    const nogos = decodeURIComponent(/nogos=([^&]*)/.exec(url)?.[1] ?? "").split("|").filter(Boolean).map((s) => s.split(",").map(Number));
    const banned = new Set<number>();
    G.nodes.forEach((n, i) => { if (nogos.some(([lon, lat, r]) => haversineMeters(n, [lon, lat]) <= r)) banned.add(i); });
    const ids = pts.map((p, i) => shift(pts, i) ?? nearestNode(p, new Set()));
    const path: number[] = [ids[0]];
    for (let i = 1; i < ids.length; i++) {
      const leg = shortest(ids[i - 1], ids[i], banned);
      if (!leg) return new Response("no route found", { status: 400 });
      path.push(...leg.slice(1));
    }
    const coordinates = path.map((i) => G.nodes[i]);
    if (coordinates.length < 2) coordinates.push(coordinates[0]);
    const body = { features: [{ geometry: { type: "LineString", coordinates }, properties: { "track-length": Math.round(lineMeters(coordinates)), "total-time": Math.round(lineMeters(coordinates) / 10), messages: [] } }] };
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { asked, restore: () => { globalThis.fetch = original; } };
}

const OPTIONS: MotoProfileOptions = {
  offRoad: 0.5, difficulty: "hard", trails: "some", accessPolicy: "allow_unverified",
  avoidMainRoads: true, avoidMotorways: true, noSand: false, avoidTowns: false,
};
// A bend dropped in the forest beside the tip of the side track, the join points on the through track either side.
const CUT_A = THROUGH[1];
const CUT_B = THROUGH[THROUGH.length - 3];
const DROP: Point = [TIP[0] + 0.0004, TIP[1] + 0.0002];
const sideIndex = (p: Point) => G.nodes.findIndex((n) => n[0] === p[0] && n[1] === p[1]);
const twoUpTheTrack = sideIndex(SIDE[SIDE.length - 6]);

test("a bend whose two legs reach it apart is still not left on a spur (the Kaņieris case)", async () => {
  // The way out of the bend starts 2 nodes further up the side track than
  // the way in ended — as measured, 208-618 m apart.
  const stub = stubBrouter((pts, i) => (pts.length === 2 && i === 0 && pts[0][0] === DROP[0] && pts[0][1] === DROP[1] ? twoUpTheTrack : null));
  try {
    const r = await routeThroughPlaces({ points: [CUT_A, DROP, CUT_B], shapes: [false, true, false], profileOptions: OPTIONS, deadlineAt: Date.now() + 4_500 });
    const c = r.path.coordinates;
    assert.deepEqual(outAndBacks(c).map((o) => Math.round(o.meters)), [], "no out-and-back to the bend");
    assert.ok(nearestAlong(TIP, c, cumulative(c)).meters > 1_000, "the line stays on the through track");
    assert.equal(r.deadEndMeters, 0);
  } finally { stub.restore(); }
});

test("…and when the legs never meet, the one-request fallback is taken off the spur too", async () => {
  // Every two-point request that starts up the side track starts further up it.
  const stub = stubBrouter((pts, i) => (pts.length === 2 && i === 0 && haversineMeters(pts[0], TIP) < 80 ? twoUpTheTrack : null));
  try {
    const r = await routeThroughPlaces({ points: [CUT_A, DROP, CUT_B], shapes: [false, true, false], profileOptions: OPTIONS, deadlineAt: Date.now() + 4_500 });
    const c = r.path.coordinates;
    assert.ok(stub.asked.some((p) => p.length === 3), "it did fall back to one request");
    assert.deepEqual(outAndBacks(c).map((o) => Math.round(o.meters)), [], "no out-and-back to the bend");
    assert.ok(nearestAlong(TIP, c, cumulative(c)).meters > 1_000, "the bend moved back to where the side track leaves the road");
    assert.equal(r.deadEndMeters, 0);
  } finally { stub.restore(); }
});

test("a STOP at the same spot keeps its spur, and it is said, not hidden", async () => {
  const stub = stubBrouter((pts, i) => (pts.length === 2 && i === 0 && haversineMeters(pts[0], TIP) < 80 ? twoUpTheTrack : null));
  try {
    const r = await routeThroughPlaces({ points: [CUT_A, DROP, CUT_B], shapes: [false, false, false], profileOptions: OPTIONS, deadlineAt: Date.now() + 4_500 });
    assert.ok(r.deadEndMeters > 1_000, `the stop's dead end is reported, got ${r.deadEndMeters}`);
  } finally { stub.restore(); }
});


test("when the only road to the bend is that dead end, it can be kept — and it is said (rule 1, 2026-09-28)", async () => {
  // Measured: drops 68-100 m from a mapped track, 250-600 m off the ride,
  // were refused as „no road” — the spur was cut, the bend went back to
  // where it left the road, and the line came no nearer the drop.
  const stub = stubBrouter(() => null);
  try {
    const r = await routeThroughPlaces({ points: [CUT_A, DROP, CUT_B], shapes: [false, true, false], profileOptions: OPTIONS, deadlineAt: Date.now() + 4_500, keepShapeSpurs: true });
    const c = r.path.coordinates;
    assert.ok(nearestAlong(TIP, c, cumulative(c)).meters < 10, "the line reaches the bend up the side track");
    assert.ok(r.deadEndMeters > 1_000, `the dead end is reported, got ${r.deadEndMeters}`);
    assert.equal(r.deadEndAtShape, true, "as the pass-through point's");
  } finally { stub.restore(); }
});
