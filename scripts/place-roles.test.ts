import test from "node:test";
import assert from "node:assert/strict";
import { placeRoles } from "../lib/map/place-roles";
import type { ResolvedPlace } from "../lib/chat/places";

/**
 * Which pin each composer row earns.
 *
 * `npx tsx --test scripts/place-roles.test.ts`
 *
 * The rider's own bug, from a production screenshot: start row empty, four
 * stops added from the map, finish row empty — and the map drew a green start
 * pin on the first stop, numbers on the middle two, and a red finish pin on
 * the last. The map had been given a flat list of *confirmed* places and was
 * working the roles out by position, which is only ever right when the form is
 * filled from the top down.
 *
 * The first test below is that exact scenario. The rest hold the edges the
 * position rule also got wrong: a round trip has no finish however many rows
 * it has, and a gap in the middle must not leave a gap in the numbering.
 */

const place = (name: string, lat = 57, lon = 24): ResolvedPlace => ({
  name,
  label: name,
  lat,
  lon,
});

test("the rider's case: empty start, four stops from the map, empty finish", () => {
  // Six rows: start (empty), Caur (1)…(4), finish (empty).
  const roles = placeRoles({
    picked: [null, place("Caur (1)"), place("Caur (2)"), place("Caur (3)"), place("Caur (4)"), null],
    rowCount: 6,
    tripType: "one_way",
  });
  assert.equal(roles.start, null, "no green start pin without a confirmed start");
  assert.equal(roles.finish, null, "no finish pin without a confirmed finish");
  assert.deepEqual(
    roles.vias.map((v) => v.name),
    ["Caur (1)", "Caur (2)", "Caur (3)", "Caur (4)"],
    "all four are stops, numbered 1-4 in row order",
  );
});

test("a round trip never has a finish, however many rows are filled", () => {
  const roles = placeRoles({
    picked: [place("Sigulda"), place("Turaida"), place("Līgatne")],
    rowCount: 3,
    tripType: "round_trip",
  });
  assert.equal(roles.start?.name, "Sigulda");
  assert.equal(roles.finish, null, "a round trip returns to its start");
  assert.deepEqual(roles.vias.map((v) => v.name), ["Turaida", "Līgatne"], "every later row is a stop");
});

test("a one-way ride's last row is the finish", () => {
  const roles = placeRoles({
    picked: [place("Rīga"), place("Sigulda"), place("Cēsis")],
    rowCount: 3,
    tripType: "one_way",
  });
  assert.equal(roles.start?.name, "Rīga");
  assert.deepEqual(roles.vias.map((v) => v.name), ["Sigulda"]);
  assert.equal(roles.finish?.name, "Cēsis");
});

test("a gap in the middle does not leave a gap in the numbering", () => {
  // Rows: start, stop, EMPTY, stop, finish. The two stops are 1 and 2.
  const roles = placeRoles({
    picked: [place("Rīga"), place("Sigulda"), null, place("Cēsis"), place("Valmiera")],
    rowCount: 5,
    tripType: "one_way",
  });
  assert.deepEqual(roles.vias.map((v) => v.name), ["Sigulda", "Cēsis"]);
  assert.equal(roles.finish?.name, "Valmiera");
});

test("a confirmed finish with no start draws a finish and no start", () => {
  // The mirror of the reported bug: filling only the bottom row must not
  // promote it to the start.
  const roles = placeRoles({ picked: [null, place("Cēsis")], rowCount: 2, tripType: "one_way" });
  assert.equal(roles.start, null);
  assert.equal(roles.finish?.name, "Cēsis");
  assert.deepEqual(roles.vias, []);
});

test("one row is a start, never a finish", () => {
  const roles = placeRoles({ picked: [place("Rīga")], rowCount: 1, tripType: "one_way" });
  assert.equal(roles.start?.name, "Rīga");
  assert.equal(roles.finish, null, "a ride with one place has nowhere to finish");
  assert.deepEqual(roles.vias, []);
});

test("an empty form draws nothing", () => {
  const roles = placeRoles({ picked: [], rowCount: 2, tripType: "one_way" });
  assert.equal(roles.start, null);
  assert.equal(roles.finish, null);
  assert.deepEqual(roles.vias, []);
});

test("picks shorter than the form still find the finish row", () => {
  // The rider filled row 0 of four. `picked` is length 1; the finish is row 3
  // and is empty, which a "last pick is the finish" rule would get wrong by
  // calling Rīga the destination.
  const roles = placeRoles({ picked: [place("Rīga")], rowCount: 4, tripType: "one_way" });
  assert.equal(roles.start?.name, "Rīga");
  assert.equal(roles.finish, null);
  assert.deepEqual(roles.vias, []);
});
