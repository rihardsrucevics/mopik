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
 * on. The functions are stubs — owned and implemented by P1-A.
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
  title: string;
  tone?: "routing" | "refused";
  line: Segments | null;
  changed: [number, number][];
};

/** STUB (P1-A): returns the state unchanged. */
export function proposalReducer(state: ProposalState, action: ProposalAction): ProposalState {
  void action;
  return state;
}

/** STUB (P1-A): the chip's numbers from the ride before and the proposed one. */
export function editDelta(
  before: Pick<EditedRide, "distanceMeters" | "durationSeconds" | "overlap">,
  after: Pick<EditedRide, "distanceMeters" | "durationSeconds" | "overlap">,
): EditDelta {
  void before; void after;
  throw new Error("editDelta: not implemented (P1-A)");
}

/**
 * STUB (P1-A): fill `template` (the `previewDelta` or `previewDeltaTitle`
 * message) from `delta` — {a} {b} km with one decimal in `locale`, {t} the
 * signed time („+6 min”, „−1 h 5 min”, „±0 min”), {r1} {r2} whole percent.
 * Returns the template unfilled until implemented.
 */
export function formatEditDelta(template: string, delta: EditDelta, locale: UiLocale): string {
  void delta; void locale;
  return template;
}
