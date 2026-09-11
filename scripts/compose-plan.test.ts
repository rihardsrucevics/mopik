import test from "node:test";
import assert from "node:assert/strict";
import { composeRidePlan } from "../lib/chat/compose-plan";
import {
  DEFAULT_PROFILE,
  PROFILE_PRESETS,
  normalizeProfile,
  presetIdFor,
  profileFromPlan,
  profileSummary,
  seedPlanFromProfile,
} from "../lib/chat/ride-profile";
import { nextPlanQuestion } from "../lib/chat/ride-plan";

const base = { start: "Rīga", destination: "", stops: [], tripType: "round_trip" as const, durationMode: "hours" as const, hours: 2 };

test("the default profile is the adventure rider: technical, riding, forest", () => {
  const plan = composeRidePlan({ ...base, profile: DEFAULT_PROFILE });
  assert.equal(plan.difficulty, "adventure");
  assert.equal(plan.rideStyle, "explore");
  assert.equal(plan.includeSightseeing, false);
  assert.equal(plan.gravelPreference, 100);
  assert.equal(plan.trailPreference, "lots");
  assert.equal(plan.accessPolicy, "allow_unverified");
  assert.equal(plan.preferForest, true);
});

test("asphalt-only has no difficulty: it is normalised to easy", () => {
  const profile = normalizeProfile({ difficulty: "adventure", style: "riding", surface: "asphalt" });
  assert.equal(profile.difficulty, "rest");
  const plan = composeRidePlan({ ...base, profile: { difficulty: "adventure", style: "riding", surface: "asphalt" } });
  assert.equal(plan.difficulty, "easy");
  assert.equal(plan.gravelPreference, 0);
  assert.equal(plan.accessPolicy, "verified");
  assert.doesNotMatch(profileSummary(profile), /Grūti|Viegli/);
});

test("three difficulty levels map to easy / adventure / hard", () => {
  assert.equal(composeRidePlan({ ...base, profile: { difficulty: "rest", style: "riding", surface: "forest" } }).difficulty, "easy");
  assert.equal(composeRidePlan({ ...base, profile: { difficulty: "adventure", style: "riding", surface: "forest" } }).difficulty, "adventure");
  const hard = composeRidePlan({ ...base, profile: { difficulty: "hard", style: "riding", surface: "forest" } });
  assert.equal(hard.difficulty, "hard");
  assert.equal(profileFromPlan(hard).difficulty, "hard");
});

test("easy forest is a real combination, not a conflict", () => {
  const plan = composeRidePlan({ ...base, profile: { difficulty: "rest", style: "riding", surface: "forest" } });
  assert.equal(plan.difficulty, "easy");
  assert.equal(plan.preferForest, true);
  assert.equal(plan.trailPreference, "lots");
});

test("profile survives a round trip through a plan and presets are recognised", () => {
  for (const preset of PROFILE_PRESETS) {
    const plan = composeRidePlan({ ...base, profile: preset.profile });
    assert.deepEqual(profileFromPlan(plan), normalizeProfile(preset.profile));
    assert.equal(presetIdFor(profileFromPlan(plan)), preset.id);
  }
  assert.equal(presetIdFor({ difficulty: "adventure", style: "tourism", surface: "gravel" }), null);
});

test("a chat seeded with the profile only asks where and how long", () => {
  const seed = seedPlanFromProfile(DEFAULT_PROFILE);
  assert.match(nextPlanQuestion(seed, false)!, /start/);
  const placed = { ...seed, startPlace: "Tukums", returnToStart: true, budget: { mode: "duration" as const, value: 2, constraint: "target" as const, minimumValue: null } };
  assert.equal(nextPlanQuestion(placed, false), null);
});
