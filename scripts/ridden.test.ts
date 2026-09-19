import test from "node:test";
import assert from "node:assert/strict";
import {
  loadRiddenSections,
  measureRiddenCoverage,
  riddenStepFlags,
  riddenMetersFrom,
  pickRiddenSlice,
  setRiddenSectionsForTest,
  clearRiddenMatcherCache,
} from "../lib/routing/ridden";
import { loopRank } from "../lib/routing/score";
import { classifyRoute } from "../lib/routing/classify";
import { haversineMeters, type Point } from "../lib/geo/geometry";
import type { RouteIntent, RoutePath } from "../lib/types";

/**
 * Backlog item 6 — roads the rider has ridden.
 *
 * Three things are pinned here, and they are the three the layer could get
 * wrong in ways nothing else would catch: what counts as "on a ridden road",
 * that the term can never buy retracing, and that riding one clears the
 * unverified-access flag without ever clearing an explicit restriction.
 *
 * No network: every test either uses the built `public/ridden.geojson` or
 * installs its own fixture.
 */

/** A straight line of `count` points heading east, ~`stepM` apart. */
function line(start: Point, count: number, stepM = 25, bearing: "e" | "n" = "e"): Point[] {
  const dLon = stepM / (111320 * Math.cos((start[1] * Math.PI) / 180));
  const dLat = stepM / 110540;
  return Array.from({ length: count }, (_, i) =>
    bearing === "e" ? [start[0] + dLon * i, start[1]] : [start[0], start[1] + dLat * i]
  ) as Point[];
}

test("the built layer carries the rider's roads in Latvia and Estonia", () => {
  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
  const sections = loadRiddenSections();
  assert.ok(sections.length > 0, "no sections built — run scripts/build-ridden.ts");
  const km = sections.reduce((n, s) => n + s.lengthKm, 0);
  // 31 km recorded + ~194 km snapped + ~90 km snapped, less what is dropped.
  assert.ok(km > 250, `expected the three rides, got ${km.toFixed(0)} km`);
  // Both countries the sources cross must be represented in the router file.
  assert.ok(sections.some((s) => s.coordinates.some((c) => c[1] > 57.6)), "no Estonian geometry");
  assert.ok(sections.some((s) => s.coordinates.some((c) => c[1] < 57.2)), "no Latvian geometry");
});

test("a ride along a ridden road is recognised; one crossing it is not", () => {
  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
  const sections = loadRiddenSections();
  const section = sections.find((s) => s.coordinates.length > 200);
  assert.ok(section, "no long section to test against");

  // Riding the road itself.
  const along = section.coordinates.slice(20, 160);
  const covered = measureRiddenCoverage(along);
  assert.ok(covered, "a slice of a ridden road was not recognised as ridden");
  assert.ok(covered.sliceKm > 0.5, `only ${covered.sliceKm} km matched`);

  // Crossing it at right angles: the matcher's direction and 300 m run rules
  // must reject this, or every junction with a ridden road would read as one.
  const mid = section.coordinates[80];
  const across = line([mid[0], mid[1] - 0.02], 200, 25, "n");
  const crossing = measureRiddenCoverage(across);
  assert.equal(crossing, undefined, "a road merely crossing a ridden one was counted as ridden");
});

test("a ride nowhere near a contributed road reports nothing, and does not throw", () => {
  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
  // Mid-Atlantic: no GPX, no crash. Absence is an answer.
  assert.equal(measureRiddenCoverage(line([-30, 40], 50)), undefined);
  assert.equal(measureRiddenCoverage([]), undefined);
  assert.deepEqual(riddenStepFlags([]), []);
});

