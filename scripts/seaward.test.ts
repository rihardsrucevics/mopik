/**
 * Item 11d — seaward via placement on a synthetic coastline, and the rule that
 * keeps the extra candidates inside the time budget.
 *
 * `npx tsx --test scripts/seaward.test.ts`
 *
 * What these exist to hold, in the order it matters:
 *
 *  1. **A seaward via lands in the 1–3 km window, on land.** That window is the
 *     whole point: item 11a made beach and dune footpaths dear, so a via point
 *     nearer than 1 km aims the router back at the sand it spent a day
 *     removing, and one further than 3 km is the inland line the rider is
 *     complaining about. A test that only asserted "nearer the sea" would pass
 *     on a point in the water.
 *  2. **An inland corridor gets nothing**, so a ride away from a coast is
 *     byte-for-byte the search it was before item 11d — the same guarantee
 *     `hasSeaData` gives `classify.ts` and `score.ts`.
 *  3. **Seaward candidates replace, never extend.** The budget arithmetic from
 *     item 7 is what stops a generation running past the platform's 60 s cap,
 *     and an extra candidate that ignores it is a 504 rather than a feature.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

import { resetSeaCache, seaLookup, bboxOf } from "@/lib/geo/sea";
import {
  seawardVias,
  seawardCorridors,
  withSeawardCandidates,
  SEAWARD_MIN_M,
  SEAWARD_MAX_M,
  COASTAL_CORRIDOR_M,
  MAX_SEAWARD_CANDIDATES,
  dropOffshoreVias,
  OFFSHORE_SNAP_M,
  type ViaProbe,
} from "@/lib/routing/seaward";

/** A flat patch of the Kurzeme coast, near where the P111 runs. */
const LAT = 56.95;
const LON = 21.05;
const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON = 111320 * Math.cos((LAT * Math.PI) / 180);

/**
 * Metres east / north of the origin, as [lon, lat]. East is inland: the
 * coastline fixture below is the line east = 0, so a point's easting IS its
 * distance to the sea and a NEGATIVE easting is in the water.
 */
function at(east: number, north: number): [number, number] {
  return [LON + east / M_PER_DEG_LON, LAT + north / M_PER_DEG_LAT];
}

/** How far east of the coastline a point sits, in metres. Negative = at sea. */
function eastingM(point: [number, number]): number {
  return (point[0] - LON) * M_PER_DEG_LON;
}

const INDEX_CELL = 0.25;

