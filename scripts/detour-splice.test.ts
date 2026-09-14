import test from "node:test";
import assert from "node:assert/strict";
import {
  ENTRY_BACK_M,
  EXIT_FORWARD_M,
  cumulative,
  lineMeters,
  orderDetours,
  pickEntryExit,
  pointAtDistance,
  sliceBetween,
  isSuspiciousDetour,
  spliceDetours,
  splicedSurfaces,
  type DetourResult,
} from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";
import type { RouteSegmentProperties } from "../lib/types";

/**
 * The splice arithmetic on a synthetic polyline, where every distance can be
 * checked by hand.
 *
 * This is the half of the feature that has to be right without a router: the
 * entry/exit choice decides what the rider sees change on the map, the
 * along-route ordering decides what two ticks together mean, and the
 * non-overlap rule decides when a second tick is refused. A wrong answer in
 * any of the three draws a line that jumps, which is exactly the failure the
 * whole "instant splice" idea is supposed to avoid.
 *
 * The line is due east at 57°N (Latvia's latitude), so a degree of longitude
 * is ~60.6 km and distances along it are easy to reason about.
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** A due-east line of `km` kilometres, one vertex every 100 m. */
function eastLine(km: number): Point[] {
  const out: Point[] = [];
  const steps = km * 10;
  for (let i = 0; i <= steps; i++) out.push([24.0 + (i * 100) / M_PER_DEG_LON, LAT]);
  return out;
}

const LINE = eastLine(20);
const CUM = cumulative(LINE);

