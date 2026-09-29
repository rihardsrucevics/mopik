import test from "node:test";
import assert from "node:assert/strict";
import { applySavedEdit, editTargetFor, originOf, rideForEdit } from "../lib/share/saved-edit";
import { encodeRouteShare, decodeRouteShare, decodePlanShare } from "../lib/share/route-code";

// A plan with every default, through the app's own decoder.
const planOf = (c: Record<string, unknown>) => decodePlanShare(Buffer.from(JSON.stringify(c)).toString("base64url"))!;
import type { GeneratedRoute } from "../lib/types";

const row = (id: string, savedAt: number, extra: Record<string, unknown> = {}) => ({ id, name: `ride ${id}`, savedAt, code: id, ...extra });

test("origin: only a ride saved as his own after backlog 44 is his own", () => {
  assert.equal(originOf({ origin: "own" }), "own");
  assert.equal(originOf({ origin: "shared", from: "shared" }), "shared");
  // Saved before origins existed — own planning or a link, nobody knows: shared.
  assert.equal(originOf({}), "shared");
  assert.equal(originOf({ from: "shared" }), "shared");
  // A contradiction reads as the safe one.
  assert.equal(originOf({ origin: "own", from: "shared" }), "shared");
});

test("own ride: edit overwrites the saved original, in its place and with its date", () => {
  const list = [row("a", 300), row("b", 200, { origin: "own" }), row("c", 100)];
  const target = editTargetFor(list[1] as never, "(kopija)");
  assert.deepEqual(target, { mode: "overwrite", id: "b", savedAt: 200 });
  const next = applySavedEdit(list, target, row("b2", 999, { origin: "own" }));
  assert.deepEqual(next.map((r) => r.id), ["a", "b2", "c"]);
  assert.equal(next[1].savedAt, 200, "keeps the original's date, so the list does not reorder");
  assert.equal(next.length, 3, "one entry for one ride");
});

test("own ride edited to nothing new: still one entry", () => {
  const list = [row("b", 200, { origin: "own" })];
  const next = applySavedEdit(list, editTargetFor(list[0] as never, "(kopija)"), row("b", 999, { origin: "own" }));
  assert.deepEqual(next.map((r) => r.id), ["b"]);
});

test("shared ride: edit makes a copy „<name> (kopija)” and leaves the original untouched", () => {
  const original = row("s", 200, { origin: "shared", from: "shared" });
  const list = [row("a", 300), original];
  const target = editTargetFor(original as never, "(kopija)");
  assert.deepEqual(target, { mode: "copy", name: "ride s (kopija)" });
  const next = applySavedEdit(list, target, row("s2", 999, { origin: "own" }));
  assert.deepEqual(next.map((r) => r.id), ["s2", "a", "s"]);
  assert.deepEqual(next[2], original, "the sender's ride is kept byte for byte");
});

test("legacy ride (no origin): edit duplicates, never overwrites", () => {
  const legacy = row("l", 200);
  const target = editTargetFor(legacy as never, "(copy)");
  assert.equal(target.mode, "copy");
  const next = applySavedEdit([legacy], target, row("l2", 999));
  assert.deepEqual(next.map((r) => r.id), ["l2", "l"]);
});

function route(): GeneratedRoute {
  const coords: [number, number][] = [];
  for (let i = 0; i <= 60; i++) coords.push([24.1 + i * 0.001, 56.95 + Math.sin(i / 6) * 0.002]);
  return {
    id: "x", name: "Kuģu iela 26A loks", geometry: { type: "LineString", coordinates: coords },
    segments: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { roadClass: "road", surface: "asphalt", distanceMeters: 3900 } }] },
    distanceMeters: 3900, durationSeconds: 600,
    roadMix: { roadKm: 3.9, trackKm: 0, trailKm: 0, roadPercent: 100, trackPercent: 0, trailPercent: 0 },
    surfaces: { asphaltPercent: 100, gravelPercent: 0, dirtPercent: 0, unknownPercent: 0 },
    quality: { roughTrackKm: 0, sandKm: 0, streetKm: 0, unverifiedPathKm: 0, riddenKm: 0, surfaceSwitches: 0, turnsPer10Km: 0, forestKm: 0, riversideKm: 0, ruralOpenKm: 0, landscapeTransitions: 0, landscapeTypes: 0, elevationGainM: 0, elevationRangeM: 0, natureScore: 0, coastKm: 0, coastNearKm: 0 },
    overlap: { repeatedKm: 0, distinctKm: 3.9, repeatedPercent: 0 }, profile: "hard", sourcePrompt: "", variant: "balanced",
  };
}

test("rideForEdit: a saved round trip reopens with its line and its places by role (backlog 47)", () => {
  const plan = planOf({ s: "Kuģu iela 26A", v: ["Antiņciems", "Ragaciems"], r: true });
  // Saved as the result panel saves an unedited ride: the router's labels as names.
  const places = [
    { name: "Kuģu iela 26A, Rīga", label: "Kuģu iela 26A, Rīga", lat: 56.94, lon: 24.08 },
    { name: "Antiņciems, Lapmežciema pagasts", label: "Antiņciems, Lapmežciema pagasts", lat: 56.97, lon: 23.46 },
    { name: "Ragaciems", label: "Ragaciems", lat: 57.03, lon: 23.49 },
  ];
  const code = encodeRouteShare(route(), "Kuģu iela 26A", plan, places);
  const back = rideForEdit(code)!;
  assert.ok(back, "decodes");
  assert.equal(back.result.routes.length, 1);
  assert.equal(back.result.routes[0].geometry.coordinates.length, decodeRouteShare(code)!.points.length, "the saved line itself");
  assert.equal(back.result.start.lat, 56.94);
  assert.deepEqual(back.result.via!.map((v) => v.lat), [56.97, 57.03]);
  assert.equal(back.result.destination, undefined, "a round trip has no finish");
  assert.equal(back.result.intent.returnToStart, true);
  assert.deepEqual(back.plan.viaPlaces, ["Antiņciems", "Ragaciems"]);
});

test("rideForEdit: one way keeps its finish; a code with no plan or no places is null", () => {
  const plan = planOf({ s: "A", v: [], d: "B", r: false });
  const places = [{ name: "A", label: "A", lat: 56.9, lon: 24.1 }, { name: "B", label: "B", lat: 57, lon: 24.2 }];
  const one = rideForEdit(encodeRouteShare(route(), "A", plan, places))!;
  assert.equal(one.result.destination!.lat, 57);
  assert.deepEqual(one.result.via, []);
  assert.equal(rideForEdit(encodeRouteShare(route(), "A")), null, "no plan");
  assert.equal(rideForEdit(encodeRouteShare(route(), "A", plan)), null, "no coordinates: the form path");
  assert.equal(rideForEdit("garbage"), null);
});
