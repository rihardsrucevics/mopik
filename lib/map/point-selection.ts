/**
 * The point the rider tapped on the map — a ride pin or a pass-through point
 * („caurbraucams punkts”) — and what can be done to it there (rider,
 * 2026-09-25; Phase 1, docs/DESIGN-route-editing.md B3). Pure, so the rules
 * are tested without a map (scripts/point-selection.test.ts).
 *
 * Three phases:
 * - `menu`: the point is ringed and its sheet is open. The map takes no
 *   marks meanwhile: a tap on the map closes the sheet, it never moves
 *   anything.
 * - `move`: „Pārvietot” was chosen. The sheet gives way to one line in the
 *   bottom bar („Izvēlies jaunu vietu kartē”); the next mark is the point's
 *   new place, pending until ✓. A pin's row is the active row for it.
 * - `remove`: „Izņemt” was chosen while editing a ride with preview
 *   (`RideEdit.onPropose`): the ride without the point is routed and shown;
 *   the point stays ringed until ✓ takes it out or ✕ keeps it.
 *
 * It ends — the ring, the sheet, all of it — through the composer's one
 * exit, `leaveTransient()`: ✓, ✕, a kind switch, the sheet's own ✕ or
 * Cancel, Escape, or anything that takes the map elsewhere (another row, a
 * line drag, a batch). Only a new tap selects again.
 */
export type PointSelection =
  | { kind: "pin"; role: "start" | "via" | "finish"; row: number; phase: "menu" | "move" | "remove" }
  | { kind: "shape"; index: number; phase: "menu" | "move" | "remove" };

/**
 * - `move` „Pārvietot”; `remove` „Izņemt”;
 * - `demote` „Padarīt caurbraucamu” — a stop becomes a pass-through point;
 * - `promote` „Padarīt par pieturu” — a pass-through point becomes a stop.
 */
export type PointAction = "move" | "demote" | "promote" | "remove";

/**
 * The sheet's rows, in order (B3). The same in planning and in edit mode:
 * the start and the finish can only be moved; a stop can be moved, made a
 * pass-through point, or removed; a pass-through point can be moved, made a
 * stop, or removed. „Izņemt” is last. Planning, the kind switch moves a row
 * out of the form (a white dot stays) and back; editing, it is one commit.
 * `mode` is part of the signature so a later phase can differ per mode
 * („Zīmēt no šejienes”, P3) without every caller changing.
 */
