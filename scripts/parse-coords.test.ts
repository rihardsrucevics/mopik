import test from "node:test";
import assert from "node:assert/strict";

import { parseCoords, formatCoords } from "../lib/geo/parse-coords";

/** Within ~1 m, which is finer than anything typed into a field can mean. */
const near = (got: { lat: number; lon: number } | null, lat: number, lon: number) => {
  assert.ok(got, "expected a parsed pair, got null");
  assert.ok(Math.abs(got!.lat - lat) < 1e-5, `lat ${got!.lat} != ${lat}`);
  assert.ok(Math.abs(got!.lon - lon) < 1e-5, `lon ${got!.lon} != ${lon}`);
};

test("decimal pair with a comma separator", () => {
  near(parseCoords("56.95, 24.10"), 56.95, 24.1);
});

test("decimal pair separated by a space only", () => {
  near(parseCoords("56.9500 24.1000"), 56.95, 24.1);
});

test("decimal pair separated by a semicolon", () => {
  near(parseCoords("56.95;24.10"), 56.95, 24.1);
});

test("Latvian decimal comma, space-separated", () => {
  // The rider's own keyboard writes 56,95 — two commas, one per number, with
  // the space doing the separating.
  near(parseCoords("56,95 24,10"), 56.95, 24.1);
});

test("four numbers glued by commas are ambiguous and refused", () => {
  // Either two Latvian decimals or four integers. Both defensible, so we
  // guess neither.
  assert.equal(parseCoords("56,95,24,10"), null);
});

test("signed values, southern and western", () => {
  near(parseCoords("-33.9249, -18.4241"), -33.9249, -18.4241);
});

test("N/S/E/W suffixes", () => {
  near(parseCoords("56.95N, 24.10E"), 56.95, 24.1);
  near(parseCoords("33.92S 18.42W"), -33.92, -18.42);
});

test("letters state the order even when it is written backwards", () => {
  near(parseCoords("24.10E, 56.95N"), 56.95, 24.1);
});

test("DMS with degree, minute and second marks", () => {
  near(parseCoords("56°57'00\"N 24°06'00\"E"), 56.95, 24.1);
});

test("DMS with unicode prime marks", () => {
  near(parseCoords("56°57′00″N 24°06′00″E"), 56.95, 24.1);
});

test("DMS minutes at or past sixty are not a reading", () => {
  assert.equal(parseCoords("56°75'00\"N 24°06'00\"E"), null);
});

test("Google Maps @ fragment out of a pasted URL", () => {
  near(
    parseCoords("https://www.google.com/maps/@56.95,24.10,14z/data=!3m1"),
    56.95,
    24.1,
  );
});

test("a bare @lat,lon fragment", () => {
  near(parseCoords("@56.9496,24.1052"), 56.9496, 24.1052);
});

test("out-of-range values are rejected", () => {
  assert.equal(parseCoords("91.0, 181.0"), null, "neither number can be a latitude");
  assert.equal(parseCoords("56.95, 200.0"), null, "|lon| > 180 and 200 is no latitude either");
  assert.equal(parseCoords("120, 200"), null, "neither reading is in range");
  assert.equal(parseCoords("56.95, 24.10, 12.5"), null, "an altitude tacked on is not a pair");
});

test("the first number is the latitude, and only an impossible one swaps", () => {
  // 24, 56 is a point off Somalia and a perfectly legal reading — Mopik is
  // Europe-wide, so it is taken as written rather than "corrected" to Rīga.
  near(parseCoords("24.10, 56.95"), 24.1, 56.95);
  // 120 cannot be a latitude, and 120 as a longitude is fine: the sole
  // in-range reading wins.
  near(parseCoords("120.0, 45.0"), 45, 120);
});

test("names and addresses are not coordinates", () => {
  assert.equal(parseCoords("Rīga"), null);
  assert.equal(parseCoords("Brīvības 24, Rīga"), null);
  assert.equal(parseCoords("56.95"), null, "one number is not a pair");
  assert.equal(parseCoords(""), null);
  assert.equal(parseCoords("   "), null);
  assert.equal(parseCoords("56.95 24.10 12.0"), null, "three numbers");
});

test("the normalised pair is what the field shows", () => {
  assert.equal(formatCoords({ lat: 56.9496, lon: 24.1052 }), "56.9496, 24.1052");
  assert.equal(formatCoords({ lat: 57.2, lon: 25.9 }), "57.2000, 25.9000");
});

test("a pair the field itself wrote parses back to the same point", () => {
  // The raw-coordinates suggestion puts `formatCoords` into the field, and
  // editing around it must not stop it being recognised.
  near(parseCoords(formatCoords({ lat: 57.2, lon: 25.9 })), 57.2, 25.9);
});
