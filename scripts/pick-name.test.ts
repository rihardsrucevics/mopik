import test from "node:test";
import assert from "node:assert/strict";
import { coordName, pickedPlace, pickedPlaceName } from "../lib/chat/pick-name";
import { findResolvedPlace } from "../lib/chat/places";

/**
 * The failure this guards against is silent, which is why it is a test rather
 * than a careful comment: two taps in one parish both reverse-geocode to
 * "Ķekava", the API's `findResolvedPlace` matches a row to a place by name,
 * and both rows would resolve to the *first* Ķekava. The ride is then planned
 * through one point twice with nothing anywhere saying so.
 *
 * Pure functions only — the React side is verified in a browser.
 */

const A = { lat: 56.9312, lon: 24.2311 };
const B = { lat: 56.8404, lon: 24.2588 };

test("a lone map pick keeps the plain name", () => {
  assert.equal(pickedPlaceName("Ķekava", A.lat, A.lon, ["Sigulda", ""]), "Ķekava");
});

test("a picked name that collides carries its coordinates", () => {
  const name = pickedPlaceName("Ķekava", B.lat, B.lon, ["Ķekava", "Sigulda"]);
  assert.notEqual(name, "Ķekava");
  assert.match(name, /^Ķekava · 56\.8404, 24\.2588$/);
});

test("two picks in one village stay two places for the API", () => {
  // Exactly the shape the API sees: the row texts and the places beside them.
  const first = pickedPlace({ name: "Ķekava", label: "Ķekava, Ķekavas novads", lat: 0, lon: 0 }, A.lat, A.lon, ["Sigulda"], "picked on map");
  const second = pickedPlace({ name: "Ķekava", label: "Ķekava, Ķekavas novads", lat: 0, lon: 0 }, B.lat, B.lon, ["Sigulda", first.name], "picked on map");
  const places = [first, second];

  assert.notEqual(first.name, second.name);
  // The ride's own resolution: each row's text must find its own coordinates.
  assert.deepEqual(findResolvedPlace(places, first.name), first);
  assert.deepEqual(findResolvedPlace(places, second.name), second);
  assert.equal(findResolvedPlace(places, second.name)?.lat, B.lat);
});

test("the tapped point wins over the lookup's centre", () => {
  // Reverse geocoding answers with the settlement centre; the rider tapped a
  // forest track two kilometres from it and meant that spot.
  const place = pickedPlace({ name: "Ķekava", label: "Ķekava", lat: 56.83, lon: 24.24 }, A.lat, A.lon, [], "picked on map");
  assert.equal(place.lat, A.lat);
  assert.equal(place.lon, A.lon);
});

test("a point the lookup cannot name is still a place", () => {
  const place = pickedPlace(null, A.lat, A.lon, [], "izvēlēts kartē");
  assert.equal(place.name, coordName(A.lat, A.lon));
  assert.equal(place.label, "izvēlēts kartē");
});

test("collision matching ignores case and diacritics, as the API does", () => {
  // `findResolvedPlace` folds both sides, so "Kekava" and "ķekava" are the
  // same name to it — the suffix has to appear for those too.
  assert.notEqual(pickedPlaceName("Ķekava", B.lat, B.lon, ["kekava"]), "Ķekava");
  assert.notEqual(pickedPlaceName("Sigulda", B.lat, B.lon, ["SIGULDA"]), "Sigulda");
});

test("re-picking a suffixed row does not stack a second suffix", () => {
  const once = pickedPlaceName("Ķekava", B.lat, B.lon, ["Ķekava"]);
  const twice = pickedPlaceName(once, B.lat, B.lon, ["Ķekava", once]);
  assert.equal(twice, once);
});

test("two picks at genuinely different places are left alone", () => {
  assert.equal(pickedPlaceName("Sigulda", A.lat, A.lon, ["Ķekava"]), "Sigulda");
});
