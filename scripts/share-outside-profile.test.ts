/**
 * A stretch ridden outside the rider's profile („Tomēr braukt”,
 * `outsideProfile`) keeps its ⚠️ in a shared link, a saved ride and a ride
 * reopened from either — and every code written before it travelled decodes
 * byte for byte as it did.
 *
 *   npx tsx --test scripts/share-outside-profile.test.ts
 *
 * The fixture is a real ride: Antiņciems → Puķes → Rīgas apvedceļš, generated
 * 2026-09-28 by `/api/generate-route` on production BRouter, with the code the
 * encoder of 90ade9d (before this flag) wrote for it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decodeRouteShare, encodeRouteShare, sharedRouteSegments, type ShareMeta } from "@/lib/share/route-code";
import type { GeneratedRoute } from "@/lib/types";

const FX = JSON.parse(readFileSync(new URL("./fixtures/share-antinciems-2026-09-28.json", import.meta.url), "utf8")) as { code: string; route: GeneratedRoute; plan: never; places: never };
const meta = (code: string) => JSON.parse(Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as ShareMeta;

test("a ride with nothing outside its profile encodes exactly as before", () => {
  assert.equal(encodeRouteShare(FX.route, "Antiņciems", FX.plan, FX.places), FX.code);
});

test("an old code decodes as it did: no stretch is outside the profile", () => {
  const share = decodeRouteShare(FX.code);
  assert.ok(share);
  assert.ok(share!.classes.every((c) => !("outsideProfile" in c)));
  assert.ok(sharedRouteSegments(share!).features.every((f) => !("outsideProfile" in f.properties)));
  assert.ok(meta(FX.code).d.every((k) => k.split("|").length === 2));
});

test("an outside-profile stretch travels, and comes back as its own ⚠️ segment", () => {
  // The ride's longest stretch was taken with „Tomēr braukt”.
  const longest = FX.route.segments.features.reduce((best, f, i, all) => (f.properties.distanceMeters > all[best].properties.distanceMeters ? i : best), 0);
  const route: GeneratedRoute = { ...FX.route, segments: { ...FX.route.segments, features: FX.route.segments.features.map((f, i) => (i === longest ? { ...f, properties: { ...f.properties, outsideProfile: true } } : f)) } };
  const code = encodeRouteShare(route, "Antiņciems", FX.plan, FX.places);
  assert.notEqual(code, FX.code);
  const d = meta(code).d;
  assert.ok(d.some((k) => k.endsWith("|o")), `the flag is in the dictionary: ${JSON.stringify(d)}`);
  // An older page reads the first two fields: still the same road and surface.
  const flagged = d.find((k) => k.endsWith("|o"))!;
  const f = FX.route.segments.features[longest].properties;
  assert.equal(flagged.split("|").slice(0, 2).join("|"), `${f.roadClass}|${f.surface}`);
  const segments = sharedRouteSegments(decodeRouteShare(code)!);
  const marked = segments.features.filter((s) => s.properties.outsideProfile);
  assert.ok(marked.length >= 1);
  const km = marked.reduce((s, x) => s + x.properties.distanceMeters, 0) / 1000;
  assert.ok(Math.abs(km - f.distanceMeters / 1000) < 0.3, `≈ the stretch's ${(f.distanceMeters / 1000).toFixed(1)} km, got ${km.toFixed(1)}`);
  assert.equal(marked[0].properties.roadClass, f.roadClass);
  // Everything else as before.
  assert.equal(segments.features.filter((s) => !s.properties.outsideProfile).length >= sharedRouteSegments(decodeRouteShare(FX.code)!).features.length - 1, true);
});
