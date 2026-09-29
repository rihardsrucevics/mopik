import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import { anchorsAlong, anchorsOf, EDIT_WINDOW_M, isShape, nogosAlong, pairKey, type AvoidStretch, type EditRun, type RidePlace, type RidePlaces } from "@/lib/routing/reroute-leg";

/**
 * A stretch of the ride's line the rider marked (backlog 36, design B3/D3/D4):
 * „Izslēgt šo posmu” — the ride goes round it, and the exclusion stays with
 * the ride (`RidePlaces.avoid`, the plan's `avoid`, share code key `x`) — and
 * „Atpakaļ pa citu ceļu” on a stretch ridden twice — the second pass
 * re-routed with the first fenced off, nothing kept.
 *
 * Pure: the selection, its ends, the fence and the run to re-route, tested
 * without a map (scripts/stretch.test.ts).
 */

/** A stretch as metres along the ride's line. */
export type Stretch = { fromMeters: number; toMeters: number };

export type { AvoidStretch };

/** The default selection reaches at most this far each way from the tap. */
export const STRETCH_CLAMP_M = 1_500;
/** A selection is never shorter than this (the two handles stay apart). */
export const STRETCH_MIN_M = 40;
/** …nor longer: a fence is ≤ 24 points and a run must stay a short request. */
export const STRETCH_MAX_M = 10_000;
/** Design C: at most 10 excluded stretches per ride, 24 points each. */
export const MAX_AVOID = 10;
export const AVOID_POINTS = 24;
/** Metres of road kept either side of the stretch in its re-routed run. */
export const STRETCH_WINDOW_M = EDIT_WINDOW_M;

/**
 * The stretch a tap selects: from the nearest break before the tap to the
 * nearest after it — a break is a junction we know of (a change of road
 * class or surface, where the ride's segments split) or a place — clamped
 * to ±`STRETCH_CLAMP_M` round the tap. A break right under the finger
 * (closer than half `STRETCH_MIN_M`) is not an end.
 */
export function defaultStretch(p: { total: number; alongMeters: number; breaks: readonly number[] }): Stretch {
  const at = Math.max(0, Math.min(p.total, p.alongMeters));
  const half = STRETCH_MIN_M / 2;
  let from = 0;
  let to = p.total;
  for (const b of p.breaks) {
    if (b < at - half && b > from) from = b;
    if (b > at + half && b < to) to = b;
  }
  from = Math.max(from, at - STRETCH_CLAMP_M);
  to = Math.min(to, at + STRETCH_CLAMP_M);
  return widen({ fromMeters: from, toMeters: to }, p.total);
}

/** At least `STRETCH_MIN_M`, inside the line. */
function widen(s: Stretch, total: number): Stretch {
  if (s.toMeters - s.fromMeters >= STRETCH_MIN_M || total < STRETCH_MIN_M) return s;
  const mid = (s.fromMeters + s.toMeters) / 2;
  const from = Math.max(0, Math.min(total - STRETCH_MIN_M, mid - STRETCH_MIN_M / 2));
  return { fromMeters: from, toMeters: from + STRETCH_MIN_M };
}

/**
 * One end dragged along the line to `alongMeters`: it never passes the other
 * end (they stay `STRETCH_MIN_M` apart), never leaves the line, and the
 * stretch never grows past `STRETCH_MAX_M`.
 */
export function moveStretchEnd(s: Stretch, end: "from" | "to", alongMeters: number, total: number): Stretch {
  if (end === "from") {
    const lo = Math.max(0, s.toMeters - STRETCH_MAX_M);
    const hi = Math.max(lo, s.toMeters - STRETCH_MIN_M);
    return { fromMeters: Math.max(lo, Math.min(hi, alongMeters)), toMeters: s.toMeters };
  }
  const lo = Math.min(total, s.fromMeters + STRETCH_MIN_M);
  const hi = Math.min(total, s.fromMeters + STRETCH_MAX_M);
  return { fromMeters: s.fromMeters, toMeters: Math.max(lo, Math.min(hi, alongMeters)) };
}

/** The stretch's own geometry: its two ends interpolated, every vertex between. */
export function stretchLine(line: readonly Point[], cum: readonly number[], s: Stretch): Point[] {
  const pts = line as Point[];
  const c = cum as number[];
  const a = pointAtDistance(pts, c, s.fromMeters);
  const b = pointAtDistance(pts, c, s.toMeters);
  const out: Point[] = [a.point];
  for (let i = a.index; i < b.index; i++) if (c[i] > s.fromMeters && c[i] < s.toMeters) out.push(pts[i]);
  out.push(b.point);
  return out;
}

