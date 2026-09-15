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

import { planSummary } from "../lib/chat/ride-plan";
import { joinPaths } from "../lib/routing/join-paths";
test("a focus area reads as transit → loop → transit, with the budget scope", () => {
  const remote = RidePlanSchema.parse({ ...complete, startPlace: "Rīga", viaPlaces: [], focusArea: "Baldone", budgetScope: "focus" });
  const lv = planSummary(remote, "lv");
  assert.match(lv, /^Rīga → Baldone \(aplis\) → Rīga · ~ 2 h aplim/);
  assert.match(planSummary({ ...remote, budgetScope: "total" }, "lv"), /~ 2 h · /);
  assert.match(planSummary(remote, "en"), /Baldone \(loop\)/);
  // Older plans without the new fields still parse, as a plain loop.
  const legacy = RidePlanSchema.parse({ ...complete, focusArea: undefined, budgetScope: undefined });
  assert.equal(legacy.focusArea, null); assert.equal(legacy.budgetScope, "total");
});
test("joined legs keep edge indices aligned and drop the shared junction point", () => {
  const out = { distanceMeters: 1000, durationSeconds: 60, coordinates: [[24, 57], [24.01, 57]] as [number, number][], edges: [{ beginShapeIndex: 0, endShapeIndex: 1, tags: { highway: "primary" } }] };
  const loop = { distanceMeters: 2000, durationSeconds: 120, coordinates: [[24.01, 57], [24.02, 57.01], [24.01, 57]] as [number, number][], edges: [{ beginShapeIndex: 0, endShapeIndex: 2, tags: { highway: "track" } }] };
  const back = { ...out, coordinates: [[24.01, 57], [24, 57]] as [number, number][] };
  const joined = joinPaths([out, loop, back]);
  assert.equal(joined.distanceMeters, 4000);
  assert.equal(joined.coordinates.length, 2 + 2 + 1);
  assert.deepEqual(joined.edges.map((e) => [e.beginShapeIndex, e.endShapeIndex]), [[0, 1], [1, 3], [3, 4]]);
  assert.equal(joined.edges[1].tags?.highway, "track");
});

import { describeInfeasible, estimateLegs, exceedsBudget } from "../lib/chat/feasibility";
test("a via ride that cannot fit the time is said plainly, with the ways out as taps", () => {
  const riga = { lat: 56.9496, lon: 24.1052 };
  const jelgava = { lat: 56.6511, lon: 23.7213 };
  const plan = RidePlanSchema.parse({ ...complete, startPlace: "Rīga", viaPlaces: ["Jelgava"], avoidMainRoads: true });
  // 33 km/h is the planner's pace for gravel 100 + lots of trails, 58 on asphalt.
  const estimate = estimateLegs([riga, jelgava, riga], 33, 58, true);
  assert.ok(estimate.directKm > 95 && estimate.directKm < 115, `direct ${estimate.directKm} km`);
  assert.ok(estimate.directMinutes > 120 * 1.2, `direct ${estimate.directMinutes} min`);
  assert.equal(estimate.oneWayKm, Math.round(estimate.directKm / 2));
  assert.equal(exceedsBudget(plan, estimate), true);
  // Routed: the shortest forest ride was 136 km / 241 min (2026-09-11).
  const verdict = describeInfeasible(plan, { ...estimate, minimumMinutes: 241, minimumKm: 136 }, true);
  assert.match(verdict.message, /^Rīga → Jelgava → Rīga pa meža un grants ceļiem 2 h ietvaros nesanāk: taisnākais ceļš turp un atpakaļ ir ~\d+ km, pa meža un grants ceļiem tas ir ap 3 h/);
  assert.match(verdict.message, /Īsākais, ko šeit var izplānot pa meža un grants ceļiem, ir 4 h 1 min \/ 136 km/);
  assert.deepEqual(verdict.quickReplies.map((r) => r.label), ["Kopā 4 h", "Pa asfaltu 2 h", "Vienā virzienā Rīga → Jelgava"]);
  // Before routing there is no minimum yet; the suggestion rounds the estimate up.
  const early = describeInfeasible(plan, estimate, true);
  assert.doesNotMatch(early.message, /Īsākais/);
  assert.equal(early.quickReplies[0].label, "Kopā 3.5 h");
  // The chips must survive the chat's deterministic normalisation.
  assert.match(verdict.quickReplies[1].message, /^Segums: tikai asfalts\. Apmēram 2 stundas kopā\.$/);
  assert.match(verdict.quickReplies[2].message, /^Vienvirziena brauciens Rīga → Jelgava/);
  // A ride that fits asks nothing: Rīga → Baldone → Rīga in 2 h.
  const baldone = { lat: 56.7424, lon: 24.4001 };
  assert.equal(exceedsBudget(plan, estimateLegs([riga, baldone, riga], 33, 58, true)), false);
  // Asphalt riders are not offered asphalt; one-way riders are not offered one way.
  const asphalt = RidePlanSchema.parse({ ...plan, gravelPreference: 0, trailPreference: "none", preferForest: false, returnToStart: false, viaPlaces: [], destinationPlace: "Jelgava" });
  const oneWay = describeInfeasible(asphalt, { ...estimateLegs([riga, jelgava], 58, 58, false), directMinutes: 200 }, true);
  assert.deepEqual(oneWay.quickReplies.map((r) => r.label), ["Kopā 3.5 h"]);
  assert.match(oneWay.message, /^Rīga → Jelgava pa asfaltu 2 h ietvaros nesanāk: taisnākais ceļš ir ~\d+ km/);
});

