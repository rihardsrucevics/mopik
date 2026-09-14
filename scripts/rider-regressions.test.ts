// Run: npx tsx --test scripts/rider-regressions.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { parseDirectionPlace, parseDestinationPlace, parseRoutePromptHeuristic } from "../lib/ai/parse-route-prompt";
import { planLoop } from "../lib/routing/loop";
import { bearingDegrees, inSector } from "../lib/geo/geometry";
import { loopRank } from "../lib/routing/score";
import { RouteIntentSchema } from "../lib/types";

test("Ropaži direction survives independently of endpoint, without implicit TET", () => {
  const prompt = "6h ride from Riga to Ropazi direction and back. forest as much as possible.";
  assert.equal(parseDirectionPlace(prompt), "Ropazi");
  assert.equal(parseDestinationPlace(prompt), undefined);
  const intent = parseRoutePromptHeuristic(prompt);
  assert.equal(intent.durationHours, 6);
  assert.equal(intent.preferForest, true);
  assert.equal(intent.gravelPreference, 100);
  assert.equal(intent.includeTet, false);
  assert.equal(intent.includeSightseeing, false);
  assert.equal(intent.trailPreference, "some");
});

test("directions in both languages are not destinations; explicit destinations survive", () => {
  for (const p of ["from Riga towards Sigulda", "no Rīgas uz Siguldas pusi"]) {
    assert.ok(parseDirectionPlace(p));
    assert.equal(parseDestinationPlace(p), undefined);
  }
  assert.equal(parseDestinationPlace("from Riga to Cesis"), "Cesis");
  assert.equal(parseRoutePromptHeuristic("TET 3h from Riga").includeTet, true);
  assert.equal(parseRoutePromptHeuristic("3h from Riga, sightseeing").includeSightseeing, true);
  assert.equal(parseRoutePromptHeuristic("3h from Riga, no sightseeing").includeSightseeing, false);
});

test("unrequested attractions never become via points; a north-crossing sector stays ordered", () => {
  const start = { lat: 56.95, lon: 24.1 };
  const sector = { centreDeg: 355, halfWidthDeg: 50 };
  const plan = planLoop({ start, sector, fallbackRadiusMeters: 18000, stopCount: 5, bearingOffsetDeg: 0 });
  assert.ok(plan.stops.every(s => !s.poi));
  assert.ok(plan.viaPoints.every(p => inSector(bearingDegrees([start.lon, start.lat], p), sector)));
  const bearings = plan.viaPoints.map(p => (bearingDegrees([start.lon, start.lat], p) - 355 + 540) % 360 - 180);
  assert.deepEqual(bearings, [...bearings].sort((a,b) => a-b));
});

test("forest ranking distinguishes tracks from gravel roads above the gravel floor", () => {
  const intent = RouteIntentSchema.parse({ preferForest: true, gravelPreference: 100 });
  const base = { repeatedPercent: 3, unpavedPercent: 80, trackPercent: 20, trailPercent: 0, streetPercent: 5, excessDriftPercent: 0 };
  const moreTracks = { ...base, trackPercent: 60 };
  assert.ok(loopRank(intent, moreTracks) < loopRank(intent, base));
  assert.ok(loopRank(intent, { ...moreTracks, trackPercent: 70 }) < loopRank(intent, moreTracks));
  assert.ok(loopRank(intent, { ...moreTracks, repeatedPercent: 40 }) > loopRank(intent, base));
  const ordinary = RouteIntentSchema.parse({ gravelPreference: 100 });
  assert.equal(loopRank(ordinary, base), loopRank(ordinary, moreTracks));
});

import { pruneSpurs } from "../lib/routing/prune-spurs";
import type { RoutePath } from "../lib/types";