/** A line cut to at most `max` points spread evenly along it (ends kept) — what the plan stores. */
export function resampleLine(line: readonly Point[], max = AVOID_POINTS): Point[] {
  if (line.length <= max) return [...line];
  const pts = line as Point[];
  const cum = cumulative(pts);
  const total = cum[cum.length - 1];
  return Array.from({ length: max }, (_, i) => pointAtDistance(pts, cum, (total * i) / (max - 1)).point);
}

const r5 = (n: number) => Math.round(n * 1e5) / 1e5;

/** The stretch as `plan.avoid` keeps it: ≤ 24 points, [lat, lon], 5 decimals. */
export function avoidOf(line: readonly Point[]): AvoidStretch {
  return { line: resampleLine(line).map(([lon, lat]): [number, number] => [r5(lat), r5(lon)]) };
}

/** An excluded stretch back as [lon, lat] points. */
export function avoidPoints(a: AvoidStretch): Point[] {
  return a.line.map(([lat, lon]): Point => [lon, lat]);
}

/** A polyline with a vertex at least every `stepM` — the fence's circles go on vertices. */
export function densify(line: readonly Point[], stepM = 100): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < line.length; i++) {
    if (i > 0) {
      const a = line[i - 1];
      const b = line[i];
      const n = Math.floor(haversineMeters(a, b) / stepM);
      for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / (n + 1), a[1] + ((b[1] - a[1]) * k) / (n + 1)]);
    }
    out.push(line[i]);
  }
  return out;
}

/**
 * The no-go circles that fence a stretch off (BRouter `nogos`): one every
 * 120 m along it, 50 m wide — the carriageway, not the parallel road the way
 * round may take — none within `clearM` of the points the run must still
 * reach (its cuts and places), so a fence never blocks its own ends.
 */
export function fenceNogos(fence: readonly Point[], keepClear: Point[], opts: { clearM?: number; maxCount?: number } = {}): { lon: number; lat: number; radius: number }[] {
  if (fence.length < 2) return [];
  return nogosAlong(densify(fence, 60), keepClear, { spacingM: 120, radiusM: 50, clearM: opts.clearM ?? 120, maxCount: opts.maxCount ?? 40 });
}

/**
 * The places along the line, by metres, as `anchorsAlong` finds them:
 * [start, ...vias, end]; `index` −1 is the start, `vias.length` the end.
 */
function placesAlong(places: RidePlaces, line: Point[], cum: number[]): { along: number; index: number; place: RidePlace | null }[] {
  const along = anchorsAlong(anchorsOf(places, line[line.length - 1]), line, cum);
  return along.map((m, k) => ({
    along: m,
    index: k - 1,
    place: k === 0 ? places.start : k <= places.vias.length ? places.vias[k - 1] : places.roundTrip ? places.start : places.finish,
  }));
}

export type StretchPlan =
  | {
      run: EditRun;
      /** The places after: pass-through points inside the stretch dropped; the avoid list grown when `persist`. */
      places: RidePlaces;
      /** How many pass-through points inside the stretch were dropped (said to the rider). */
      dropped: number;
      /** The fence for this run: the stretch itself, or the first pass. */
      fence: Point[];
      /** The places the run is between — for „starp „A” un „B” cita ceļa nav”. -1 = start, vias.length = finish/end. */
      between: [number, number];
    }
  | { error: "stop-inside"; index: number }
  | { error: "drawn" }
  | { error: "full" };

/**
 * The run that goes round a stretch (design D3/D4): the line from
 * `STRETCH_WINDOW_M` before `route` to as far after it, never past the
 * nearest place either side that stays (a stop, the start, the finish, a
 * pass-through point outside), and never across a drawn straight stretch
 * (`fixed`). A stop, the start or the finish inside `route` refuses it —
 * the ride cannot go round its own stop; a pass-through point inside is
 * dropped. `fence` is what the run must not ride (the stretch itself, or on
 * „Atpakaļ pa citu ceļu” the first pass); `persist` adds it to the ride's
 * excluded stretches.
 */
