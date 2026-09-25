/**
 * One undo stack for map-driven changes to the ride (rider, 2026-09-25: "undo
 * would be nice"). Each committed change — a place confirmed, a batch
 * confirmed, a pin moved, a row removed or reordered, a pick in a field —
 * pushes what the rows were before it; undo puts that back and keeps what it
 * replaced for redo. A batch is one step because it is committed as one.
 *
 * Deliberately a plain value with pure functions: the composer keeps it in
 * state, and the rules — the depth, what a new change does to redo — are
 * pinned by `scripts/undo-stack.test.ts` without a browser.
 */
export type UndoStack<T> = { past: T[]; future: T[] };

/** How many steps back the stack keeps. */
export const UNDO_DEPTH = 20;

export function emptyUndo<T>(): UndoStack<T> {
  return { past: [], future: [] };
}

/** Record `before` — the state a change is about to replace. A new change ends redo. */
export function pushUndo<T>(stack: UndoStack<T>, before: T): UndoStack<T> {
  return { past: [...stack.past, before].slice(-UNDO_DEPTH), future: [] };
}

/** One step back from `current`: the state to show, or null when there is none. */
export function popUndo<T>(stack: UndoStack<T>, current: T): { stack: UndoStack<T>; value: T } | null {
  if (!stack.past.length) return null;
  const value = stack.past[stack.past.length - 1];
  return { stack: { past: stack.past.slice(0, -1), future: [...stack.future, current] }, value };
}

/** One step forward again, after an undo. */
export function popRedo<T>(stack: UndoStack<T>, current: T): { stack: UndoStack<T>; value: T } | null {
  if (!stack.future.length) return null;
  const value = stack.future[stack.future.length - 1];
  return { stack: { past: [...stack.past, current].slice(-UNDO_DEPTH), future: stack.future.slice(0, -1) }, value };
}
