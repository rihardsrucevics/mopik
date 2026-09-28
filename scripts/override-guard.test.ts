/**
 * A warned proposal — outside the profile, a big detour, a dead end
 * (`EditProposal.accept`) — enters the ride only through „Tomēr braukt”,
 * whatever path asks (coordinator's audit, 2026-09-28). One guard,
 * `mayCommit`, sits in `commitProposal`, the one place a proposal becomes
 * the ride; the chip is the only thing that arms it. Each path is pinned
 * here on the source, the way `phone-map-layout.test.ts` pins the slots.
 *
 *   npx tsx --test scripts/override-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mayCommit } from "@/lib/map/edit-proposal";

const page = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
const composer = readFileSync(new URL("../components/ride-composer.tsx", import.meta.url), "utf8");
const map = readFileSync(new URL("../components/route-map.tsx", import.meta.url), "utf8");
const body = (src: string, head: string) => {
  const at = src.indexOf(head);
  assert.ok(at >= 0, `${head} exists`);
  // The body's own brace: the first "{" that ends its line (parameter types have braces too).
  let depth = 0; const i = src.indexOf("{\n", at + head.length - 1);
  for (let j = i; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) return src.slice(at, j + 1); }
  return src.slice(at);
};

test("the guard: a warned proposal commits only when „Tomēr braukt” armed its own token", () => {
  assert.equal(mayCommit({ token: 7 }, null), true, "an ordinary proposal: ✓ as ever");
  for (const accept of ["profile", "detour", "deadEnd"] as const) {
    assert.equal(mayCommit({ token: 7, accept }, null), false, `${accept}: not without the chip`);
    assert.equal(mayCommit({ token: 7, accept }, 6), false, `${accept}: not with an older proposal's arming`);
    assert.equal(mayCommit({ token: 7, accept }, 7), true, `${accept}: the chip`);
  }
});

test("commitProposal is the only way into the ride, and it asks the guard first, then disarms", () => {
  assert.equal(page.match(/dispatchProposal\(\{ type: "committed" \}\)/g)?.length, 1);
  const commit = body(page, "function commitProposal(");
  assert.match(commit, /dispatchProposal\(\{ type: "committed" \}\)/);
  const guard = commit.indexOf("mayCommit(proposal, overrideArmed.current)");
  assert.ok(guard > 0 && guard < commit.indexOf("setEditsFor"), "asked before anything is written");
  assert.match(commit, /overrideArmed\.current = null;/);
});

test("✓ and a batch's confirm-all: one slot, disabled while warned, and through commitProposal anyway", () => {
  // Both are the ConfirmSlot's `pending.onConfirm`; the slot is off while warned.
  assert.match(map, /const onConfirm = refused \|\| warned \|\| idle \? null : pending!\.onConfirm;/);
  // (line-sheet's in-between-phase fix: editing, ✓ is pressable while a pin is still being named.)
  assert.match(composer, /onConfirm: \(edit \? batch\.some\([^)]*\) [^\n]*\? null : \(\) => pendingHandlers\.current\?\.confirmBatch\(\)/);
  // …and whatever they call ends in confirmChange → commitProposal, which asks the guard.
  const confirm = body(page, "function confirmChange(");
  assert.match(confirm, /return Promise\.resolve\(commitProposal\(state\.proposal, false\)\);/);
});

test("✓ pressed while it routed: a proposal that lands warned is answered no, not committed", () => {
  const land = body(page, "const land = (l: Landing) =>");
  assert.match(land, /if \(proposal\.accept\) settleWaiter\(token, false\);\s*else commitProposal\(proposal, true\);/);
});

test("„Pabeigt labošanu” keeps no preview, warned or not", () => {
  const finish = body(page, "function finishEdit(");
  assert.match(finish, /discardProposal\(\);/);
  assert.doesNotMatch(finish, /commitProposal|confirmChange/);
});

test("„Pārrēķināt posmu” only proposes the whole span; it commits nothing", () => {
  const wide = body(page, "function acceptWide(");
  assert.match(wide, /proposePlaces\(ask\.change, \{ wide: true \}\);/);
  assert.doesNotMatch(wide, /commitProposal|confirmChange|overrideArmed/);
});

test("the keyboard: no key confirms (Escape is ✕, Ctrl/Cmd+Z is ↶)", () => {
  const keys = body(composer, "const onKeyDown = (e: KeyboardEvent) =>");
  assert.doesNotMatch(keys, /"Enter"|confirm/i);
  assert.match(keys, /e\.key !== "Escape"/);
});

test("„Tomēr braukt” arms the shown warned proposal only, then confirms like ✓; a new or discarded proposal disarms", () => {
  assert.match(composer, /else if \("override" in act\) \{ const confirm = pending\?\.onConfirm; edit\?\.onOverride\?\.\(!confirm\); confirm\?\.\(\); \}/);
  assert.match(page, /overrideArmed\.current = s\.phase === "proposed" && s\.proposal\.accept \? s\.proposal\.token : null;/);
  // ✓ already let the mark go (pressed while it routed): the chip commits through the same guarded path.
  assert.match(page, /if \(commitNow && s\.phase === "proposed" && overrideArmed\.current !== null\) commitProposal\(s\.proposal, false\);/);
  assert.match(body(page, "function discardProposal("), /overrideArmed\.current = null;/);
  assert.match(body(page, "function proposePlaces("), /overrideArmed\.current = null;/);
  // The chip is only on offer for a warned, landed proposal.
  assert.match(composer, /if \(edit\?\.proposal\?\.phase === "proposed" && edit\.proposal\.proposal\.accept\) choices\.push\(\{\s*key: "override"/);
});

test("a bend no nearer after its spur was cut is asked again with the spur kept, before the next rung", () => {
  assert.match(page, /if \(bendMissed\(reachM, offAfter\) && !p\.keepSpurs && !p\.fallback\) return routeProposal\(\{ \.\.\.p, keepSpurs: true \}\);/);
  assert.match(page, /\.\.\.\(p\.keepSpurs \? \{ keepSpurs: true \} : \{\}\)/);
});