import { ANY_ANSWERS, applyAnyAnswer, isAnyAnswer, lastAssistantQuestion, pendingQuestion, planSummary as summary, withoutRepeat } from "../lib/chat/ride-plan";

/**
 * Backlog item 23, the rider's own case: a one-way ride, ~100 km along the
 * Italian TET from Lake Como. The chat asked where it should finish, he said
 * "Vienalga", and it asked again. These pin every layer of the fix that does
 * not need the model.
 */
const oneWayNoEnd = RidePlanSchema.parse({
  ...complete, startPlace: "Como", viaPlaces: [], returnToStart: false, destinationPlace: null,
  includeTet: true, budget: { mode: "distance", value: 100, constraint: "target", minimumValue: null },
});

test("every phrase in the any-answer list is recognised, punctuation and case aside", () => {
  for (const phrase of ANY_ANSWERS) {
    assert.equal(isAnyAnswer(phrase), true, phrase);
    assert.equal(isAnyAnswer(`${phrase.toUpperCase()}!`), true, phrase);
    assert.equal(isAnyAnswer(`  ${phrase}.  `), true, phrase);
  }
  // The rider's exact screenshot answer, and the polite lead-ins around it.
  assert.equal(isAnyAnswer("Vienalga"), true);
  assert.equal(isAnyAnswer("Nu vienalga"), true);
  assert.equal(isAnyAnswer("Ok, whatever."), true);
  // Not an "any" answer: a constraint, a place, a refusal.
  assert.equal(isAnyAnswer("vienalga, tikai ne uz Jūrmalu"), false);
  assert.equal(isAnyAnswer("man vienalga patīk Cēsis"), false);
  assert.equal(isAnyAnswer("Cēsis"), false);
  assert.equal(isAnyAnswer("nē"), false);
  assert.equal(isAnyAnswer(""), false);
});

test("the pending question is read off the previous plan, in the order the chat asks", () => {
  assert.equal(pendingQuestion(null), null);
  assert.equal(pendingQuestion({ ...complete, startPlace: null }), "start");
  assert.equal(pendingQuestion({ ...complete, returnToStart: null }), "return");
  assert.equal(pendingQuestion(oneWayNoEnd), "destination");
  assert.equal(pendingQuestion({ ...complete, budget: { ...complete.budget, mode: "unknown", value: null } }), "budget");
  assert.equal(pendingQuestion({ ...complete, difficulty: "unknown" }), "difficulty");
  assert.equal(pendingQuestion({ ...complete, gravelPreference: null }), "surface");
  assert.equal(pendingQuestion({ ...complete, rideStyle: "unknown" }), "style");
  assert.equal(pendingQuestion(complete), null);
});

