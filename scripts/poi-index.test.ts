import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * The per-country POI loader: coverage from the index, country selection from
 * a ride's bounding box, and the cache that keeps a warm instance from
 * re-parsing a country it already has.
 *
 * These run against a **fixture** — two tiny country files and a hand-written
 * index — rather than the real dataset, for the same reason `route-pois.test.ts`
 * uses a synthetic polyline: pinning the rule against 13,450 real points tests
 * the data, not the rule. `poi-country-labels.test.ts` is where the real files
 * are checked.
 *
 * The loader reads `process.cwd()/public/poi`, so each test points `cwd` at a
 * throwaway directory and resets the module cache.
 */

const realCwd = process.cwd();

/**
 * Two 1°-wide countries side by side, plus a gap to the east that neither
 * covers — enough to tell "loaded because it overlaps" from "loaded because
 * it was there".
 */
type Fixture = { dir: string; cleanup: () => void };

function fixture(): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-poi-"));
  const poiDir = path.join(dir, "public", "poi");
  fs.mkdirSync(poiDir, { recursive: true });

  const feature = (id: string, lon: number, lat: number, country: string) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lon, lat] },
    properties: {
      id,
      category: "village",
      score: 1,
      country,
      nameEn: id,
    },
  });

  // AA sits at 20–21°E, BB at 22–23°E. One degree of empty between them.
  fs.writeFileSync(
    path.join(poiDir, "AA.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        feature("aa-west", 20.1, 55.1, "AA"),
        feature("aa-east", 20.9, 55.9, "AA"),
      ],
    })
  );
  fs.writeFileSync(
    path.join(poiDir, "BB.geojson"),
    JSON.stringify({
      type: "FeatureCollection",
      features: [
        // Deliberately mislabelled in the data: the file it lives in is the
        // authority, so the loader must report BB.
        feature("bb-west", 22.1, 55.1, "AA"),
        feature("bb-east", 22.9, 55.9, "BB"),
      ],
    })
  );
  fs.writeFileSync(
    path.join(poiDir, "index.json"),
    JSON.stringify({
      version: 3,
      source: "geofabrik",
      cellDegrees: 0.25,
      countries: [
        {
          cc: "AA",
          count: 2,
          // The bbox reaches far west, the way a ferry centroid does — and is
          // deliberately NOT what selection or coverage may use.
          bbox: [10.0, 55.1, 20.9, 55.9],
          // Cell indices are in units of 0.25°, so lon 20.1 is 80 and lat
          // 55.1 is 220. The first entry is a lone ferry centroid out west
          // (lon ~12), the way a real file has one: loadable, but it must not
          // establish coverage.
          cells: ["48,220", "80,220", "83,223"],
          placeCells: ["80,220", "83,223"],
          builtAt: "2026-09-14T00:00:00.000Z",
          bytes: 100,
        },
        {
          cc: "BB",
          count: 2,
          bbox: [22.1, 55.1, 22.9, 55.9],
          // lon 22.1 -> 88, lat 55.1 -> 220; lon 22.9 -> 91, lat 55.9 -> 223.
          cells: ["88,220", "91,223"],
          placeCells: ["88,220", "91,223"],
          builtAt: "2026-09-14T00:00:00.000Z",
          bytes: 100,
        },
      ],
    })
  );

  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** The loader caches in module scope, so each test needs a clean slate. */
async function withFixture<T>(fn: (poi: typeof import("../lib/geo/poi")) => Promise<T> | T): Promise<T> {
  const fx = fixture();
  process.chdir(fx.dir);
  const poi = await import("../lib/geo/poi");
  poi.__resetPoiCache();
  try {
    return await fn(poi);
  } finally {
    poi.__resetPoiCache();
    process.chdir(realCwd);
    fx.cleanup();
  }
}

test("the index lists the published countries with their occupied cells", async () => {
  await withFixture((poi) => {
    const countries = poi.poiCountries();
    assert.deepEqual(
      countries.map((c) => c.cc),
      ["AA", "BB"]
    );
    assert.deepEqual(countries[0].cells, ["48,220", "80,220", "83,223"]);
    assert.deepEqual(countries[0].placeCells, ["80,220", "83,223"]);
    // The bbox is far wider than the cells: that is the ferry-centroid gap,
    // and the reason nothing decides anything from the bbox.
    assert.equal(countries[0].bbox[0], 10.0);
  });
});

