/**
 * Gates on tracks — the loader, the lookup, and what `classify.ts` reports.
 *
 * `npx tsx --test scripts/gates.test.ts`
 *
 * Backlog item 12, second attempt. The rider's line, which these tests exist to
 * hold:
 *
 *   "šī pieeja nav korekta — mēs nevaram minēt … ja mums nav datu par
 *   privātajiem ceļiem, labāk šo ceļu no maršruta neizslēgt. Sākam vismaz ar
 *   vārtiem."
 *
 * We cannot guess. So the load-bearing tests here are the ones that prove the
 * guessing is *gone*: a route past a building with no gate on it is clean
 * however much stands around it, a gate is the only thing that ever marks a
 * stretch, and the same geometry with and without one routes identically.
 *
 * The other load-bearing pair is the honesty rule: outside a published country
 * `gateCount` is `undefined`, not 0, so the panel stays silent instead of
 * claiming "no gates" about data nobody has built.
 *
 * And since 2026-09-14 a third, from the rider reading the live map — the first
 * build's 15 m radius marked the gates on **driveways beside** the route:
 *
 *   "Ja vārti nav uz paša maršruta ceļa — jāņem ārā."
 *
 * A gate counts only when it is a VERTEX of the route geometry, which is what
 * "a member of the ridden way" means once BRouter has returned it. So the
 * fixtures below put a counted gate exactly on a route vertex, and the
 * driveway test puts one 12 m off the line and requires it to be ignored.
 *
 * The loader reads `public/gates/` from `process.cwd()`, so these publish a
 * fixture into a temp directory, chdir, and reset the module caches.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import {
  BARRIER_KINDS,
  GATE_HIGHWAYS,
  GATE_RADIUS_M,
  bboxOf,
  gateLookup,
  gateCountries,
  gatesOnRoute,
  hasGateData,
  resetGateCache,
  segmentDistanceM,
} from "@/lib/geo/gates";
import { classifyRoute } from "@/lib/routing/classify";
import type { RoutePath } from "@/lib/types";

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

// --- the geometry primitive -------------------------------------------------

test("segmentDistanceM measures to the segment, not to its endpoints", () => {
  const a = at(0, 0);
  const b = at(1000, 0);

  // A gate 10 m off the middle of a 1 km run is 10 m away though it is 500 m
  // from either end. A routed line has vertices tens of metres apart, so a
  // vertex-only test would miss a gate mid-run entirely.
  assert.ok(Math.abs(segmentDistanceM(at(500, 10), a, b, SCALE) - 10) < 0.5);
  assert.ok(Math.abs(segmentDistanceM(at(500, 0), a, b, SCALE)) < 0.5);

  // Beyond an end the projection is clamped, so the distance is to that end.
  assert.ok(Math.abs(segmentDistanceM(at(1100, 0), a, b, SCALE) - 100) < 0.5);

  // A zero-length segment degrades to a point distance rather than dividing by
  // zero — routed lines do contain duplicate consecutive coordinates.
  assert.ok(Math.abs(segmentDistanceM(at(0, 30), a, a, SCALE) - 30) < 0.5);
});

test("bboxOf is the envelope of the line", () => {
  const box = bboxOf([at(0, 0), at(1000, 500), at(-200, -300)]);
  assert.ok(box[0] < box[2] && box[1] < box[3]);
  assert.ok(Math.abs((box[2] - box[0]) * M_PER_DEG_LON - 1200) < 1);
  assert.ok(Math.abs((box[3] - box[1]) * M_PER_DEG_LAT - 800) < 1);
});

// --- fixtures ---------------------------------------------------------------

type FixtureGate = {
  /** metres east, metres north */
  at: [number, number];
  barrier?: (typeof BARRIER_KINDS)[number];
  highway?: (typeof GATE_HIGHWAYS)[number];
};

/**
 * Publish a `public/gates/` fixture in a temp cwd, exactly the shape
 * `scripts/publish-gates.ts` writes, and run inside it.
 */
