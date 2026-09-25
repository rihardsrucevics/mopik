import type { ShapeEdit } from "@/lib/routing/reroute-leg";

/**
 * The one state a shaping point („maršruta punkts”) is ever "being edited"
 * in, and every way out of it (edit mode, rider 2026-09-25).
 *
 * His report: he dragged the line, confirmed, and a point "stayed there" —
 * still draggable, impossible to remove, and the next thing he did broke the
 * map. His rule: **after ✓ (or ✕) the point's edit state is left completely.**
 * The point is then a plain white dot on the line; nothing is selected or
 * pending, and he carries on with something else. Only a tap on it opens it
 * again.
 *
 * So this is the whole of it, pure, and tested (`scripts/shape-pending.test.ts`):
 *
 * - `grab` — the line was taken hold of at `at`: a point is waiting for its
 *   place. It replaces anything else pending about shaping points.
 * - `mark` — a place for the waiting point. Only a grab takes one; with
 *   nothing waiting a mark is not a shaping point's business.
 * - `confirm` — commits the waiting point (when it has a place) and ends the
 *   state. `cancel`, `remove`, `promote` end it too, and so does anything
 *   that hands the map to a row (`row`) or re-seeds the rows from the ride
 *   (`reseed`: an undo, a refused edit).
 *
 * Every step says whether the map should still be taking marks for it
 * (`picking`): only while a grab waits. Ending the state always says false,
 * so the pending marker, its connector and the grab's dot go with it.
 */
export type ShapePending =
  | { kind: "add"; at: { lat: number; lon: number }; to: { lat: number; lon: number } | null }
  | { kind: "move"; index: number; to: { lat: number; lon: number } };

export type ShapeEvent =
  | { type: "grab"; at: { lat: number; lon: number } }
  | { type: "mark"; at: { lat: number; lon: number } }
  | { type: "confirm" }
  | { type: "cancel" }
  | { type: "remove" }
  | { type: "promote" }
  | { type: "row" }
  | { type: "reseed" };

export function stepShape(
  pending: ShapePending | null,
  event: ShapeEvent,
): { pending: ShapePending | null; picking: boolean; commit: ShapeEdit | null } {
  const done = { pending: null, picking: false, commit: null };
  switch (event.type) {
    case "grab":
      return { pending: { kind: "add", at: event.at, to: null }, picking: true, commit: null };
    case "mark":
      if (pending?.kind !== "add") return { pending, picking: false, commit: null };
      return { pending: { ...pending, to: event.at }, picking: true, commit: null };
    case "confirm": {
      if (!pending) return done;
      if (pending.kind === "add") {
        // Nowhere to go yet: Confirm is not offered, and a stray press keeps waiting.
        if (!pending.to) return { pending, picking: true, commit: null };
        return { ...done, commit: { kind: "add", lat: pending.to.lat, lon: pending.to.lon, grabbedAt: [pending.at.lon, pending.at.lat] } };
      }
      return { ...done, commit: { kind: "move", index: pending.index, lat: pending.to.lat, lon: pending.to.lon } };
    }
    default:
      return done;
  }
}
