import test from "node:test";
import assert from "node:assert/strict";
import { gpxFilename, asciiFold } from "../lib/gpx/filename";

const day = new Date(2026, 8, 13); // 13 September 2026, local time

test("a loop is named once, with the date and length", () => {
  assert.equal(gpxFilename({ places: ["Rīga", "Baldone", "Rīga"], km: 97, date: day }), "Mopik 2026-09-13 Riga-Baldone-loks 97km.gpx");
  assert.equal(gpxFilename({ places: ["Tukums", "Tukums"], km: 54, date: day }), "Mopik 2026-09-13 Tukums loks 54km.gpx");
});

test("a one-way ride keeps both ends", () => {
  assert.equal(gpxFilename({ places: ["Rīga", "Cēsis"], km: 120, date: day }), "Mopik 2026-09-13 Riga-Cesis 120km.gpx");
});

test("Latvian letters are folded, not dropped", () => {
  assert.equal(asciiFold("Ķekava Līgatne Žagare"), "Kekava Ligatne Zagare");
  assert.match(gpxFilename({ places: ["Ķekava", "Ķekava"], date: day }), /Kekava/);
});

test("falls back to the route name, and never produces an empty one", () => {
  assert.equal(gpxFilename({ name: "Līgatne adventure loks", km: 24, date: day }), "Mopik 2026-09-13 Ligatne adventure loks 24km.gpx");
  assert.equal(gpxFilename({ date: day }), "Mopik 2026-09-13 marsruts.gpx");
});
