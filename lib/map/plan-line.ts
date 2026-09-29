import type { Point } from "@/lib/geo/geometry";

/**
 * The straight dashed line that joins the planning map's pins in riding order
 * (rider, 2026-09-25: with four places confirmed he could not see the shape of
 * the ride he was composing). Straight on purpose — it is the order of the
 * places, not a route; the generated ride replaces it.
 *
 * `rows` are the form's rows in order, each its confirmed point or null (an
 * empty row is skipped). A round trip closes back to the start. `pending` is
 * a mark not yet confirmed: it is drawn separately, from the filled row before
 * it to the filled row after it, so a pending stop shows where it would slot
 * in — the confirmed line still runs through the row's old place, if it had
 * one, until Confirm.
 */
export function planLine(params: {
  rows: (Point | null)[];
  roundTrip: boolean;
  pending: { row: number; point: Point } | null;
}): { confirmed: Point[]; pending: Point[] | null } {
  const { rows, roundTrip, pending } = params;
  const filled = rows.map((p, i) => (p ? i : -1)).filter((i) => i >= 0);
  const confirmed = filled.map((i) => rows[i]!);
  if (roundTrip && confirmed.length >= 2) confirmed.push(confirmed[0]);
  if (!pending) return { confirmed: confirmed.length >= 2 ? confirmed : [], pending: null };
  const others = filled.filter((i) => i !== pending.row);
  let prev = [...others].reverse().find((i) => i < pending.row);
  let next = others.find((i) => i > pending.row);
  // Round trip: the ride comes back to the start, so the last place leads on
  // to it and the start is reached from the last place.
  if (roundTrip && next === undefined && pending.row !== 0 && rows[0]) next = 0;
  if (roundTrip && prev === undefined && others.length) prev = others[others.length - 1];
  const line = [
    ...(prev !== undefined ? [rows[prev]!] : []),
    pending.point,
    ...(next !== undefined && next !== prev ? [rows[next]!] : []),
  ];
  return { confirmed: confirmed.length >= 2 ? confirmed : [], pending: line.length >= 2 ? line : null };
}

/** A point of a pending connector; `id` names the pending mark it is (−1 the single mark, else a batch stop's id) so the map can move it live. */
export type LinkPoint = { lat: number; lon: number; id?: number };

/**
 * Edit mode's pending connectors (release B, rider 2026-09-28, images/27):
 * while points wait for ✓, thin grey dashed straight lines prev → new → next,
 * for each leg a pending point is in and no other — one chain per leg, the
 * leg's fixed places at its ends and its pending points between them in
 * riding order. One mechanism for every pending mark (a batch, a single new
 * or moved pin; a pass-through point's chain is resolved by the map along the
 * line), replacing the blue grab connector and the black move preview.
 *
 * `rows` are the form's rows in order, each its point or null (empty);
 * `pending` marks the rows that wait. A round trip's last leg leads back to
 * the start; a one-way ride's new finish ends its chain.
 */
export function pendingChains(params: { rows: readonly (LinkPoint | null)[]; pending: readonly boolean[]; roundTrip: boolean }): LinkPoint[][] {
  const { rows, pending, roundTrip } = params;
  const fixed = rows.map((r, i) => (r && !pending[i] ? i : -1)).filter((i) => i >= 0);
  const chains: LinkPoint[][] = [];
  let open: LinkPoint[] | null = null;
  let prevFixed: number | null = null;
  rows.forEach((r, i) => {
    if (!r) return;
    if (pending[i]) {
      if (!open) open = prevFixed !== null ? [rows[prevFixed]!] : [];
      open.push(r);
      return;
    }
    if (open) { open.push(r); chains.push(open); open = null; }
    prevFixed = i;
  });
  if (open) {
    const tail = open as LinkPoint[];
    // Past the last fixed place: a round trip rides back to the start.
    if (roundTrip && fixed.length) tail.push(rows[fixed[0]]!);
    chains.push(tail);
  }
  return chains.filter((c) => c.length >= 2);
}