export function planStretch(p: {
  places: RidePlaces;
  line: Point[];
  cum?: number[];
  route: Stretch;
  fence: Point[];
  persist: boolean;
  fixed?: readonly [number, number][];
}): StretchPlan {
  const { places, line, route } = p;
  const cum = p.cum ?? cumulative(line);
  const total = cum[cum.length - 1];
  if ((p.fixed ?? []).some(([a, b]) => a < route.toMeters && b > route.fromMeters)) return { error: "drawn" };
  if (p.persist && (places.avoid?.length ?? 0) >= MAX_AVOID) return { error: "full" };
  const along = placesAlong(places, line, cum);
  const inside = along.filter((a) => a.along >= route.fromMeters && a.along <= route.toMeters);
  const stop = inside.find((a) => a.index < 0 || a.index >= places.vias.length || !isShape(places.vias[a.index]));
  if (stop) return { error: "stop-inside", index: stop.index };
  const dropIdx = new Set(inside.map((a) => a.index));
  const kept = along.filter((a) => !dropIdx.has(a.index));
  const before = kept.filter((a) => a.along < route.fromMeters).at(-1) ?? { along: 0, index: -1 };
  const after = kept.find((a) => a.along > route.toMeters) ?? { along: total, index: places.vias.length };
  let from = Math.max(before.along, route.fromMeters - STRETCH_WINDOW_M, 0);
  let to = Math.min(after.along, route.toMeters + STRETCH_WINDOW_M, total);
  for (const [a, b] of p.fixed ?? []) {
    if (b <= route.fromMeters) from = Math.max(from, b);
    if (a >= route.toMeters) to = Math.min(to, a);
  }
  const at = (m: number) => pointAtDistance(line, cum, m).point;
  const vias = places.vias.filter((_, i) => !dropIdx.has(i));
  const avoid = p.persist ? [...(places.avoid ?? []), avoidOf(stretchLine(line, cum, route))] : places.avoid;
  return {
    run: { fromMeters: from, toMeters: to, points: [at(from), at(to)] },
    places: { ...places, vias, ...(avoid && avoid.length ? { avoid } : {}) },
    dropped: dropIdx.size,
    fence: p.fence,
    between: [before.index, after.index],
  };
}

/**
 * The two passes over a stretch ridden twice (design D4, „Atpakaļ pa citu
 * ceļu”): the selection's road found again elsewhere on the line — the same
 * consecutive-vertex pairs `recomputeOverlap` counts as retraced. Null when
 * less than half of the selection is ridden again (or under 50 m).
 * `first` and `second` are in riding order; the selection snaps to `second`.
 */
export function retracedPasses(line: readonly Point[], cum: readonly number[], s: Stretch): { first: Stretch; second: Stretch } | null {
  const pts = line as Point[];
  const inSel = (i: number) => cum[i - 1] >= s.fromMeters - 1 && cum[i] <= s.toMeters + 1;
  const keys = new Map<string, number[]>();
  for (let i = 1; i < pts.length; i++) {
    const k = pairKey(pts[i - 1], pts[i]);
    const list = keys.get(k);
    if (list) list.push(i); else keys.set(k, [i]);
  }
  let selM = 0;
  let matchedM = 0;
  const others: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    if (!inSel(i)) continue;
    const m = cum[i] - cum[i - 1];
    selM += m;
    const other = (keys.get(pairKey(pts[i - 1], pts[i])) ?? []).filter((j) => !inSel(j));
    if (other.length) { matchedM += m; others.push(...other); }
  }
  if (!others.length || matchedM < 50 || matchedM < selM * 0.5) return null;
  // The other pass: the matched pairs' span (one out-and-back — take the
  // cluster nearest the selection's own middle along the line).
  others.sort((a, b) => a - b);
  const mid = (s.fromMeters + s.toMeters) / 2;
  const clusters: number[][] = [];
  for (const j of others) {
    const last = clusters.at(-1);
    if (last && cum[j - 1] - cum[last[last.length - 1]] < 200) last.push(j); else clusters.push([j]);
  }
  const best = clusters.reduce((a, b) => {
    const ma = a.reduce((m, j) => m + cum[j] - cum[j - 1], 0);
    const mb = b.reduce((m, j) => m + cum[j] - cum[j - 1], 0);
    return mb > ma || (mb === ma && Math.abs(cum[b[0]] - mid) < Math.abs(cum[a[0]] - mid)) ? b : a;
  });
  const other: Stretch = { fromMeters: cum[best[0] - 1], toMeters: cum[best[best.length - 1]] };
  const own: Stretch = { fromMeters: s.fromMeters, toMeters: s.toMeters };
  return other.fromMeters < own.fromMeters ? { first: other, second: own } : { first: own, second: other };
}