test("spur removal preserves access corridors, real circuits and original edge tags", () => {
  // Access A-B; circuit B-C-D-E-C-B; unnecessary excursion D-X-Y-X-D.
  const A = [24,57], B = [24.01,57], C = [24.02,57], D = [24.03,57],
    E = [24.03,57.01], X = [24.04,57], Y = [24.05,57];
  const coordinates = [A,B,C,D,X,Y,X,D,E,C,B,A] as [number,number][];
  const path: RoutePath = { coordinates, distanceMeters: 10000, durationSeconds: 1000,
    edges: coordinates.slice(1).map((_,i) => ({ beginShapeIndex:i, endShapeIndex:i+1, tags:{ highway: "track", marker:String(i+1) } })) };
  const clean = pruneSpurs(path);
  assert.deepEqual(clean.coordinates, [A,B,C,D,E,C,B,A]);
  assert.deepEqual(clean.edges.map(e => e.tags?.marker), ["1","2","3","8","9","10","11"]);
  assert.ok(clean.distanceMeters < path.distanceMeters);
  assert.deepEqual(pruneSpurs(clean), clean);
  assert.throws(() => pruneSpurs({ ...path, coordinates: [A,B,C,B,A] as [number,number][] }), /no circuit/);
});

import { createTetMatcher } from "../lib/routing/tet-coverage";
test("TET is reported for sustained following, in either direction, not a crossing", () => {
  const match = createTetMatcher([{ name: "TET test", coordinates: [[24,57],[24.03,57]] }]);
  const forward = match([[24.002,57],[24.025,57]]);
  assert.ok(forward && forward.sliceKm > 1);
  assert.deepEqual(match([[24.025,57],[24.002,57]]), forward);
  assert.equal(match([[24.015,56.99],[24.015,57.01]]), undefined);
  assert.equal(match([[24.002,57.002],[24.025,57.002]]), undefined);
  assert.equal(match([[24,57],[24.002,57]]), undefined);
  assert.equal(createTetMatcher([])([[24,57],[24.03,57]]), undefined);
});

import { isBeachLikePath } from "../lib/routing/access";
import { buildMotoProfile } from "../lib/routing/moto-profile";
test("the sea is to ride along, not on (backlog item 11, measured 2026-09-14)", () => {
  // The beach itself stays refused.
  assert.equal(isBeachLikePath({ highway: "path", surface: "sand" }), true);
  // But sand is NOT the test on its own: most sand these rides use is
  // deep-forest track kilometres inland, which is what the rider asks for.
  // Banning it would have cost 9.2 km of the right riding to fix 2.8 km of
  // the wrong riding.
  assert.equal(isBeachLikePath({ highway: "track", surface: "sand", tracktype: "grade3" }), false);
  assert.equal(isBeachLikePath({ highway: "track", surface: "sand" }), false);
  // "impassable" is dear, never forbidden — refusing it cost Rīga → Ainaži a
  // 20.6 km detour to avoid 1.8 km.
  assert.equal(isBeachLikePath({ highway: "track", smoothness: "impassable" }), false);

  const hard = buildMotoProfile({
    offRoad: 1, difficulty: "hard", trails: "lots", accessPolicy: "allow_unverified",
    avoidMainRoads: true, avoidMotorways: true, noSand: false, avoidTowns: false,
  });
  // The shoreline-path cost must be folded into the path cost itself: a
  // `multiply` after `switch highway=path` in `costfactor` is dead code, and
  // measuring that cost a whole round (12.0, 500 and 100000 all moved nothing).
  assert.match(hard, /switch highway=path multiply shore_path_factor/);
  assert.doesNotMatch(hard, /^\s*multiply shore_path_factor\s*$/m);
  // Only a path pays it. Every road class keeps river_factor's discount, so
  // riding *beside* the sea must never get more expensive.
  assert.match(hard, /assign shore_path_factor =\n\s+switch or estimated_river_class=5 estimated_river_class=6 4\.0\n\s+1\.0/);
  assert.match(hard, /assign river_factor =\n\s+switch or estimated_river_class=5 estimated_river_class=6 0\.92/);
  // A generated profile must never carry a stray backtick out of the template.
  assert.doesNotMatch(hard, /`/);
});
