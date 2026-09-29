/**
 * „+” on the map adds pass-through points (rider, 2026-09-30 — this replaces
 * the „Ko pievienot?” chooser of 2026-09-29): no question asked. A stop is
 * made of a point afterwards, with the pending „Pietura | Caurbraucams” chip
 * or the point sheet's switch; search (the map field) is for stops only.
 *
 * Pure and tested (`scripts/add-kind.test.ts`):
 *
 * - `stepAdd` — the session: idle → armed → pending (n points) → committed /
 *   cancelled → idle. „+” while armed is not a second session.
 * - `stepPassBatch` — the pending points of a session (backlog 53): a tap
 *   ADDS one, always — also while the batch is being routed; ↶ takes the last
 *   off; ✕ drops them all; a drag moves one. A tap never moves a point.
 * - `offerAllowed` / `stepOffer` — a tap on the empty map without „+” offers
 *   „Pievienot punktu šeit” (edit mode only): a marker and a chip; the chip
 *   adds one pending point there, a tap elsewhere, Escape or ✕ dismiss it.
 * - `kindSwitch` — the point sheet's one „Pietura | Caurbraucams” control.
 */

export type AddKind = "stop" | "pass";

export type AddSession =
  | { phase: "idle" }
  /** „+” pressed: taps add pass-through points; `count` of them are pending (0: waiting for the first tap). */
  | { phase: "armed"; count: number };

export type AddEvent =
  | { type: "plus" }
  /** A tap on the map added a pending point. */
  | { type: "mark" }
  /** ↶ took the last pending point off. */
  | { type: "unmark" }
  /** ✓: the pending points went into the ride. */
  | { type: "confirm" }
  /** ✕ / Escape: nothing is added. */
  | { type: "cancel" };

export const IDLE: AddSession = { phase: "idle" };

/** One step. `outcome` says how an armed session ended. */
export function stepAdd(s: AddSession, e: AddEvent): { session: AddSession; outcome?: "committed" | "cancelled" } {
  switch (e.type) {
    case "plus":
      return s.phase === "armed" ? { session: s } : { session: { phase: "armed", count: 0 } };
    case "mark":
      return s.phase === "armed" ? { session: { phase: "armed", count: s.count + 1 } } : { session: s };
    case "unmark":
      return s.phase === "armed" ? { session: { phase: "armed", count: Math.max(0, s.count - 1) } } : { session: s };
    case "confirm":
      if (s.phase !== "armed" || s.count === 0) return { session: s };
      return { session: IDLE, outcome: "committed" };
    case "cancel":
      return s.phase === "idle" ? { session: s } : { session: IDLE, outcome: "cancelled" };
  }
}

/** A pending pass-through point: where it was tapped, and where it joins the line (`at`, the grab point). */
export type PassItem = { id: number; lat: number; lon: number; at: { lat: number; lon: number } };

export type PassEvent =
  | { type: "add"; item: PassItem; max: number }
  | { type: "pop" }
  | { type: "drop"; id: number }
  | { type: "move"; id: number; lat: number; lon: number; at: { lat: number; lon: number } }
  | { type: "discard" };

/**
 * The batch's step. Nothing here knows whether the batch is being routed:
 * that is the point — a tap while it routes adds, exactly as any other tap.
 * `max` is how many the ride can still take (the pass-through cap).
 */
export function stepPassBatch(items: PassItem[], e: PassEvent): PassItem[] {
  switch (e.type) {
    case "add": return items.length >= e.max ? items : [...items, e.item];
    case "pop": return items.slice(0, -1);
    case "drop": return items.filter((i) => i.id !== e.id);
    case "move": return items.map((i) => (i.id === e.id ? { ...i, lat: e.lat, lon: e.lon, at: e.at } : i));
    case "discard": return [];
  }
}

