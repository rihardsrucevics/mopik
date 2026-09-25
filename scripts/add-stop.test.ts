import test from "node:test";
import assert from "node:assert/strict";
import { addStop, addedStopIndex, maxRows } from "../components/route-places";
import { MAX_STOPS } from "../lib/chat/ride-limits";

/**
 * Where a new stop lands, and which row that is.
 *
 * There are now two ways to add a stop — the form's "Pievienot pieturvietu"
 * and a tap on the map — and they must produce the same row in the same place.
 * The form only needs the new *list*; the map needs the new list *and* the
 * index of the blank row in it, because that row is handed straight to pick
 * mode. Two derivations of one rule is exactly the pair that drifts: get the
 * index wrong and the map quietly puts the tapped point into the rider's
 * finish, or into a stop he had already named.
 *
 * So the invariant is pinned rather than commented: whatever `addStop`
 * inserts, `addedStopIndex` points at, and everything else keeps its order.
 */

/** The row `addStop` inserted, found without trusting `addedStopIndex`. */
function blankRowIn(before: string[], after: string[]): number {
  assert.equal(after.length, before.length + 1, "a stop adds exactly one row");
  const i = after.findIndex((p, j) => p === "" && before[j] !== "");
  return i === -1 ? after.length - 1 : i;
}

for (const oneWay of [true, false]) {
  const shape = oneWay ? "one way" : "round trip";

  test(`${shape}: the index points at the row addStop inserted`, () => {
    for (const before of [
      ["Rīga", "Cēsis"],
      ["Rīga", "Sigulda", "Cēsis"],
      ["Rīga", "Sigulda", "Valmiera", "Cēsis"],
    ]) {
      const after = addStop(before, oneWay);
      assert.equal(
        addedStopIndex(before, oneWay),
        blankRowIn(before, after),
        `${shape}, ${before.length} rows`,
      );
      assert.equal(after[addedStopIndex(before, oneWay)], "", "the row it points at is the blank one");
    }
  });

  test(`${shape}: every place the rider already named keeps its order`, () => {
    const before = ["Rīga", "Sigulda", "Cēsis"];
    const after = addStop(before, oneWay);
    assert.deepEqual(after.filter(Boolean), before, "nothing is dropped and nothing is reordered");
  });
}

test("one way keeps the finish last; a round trip puts the stop first", () => {
  // The rule the rider gave, in the two shapes he gave it for. One way:
  // appending would make the new blank row the destination and throw the
  // finish away. Round trip: a stop added to a planned ride is far more often
  // something to fit in on the way out than a new furthest point.
  assert.deepEqual(addStop(["Rīga", "Cēsis"], true), ["Rīga", "", "Cēsis"]);
  assert.deepEqual(addStop(["Rīga", "Cēsis"], false), ["Rīga", "", "Cēsis"]);
  assert.deepEqual(addStop(["Rīga", "Sigulda", "Cēsis"], true), ["Rīga", "Sigulda", "", "Cēsis"]);
  assert.deepEqual(addStop(["Rīga", "Sigulda", "Cēsis"], false), ["Rīga", "", "Sigulda", "Cēsis"]);
});

test("the cap is one number, so the map's tap stops where the button greys out", () => {
  // Both doors read `maxRows`. A tap that was still allowed where the button
  // was already dead would be two answers to one question, and the one the
  // rider cannot see is the one that would surprise him.
  const full = Array.from({ length: maxRows(true) }, (_, i) => `Vieta ${i}`);
  assert.equal(full.length >= maxRows(true), true);
  assert.equal(["Rīga", "Cēsis"].length >= maxRows(true), false);
  // Counted as stops: ten either way, the finish row on top one way.
  assert.equal(maxRows(true) - 2, MAX_STOPS);
  assert.equal(maxRows(false) - 1, MAX_STOPS);
});