async function withGates<T>(gates: FixtureGate[], run: () => Promise<T> | T): Promise<T> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gates-test-"));
  const out = path.join(dir, "public", "gates");
  fs.mkdirSync(out, { recursive: true });

  const packed = gates.map((g) => {
    const [lon, lat] = at(g.at[0], g.at[1]);
    return [
      lon,
      lat,
      BARRIER_KINDS.indexOf(g.barrier ?? "gate"),
      GATE_HIGHWAYS.indexOf(g.highway ?? "track"),
    ];
  });

  fs.writeFileSync(
    path.join(out, "XX.json"),
    JSON.stringify({
      country: "XX",
      barrierKinds: [...BARRIER_KINDS],
      highwayKinds: [...GATE_HIGHWAYS],
      gates: packed,
    })
  );

  const cells = new Set<string>();
  for (const [lon, lat] of packed) {
    cells.add(`${Math.floor(lon / 0.25)},${Math.floor(lat / 0.25)}`);
  }
  // A fixture with no gates at all must still produce a loadable (empty)
  // country, so the "published but nothing here" case is testable.
  if (!cells.size) {
    const [lon, lat] = at(0, 0);
    cells.add(`${Math.floor(lon / 0.25)},${Math.floor(lat / 0.25)}`);
  }

  fs.writeFileSync(
    path.join(out, "index.json"),
    JSON.stringify({
      version: 1,
      source: "geofabrik",
      cellDegrees: 0.25,
      countries: [
        {
          cc: "XX",
          count: packed.length,
          byBarrier: {},
          byHighway: {},
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
  resetGateCache();
  try {
    return await run();
  } finally {
    process.chdir(cwd);
    resetGateCache();
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

// --- the loader -------------------------------------------------------------

test("the index says which countries cover a box, and hasGateData answers honestly", async () => {
  await withGates([{ at: [300, 0] }], () => {
    assert.equal(gateCountries().length, 1);
    assert.equal(gateCountries()[0].cc, "XX");
    assert.equal(hasGateData(bboxOf([at(0, 0), at(1000, 0)])), true);
    // Far away: not "no gates", but "not measured" — the same honesty
    // `sparsePlaceData` gives POIs. Only Latvia is built.
    assert.equal(hasGateData([2.3, 48.8, 2.4, 48.9]), false);
  });
});

test("absent data is zero gates and no crash, not a failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gates-empty-"));
  const cwd = process.cwd();
  process.chdir(dir);
  resetGateCache();
  try {
    assert.deepEqual(gateCountries(), []);
    assert.equal(hasGateData(bboxOf([at(0, 0), at(1000, 0)])), false);
    assert.deepEqual(gatesOnRoute([at(0, 0), at(1000, 0)]), []);
    assert.equal(gateLookup(bboxOf([at(0, 0), at(1000, 0)])).size, 0);
    // And a route classifies exactly as it did before this feature existed —
    // `undefined`, which is "not measured", never a claim of zero gates.
    assert.equal(classifyRoute(straightRoute("track", 20)).quality.gateCount, undefined);
  } finally {
    process.chdir(cwd);
    resetGateCache();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the packed file decodes back to its barrier and highway names", async () => {
  await withGates(
    [
      { at: [300, 0], barrier: "lift_gate", highway: "service" },
      { at: [600, 0], barrier: "cattle_grid", highway: "unclassified" },
    ],
    () => {
      const found = gatesOnRoute([at(0, 0), at(1000, 0)]);
      assert.equal(found.length, 2);
      const byBarrier = Object.fromEntries(found.map((g) => [g.barrier, g.highway]));
      assert.equal(byBarrier.lift_gate, "service");
      assert.equal(byBarrier.cattle_grid, "unclassified");
      assert.ok(found.every((g) => g.country === "XX"));
    }
  );
});

// --- gatesNear / gateAt -----------------------------------------------------

test("gatesNear finds a gate on the stretch and ignores one on the next road", async () => {
  await withGates(
    [
      { at: [300, 2] }, // on the line
      { at: [300, 120] }, // a parallel road 120 m north
    ],
    () => {
      const lookup = gateLookup(bboxOf([at(0, 0), at(1000, 0)]));
      assert.equal(lookup.size, 2, "both load; only one is on this stretch");
      const near = lookup.gatesNear(at(250, 0), at(350, 0));
      assert.equal(near.length, 1);
      assert.ok(Math.abs(near[0].lat - at(300, 2)[1]) < 1e-6);
    }
  );
});

test("gatesNear's radius is tight — a gate 40 m off the line is on something else", async () => {
  // GATE_RADIUS_M exists to absorb 5-decimal rounding and a simplified routed
  // line, not to reach across a field. A gate is a *node of the way*.
  await withGates([{ at: [300, 40] }], () => {
    const lookup = gateLookup(bboxOf([at(0, 0), at(1000, 0)]));
    assert.equal(lookup.gatesNear(at(250, 0), at(350, 0)).length, 0);
    assert.equal(lookup.gatesNear(at(250, 0), at(350, 0), 50).length, 1, "widen and it is found");
  });
});

test("gateAt takes lat, lon and returns the nearest gate or null", async () => {
  await withGates([{ at: [300, 0], barrier: "chain" }, { at: [800, 0] }], () => {
    const lookup = gateLookup(bboxOf([at(0, 0), at(1000, 0)]));
    const [lon, lat] = at(305, 0);
    const hit = lookup.gateAt(lat, lon);
    assert.ok(hit, "5 m away is the same gate");
    assert.equal(hit.barrier, "chain");

    const [farLon, farLat] = at(500, 0);
    assert.equal(lookup.gateAt(farLat, farLon), null, "200 m from either gate is nothing");
    assert.ok(lookup.gateAt(farLat, farLon, 400), "widen and the nearer one answers");
  });
});

test("gatesOnRoute deduplicates a gate that sits on a shared vertex", async () => {
  // A gate exactly on a coordinate belongs to both segments meeting there, and
  // the count is what the rider is shown — "Vārti uz ceļa · N" must not be 2.
  await withGates([{ at: [500, 0] }], () => {
    const coords: [number, number][] = [at(0, 0), at(500, 0), at(1000, 0)];
    assert.equal(gatesOnRoute(coords).length, 1);
  });
});

test("GATE_RADIUS_M is the default and a route with no gates reports none", async () => {
  assert.equal(GATE_RADIUS_M, 15);
  await withGates([{ at: [300, 200] }], () => {
    assert.deepEqual(gatesOnRoute([at(0, 0), at(1000, 0)]), []);
  });
});

// --- what classify.ts reports -----------------------------------------------

test("a gate on a track is counted, and carried on the segment that holds it", async () => {
  // ON a vertex: `straightRoute` steps every 50 m, so 300 m east IS vertex 6.
  const { quality, segments } = await withGates([{ at: [300, 0] }], () =>
    classifyRoute(straightRoute("track", 20))
  );
  assert.equal(quality.gateCount, 1, "a gate across a farm track is the one explicit fact");

  // The count is a number of gates, not a length of road: the old shape
  // reported the kilometres of the shape segment a gate happened to sit on,
  // which was a fact about BRouter's vertex spacing and nothing else.
  const withGate = segments.features.filter((f) => (f.properties?.gates ?? 0) > 0);
  assert.equal(withGate.length, 1, "one run carries it");
  assert.equal(withGate[0].properties?.gates, 1);
  // And its position, so the map can put a marker on it rather than on the
  // middle of the run.
  const points = withGate[0].properties?.gatePoints ?? [];
  assert.equal(points.length, 1);
  assert.ok(Math.abs(points[0][0] - at(300, 0)[0]) < 1e-9);
  assert.ok(Math.abs(points[0][1] - at(300, 0)[1]) < 1e-9);
});

test("a gate on the driveway beside the road is NOT on the road", async () => {
  // The rider's correction, 2026-09-14, reading the live map: the markers were
  // landing on the barrier across a house's access road, 10–15 m off the orange
  // line. "Ja vārti nav uz paša maršruta ceļa — jāņem ārā."
  //
  // Proximity cannot tell this from a gate across the ridden track — at 12 m
  // they are the same measurement, and a driveway gate is *supposed* to sit
  // near the road it leaves. Vertex identity can, exactly.
  const q = await withGates([{ at: [300, 12], highway: "service" }], () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(q.gateCount, 0, "measured, and none on the road the rider rides");

  // Even at 3 m — still not a node of the ridden way, so still not its gate.
  // The tolerance absorbs coordinate rounding only.
  const near = await withGates([{ at: [300, 3], highway: "service" }], () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(near.gateCount, 0);
});

test("the vertex tolerance absorbs coordinate rounding, and only that", async () => {
  // A gate stored to 5 decimals against a route vertex stored to 5 decimals is
  // up to ~1 m apart while being the same OSM node. That must still count.
  const q = await withGates([{ at: [300, 1] }], () =>
    classifyRoute(straightRoute("track", 20)).quality
  );
  assert.equal(q.gateCount, 1, "1 m is rounding, not a different road");
});

test("a gate on a road class that is not gateable is not on the rider's road", async () => {
  // The dataset says "this gate is on a track somewhere". A primary road
  // running within 15 m of a farm track's gate must not report it.
  const q = await withGates([{ at: [300, 2] }], () =>
    classifyRoute(straightRoute("primary", 20)).quality
  );
  assert.equal(q.gateCount, 0, "measured, and none on this road");
});

test("one gate is one gate however many times the line meets it", async () => {
  // A shared vertex is found by both segments that meet there, and an
  // out-and-back rides the same gate twice. The rider asked how many gates are
  // on the road, not how many times the line passes one.
  const there: [number, number][] = [];
  for (let i = 0; i <= 20; i++) there.push(at(i * 50, 0));
  const path: RoutePath = {
    distanceMeters: 2000,
    durationSeconds: 200,
    coordinates: [...there, ...there.slice(0, -1).reverse()],
    edges: [
      {
        beginShapeIndex: 0,
        endShapeIndex: there.length * 2 - 2,
        use: "track",
        tags: { highway: "track" },
      },
    ],
  };
  const q = await withGates([{ at: [300, 0] }], () => classifyRoute(path).quality);
  assert.equal(q.gateCount, 1);
});

test("a track with no gate is clean, however much is around it", async () => {
  // The old build would have flagged this from building proximity. It must not:
  // "vairumā gadījumu tur nebūs ierobežojuma" — in most cases there is no
  // restriction there. 300 m off the line is not a gate on it.
  const { quality, segments } = await withGates([{ at: [300, 300] }], () =>
    classifyRoute(straightRoute("track", 20))
  );
  // 0, not undefined: the country IS published, so this is a measurement.
  assert.equal(quality.gateCount, 0);
  assert.ok(segments.features.every((f) => f.properties?.gates === undefined));
});

test("outside a published country the count is undefined, never zero", async () => {
  // The honesty rule, and the reason the panel can stay silent: "not measured"
  // must never render as "no gates". Same shape as `sparsePlaceData` for POIs.
  const far: [number, number][] = [];
  for (let i = 0; i <= 20; i++) far.push([2.35 + i * 0.0005, 48.85]);
  const q = await withGates([{ at: [300, 0] }], () =>
    classifyRoute({
      distanceMeters: 1000,
      durationSeconds: 100,
      coordinates: far,
      edges: [{ beginShapeIndex: 0, endShapeIndex: 20, use: "track", tags: { highway: "track" } }],
    }).quality
  );
  assert.equal(q.gateCount, undefined, "Paris has no published gate data");
});

test("the route is never changed by a gate — it is reported, not avoided", async () => {
  // Same geometry, with and without a gate on it: identical distance, identical
  // mix, identical segment count. The only difference is the reported number.
  const withGate = await withGates([{ at: [300, 0] }], () =>
    classifyRoute(straightRoute("track", 20))
  );
  const without = await withGates([], () => classifyRoute(straightRoute("track", 20)));

  assert.equal(withGate.durationSeconds, without.durationSeconds);
  assert.deepEqual(withGate.roadMix, without.roadMix);
  assert.deepEqual(withGate.overlap, without.overlap);
  assert.deepEqual(withGate.surfaces, without.surfaces);
  assert.deepEqual(
    withGate.segments.features.map((f) => f.geometry.coordinates.length),
    without.segments.features.map((f) => f.geometry.coordinates.length),
    "a gate does not even split a run — it is a point on the road, not a property of it"
  );
  assert.equal(withGate.quality.gateCount, 1);
  assert.equal(without.quality.gateCount, 0);
});
