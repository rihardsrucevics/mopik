import test from "node:test";
import assert from "node:assert/strict";
import { RidePlanSchema, nextPlanPrompt, nextPlanQuestion, planToIntent } from "../lib/chat/ride-plan";
import { visitsRequiredStops } from "../lib/routing/required-stops";

const complete = RidePlanSchema.parse({
  startPlace: "Ķekava", viaPlaces: ["Baldone"], destinationPlace: null, directionPlace: null,
  returnToStart: true, budget: { mode: "duration", value: 2, constraint: "target" },
  difficulty: "adventure", rideStyle: "explore", gravelPreference: 100,
  trailPreference: "lots", preferForest: true, noSand: false, avoidTowns: false,
  avoidMainRoads: false, includeTet: false, includeSightseeing: false,
});

test("missing duration and difficulty never silently become defaults", () => {
  assert.match(nextPlanQuestion({ ...complete, budget: { ...complete.budget, mode: "unknown", value: null } }, false)!, /How much time/);
  assert.throws(() => planToIntent({ ...complete, difficulty: "unknown" }), /technical/);
  // The style question now uses the composer vocabulary (Tourism / Riding / Mix).
  assert.match(nextPlanQuestion({ ...complete, rideStyle: "unknown" }, false)!, /riding style/);
  assert.equal(nextPlanQuestion(complete, false), null);
});

test("finite clarification questions include tap targets", () => {
  const returnPrompt = nextPlanPrompt({ ...complete, returnToStart: null }, true)!;
  assert.equal(returnPrompt.quickReplies.length, 2);
  assert.match(returnPrompt.message, /Ķekava/);
  const durationPrompt = nextPlanPrompt({ ...complete, budget: { ...complete.budget, mode: "unknown", value: null } }, true)!;
  assert.deepEqual(durationPrompt.quickReplies.map((reply) => reply.label), ["Apmēram 2 h", "Apmēram 4 h", "Ilgums brīvs"]);
});
test("maximum and flexible budgets remain distinct", () => {
  const max = planToIntent({ ...complete, budget: { ...complete.budget, constraint: "maximum" } });
  assert.equal(max.durationIsMaximum, true); assert.equal(max.durationHours, 2);
  assert.equal(planToIntent(complete).durationIsMaximum, false);
  const free = planToIntent({ ...complete, budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null } });
  assert.equal(free.durationHours, undefined); assert.equal(free.distanceKm, undefined);
});
test("Baldone is preserved while difficulty and duration change", () => {
  const revised = RidePlanSchema.parse({ ...complete, difficulty: "easy", budget: { mode: "duration", value: 3, constraint: "maximum" } });
  assert.deepEqual(revised.viaPlaces, ["Baldone"]);
  assert.equal(planToIntent(revised).returnToStart, true);
  assert.equal(planToIntent(revised).difficulty, "easy");
});
test("required places are checked along segments and in order", () => {
  const route: [number,number][] = [[24,57],[24.04,57],[24.04,57.04]];
  assert.equal(visitsRequiredStops(route, [[24.02,57],[24.04,57.02]], 10), true);
  assert.equal(visitsRequiredStops(route, [[24.04,57.02],[24.02,57]], 10), false);
  assert.equal(visitsRequiredStops(route, [[24.02,57.02]], 300), false);
});

import { meetsRideLimits } from "../lib/routing/score";
import { hasBeachLikePath, hasUnverifiedMotorPath } from "../lib/routing/access";
test("2–3 h and below 10% overlap are real acceptance bounds", () => {
  const intent = planToIntent({ ...complete, budget: { mode: "duration", value: 3, minimumValue: 2, constraint: "range" }, maxRepeatedPercent: 9.9, prioritizeLowOverlap: true });
  assert.equal(intent.durationHours, 3);
  assert.equal(intent.minimumDurationHours, 2);
  const valid = { durationSeconds: 2.5*3600, distanceMeters: 100000, repeatedPercent: 8 };
  assert.equal(meetsRideLimits(intent, valid), true);
  assert.equal(meetsRideLimits(intent, { ...valid, repeatedPercent: 23 }), false);
  assert.equal(meetsRideLimits(intent, { ...valid, durationSeconds: 3.4*3600 }), false);
  assert.equal(meetsRideLimits(intent, { ...valid, durationSeconds: 1.5*3600 }), false);
});

test("sandy paths are beach-like while unknown forest tracks remain eligible", () => {
  const path = (tags: Record<string,string>) => ({ distanceMeters: 100, durationSeconds: 10, coordinates: [[24,57],[24.001,57]] as [number,number][], edges: [{ beginShapeIndex: 0, endShapeIndex: 1, tags }] });
  assert.equal(hasBeachLikePath(path({ highway: "path", surface: "sand" })), true);
  assert.equal(hasUnverifiedMotorPath(path({ highway: "path", surface: "ground" })), true);
  assert.equal(hasUnverifiedMotorPath(path({ highway: "path", motorcycle: "yes" })), false);
  assert.equal(hasBeachLikePath(path({ highway: "track", surface: "sand" })), false);
});
