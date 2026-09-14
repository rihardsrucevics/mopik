/**
 * The sea term — the loader over a fixture, `coastKm` on synthetic routes, the
 * scoring term's bounds, and the share code's round trip with and without the
 * new field.
 *
 * `npx tsx --test scripts/sea.test.ts`
 *
 * The rider's rule these exist to hold:
 *
 *   "braukt gar krastu pa īstu ceļu jābūt labāk (vēlamāk) kā braukt pa ceļu,
 *   kas neiet gar krastu — tāpēc, ka taču būtu smuks skats!"
 *
 * Riding the coast on a REAL road beats an inland road. So the load-bearing
 * tests here are the two that stop the bonus doing harm: a **beach path beside
 * the water earns nothing** (item 11a spent a day making those dear, and a
 * coastal bonus that counted paths would hand it straight back), and the term
 * **never outranks the repeated-road penalty or the off-road terms** the rider
 * puts first.
 *
 * The loader reads `public/sea/` from `process.cwd()`, so these publish a
 * fixture into a temp directory, chdir, and reset the module cache — the same
 * shape `scripts/yards.test.ts` uses.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { bboxOf, hasSeaData, resetSeaCache, seaLookup } from "@/lib/geo/sea";
import { classifyRoute } from "@/lib/routing/classify";
import { loopRank } from "@/lib/routing/score";
import { encodeRouteShare, decodeRouteShare } from "@/lib/share/route-code";
import { RouteIntentSchema, type GeneratedRoute, type RouteEdge, type RoutePath } from "@/lib/types";

/** A flat patch of the Kurzeme coast, near where the P111 runs. */
const LAT = 56.95;
const LON = 21.05;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

/** Metres east / north of the origin, as [lon, lat]. */
function at(east: number, north: number): [number, number] {
  return [LON + east / M_PER_DEG_LON, LAT + north / M_PER_DEG_LAT];
}

const INDEX_CELL = 0.25;

/**
 * Publish a coastline fixture and point the loader at it.
 *
 * The coastline is a north–south line at east = 0, so "distance to the sea" in
 * these tests is simply the easting of the point: a road at east = 500 is
 * 500 m from the water, one at east = 2000 is 2 km.
 */
