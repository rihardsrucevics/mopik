import test from "node:test";
import assert from "node:assert/strict";
import { decodeRouteShare, encodeRouteShare, sharedRouteSegments, decodePlanShare, encodePlanShare } from "../lib/share/route-code";
import { RidePlanSchema } from "../lib/chat/ride-plan";
import type { GeneratedRoute } from "../lib/types";

function fakeRoute(): GeneratedRoute {
  // A 3 km wiggle east of Baldone with three surface stretches.
  const coords: [number, number][] = [];
  for (let i = 0; i <= 60; i++) coords.push([24.39 + i * 0.0006, 56.74 + Math.sin(i / 6) * 0.0015]);
  const seg = (from: number, to: number, roadClass: "road" | "track", surface: "asphalt" | "gravel" | "unknown") => ({
    type: "Feature" as const, geometry: { type: "LineString" as const, coordinates: coords.slice(from, to + 1) }, properties: { roadClass, surface, distanceMeters: 1000 },
  });
  return {
    id: "x", name: "Baldone tests", geometry: { type: "LineString", coordinates: coords },
    segments: { type: "FeatureCollection", features: [seg(0, 20, "road", "asphalt"), seg(20, 45, "track", "gravel"), seg(45, 60, "track", "unknown")] },
    distanceMeters: 3200, durationSeconds: 5400, roadMix: {} as GeneratedRoute["roadMix"], surfaces: { asphaltPercent: 30, gravelPercent: 50, dirtPercent: 10, unknownPercent: 10 },
    quality: {} as GeneratedRoute["quality"], overlap: { repeatedKm: 0.2, distinctKm: 3, repeatedPercent: 6 }, profile: "moto", sourcePrompt: "", variant: "complex",
  };
}

test("a route survives the trip through the URL", () => {
  const code = encodeRouteShare(fakeRoute(), "Baldone");
  assert.match(code, /^1~[A-Za-z0-9_-]+~[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/, "only URL-safe characters");
  const back = decodeRouteShare(code)!;
  assert.equal(back.name, "Baldone tests"); assert.equal(back.km, 3); assert.equal(back.minutes, 90);
  assert.equal(back.unpavedPercent, 60); assert.equal(back.repeatedPercent, 6); assert.equal(back.variant, "complex");
  assert.ok(back.points.length >= 10 && back.points.length <= 61);
  // Ends are exact to 1e-5°, the line stays within the simplification tolerance.
  assert.ok(Math.abs(back.points[0][0] - 24.39) < 1e-5 && Math.abs(back.points.at(-1)![1] - (56.74 + Math.sin(10) * 0.0015)) < 1e-5);
  const segs = sharedRouteSegments(back);
  const surfaces = segs.features.map((f) => f.properties.surface);
  assert.deepEqual(surfaces, ["asphalt", "gravel", "unknown"]);
  assert.equal(back.plan, null);
});

test("garbage decodes to null, not a crash", () => {
  assert.equal(decodeRouteShare("2~abc~def~ghi"), null);
  assert.equal(decodeRouteShare("1~%%%~x~y"), null);
  assert.equal(decodeRouteShare(""), null);
});

test("the plan rides along and comes back complete", () => {
  const plan = RidePlanSchema.parse({
    startPlace: "Rīga", viaPlaces: [], destinationPlace: null, directionPlace: null, focusArea: "Baldone", returnToStart: true,
    budget: { mode: "duration", value: 3, constraint: "target", minimumValue: null }, difficulty: "hard", rideStyle: "explore",
    gravelPreference: 100, trailPreference: "lots", accessPolicy: "allow_unverified", preferForest: true, noSand: false, avoidTowns: false,
    avoidMainRoads: true, includeTet: false, includeSightseeing: false,
  });
  const code = encodeRouteShare(fakeRoute(), "Rīga", plan);
  const back = decodeRouteShare(code)!;
  assert.equal(back.plan?.focusArea, "Baldone"); assert.equal(back.plan?.budget.value, 3); assert.equal(back.plan?.difficulty, "hard");
  assert.equal(decodePlanShare(encodePlanShare(plan))?.startPlace, "Rīga");
  assert.equal(decodePlanShare("nope"), null);
});
