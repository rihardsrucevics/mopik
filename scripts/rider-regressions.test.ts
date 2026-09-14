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

test("estimated_river_class is a RIVER signal, not a sea one (item 11b, measured 2026-09-14)", () => {
  // Item 11b asked for a costfactor discount that scales with river class for
  // roads/tracks, so that riding the coast on a real road beats the inland
  // alternative. It was built, swept and measured out again: BRouter CANNOT
  // SEE THE SEA, so there is nothing for such a discount to key on.
  //
  // The proof is in BRouter's own lookups.dat (1.7.10): the tag vocabulary has
  // `waterway=river|canal|riverbank|...` and no `natural` key at all — no
  // `coastline`, no `water`, no `sea`. `estimated_river_class` is derived from
  // `waterway`, which is why it tracks the Gauja and the Venta and not the
  // Baltic.
  //
  // Measured over the six coastal legs, on roads and tracks only (paths
  // excluded), class >= 4 is LESS common beside the sea than inland:
  //   within 1 km of the coastline : 88.2 km ridden, 5.3% at class >= 4
  //   inland (> 1 km)              : 681.1 km ridden, 7.2% at class >= 4
  // And probed directly onto known coastal roads — the P111 at Jurkalne, the
  // Pāvilosta seafront, the Kolka cape road — every one reports class 1 or no
  // class at all.
  //
  // So the discount was implemented anyway and swept, since the brief asked
  // for it to be measured rather than argued:
  //   strong=0.70 : 103.5 -> 104.8 km within 1 km of the sea (+1.3, noise)
  //   strong=0.40 : 103.5 -> 105.6 km (+2.1, and +2.1 km of shoreline path)
  //   strong=0.15 : 103.5 ->  98.3 km (WORSE) and +16 km of total distance —
  //                 a strong discount chases inland rivers, which is exactly
  //                 what the tag actually marks.
  // It was reverted. Do not rebuild it against estimated_river_class.
  //
  // This test pins the one thing that must stay true: no road class may be
  // given a water-keyed discount beyond river_factor's existing mild one,
  // because the key does not mean what such a discount would assume.
  const hard = buildMotoProfile({
    offRoad: 1, difficulty: "hard", trails: "lots", accessPolicy: "allow_unverified",
    avoidMainRoads: true, avoidMotorways: true, noSand: false, avoidTowns: false,
  });
  assert.doesNotMatch(hard, /water_road_factor/);
  // river_factor stays mild and applies to every class equally — it is a
  // "scenic parallel road wins a close call" nudge, not a coast seeker.
  assert.match(hard, /assign river_factor =\n\s+switch or estimated_river_class=5 estimated_river_class=6 0\.92\n\s+switch or estimated_river_class=3 estimated_river_class=4 0\.97\n\s+1\.0/);
  // The path-side signal is real and must survive: on paths, class >= 5 is
  // 19% of the metres within 300 m of the sea against 1% elsewhere. That is
  // what shore_path_factor keys on, and why it works where a road-side
  // version cannot.
  assert.match(hard, /assign shore_path_factor =/);
});
