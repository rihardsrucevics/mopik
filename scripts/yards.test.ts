/**
 * Yard detection — the geometry primitives, the four "through a yard" rules on
 * synthetic routes, and the share code's round trip with and without the field.
 *
 * `npx tsx --test scripts/yards.test.ts`
 *
 * The rider's line, which these tests exist to hold:
 *
 *   "A house near the road does not make the road private. Only a road that
 *   goes THROUGH the yard does."
 *
 * So the load-bearing tests here are the negative ones — a house beside a track
 * is NOT a yard, a village street past houses is NOT a yard — because that is
 * the failure mode the first version had.
 *
 * The lookup reads `public/yards/` from `process.cwd()`, so these publish a
 * fixture into a temp directory, chdir, and reset the module caches.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { pointInRing, segmentDistanceM, signedOffsetM } from "@/lib/geo/yards";
import { classifyRoute } from "@/lib/routing/classify";
import { encodeRouteShare, decodeRouteShare } from "@/lib/share/route-code";
import type { GeneratedRoute, RoutePath } from "@/lib/types";

/** A flat patch of Latvia. */
const LAT = 56.6;
const LON = 24.18;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);
const SCALE = { kx: M_PER_DEG_LON, ky: M_PER_DEG_LAT };

/** Metres east / north of the origin, as [lon, lat]. */
function at(east: number, north: number): [number, number] {
  return [LON + east / M_PER_DEG_LON, LAT + north / M_PER_DEG_LAT];
}

// --- the geometry primitives -----------------------------------------------

test("segmentDistanceM measures to the segment, not to its endpoints", () => {
  const a = at(0, 0);
  const b = at(1000, 0);

  // A point 10 m off the middle of a 1 km run is 10 m away though it is 500 m
  // from either end. A routed line has vertices tens of metres apart, so a
  // vertex-only test would miss a building beside a straight run entirely.
  assert.ok(Math.abs(segmentDistanceM(at(500, 10), a, b, SCALE) - 10) < 0.5);
  assert.ok(Math.abs(segmentDistanceM(at(500, 0), a, b, SCALE)) < 0.5);

  // Beyond an end the projection is clamped, so the distance is to that end.
  assert.ok(Math.abs(segmentDistanceM(at(1100, 0), a, b, SCALE) - 100) < 0.5);
  assert.ok(Math.abs(segmentDistanceM(at(-50, 0), a, b, SCALE) - 50) < 0.5);

  // A zero-length segment degrades to a point distance rather than dividing by
  // zero — routed lines do contain duplicate consecutive coordinates.
  assert.ok(Math.abs(segmentDistanceM(at(0, 30), a, a, SCALE) - 30) < 0.5);
});

test("signedOffsetM separates the two sides of the direction of travel", () => {
  // This is the primitive rule (b) rests on: a row of houses along one side of
  // a village road is all one sign, a yard between house and barn is both.
  const a = at(0, 0);
  const b = at(1000, 0);
  const left = signedOffsetM(at(500, 15), a, b, SCALE);
  const right = signedOffsetM(at(500, -15), a, b, SCALE);

  assert.ok(left > 0 && right < 0, `expected opposite signs, got ${left} and ${right}`);
  assert.ok(Math.abs(Math.abs(left) - 15) < 0.5);
  assert.ok(Math.abs(Math.abs(right) - 15) < 0.5);

  // Reversing the direction of travel flips the sign but not the magnitude.
  const reversed = signedOffsetM(at(500, 15), b, a, SCALE);
  assert.ok(reversed < 0);
  assert.ok(Math.abs(Math.abs(reversed) - 15) < 0.5);
});

test("pointInRing is inside/outside, and the ring's own corners do not confuse it", () => {
  const ring: [number, number][] = [at(0, 0), at(100, 0), at(100, 100), at(0, 100), at(0, 0)];
  assert.equal(pointInRing(...at(50, 50), ring), true);
  assert.equal(pointInRing(...at(150, 50), ring), false);
  assert.equal(pointInRing(...at(50, 150), ring), false);
  assert.equal(pointInRing(...at(-10, 50), ring), false);
});

// --- fixtures ---------------------------------------------------------------

type Fixture = {
  buildings?: [number, number][];
  gates?: [number, number][];
  yards?: { landuse: "farmyard" | "residential"; ring: [number, number][]; buildings?: number }[];
};

