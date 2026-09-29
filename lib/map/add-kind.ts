/**
 * „+” on the map asks what to add (rider, 2026-09-29): a stop („Pietura” –
 * Mopik finds the road to it) or a pass-through point („Caurbraucams punkts”
 * – it only steers the line, no number). He used to add stops and convert
 * them one by one.
 *
 * Pure and tested (`scripts/add-kind.test.ts`):
 *
 * - `stepAdd` — the chooser's state machine: idle → choose → armed (no point
 *   yet) → pending (n points of that kind) → committed / cancelled → idle.
 *   „+” while armed or pending is not asked again.
 * - `readAddKind` / `writeAddKind` — the last choice, remembered in
 *   localStorage and preselected; the chooser is still shown every time.
 *   Storage that is missing or throws is no preference, never an error.
 * - `kindSwitch` — the point sheet's one „Pietura | Caurbraucams” control:
 *   which kind the point is, whether it can switch, and why not.
 */

export type AddKind = "stop" | "pass";

export type AddSession =
  | { phase: "idle" }
  /** The chooser is up; `preselected` is the remembered (or default) chip. */
  | { phase: "choose"; preselected: AddKind }
  /** The map is armed for `kind`; `count` points of it are pending (0: waiting for the first tap). */
  | { phase: "armed"; kind: AddKind; count: number };

export type AddEvent =
  /** „+” pressed; `remembered` is the stored preference. */
  | { type: "plus"; remembered: AddKind | null }
  | { type: "choose"; kind: AddKind }
  /** A tap on the map marked a pending point of the armed kind. */
  | { type: "mark" }
  /** ↶ took the last pending point off. */
  | { type: "unmark" }
  /** ✕ / Escape on the chooser. */
  | { type: "dismiss" }
  /** ✓: the pending points went into the ride. */
  | { type: "confirm" }
  /** ✕ / Escape once armed: nothing is added. */
  | { type: "cancel" };

export const IDLE: AddSession = { phase: "idle" };

/** A session that is armed — „+” is not asked again while it runs. */
export function armedRunning(s: AddSession): boolean {
  return s.phase === "armed";
}

/**
 * One step. `remember` is set when a choice was made: the page stores it
 * (`writeAddKind`). `outcome` says how an armed session ended.
 */
export function stepAdd(s: AddSession, e: AddEvent): { session: AddSession; remember?: AddKind; outcome?: "committed" | "cancelled" } {
  switch (e.type) {
    case "plus":
      if (s.phase === "armed") return { session: s };
      if (s.phase === "choose") return { session: s };
      return { session: { phase: "choose", preselected: e.remembered ?? "stop" } };
    case "choose":
      if (s.phase !== "choose") return { session: s };
      return { session: { phase: "armed", kind: e.kind, count: 0 }, remember: e.kind };
    case "mark":
      if (s.phase !== "armed") return { session: s };
      return { session: { ...s, count: s.count + 1 } };
    case "unmark":
      if (s.phase !== "armed") return { session: s };
      return { session: { ...s, count: Math.max(0, s.count - 1) } };
    case "dismiss":
      return s.phase === "choose" ? { session: IDLE } : { session: s };
    case "confirm":
      if (s.phase !== "armed") return { session: s };
      return s.count > 0 ? { session: IDLE, outcome: "committed" } : { session: s };
    case "cancel":
      if (s.phase === "idle") return { session: s };
      return { session: IDLE, outcome: s.phase === "armed" ? "cancelled" : undefined };
  }
}

export const ADD_KIND_KEY = "mopik.addKind";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** The remembered choice, or null — also when storage is missing or throws. */
export function readAddKind(storage: () => StorageLike | null | undefined): AddKind | null {
  try {
    const v = storage()?.getItem(ADD_KIND_KEY);
    return v === "stop" || v === "pass" ? v : null;
  } catch {
    return null;
  }
}

/** Remember the choice; a storage that throws (private mode, blocked) is ignored. */
export function writeAddKind(storage: () => StorageLike | null | undefined, kind: AddKind): void {
  try {
    storage()?.setItem(ADD_KIND_KEY, kind);
  } catch {
    // Nothing to do: the chooser still works, it just starts on „Pietura”.
  }
}

/** The browser's localStorage, read lazily so a throwing accessor is caught by the caller. */
export const browserStorage = (): StorageLike | null => (typeof window === "undefined" ? null : window.localStorage);

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