test("step flags mark the ridden stretch and leave the rest alone", () => {
  // A fixture, so the geometry under test is exactly known: 3 km of ridden
  // road, and a route that follows 1.5 km of it then leaves at a right angle.
  const road = line([24.0, 57.0], 120, 25);
  setRiddenSectionsForTest([{ name: "fixture", coordinates: road }]);
  clearRiddenMatcherCache();

  const onRoad = road.slice(0, 60);
  const away = line([onRoad[59][0], onRoad[59][1]], 60, 25, "n").slice(1);
  const route = [...onRoad, ...away];

  const flags = riddenStepFlags(route);
  const riddenM = riddenMetersFrom(route, flags);
  const totalM = riddenMetersFrom(route, flags.map(() => true));
  assert.ok(riddenM > 1000, `expected over 1 km recognised, got ${riddenM.toFixed(0)} m`);
  // The leg heading away must not be counted: that is the whole point of a
  // per-step verdict rather than a whole-route one.
  assert.ok(riddenM < totalM * 0.75, `the departing leg was counted too (${riddenM.toFixed(0)}/${totalM.toFixed(0)} m)`);

  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
});

test("a ridden road may never buy retracing", () => {
  // The rider's rule from item 11, generalised: a reference layer's term is
  // bounded so far below the repeated-road penalty that it cannot outrank it.
  const intent = {
    gravelPreference: 50, trailPreference: "some", difficulty: "medium", rideStyle: "balanced",
    prioritizeLowOverlap: false, preferForest: false, avoidTowns: false, includeSightseeing: false,
  } as unknown as RouteIntent;
  const base = {
    repeatedPercent: 0, unpavedPercent: 55, trackPercent: 25, trailPercent: 3,
    streetPercent: 0, excessDriftPercent: 0, natureScore: 50,
  };

  // A candidate entirely on ridden roads, against a clean one on none.
  const allRidden = loopRank(intent, { ...base, riddenPercent: 100 });
  const none = loopRank(intent, { ...base, riddenPercent: 0 });
  assert.ok(allRidden < none, "the ridden term does not help at all");

  // The whole bound in one assertion: the most the term can ever be worth,
  // expressed as retracing it could buy. `repeatedPercent` enters at 1x, so
  // the break-even is the weight itself — and it must stay under 5 %.
  const gain = none - allRidden;
  assert.ok(gain <= 5, `the ridden term is worth ${gain} rank points — it could buy ${gain} % retracing`);

  // Stated the way it will actually be violated if someone raises the weight:
  // a fully-ridden candidate that retraces 5 % must lose to a clean one.
  const riddenButRetracing = loopRank(intent, { ...base, repeatedPercent: 5, riddenPercent: 100 });
  assert.ok(
    riddenButRetracing > none,
    "a ridden candidate that retraces 5 % outranked a clean one — the layer is buying retracing"
  );

  // And under `prioritizeLowOverlap` the penalty doubles, so it buys half.
  const strict = { ...intent, prioritizeLowOverlap: true } as RouteIntent;
  assert.ok(
    loopRank(strict, { ...base, repeatedPercent: 3, riddenPercent: 100 }) >
      loopRank(strict, { ...base, repeatedPercent: 0, riddenPercent: 0 }),
    "with prioritizeLowOverlap the ridden term still bought 3 % retracing"
  );
});

test("the ridden term cannot outrank the tracks and trails a rider came for", () => {
  const intent = {
    gravelPreference: 80, trailPreference: "lots", difficulty: "hard", rideStyle: "explore",
    prioritizeLowOverlap: false, preferForest: false, avoidTowns: false, includeSightseeing: false,
  } as unknown as RouteIntent;
  const base = { repeatedPercent: 0, streetPercent: 0, excessDriftPercent: 0, natureScore: 50 };
  // A ridden asphalt ride against an unridden one that found the forest.
  const riddenAsphalt = loopRank(intent, {
    ...base, unpavedPercent: 5, trackPercent: 2, trailPercent: 0, riddenPercent: 100,
  });
  const unriddenForest = loopRank(intent, {
    ...base, unpavedPercent: 60, trackPercent: 45, trailPercent: 10, riddenPercent: 0,
  });
  assert.ok(unriddenForest < riddenAsphalt, "a ridden asphalt ride outranked an unridden forest one");
});

/** A one-edge path whose geometry is `coords` and whose tags are `tags`. */
function pathOf(coords: Point[], tags: Record<string, string>): RoutePath {
  let meters = 0;
  for (let i = 1; i < coords.length; i++) meters += haversineMeters(coords[i - 1], coords[i]);
  return {
    coordinates: coords,
    distanceMeters: meters,
    durationSeconds: Math.round(meters / 10),
    edges: [{
      beginShapeIndex: 0,
      endShapeIndex: coords.length - 1,
      use: tags.highway,
      surface: tags.surface,
      unpaved: tags.surface !== "asphalt",
      lengthKm: meters / 1000,
      tags,
    }],
  } as unknown as RoutePath;
}