async function withYards<T>(fixture: Fixture, run: () => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yards-test-"));
  const out = path.join(dir, "public", "yards");
  fs.mkdirSync(out, { recursive: true });

  const buildings = (fixture.buildings ?? []).map(([e, n]) => [...at(e, n), 0]);
  const gates = (fixture.gates ?? []).map(([e, n]) => [...at(e, n), 0]);
  const yards = (fixture.yards ?? []).map((y) => ({
    landuse: y.landuse,
    buildings: y.buildings ?? 2,
    ring: y.ring.map(([e, n]) => at(e, n)),
  }));

  fs.writeFileSync(
    path.join(out, "XX.geojson"),
    JSON.stringify({ country: "XX", nearMeters: 25, buildings, gates, yards })
  );

  const cells = new Set<string>();
  const see = ([lon, lat]: number[]) =>
    cells.add(`${Math.floor(lon / 0.25)},${Math.floor(lat / 0.25)}`);
  buildings.forEach(see);
  gates.forEach(see);
  yards.forEach((y) => y.ring.forEach(see));
  // A fixture with only rings must still register its cells, and one with
  // nothing at all must still produce a loadable (empty) country.
  if (!cells.size) see(at(0, 0));

  fs.writeFileSync(
    path.join(out, "index.json"),
    JSON.stringify({
      version: 1,
      source: "geofabrik",
      cellDegrees: 0.25,
      nearMeters: 25,
      countries: [
        {
          cc: "XX",
          count: buildings.length + gates.length + yards.length,
          buildings: buildings.length,
          gates: gates.length,
          yards: yards.length,
          bbox: [LON - 0.1, LAT - 0.1, LON + 0.1, LAT + 0.1],
          cells: [...cells].sort(),
          builtAt: new Date().toISOString(),
          bytes: 0,
        },
      ],
    })
  );

  const cwd = process.cwd();
  process.chdir(dir);
  const { resetYardCache } = await import("@/lib/geo/yards");
  resetYardCache();
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    resetYardCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** A straight route of `steps` 50 m steps due east, all one `highway` class. */
function straightRoute(highway: string, steps: number): RoutePath {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) coordinates.push(at(i * 50, 0));
  return {
    distanceMeters: steps * 50,
    durationSeconds: steps * 5,
    coordinates,
    edges: [{ beginShapeIndex: 0, endShapeIndex: steps, use: highway, tags: { highway } }],
  };
}

/** Out to `steps` and back along the same line — a dead-end excursion. */
function outAndBackRoute(highway: string, steps: number): RoutePath {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= steps; i++) coordinates.push(at(i * 50, 0));
  for (let i = steps - 1; i >= 0; i--) coordinates.push(at(i * 50, 0));
  return {
    distanceMeters: steps * 100,
    durationSeconds: steps * 10,
    coordinates,
    edges: [
      { beginShapeIndex: 0, endShapeIndex: coordinates.length - 1, use: highway, tags: { highway } },
    ],
  };
}

// --- the rider's line: proximity alone is not a yard ------------------------

