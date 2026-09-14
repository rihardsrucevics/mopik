import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { poiCountries, poisNear, hasPlaceData, type Poi } from "../lib/geo/poi";
import { planLoop } from "../lib/routing/loop";

/**
 * The country label, against the real published files.
 *
 * ## What was wrong
 *
 * The shipped `poi-baltics.geojson` was built from Overpass *bounding boxes*,
 * and Overpass honours the rectangle rather than the border. Measured in that
 * file: 326 "LV" points lay south of Latvia — Klaipėda ferry terminals,
 * villages named in Cyrillic near Pskov, and one "LV" ferry on the
 * Karlshamn–Klaipėda line, which is in Sweden. The LV rectangle started at
 * lat 55.6 and was queried first, so the shared thinning pass let it claim
 * every Lithuanian point north of that line: about a third of Lithuania was
 * filed as LV.
 *
 * That is not cosmetic. `loop.ts` picks anchors by proximity and has no
 * country rule at all — the intended rule is geometric — so a Latvian loop
 * near Bauska would happily anchor on `Geručių senovės gynybinis įtvirtinimas`
 * and report it as a Latvian stop, and `hasPlaceData()` gated the honesty
 * notice on the same wrong label.
 *
 * The Geofabrik extracts are clipped to the actual country polygon, so the fix
 * is the data. These tests are what says so out loud, and what would catch a
 * regression to rectangle-built files.
 */

const published = path.join(process.cwd(), "public", "poi");
const haveData = fs.existsSync(path.join(published, "index.json"));

/** The cell size the published index was written at, read rather than assumed. */
const cellDegrees = (): number =>
  haveData
    ? (JSON.parse(fs.readFileSync(path.join(published, "index.json"), "utf-8")) as {
        cellDegrees: number;
      }).cellDegrees
    : 1;

/** Daugavpils and Bauska: the two Latvian towns closest to the LT border. */
const DAUGAVPILS = { lat: 55.8833, lon: 26.5333 };
const BAUSKA = { lat: 56.4083, lon: 24.1917 };

/**
 * Latvia's southern border runs at roughly lat 55.67 at its lowest.
 * A point labelled LV below that is in Lithuania, Belarus or the sea.
 */
const LV_SOUTH_LIMIT = 55.67;

test("every published country is labelled from its own clipped file", { skip: !haveData }, () => {
  for (const c of poiCountries()) {
    const fc = JSON.parse(
      fs.readFileSync(path.join(published, `${c.cc}.geojson`), "utf-8")
    ) as GeoJSON.FeatureCollection<GeoJSON.Point, { country: string }>;
    assert.equal(fc.features.length, c.count, `${c.cc}: index count matches the file`);
    const foreign = fc.features.filter((f) => f.properties.country !== c.cc);
    assert.equal(foreign.length, 0, `${c.cc}: ${foreign.length} points carry another country`);
  }
});

test("no LV point lies south of Latvia", { skip: !haveData }, () => {
  if (!poiCountries().some((c) => c.cc === "LV")) return;
  const fc = JSON.parse(
    fs.readFileSync(path.join(published, "LV.geojson"), "utf-8")
  ) as GeoJSON.FeatureCollection<GeoJSON.Point, { category: string; nameEn?: string }>;
  // Ferry centroids are the documented exception: a `route=ferry` way spans
  // open water and its midpoint can sit at the far terminal. They are never
  // near a loop anchor, which is why this is about land categories.
  const strays = fc.features.filter(
    (f) => f.properties.category !== "ferry" && f.geometry.coordinates[1] < LV_SOUTH_LIMIT
  );
  assert.deepEqual(
    strays.map((f) => f.properties.nameEn ?? "(unnamed)"),
    [],
    "LV points below Latvia's southern border"
  );
});

test("Lithuania reaches its real northern border", { skip: !haveData }, () => {
  const lt = poiCountries().find((c) => c.cc === "LT");
  if (!lt) return;
  // The shipped Overpass set stopped dead at lat 55.60, because the LV
  // rectangle began at 55.6, was queried first, and the shared thinning pass
  // let it claim everything above. Lithuania actually reaches 56.45, so its
  // data must occupy cells on the 56 row.
  // Cells are indices, so decode rather than string-match: any cell whose
  // latitude band starts at or above 56° means data north of that line.
  const north = lt.placeCells.filter((c) => {
    const lat = Number(c.split(",")[1]);
    return Number.isFinite(lat) && lat * cellDegrees() >= 56;
  });
  assert.ok(
    north.length > 0,
    `LT has no place data above lat 56 — the LV rectangle would have eaten the north again`
  );
});

test(
  "a Latvian loop near the border receives LT-labelled anchors, correctly labelled",
  { skip: !haveData },
  () => {
    // There is no "only LV is wanted" rule to enforce: `planLoop` ranks by
    // bearing, radius and score, and a stop 20 km south of Bauska is a good
    // stop that happens to be Lithuanian. What must hold is that the app can
    // *tell* — that the anchor it picked reports the country it is really in.
    for (const start of [DAUGAVPILS, BAUSKA]) {
      const plan = planLoop({
        start,
        includeSightseeing: true,
        fallbackRadiusMeters: 18000,
        stopCount: 5,
        bearingOffsetDeg: 0,
      });
      const pois = plan.stops.map((s) => s.poi).filter((p): p is Poi => !!p);
      assert.ok(pois.length > 0, "the loop found named stops at all");
      for (const p of pois) {
        assert.ok(
          ["LV", "LT"].includes(p.country),
          `a stop near ${start.lat} came back as ${p.country}`
        );
        // The label and the geometry must agree. This is the assertion the old
        // data failed: `Geručių senovės gynybinis įtvirtinimas` at lat 56.33
        // was labelled LV.
        if (p.country === "LV") {
          assert.ok(
            p.lat >= LV_SOUTH_LIMIT,
            `${p.nameEn ?? p.id} is labelled LV at lat ${p.lat}, south of Latvia`
          );
        }
        assert.equal(p.source, "geofabrik");
      }
    }
  }
);

test("a search near the border reads both countries' files", { skip: !haveData }, () => {
  const near = poisNear(BAUSKA, 25000);
  const countries = new Set(near.map((p) => p.country));
  // Bauska is 12 km from Lithuania; a 25 km circle that returned only LV would
  // mean the bbox-to-country step is dropping a file the ride reaches.
  assert.ok(countries.has("LV"), "LV points near Bauska");
  assert.ok(countries.has("LT"), "LT points near Bauska — the circle crosses the border");
});

test("coverage follows the published index, and the sea is not covered", { skip: !haveData }, () => {
  assert.equal(hasPlaceData({ lat: 56.95, lon: 24.11 }), true, "Rīga");
  assert.equal(hasPlaceData({ lat: 54.69, lon: 25.28 }), true, "Vilnius");
  assert.equal(hasPlaceData({ lat: 59.44, lon: 24.75 }), true, "Tallinn");
  // Until PL/DE are published these must stay false, which is what makes the
  // `sparsePlaceData` notice honest.
  const haveDe = poiCountries().some((c) => c.cc === "DE");
  if (!haveDe) {
    assert.equal(hasPlaceData({ lat: 48.14, lon: 11.58 }), false, "München, not yet published");
  }
  // The middle of the Baltic Sea, which LV's *full* bbox reaches via a ferry
  // centroid at lon 10.86. Coverage is measured on the core bbox for exactly
  // this reason.
  assert.equal(hasPlaceData({ lat: 56.0, lon: 17.0 }), false, "open sea");
});
