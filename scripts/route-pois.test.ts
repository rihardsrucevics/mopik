import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyPois,
  poisForRoute,
  ON_ROUTE_M,
  NEARBY_M,
  MAX_NEARBY,
} from "../lib/poi/route-pois";
import type { Poi, PoiCategory } from "../lib/geo/poi";

/**
 * The on-route / nearby rule, on a polyline whose distances can be checked by
 * hand. The real dataset is 16,410 points, so pinning the rule against it
 * would be testing the data rather than the geometry.
 */

/** A due-east line at 57°N (Latvia's latitude), from 24.0 to 24.2. */
const LINE: [number, number][] = [
  [24.0, 57.0],
  [24.1, 57.0],
  [24.2, 57.0],
];

/** One degree of latitude is ~111.32 km, so this converts metres to a lat offset. */
const latOffset = (meters: number) => meters / 111_320;

const poi = (
  id: string,
  lon: number,
  lat: number,
  category: PoiCategory,
  score = 5
): Poi => ({ id, lon, lat, category, score, country: "LV", nameLv: id, nameEn: id });

test("a point beside the line is on the route, one further out is nearby, one far off is neither", () => {
  const points = [
    // 80 m north of the line: inside the 150 m corridor.
    poi("beside", 24.05, 57.0 + latOffset(80), "viewpoint"),
    // 900 m north: a detour, not a pass-by.
    poi("detour", 24.15, 57.0 + latOffset(900), "hillfort"),
    // 12 km north: a different ride entirely.
    poi("far", 24.1, 57.0 + latOffset(12_000), "manor"),
  ];

  const { onRoute, nearby } = classifyPois({ coordinates: LINE }, points);

  assert.deepEqual(onRoute.map((p) => p.id), ["beside"]);
  assert.deepEqual(nearby.map((p) => p.id), ["detour"]);

  // The distances are the measured perpendicular, not the vertex distance.
  assert.ok(Math.abs(onRoute[0].distanceMeters - 80) < 5, `got ${onRoute[0].distanceMeters} m`);
  assert.ok(Math.abs(nearby[0].distanceMeters - 900) < 15, `got ${nearby[0].distanceMeters} m`);
  assert.ok(onRoute[0].distanceMeters <= ON_ROUTE_M);
  assert.ok(nearby[0].distanceMeters > ON_ROUTE_M && nearby[0].distanceMeters <= NEARBY_M);
});

test("along-route position is measured in riding order, not as the crow flies", () => {
  // 24.0 -> 24.2 at 57°N is ~12.1 km; a point at 24.15 sits ~9.1 km in.
  const points = [
    poi("late", 24.15, 57.0 + latOffset(50), "viewpoint"),
    poi("early", 24.02, 57.0 + latOffset(50), "manor"),
    poi("middle", 24.1, 57.0 + latOffset(50), "mill"),
  ];

  const { onRoute } = classifyPois({ coordinates: LINE }, points);

  assert.deepEqual(onRoute.map((p) => p.id), ["early", "middle", "late"]);
  assert.ok(onRoute[0].alongKm < 2, `early at ${onRoute[0].alongKm} km`);
  assert.ok(
    onRoute[2].alongKm > 8 && onRoute[2].alongKm < 10,
    `late at ${onRoute[2].alongKm} km`
  );
});

test("nearby is capped and ranks what a rider stops for above villages", () => {
  const points: Poi[] = [];
  // Twenty villages, all a comfortable detour away.
  for (let i = 0; i < 20; i++) {
    points.push(poi(`village${i}`, 24.0 + i * 0.005, 57.0 + latOffset(600), "village", 9));
  }
  // One viewpoint, further out and with a lower dataset score.
  points.push(poi("viewpoint", 24.09, 57.0 + latOffset(1200), "viewpoint", 6));

  const { nearby } = classifyPois({ coordinates: LINE }, points);

  assert.equal(nearby.length, MAX_NEARBY);
  assert.ok(
    nearby.some((p) => p.id === "viewpoint"),
    "a viewpoint must outrank villages even from further out"
  );
});

test("an empty or degenerate geometry answers with empty lists, never an error", () => {
  assert.deepEqual(poisForRoute(null), { onRoute: [], nearby: [] });
  assert.deepEqual(poisForRoute({ coordinates: [] }), { onRoute: [], nearby: [] });
  assert.deepEqual(poisForRoute({ coordinates: [[24, 57]] }), { onRoute: [], nearby: [] });
});

test("a real Sigulda ride finds named places, and the lookup is milliseconds", () => {
  // A ~30 km box around Sigulda, sampled densely enough to look like a route.
  const coordinates: [number, number][] = [];
  const box: [number, number][] = [
    [24.82, 57.15],
    [24.95, 57.18],
    [24.98, 57.08],
    [24.84, 57.05],
    [24.82, 57.15],
  ];
  for (let i = 0; i < box.length - 1; i++) {
    for (let s = 0; s < 40; s++) {
      const t = s / 40;
      coordinates.push([
        box[i][0] + t * (box[i + 1][0] - box[i][0]),
        box[i][1] + t * (box[i + 1][1] - box[i][1]),
      ]);
    }
  }
  coordinates.push(box[box.length - 1]);

  // Warm the dataset: the first call reads and indexes 16,410 points from
  // disk, which is not what the per-request cost is.
  poisForRoute({ coordinates });

  const started = performance.now();
  const { onRoute, nearby } = poisForRoute({ coordinates }, { locale: "lv" });
  const ms = performance.now() - started;

  assert.ok(onRoute.length > 0 || nearby.length > 0, "expected named places near Sigulda");
  assert.ok(nearby.length <= MAX_NEARBY);
  assert.ok(ms < 60, `lookup took ${Math.round(ms)} ms — the grid prefilter is not working`);
});

test("outside the dataset both lists are empty rather than an error", () => {
  // A short line in Bavaria: routable, but the pre-baked POIs stop at the
  // Baltic border (backlog item 8).
  const munich: [number, number][] = [
    [11.5, 48.1],
    [11.6, 48.15],
    [11.7, 48.2],
  ];
  assert.deepEqual(poisForRoute({ coordinates: munich }), { onRoute: [], nearby: [] });
});
