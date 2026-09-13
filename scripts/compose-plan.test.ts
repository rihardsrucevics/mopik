import test from "node:test";
import assert from "node:assert/strict";
import { composeRidePlan, placesFromPlan } from "../lib/chat/compose-plan";
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

const base = { places: ["Rīga"], tripType: "round_trip" as const, durationMode: "hours" as const, hours: 2 };

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

test("an ordered list becomes a plan, and survives the round trip back", () => {
  const round = composeRidePlan({ ...base, places: ["Rīga", "Baldone", "Ķekava"], profile: DEFAULT_PROFILE });
  assert.equal(round.startPlace, "Rīga");
  assert.deepEqual(round.viaPlaces, ["Baldone", "Ķekava"]);
  assert.equal(round.destinationPlace, null, "a round trip has no destination — it returns to the start");
  assert.equal(round.returnToStart, true);
  assert.deepEqual(placesFromPlan(round), ["Rīga", "Baldone", "Ķekava"]);

  const oneWay = composeRidePlan({ ...base, places: ["Rīga", "Baldone", "Cēsis"], tripType: "one_way", profile: DEFAULT_PROFILE });
  assert.deepEqual(oneWay.viaPlaces, ["Baldone"], "everything before the last place is a waypoint");
  assert.equal(oneWay.destinationPlace, "Cēsis");
  assert.equal(oneWay.returnToStart, false);
  assert.deepEqual(placesFromPlan(oneWay), ["Rīga", "Baldone", "Cēsis"]);
});

test("order is the rider's, and blanks are dropped", () => {
  const plan = composeRidePlan({ ...base, places: ["Rīga", "  ", "Sigulda", "Līgatne"], profile: DEFAULT_PROFILE });
  assert.deepEqual(plan.viaPlaces, ["Sigulda", "Līgatne"], "empty rows never become stops");
  const swapped = composeRidePlan({ ...base, places: ["Rīga", "Līgatne", "Sigulda"], profile: DEFAULT_PROFILE });
  assert.deepEqual(swapped.viaPlaces, ["Līgatne", "Sigulda"], "reordering changes the ride");
});

test("a plan with neither stops nor destination is just a loop from home", () => {
  const plan = composeRidePlan({ ...base, places: ["Tukums"], profile: DEFAULT_PROFILE });
  assert.equal(plan.startPlace, "Tukums");
  assert.deepEqual(plan.viaPlaces, []);
  assert.equal(plan.returnToStart, true);
});

test("an absent plan is one way; an edited plan keeps the shape it had", () => {
  // The default decides what the two rows mean. One way is the default
  // because it is the ride that uses both of them — "No … Līdz …".
  // `returnToStart` is nullable, so null (the chat has not asked yet) must
  // fall through to one way rather than being read as a loop.
  const shape = (returnToStart: boolean | null) => (returnToStart === true ? "round_trip" : "one_way");
  assert.equal(shape(null), "one_way", "an unanswered plan is not a loop");
  assert.equal(shape(false), "one_way");
  assert.equal(shape(true), "round_trip", "a saved loop reopens as a loop");

  // And the plan survives the trip: a loop edited in the form stays a loop.
  const loop = composeRidePlan({ ...base, places: ["Sigulda", "Līgatne"], profile: DEFAULT_PROFILE });
  assert.equal(loop.returnToStart, true);
  assert.equal(shape(loop.returnToStart), "round_trip");
});

test("the form always offers From and To", () => {
  assert.deepEqual(placesFromPlan(null), ["", ""], "an empty form asks where from and where to");

  // A one-place plan (a loop from home) still shows the second row, so the
  // rider can add a destination without hunting for the add button.
  const loop = composeRidePlan({ ...base, places: ["Tukums"], profile: DEFAULT_PROFILE });
  assert.deepEqual(placesFromPlan(loop), ["Tukums", ""], "a one-place plan keeps an empty second row");

  // And the offered row costs nothing when it is left alone: blanks are
  // dropped, so "Tukums" with an untouched second field is still a plain loop.
  const fromForm = composeRidePlan({ ...base, places: ["Tukums", ""], profile: DEFAULT_PROFILE });
  assert.deepEqual(fromForm.viaPlaces, []);
  assert.equal(fromForm.destinationPlace, null);
  assert.equal(fromForm.returnToStart, true);

  // One way with an empty "Līdz" is "man vienalga": a direction-free ride, not
  // a destination of "".
  const vienalga = composeRidePlan({ ...base, places: ["Tukums", ""], tripType: "one_way", profile: DEFAULT_PROFILE });
  assert.equal(vienalga.destinationPlace, null, "an empty Līdz is no destination, not a blank one");
  assert.deepEqual(vienalga.viaPlaces, []);
});

test("adding a stop never eats the destination", () => {
  // The rider's report: on a one-way ride "Pievienot pieturvietu" appended an
  // empty row, which *is* the destination slot — so Liepāja stopped being the
  // finish and became a waypoint the moment a stop was added.
  const addStop = (list: string[], oneWay: boolean) =>
    !oneWay || list.length < 2 ? [...list, ""] : [...list.slice(0, -1), "", list[list.length - 1]];

  assert.deepEqual(addStop(["Rīga", "Liepāja"], true), ["Rīga", "", "Liepāja"], "the finish stays last");
  assert.deepEqual(addStop(["Rīga", "", "Liepāja"], true), ["Rīga", "", "", "Liepāja"]);
  // A round trip has no destination to protect; the end is the right place.
  assert.deepEqual(addStop(["Rīga", "Sigulda"], false), ["Rīga", "Sigulda", ""]);
  // And with only a start there is nothing to insert before.
  assert.deepEqual(addStop(["Rīga"], true), ["Rīga", ""]);

  // The plan agrees: Liepāja is the destination, the blank is dropped.
  const plan = composeRidePlan({ ...base, places: ["Rīga", "", "Liepāja"], tripType: "one_way", profile: DEFAULT_PROFILE });
  assert.equal(plan.destinationPlace, "Liepāja");
  assert.deepEqual(plan.viaPlaces, []);
});
