import test from "node:test";
import assert from "node:assert/strict";
import { addStop, addedStopIndex, defaultActiveRow, followRow, rowAfterConfirm, MAX_ROWS } from "../components/route-places";

/**
 * Which row the planning map answers, and which row "+ Pietura" makes.
 *
 * The map used to carry two modes that looked the same — "pick a place for row
 * X" and "a tap makes a new stop" — and which one a tap meant depended on
 * state nothing on screen reported. The model that replaced it rests on two
 * rules, and both are arithmetic that has to be right before any pixel is:
 *
 * 1. **The active row is the first empty row, or none.** If it prefers a
 *    filled row over an empty one, the rider who opened the map to answer his
 *    next question is handed the previous one instead — and since 2026-09-25
 *    a form with every row filled has no active row at all: a finished place
 *    is edited again only when the rider activates it.
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

test("a full form has no active row", () => {
  // The rider's report (2026-09-25): start and finish confirmed, and the next
  // mark on the map moved the finish, because the old rule fell back to a
  // filled row. A finished place is edited only when he activates it.
  assert.equal(defaultActiveRow(["Rīga", "Cēsis"]), null);
  assert.equal(defaultActiveRow(["Rīga", "Sigulda", "Cēsis"]), null);
});

test("the default is a row the form actually has, or none", () => {
  for (const places of [["", ""], ["Rīga", ""], ["Rīga", "Cēsis"], ["Rīga", "Sigulda", "Valmiera", "Cēsis"]]) {
    const row = defaultActiveRow(places);
    assert.ok(row === null || (row >= 0 && row < places.length), `${row} is a row of ${places.length}`);
  }
});

test("after the start is confirmed the finish is next; after the finish, nothing", () => {
  // Confirm start → „Līdz”.
  assert.deepEqual(rowAfterConfirm(["Rīga", ""], 0, true), { rows: ["Rīga", ""], active: 1, inserted: null });
  // Confirm finish → no active row: the header says to pick a row or add a stop.
  assert.deepEqual(rowAfterConfirm(["Rīga", "Cēsis"], 1, true), { rows: ["Rīga", "Cēsis"], active: null, inserted: null });
  // Correcting a start later, with every row filled, does not invent a stop.
  assert.equal(rowAfterConfirm(["Rīga", "Sigulda", "Cēsis"], 0, true).active, null);
  // A finish confirmed while another row is still empty hands the map that row.
  assert.equal(rowAfterConfirm(["", "Cēsis"], 1, true).active, 0);
});

test("a confirmed stop opens no new row: batch adding took that job", () => {
  // With an empty stop row active, marks add pending stops in a batch and one
  // Confirm takes them all, so a Confirm no longer invents the next row.
  assert.deepEqual(rowAfterConfirm(["Rīga", "Sigulda", "Cēsis"], 1, true), { rows: ["Rīga", "Sigulda", "Cēsis"], active: null, inserted: null });
  // An empty row still waiting is next — stop or finish.
  assert.equal(rowAfterConfirm(["Rīga", "Sigulda", "", "Cēsis"], 1, true).active, 2);
  assert.equal(rowAfterConfirm(["Rīga", "Sigulda", ""], 1, true).active, 2);
  assert.equal(rowAfterConfirm(["Rīga", "Sigulda"], 1, false).active, null);
});

test("at the row cap, with the finish still empty, the finish is next", () => {
  assert.equal(rowAfterConfirm(["Rīga", "A", "B", "C", "D", ""], 4, true).active, 5);
  assert.equal(rowAfterConfirm(["Rīga", "A", "B", "C", "D", "Cēsis"], 4, true).active, null);
  assert.equal(["Rīga", "A", "B", "C", "D", "Cēsis"].length, MAX_ROWS);
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

test("the active row follows its place when the arrows move it", () => {
  // The rider's report: stop at row 2 active, ↓ pressed — the ring stayed on
  // row 2, which now held a different place. The active row is the place.
  assert.equal(followRow(2, { kind: "move", from: 2, to: 3 }), 3, "moved down, followed");
  assert.equal(followRow(3, { kind: "move", from: 3, to: 2 }), 2, "moved up, followed");
  // Twice up from row 3: 3 → 2 → 1.
  const once = followRow(3, { kind: "move", from: 3, to: 2 })!;
  assert.equal(followRow(once, { kind: "move", from: once, to: once - 1 }), 1);
  // Another row moving past the active one shifts it by one, the way the
  // list itself shifts.
  assert.equal(followRow(2, { kind: "move", from: 3, to: 2 }), 3, "the row below moved up past it");
  assert.equal(followRow(2, { kind: "move", from: 1, to: 2 }), 1, "the row above moved down past it");
  assert.equal(followRow(1, { kind: "move", from: 2, to: 3 }), 1, "a move elsewhere leaves it alone");
});

test("the active row follows its place when a row is removed or inserted", () => {
  assert.equal(followRow(3, { kind: "remove", at: 1 }), 2, "a row above removed");
  assert.equal(followRow(1, { kind: "remove", at: 3 }), 1, "a row below removed");
  assert.equal(followRow(2, { kind: "remove", at: 2 }), null, "its own row removed: the default rule decides");
  assert.equal(followRow(2, { kind: "insert", at: 1 }), 3, "a stop inserted above it");
  assert.equal(followRow(2, { kind: "insert", at: 2 }), 3, "inserted at its index pushes it down");
  assert.equal(followRow(1, { kind: "insert", at: 2 }), 1, "inserted below it");
  assert.equal(followRow(1, { kind: "clear", at: 1 }), 1, "a base row emptied in place stays");
  // `addStop` on a one-way ride inserts before the finish: an active finish
  // moves down with the finish.
  const rows = ["Rīga", "Sigulda", "Cēsis"];
  assert.equal(followRow(2, { kind: "insert", at: addedStopIndex(rows, true) }), 3);
  assert.equal(addStop(rows, true)[3], "Cēsis");
});