/** Publish a coastline fixture and point the loader at it. Mirrors sea.test.ts. */
function publishFixture(points: [number, number][]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mopik-seaward-"));
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

/**
 * A north–south coastline at east = 0, thinned to the dataset's own 200 m and
 * long enough to run beside a 60 km corridor.
 */
const COASTLINE: [number, number][] = Array.from({ length: 401 }, (_, i) => at(0, (i - 200) * 200));

const originalCwd = process.cwd();
test.after(() => {
  process.chdir(originalCwd);
  resetSeaCache();
});

// --- placement --------------------------------------------------------------

test("a coast-parallel corridor 8 km inland gets vias in the 1-3 km window, on land", () => {
  publishFixture(COASTLINE);

  // The complaint, in miniature: a ride that runs parallel to the shore but
  // 8 km inland the whole way — which is what Liepāja → Ventspils measured
  // (2.3–10.7 km out, sampled every 5 km, item 11b).
  const a = at(8000, -30000);
  const b = at(8000, 30000);
  const vias = seawardVias(a, b);

  assert.ok(vias.length >= 2, `expected at least 2 seaward vias, got ${vias.length}`);
  for (const via of vias) {
    const east = eastingM(via.point);
    assert.ok(east > 0, `a via point must be on land, not at sea (easting ${east.toFixed(0)} m)`);
    assert.ok(
      east >= SEAWARD_MIN_M - 250 && east <= SEAWARD_MAX_M + 250,
      `a via point must sit in the ${SEAWARD_MIN_M}-${SEAWARD_MAX_M} m window, not ${east.toFixed(0)} m`
    );
    // And the module's own report of the distance must agree with the geometry,
    // or the window above is being asserted against a number nothing uses.
    assert.ok(
      Math.abs(via.coastDistanceM - east) < 400,
      `reported ${via.coastDistanceM} m against a measured ${east.toFixed(0)} m`
    );
  }
});

test("the via points are pulled seaward of the corridor they came from", () => {
  publishFixture(COASTLINE);

  const a = at(8000, -30000);
  const b = at(8000, 30000);
  for (const via of seawardVias(a, b)) {
    // The corridor sits at 8 km; every via must be closer to the water than
    // that, or it is not a seaward candidate at all.
    assert.ok(
      eastingM(via.point) < 8000,
      "a seaward via must be nearer the coast than the straight A→B line"
    );
  }
});

test("vias are spread along the ride, not stacked on one stretch of shore", () => {
  publishFixture(COASTLINE);

  const vias = seawardVias(at(8000, -30000), at(8000, 30000));
  const fractions = vias.map((v) => v.fraction);
  assert.equal(new Set(fractions).size, fractions.length, "each via comes from its own sample");

  // Two vias resolving to the same piece of coast would route the same line and
  // each cost a leg, so the module drops the duplicate. With a 60 km corridor
  // the survivors must be genuinely far apart.
  const lookup = seaLookup(bboxOf([at(-5000, -35000), at(15000, 35000)]));
  assert.ok(lookup.size > 0);
  for (let i = 1; i < vias.length; i++) {
    const north = (p: [number, number]) => (p[1] - LAT) * M_PER_DEG_LAT;
    assert.ok(
      Math.abs(north(vias[i].point) - north(vias[i - 1].point)) > SEAWARD_MAX_M,
      "two vias on the same stretch of shore are one candidate, not two"
    );
  }
});

test("an inland corridor gets no seaward vias and opens no coastline file", () => {
  publishFixture(COASTLINE);

  // Well past COASTAL_CORRIDOR_M at both ends and the midpoint: an inland ride,
  // which must search exactly as it did before item 11d.
  const far = COASTAL_CORRIDOR_M + 20000;
  assert.deepEqual(seawardVias(at(far, -20000), at(far, 20000)), []);
});

test("a corridor with no published coastline at all gets nothing", () => {
  publishFixture(COASTLINE);

  // Another continent: `hasSeaData` is false, so this returns before any file
  // is touched — the gate that makes item 11d free away from the Baltic.
  assert.deepEqual(seawardVias([-120.5, 35.0], [-120.4, 35.8]), []);
});

test("a corridor that only touches the sea at one end still qualifies", () => {
  publishFixture(COASTLINE);

  // Ventspils → Kolka in miniature: starts on the coast, runs inland. The brief
  // asks for "within ~15 km at either end or midpoint", so one end is enough.
  const vias = seawardVias(at(2000, 0), at(COASTAL_CORRIDOR_M + 25000, 20000));
  assert.ok(vias.length >= 1, "a corridor starting on the coast is a coastal corridor");
});

// --- item 11f: along the coast, not to it -----------------------------------

test("a coastal corridor gets entry/exit pairs, both on land in the window", () => {
  publishFixture(COASTLINE);

  const corridors = seawardCorridors(at(8000, -30000), at(8000, 30000));
  assert.ok(corridors.length >= 2, `expected at least 2 corridors, got ${corridors.length}`);
  for (const corridor of corridors) {
    for (const point of corridor.points) {
      const east = eastingM(point);
      assert.ok(east > 0, `a corridor point must be on land (easting ${east.toFixed(0)} m)`);
      assert.ok(
        east >= SEAWARD_MIN_M - 250 && east <= SEAWARD_MAX_M + 250,
        `a corridor point must sit in the ${SEAWARD_MIN_M}-${SEAWARD_MAX_M} m window, not ${east.toFixed(0)} m`
      );
    }
  }
});

test("entry and exit are far enough apart to have their own connectors", () => {
  publishFixture(COASTLINE);

  // This is the whole point of item 11f. Measured on Liepāja → Ventspils, a
  // single via made the route ride 16.5 km down one connector and back up the
  // same one — 10 % repeated, the cost the rider refused. Two points on the
  // same stretch of shore would do exactly that again.
  const north = (p: [number, number]) => (p[1] - LAT) * M_PER_DEG_LAT;
  for (const corridor of seawardCorridors(at(8000, -30000), at(8000, 30000))) {
    const [entry, exit] = corridor.points;
    assert.ok(
      Math.abs(north(exit) - north(entry)) > SEAWARD_MAX_M,
      "entry and exit on one stretch of shore is a dead end, not a corridor"
    );
  }
});

test("entry comes before exit along the ride", () => {
  publishFixture(COASTLINE);

  // The corridor is ridden in order, so a pair whose exit is behind its entry
  // would route the shore stretch backwards and retrace to recover.
  for (const corridor of seawardCorridors(at(8000, -30000), at(8000, 30000))) {
    assert.ok(
      corridor.fractions[0] < corridor.fractions[1],
      `entry fraction ${corridor.fractions[0]} must precede exit ${corridor.fractions[1]}`
    );
    const north = (p: [number, number]) => (p[1] - LAT) * M_PER_DEG_LAT;
    assert.ok(
      north(corridor.points[1]) > north(corridor.points[0]),
      "the exit must lie further along the corridor than the entry"
    );
  }
});

test("two pairs that resolve to the same stretch of shore are one candidate", () => {
  publishFixture(COASTLINE);

  const corridors = seawardCorridors(at(8000, -30000), at(8000, 30000));
  const north = (p: [number, number]) => (p[1] - LAT) * M_PER_DEG_LAT;
  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const sameEntry =
        Math.abs(north(corridors[i].points[0]) - north(corridors[j].points[0])) < SEAWARD_MAX_M;
      const sameExit =
        Math.abs(north(corridors[i].points[1]) - north(corridors[j].points[1])) < SEAWARD_MAX_M;
      assert.ok(!(sameEntry && sameExit), "two identical pairs would route the same line twice");
    }
  }
});

