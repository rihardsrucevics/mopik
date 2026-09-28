import type { ResolvedPlace } from "@/lib/chat/places";
import type { UiLocale } from "@/lib/i18n/locale";
import type { EditKind, EditedRide, RidePlaces, ShapeEdit } from "@/lib/routing/reroute-leg";
import type { RouteSegmentProperties } from "@/lib/types";

/**
 * Preview before commit (docs/DESIGN-route-editing.md, B4 — Phase 1).
 *
 * Every line-changing edit is routed first and shown; nothing enters the
 * ride or the undo until ✓, and ✕ leaves nothing behind. This module is the
 * pure half of that: the proposal a routed edit becomes, the state machine
 * it moves through (idle → routing(token) → proposed / refused), and the
 * numbers its chip shows.
 *
 * CONTRACT C1: the types below are the contract the Phase 1 packages build
 * on. The functions are owned and implemented by P1-A.
 */

/** The ride's line, as the map and `applyRuns` carry it. */
export type Segments = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;

/**
 * What a pending mark in the editor would change, handed to the page for
 * routing (`RideEdit.onPropose`). `rows` is a stop's change — exactly what
 * `RideEdit.onCommit` receives; `shape` is a point's, exactly what
 * `RideEdit.onShape` receives. `null` from the composer means the pending
 * mark is gone (✕, a row focused elsewhere): drop whatever was proposed.
 */
export type ProposedChange =
  | { kind: "rows"; rows: { names: string[]; picked: Record<number, ResolvedPlace | null> } }
  | { kind: "shape"; op: ShapeEdit };

/** The chip's numbers: the ride before the edit and with it. */
export type EditDelta = {
  kmBefore: number;
  kmAfter: number;
  /** after − before, seconds; signed. */
  secondsDelta: number;
  repeatedBefore: number;
  repeatedAfter: number;
};

/**
 * A routed edit waiting for ✓. `ride` is exactly what ✓ commits (places
 * already settled on the line); `notes` belong to it and die with it — the
 * „Punkts pārvietots N m…” that used to outlive its action.
 */
export type EditProposal = {
  /** The routing request this answers; an answer with an older token is dropped. */
  token: number;
  how: EditKind;
  before: RidePlaces;
  ride: EditedRide;
  /** Metres along `ride.coordinates` where the line is new: [from, to] per stretch. */
  changed: [number, number][];
  delta: EditDelta;
  notes: string[];
  /**
   * Not ✓-able as it is: it rides roads outside the rider's profile, or it
   * costs a big detour (`lib/map/edit-reach.ts`). The notes say what and how
   * much; only „Tomēr braukt” commits it, ✕ drops it.
   */
  accept?: "profile" | "detour" | "deadEnd";
  /** The profile rung it was routed on (`relaxedProfiles`); absent: the rider's own. */
  relax?: number;
};

/**
 * The reducer's state.
 * - `routing` — a pending mark was sent; `confirmWhenReady` is ✓ pressed
 *   while it routes (the proposal is committed the moment it lands).
 * - `proposed` — landed and shown; `confirmNow` carries that ✓ through.
 * - `refused` — the reason is the notice's text; ✓ is disabled.
 */
export type ProposalState =
  | { phase: "idle" }
  | { phase: "routing"; token: number; how: EditKind; confirmWhenReady: boolean }
  | { phase: "proposed"; proposal: EditProposal; confirmNow: boolean }
  | { phase: "refused"; token: number; how: EditKind; reason: string };

export type ProposalAction =
  /** A pending mark (re)sent for routing under a new token. */
  | { type: "route"; token: number; how: EditKind }
  /** An answer arrived; ignored unless `proposal.token` is the one routing. */
  | { type: "landed"; proposal: EditProposal }
  /** The answer was a refusal; ignored unless `token` is the one routing. */
  | { type: "refused"; token: number; reason: string }
  /** ✓. While routing: confirm when ready. */
  | { type: "confirm" }
  /** ✕, or the pending mark went away: back to idle, nothing kept. */
  | { type: "discard" }
  /** The page committed the proposal into the ride and the history. */
  | { type: "committed" };

/**
 * Whether a landed proposal may enter the ride now. One that waits for
 * „Tomēr braukt” (`accept`) only when that chip armed it — by its token —
 * whatever path asks: ✓ (disabled for it anyway), a batch's confirm-all, a
 * ✓ pressed while it routed, a whole-span proposal. `commitProposal` asks
 * this first; the chip arms, then confirms like ✓.
 */
export function mayCommit(proposal: Pick<EditProposal, "accept" | "token">, armedToken: number | null): boolean {
  return !proposal.accept || armedToken === proposal.token;
}

