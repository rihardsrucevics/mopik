import test from "node:test";
import assert from "node:assert/strict";
import { decodeRouteShare, encodeRouteShare, sharedRouteSegments, decodePlanShare, encodePlanShare, planPart, decodePlanPlaces } from "../lib/share/route-code";
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

import { rideId } from "../lib/share/saved-rides";
test("a ride id distinguishes the three versions of one request", () => {
  // The first 24 characters are the metadata prefix, identical across the
  // versions of one request: keying on them meant saving the winding version
  // silently replaced the straight one.
  const direct = "1~eyJuIjoiVGVzdCIsInZhIjoiZGlyZWN0In0~aaa~bbb";
  const complex = "1~eyJuIjoiVGVzdCIsInZhIjoiZGlyZWN0In0~ccc~ddd";
  assert.equal(direct.slice(0, 24), complex.slice(0, 24), "the prefixes really do collide");
  assert.notEqual(rideId(direct), rideId(complex));
  assert.equal(rideId(direct), rideId(direct), "and it is stable");
});

test("the plan part is what prefills the form for editing", () => {
  const plan = RidePlanSchema.parse({
    startPlace: "Sigulda", viaPlaces: ["Līgatne"], destinationPlace: null, directionPlace: null, focusArea: null, returnToStart: true,
    budget: { mode: "duration", value: 2, constraint: "target", minimumValue: null }, difficulty: "adventure", rideStyle: "explore",
    gravelPreference: 70, trailPreference: "some", accessPolicy: "allow_unverified", preferForest: true, noSand: false, avoidTowns: false,
    avoidMainRoads: true, includeTet: false, includeSightseeing: false,
  });
  const withPlan = encodeRouteShare(fakeRoute(), "Sigulda", plan);
  const part = planPart(withPlan);
  assert.ok(part, "a code encoded with a plan carries one");
  assert.deepEqual(decodePlanShare(part!)?.startPlace, "Sigulda", "and it decodes back to the plan");
  assert.deepEqual(decodePlanShare(part!)?.viaPlaces, ["Līgatne"]);

  // Older links and any code encoded without a plan: no edit button, not a crash.
  assert.equal(planPart(encodeRouteShare(fakeRoute(), "Sigulda")), null);
  assert.equal(planPart("1~meta~coords~classes"), null);
});

test("resolved places ride along, so an edited route is not geocoded again", () => {
  const plan = RidePlanSchema.parse({
    startPlace: "Rīga", viaPlaces: ["Circle K"], destinationPlace: null, directionPlace: null, focusArea: null, returnToStart: true,
    budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null }, difficulty: "adventure", rideStyle: "explore",
    gravelPreference: 70, trailPreference: "some", accessPolicy: "allow_unverified", preferForest: true, noSand: false, avoidTowns: false,
    avoidMainRoads: true, includeTet: false, includeSightseeing: false,
  });
  // The exact Circle K the rider picked — one of a dozen in Rīga.
  const places = [
    { name: "Rīga", label: "Rīga", lat: 56.94965, lon: 24.10518 },
    { name: "Circle K", label: "Circle K · degviela · Lubānas iela 119A · Rīga", lat: 56.91234, lon: 24.18765 },
  ];
  const code = encodePlanShare(plan, places);
  const back = decodePlanPlaces(code);
  assert.equal(back.length, 2);
  assert.equal(back[1].label, "Circle K · degviela · Lubānas iela 119A · Rīga");
  // ~1 m of rounding is all that may be lost.
  assert.ok(Math.abs(back[1].lat - 56.91234) < 1e-5);
  assert.ok(Math.abs(back[1].lon - 24.18765) < 1e-5);
  // The plan itself still decodes unchanged.
  assert.equal(decodePlanShare(code)?.startPlace, "Rīga");

  // Older links carry no coordinates, and must decode rather than throw.
  assert.deepEqual(decodePlanPlaces(encodePlanShare(plan)), []);
  assert.deepEqual(decodePlanPlaces("nonsense"), []);
});
