import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renamePlaces, renamesBetween, sameGeometry } from "../lib/map/proposal-view";
import type { ProposedChange } from "../lib/map/edit-proposal";
import type { ResolvedPlace } from "../lib/chat/places";

/**
 * The in-between phase (rider, 2026-09-28): he dropped a pin, the ride was
 * re-routing, nothing said so and ✓ was off — because the pin's change was
 * held back until its reverse lookup had named it (up to 6 s when the
 * lookup timed out). Now the change exists from the instant the pin lands,
 * under its spot's name; routing starts at once, the name fills in when it
 * arrives without routing again, and a ✓ pressed meanwhile commits as soon
 * as the line lands, the name following.
 *
 * `npx tsx --test scripts/edit-routing.test.ts`
 */

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const composer = src("components/ride-composer.tsx");
const home = src("components/home-page.tsx");
const routeMap = src("components/route-map.tsx");

const P = (name: string, lat: number, lon: number, label = name): ResolvedPlace => ({ name, label, lat, lon });
const rows = (names: string[], picked: Record<number, ResolvedPlace | null>): ProposedChange => ({ kind: "rows", rows: { names, picked } });
const S = P("Sigulda", 57.15, 24.86);
const C = P("Cēsis", 57.31, 25.27);
const spot = P("57.2261, 25.0264", 57.2261, 25.0264, "izvēlēts kartē");
const named = P("Grūdeņi", 57.2261, 25.0264, "Grūdeņi · Līgatnes pagasts");

test("a name arriving is the same line: nothing is routed again", () => {
  const before = rows([S.name, spot.name, C.name], { 0: S, 1: spot, 2: C });
  const after = rows([S.name, named.name, C.name], { 0: S, 1: named, 2: C });
  assert.equal(sameGeometry(before, after), true);
  // Moved, reordered, or a row more: a different line.
  assert.equal(sameGeometry(before, rows([S.name, "x", C.name], { 0: S, 1: P("x", 57.23, 25.03), 2: C })), false);
  assert.equal(sameGeometry(before, rows([S.name, C.name, spot.name], { 0: S, 1: C, 2: spot })), false);
  assert.equal(sameGeometry(before, rows([S.name, spot.name, "", C.name], { 0: S, 1: spot, 3: C })), false);
  const bend: ProposedChange = { kind: "shape", op: { kind: "add", lat: 57.2, lon: 25, grabbedAt: [25.01, 57.2] } };
  assert.equal(sameGeometry(bend, { ...bend }), true);
  assert.equal(sameGeometry(bend, before), false);
});

test("the ride commits with the name the place has now", () => {
  const renames = renamesBetween(rows([S.name, spot.name], { 0: S, 1: spot }), rows([S.name, named.name], { 0: S, 1: named }));
  assert.deepEqual(renames, { [spot.name]: { name: named.name, label: named.label } });
  const places = { start: S, vias: [spot, P("Līgatne", 57.23, 25.04)], finish: C, roundTrip: false };
  const out = renamePlaces(places, renames);
  assert.deepEqual(out.vias.map((v) => v.name), ["Grūdeņi", "Līgatne"]);
  assert.equal(out.vias[0].label, named.label);
  assert.equal(out.vias[0].lat, spot.lat, "the place stays where it was routed");
  assert.equal(renamePlaces(places, {}), places, "nothing renamed: the same object");
  // Named twice (a second answer): still keyed by the name the routing used.
  const twice = renamesBetween(rows([named.name], { 0: named }), rows(["Grūdeņi 2"], { 0: P("Grūdeņi 2", spot.lat, spot.lon) }), renames);
  assert.deepEqual(Object.keys(twice), [spot.name]);
  assert.equal(twice[spot.name].name, "Grūdeņi 2");
});

test("the composer proposes a dropped pin at once, under its spot, and never holds it back", () => {
  // The mark's place from the instant it lands, for the active row only.
  assert.match(composer, /const markPreview = edit && activeRow !== null && naming && pickPoint && !batchMode && !grab/);
  assert.match(composer, /: activeRow !== null && markPreview && !\(picked\[activeRow\]/, "the single change is made of it");
  // A batch's stops too, while they are being named.
  assert.match(composer, /batch\.length \? \(batch\.some\(\(b\) => !batchPlace\(b\) \|\| b\.check === "off-road"\)/);
  // The hold only while there is no change at all.
  assert.match(composer, /const holdPropose = naming && activeRow !== null && !batch\.length && !shapePending && !proposedChange;/);
  // ✓ is live while it is being named and routed.
  assert.match(composer, /onConfirm: checking \|\| \(naming && !edit\) \|\| !markPreview \|\| edit\?\.rerouting \? null/);
  // …and a press then commits under the spot, the name following.
  assert.match(composer, /if \(edit && row !== null && naming && markPreview && !offRoad\) \{ nameLater\(\[markPreview\]\); commitPick\(row, markPreview\); return; \}/);
  assert.match(home, /onRename: \(from, to\) => renameRef\.current\(from, to\),/);
  const rename = home.slice(home.indexOf("function renamePlace("), home.indexOf("const renameRef"));
  assert.doesNotMatch(rename, /pushEdit\(/, "a rename is not a step of the undo");
});

test("no frame shows a dropped point with neither a spinner nor a chip", () => {
  // The page hears of the change in the commit that shows it.
  assert.match(composer, /useLayoutEffect\(\(\) => \{\n\s+const propose = proposeRef\.current;/);
  assert.match(composer, /useLayoutEffect\(\(\) => \{ proposeRef\.current = edit\?\.onPropose; \}\);/);
  assert.match(composer, /useLayoutEffect\(\(\) => \{\n\s+const row = activeRowRef\.current;/, "the mark becomes the pending change before paint");
  // A released line is delivered synchronously.
  assert.match(routeMap, /if \(pick && grabbingRef\.current\) \{ flushSync\(\(\) => pick\(spot\)\); return; \}/);
  // The page: a rename keeps the routing under way.
  assert.match(home, /sameGeometry\(mine\.change, change\)\) \{\n\s+mine\.renames = renamesBetween\(mine\.change, change, mine\.renames\);/);
  assert.match(home, /const next: EditedRide = \{ \.\.\.proposal\.ride, places: renamePlaces\(proposal\.ride\.places, mine\.renames\) \};/);
});