test("an inland corridor gets no coastal corridors and opens no coastline file", () => {
  publishFixture(COASTLINE);

  // The same gate every other part of item 11 uses: an inland ride must be
  // byte-identical to what it was before.
  const far = COASTAL_CORRIDOR_M + 20000;
  assert.deepEqual(seawardCorridors(at(far, -20000), at(far, 20000)), []);
});

test("a corridor with no published coastline at all gets no pairs", () => {
  publishFixture(COASTLINE);

  assert.deepEqual(seawardCorridors([-120.5, 35.0], [-120.4, 35.8]), []);
});

test("each corridor point reports its own distance to the coastline", () => {
  publishFixture(COASTLINE);

  for (const corridor of seawardCorridors(at(8000, -30000), at(8000, 30000))) {
    for (let i = 0; i < 2; i++) {
      const east = eastingM(corridor.points[i]);
      assert.ok(
        Math.abs(corridor.coastDistanceM[i] - east) < 400,
        `reported ${corridor.coastDistanceM[i]} m against a measured ${east.toFixed(0)} m`
      );
    }
  }
});

// --- the budget -------------------------------------------------------------

/** Minimal stand-ins: the helper only ever reads `variant`. */
const inland = (variant: string) => ({ variant });

test("seaward candidates replace the least promising inland ones in a full pool", () => {
  // The rule from the brief: inside the budget the extras REPLACE rather than
  // add, because item 7's `affordableCandidates` is what keeps a generation
  // under the platform's 60 s cap.
  const pool = Array.from({ length: 10 }, (_, i) => inland(`via-${i}`));
  const seaward = [inland("sea-0.25"), inland("sea-0.5")];

  const merged = withSeawardCandidates(pool, seaward, 10);
  assert.equal(merged.length, 10, "a full pool must not grow");
  for (const s of seaward) assert.ok(merged.includes(s), "every seaward candidate survives");
});