function publishFixture(points: [number, number][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-sea-"));
  const seaDir = path.join(dir, "public", "sea");
  fs.mkdirSync(seaDir, { recursive: true });

  const deltas: number[] = [];
  let plon = 0;
  let plat = 0;
  for (const [lon, lat] of [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
    const ilon = Math.round(lon * 1e5);
    const ilat = Math.round(lat * 1e5);
    deltas.push(ilon - plon, ilat - plat);
    plon = ilon;
    plat = ilat;
  }
  fs.writeFileSync(
    path.join(seaDir, "LV.json"),
    JSON.stringify({ country: "LV", dedupeMeters: 200, deltas })
  );

  const cells = new Set<string>();
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of points) {
    cells.add(`${Math.floor(lon / INDEX_CELL)},${Math.floor(lat / INDEX_CELL)}`);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  fs.writeFileSync(
    path.join(seaDir, "index.json"),
    JSON.stringify({
      version: 1,
      source: "overpass",
      cellDegrees: INDEX_CELL,
      dedupeMeters: 200,
      countries: [{
        cc: "LV", count: points.length, bbox: [minLon, minLat, maxLon, maxLat],
        cells: [...cells].sort(), builtAt: new Date().toISOString(), bytes: 0,
      }],
    })
  );

  process.chdir(dir);
  resetSeaCache();
  return dir;
}

/** A north–south coastline at east = 0, thinned to the dataset's own 200 m. */
const COASTLINE: [number, number][] = Array.from({ length: 121 }, (_, i) => at(0, (i - 60) * 200));

const originalCwd = process.cwd();
test.after(() => {
  process.chdir(originalCwd);
  resetSeaCache();
});

// --- the loader -------------------------------------------------------------

test("the loader reads a packed fixture and measures distance to the coastline", () => {
  publishFixture(COASTLINE);

  const lookup = seaLookup(bboxOf([at(-500, -2000), at(5000, 2000)]));
  assert.equal(lookup.size, COASTLINE.length, "every packed point should survive the delta round trip");

  // The coastline runs north–south at east = 0, so the easting IS the distance.
  // Tolerance is the fixture's own 200 m spacing, not a routing tolerance.
  assert.ok(Math.abs(lookup.distanceM(...at(500, 0)) - 500) < 60, "a road 500 m inland");
  assert.ok(Math.abs(lookup.distanceM(...at(2000, 0)) - 2000) < 60, "a road 2 km inland");
  assert.ok(Math.abs(lookup.distanceM(...at(0, 0))) < 60, "a road on the shore");

  // Off the end of the coastline the nearest point is its last vertex, which is
  // what keeps a ride past the end of the data from reading as "on the coast".
  assert.ok(lookup.distanceM(...at(0, 40000)) > 20000);
});

test("hasSeaData gates on the published cells, not on a bounding box", () => {
  publishFixture(COASTLINE);

  assert.equal(hasSeaData(bboxOf([at(0, 0), at(5000, 5000)])), true);
  // Inland Vidzeme: no published cell, so the term is 0 and ranking is
  // byte-for-byte what it was before item 11c.
  assert.equal(hasSeaData([25.0, 57.2, 25.4, 57.4]), false);
});

test("an absent dataset is not an error — it reads as 'not measured'", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-sea-empty-"));
  process.chdir(dir);
  resetSeaCache();

  assert.equal(hasSeaData([21.0, 56.9, 21.2, 57.0]), false);
  assert.equal(seaLookup([21.0, 56.9, 21.2, 57.0]).size, 0);
});

// --- coastKm on a synthetic route -------------------------------------------

/** A route running north at a fixed distance from the coastline. */
function legAt(eastM: number, lengthM: number, highway: string): RoutePath {
  const step = 100;
  const n = Math.round(lengthM / step);
  const coordinates: [number, number][] = Array.from({ length: n + 1 }, (_, i) => at(eastM, i * step));
  const edges: RouteEdge[] = [{
    beginShapeIndex: 0,
    endShapeIndex: coordinates.length - 1,
    use: highway,
    surface: highway === "path" ? "ground" : "gravel",
    tags: { highway, surface: highway === "path" ? "ground" : "gravel" },
  } as RouteEdge];
  let meters = 0;
  for (let i = 1; i < coordinates.length; i++) meters += step;
  return { coordinates, edges, distanceMeters: meters, durationSeconds: meters / 10 } as RoutePath;
}

test("coastKm counts a real road beside the sea and ignores one inland", () => {
  publishFixture(COASTLINE);

  // 5 km of gravel road 500 m from the water: all of it inside the 1 km band.
  const coastal = classifyRoute(legAt(500, 5000, "unclassified"));
  assert.ok(coastal.quality.coastKm > 4.5, `expected ~5 km, got ${coastal.quality.coastKm}`);
  assert.ok(coastal.quality.coastNearKm > 4.5, "the 3 km band contains the 1 km band");

  // The same road 2 km inland: outside the 1 km band, inside the 3 km one.
  const near = classifyRoute(legAt(2000, 5000, "unclassified"));
  assert.equal(near.quality.coastKm, 0, "2 km out is not 'on the coast road'");
  assert.ok(near.quality.coastNearKm > 4.5, "but it is within sight of the water");

  // And well inland: nothing at either band. This is the Liepāja → Ventspils
  // complaint — item 11b measured that ride sitting 5–10 km inland.
  const inland = classifyRoute(legAt(8000, 5000, "unclassified"));
  assert.equal(inland.quality.coastKm, 0);
  assert.equal(inland.quality.coastNearKm, 0);
});

test("a beach path beside the water earns no coastal kilometre", () => {
  publishFixture(COASTLINE);

  // This is the test that stops item 11c undoing item 11a. The dune footpath is
  // the thing physically NEAREST the sea on the Baltic; item 11a removed 12.2 km
  // of it from one leg. A coastal bonus that counted `highway=path` would pay
  // the router to put it straight back.
  const beachPath = classifyRoute(legAt(100, 5000, "path"));
  assert.equal(beachPath.quality.coastKm, 0, "a path 100 m from the water must earn nothing");
  assert.equal(beachPath.quality.coastNearKm, 0);

  // A track at the same distance does count: item 11b measured `highway=track`
  // carrying most of the coastal km these rides already collect (37.9 of
  // Ventspils → Kolka's 46.4), and a dune track is the riding asked for.
  const track = classifyRoute(legAt(100, 5000, "track"));
  assert.ok(track.quality.coastKm > 4.5, `expected ~5 km, got ${track.quality.coastKm}`);
});

test("coastKm is 0 where no coastline dataset covers the ride", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-sea-none-"));
  process.chdir(dir);
  resetSeaCache();

  const classified = classifyRoute(legAt(500, 5000, "unclassified"));
  assert.equal(classified.quality.coastKm, 0, "absent data reads as 'not measured', never as a bonus");
});

// --- the scoring term -------------------------------------------------------

const INTENT = RouteIntentSchema.parse({});

const BASE = {
  repeatedPercent: 10,
  unpavedPercent: 60,
  trackPercent: 30,
  trailPercent: 5,
  streetPercent: 5,
  excessDriftPercent: 0,
  natureScore: 50,
};

test("a coastal candidate beats an inland one of otherwise equal quality", () => {
  // The rider's rule, as a ranking assertion. Lower is better.
  const coastal = loopRank(INTENT, { ...BASE, coastPercent: 30, coastNearPercent: 45 });
  const inland = loopRank(INTENT, { ...BASE, coastPercent: 0, coastNearPercent: 0 });
  assert.ok(coastal < inland, `coastal ${coastal} should beat inland ${inland}`);
});

