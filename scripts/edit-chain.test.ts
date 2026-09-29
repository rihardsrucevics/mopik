/**
 * Several edits chained before one ✓ (release B item 4, lib/map/edit-chain.ts):
 * the landed proposal the rider builds on goes onto the chain, the next is
 * routed on top of it, ✓ commits the top (every change) as one step, ↶ takes
 * the last change off, ✕ drops them all, and a change stacked on a warned
 * one still waits for „Tomēr braukt”.
 *
 *   npx tsx --test scripts/edit-chain.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  NO_CHAIN,
  chainCount,
  chainTopOf,
  inheritWarning,
  popChain,
  shownProposal,
  stackOnto,
  type EditChain,
} from "../lib/map/edit-chain";
import { IDLE_PROPOSAL, mayCommit, proposalReducer, type EditProposal, type ProposalState } from "../lib/map/edit-proposal";
import { guideAction, guidance } from "../lib/map/edit-guidance";
import { t, type MessageKey } from "../lib/i18n/messages";

/** A landed proposal: only the fields the chain reads are real. */
const proposal = (token: number, extra: Partial<EditProposal> = {}): EditProposal =>
  ({ token, how: "move-stop", notes: [], changed: [], ride: { distanceMeters: token * 1000 }, ...extra }) as unknown as EditProposal;
const proposed = (p: EditProposal): ProposalState => ({ phase: "proposed", proposal: p, confirmNow: false });
const routing = (token: number): ProposalState => ({ phase: "routing", token, how: "move-stop", confirmWhenReady: false });

test("an empty chain: no top, nothing counted, the proposal shown as it is", () => {
  assert.equal(chainTopOf(NO_CHAIN), null);
  assert.equal(chainCount(NO_CHAIN, IDLE_PROPOSAL), 0);
  assert.equal(shownProposal(NO_CHAIN, IDLE_PROPOSAL), IDLE_PROPOSAL);
  const p = proposed(proposal(1));
  assert.equal(shownProposal(NO_CHAIN, p), p);
  assert.equal(chainCount(NO_CHAIN, p), 1);
});

test("stackOnto: each landed proposal goes on top, in order, without touching the old chain", () => {
  const a = proposal(1), b = proposal(2);
  const one = stackOnto(NO_CHAIN, "r1", a);
  const two = stackOnto(one, "r1", b);
  assert.deepEqual(one.rides, [a], "the first chain is not mutated");
  assert.deepEqual(two, { routeId: "r1", rides: [a, b] });
  assert.equal(chainTopOf(two), b);
});

test("stackOnto: another ride's chain is not this one's — it starts over", () => {
  const other = stackOnto(stackOnto(NO_CHAIN, "r1", proposal(1)), "r1", proposal(2));
  const mine = stackOnto(other, "r2", proposal(3));
  assert.equal(mine.routeId, "r2");
  assert.deepEqual(mine.rides.map((r) => r.token), [3]);
});

test("popChain (↶): the top goes and the one before is shown again; the last pop is no chain at all", () => {
  const chain = [1, 2, 3].reduce<EditChain>((c, n) => stackOnto(c, "r1", proposal(n)), NO_CHAIN);
  const two = popChain(chain);
  assert.deepEqual(two.rides.map((r) => r.token), [1, 2]);
  assert.equal(two.routeId, "r1");
  assert.equal(chainTopOf(two)?.token, 2);
  const none = popChain(popChain(two));
  assert.equal(none, NO_CHAIN, "nothing left: the ride is the committed one again");
  assert.equal(popChain(NO_CHAIN), NO_CHAIN, "↶ on nothing changes nothing");
});

test("chainCount: the chained changes, plus the one on top while it routes, is shown or was refused", () => {
  const chain = stackOnto(stackOnto(NO_CHAIN, "r1", proposal(1)), "r1", proposal(2));
  assert.equal(chainCount(chain, IDLE_PROPOSAL), 2);
  assert.equal(chainCount(chain, routing(3)), 3);
  assert.equal(chainCount(chain, proposed(proposal(3))), 3);
  assert.equal(chainCount(chain, { phase: "refused", token: 3, how: "move-stop", reason: "no" }), 3);
});

