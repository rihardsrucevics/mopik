import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One exit (docs/DESIGN-route-editing.md B): every ✓, ✕, sheet close, Escape
 * and row focus in the composer goes through `leaveTransient()`, so none of
 * them can leave a ring, a sheet, a pending point or a proposal behind. A
 * source check, because the composer is one large component: a handler added
 * later that clears its own bit of state by hand is exactly the bug this
 * rule exists for (the „stayed there” point, 2026-09-25).
 *
 * `npx tsx --test scripts/composer-exits.test.ts`
 */

const source = readFileSync(join(__dirname, "..", "components", "ride-composer.tsx"), "utf8");

/** The body of `const name = (…) => { … };` at the component's indentation. */
function body(name: string): string {
  const start = source.indexOf(`\n  const ${name} = `);
  assert.ok(start >= 0, `${name} is defined`);
  const end = source.indexOf("\n  };\n", start);
  assert.ok(end > start, `${name} has a body`);
  return source.slice(start, end);
}

const EXITS: Record<string, string[]> = {
  "✓": ["commitPick", "confirmShape", "confirmBatch", "confirmRemove", "removeStopRow", "promoteShape", "demoteStop"],
  "✕": ["cancelShape", "discardBatch"],
  "row focus": ["focusRow", "activateRow", "addStopFromMap"],
  "the map taken elsewhere": ["pressPin", "pressShape", "dragPin", "grabLine", "dragShape"],
};

for (const [what, names] of Object.entries(EXITS)) {
  test(`${what}: every handler goes through leaveTransient`, () => {
    for (const name of names) assert.match(body(name), /leaveTransient\(/, `${name} calls leaveTransient`);
  });
}

test("the planning path of ✓ on a moved dot and „Izņemt” on a dot go through it too", () => {
  const confirm = body("confirmShape");
  const planning = confirm.slice(confirm.indexOf("if (!edit)"), confirm.indexOf("edit.onShape"));
  assert.match(planning, /leaveTransient\(\{ commit: true \}\)/);
  assert.match(body("removeShape"), /if \(!edit\) \{[^}]*leaveTransient\(/);
});

test("the pending bar's ✕ and the sheet's close are leaveTransient itself", () => {
  assert.match(source, /\bcancel: \(\) => leaveTransient\(\{ dropMark: true \}\)/, "the bar's ✕");
  assert.match(source, /\bpointClose: \(\) => leaveTransient\(\)/, "the sheet's ✕ / Cancel, the move line's ✕, a removal's ✕");
  // The removal's ✕ and the move line's ✕ are wired to pointClose.
  assert.match(source, /onCancel: \(\) => pendingHandlers\.current\?\.pointClose\(\)/);
});

test("Escape goes through leaveTransient", () => {
  const start = source.indexOf('if (e.key !== "Escape") return;');
  assert.ok(start >= 0);
  const escape = source.slice(start, source.indexOf("\n  };\n", start));
  assert.match(escape, /if \(shapePending \|\| pointSel\) \{ leaveTransient\(\); return; \}/);
  assert.match(escape, /discardBatch\(\)/);
  assert.match(escape, /leaveTransient\(\{ dropMark: true \}\)/);
  assert.doesNotMatch(escape, /cancelPicking\(\)|cancelShape\(\)/, "no exit of its own");
});

test("the old exits are gone, and nothing else clears the selection by hand", () => {
  // Named in the doc comment it replaced them in, never called or defined.
  assert.ok(!/\bleaveShape\s*\(|const leaveShape\b/.test(source), "leaveShape is gone");
  assert.ok(!/\bclosePointSel\s*\(|const closePointSel\b|: closePointSel\b/.test(source), "closePointSel is gone");
  // setPointSel(null) only inside leaveTransient and cancelPicking (the row
  // flow's own reset, reached through leaveTransient's dropMark).
  const clears = [...source.matchAll(/setPointSel\(null\)/g)].map((m) => m.index!);
  const inside = (name: string, at: number) => { const s = source.indexOf(`\n  const ${name} = `); return at > s && at < source.indexOf("\n  };\n", s); };
  for (const at of clears) assert.ok(inside("leaveTransient", at) || inside("cancelPicking", at), `setPointSel(null) at ${at} is outside the exit`);
});

test("✓ tells the page it is committing, so the proposal is not discarded after it", () => {
  for (const name of ["commitPick", "confirmShape", "confirmBatch", "confirmRemove", "removeStopRow"]) {
    assert.match(body(name), /leaveTransient\(\{ commit: true/, `${name} exits committing`);
  }
});