export const IDLE_PROPOSAL: ProposalState = { phase: "idle" };

/**
 * What the map draws for a proposal (`RouteMap` prop `proposal`): the chip in
 * the notice slot (`text`, with `title` its full sentence for the tooltip and
 * a screen reader), and the proposed line over the dimmed ride. `line` is
 * null while routing or refused. `changed` is metres along `line` where it is
 * new, for the yellow halo. `tone` absent = a landed proposal.
 */
export type ProposalView = {
  text: string;
  /** The proposal's notes („Punkts pārvietots 40 m…”), said under the chip, smaller. */
  notes?: string;
  title: string;
  tone?: "routing" | "refused";
  /** A proposal that waits for „Tomēr braukt” (`EditProposal.accept`): drawn, warned, ✓ off. */
  warn?: true;
  line: Segments | null;
  changed: [number, number][];
  /** What to do now, said after `text` with an en dash (lib/map/edit-guidance.ts): „✓ apstiprina, ✕ atmet.” */
  guide?: string;
};

/**
 * The preview's state machine.
 *
 * - `route` always starts over: a newer pending mark supersedes whatever was
 *   routing, proposed or refused, and a ✓ pressed for the old one does not
 *   carry over to the new one (the rider confirmed a line he has not seen).
 * - `landed` / `refused` count only for the token that is routing; an older
 *   answer, or one arriving after ✕, is dropped (the same state comes back,
 *   so a React reducer does not re-render).
 * - `confirm` while routing is remembered (`confirmWhenReady`) and carried
 *   into the proposal as `confirmNow`; on a landed proposal it sets
 *   `confirmNow`; idle or refused, it does nothing — ✓ is disabled there.
 * - `discard` and `committed` return to idle from anywhere.
 */
export function proposalReducer(state: ProposalState, action: ProposalAction): ProposalState {
  switch (action.type) {
    case "route":
      return { phase: "routing", token: action.token, how: action.how, confirmWhenReady: false };
    case "landed":
      if (state.phase !== "routing" || action.proposal.token !== state.token) return state;
      return { phase: "proposed", proposal: action.proposal, confirmNow: state.confirmWhenReady };
    case "refused":
      if (state.phase !== "routing" || action.token !== state.token) return state;
      return { phase: "refused", token: state.token, how: state.how, reason: action.reason };
    case "confirm":
      if (state.phase === "routing") return state.confirmWhenReady ? state : { ...state, confirmWhenReady: true };
      if (state.phase === "proposed") return state.confirmNow ? state : { ...state, confirmNow: true };
      return state;
    case "discard":
    case "committed":
      return state.phase === "idle" ? state : IDLE_PROPOSAL;
    default:
      return state;
  }
}

type DeltaSource = Pick<EditedRide, "distanceMeters" | "durationSeconds" | "overlap">;

/** The chip's numbers from the ride before and the proposed one. Unrounded; `formatEditDelta` rounds. */
export function editDelta(before: DeltaSource, after: DeltaSource): EditDelta {
  return {
    kmBefore: before.distanceMeters / 1000,
    kmAfter: after.distanceMeters / 1000,
    secondsDelta: after.durationSeconds - before.durationSeconds,
    repeatedBefore: before.overlap.repeatedPercent,
    repeatedAfter: after.overlap.repeatedPercent,
  };
}

/** U+2212, the typographic minus — „−2 min”, not a hyphen. */
const MINUS = "−";

/**
 * A signed duration in whole minutes: „+6 min”, „−1 h 5 min”, „±0 min”.
 * „h” and „min” read the same in all four languages (as elsewhere in Mopik).
 */
export function formatSignedMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes === 0) return "±0 min";
  const sign = minutes > 0 ? "+" : MINUS;
  const m = Math.abs(minutes);
  const body = m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
  return `${sign}${body}`;
}

/**
 * Fill `template` (the `previewDelta` or `previewDeltaTitle` message) from
 * `delta`: {a} {b} km with one decimal in `locale` (comma in lv/lt/et), {t}
 * the signed time, {r1} {r2} whole percent.
 */
export function formatEditDelta(template: string, delta: EditDelta, locale: UiLocale): string {
  const km = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const pct = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const values: Record<string, string> = {
    a: km.format(delta.kmBefore),
    b: km.format(delta.kmAfter),
    t: formatSignedMinutes(delta.secondsDelta),
    r1: pct.format(Math.round(delta.repeatedBefore)),
    r2: pct.format(Math.round(delta.repeatedAfter)),
  };
  return template.replace(/\{(a|b|t|r1|r2)\}/g, (_, k: string) => values[k]);
}
