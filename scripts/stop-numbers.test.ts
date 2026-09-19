import test from "node:test";
import assert from "node:assert/strict";
import { stopNumbers } from "../lib/poi/kinds";

/**
 * The numbers the map puts on the rider's stops.
 *
 * The 🅿️ pill told the rider nothing but "a stop is somewhere here" — three
 * identical glyphs on one line, and no way to tell which was the second stop
 * without counting along the route. A number says *which*, and that only works
 * if it is the same number the form shows.
 *
 * Two ways for that to break silently, both pinned here: a sight added from
 * the suggestions taking a number it should not (every stop after it then
 * reads one too high), and a removed stop leaving a gap. The rider would find
 * either one before a test did, which is why they are tests.
 */

/** A place the rider typed into the form. */
const stop = (label: string) => ({ label });
/** A sight added from the suggestions — carries a category we know. */
const sight = (label: string, category = "castle") => ({ label, category });

test("typed stops number 1, 2, 3 in ride order", () => {
  assert.deepEqual(stopNumbers([stop("a"), stop("b"), stop("c")]), [1, 2, 3]);
});

test("a sight takes no number, and does not push the stops after it", () => {
  // The whole point: "manor" is a real category, so that via is a sight and
  // keeps its glyph. The stop after it is still the rider's SECOND stop.
  assert.deepEqual(
    stopNumbers([stop("a"), sight("Turaida", "manor"), stop("b")]),
    [1, null, 2],
  );
});

test("removing a stop renumbers the rest, because the list is recounted", () => {
  const before = [stop("a"), stop("b"), stop("c")];
  assert.deepEqual(stopNumbers(before), [1, 2, 3]);
  // Stop 1 removed — exactly the case the rider asked to see verified.
  const after = before.filter((p) => p.label !== "a");
  assert.deepEqual(stopNumbers(after), [1, 2]);
});

test("moving a stop moves its number with the order, not with the place", () => {
  const a = stop("a"), b = stop("b");
  assert.deepEqual(stopNumbers([a, b]), [1, 2]);
  assert.deepEqual(stopNumbers([b, a]), [1, 2], "the number is the position, never the place");
});

test("an unknown category is a stop, not a numberless mystery", () => {
  // An older share code, or a dataset built after this one. The place is in
  // the ride, so the truthful reading is "a stop" — a marker with no number
  // and no known glyph would be the one marker the rider cannot account for.
  assert.deepEqual(stopNumbers([stop("a"), sight("?", "not_a_real_kind"), stop("b")]), [1, 2, 3]);
});

test("sights alone produce no numbers at all", () => {
  assert.deepEqual(stopNumbers([sight("x", "waterfall"), sight("y", "cave")]), [null, null]);
});

test("no vias, no numbers", () => {
  assert.deepEqual(stopNumbers([]), []);
});
