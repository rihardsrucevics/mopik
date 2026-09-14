import test from "node:test";
import assert from "node:assert/strict";

/**
 * `recent-places.ts` is a "use client" module that reads `window.localStorage`.
 * Node has neither, so the store is exercised against a minimal stand-in
 * installed before the module is imported — the logic under test is the
 * remembering rules, not the browser.
 */
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  },
};

import { rememberPlace, listRecentPlaces, isRememberable } from "../lib/chat/recent-places";

const reset = () => store.clear();
const place = (name: string, lat: number, lon: number) => ({ name, label: name, lat, lon });

test("a place resolved by the crosshair is remembered like a dropdown pick", () => {
  reset();
  // What `reverseGeocode` returns for a rider standing in Sigulda: a named
  // place with the browser's own coordinates.
  rememberPlace(place("Sigulda", 57.1537, 24.8598));
  const recent = listRecentPlaces();
  assert.equal(recent.length, 1);
  assert.equal(recent[0].name, "Sigulda");
  assert.equal(recent[0].lat, 57.1537);
});

test("a coordinate pair is never stored as a place", () => {
  reset();
  // The fallback the form fills in when the reverse lookup found no name. It
  // is rideable and unrecognisable, so it must not reach the recent list.
  rememberPlace(place("57.1537, 24.8598", 57.1537, 24.8598));
  assert.deepEqual(listRecentPlaces(), []);
  assert.equal(isRememberable(place("57.1537, 24.8598", 57.1537, 24.8598)), false);
  assert.equal(isRememberable(place("-3.5, 128", -3.5, 128)), false);
  // A real name that merely contains digits stays rememberable.
  assert.equal(isRememberable(place("Brīvības iela 105", 56.97, 24.14)), true);
});

test("a nameless or unlocatable place is refused", () => {
  reset();
  rememberPlace(place("   ", 57.1, 24.8));
  rememberPlace(place("Nowhere", Number.NaN, 24.8));
  assert.deepEqual(listRecentPlaces(), []);
});

test("tapping the crosshair twice from the same spot stores one entry", () => {
  reset();
  rememberPlace(place("Sigulda", 57.1537, 24.8598));
  const first = listRecentPlaces()[0].usedAt;
  rememberPlace(place("Sigulda", 57.1537, 24.8598));
  const recent = listRecentPlaces();
  assert.equal(recent.length, 1);
  // Refused outright rather than re-stamped: nothing changed, so no field
  // needs to re-render.
  assert.equal(recent[0].usedAt, first);
});

test("the same spot under a different name still moves to the front", () => {
  reset();
  rememberPlace(place("Sigulda", 57.1537, 24.8598));
  rememberPlace(place("Cēsis", 57.3128, 25.2749));
  // A second resolution of the Sigulda point that named it differently is a
  // genuine change, and belongs at the front.
  rememberPlace(place("Siguldas novads", 57.1537, 24.8598));
  const recent = listRecentPlaces();
  assert.equal(recent[0].name, "Siguldas novads");
  assert.equal(recent.length, 2, "the same coordinates must not make two rows");
});

test("the newest place is first and the list is capped", () => {
  reset();
  for (let i = 0; i < 9; i++) rememberPlace(place(`P${i}`, 57 + i * 0.1, 24 + i * 0.1));
  const recent = listRecentPlaces();
  assert.equal(recent[0].name, "P8");
  assert.equal(recent.length, 6);
});
