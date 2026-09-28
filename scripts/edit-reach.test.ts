/**
 * The rider's rules of 2026-09-28 for an edit that asks the ride to go
 * somewhere (`lib/map/edit-reach.ts`, `lib/routing/relax.ts`):
 * offer a solution whenever any road reaches the point; roads outside his
 * profile are warned about and taken only with „Tomēr braukt”; no road at
 * all is said plainly; a big detour is said with its numbers.
 *
 *   npx tsx --test scripts/edit-reach.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { lineMeters } from "@/lib/routing/detour";
import { relaxedProfiles, profileAt } from "@/lib/routing/relax";
import { detourRisk, farthestFrom, markOutsideProfile, reachOf } from "@/lib/map/edit-reach";
import { bendMissed, proposalView } from "@/lib/map/proposal-view";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";
import { messages } from "@/lib/i18n/messages";
import type { RouteSegmentProperties } from "@/lib/types";
import type { EditProposal } from "@/lib/map/edit-proposal";

const OWN: MotoProfileOptions = { offRoad: 0.9, difficulty: "hard", trails: "lots", accessPolicy: "allow_unverified", avoidMainRoads: true, avoidMotorways: true, noSand: false, avoidTowns: false };

test("the ladder: his profile without its avoidances first, then car-fast — never trekking", () => {
  const rungs = relaxedProfiles(OWN);
  assert.equal(rungs.length, 2);
  assert.deepEqual(rungs[0].drops, ["mainRoads", "motorways"]);
  assert.equal(rungs[0].options.avoidMainRoads, false);
  assert.equal(rungs[0].options.avoidMotorways, false);
  assert.equal(rungs[0].options.stock, undefined, "rung 1 is still the moto profile");
  assert.equal(rungs[1].options.stock, "car-fast");
  assert.ok(!rungs.some((r) => (r.options.stock as string | undefined) === "trekking"), "trekking rides footways closed to motor vehicles");
  assert.equal(profileAt(OWN, 0)!.options, OWN);
  assert.equal(profileAt(OWN, 3), null, "past the last rung: no road");
});

test("a profile with nothing to drop goes straight to car-fast", () => {
  const open: MotoProfileOptions = { ...OWN, avoidMainRoads: false, avoidMotorways: false };
  const rungs = relaxedProfiles(open);
  assert.equal(rungs.length, 1);
  assert.equal(rungs[0].level, 1);
  assert.equal(rungs[0].options.stock, "car-fast");
  // Every avoidance, and an easier ride, are named.
  const all = relaxedProfiles({ ...OWN, noSand: true, avoidTowns: true, difficulty: "easy", accessPolicy: "verified" })[0].drops;
  assert.deepEqual(all, ["mainRoads", "motorways", "sand", "towns", "rough", "access"]);
});

// The rider's own geometry (scripts/fixtures): the dashed track to the junction is road the old line never rode.
const FX = JSON.parse(readFileSync(new URL("./fixtures/gailisu-purvs-2026-09-28.json", import.meta.url), "utf8")) as { track: Point[]; index: { corner: number; junction: number; tip: number; backAtJunction: number; puķes: number } };
const T = FX.track, I = FX.index;
type Segs = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
const segs = (coords: Point[], extra: Partial<RouteSegmentProperties> = {}): Segs => ({ type: "FeatureCollection", features: [{ type: "Feature", properties: { roadClass: "track", surface: "dirt", distanceMeters: Math.round(lineMeters(coords)), ...extra }, geometry: { type: "LineString", coordinates: coords } }] });

test("only the new metres of a relaxed stretch are marked outside the profile, cut exactly there", () => {
  // The old line: junction → Puķes. The relaxed stretch: the dashed track from the corner, then on down the old line.
  const old = T.slice(I.backAtJunction, I.puķes + 1);
  const routed = T.slice(I.corner, I.junction + 1).concat(T.slice(I.backAtJunction + 1, I.puķes + 1));
  const out = markOutsideProfile(segs(routed, { gates: 1, gatePoints: [T[I.corner + 2]] }), old);
  const marked = out.segments.features.filter((f) => f.properties.outsideProfile);
  const newM = lineMeters(T.slice(I.corner, I.junction + 1));
  assert.ok(Math.abs(out.meters - newM) < 60, `the dashed track, ${Math.round(newM)} m, got ${Math.round(out.meters)}`);
  assert.equal(marked.length, 1);
  assert.ok(out.segments.features.some((f) => !f.properties.outsideProfile), "the old road stays unmarked");
  assert.ok(Math.abs(out.segments.features.reduce((s, f) => s + lineMeters(f.geometry.coordinates as Point[]), 0) - lineMeters(routed)) < 2, "nothing lost in the cut");
  assert.equal(marked[0].properties.gates, 1, "the gate stays on the piece it stands on");
});

test("the big-detour warning: the measured cases", () => {
  // Antiņciems 21 %: +9.1 km on 75 km, 4.5 km off the line, dropped 453 m off.
  assert.deepEqual(detourRisk({ metersBefore: 75_330, metersAfter: 84_430, farthestM: 4_502, reachM: 453 }), { plusMeters: 9_100, farthestM: 4_502 });
  // +10 km or +20 %, either.
  assert.ok(detourRisk({ metersBefore: 100_000, metersAfter: 110_500, farthestM: 500, reachM: 300 }));
  assert.ok(detourRisk({ metersBefore: 30_000, metersAfter: 36_500, farthestM: 500, reachM: 300 }));
  // A real bend: Sigulda 60 %, +0.53 km, 615 m off for a 340 m drag.
  assert.equal(detourRisk({ metersBefore: 55_000, metersAfter: 55_530, farthestM: 615, reachM: 222 }), null);
  // Far, but no farther than the point itself asked: a stop 800 m off, reached 2.5 km out.
  assert.equal(detourRisk({ metersBefore: 55_000, metersAfter: 56_000, farthestM: 2_500, reachM: 800 }), null);
});

test("how far the ride goes, and how far the point is", () => {
  const line = T.slice(0, I.junction + 1);
  assert.ok(farthestFrom(line, line) < 1);
  assert.ok(Math.abs(farthestFrom([T[I.tip]], line) - haversineMeters(T[I.tip], T[I.junction])) < 20, "the tip is its spur's length from the junction");
  assert.equal(reachOf([], line), 0);
  assert.ok(reachOf([T[I.tip], T[5]], line) > 1_000);
  // Rule 5: a bend no nearer is not a solution — it goes to the next rung.
  assert.equal(bendMissed(416, 416), true);
});

test("a proposal that waits for „Tomēr braukt” is drawn and warned, ✓ off", () => {
  const proposal = { token: 1, how: "add-stop", before: {} as never, ride: { segments: segs(T) } as never, changed: [], delta: { kmBefore: 68, kmAfter: 70.3, secondsDelta: 300, repeatedBefore: 2, repeatedAfter: 2 }, notes: ["x"], accept: "profile" } as EditProposal;
  const view = proposalView({ phase: "proposed", proposal, confirmNow: false }, { routing: "r", delta: "{a} → {b} km", deltaTitle: "t" }, "lv")!;
  assert.equal(view.warn, true);
  assert.ok(view.line, "the line is still shown");
  assert.equal(view.tone, undefined);
  const plain = proposalView({ phase: "proposed", proposal: { ...proposal, accept: undefined }, confirmNow: false }, { routing: "r", delta: "{a} → {b} km", deltaTitle: "t" }, "lv")!;
  assert.equal(plain.warn, undefined);
});

test("the copy: four languages, en dashes, the rider's own words", () => {
  const keys = ["editNoRoad", "editOutsideProfile", "editBigDetour", "editDeadEndShapeAsk", "editDeadEndAsk", "editOverrideAccept", "previewConfirmOverride", "badgeOutsideProfile", "relaxMainRoads", "relaxCar"] as const;
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    const m = messages(locale);
    for (const k of keys) {
      assert.ok(m[k] && m[k].length > 1, `${locale}.${k}`);
      assert.ok(!/ - /.test(m[k]), `${locale}.${k} uses an en dash, not a hyphen`);
    }
    // „What is happening” only: what to do is the guidance's tail
    // (lib/map/edit-guidance.ts), said once however many notes there are.
    for (const k of ["editNoRoad", "editOutsideProfile", "editBigDetour", "editDeadEndShapeAsk", "editDeadEndAsk"] as const) {
      assert.ok(!m[k].includes("✕"), `${locale}.${k}: no tail of its own`);
      assert.ok(!m[k].includes(m.editOverrideAccept), `${locale}.${k}: „${m.editOverrideAccept}” is the guidance's`);
    }
    assert.ok(m.guideWarned.includes(m.editOverrideAccept), `${locale}.guideWarned names the chip`);
  }
  const lv = messages("lv");
  assert.equal(lv.editNoRoad.replace("{m}", "340"), "Šeit nevar izbraukt, tuvākais ceļš ir ~340 m nostāk.");
  assert.ok(lv.editBigDetour.replace("{km}", "+9,1").replace("{far}", "4,5").startsWith("+9,1 km, līdz 4,5 km no līdzšinējā maršruta"));
  assert.equal(lv.editOverrideAccept, "Tomēr braukt");
  for (const k of Object.keys(lv) as (keyof typeof lv)[]) assert.ok(!/piesit/i.test(lv[k]), `lv.${k} never says „piesit”`);
});

test("the car-fast rung routes on BRouter's built-in profile: nothing is uploaded", async () => {
  const { uploadProfile } = await import("@/lib/routing/brouter");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 500 }); }) as typeof fetch;
  try {
    assert.equal(await uploadProfile(relaxedProfiles(OWN)[1].options), "car-fast");
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
