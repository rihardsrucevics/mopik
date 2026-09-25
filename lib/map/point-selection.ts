/**
 * The point the rider tapped on the map — a ride pin or a shaping point — and
 * what can be done to it there (rider, 2026-09-25). Pure, so the rules are
 * tested without a map (scripts/point-selection.test.ts).
 *
 * Two phases:
 * - `menu`: the point is ringed and its sheet is open — „Pārvietot”,
 *   „Padarīt par pieturu”, „Izņemt”. The map takes no marks meanwhile: a tap
 *   on the map closes the sheet, it never moves anything.
 * - `move`: „Pārvietot” was chosen. The sheet gives way to one line in the
 *   bottom bar („Izvēlies jaunu vietu kartē”); the next mark is the point's
 *   new place, pending until ✓. A pin's row is the active row for it.
 *
 * It ends — the ring, the sheet, all of it — on ✓, ✕, „Izņemt”, „Padarīt
 * par pieturu”, the sheet's own ✕ or Cancel, or anything that takes the map
 * elsewhere (another row, a line drag, a batch). Only a new tap selects again.
 */
export type PointSelection =
  | { kind: "pin"; role: "start" | "via" | "finish"; row: number; phase: "menu" | "move" }
  | { kind: "shape"; index: number; phase: "menu" | "move" };

export type PointAction = "move" | "promote" | "remove";

/**
 * The start and the finish can only be moved; a stop can also be removed; a
 * shaping point can be moved, made a stop, or removed. „Izņemt” is last.
 */
export function pointActions(sel: Pick<PointSelection, "kind"> & { role?: "start" | "via" | "finish" }): PointAction[] {
  if (sel.kind === "shape") return ["move", "promote", "remove"];
  return sel.role === "via" ? ["move", "remove"] : ["move"];
}

/**
 * Whether a selection still names a point that is there to act on. A pin's
 * menu lives while no row has the map (focusing a field ends it); its move
 * lives exactly as long as its row stays the active one — a confirm, or
 * another row chosen, ends it, whoever caused it. A shaping point's lives
 * while the dot exists.
 */
export function selectionLive(sel: PointSelection | null, now: { activeRow: number | null; shapeCount: number }): PointSelection | null {
  if (!sel) return null;
  if (sel.kind === "pin") return (sel.phase === "move" ? now.activeRow === sel.row : now.activeRow === null) ? sel : null;
  return sel.index < now.shapeCount ? sel : null;
}

/**
 * The places a point being moved or placed is joined to while it waits —
 * the one before it and the one after it in riding order, for the dashed
 * preview (rider, 2026-09-25, after OsmAnd: "you see at once which leg it
 * joins"). `along` is each anchor's distance along the ride; `at` the moving
 * point's own (its old place, or where the line was grabbed). A round trip
 * with nothing after leads back to the first anchor.
 */
export function neighboursAlong<T>(anchors: { point: T; along: number }[], at: number, roundTrip: boolean): T[] {
  const sorted = [...anchors].sort((a, b) => a.along - b.along);
  const before = [...sorted].reverse().find((a) => a.along < at);
  let after = sorted.find((a) => a.along > at);
  if (!after && roundTrip && sorted.length && sorted[0] !== before) after = sorted[0];
  return [before, after].filter((a): a is { point: T; along: number } => Boolean(a)).map((a) => a.point);
}