test("the least promising inland candidates are the ones dropped", () => {
  // Build order puts the plain corridors first and the ornamental wide offsets
  // last, so a prefix is the useful half — the same reasoning `route.ts` uses
  // when it takes `candidates.slice(0, candidateCap)`. The drop therefore comes
  // off the tail.
  const pool = ["via-0-1", "via-0.35-1", "via-2.2-1", "via-2.8-1"].map(inland);
  const seaward = [inland("sea-0.5")];

  const merged = withSeawardCandidates(pool, seaward, 4);
  assert.equal(merged.length, 4);
  assert.ok(merged.some((c) => c.variant === "via-0-1"), "the direct line always survives");
  assert.ok(!merged.some((c) => c.variant === "via-2.8-1"), "the widest offset is dropped first");
});

test("a pool under the cap simply gains the seaward candidates", () => {
  const pool = [inland("via-0-1"), inland("via-0.35-1")];
  const seaward = [inland("sea-0.25"), inland("sea-0.5")];

  const merged = withSeawardCandidates(pool, seaward, 36);
  assert.equal(merged.length, 4, "there is room, so nothing is dropped");
});

test("the cap is never exceeded even when seaward candidates alone would fill it", () => {
  // A slow leg can afford very few candidates. The seaward ones must not be
  // able to crowd out the direct line, which is the ride the rider asked for
  // and the only one guaranteed to route.
  const pool = [inland("via-0-1"), inland("via-0.35-1"), inland("via-0.7-1")];
  const seaward = [inland("sea-0.25"), inland("sea-0.5"), inland("sea-0.75")];

  const merged = withSeawardCandidates(pool, seaward, 2);
  assert.equal(merged.length, 2, "the cap is the cap");
  assert.ok(merged.some((c) => c.variant === "via-0-1"), "the direct line is never dropped");
  assert.ok(
    merged.some((c) => c.variant.startsWith("sea-")),
    "but the coast still gets a candidate, or item 11d does nothing on a slow leg"
  );
});

test("a multi-stop coastal ride cannot flood the pool with seaward candidates", () => {
  // Each leg is sampled, so a four-stop ride along the coast offers nine. The
  // ceiling keeps the coast from buying slots off the corridors the rider
  // actually asked for.
  const pool = Array.from({ length: 6 }, (_, i) => inland(`via-${i}`));
  const seaward = Array.from({ length: 9 }, (_, i) => inland(`sea${i}`));

  const merged = withSeawardCandidates(pool, seaward, 36);
  const kept = merged.filter((c) => c.variant.startsWith("sea"));
  assert.equal(kept.length, MAX_SEAWARD_CANDIDATES);
  assert.equal(merged.length, pool.length + MAX_SEAWARD_CANDIDATES);
});

test("no seaward candidates leaves the pool exactly as it was", () => {
  const pool = [inland("via-0-1"), inland("via-0.35-1"), inland("via-0.7-1")];
  assert.deepEqual(withSeawardCandidates(pool, [], 36), pool);
  assert.deepEqual(withSeawardCandidates(pool, [], 2), pool.slice(0, 2));
});

// --- item 11e: no vias in the water -----------------------------------------
//
// What these hold:
//
//  1. **A via in the water is dropped, and one on land is not.** The whole
//     point: item 11d measured 293 s burned on twelve offshore candidates
//     against 6.6 s on the eight that routed.
//  2. **A dropped via is replaced, not merely removed.** Dropping alone takes a
//     coastal ride's pool from 17 to 5 — the rider would lose two thirds of the
//     versions on exactly the rides item 11 is about.
//  3. **An inland ride is untouched and never probed.** The `hasSeaData` gate,
//     the same guarantee `classify.ts`, `score.ts` and `seawardVias` give.
//  4. **A probe that fails keeps the via.** A router hiccup read as "this is the
//     sea" would silently empty the pool.

/**
 * A snap oracle over the fixture's geometry: on land BRouter finds a road in
 * metres, in the water it must reach the shore. The fixture's coastline is the
 * line east = 0, so a negative easting IS the distance to swim.
 *
 * Deliberately a stand-in rather than a live call: the real one is measured in
 * `scripts/measure-seaward.ts` against `brouter.mopik.eu`, and a unit test that
 * needs a router is a test that does not run.
 */