export function pointActions(sel: Pick<PointSelection, "kind"> & { role?: "start" | "via" | "finish" }, mode: "plan" | "edit" = "edit"): PointAction[] {
  void mode;
  if (sel.kind === "shape") return ["move", "promote", "remove"];
  return sel.role === "via" ? ["move", "demote", "remove"] : ["move"];
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
  // A pending removal, like the menu, lives while no row has the map.
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

/**
 * Planning's pass-through points (Phase 1, docs/DESIGN-route-editing.md B1):
 * a planned stop made „caurbraucams” leaves the form and stays on the map as
 * a small white dot; the plan carries it as `shapePoints`, which the
 * generator rides through (`interleaveShapes`). „Padarīt par pieturu” on the
 * dot brings the row back where it was.
 *
 * A dot follows a place, as the plan's `afterPlace` does — but by the
 * place's *name*, not its index: the rows are reordered, removed and added
 * while a ride is planned, and an index would quietly move a dot into
 * another leg (a spur the rider never asked for). `after` is the name of the
 * place it follows, trimmed and lower-cased; null is the start. A dot whose
 * place is gone from the rows is not part of the plan any more and is not
 * drawn — nothing guessed. The composer keeps the list; everything here is
 * pure and tested (scripts/point-selection.test.ts).
 */
export type PlanDot = { lat: number; lon: number; after: string | null };

const nameKey = (s: string) => s.trim().toLowerCase();

/**
 * The rows as `composeRidePlan` reads them: the filled rows in order, the
 * first the start and — one way — the last the finish.
 */
function planPlaces(rows: readonly string[], oneWay: boolean): { anchors: number[]; finish: number | null } {
  const filled = rows.map((r, i) => (r.trim() ? i : -1)).filter((i) => i >= 0);
  if (!filled.length) return { anchors: [], finish: null };
  return oneWay && filled.length > 1
    ? { anchors: filled.slice(0, -1), finish: filled[filled.length - 1] }
    : { anchors: filled, finish: null };
}

/** The ride in riding order: its places (as rows) and the dots between them. */
export type PlanItem = { kind: "row"; row: number } | { kind: "dot"; index: number; lat: number; lon: number };

export function planSequence(rows: readonly string[], dots: readonly PlanDot[], oneWay: boolean): PlanItem[] {
  const { anchors, finish } = planPlaces(rows, oneWay);
  // The place a dot follows, as an index into `anchors`; -1 when it is gone.
  const anchorOf = (d: PlanDot) => {
    if (d.after === null) return 0;
    const k = anchors.slice(1).findIndex((r) => nameKey(rows[r]) === d.after);
    return k < 0 ? -1 : k + 1;
  };
  const out: PlanItem[] = [];
  anchors.forEach((row, k) => {
    out.push({ kind: "row", row });
    dots.forEach((d, index) => { if (anchorOf(d) === k) out.push({ kind: "dot", index, lat: d.lat, lon: d.lon }); });
  });
  if (finish !== null) out.push({ kind: "row", row: finish });
  return out;
}

/** The dots back out of a sequence, each following the place before it. */
function dotsOf(seq: readonly PlanItem[], rows: readonly string[]): PlanDot[] {
  const out: PlanDot[] = [];
  let after: string | null | undefined;
  for (const item of seq) {
    if (item.kind === "row") { after = after === undefined ? null : nameKey(rows[item.row]); continue; }
    out.push({ lat: item.lat, lon: item.lon, after: after ?? null });
  }
  return out;
}

/**
 * The dots that are part of the plan now, in riding order, each with the row
 * it follows (for the map: the dot, and its place in the dashed plan line).
 * `index` is the dot's index in the composer's list.
 */
export function livePlanDots(rows: readonly string[], dots: readonly PlanDot[], oneWay: boolean): { index: number; lat: number; lon: number; afterRow: number }[] {
  const out: { index: number; lat: number; lon: number; afterRow: number }[] = [];
  let afterRow = 0;
  for (const item of planSequence(rows, dots, oneWay)) {
    if (item.kind === "row") afterRow = item.row;
    else out.push({ index: item.index, lat: item.lat, lon: item.lon, afterRow });
  }
  return out;
}

/**
 * The plan's `shapePoints` for these rows: `afterPlace` is the index in
 * `[start, ...viaPlaces]` of the place each dot follows. At most
 * `max` (`MAX_SHAPE_POINTS`); none is an empty list, and the caller then
 * leaves the field out so the plan encodes as it always has.
 */
export function planShapePoints(rows: readonly string[], dots: readonly PlanDot[], oneWay: boolean, max: number): { lat: number; lon: number; afterPlace: number }[] {
  const out: { lat: number; lon: number; afterPlace: number }[] = [];
  let places = 0;
  for (const item of planSequence(rows, dots, oneWay)) {
    if (item.kind === "row") { places++; continue; }
    out.push({ lat: item.lat, lon: item.lon, afterPlace: Math.max(0, places - 1) });
  }
  return out.slice(0, max);
}

/** A plan's own `shapePoints` as dots, for the rows `placesFromPlan` made of it. */
export function planDotsFromPlan(rows: readonly string[], shapes: readonly { lat: number; lon: number; afterPlace: number }[] | undefined, oneWay: boolean): PlanDot[] {
  if (!shapes?.length) return [];
  const { anchors } = planPlaces(rows, oneWay);
  return shapes.map((s) => {
    const k = Math.min(Math.max(0, s.afterPlace), Math.max(anchors.length - 1, 0));
    return { lat: s.lat, lon: s.lon, after: k === 0 || !anchors[k] ? null : nameKey(rows[anchors[k]]) };
  });
}

/** Picks re-keyed after row `at` is removed (-1) or inserted (+1). */
function shiftRows<P>(picked: Record<number, P | null>, at: number, by: 1 | -1): Record<number, P | null> {
  const out: Record<number, P | null> = {};
  for (const [k, v] of Object.entries(picked)) {
    const i = Number(k);
    if (by === -1 && i === at) continue;
    out[i >= at + (by === -1 ? 1 : 0) ? i + by : i] = v;
  }
  return out;
}

/**
 * „Padarīt caurbraucamu” on a planned stop: its row leaves the form, and a
 * dot takes its place in riding order at the stop's own spot — before any
 * dot that followed the stop, which now follows the place before it. Null
 * when the row is not a filled place of the plan (the caller only offers it
 * on a stop's pin).
 */
export function demoteInPlan<P extends { lat: number; lon: number }>(s: {
  rows: readonly string[]; picked: Record<number, P | null>; dots: readonly PlanDot[]; oneWay: boolean; row: number;
}): { rows: string[]; picked: Record<number, P | null>; dots: PlanDot[] } | null {
  const place = s.picked[s.row];
  const seq = planSequence(s.rows, s.dots, s.oneWay);
  const at = seq.findIndex((item) => item.kind === "row" && item.row === s.row);
  if (!place || at <= 0) return null;
  const rows = s.rows.filter((_, i) => i !== s.row);
  const next: PlanItem[] = seq.map((item, i): PlanItem => (i === at
    ? { kind: "dot", index: -1, lat: place.lat, lon: place.lon }
    : item.kind === "row" && item.row > s.row ? { kind: "row", row: item.row - 1 } : item));
  return { rows, picked: shiftRows(s.picked, s.row, -1), dots: dotsOf(next, rows) };
}

/**
 * „Padarīt par pieturu” on a planning dot: a row comes back right after the
 * place the dot follows, holding `place` (the dot's spot, named by the
 * reverse lookup); dots after it in the same leg now follow the new stop.
 * Null when the dot is not part of the plan.
 */
export function promoteInPlan<P extends { name: string; lat: number; lon: number }>(s: {
  rows: readonly string[]; picked: Record<number, P | null>; dots: readonly PlanDot[]; oneWay: boolean; index: number; place: P;
}): { rows: string[]; picked: Record<number, P | null>; dots: PlanDot[]; row: number } | null {
  const seq = planSequence(s.rows, s.dots, s.oneWay);
  const at = seq.findIndex((item) => item.kind === "dot" && item.index === s.index);
  if (at < 0) return null;
  const before = [...seq.slice(0, at)].reverse().find((item): item is Extract<PlanItem, { kind: "row" }> => item.kind === "row");
  const row = (before?.row ?? 0) + 1;
  const rows = [...s.rows.slice(0, row), s.place.name, ...s.rows.slice(row)];
  const picked = { ...shiftRows(s.picked, row, 1), [row]: s.place };
  const next: PlanItem[] = seq.map((item, i): PlanItem => (i === at
    ? { kind: "row", row }
    : item.kind === "row" && item.row >= row ? { kind: "row", row: item.row + 1 } : item));
  return { rows, picked, dots: dotsOf(next, rows), row };
}