test("riding a ridden road counts as verified access, and clears the badge", () => {
  const road = line([24.0, 57.0], 200, 25);
  const untagged = { highway: "path" };

  // Not ridden: a plain highway=path is unverified, and flagged as such.
  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
  const before = classifyRoute(pathOf(road, untagged));
  assert.ok(before.quality.unverifiedPathKm > 1, `expected unverified km, got ${before.quality.unverifiedPathKm}`);
  assert.ok(
    before.segments.features.some((f) => f.properties.unverified),
    "an unridden path carried no ⚠️ — the fixture is wrong"
  );

  // The same path, now on a road the rider has ridden.
  setRiddenSectionsForTest([{ name: "fixture", coordinates: road }]);
  clearRiddenMatcherCache();
  const after = classifyRoute(pathOf(road, untagged));
  assert.ok(after.quality.riddenKm > 1, `the road was not recognised as ridden (${after.quality.riddenKm} km)`);
  assert.ok(
    after.quality.unverifiedPathKm < before.quality.unverifiedPathKm * 0.25,
    `unverified km barely moved: ${before.quality.unverifiedPathKm} → ${after.quality.unverifiedPathKm}`
  );
  // The badge and the number must agree; a ⚠️ on a stretch the panel does not
  // count reads as a bug to the rider.
  assert.ok(
    !after.segments.features.some((f) => f.properties.unverified),
    "a ridden path still carried the unverified badge"
  );

  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
});

test("a ridden road never launders an explicit restriction", () => {
  // The rule this must not break is item 12's: we do not guess about private
  // roads. `motor_vehicle=private` is a statement, not a missing tag, and
  // riding past it once changes nothing.
  const road = line([24.0, 57.0], 200, 25);
  setRiddenSectionsForTest([{ name: "fixture", coordinates: road }]);
  clearRiddenMatcherCache();

  // The classifier's own predicate is only ever true for an untagged path, so
  // the guarantee is structural: a restricted way is refused by the profile
  // long before classification, and an explicitly-permitted one was never
  // unverified. What is pinned here is that the ridden layer does not somehow
  // invent access on a way that carries a negative tag.
  const restricted = classifyRoute(pathOf(road, { highway: "path", motor_vehicle: "private" }));
  assert.equal(restricted.quality.unverifiedPathKm, 0, "a private path is not 'unverified', it is refused");
  assert.ok(restricted.quality.riddenKm > 1, "the fixture road should still read as ridden");

  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
});

test("a slice of ridden road is offered as via points near a start", () => {
  setRiddenSectionsForTest(null);
  clearRiddenMatcherCache();
  const sections = loadRiddenSections();
  const section = sections.find((s) => s.coordinates.length > 200);
  assert.ok(section, "no long section");
  const near = section.coordinates[100];

  const slice = pickRiddenSlice({ lat: near[1], lon: near[0] }, 8000, 0, 8);
  assert.ok(slice, "no slice offered beside a ridden road");
  assert.ok(slice.viaPoints.length >= 2, "a slice needs via points to steer with");
  assert.ok(slice.entryDistanceKm < 1, `the slice starts ${slice.entryDistanceKm} km away`);
  // Every via must sit on the road it came from, or the "candidate" steers the
  // router somewhere nobody rode.
  for (const via of slice.viaPoints) {
    const onRoad = measureRiddenCoverage(section.coordinates);
    assert.ok(onRoad, "section not self-matching");
    const nearest = Math.min(...section.coordinates.map((c) => haversineMeters(c, via)));
    assert.ok(nearest < 50, `a via point sits ${nearest.toFixed(0)} m off the ridden road`);
  }

  // Far from any contributed GPX there is simply nothing to offer.
  assert.equal(pickRiddenSlice({ lat: 40, lon: -30 }, 8000, 0, 8)?.sectionName ?? null, null);
});
