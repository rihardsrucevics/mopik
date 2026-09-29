import type { EditProposal, ProposalState } from "@/lib/map/edit-proposal";

/**
 * Several edits chained before one ✓ (release B item 4, rider 2026-09-28,
 * images/29–30: he moved a pass-through point, saw the proposal already
 * looked broken near the point to its left, and wanted to move that one too
 * before confirming — today every move needed its own ✓).
 *
 * While a proposal is shown, starting another edit stacks it: the landed
 * proposal goes onto the chain — not into the ride, not into the undo — and
 * the next edit is routed on top of it. So the preview carries every pending
 * change at once, and its chip the total against the committed ride.
 *
 * - ✓ commits the top of the chain (or the proposal on top of it), which
 *   holds every change, as ONE step of the undo.
 * - ↶ takes the last pending change off: the proposal on top when there is
 *   one, else the chain's top.
 * - ✕ drops them all.
 * - `mayCommit` still holds: a change stacked on a warned one inherits its
 *   warning, so only „Tomēr braukt” commits the chain (`inheritWarning`).
 *
 * Pure; the page keeps the state (components/home-page.tsx).
 */

export type EditChain = {
  /** The ride the chain belongs to; another ride's chain is not this one's. */
  routeId: string | null;
  /** Landed proposals, each routed on the one before; the last is the top. */
  rides: EditProposal[];
};

export const NO_CHAIN: EditChain = { routeId: null, rides: [] };

export function chainTopOf(chain: EditChain): EditProposal | null {
  return chain.rides[chain.rides.length - 1] ?? null;
}

/** The landed proposal onto the chain (a chain of another ride starts over). */
export function stackOnto(chain: EditChain, routeId: string, proposal: EditProposal): EditChain {
  const rides = chain.routeId === routeId ? chain.rides : [];
  return { routeId, rides: [...rides, proposal] };
}

/** ↶ on the chain itself: its top goes; the one before is shown again. */
export function popChain(chain: EditChain): EditChain {
  if (!chain.rides.length) return chain;
  const rides = chain.rides.slice(0, -1);
  return rides.length ? { ...chain, rides } : NO_CHAIN;
}

/**
 * A proposal stacked on warned ones waits for „Tomēr braukt” as they did:
 * it takes the first warning of the chain when it has none of its own, and
 * that warning's notes, so the chip says what the override is for.
 */
export function inheritWarning(proposal: EditProposal, chain: EditChain): EditProposal {
  if (proposal.accept) return proposal;
  const warned = chain.rides.find((r) => r.accept);
  if (!warned) return proposal;
  const notes = [...warned.notes, ...proposal.notes.filter((n) => !warned.notes.includes(n))];
  return { ...proposal, accept: warned.accept, notes };
}

/** How many changes are pending: the chain's, and the proposal on top of it when there is one. */
export function chainCount(chain: EditChain, proposal: ProposalState): number {
  return chain.rides.length + (proposal.phase === "idle" ? 0 : 1);
}

/**
 * What the map and the composer are shown: the proposal on top when there is
 * one, else the chain's top as a landed proposal — so its line, halo and
 * total chip stay while nothing new is pending, and ✓ / ↶ / ✕ act on it.
 */
export function shownProposal(chain: EditChain, proposal: ProposalState): ProposalState {
  const top = chainTopOf(chain);
  if (proposal.phase !== "idle" || !top) return proposal;
  return { phase: "proposed", proposal: top, confirmNow: false };
}