test("“vienalga” to the destination question means no fixed destination, and is never asked again", () => {
  assert.match(nextPlanQuestion(oneWayNoEnd, true)!, /Kur vēlies beigt/);
  const answered = applyAnyAnswer(oneWayNoEnd, "destination", "Vienalga");
  assert.equal(answered.destinationAny, true);
  assert.equal(answered.destinationPlace, null, "the same shape the form's “Nav obligāts — man vienalga” row builds");
  assert.equal(answered.returnToStart, false, "still a one-way ride");
  // The ride is now complete: no question, and it can be planned.
  assert.equal(nextPlanQuestion(answered, true), null);
  const intent = planToIntent(answered);
  assert.equal(intent.routeType, "point_to_point");
  assert.equal(intent.distanceKm, 100);
  // And the rider sees that the finish is open rather than missing.
  assert.match(summary(answered, "lv"), /Como → galamērķis brīvs/);
  assert.match(summary(answered, "en"), /Como → any finish/);
});

test("the destination question carries the “man vienalga” tap the form has always had", () => {
  const prompt = nextPlanPrompt(oneWayNoEnd, true)!;
  assert.equal(prompt.question, "destination");
  assert.deepEqual(prompt.quickReplies.map((r) => r.label), ["Man vienalga"]);
  assert.equal(isAnyAnswer(prompt.quickReplies[0].message), false, "the chip says more than the bare word");
  // …so the chip is placed by the model, and the bare word by the fallback.
  assert.equal(applyAnyAnswer(oneWayNoEnd, "destination", "vienalga").destinationAny, true);
});

test("the parallel questions answer to “vienalga” with the planner's own default", () => {
  // Return: a ride that ends nowhere in particular is a loop home.
  assert.equal(applyAnyAnswer({ ...complete, returnToStart: null }, "return", "vienalga").returnToStart, true);
  // Budget: flexible, which is what the chat already did for the bare word.
  const free = applyAnyAnswer({ ...complete, budget: { ...complete.budget, mode: "unknown", value: null } }, "budget", "nesvarbu");
  assert.equal(free.budget.mode, "flexible");
  // Difficulty, surface and style have visible defaults and are left alone.
  assert.equal(applyAnyAnswer({ ...complete, difficulty: "unknown" }, "difficulty", "vienalga").difficulty, "unknown");
  // A real answer is never touched.
  assert.equal(applyAnyAnswer(oneWayNoEnd, "destination", "Milāna").destinationAny, false);
  assert.equal(applyAnyAnswer(oneWayNoEnd, null, "vienalga").destinationAny, false);
});

test("the same question is never asked twice — the second turn offers the choices", () => {
  const prompt = nextPlanPrompt(oneWayNoEnd, true)!;
  // Nothing was asked before, or something else was: the question stands.
  assert.equal(withoutRepeat(prompt, null, oneWayNoEnd, true).message, prompt.message);
  assert.equal(withoutRepeat(prompt, "Cik daudz laika atvēlam?", oneWayNoEnd, true).message, prompt.message);
  // The same question, word for word — and with the punctuation moved.
  for (const asked of ["Kur vēlies beigt šo vienvirziena braucienu?", "kur vēlies beigt šo vienvirziena braucienu"]) {
    const second = withoutRepeat(prompt, asked, oneWayNoEnd, true);
    assert.notEqual(second.message, prompt.message, asked);
    assert.match(second.message, /Nosauc vietu, vai saki “vienalga”/);
    // The offer is the ride's own terms, not a shrug: TET, 100 km, from Como.
    assert.match(second.message, /pa TET ~100 km no Como/);
    assert.equal(second.question, "destination", "still the same question underneath");
  }
  // Generic: it guards every question, not only the destination one.
  const style = nextPlanPrompt({ ...complete, rideStyle: "unknown" }, true)!;
  assert.match(withoutRepeat(style, style.message, complete, true).message, /vai saki “vienalga”/);
});

test("the question the rider is answering is the last one the chat asked", () => {
  assert.equal(lastAssistantQuestion([]), null);
  assert.equal(lastAssistantQuestion([{ role: "user", content: "Vienalga" }]), null);
  assert.equal(
    lastAssistantQuestion([
      { role: "assistant", content: "Sapratu: vienvirziena brauciens no Komo.\n\nKur vēlies beigt šo vienvirziena braucienu?" },
      { role: "user", content: "Vienalga" },
    ]),
    "Kur vēlies beigt šo vienvirziena braucienu?",
  );
  // A reply with no question at all offers nothing to repeat.
  assert.equal(lastAssistantQuestion([{ role: "assistant", content: "Gatavs — maršruts kartē." }]), null);
});