test("a house beside a track is NOT a yard", async () => {
  // The rider's own words: "private houses stand beside public roads all the
  // time". One building 10 m from the line, nothing on the other side, no
  // polygon, no gate, no dead end — this must read as a clean ride.
  const q = await withYards({ buildings: [[300, 10]] }, () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(q.yardKm, 0, "a single house beside a track must not flag");
  assert.equal(q.yardEdgeCount, 0);
});

test("a row of houses along one side of a track is NOT a yard", async () => {
  // A village street, or a track along the edge of a settlement. Eight houses,
  // all within 12 m — and all on the same side, which is the whole point.
  const buildings: [number, number][] = [];
  for (let i = 0; i < 8; i++) buildings.push([100 + i * 60, 12]);
  const q = await withYards({ buildings }, () => classifyRoute(straightRoute("track", 20)).quality);
  assert.equal(q.yardKm, 0, "houses all on one side are a street, not a yard");
});

test("a residential lane past detached houses on both sides is NOT measured", async () => {
  // The investigation's own documented false positive (example 10, Kuldīga: a
  // `residential` lane 13 m from detached houses, correctly tagged, a public
  // road). Only track and service are ever examined.
  const buildings: [number, number][] = [[300, 13], [300, -13]];
  const [track, residential, unclassified] = await withYards({ buildings }, () => [
    classifyRoute(straightRoute("track", 20)).quality.yardKm,
    classifyRoute(straightRoute("residential", 20)).quality.yardKm,
    classifyRoute(straightRoute("unclassified", 20)).quality.yardKm,
  ]);
  assert.ok(track > 0, "the same geometry on a track is a yard");
  assert.equal(residential, 0, "a residential street is a public road");
  assert.equal(unclassified, 0, "village gravel road is a public road");
});

// --- rule (b): buildings on both sides --------------------------------------

test("rule (b): a track passing between a house and a barn is a yard", async () => {
  const { quality, segments } = await withYards(
    { buildings: [[300, 12], [310, -14]] },
    () => classifyRoute(straightRoute("track", 20))
  );
  assert.ok(quality.yardKm > 0, "buildings left and right must flag");
  assert.ok(quality.yardByRule.bothSides > 0);
  assert.equal(quality.yardByRule.yard, 0);
  assert.equal(quality.yardByRule.gate, 0);
  assert.equal(quality.yardEdgeCount, 1, "one contiguous stretch");
  assert.ok(segments.features.some((f) => f.properties.yard));
});

test("rule (b) needs both buildings close — 30 m out is a wide gap, not a yard", async () => {
  // BOTH_SIDES_M is 20: a 40 m corridor is about as wide as a homestead yard
  // gets. At 30 m each side the route is crossing a field between two farms.
  const q = await withYards({ buildings: [[300, 30], [300, -30]] }, () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(q.yardKm, 0);
});

// --- rule (a): a farmyard polygon -------------------------------------------

test("rule (a): a track inside a landuse=farmyard is a yard, with no buildings at all", async () => {
  // OSM saying outright that this is somebody's yard. It needs no building
  // evidence — this is the strongest signal available.
  const q = await withYards(
    {
      yards: [
        {
          landuse: "farmyard",
          ring: [[200, -60], [500, -60], [500, 60], [200, 60], [200, -60]],
        },
      ],
    },
    () => classifyRoute(straightRoute("track", 20)).quality
  );
  assert.ok(q.yardKm > 0, "inside a farmyard polygon must flag");
  assert.ok(q.yardByRule.yard > 0);
  assert.equal(q.yardByRule.bothSides, 0);
  // 200–500 m of a 1 km run, give or take the step that crosses the boundary.
  assert.ok(q.yardKm >= 0.25 && q.yardKm <= 0.45, `expected ~0.3 km, got ${q.yardKm}`);
});

test("a farmyard polygon does not flag a road that misses it", async () => {
  const q = await withYards(
    {
      yards: [
        {
          landuse: "farmyard",
          ring: [[200, 100], [500, 100], [500, 300], [200, 300], [200, 100]],
        },
      ],
    },
    () => classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(q.yardKm, 0);
});

// --- rule (d): a gate on the line -------------------------------------------

test("rule (d): a gate on a track is a yard stretch", async () => {
  const q = await withYards({ gates: [[300, 2]] }, () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.ok(q.yardKm > 0, "a gate across a farm track is access control");
  assert.ok(q.yardByRule.gate > 0);
  assert.equal(q.yardByRule.bothSides, 0);
});

// --- rule (c): a dead end at a building -------------------------------------

test("rule (c): riding in to a house and back out is a driveway", async () => {
  const q = await withYards({ buildings: [[900, 12]] }, () =>
    classifyRoute(outAndBackRoute("track", 20)).quality
  );
  assert.ok(q.yardKm > 0, "retracing into a homestead is a driveway");
  assert.ok(q.yardByRule.deadEnd > 0);
});

test("rule (c) does not fire on an out-and-back with no buildings", async () => {
  // Retracing alone is common and innocent — a spur to a viewpoint, a ferry
  // ramp. It is retracing *into a homestead* that makes a driveway.
  const q = await withYards({ buildings: [[3000, 12]] }, () =>
    classifyRoute(outAndBackRoute("track", 20)).quality
  );
  assert.equal(q.yardKm, 0);
});

// --- plumbing ---------------------------------------------------------------

test("no published yard data means zero, not a crash", async () => {
  // Outside the published countries the ride is unchanged, and absent data
  // reads as "not measured" rather than "clean".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yards-empty-"));
  const cwd = process.cwd();
  process.chdir(dir);
  const { resetYardCache } = await import("@/lib/geo/yards");
  resetYardCache();
  try {
    const classified = classifyRoute(straightRoute("track", 20));
    assert.equal(classified.quality.yardKm, 0);
    assert.equal(classified.quality.yardEdgeCount, 0);
    assert.deepEqual(classified.quality.yardByRule, { yard: 0, bothSides: 0, deadEnd: 0, gate: 0 });
    assert.ok(classified.segments.features.every((f) => !f.properties.yard));
  } finally {
    process.chdir(cwd);
    resetYardCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the segment flag splits the line, so a run is wholly yard or wholly not", async () => {
  const segments = await withYards({ buildings: [[500, 12], [505, -12]] }, () =>
    classifyRoute(straightRoute("track", 20)).segments
  );
  const flagged = segments.features.filter((f) => f.properties.yard);
  assert.ok(flagged.length >= 1);
  for (const f of flagged) assert.equal(f.properties.yard, true);
  // The clean stretches either side must still be their own features.
  assert.ok(segments.features.some((f) => !f.properties.yard));
});

// --- the share code ---------------------------------------------------------

function routeWith(yardKm: number): GeneratedRoute {
  // A zig-zag rather than a straight line: the encoder simplifies at 10 m, and
  // a straight run collapses to its two ends, which would make the point-count
  // assertion below meaningless.
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= 40; i++) coordinates.push(at(i * 120, i * 35 + (i % 2 ? 60 : -60)));
  return {
    id: "t1",
    name: "Testa brauciens",
    geometry: { type: "LineString", coordinates },
    segments: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            roadClass: "track",
            surface: "gravel",
            distanceMeters: 5000,
            ...(yardKm ? { yard: true } : {}),
          },
        },
      ],
    },
    distanceMeters: 5000,
    durationSeconds: 900,
    roadMix: { roadPercent: 40, trackPercent: 55, trailPercent: 5, roadKm: 2, trackKm: 2.8, trailKm: 0.2 },
    surfaces: { asphaltPercent: 40, gravelPercent: 50, dirtPercent: 5, unknownPercent: 5 },
    quality: {
      roughTrackKm: 0.4, sandKm: 0, streetKm: 0.3, unverifiedPathKm: 0.2, surfaceSwitches: 4,
      turnsPer10Km: 8, forestKm: 2.1, riversideKm: 0.4, ruralOpenKm: 1.2, landscapeTransitions: 2,
      landscapeTypes: 2, elevationGainM: 60, elevationRangeM: 25, natureScore: 51,
      yardKm, yardEdgeCount: yardKm > 0 ? 2 : 0,
      yardByRule: { yard: yardKm, bothSides: 0, deadEnd: 0, gate: 0 },
    },
    overlap: { repeatedKm: 0.4, distinctKm: 4.6, repeatedPercent: 8 },
    profile: "moto",
    sourcePrompt: "tests",
    variant: "balanced",
  };
}

