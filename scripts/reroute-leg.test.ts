import test from "node:test";
import assert from "node:assert/strict";
import {
  TAP_WINDOW_M,
  anchorsAlong,
  coordinatesOf,
  legForPoint,
  nearestAlong,
  recomputeOverlap,
  spliceLeg,
  tapCut,
  type LegAnchor,
} from "../lib/routing/reroute-leg";
import { cumulative, lineMeters } from "../lib/routing/detour";
import type { Point } from "../lib/geo/geometry";
import type { RouteSegmentProperties } from "../lib/types";

/**
 * Editing a ride on the map, as arithmetic — no router, no network.
 *
 * `npx tsx --test scripts/reroute-leg.test.ts`
 *
 * This is the half of the correction feature that has to be right before a
 * single BRouter request is worth making. Three things can go wrong silently
 * and all three are checked here:
 *
 * 1. **The wrong stretch is replaced.** The cut runs from the anchor before
 *    the edit to the anchor after it; a cut a few hundred metres off splices a
 *    routed leg onto a road it does not join, and the map draws a jump.
 * 2. **The retraced figure stops describing the line.** The rider's one rule
 *    is not riding the same road twice, so an edit that raises retracing must
 *    say so. `recomputeOverlap` is the same measurement `classify.ts` makes,
 *    and the test that matters is the one where an edit makes the number
 *    WORSE and it is reported worse.
 * 3. **A loop's last anchor lands at 0 m.** A round trip ends where it starts,
 *    so pinning the final anchor by proximity puts it at the beginning of the
 *    line and the last leg's replaced stretch runs backwards.
 *
 * The geometry is a due-east line at 57°N (Latvia's latitude), so distances
 * along it can be checked by hand.
 */

const LAT = 57.0;
const M_PER_DEG_LON = 111_320 * Math.cos((LAT * Math.PI) / 180);

/** A due-east line of `km` kilometres, one vertex every 100 m. */
function eastLine(km: number, lat = LAT, lon0 = 24.0): Point[] {
  const out: Point[] = [];
  const steps = Math.round(km * 10);
  for (let i = 0; i <= steps; i++) out.push([lon0 + (i * 100) / M_PER_DEG_LON, lat]);
  return out;
}