test("countriesForBBox picks by occupied cell, not by everything published", async () => {
  await withFixture((poi) => {
    assert.deepEqual(poi.countriesForBBox([20.2, 55.2, 20.4, 55.4]), ["AA"]);
    assert.deepEqual(poi.countriesForBBox([22.2, 55.2, 22.4, 55.4]), ["BB"]);
    // A box spanning both countries' data gets both. It has to reach AA's
    // cells as well as BB's, which at 0.25° means covering the latitude band
    // each of them actually occupies — a box drawn between them touches
    // neither, which is the whole point of indexing cells rather than extents.
    assert.deepEqual(poi.countriesForBBox([20.1, 55.05, 22.2, 55.95]), ["AA", "BB"]);
    // East of everything published: nothing, rather than a default.
    assert.deepEqual(poi.countriesForBBox([30.0, 55.2, 31.0, 55.4]), []);
    // The gap AA's *bounding box* covers but its data does not. A bbox-based
    // selection returned AA here and parsed a megabyte for nothing; this is
    // the regression that made the index carry cells.
    assert.deepEqual(poi.countriesForBBox([15.0, 55.2, 15.4, 55.4]), []);
    // The ferry cell (index 48 = lon 12.0…12.25) IS loadable — a rider asking
    // for that ferry must still find it.
    assert.deepEqual(poi.countriesForBBox([12.05, 55.05, 12.2, 55.2]), ["AA"]);
  });
});

test("poisNear parses only the countries its search circle reaches", async () => {
  await withFixture((poi) => {
    const near = poi.poisNear({ lat: 55.1, lon: 20.1 }, 5000);
    assert.deepEqual(near.map((p) => p.id), ["aa-west"]);
    // BB was never opened: the whole point of the per-country split.
    assert.deepEqual(poi.__loadedCountries(), ["AA"]);

    // A second search in the same country reuses the parse.
    poi.poisNear({ lat: 55.9, lon: 20.9 }, 5000);
    assert.deepEqual(poi.__loadedCountries(), ["AA"]);

    // Reaching into BB loads it, and AA stays loaded.
    const both = poi.poisNear({ lat: 55.1, lon: 22.1 }, 5000);
    assert.deepEqual(both.map((p) => p.id), ["bb-west"]);
    assert.deepEqual(poi.__loadedCountries(), ["AA", "BB"]);
  });
});

test("the file a point lives in decides its country, not the property in the data", async () => {
  await withFixture((poi) => {
    const [found] = poi.poisNear({ lat: 55.1, lon: 22.1 }, 5000);
    assert.equal(found.id, "bb-west");
    // The fixture stamps this one "AA" inside BB.geojson on purpose.
    assert.equal(found.country, "BB");
    assert.equal(found.source, "geofabrik");
  });
});

test("hasPlaceData answers from the occupied cells plus border slack", async () => {
  await withFixture((poi) => {
    // Inside AA.
    assert.equal(poi.hasPlaceData({ lat: 55.5, lon: 20.5 }), true);
    // Just outside, within the 1.5° longitude slack — a ride starting over
    // the border still passes through the data.
    assert.equal(poi.hasPlaceData({ lat: 55.5, lon: 21.9 }), true);
    // Far away.
    assert.equal(poi.hasPlaceData({ lat: 55.5, lon: 30.0 }), false);
    // The ferry cell itself. It is in `cells` and loadable, but not in
    // `placeCells`, so it establishes no coverage: otherwise the ferry trail
    // across the Baltic would tell a German ride it has place data.
    assert.equal(poi.hasPlaceData({ lat: 55.5, lon: 12.0 }), false);
  });
});

test("a missing index means no data, not a crash", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-poi-empty-"));
  fs.mkdirSync(path.join(dir, "public", "poi"), { recursive: true });
  process.chdir(dir);
  const poi = await import("../lib/geo/poi");
  poi.__resetPoiCache();
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(poi.poiCountries(), []);
    assert.equal(poi.hasPlaceData({ lat: 56.95, lon: 24.1 }), false);
    assert.deepEqual(poi.poisNear({ lat: 56.95, lon: 24.1 }, 20000), []);
    assert.deepEqual(poi.loadPois(), []);
  } finally {
    console.warn = warn;
    poi.__resetPoiCache();
    process.chdir(realCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
