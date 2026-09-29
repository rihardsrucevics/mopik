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
import { messages } from "@/lib/i18n/messages";

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

test("chained edits (release B item 4): the chain enters the ride only through ✓ on its top, guarded the same way", () => {
  // Chaining keeps a proposal, it does not commit it: no ride, no history, no plan written; the arming goes.
  const stack = body(page, "function stackProposal(");
  assert.match(stack, /dispatchProposal\(\{ type: "stacked" \}\)/);
  assert.doesNotMatch(stack, /setEditsFor|pushEdit|setPlan\(|commitProposal|chainConfirm/);
  assert.match(stack, /overrideArmed\.current = null;/);
  // ✓ on the chain's top (nothing new on it): asks the guard before anything is written, disarms, ONE step of the undo.
  const confirm = body(page, "function chainConfirm(");
  const guard = confirm.indexOf("mayCommit(top, overrideArmed.current)");
  assert.ok(guard > 0 && guard < confirm.indexOf("setEditsFor"), "asked before anything is written");
  assert.ok(confirm.indexOf("overrideArmed.current = null;") > guard, "disarmed once used");
  assert.equal(confirm.match(/pushEdit\(/g)?.length, 1, "every chained change is one step");
  // A proposal on top of the chain still goes through commitProposal, cut from the chain's top…
  assert.match(body(page, "function commitProposal("), /mine\.base !== baseNow\(\)\.segments/);
  // …and one stacked on a warned change inherits its warning before it can be committed.
  const land = body(page, "const land = (l: Landing) =>");
  const inherit = land.indexOf("inheritWarning(l.proposal, chainRef.current)");
  assert.ok(inherit >= 0 && inherit < land.indexOf("commitProposal("), "the warning is inherited before ✓-while-routing commits");
  // Ways into the history: the proposal, the chain, and the two on-the-line changes that existed before (kind switch, point on the line).
  assert.equal(page.match(/history: pushEdit\(/g)?.length, 4);
  // „Tomēr braukt” with nothing new on a warned chain arms the chain's top only, and confirms through chainConfirm.
  assert.match(page, /if \(s\.phase === "idle" && top\?\.accept\) \{ overrideArmed\.current = top\.token; if \(commitNow\) chainConfirm\(\); return; \}/);
  // A kind switch or a point dropped on the line while chained is one more change on the chain, not a commit.
  assert.match(page, /if \(!stackPlaces\(switched\)\) commitPlacesOnLine\(switched, "promote"\);/);
  assert.doesNotMatch(body(page, "function stackPlaces("), /setEditsFor|pushEdit|setPlan\(/);
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
  assert.match(page, /const request = async \(runs: typeof planned\.runs, keepSpurs = p\.keepSpurs\)/);
  assert.match(page, /\.\.\.\(keepSpurs \? \{ keepSpurs: true \} : \{\}\)/);
});

test("a stop at a real dead end is a plain proposal: said in its note, ✓ takes it (rider, 2026-09-28)", () => {
  const src = readFileSync(new URL("../components/home-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /accept: accept \?\? "deadEnd", notes/, "no „Tomēr braukt” for a stop's dead end");
  assert.doesNotMatch(src, /ui\.editDeadEndAsk/);
  // A pass-through point left on a spur still waits for it.
  // …and is called a dead end only when the router proved it (`deadEndNoteKey`, Lauriņi → Ērgļi).
  assert.match(src, /accept: accept \?\? \("deadEnd" as const\), notes: notes\.map\(\(n\) => \(n === deadEndNote && deadEndRun \? fi\(ui\[deadEndNoteKey\(deadEndRun, true\)\]/);
  assert.equal(messages("lv").editDeadEnd.replace("{km}", "0,2"), "Pietura ir strupceļā – atpakaļ pa to pašu ceļu 0,2 km.");
  for (const l of ["lv", "lt", "et", "en"] as const) for (const k of ["editDeadEnd", "editSameWayBack", "editDeadEndShape", "editSameWayBackShape", "editNoWayThrough", "editNoWayThroughShape"] as const) assert.doesNotMatch(messages(l)[k], /—/, `${l}.${k}`);
});