/** Metres are exact to within the flat-projection error over a short line. */
const closeTo = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ~${expected}, got ${actual}`,
  );

test("the line is the length it claims and cumulative distances are monotonic", () => {
  closeTo(CUM[CUM.length - 1], 20_000, 30, "total length");
  for (let i = 1; i < CUM.length; i++) assert.ok(CUM[i] > CUM[i - 1], "cumulative must rise");
});

/**
 * How far along the line a point actually falls, measured the way the module
 * measures — by walking the line with `haversineMeters`.
 *
 * Asserted this way rather than against a longitude computed from a flat
 * `metres per degree` constant. The line is *built* flat and *measured*
 * spherically, so the two disagree by about a tenth of a percent; checking the
 * coordinate would be testing the difference between two projections, while
 * what the splice depends on is the distance.
 */
function alongOf(point: Point): number {
  let best = { meters: Infinity, along: 0 };
  for (let i = 0; i < LINE.length - 1; i++) {
    for (const [t, along] of [
      [0, CUM[i]],
      [0.5, (CUM[i] + CUM[i + 1]) / 2],
      [1, CUM[i + 1]],
    ] as const) {
      const x = LINE[i][0] + (LINE[i + 1][0] - LINE[i][0]) * t;
      const d = Math.abs(point[0] - x);
      if (d < best.meters) best = { meters: d, along };
    }
  }
  return best.along;
}

test("a point at a distance along the line lands between the right vertices", () => {
  const { point, index } = pointAtDistance(LINE, CUM, 5_000);
  closeTo(alongOf(point), 5_000, 60, "distance along at 5 km");
  assert.equal(point[1], LAT);
  // Vertices are 100 m apart, so 5 km is at or just after vertex 50.
  assert.ok(index >= 50 && index <= 51, `index ${index} should bracket 5 km`);
});

test("interpolation is not a snap to the nearest vertex", () => {
  // 50 m past a vertex: a snapped answer would give the vertex itself, and a
  // detour entry point moved by 50 m is what turns two non-overlapping ticks
  // into an overlap. So the test is that the point is strictly between two
  // vertices, which a snap can never produce.
  const { point } = pointAtDistance(LINE, CUM, 5_050);
  const onVertex = LINE.some((v) => v[0] === point[0]);
  assert.ok(!onVertex, "a point 50 m past a vertex must not be the vertex");
  const before = LINE[50][0];
  const after = LINE[51][0];
  assert.ok(point[0] > before && point[0] < after, "the point lies between the bracketing vertices");
});

test("entry is ~500 m before the sight and exit ~500 m after, so a real stretch is replaced", () => {
  const { entryMeters, exitMeters, entry, exit } = pickEntryExit({
    line: LINE,
    cum: CUM,
    alongMeters: 10_000,
  });
  closeTo(entryMeters, 10_000 - ENTRY_BACK_M, 1, "entry distance");
  closeTo(exitMeters, 10_000 + EXIT_FORWARD_M, 1, "exit distance");
  // The replaced stretch has real length: an entry that equalled the exit
  // would make the detour an out-and-back spur drawn over itself.
  assert.ok(exitMeters - entryMeters > 900, "the replaced stretch must be ~1 km");
  assert.ok(entry[0] < exit[0], "entry comes before exit along an eastward ride");
});

test("near the start of a ride the entry clamps to the route's own beginning", () => {
  const { entryMeters, exitMeters } = pickEntryExit({ line: LINE, cum: CUM, alongMeters: 200 });
  assert.equal(entryMeters, 0, "a sight 200 m in is reached by leaving from the start");
  closeTo(exitMeters, 700, 1, "the exit is still forward of the sight");
});

test("near the end of a ride the exit clamps to the route's own end", () => {
  const total = CUM[CUM.length - 1];
  const { entryMeters, exitMeters } = pickEntryExit({
    line: LINE,
    cum: CUM,
    alongMeters: total - 100,
  });
  closeTo(exitMeters, total, 1, "the exit cannot run past the finish");
  closeTo(entryMeters, total - 600, 1, "the entry is still behind the sight");
});

test("the replaced stretch is exactly the piece between entry and exit", () => {
  const slice = sliceBetween(LINE, CUM, 10_000, 12_000);
  closeTo(lineMeters(slice), 2_000, 5, "sliced length");
  closeTo(alongOf(slice[0]), 10_000, 60, "slice starts at the cut");
  closeTo(alongOf(slice[slice.length - 1]), 12_000, 60, "slice ends at the cut");
  // And it is a piece of the ride, not a fresh line: everything between the
  // two cuts is a vertex the route already had.
  for (const c of slice.slice(1, -1)) {
    assert.ok(LINE.some((v) => v[0] === c[0] && v[1] === c[1]), "interior vertices come from the route");
  }
});

/** A loop detour that costs `deltaMeters` over the stretch it replaces. */
function detour(id: string, entryMeters: number, exitMeters: number, deltaMeters = 1_000): DetourResult {
  // A square bulge north of the line, so the spliced geometry is visibly not
  // the original — a splice that silently kept the old line would still pass a
  // length check.
  const a = pointAtDistance(LINE, CUM, entryMeters).point;
  const b = pointAtDistance(LINE, CUM, exitMeters).point;
  const north: Point = [(a[0] + b[0]) / 2, LAT + 0.005];
  const coordinates: Point[] = [a, north, b];
  return {
    ok: true,
    poiId: id,
    shape: "loop",
    coordinates,
    segments: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            roadClass: "track",
            surface: "gravel",
            distanceMeters: Math.round(lineMeters(coordinates)),
          } as RouteSegmentProperties,
        },
      ],
    },
    distanceMeters: Math.round(lineMeters(coordinates)),
    durationSeconds: 300,
    deltaMeters,
    deltaSeconds: 120,
    entryMeters,
    exitMeters,
  };
}

/**
 * An out-and-back spur: ridden to the sight and back the same way, rejoining
 * where it left. The rider's default — "uz apskates vietu var braukt turp un
 * atpakaļ pa vienu ceļu" — so `entryMeters === exitMeters` and the whole spur
 * is the cost, because none of the ride is replaced.
 */
function spur(id: string, atMeters: number, spurMeters = 600): DetourResult {
  const a = pointAtDistance(LINE, CUM, atMeters).point;
  const tip: Point = [a[0], LAT + spurMeters / 111_320];
  const coordinates: Point[] = [a, tip, a];
  return {
    ok: true,
    poiId: id,
    shape: "outAndBack",
    coordinates,
    segments: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates },
          properties: {
            roadClass: "track",
            surface: "gravel",
            distanceMeters: Math.round(lineMeters(coordinates)),
          } as RouteSegmentProperties,
        },
      ],
    },
    distanceMeters: Math.round(lineMeters(coordinates)),
    durationSeconds: 180,
    // Nothing of the ride is replaced, so the spur's whole length is the cost.
    deltaMeters: Math.round(lineMeters(coordinates)),
    deltaSeconds: 180,
    entryMeters: atMeters,
    exitMeters: atMeters,
  };
}

test("an out-and-back spur adds its whole length: nothing of the ride is replaced", () => {
  const s = spur("viewpoint", 8_000, 600);
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [s],
  });
  // ~600 m out and ~600 m back.
  closeTo(spliced.addedMeters, 1_200, 20, "a 600 m spur costs 1.2 km");
  closeTo(spliced.distanceMeters, 21_200, 20, "the ride grows by the whole spur");
  // head · spur · tail, and the two halves of the road still sum to 20 km.
  assert.equal(spliced.segments.features.length, 3);
  const road = spliced.segments.features[0].properties.distanceMeters + spliced.segments.features[2].properties.distanceMeters;
  closeTo(road, 20_000, 40, "no stretch of the ride was consumed");
});

test("two out-and-backs at the very same point are both spurs, not an overlap", () => {
  // The case that a naive `entry < lastExit` rule refuses: a spur replaces
  // nothing, so it can never leave a later one with no route to leave from.
  const { applied, refused } = orderDetours([spur("a", 8_000), spur("b", 8_000)]);
  assert.equal(applied.length, 2, "both spurs apply");
  assert.equal(refused.length, 0);
});

test("a spur inside a loop's replaced stretch is still refused", () => {
  // A loop does consume the ride, so anything entering inside it has nowhere
  // to leave from — spur or not.
  const { applied, refused } = orderDetours([detour("loop", 5_000, 6_000), spur("inside", 5_500)]);
  assert.deepEqual(applied.map((d) => d.poiId), ["loop"]);
  assert.deepEqual(refused.map((d) => d.poiId), ["inside"]);
});

test("a spur and a loop elsewhere coexist", () => {
  const { applied, refused } = orderDetours([spur("early", 2_000), detour("later", 10_000, 11_000)]);
  assert.deepEqual(applied.map((d) => d.poiId), ["early", "later"]);
  assert.equal(refused.length, 0);
});

test("unticking a spur restores the ride exactly", () => {
  const withSpur = spliceDetours({
    segments: ROUTE_SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600, detours: [spur("v", 8_000)],
  });
  const without = spliceDetours({
    segments: ROUTE_SEGMENTS, distanceMeters: 20_000, durationSeconds: 3_600, detours: [],
  });
  assert.notEqual(withSpur.distanceMeters, without.distanceMeters);
  assert.equal(without.distanceMeters, 20_000);
  assert.equal(without.segments.features.length, 1);
});

/**
 * The "205 m away, +10 km to ride" case the rider reported, pinned with the
 * numbers measured on the Sigulda round trip.
 */
test("a detour far past the straight line is flagged, an ordinary one is not", () => {
  // Ķeizarskats: 245 m off, 0.6 km out and back. The ordinary case.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 245, deltaMeters: 600 }), false);
  // Kubeseles pilskalns: 308 m off, 0.8 km. Also ordinary.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 308, deltaMeters: 800 }), false);
  // Gūtmaņa ala: 170 m off, 10.4 km — the far bank of the Gauja.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 170, deltaMeters: 10_400 }), true);
  // Taurētāju kalns: 206 m off, 10.3 km.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 206, deltaMeters: 10_300 }), true);
  // Lojas pilskalns: 853 m off, 10.2 km — allowed 3 + 6.8 = 9.8 km, so flagged.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 853, deltaMeters: 10_200 }), true);
  // Inčukalna medību pils: 1232 m off, 3.9 km. A long spur, but in proportion.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 1232, deltaMeters: 3_900 }), false);
});

test("a short spur is never flagged, however much the road bends", () => {
  // 100 m off and 1 km of ride is a tenfold bend, and still fine: the 3 km
  // slack exists so a twisty approach to a nearby sight is not an alarm.
  assert.equal(isSuspiciousDetour({ offRouteMeters: 100, deltaMeters: 1_000 }), false);
});

test("detours are applied in along-route order however they were ticked", () => {
  const late = detour("late", 15_000, 16_000);
  const early = detour("early", 2_000, 3_000);
  // Ticked late-first: the result must not depend on the press order.
  const { applied } = orderDetours([late, early]);
  assert.deepEqual(applied.map((d) => d.poiId), ["early", "late"]);
});

test("two detours whose stretches overlap: the earlier wins, the later is refused", () => {
  const first = detour("first", 5_000, 6_000);
  // Enters inside the first one's replaced stretch — there is no ride left
  // there to leave from.
  const clashing = detour("clashing", 5_500, 6_500);
  const { applied, refused } = orderDetours([first, clashing]);
  assert.deepEqual(applied.map((d) => d.poiId), ["first"]);
  assert.deepEqual(refused.map((d) => d.poiId), ["clashing"]);
});

test("detours that merely touch end-to-end are both applied", () => {
  const a = detour("a", 5_000, 6_000);
  const b = detour("b", 6_000, 7_000);
  const { applied, refused } = orderDetours([a, b]);
  assert.deepEqual(applied.map((d) => d.poiId), ["a", "b"]);
  assert.equal(refused.length, 0);
});

test("a failed detour is never applied and never refuses another", () => {
  const broken: DetourResult = { ok: false, poiId: "hillfort", reason: "unreachable" };
  const good = detour("good", 5_000, 6_000);
  const { applied, refused } = orderDetours([broken, good]);
  assert.deepEqual(applied.map((d) => d.poiId), ["good"]);
  assert.equal(refused.length, 0);
});

/** The ride's own segments: one 20 km asphalt road, cut by the splices. */
const ROUTE_SEGMENTS: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "LineString", coordinates: LINE },
      properties: {
        roadClass: "road",
        surface: "asphalt",
        distanceMeters: Math.round(lineMeters(LINE)),
      } as RouteSegmentProperties,
    },
  ],
};

test("splicing one detour replaces its stretch and adds its delta to the totals", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [detour("one", 10_000, 11_000, 1_000)],
  });
  assert.equal(spliced.distanceMeters, 21_000, "the delta is added to the ride's length");
  assert.equal(spliced.durationSeconds, 3_720, "the delta is added to the ride's time");
  assert.equal(spliced.addedMeters, 1_000);
  // Head, detour, tail: the original road is cut in two and the detour sits
  // between the halves.
  assert.equal(spliced.segments.features.length, 3);
  assert.equal(spliced.segments.features[0].properties.surface, "asphalt");
  assert.equal(spliced.segments.features[1].properties.surface, "gravel");
  assert.equal(spliced.segments.features[2].properties.surface, "asphalt");
  closeTo(spliced.segments.features[0].properties.distanceMeters, 10_000, 30, "head length");
  closeTo(spliced.segments.features[2].properties.distanceMeters, 9_000, 30, "tail length");
});

test("the spliced line actually goes to the sight", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [detour("one", 10_000, 11_000)],
  });
  // The bulge's northern point is in the drawn line; nothing on the original
  // route leaves latitude 57.
  assert.ok(
    spliced.coordinates.some((c) => Math.abs(c[1] - (LAT + 0.005)) < 1e-9),
    "the detour's own vertices must be in the spliced geometry",
  );
});

test("two detours splice without disturbing each other's distances", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [detour("early", 3_000, 4_000, 800), detour("late", 15_000, 16_000, 1_200)],
  });
  assert.equal(spliced.applied.length, 2);
  assert.equal(spliced.distanceMeters, 22_000, "both deltas land");
  // head · early · middle · late · tail
  assert.equal(spliced.segments.features.length, 5);
  closeTo(spliced.segments.features[0].properties.distanceMeters, 3_000, 30, "head");
  closeTo(spliced.segments.features[2].properties.distanceMeters, 11_000, 40, "middle");
  closeTo(spliced.segments.features[4].properties.distanceMeters, 4_000, 30, "tail");
});

test("the second of two overlapping ticks changes nothing but is reported", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [detour("first", 5_000, 6_000, 1_000), detour("clashing", 5_500, 6_500, 900)],
  });
  assert.equal(spliced.applied.length, 1);
  assert.deepEqual(spliced.refused.map((d) => d.poiId), ["clashing"]);
  assert.equal(spliced.distanceMeters, 21_000, "only the applied detour's delta counts");
});

test("unticking is exact: no detours restores the original numbers and line", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [],
  });
  assert.equal(spliced.distanceMeters, 20_000);
  assert.equal(spliced.durationSeconds, 3_600);
  assert.equal(spliced.coordinates.length, LINE.length);
  assert.equal(spliced.segments.features.length, 1);
});

test("the surface mix follows the spliced line, so a gravel detour moves the gravel share", () => {
  const before = splicedSurfaces(ROUTE_SEGMENTS);
  assert.equal(before.asphaltPercent, 100);
  assert.equal(before.gravelPercent, 0);

  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    // A long gravel bulge, so the share is unambiguous rather than a rounding.
    detours: [detour("gravel", 5_000, 6_000)],
  });
  const after = splicedSurfaces(spliced.segments);
  assert.ok(after.gravelPercent > 0, "the detour's gravel must show in the mix");
  assert.equal(after.asphaltPercent + after.gravelPercent + after.dirtPercent + after.unknownPercent, 100);
});

test("the spliced geometry has no duplicated joining vertices", () => {
  const spliced = spliceDetours({
    segments: ROUTE_SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    detours: [detour("one", 10_000, 11_000)],
  });
  for (let i = 1; i < spliced.coordinates.length; i++) {
    const a = spliced.coordinates[i - 1];
    const b = spliced.coordinates[i];
    assert.ok(a[0] !== b[0] || a[1] !== b[1], `duplicate vertex at ${i} would be a zero-length GPX leg`);
  }
});