test("the share code round-trips yardKm", () => {
  const decoded = decodeRouteShare(encodeRouteShare(routeWith(2.4), "Sigulda"));
  assert.ok(decoded);
  assert.equal(decoded.details?.yardKm, 2.4);
  // The rest of the payload is untouched by the addition.
  assert.equal(decoded.details?.unverifiedPathKm, 0.2);
  assert.equal(decoded.name, "Testa brauciens");
});

test("a ride with no yard km encodes no field and decodes to 0", () => {
  const code = encodeRouteShare(routeWith(0), "Sigulda");
  const meta = JSON.parse(
    Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  );
  assert.equal(meta.y, undefined, "a zero must not cost bytes in every link");
  assert.equal(decodeRouteShare(code)?.details?.yardKm, 0);
});

test("codes that predate the field still decode", () => {
  // Links live in riders' chats forever; the version prefix is only bumped for
  // a change that breaks them, so an old code must decode with `yardKm: 0`.
  const parts = encodeRouteShare(routeWith(2.4), "Sigulda").split("~");
  const meta = JSON.parse(
    Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  );
  delete meta.y;
  parts[1] = Buffer.from(JSON.stringify(meta), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const decoded = decodeRouteShare(parts.join("~"));
  assert.ok(decoded, "an old code must still decode");
  assert.equal(decoded.details?.yardKm, 0);
  assert.equal(decoded.details?.forestKm, 2.1);
  assert.ok(decoded.points.length > 2);
});
