import test from "node:test";
import assert from "node:assert/strict";
import { emptyUndo, popRedo, popUndo, pushUndo, UNDO_DEPTH } from "../lib/map/undo-stack";

test("undo walks back each change, and redo forward again", () => {
  // start, finish, stop, stop, reorder: five changes from an empty form.
  const states = ["", "S", "S,F", "S,A,F", "S,A,B,F", "S,B,A,F"];
  let stack = emptyUndo<string>();
  for (let i = 1; i < states.length; i++) stack = pushUndo(stack, states[i - 1]);
  let current = states[states.length - 1];
  for (let i = states.length - 2; i >= 0; i--) {
    const back = popUndo(stack, current)!;
    assert.equal(back.value, states[i]);
    stack = back.stack; current = back.value;
  }
  assert.equal(popUndo(stack, current), null, "nothing before the empty form");
  const forward = popRedo(stack, current)!;
  assert.equal(forward.value, "S");
});

test("a new change after an undo ends redo", () => {
  let stack = pushUndo(pushUndo(emptyUndo<string>(), "a"), "b");
  const back = popUndo(stack, "c")!;
  stack = pushUndo(back.stack, back.value);
  assert.equal(popRedo(stack, "d"), null);
});

test("the stack keeps the last twenty steps", () => {
  let stack = emptyUndo<number>();
  for (let i = 0; i < UNDO_DEPTH + 5; i++) stack = pushUndo(stack, i);
  assert.equal(stack.past.length, UNDO_DEPTH);
  assert.equal(stack.past[0], 5, "the oldest steps fall off");
});

test("a batch confirmed at once is one step", () => {
  // Three stops confirmed together are one push — the rows before the batch.
  const stack = pushUndo(emptyUndo<string>(), "S,F");
  const back = popUndo(stack, "S,A,B,C,F")!;
  assert.equal(back.value, "S,F", "one undo takes the whole batch away");
});