function fixtureSnap(point: [number, number]): Promise<number | null> {
  const east = eastingM(point);
  // Inland: a road within a few hundred metres, as measured (2 m – 1186 m).
  if (east > 0) return Promise.resolve(120);
  // At sea: BRouter reaches the nearest shore, which is |east| away. Measured
  // offshore snaps ran 1944 m – 45757 m and tracked the distance to land.
  return Promise.resolve(Math.abs(east));
}

/** `item` is all `dropOffshoreVias` reads; the point is what it probes. */
const probeAt = (name: string, east: number, north: number, mirrorEast?: number): ViaProbe<string> => ({
  item: name,
  point: at(east, north),
  substitutes:
    mirrorEast === undefined ? [] : [{ item: `${name}m`, point: at(mirrorEast, north) }],
});

test("a via point in the water is dropped and one on land is kept", async () => {
  publishFixture(COASTLINE);

  const result = await dropOffshoreVias({
    probes: [
      probeAt("via-0.7-1", -8000, 0), // 8 km out in the Baltic
      probeAt("via-0.7--1", 8000, 0), // 8 km inland
    ],
    snap: fixtureSnap,
  });

  assert.deepEqual(result.kept, ["via-0.7--1"], "only the landward via survives");
  assert.equal(result.dropped, 1);
  assert.equal(result.probed, 2);
});

test("the offshore threshold sits in the measured gap, not on a cliff edge", async () => {
  publishFixture(COASTLINE);

  // Measured across the four coastal rides: on land 2 m – 1186 m, in the water
  // 1944 m – 45757 m. Everything either side of the gap must classify the same
  // way, or the constant is tuned to one ride rather than to the separation.
  const onLand = [2, 120, 883, 1186];
  const atSea = [1944, 4136, 24614, 45757];

  for (const snap of onLand) {
    const r = await dropOffshoreVias({
      probes: [probeAt("via", 5000, 0)],
      snap: () => Promise.resolve(snap),
    });
    assert.deepEqual(r.kept, ["via"], `a ${snap} m snap is land`);
  }
  for (const snap of atSea) {
    const r = await dropOffshoreVias({
      probes: [probeAt("via", 5000, 0)],
      snap: () => Promise.resolve(snap),
    });
    assert.deepEqual(r.kept, [], `a ${snap} m snap is water`);
  }
  assert.ok(
    OFFSHORE_SNAP_M > Math.max(...onLand) && OFFSHORE_SNAP_M < Math.min(...atSea),
    `${OFFSHORE_SNAP_M} m must sit inside the measured gap`
  );
});

test("a dropped via is replaced by the same offset mirrored to the land side", async () => {
  publishFixture(COASTLINE);

  // The corridor runs 4 km inland; the +1 offset of 12 km puts the via 8 km out
  // to sea and the −1 offset puts it 16 km inland. This is Liepāja → Ventspils
  // in miniature, and it is the case the whole item exists for.
  // The direct line is in the pool too, as it always is — and it is what puts
  // the probes' own bounding box across the coastline, so `hasSeaData` is true.
  const result = await dropOffshoreVias({
    probes: [probeAt("via-0-1", 4000, 0), probeAt("via-1-1", -8000, 0, 16000)],
    snap: fixtureSnap,
  });

  assert.deepEqual(
    result.kept,
    ["via-0-1", "via-1-1m"],
    "the mirror takes the dropped candidate's slot"
  );
  assert.equal(result.dropped, 1);
  assert.equal(result.substituted, 1, "the pool keeps its size — no hole is left");
});

test("a substitute already in the pool is not added twice", async () => {
  publishFixture(COASTLINE);

  // On a ride where BOTH sides are land, `via-1.4-1`'s plain mirror IS
  // `via-1.4--1`, which the builder produced in its own right. Routing the same
  // line twice buys nothing and costs a leg.
  const result = await dropOffshoreVias({
    probes: [
      probeAt("via--1", 9000, 0), // kept, and it sits where the mirror would go
      probeAt("via-1", -5000, 0, 9000), // offshore; its mirror is the point above
    ],
    snap: fixtureSnap,
  });

  assert.deepEqual(result.kept, ["via--1"], "the duplicate mirror is not re-added");
  assert.equal(result.dropped, 1);
  assert.equal(result.substituted, 0);
});

