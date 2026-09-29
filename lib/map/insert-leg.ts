import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import { anchorsAlong, anchorsOf, isShape, nearestWithin, type RidePlaces } from "@/lib/routing/reroute-leg";

/**
 * Where a new point goes in the ride, and when Mopik is not sure (rider,
 * 2026-09-28 — docs/DESIGN-route-editing.md, Phase 1 addition, §1 and §3).
 *
 * A point added from the map goes into the leg it is nearest to — Garmin's
 * and Ride with GPS's "insert into nearest leg". Nearest is the smallest
 * detour: over every leg, dist(prev, p) + dist(p, next) − dist(prev, next).
 * Planning, the legs are the straight lines between the places; editing, the
 * ride's own line: the leg is ridden to where its line passes nearest to p,
 * out to p and back, so its detour is twice that distance.
 *
 * Mopik says it is not sure — and offers the two best places by detour,
 * the best preselected — only when those two are close: the second's detour
 * at most `UNSURE_RATIO` times the best's, or within `UNSURE_FLOOR_M` of it
 * (release B, rider 2026-09-28, images/25–26: Grostonas iela 19 → Ērgļi,
 * one way, points 2–5 km north of the line by Ropaži were all asked „Pēc
 * „Grostonas iela 19”” / „Beigās (jauns finišs)”, because the old rule
 * asked whenever a point was more than 2 km from the line — on a long
 * one-way ride with one leg the answer was never in doubt: that leg's detour
 * was 4–10 km, a new finish's 75 km). A new finish („Beigās”) is one of the
 * candidates like any leg: offered only when it is one of the two best, and
 * preselected only when it is the best — and then always beside the best
 * leg, never taken alone. Pure, so the rules are tested
 * without a map (scripts/insert-leg.test.ts).
 */

export type Pt = { lat: number; lon: number };

/**
 * The second-best detour at most this many times the best: Mopik is not sure
 * and asks. 1.25 — a quarter more. The old rule (within 15 % of the larger,
 * i.e. 1.18) plus "far from the line" asked for points whose nearest leg was
 * obvious; a ratio says how much the choice matters wherever the point is.
 */
export const UNSURE_RATIO = 1.25;
/**
 * …or the two within this many metres of each other: near a place both legs
 * either side of it cost almost nothing, and the ratio of two small numbers
 * says little — which side of „A” is still the rider's to say.
 */
export const UNSURE_FLOOR_M = 200;
/** A moved pass-through point this close to the line elsewhere may mean "the line already goes here" (§3). */
export const ON_LINE_M = 20;

/**
 * One place the new point could go.
 * - `before` / `after`: the rows of the fixed places either side, in the
 *   rows *without* the new point; null for an open end (an empty start or
 *   finish row) — and `after` is null for a new finish (`extend`).
 * - `index`: the row the new point gets, in those same rows.
 * - `onLine`: editing, where the leg's line passes nearest to the point
 *   ([lon, lat]) — where a pass-through point enters the ride.
 */
export type InsertOption = {
  key: string;
  before: number | null;
  after: number | null;
  /** After the one-way finish: the point becomes the finish, the old one a stop. */
  extend: boolean;
  /** Metres. */
  detour: number;
  /** Editing: metres from the leg's line; planning: 0 (there is no line). */
  distance: number;
  index: number;
  onLine: Point | null;
};

export type Placement = {
  chosen: InsertOption;
  /** Two choices, the first the preselected one — or null when Mopik is sure. */
  options: InsertOption[] | null;
  /** "close": the best two are legs; "beyond-finish": one of them is a new finish. */
  unsure: null | "close" | "beyond-finish";
};

const pt = (p: Pt): Point => [p.lon, p.lat];

/** Where along segment a→b the point projects, 0…1 (flat, local). */
function along2(a: Pt, b: Pt, p: Pt): number {
  const cos = Math.cos((a.lat * Math.PI) / 180) || 1;
  const dx = (b.lon - a.lon) * cos, dy = b.lat - a.lat;
  const len = dx * dx + dy * dy;
  if (len === 0) return 0;
  return Math.max(0, Math.min(1, (((p.lon - a.lon) * cos) * dx + (p.lat - a.lat) * dy) / len));
}

type Anchor = { row: number | null; at: Pt | null; kind: "place" | "return" | "open-start" | "open-end" };

/**
 * The leg a new point goes into, or null when the rows have no place yet
 * (nothing to put it between — the row stays where it is).
 *
 * `rows` are the form's rows without the new point, each its place or null
 * (empty); `pending` marks rows that are other new points not yet in the
 * ride — they are not places to measure legs by, but the new point is
 * ordered among those in the same leg by where it meets that leg. `line`,
 * editing, is the ride's drawn line as [lon, lat]. `allowExtend` false
 * leaves out a new finish (a pass-through point never is one). `choose` is
 * an option's `key` the rider picked; otherwise the preselected one.
 */