test("shownProposal: nothing new pending shows the chain's top as landed, so ✓ ↶ ✕ act on it; a new one wins", () => {
  const top = proposal(2);
  const chain = stackOnto(stackOnto(NO_CHAIN, "r1", proposal(1)), "r1", top);
  assert.deepEqual(shownProposal(chain, IDLE_PROPOSAL), { phase: "proposed", proposal: top, confirmNow: false });
  const next = proposed(proposal(3));
  assert.equal(shownProposal(chain, next), next);
  const r = routing(3);
  assert.equal(shownProposal(chain, r), r, "while the next routes its spinner is shown, not the old top");
});

test("inheritWarning: a change on a warned chain still needs „Tomēr braukt” (mayCommit), with the warning's notes first", () => {
  const warned = proposal(1, { accept: "detour", notes: ["Līkums +12 km."] });
  const chain = stackOnto(NO_CHAIN, "r1", warned);
  const next = proposal(2, { notes: ["Punkts pārvietots 70 m.", "Līkums +12 km."] });
  const inherited = inheritWarning(next, chain);
  assert.equal(inherited.accept, "detour");
  assert.deepEqual(inherited.notes, ["Līkums +12 km.", "Punkts pārvietots 70 m."], "said once, the warning first");
  assert.equal(mayCommit(inherited, null), false, "✓ alone does not commit it");
  assert.equal(mayCommit(inherited, 1), false, "nor the arming of the warned change below it");
  assert.equal(mayCommit(inherited, 2), true, "„Tomēr braukt” on the shown one does");
  assert.equal(next.accept, undefined, "the proposal itself is not mutated");
});

test("inheritWarning: its own warning stands; an unwarned chain adds none", () => {
  const own = proposal(2, { accept: "profile", notes: ["Ārpus profila."] });
  const chain = stackOnto(NO_CHAIN, "r1", proposal(1, { accept: "detour", notes: ["Līkums."] }));
  assert.equal(inheritWarning(own, chain), own);
  const plain = proposal(3);
  assert.equal(inheritWarning(plain, stackOnto(NO_CHAIN, "r1", proposal(1))), plain);
  assert.equal(inheritWarning(plain, NO_CHAIN), plain);
});

test("the guidance line for a chain, in four languages", () => {
  const say = (l: "lv" | "lt" | "et" | "en") => (k: MessageKey) => t(l, k);
  assert.equal(guideAction(say("lv"), { kind: "chain", count: 2 }), "2 izmaiņas – ✓ apstiprina visas, ↶ atsauc pēdējo, ✕ atmet visas.");
  assert.equal(guideAction(say("en"), { kind: "chain", count: 3 }), "3 changes – ✓ confirms them all, ↶ undoes the last, ✕ discards them all.");
  for (const l of ["lt", "et"] as const) assert.match(guideAction(say(l), { kind: "chain", count: 2 }), /2.*✓.*↶.*✕/);
  // Only the action: the chip's own numbers are the "what".
  assert.equal(guidance(say("lv"), { kind: "chain", count: 2 }), "2 izmaiņas – ✓ apstiprina visas, ↶ atsauc pēdējo, ✕ atmet visas.");
});

test("the reducer: a stacked proposal leaves the preview idle, as a committed one does", () => {
  const p = proposed(proposal(4));
  assert.equal(proposalReducer(p, { type: "stacked" }), IDLE_PROPOSAL);
  assert.equal(proposalReducer(routing(4), { type: "stacked" }), IDLE_PROPOSAL);
  assert.equal(proposalReducer(IDLE_PROPOSAL, { type: "stacked" }), IDLE_PROPOSAL, "idle stays the same object");
  // A late answer for the stacked token is dropped.
  const after = proposalReducer(p, { type: "stacked" });
  assert.equal(proposalReducer(after, { type: "landed", proposal: proposal(4) }), IDLE_PROPOSAL);
});