/** The whole batch as one proposal: the first add and the rest (`more`), one routing, one ✓, one ↶ step. */
export function batchOps(items: PassItem[]): { op: { kind: "add"; lat: number; lon: number; grabbedAt: [number, number] }; more: { kind: "add"; lat: number; lon: number; grabbedAt: [number, number] }[] } | null {
  if (!items.length) return null;
  const ops = items.map((i) => ({ kind: "add" as const, lat: i.lat, lon: i.lon, grabbedAt: [i.at.lon, i.at.lat] as [number, number] }));
  return { op: ops[0], more: ops.slice(1) };
}

export type Offer = { lat: number; lon: number } | null;

/**
 * Whether a tap on the empty map offers „Pievienot punktu šeit”: edit mode
 * only (not the result or a shared map), and only when the map is otherwise
 * idle — no „+” session, nothing pending, no sheet or selection, no row
 * waiting for a place, nothing being routed, and room for another point.
 */
export function offerAllowed(p: { editing: boolean; armed: boolean; pending: boolean; selection: boolean; rowActive: boolean; busy: boolean; atShapeCap: boolean }): boolean {
  return p.editing && !p.armed && !p.pending && !p.selection && !p.rowActive && !p.busy && !p.atShapeCap;
}

export type OfferEvent =
  | { type: "emptyTap"; lat: number; lon: number; allowed: boolean }
  /** Escape, ✕, a tap on the line, a pin or anything that starts something else. */
  | { type: "dismiss" }
  /** The chip pressed: one pending point there. */
  | { type: "accept" };

/** A tap elsewhere while the offer is up dismisses it; it never jumps to the new spot. */
export function stepOffer(o: Offer, e: OfferEvent): { offer: Offer; add?: { lat: number; lon: number } } {
  switch (e.type) {
    case "emptyTap": return o ? { offer: null } : { offer: e.allowed ? { lat: e.lat, lon: e.lon } : null };
    case "dismiss": return { offer: null };
    case "accept": return o ? { offer: null, add: { lat: o.lat, lon: o.lon } } : { offer: null };
  }
}

export type KindSwitchReason = "end" | "shapeCap" | "stopCap" | "busy";

/**
 * The point sheet's „Pietura | Caurbraucams” control (B3, rider 2026-09-29:
 * one segmented control instead of two rows). `current` is the point's kind;
 * a tap on the other segment switches it (`to`) when `enabled`, else
 * `reason` says why not: the start and the finish only move (`end`), the
 * pass-through cap (`shapeCap`) or the stop cap (`stopCap`), or an edit
 * being routed (`busy`).
 */
export function kindSwitch(p: {
  object: "stop" | "pass" | "start" | "finish";
  passCount: number;
  maxPass: number;
  stopCount: number;
  maxStops: number;
  atRowCap?: boolean;
  busy?: boolean;
}): { current: AddKind; to: AddKind; enabled: boolean; reason: KindSwitchReason | null } {
  const current: AddKind = p.object === "pass" ? "pass" : "stop";
  const to: AddKind = current === "pass" ? "stop" : "pass";
  const reason: KindSwitchReason | null = p.object === "start" || p.object === "finish" ? "end"
    : p.busy ? "busy"
    : to === "pass" && p.passCount >= p.maxPass ? "shapeCap"
    : to === "stop" && (p.stopCount >= p.maxStops || p.atRowCap) ? "stopCap"
    : null;
  return { current, to, enabled: reason === null, reason };
}

/**
 * Every state of the map's add and edit flows has a way out and words
 * (rider, 2026-09-30, `images/46.png`: an empty stop row waiting, ✕ grey, no
 * notice — „I don't know how to get out of this state”). For a state, whether
 * it is idle, whether ✕ is on, and the guidance line: a state that is not
 * idle must have both.
 */
export function stateHasExit(s: { idle: boolean; cancelEnabled: boolean; guide: string | null | undefined }): boolean {
  return s.idle || (s.cancelEnabled && Boolean(s.guide && s.guide.trim()));
}
