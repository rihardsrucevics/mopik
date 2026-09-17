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

test("a sight's kind survives the trip, and a typed stop stays typed", () => {
  const plan = RidePlanSchema.parse({
    startPlace: "Sigulda", viaPlaces: ["Gūtmaņa ala", "Turaida"], destinationPlace: null, directionPlace: null,
    returnToStart: true, budget: { mode: "flexible", value: null, constraint: "target", minimumValue: null },
    difficulty: "adventure", rideStyle: "explore", gravelPreference: 60, trailPreference: "some",
    accessPolicy: "allow_unverified", preferForest: true, noSand: false, avoidTowns: false,
    avoidMainRoads: false, includeTet: false, includeSightseeing: true,
  });
  const places = [
    // Typed into the form: no kind, so the map keeps its 🅿️.
    { name: "Turaida", label: "Turaida", lat: 57.18333, lon: 24.85 },
    // Ticked in Ieteikumi: carries the POI category and the OSM id.
    { name: "Gūtmaņa ala", label: "Gūtmaņa ala", lat: 57.1762, lon: 24.84236, kind: "waterfall", poiId: "n249778754" },
  ];
  const back = decodePlanPlaces(encodePlanShare(plan, places));
  assert.equal(back.length, 2);

  const typed = back.find((p) => p.name === "Turaida")!;
  assert.equal(typed.kind, undefined, "a typed stop carries no kind");
  assert.equal(typed.poiId, undefined);

  const sight = back.find((p) => p.name === "Gūtmaņa ala")!;
  assert.equal(sight.kind, "waterfall");
  assert.equal(sight.poiId, "n249778754");
  assert.ok(Math.abs(sight.lat - 57.1762) < 1e-5);
  assert.ok(Math.abs(sight.lon - 24.84236) < 1e-5);

  // The plan still decodes, and both vias are still in it.
  assert.deepEqual(decodePlanShare(encodePlanShare(plan, places))?.viaPlaces, ["Gūtmaņa ala", "Turaida"]);

  // A code written before sights carried a kind — four elements per row — must
  // still decode, with every place reading as typed.
  const legacy = encodePlanShare(plan, places.map(({ name, label, lat, lon }) => ({ name, label, lat, lon })));
  assert.deepEqual(decodePlanPlaces(legacy).map((p) => p.kind), [undefined, undefined]);
});

/**
 * Gates on the road through a share code — backlog item 12.
 *
 * The field is `g`, a COUNT, and it replaced `y`, which was kilometres of
 * "suspect" road from the yard-inference build the rider rejected. Both halves
 * of that change are load-bearing here: a new code carries the count, and an
 * old code carrying `y` must still decode — links live in riders' chats forever
 * — while showing nothing, because its kilometres are not this number.
 */
function routeWithGates(gateCount: number | undefined): GeneratedRoute {
  const route = fakeRoute();
  return { ...route, quality: { ...route.quality, gateCount } };
}

const shareMeta = (code: string) =>
  JSON.parse(
    Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  );

test("a gate count survives the trip through the URL", () => {
  const back = decodeRouteShare(encodeRouteShare(routeWithGates(7), "Baldone"))!;
  assert.equal(back.details?.gateCount, 7);
  // A count, so it stays an integer rather than being rounded to one decimal
  // the way every kilometre field in the code is.
  assert.equal(shareMeta(encodeRouteShare(routeWithGates(7), "Baldone")).g, 7);
});

test("no gates and not measured both stay out of the code, and read as undefined", () => {
  // Zero costs bytes in every link for a field most rides do not use, and the
  // shared page must not render either case as "no gates": one is a measured
  // zero, the other is a country nobody has built the data for, and neither is
  // worth a row. `undefined` is what keeps the RISKI row silent for both.
  for (const count of [0, undefined]) {
    const code = encodeRouteShare(routeWithGates(count), "Baldone");
    assert.equal(shareMeta(code).g, undefined, `count ${count} writes no key`);
    assert.equal(decodeRouteShare(code)!.details?.gateCount, undefined);
  }
});

test("a pre-count code's `y` decodes without claiming to be a gate count", () => {
  // `y` was yardKm — the length of road the rejected inference called suspect.
  // Showing it as "Vārti uz ceļa · 0.7" would be a lie about a different thing,
  // so the decoder reads it and says nothing.
  const code = encodeRouteShare(fakeRoute(), "Baldone");
  const [version, meta, ...rest] = code.split("~");
  const legacyMeta = { ...JSON.parse(Buffer.from(meta.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")), y: 0.74 };
  const legacy = [
    version,
    Buffer.from(JSON.stringify(legacyMeta)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    ...rest,
  ].join("~");

  const back = decodeRouteShare(legacy);
  assert.ok(back, "an old link still decodes — that is the whole point of the version prefix");
  assert.equal(back.details?.gateCount, undefined);
  // And everything else in that old code is untouched by the rename.
  assert.equal(back.name, "Baldone tests");
  assert.equal(back.km, 3);
});

test("a share link carries the sender's language; a saved ride does not", () => {
  // The language is what makes the card speak to the person who receives the
  // link, so it has to survive the trip through the URL.
  const withLocale = encodeRouteShare(fakeRoute(), "Baldone", null, null, "et");
  assert.equal(decodeRouteShare(withLocale)!.locale, "et");

  // ...but only when the link-building path asked for it. `rideId()` hashes
  // the whole code, so a key written on every encode would change the id of
  // every ride already saved on a rider's device and orphan all of them.
  const saved = encodeRouteShare(fakeRoute(), "Baldone");
  assert.equal(decodeRouteShare(saved)!.locale, null, "no language unless one was passed");
  assert.equal(saved, encodeRouteShare(fakeRoute(), "Baldone"), "the saved-ride code is unchanged");

  // Old links, already sitting in riders' chats, carry no language at all and
  // must keep decoding rather than becoming "route not found".
  const old = "1~eyJuIjoiVmVjcyIsInZhIjoiY29tcGxleCIsImttIjozLCJtaW4iOjkwLCJ1cCI6NjAsInJlcCI6NiwicyI6IkJhbGRvbmUiLCJkIjpbInJvYWR8YXNwaGFsdCJdfQ~ghq6Kw170E8HwWwB~AKCK";
  const back = decodeRouteShare(old);
  assert.ok(back, "a code that predates the language field still decodes");
  assert.equal(back!.locale, null, "and reports no language, so the card falls back");

  // A code is user-supplied: an unknown value must not reach messages().
  const bogus = encodeRouteShare(fakeRoute(), "Baldone", null, null, "klingon" as never);
  assert.equal(decodeRouteShare(bogus)!.locale, null, "an unknown language is refused, not trusted");
});