export function placeNewPoint(p: {
  rows: readonly (Pt | null)[];
  pending?: readonly boolean[];
  point: Pt;
  oneWay: boolean;
  line?: readonly Point[] | null;
  allowExtend?: boolean;
  choose?: string | null;
}): Placement | null {
  const { rows, point, oneWay } = p;
  const pending = (i: number) => Boolean(p.pending?.[i]);
  const fixed = rows.map((r, i) => (r && !pending(i) ? i : -1)).filter((i) => i >= 0);
  if (!fixed.length) return null;
  const last = rows.length - 1;
  const finishFixed = oneWay && last > 0 && fixed.includes(last);

  const anchors: Anchor[] = fixed.map((row) => ({ row, at: rows[row], kind: "place" as const }));
  if (fixed[0] !== 0) anchors.unshift({ row: null, at: null, kind: "open-start" });
  if (!oneWay && fixed[0] === 0) anchors.push({ row: 0, at: rows[0], kind: "return" });
  if (oneWay && !finishFixed) anchors.push({ row: null, at: null, kind: "open-end" });

  const line = p.line && p.line.length >= 2 && anchors[0].kind !== "open-start" ? (p.line as Point[]) : null;
  const cum = line ? cumulative(line) : null;
  const along = line && cum
    ? anchorsAlong(anchors.map((a) => (a.at ? pt(a.at) : line[line.length - 1])), line, cum)
    : null;

  const candidates: InsertOption[] = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k], b = anchors[k + 1];
    // The rows the new point may go between.
    const lo = a.row ?? 0;
    const hi = b.kind === "return" ? rows.length : b.kind === "open-end" ? last : (b.row as number);
    let detour: number, distance = 0, onLine: Point | null = null;
    let order: (q: Pt) => number;
    if (line && cum && along) {
      const from = along[k], to = along[k + 1];
      const n = nearestWithin(pt(point), line, cum, from, to);
      distance = n.meters;
      detour = 2 * n.meters;
      onLine = pointAtDistance(line, cum, n.alongMeters).point;
      order = (q) => nearestWithin(pt(q), line, cum, from, to).alongMeters;
    } else if (a.at && b.at) {
      detour = haversineMeters(pt(a.at), pt(point)) + haversineMeters(pt(point), pt(b.at)) - haversineMeters(pt(a.at), pt(b.at));
      const [aa, bb] = [a.at, b.at];
      order = (q) => along2(aa, bb, q);
    } else if (b.at) {
      detour = haversineMeters(pt(point), pt(b.at));
      const bb = b.at;
      order = (q) => -haversineMeters(pt(q), pt(bb));
    } else {
      const aa = a.at as Pt;
      detour = haversineMeters(pt(aa), pt(point));
      order = (q) => haversineMeters(pt(aa), pt(q));
    }
    // After the other new points of this leg that meet it first.
    const t = order(point);
    let index = lo + 1;
    for (let j = lo + 1; j < hi; j++) if (pending(j) && rows[j] && order(rows[j] as Pt) <= t) index = j + 1;
    candidates.push({
      key: `leg:${k}`,
      before: a.kind === "open-start" ? null : a.row,
      after: b.kind === "open-end" ? null : b.row,
      extend: false,
      detour: Math.max(0, detour),
      distance,
      index,
      onLine,
    });
  }
  if (finishFixed && p.allowExtend !== false) {
    const d = haversineMeters(pt(rows[last] as Pt), pt(point));
    candidates.push({ key: "extend", before: last, after: null, extend: true, detour: d, distance: d, index: rows.length, onLine: null });
  }

  const ranked = [...candidates].sort((x, y) => x.detour - y.detour);
  let unsure: Placement["unsure"] = null;
  let options: InsertOption[] | null = null;
  // A new finish as the best is never taken without the other choice beside
  // it: the ride's finish is the one place the rider named for its end.
  if (ranked.length > 1 && (isClose(ranked[0].detour, ranked[1].detour) || ranked[0].extend)) {
    options = [ranked[0], ranked[1]];
    unsure = options.some((o) => o.extend) ? "beyond-finish" : "close";
  }
  const chosen = (p.choose ? candidates.find((c) => c.key === p.choose) : undefined) ?? ranked[0];
  return { chosen, options, unsure };
}

/** Two detours close enough that the choice is the rider's (`UNSURE_RATIO`, `UNSURE_FLOOR_M`). */
export function isClose(best: number, second: number): boolean {
  return second - best <= UNSURE_FLOOR_M || second <= UNSURE_RATIO * best;
}

/**
 * The number each row's pin wears: stops are numbered 1…n in riding order,
 * a new point pending among them included — so the stops after it move up
 * one while it waits (§1: "old 3 becomes 4"). Sights carry a glyph and no
 * number; the start, the finish and empty rows none either.
 */
export function stopNumbers(rows: readonly ("stop" | "sight" | "none")[]): (number | null)[] {
  let n = 0;
  return rows.map((r) => (r === "stop" ? ++n : null));
}

/**
 * §3: a pass-through point being moved to `to`, on the ride's line
 * somewhere other than the stretch it shapes itself (between the places
 * before and after it) — within `ON_LINE_M`. The line may then already go
 * there, so the rider is asked: keep the point here, or remove it.
 * `shapeIndex` counts the pass-through points in riding order.
 */
export function onLineElsewhere(p: { line: readonly Point[]; places: RidePlaces; shapeIndex: number; to: Pt; within?: number }): boolean {
  const line = p.line as Point[];
  if (line.length < 2) return false;
  let seen = -1;
  const via = p.places.vias.findIndex((v) => isShape(v) && ++seen === p.shapeIndex);
  if (via < 0) return false;
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const along = anchorsAlong(anchorsOf(p.places, line[line.length - 1]), line, cum);
  const k = via + 1;
  const [from, to] = [along[k - 1], along[k + 1]];
  const target = pt(p.to);
  const near = Math.min(
    from > 0 ? nearestWithin(target, line, cum, 0, from).meters : Infinity,
    to < total ? nearestWithin(target, line, cum, to, total).meters : Infinity,
  );
  return near <= (p.within ?? ON_LINE_M);
}
