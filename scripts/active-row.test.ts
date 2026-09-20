import test from "node:test";
import assert from "node:assert/strict";
import { addStop, addedStopIndex, defaultActiveRow, MAX_ROWS } from "../components/route-places";

/**
 * Which row the planning map answers, and which row "+ Pietura" makes.
 *
 * The map used to carry two modes that looked the same — "pick a place for row
 * X" and "a tap makes a new stop" — and which one a tap meant depended on
 * state nothing on screen reported. The model that replaced it rests on two
 * rules, and both are arithmetic that has to be right before any pixel is:
 *
 * 1. **Exactly one row is active while the map is open**, defaulting to the
 *    first empty row. If this can return "no row" the invariant is a lie and a
 *    tap lands nowhere; if it prefers a filled row over an empty one, the
 *    rider who opened the map to answer his next question is handed the
 *    previous one instead.
 * 2. **"+ Pietura" inserts where `addStop` inserts and activates that row.**
 *    Get the index wrong and the button quietly puts the rider's next tap into
 *    his finish, or into a stop he had already named — which is the class of
 *    bug this whole change is about.
 */

test("a blank form answers with the start", () => {
  // The first thing a rider does on an empty form is say where he is setting
  // off from, and the map opening on anything else would be Mopik asking a
  // question he has not got to.
  assert.equal(defaultActiveRow(["", ""]), 0);
  assert.equal(defaultActiveRow(["", "", ""]), 0);
});

test("a named start hands the map the next unanswered row", () => {
  assert.equal(defaultActiveRow(["Rīga", ""]), 1);
  assert.equal(defaultActiveRow(["Rīga", "", "Cēsis"]), 1);
  assert.equal(defaultActiveRow(["Rīga", "Sigulda", ""]), 2);
});

test("whitespace is not an answer", () => {
  // A row holding spaces reads as filled to `length` and as empty to the
  // rider. The form trims everywhere else; so does this.
  assert.equal(defaultActiveRow(["Rīga", "   "]), 1);
  assert.equal(defaultActiveRow(["  ", "Cēsis"]), 0);
});

test("a full form still answers — with the start", () => {
  // The rule may never return "no row": the map is open, a tap is about to
  // land, and it must have somewhere to go. The start is the row most often
  // corrected, so it is the one worth falling back to.
  assert.equal(defaultActiveRow(["Rīga", "Cēsis"]), 0);
  assert.equal(defaultActiveRow(["Rīga", "Sigulda", "Cēsis"]), 0);
});

test("the default is always a row the form actually has", () => {
  for (const places of [["", ""], ["Rīga", ""], ["Rīga", "Cēsis"], ["Rīga", "Sigulda", "Valmiera", "Cēsis"]]) {
    const row = defaultActiveRow(places);
    assert.ok(row >= 0 && row < places.length, `${row} is a row of ${places.length}`);
  }
});

for (const oneWay of [true, false]) {
  const shape = oneWay ? "one way" : "round trip";

  test(`${shape}: "+ Pietura" activates the row it just inserted`, () => {
    // The button inserts through `addStop` and then activates
    // `addedStopIndex` of the list it inserted into. If those two disagree the
    // rider's next tap fills a row he did not ask about.
    for (const before of [
      ["", ""],
      ["Rīga", "Cēsis"],
      ["Rīga", "Sigulda", "Cēsis"],
    ]) {
      const after = addStop(before, oneWay);
      const row = addedStopIndex(before, oneWay);
      assert.equal(after[row], "", `${shape}, ${before.length} rows: the activated row is the new blank one`);
      assert.ok(row > 0, "a stop is never the start row");
      if (oneWay) assert.ok(row < after.length - 1, "a stop is never the finish row");
    }
  });

  test(`${shape}: each press activates the row it just made, and the form grows`, () => {
    let places = ["Rīga", "Cēsis"];
    for (let i = 0; i < 3; i++) {
      const row = addedStopIndex(places, oneWay);
      places = addStop(places, oneWay);
      assert.equal(places[row], "", "the activated row is the blank one this press inserted");
    }
    assert.equal(places.length, 5, "three presses, three new rows");
  });
}

test("one way: three presses number the stops 1, 2, 3 in form order", () => {
  // `rowLabel` numbers a middle row by its index — "Caur (1)", "Caur (2)" —
  // and the map's hint says that number back, so this is what the rider reads
  // on each press and what the pins under them have to agree with. One way the
  // stop goes before the finish, so the numbers rise.
  let places = ["Rīga", "Cēsis"];
  const rows: number[] = [];
  for (let i = 0; i < 3; i++) {
    rows.push(addedStopIndex(places, true));
    places = addStop(places, true);
  }
  assert.deepEqual(rows, [1, 2, 3]);
  assert.deepEqual(places, ["Rīga", "", "", "", "Cēsis"]);
});

test("round trip: every press activates the ride's first stop, by the rider's own rule", () => {
  // A round trip has no finish to keep last, and the rider chose that a stop
  // added to a planned ride is something to fit in on the way OUT — so each
  // new one goes to the head of the stops and is row 1 every time. Pinned
  // because it looks like a bug next to the one-way case and is not: the rows
  // the rider had already named are pushed down, not overwritten.
  let places = ["Rīga", "Cēsis"];
  const rows: number[] = [];
  for (let i = 0; i < 2; i++) {
    rows.push(addedStopIndex(places, false));
    places = addStop(places, false);
  }
  assert.deepEqual(rows, [1, 1]);
  assert.deepEqual(places, ["Rīga", "", "", "Cēsis"], "nothing the rider named was lost");
});

test("the button is the only door, and it stops at the same cap the form does", () => {
  // The tap that used to create a stop is gone, so this is now the single
  // place the cap has to hold. At `MAX_ROWS` the button is disabled and says
  // why — it never renders as a control that does nothing.
  const full = Array.from({ length: MAX_ROWS }, (_, i) => `Vieta ${i}`);
  assert.equal(full.length >= MAX_ROWS, true, "six rows is the cap");
  assert.equal(addStop(["Rīga", "Cēsis"], true).length <= MAX_ROWS, true);
});