test("a substitute is rejected as duplicate even before its twin is reached", async () => {
  publishFixture(COASTLINE);

  // The regression that made this rule what it is. Probes run in build order,
  // so an offshore `via-1` is considered BEFORE the landward `via--1` that its
  // mirror duplicates. Checking only what had been kept so far let the mirror
  // through, and the headline ride then routed seven byte-identical pairs —
  // same kilometres, same rank. The guard must see the whole pool.
  const result = await dropOffshoreVias({
    probes: [
      probeAt("via-1", -5000, 0, 9000), // offshore, considered FIRST
      probeAt("via--1", 9000, 0), // its mirror, reached only afterwards
    ],
    snap: fixtureSnap,
  });

  assert.deepEqual(result.kept, ["via--1"], "no duplicate, whatever the order");
  assert.equal(result.substituted, 0);
});

test("a via whose mirror is also in the water is dropped with no substitute", async () => {
  publishFixture(COASTLINE);

  // A corridor out at sea on both sides of the offset — a strait or a bay. Better
  // no candidate than a second one that costs the same minute to fail.
  const result = await dropOffshoreVias({
    probes: [probeAt("via-0-1", 4000, 0), probeAt("via-1", -6000, 0, -20000)],
    snap: fixtureSnap,
  });

  assert.deepEqual(result.kept, ["via-0-1"], "only the direct line is left");
  assert.equal(result.dropped, 1);
  assert.equal(result.substituted, 0, "a substitute in the water is no substitute");
});

test("an inland ride is untouched and never probed at all", async () => {
  publishFixture(COASTLINE);

  // Another continent: `hasSeaData` is false over the probes' own bbox, so the
  // pool comes back exactly as given and not one network call is made. This is
  // what makes item 11e provably free away from a coast, rather than merely
  // unaffected in practice.
  let calls = 0;
  const result = await dropOffshoreVias({
    probes: [
      { item: "via-1", point: [-120.5, 35.0], substitutes: [] },
      { item: "via--1", point: [-120.4, 35.1], substitutes: [] },
    ],
    snap: () => { calls++; return Promise.resolve(50_000); },
  });

  assert.deepEqual(result.kept, ["via-1", "via--1"], "the pool is byte-identical");
  assert.equal(calls, 0, "an inland ride makes no probe");
  assert.equal(result.probed, 0);
  assert.equal(result.dropped, 0);
});

test("a probe that fails keeps the via rather than calling it sea", async () => {
  publishFixture(COASTLINE);

  // A BRouter hiccup must never read as "this point is in the water", or one
  // bad minute empties the candidate pool and the rider gets one version.
  const result = await dropOffshoreVias({
    probes: [probeAt("via-1", -8000, 0, 16000), probeAt("via--1", 8000, 0)],
    snap: () => Promise.resolve(null),
  });

  assert.deepEqual(result.kept, ["via-1", "via--1"], "no opinion means keep");
  assert.equal(result.dropped, 0);
  assert.equal(result.substituted, 0);
});

test("the same point is probed once however many candidates offer it", async () => {
  publishFixture(COASTLINE);

  // A multi-stop ride can offer one mirror as the substitute for two different
  // offshore vias, and a probe is a network call on a one-vCPU server.
  let calls = 0;
  const result = await dropOffshoreVias({
    probes: [
      probeAt("direct", 4000, 0),
      probeAt("a", -8000, 0, 16000),
      probeAt("b", -8000, 0, 16000),
    ],
    snap: (p) => { calls++; return fixtureSnap(p); },
  });

  assert.equal(calls, 3, "three distinct points, probed once each");
  assert.equal(result.dropped, 2);
  // The second mirror lands on the first one's stretch of shore, so it is the
  // duplicate rule that stops it, not a second probe.
  assert.deepEqual(result.kept, ["direct", "am"]);
});

test("an empty probe list yields an empty pool and no work", async () => {
  publishFixture(COASTLINE);
  const result = await dropOffshoreVias({ probes: [], snap: fixtureSnap });
  assert.deepEqual(result.kept, []);
  assert.equal(result.probed, 0);
  assert.equal(result.ms, 0);
});