test("the sea term is bounded, and cannot buy its way past what the rider ranks first", () => {
  const none = loopRank(INTENT, { ...BASE, coastPercent: 0, coastNearPercent: 0 });
  // Saturated: far past the 25 % target, at both bands.
  const saturated = loopRank(INTENT, { ...BASE, coastPercent: 100, coastNearPercent: 100 });
  const gain = none - saturated;

  assert.ok(gain <= 10.001, `the whole term must stay bounded, got ${gain}`);

  // "galvenais nebraukt tos pašus ceļus" — the repeated-road penalty is the one
  // thing that matters most, and the coast must never outbid it. A loop that
  // retraces 15 points more must lose even when it is perfectly coastal.
  const retracingCoastal = loopRank(INTENT, {
    ...BASE, repeatedPercent: BASE.repeatedPercent + 15, coastPercent: 100, coastNearPercent: 100,
  });
  assert.ok(retracingCoastal > none, "a retracing coastal loop must not win");

  // Nor may it buy a ride out of the tracks and trails an adventure rider came
  // for: `offRoadShortfall` spans 40 points against this term's 10.
  const trailIntent = RouteIntentSchema.parse({ trailPreference: "lots", difficulty: "hard" });
  const forest = loopRank(trailIntent, { ...BASE, trackPercent: 45, trailPercent: 10, coastPercent: 0, coastNearPercent: 0 });
  const seasideAsphalt = loopRank(trailIntent, { ...BASE, trackPercent: 5, trailPercent: 0, unpavedPercent: 10, coastPercent: 100, coastNearPercent: 100 });
  assert.ok(forest < seasideAsphalt, "a forest loop must still beat a seaside asphalt run");
});

test("without coastline data the rank is exactly what it was before item 11c", () => {
  // The honesty gate: `hasSeaData` false means the metrics arrive as 0, and the
  // term must then contribute nothing at all — not "almost nothing".
  const withFields = loopRank(INTENT, { ...BASE, coastPercent: 0, coastNearPercent: 0 });
  const withoutFields = loopRank(INTENT, BASE);
  assert.equal(withFields, withoutFields);
});

// --- the share code ---------------------------------------------------------

function routeWith(coastKm: number): GeneratedRoute {
  const coordinates: [number, number][] = [at(0, 0), at(0, 2500), at(0, 5000)];
  return {
    id: "c1",
    name: "Piekrastes brauciens",
    geometry: { type: "LineString", coordinates },
    segments: {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        geometry: { type: "LineString", coordinates },
        properties: { roadClass: "road", surface: "gravel", distanceMeters: 5000 },
      }],
    },
    distanceMeters: 5000,
    durationSeconds: 900,
    roadMix: { roadPercent: 80, trackPercent: 20, trailPercent: 0, roadKm: 4, trackKm: 1, trailKm: 0 },
    surfaces: { asphaltPercent: 40, gravelPercent: 55, dirtPercent: 5, unknownPercent: 0 },
    quality: {
      roughTrackKm: 0.4, sandKm: 0, streetKm: 0.3, unverifiedPathKm: 0.2, surfaceSwitches: 4,
      turnsPer10Km: 8, forestKm: 2.1, riversideKm: 0.4, ruralOpenKm: 1.2, landscapeTransitions: 2,
      landscapeTypes: 2, elevationGainM: 60, elevationRangeM: 25, natureScore: 51,
      coastKm, coastNearKm: coastKm * 1.5,
    },
    overlap: { repeatedKm: 0.4, distinctKm: 4.6, repeatedPercent: 8 },
    profile: "moto",
    sourcePrompt: "tests",
    variant: "balanced",
  };
}

const metaOf = (code: string) =>
  JSON.parse(
    Buffer.from(code.split("~")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8")
  );

test("the share code round-trips coastKm", () => {
  const decoded = decodeRouteShare(encodeRouteShare(routeWith(18.4), "Liepāja"));
  assert.ok(decoded);
  assert.equal(decoded.details?.coastKm, 18.4);
  // The rest of the payload is untouched by the addition.
  assert.equal(decoded.details?.unverifiedPathKm, 0.2);
  // No gates measured on this fixture, so the field is absent — "not
  // measured", which the page must not render as "no gates".
  assert.equal(decoded.details?.gateCount, undefined);
  assert.equal(decoded.name, "Piekrastes brauciens");
});

test("a ride with no coastal km encodes no field and decodes to 0", () => {
  const code = encodeRouteShare(routeWith(0), "Sigulda");
  assert.equal(metaOf(code).c, undefined, "a zero must not cost bytes in every link");
  assert.equal(decodeRouteShare(code)?.details?.coastKm, 0);
});

test("codes that predate the field still decode", () => {
  // Links live in riders' chats forever; the version prefix is only bumped for
  // a change that breaks them, so an old code must decode with `coastKm: 0`.
  const parts = encodeRouteShare(routeWith(18.4), "Liepāja").split("~");
  const meta = metaOf(parts.join("~"));
  delete meta.c;
  parts[1] = Buffer.from(JSON.stringify(meta), "utf-8")
    .toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const decoded = decodeRouteShare(parts.join("~"));
  assert.ok(decoded, "an older code must still decode");
  assert.equal(decoded.details?.coastKm, 0);
  assert.equal(decoded.details?.forestKm, 2.1, "and the rest of it must survive intact");
});