const closeTo = (actual: number, expected: number, tolerance: number, what: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${what}: expected ~${expected}, got ${actual}`,
  );

/** One asphalt feature per kilometre, so the cut has joins to land on. */
function segmentsFor(line: Point[], perFeature = 10): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> {
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];
  for (let i = 0; i < line.length - 1; i += perFeature) {
    const slice = line.slice(i, Math.min(i + perFeature + 1, line.length));
    if (slice.length < 2) continue;
    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      properties: {
        roadClass: "road",
        surface: "asphalt",
        distanceMeters: Math.round(lineMeters(slice)),
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const LINE = eastLine(20);
const CUM = cumulative(LINE);
const SEGMENTS = segmentsFor(LINE);

test("the fixture line is the length it claims", () => {
  closeTo(CUM[CUM.length - 1], 20_000, 30, "total length");
  closeTo(lineMeters(coordinatesOf(SEGMENTS)), 20_000, 30, "segments rebuild the same line");
});

test("a place beside the line is found at the right distance along it", () => {
  // 600 m north of the 8 km mark.
  const off: Point = [24.0 + 8_000 / M_PER_DEG_LON, LAT + 600 / 110_540];
  const found = nearestAlong(off, LINE, CUM);
  closeTo(found.alongMeters, 8_000, 60, "along the route");
  closeTo(found.meters, 600, 20, "distance from the route");
});

/** Start, one via at 8 km, finish — a one-way ride. */
const ONE_WAY: LegAnchor[] = [
  { lat: LAT, lon: LINE[0][0], label: "Sigulda", viaIndex: null },
  { lat: LAT + 300 / 110_540, lon: 24.0 + 8_000 / M_PER_DEG_LON, label: "Turaida", viaIndex: 0 },
  { lat: LAT, lon: LINE[LINE.length - 1][0], label: "Cēsis", viaIndex: null },
];

test("anchors are placed along the ride in riding order", () => {
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: ONE_WAY, roundTrip: false });
  closeTo(along[0].alongMeters, 0, 1, "the start is the beginning");
  closeTo(along[1].alongMeters, 8_000, 60, "the via");
  closeTo(along[2].alongMeters, 20_000, 30, "the finish is the end");
  for (let i = 1; i < along.length; i++) {
    assert.ok(along[i].alongMeters >= along[i - 1].alongMeters, "anchors must not go backwards");
  }
});

test("a round trip's last anchor is the END of the line, not the nearest point to the start", () => {
  // A loop: the last anchor IS the start, so proximity would answer 0 m and
  // the final leg's replaced stretch would run backwards. Measured: this
  // turned a 140 km loop into a 6 km one on the first drag of the last stop.
  const loop: LegAnchor[] = [
    { lat: LAT, lon: LINE[0][0], label: "Sigulda", viaIndex: null },
    { lat: LAT, lon: 24.0 + 10_000 / M_PER_DEG_LON, label: "Līgatne", viaIndex: 0 },
    { lat: LAT, lon: LINE[0][0], label: "Sigulda", viaIndex: null },
  ];
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: loop, roundTrip: true });
  closeTo(along[2].alongMeters, 20_000, 30, "the loop closes at the line's end");
  assert.ok(along[2].alongMeters > along[1].alongMeters, "the last leg must run forwards");
});

test("a tap on the line falls in the leg that stretch belongs to", () => {
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: ONE_WAY, roundTrip: false });
  const early = legForPoint({ anchors: along, alongMeters: 3_000 });
  assert.deepEqual(early, { beforeIndex: 0, afterIndex: 1 }, "before the via");
  const late = legForPoint({ anchors: along, alongMeters: 15_000 });
  assert.deepEqual(late, { beforeIndex: 1, afterIndex: 2 }, "after the via");
  // At the very end, where rounding can push past the last anchor.
  const end = legForPoint({ anchors: along, alongMeters: 20_010 });
  assert.deepEqual(end, { beforeIndex: 1, afterIndex: 2 }, "past the finish still belongs to the last leg");
});

test("a tap re-routes a window around itself, not the whole leg", () => {
  // The bug this exists to stop, measured in a browser on the verification
  // ride: Sigulda round trip, 126 km, one via 1 km in. A tap 25 km along fell
  // in the leg "via (1 km) → finish (126 km)", the cut replaced 125 km of
  // ride with one short routed leg, and **the ride came back as 12 km and
  // 43 % retraced**. A tap is not a drag: the rider is adding a point to a
  // stretch he is looking at and keeps everything either side of it.
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: ONE_WAY, roundTrip: false });
  const cut = tapCut({ line: LINE, cum: CUM, anchors: along, alongMeters: 15_000 });
  assert.ok(cut, "a tap on the line must produce a cut");
  closeTo(cut.cut.fromMeters, 15_000 - TAP_WINDOW_M, 1, "cut starts one window back");
  closeTo(cut.cut.toMeters, 15_000 + TAP_WINDOW_M, 1, "cut ends one window on");
  // The ride either side of the window is untouched — the whole point.
  const replaced = cut.cut.toMeters - cut.cut.fromMeters;
  assert.ok(replaced <= TAP_WINDOW_M * 2 + 1, `a tap must not replace ${Math.round(replaced)} m`);
});

test("a tap's window never crosses a neighbouring stop", () => {
  // Past an anchor is a different leg, whose own stop the splice would
  // swallow. With the via at 8 km, a tap at 9.5 km may only reach back to it.
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: ONE_WAY, roundTrip: false });
  const cut = tapCut({ line: LINE, cum: CUM, anchors: along, alongMeters: 9_500 });
  assert.ok(cut);
  closeTo(cut.cut.fromMeters, 8_000, 60, "the cut stops at the via, not 3 km before it");
  closeTo(cut.cut.toMeters, 12_500, 1, "and runs a full window forwards");
});

test("a tap on a short leg behaves exactly like a drag", () => {
  // Two stops 1 km apart: the window is bounded by both anchors, so the tap
  // re-routes the whole leg — which for a leg this short IS the two adjacent
  // legs, and is what a drag would do.
  const close: LegAnchor[] = [
    { lat: LAT, lon: LINE[0][0], label: "A", viaIndex: null },
    { lat: LAT, lon: 24.0 + 5_000 / M_PER_DEG_LON, label: "B", viaIndex: 0 },
    { lat: LAT, lon: 24.0 + 6_000 / M_PER_DEG_LON, label: "C", viaIndex: 1 },
    { lat: LAT, lon: LINE[LINE.length - 1][0], label: "D", viaIndex: null },
  ];
  const along = anchorsAlong({ line: LINE, cum: CUM, anchors: close, roundTrip: false });
  const cut = tapCut({ line: LINE, cum: CUM, anchors: along, alongMeters: 5_500 });
  assert.ok(cut);
  closeTo(cut.cut.fromMeters, 5_000, 60, "bounded by the stop before");
  closeTo(cut.cut.toMeters, 6_000, 60, "bounded by the stop after");
});

test("a line that never repeats itself reports 0 % retraced", () => {
  const overlap = recomputeOverlap(LINE);
  assert.equal(overlap.repeatedPercent, 0);
  closeTo(overlap.distinctKm, 20, 0.2, "distinct km");
});

test("an out-and-back reports half of itself as retraced", () => {
  // The rider's own measure. Out 10 km and back the same way: every metre of
  // the return is a metre already ridden, so exactly half the ride repeats.
  const out = eastLine(10);
  const there: Point[] = [...out, ...[...out].reverse().slice(1)];
  const overlap = recomputeOverlap(there);
  closeTo(overlap.repeatedPercent, 50, 1, "repeated percent");
  closeTo(overlap.repeatedKm, 10, 0.2, "repeated km");
});

/** A replacement leg that bulges 2 km north between 5 km and 12 km along. */
function northBulge(): { line: Point[]; segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> } {
  const from: Point = [24.0 + 5_000 / M_PER_DEG_LON, LAT];
  const to: Point = [24.0 + 12_000 / M_PER_DEG_LON, LAT];
  const up = LAT + 2_000 / 110_540;
  const line: Point[] = [from, [from[0], up], [to[0], up], to];
  return { line, segments: segmentsFor(line, 1) };
}

test("an edit replaces exactly the stretch between its two anchors", () => {
  const bulge = northBulge();
  const replacementMeters = lineMeters(bulge.line);
  const edited = spliceLeg({
    segments: SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    cut: { fromMeters: 5_000, toMeters: 12_000 },
    replacement: {
      segments: bulge.segments,
      distanceMeters: Math.round(replacementMeters),
      durationSeconds: 900,
    },
  });

  // The ride is now: 0-5 km of the original, the bulge, 12-20 km of the original.
  const expected = 5_000 + replacementMeters + 8_000;
  closeTo(edited.distanceMeters, expected, 60, "edited length");
  closeTo(lineMeters(edited.coordinates), expected, 60, "the drawn line is that length");
  // The delta is signed against what it replaced, not the leg's own length.
  closeTo(edited.deltaMeters, replacementMeters - 7_000, 60, "delta over the replaced stretch");
  // The ends are untouched: the first and last vertices are the ride's own.
  assert.deepEqual(edited.coordinates[0], LINE[0], "the start did not move");
  assert.deepEqual(
    edited.coordinates[edited.coordinates.length - 1],
    LINE[LINE.length - 1],
    "the finish did not move",
  );
});

test("an edit's retraced share is recomputed over the whole ride, and may be worse", () => {
  // The edit rides back west along a stretch the ride has already covered:
  // out to 12 km, back to 8 km, then forward again. Retracing rises, and the
  // rider must be shown that rather than the original's 0 %.
  const from: Point = [24.0 + 5_000 / M_PER_DEG_LON, LAT];
  const backtrack: Point[] = [
    ...eastLine(7, LAT, from[0]).slice(0),            // 5 → 12 km, east
    ...eastLine(4, LAT, 24.0 + 8_000 / M_PER_DEG_LON).reverse().slice(1), // 12 → 8 km, back west
    ...eastLine(4, LAT, 24.0 + 8_000 / M_PER_DEG_LON).slice(1),           // 8 → 12 km, east again
  ];
  const edited = spliceLeg({
    segments: SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    cut: { fromMeters: 5_000, toMeters: 12_000 },
    replacement: {
      segments: segmentsFor(backtrack, 5),
      distanceMeters: Math.round(lineMeters(backtrack)),
      durationSeconds: 1_200,
    },
  });
  assert.ok(
    edited.overlap.repeatedPercent > 0,
    `an edit that doubles back must report retracing, got ${edited.overlap.repeatedPercent} %`,
  );
  // ~8 km repeated (4 km ridden three times over) out of ~28 km.
  closeTo(edited.overlap.repeatedKm, 8, 0.5, "repeated km");
});

test("the replaced stretch's segment metadata goes with it, and the rest is kept", () => {
  // A gravel replacement in an asphalt ride: the surfaces of the kept ends are
  // still asphalt and the new middle is gravel, so the map colours the edit
  // brown the first time it draws it.
  const bulge = northBulge();
  for (const f of bulge.segments.features) f.properties.surface = "gravel";
  const edited = spliceLeg({
    segments: SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    cut: { fromMeters: 5_000, toMeters: 12_000 },
    replacement: {
      segments: bulge.segments,
      distanceMeters: Math.round(lineMeters(bulge.line)),
      durationSeconds: 900,
    },
  });
  const gravelMeters = edited.segments.features
    .filter((f) => f.properties.surface === "gravel")
    .reduce((sum, f) => sum + lineMeters(f.geometry.coordinates as Point[]), 0);
  closeTo(gravelMeters, lineMeters(bulge.line), 60, "the gravel is exactly the new leg");
  const asphaltMeters = edited.segments.features
    .filter((f) => f.properties.surface === "asphalt")
    .reduce((sum, f) => sum + lineMeters(f.geometry.coordinates as Point[]), 0);
  closeTo(asphaltMeters, 13_000, 60, "the kept ends are still asphalt");
});

test("an edit at the very start of the ride keeps the finish", () => {
  // The first leg: start → moved via. `fromMeters` is 0, which is the case a
  // cut written as "a bit either side" would get wrong by running negative.
  const replacement = eastLine(9);
  const edited = spliceLeg({
    segments: SEGMENTS,
    distanceMeters: 20_000,
    durationSeconds: 3_600,
    cut: { fromMeters: 0, toMeters: 8_000 },
    replacement: {
      segments: segmentsFor(replacement),
      distanceMeters: Math.round(lineMeters(replacement)),
      durationSeconds: 1_000,
    },
  });
  closeTo(edited.distanceMeters, 9_000 + 12_000, 60, "edited length");
  assert.deepEqual(
    edited.coordinates[edited.coordinates.length - 1],
    LINE[LINE.length - 1],
    "the finish did not move",
  );
});
