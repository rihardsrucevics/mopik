import type { RoutePath, RouteEdge } from "@/lib/types";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";
import { fetchRouteAvoiding } from "@/lib/routing/brouter";
import { LOOP_EXTRA_PER_SHARED, LOOP_SHARED_MIN_M, nogosAlong } from "@/lib/routing/reroute-leg";

export type PruneSpursOptions = {
  /**
   * Places the ride exists to reach: rider-named stops and the destination
   * (a sight, if one is ever routed as a via, belongs here too). A spur that
   * is the ride's visit to one of these is never removed — a farmstead at the
   * end of a dead-end road is reached by riding in and out, and that
   * out-and-back IS the stop (the 2026-09-09 audit's reason for keeping
   * pruning to free loops). See `visitDepth` for what "the visit" means.
   */
  protect?: Point[];
  /** How close counts as reaching a protected place; the stop check's own tolerance. */
  toleranceMeters?: number;
  /**
   * Free loops only: a candidate that is nothing but an out-and-back once its
   * excursions are removed is not a loop, and is refused as one. An A-to-B
   * ride has no circuit to lose, so it passes `false`.
   */
  requireCircuit?: boolean;
};

const DEFAULT_TOLERANCE_M = 300;

/**
 * How far apart the two legs of an out-and-back may run and still be one
 * road ridden twice (item 28, second pass).
 *
 * Measured on the rider's Daugavgrīvas iela → Mālpils šoseja ride: the router
 * went 1.62 km out to a corridor via and came back, 1.35 km of it over the
 * very same vertices but the last ~300 m before the turn on a parallel sand
 * track 8–17 m from the one it came in on (OSM ways 996563529 and 996563531,
 * both `track grade5 sand`). The exact mirror test found nothing, the panel
 * read 3 %, and the map drew two lines a few metres apart. 25 m covers that
 * with margin, and stays under the 30–60 m between the two carriageways of a
 * divided road or a road and its parallel service road.
 */
export const MIRROR_TOLERANCE_M = 25;

/**
 * The most road a near-mirror spur may ride at its far end before the two
 * legs meet: the turn itself, a turning circle, or a short thin loop like the
 * one above. Beyond this the far end is a loop worth riding, and what leads
 * to it is an access corridor — which is left alone, as the exact test leaves
 * A-B-C-D-B-A alone.
 */
export const MIRROR_TIP_MAX_M = 300;

/**
 * A near-mirror spur is cut only where both legs pass through the SAME vertex
 * (within this), so no road is ever invented: the ride continues from a point
 * it really rode through. A hairpin whose legs run 20 m apart never shares a
 * vertex and is never cut; neither is a spur whose legs join the through
 * road at two different junctions — that one is left to the loop, or kept.
 */
const JOIN_SAME_VERTEX_M = 1.5;

/** Densification step for the near-mirror matching. */
const SAMPLE_STEP_M = 5;

/**
 * Remove out-and-back excursions, without inventing any road segment.
 *
 * Two passes, repeated until neither finds anything:
 *
 * 1. **Exact mirrors.** A run of points ridden out to a tip and back over
 *    exactly the same points (A-B-C-B-A collapses to A). Nested dead ends
 *    collapse from the inside out; an access corridor that leads to a real
 *    circuit survives (A-B-C-D-B-A does not collapse).
 * 2. **Near mirrors** (`nearMirrorCut`): the way back runs within
 *    `MIRROR_TOLERANCE_M` of the way out, in the opposite direction, over
 *    different vertices — the router took a parallel way for part of the
 *    return. Cut where the two legs last share a vertex.
 *
 * Geometry is only ever removed, never re-routed: every surviving segment is
 * one the router produced, and it keeps the tags of its ORIGINAL edge, so
 * surface, class and access corridors stay as they were.
 *
 * Distance and the router's duration are scaled by the length actually
 * kept; everything else (`classifyRoute`'s km, surface shares, overlap and
 * its own duration) is measured from the pruned coordinates and edges.
 */
export function pruneSpurs(path: RoutePath, options: PruneSpursOptions = {}): RoutePath {
  const plan = planSpurCuts(path, options);
  if (!plan) return path;
  return rebuild(path, [path], plan.seq.map((i) => [0, i]));
}

/** One excursion that was cut, in the ORIGINAL path's vertex indices. */
export type SpurCut = {
  /** the base on the way out: kept, and the ride continues from it */
  from: number;
  /** the base on the way back: the same place as `from` (same vertex) */
  to: number;
  /** the far end, where the ride turned */
  tip: number;
  /** road removed, out and back together, in metres of geometry */
  meters: number;
  exact: boolean;
};

/**
 * Which original vertices survive, and which excursions went. `null` when
 * nothing is cut. Throws, as `pruneSpurs` always has, when a free loop is
 * nothing but an out-and-back.
 */
export function planSpurCuts(path: RoutePath, options: PruneSpursOptions = {}): { seq: number[]; cuts: SpurCut[] } | null {
  const coords = path.coordinates;
  if (coords.length < 3) return null;
  const protect = options.protect ?? [];
  const tolerance = options.toleranceMeters ?? DEFAULT_TOLERANCE_M;
  const requireCircuit = options.requireCircuit ?? true;
  const same = (a: number, b: number) => coords[a][0] === coords[b][0] && coords[a][1] === coords[b][1];

  // Indices into `coords`, consecutive duplicates dropped (a leg ends where
  // the next begins, so every via join repeats a point).
  let seq: number[] = [];
  for (let i = 0; i < coords.length; i++) if (!seq.length || !same(seq[seq.length - 1], i)) seq.push(i);

  const cuts: SpurCut[] = [];
  const segMeters = (from: number, to: number) => {
    let m = 0;
    for (let j = from + 1; j <= to; j++) m += haversineMeters(coords[seq[j - 1]], coords[seq[j]]);
    return m;
  };
  // Tips already judged to be a protected visit, by original index.
  const keptTips = new Set<number>();
  // Near-mirror spurs already judged to be a protected visit, by original tip.
  const keptNear = new Set<number>();

  for (let round = 0; round < 50; round++) {
    let changed = false;
    // Pass 1, exact mirrors. Left to right; after a removal step back to
    // where the spur hung, because its base may itself be the tip of the
    // next (outer) excursion.
    let t = 1;
    while (t < seq.length - 1) {
      if (keptTips.has(seq[t]) || !same(seq[t - 1], seq[t + 1])) { t++; continue; }
      let k = 1;
      while (t - k - 1 >= 0 && t + k + 1 < seq.length && same(seq[t - k - 1], seq[t + k + 1])) k++;
      const visit = protect.length ? visitDepth(coords, seq, t, k, protect, tolerance) : -1;
      if (visit >= t) {
        // The whole excursion is the visit: the stop is at its end.
        keptTips.add(seq[t]);
        t++;
        continue;
      }
      if (visit > t - k) {
        // The stop is part-way along: ride in as far as it and turn there. What
        // lies beyond is itself an exact out-and-back around the same tip, so
        // cutting it is the same removal as below, only shallower.
        cuts.push({ from: seq[visit], to: seq[visit + 2 * (t - visit)], tip: seq[t], meters: segMeters(visit, visit + 2 * (t - visit)), exact: true });
        seq.splice(visit + 1, 2 * (t - visit));
        keptTips.add(seq[visit]);
        t = visit + 1;
        changed = true;
        continue;
      }
      // seq[t-k] is the base; the points after it up to the mirror image of the
      // base go, and the ride continues from the base as if it had never left.
      cuts.push({ from: seq[t - k], to: seq[t + k], tip: seq[t], meters: segMeters(t - k, t + k), exact: true });
      seq.splice(t - k + 1, 2 * k);
      t = Math.max(1, t - k);
      changed = true;
    }

    // Pass 2, near mirrors: the first one along the ride, then round again,
    // because removing it can expose an exact mirror or an outer spur.
    const near = nearMirrorCut(seq.map((i) => coords[i]), (a, b, tip) => {
      if (keptNear.has(seq[tip])) return false;
      if (protect.length && visitsProtected(coords, seq, a, b, protect, tolerance)) {
        keptNear.add(seq[tip]);
        return false;
      }
      return true;
    });
    if (near) {
      cuts.push({ from: seq[near.a], to: seq[near.b], tip: seq[near.tip], meters: segMeters(near.a, near.b), exact: false });
      seq = [...seq.slice(0, near.a + 1), ...seq.slice(near.b + 1)];
      changed = true;
    }
    if (!changed) break;
  }
  if (!cuts.length) return null;
  if (requireCircuit && seq.length < 4) throw new Error("Candidate contains no circuit after removing dead-end excursions");
  return { seq, cuts };
}

/**
 * The first near-mirror out-and-back along a line, as vertex positions in it:
 * `a` on the way out and `b` on the way back are the same vertex (the base,
 * where the ride carries on), `tip` is where it turned. `null` when there is
 * none — or when every one found was refused by `accept`.
 *
 * Walks the way back from the turn outward. The line is sampled every 5 m;
 * each sample on a later stretch is matched to the nearest earlier sample
 * within `MIRROR_TOLERANCE_M` that heads the OTHER way (more than 120° apart)
 * and lies more than two tolerances back along the ride — so a road simply
 * ridden on is never matched to itself, and two roads 30–60 m apart never
 * match at all. A run of such matches whose earlier partners move steadily
 * backwards is one road ridden out and back; it counts as a spur when the far
 * end between the two legs is short (`MIRROR_TIP_MAX_M`). Where the run ends
 * the legs have parted; the cut is made at the outermost vertex the two legs
 * both passed through (`JOIN_SAME_VERTEX_M`), and nowhere else.
 */
export function nearMirrorCut(
  line: Point[],
  accept: (a: number, b: number, tip: number) => boolean = () => true,
  tolerance = MIRROR_TOLERANCE_M,
): { a: number; b: number; tip: number } | null {
  if (line.length < 4) return null;
  const lat0 = line[0][1];
  const kx = 111195 * Math.cos((lat0 * Math.PI) / 180), ky = 111195;
  const xy = line.map((p) => [p[0] * kx, p[1] * ky] as [number, number]);

  // Samples: position, distance along, heading, and the segment they are on.
  const sx: number[] = [], sy: number[] = [], ss: number[] = [], hx: number[] = [], hy: number[] = [], seg: number[] = [];
  let along = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const dx = xy[i + 1][0] - xy[i][0], dy = xy[i + 1][1] - xy[i][1];
    const d = Math.hypot(dx, dy);
    if (d === 0) continue;
    const n = Math.max(1, Math.ceil(d / SAMPLE_STEP_M));
    for (let k = 0; k < n; k++) {
      const f = k / n;
      sx.push(xy[i][0] + dx * f); sy.push(xy[i][1] + dy * f); ss.push(along + d * f);
      hx.push(dx / d); hy.push(dy / d); seg.push(i);
    }
    along += d;
  }
  const N = ss.length;
  if (N < 4) return null;

  // Earlier partner of each sample, or -1.
  const partner = new Int32Array(N).fill(-1);
  const cell = tolerance;
  const grid = new Map<string, number[]>();
  const gap = 2 * tolerance;
  let pending = 0; // samples are added to the grid once they are `gap` behind
  for (let k = 0; k < N; k++) {
    while (pending < k && ss[k] - ss[pending] > gap) {
      const key = `${Math.floor(sx[pending] / cell)},${Math.floor(sy[pending] / cell)}`;
      const list = grid.get(key);
      if (list) list.push(pending); else grid.set(key, [pending]);
      pending++;
    }
    const cx = Math.floor(sx[k] / cell), cy = Math.floor(sy[k] / cell);
    let best = -1, bestD = tolerance;
    for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
      const list = grid.get(`${gx},${gy}`);
      if (!list) continue;
      for (const m of list) {
        if (hx[k] * hx[m] + hy[k] * hy[m] > -0.5) continue;
        const d = Math.hypot(sx[k] - sx[m], sy[k] - sy[m]);
        if (d < bestD || (d === bestD && m > best)) { bestD = d; best = m; }
      }
    }
    partner[k] = best;
  }

  const maxGapSamples = Math.ceil(tolerance / SAMPLE_STEP_M);
  let k = 0;
  while (k < N) {
    if (partner[k] < 0) { k++; continue; }
    // A run of matches starting at k: the way back from a turn.
    const k0 = k, p0 = partner[k];
    let last = k, lastP = p0, misses = 0, j = k + 1;
    for (; j < N; j++) {
      const p = partner[j];
      if (p < 0 || p > lastP + 2 || lastP - p > (j - last) * 4 + maxGapSamples) {
        if (++misses > maxGapSamples) break;
        continue;
      }
      misses = 0; last = j; lastP = p;
    }
    k = last + 1;
    const tipGap = ss[k0] - ss[p0];
    if (tipGap > MIRROR_TIP_MAX_M + gap) continue;
    // The matched legs must be at least half as long as the far end they
    // lead to. Otherwise this is a small circuit whose two ends meet at an
    // acute junction — a block ridden round, measured on a 420 m residential
    // triangle in Sigulda — not a road ridden twice.
    if (ss[last] - ss[k0] < Math.max(gap, tipGap / 2)) continue;
    // Vertices of the two legs: out from the partner of the outermost match
    // to the turn, back from the turn to the outermost match.
    const outFrom = seg[lastP], outTo = seg[p0] + 1;
    const backFrom = seg[k0], backTo = Math.min(line.length - 1, seg[last] + 1);
    let join: [number, number] | null = null;
    for (let a = Math.max(0, outFrom - 1); a <= outTo && !join; a++) {
      for (let b = Math.min(line.length - 1, backTo + 1); b >= backFrom && b > a; b--) {
        if (Math.hypot(xy[a][0] - xy[b][0], xy[a][1] - xy[b][1]) <= JOIN_SAME_VERTEX_M) { join = [a, b]; break; }
      }
    }
    if (!join) continue;
    const [a, b] = join;
    let removed = 0;
    for (let i = a + 1; i <= b; i++) removed += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
    if (removed < 2 * gap) continue;
    // The turn: the vertex between the legs farthest from the base.
    let tip = a + 1, far = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.hypot(xy[i][0] - xy[a][0], xy[i][1] - xy[a][1]);
      if (d > far) { far = d; tip = i; }
    }
    if (!accept(a, b, tip)) continue;
    return { a, b, tip };
  }
  return null;
}

/**
 * Whether the near-mirror excursion between positions `a` and `b` of `seq`
 * is the ride's visit to a protected place: the place is within `tolerance`
 * of the excursion and nothing the ride keeps comes closer. Unlike an exact
 * mirror, a near-mirror spur that is a visit is kept whole; its two legs are
 * different roads, so "turn at the stop" has no single vertex to turn at.
 */
function visitsProtected(coords: Point[], seq: number[], a: number, b: number, protect: Point[], tolerance: number): boolean {
  for (const stop of protect) {
    let spur = Infinity;
    for (let j = a; j < b; j++) spur = Math.min(spur, segmentMeters(stop, coords[seq[j]], coords[seq[j + 1]]));
    if (spur > tolerance) continue;
    let kept = Infinity;
    for (let j = 0; j < seq.length - 1 && kept > spur; j++) {
      if (j >= a && j < b) continue;
      kept = Math.min(kept, segmentMeters(stop, coords[seq[j]], coords[seq[j + 1]]));
    }
    if (spur < kept) return true;
  }
  return false;
}

/**
 * A new path from pieces of `sources`, one `[source, vertex]` per point.
 *
 * Every segment keeps the edge that led to its end vertex in its own source,
 * so tags, surface and class travel with the road. Distance and the router's
 * duration are each source's own, scaled by how much of its geometry is
 * used. Everything else the router said about the base path (a moved
 * endpoint, a stitched-together leg) is still true of the result.
 */
function rebuild(base: RoutePath, sources: RoutePath[], refs: [number, number][]): RoutePath {
  const edgeMaps = sources.map((path) => {
    const at = new Map<number, RouteEdge>();
    for (const edge of path.edges) {
      for (let i = edge.beginShapeIndex + 1; i <= edge.endShapeIndex; i++) at.set(i, edge);
    }
    return at;
  });
  const sourceMeters = sources.map((path) => {
    let m = 0;
    for (let i = 1; i < path.coordinates.length; i++) m += haversineMeters(path.coordinates[i - 1], path.coordinates[i]);
    return m;
  });
  // Consecutive identical points (a join) collapse to one.
  const kept: [number, number][] = [];
  for (const ref of refs) {
    const p = sources[ref[0]].coordinates[ref[1]];
    const prev = kept.at(-1);
    if (prev) {
      const q = sources[prev[0]].coordinates[prev[1]];
      if (q[0] === p[0] && q[1] === p[1]) continue;
    }
    kept.push(ref);
  }
  const coordinates = kept.map(([s, i]) => sources[s].coordinates[i]);
  const aligned = sources.every((path) => path.elevations?.length === path.coordinates.length);
  const elevations = aligned ? kept.map(([s, i]) => sources[s].elevations![i]) : undefined;
  const used = sources.map(() => 0);
  const edges: RouteEdge[] = [];
  let previousSource: RouteEdge | undefined;
  for (let i = 1; i < kept.length; i++) {
    const [s, index] = kept[i];
    // The first point of a source's piece has no incoming edge of its own
    // when it is that source's first vertex; its outgoing one is the road.
    const source = edgeMaps[s].get(index) ?? edgeMaps[s].get(index + 1);
    const length = haversineMeters(coordinates[i - 1], coordinates[i]);
    used[s] += length;
    const last = edges.at(-1);
    if (last && source === previousSource) {
      last.endShapeIndex = i;
      last.lengthKm = (last.lengthKm ?? 0) + length / 1000;
    } else {
      edges.push({ ...source, beginShapeIndex: i - 1, endShapeIndex: i, lengthKm: length / 1000 } as RouteEdge);
    }
    previousSource = source;
  }
  let distanceMeters = 0, durationSeconds = 0;
  sources.forEach((path, s) => {
    const ratio = sourceMeters[s] > 0 ? used[s] / sourceMeters[s] : 0;
    distanceMeters += path.distanceMeters * ratio;
    durationSeconds += path.durationSeconds * ratio;
  });
  const { elevations: _unaligned, ...rest } = base;
  void _unaligned;
  return {
    ...rest,
    coordinates,
    ...(elevations ? { elevations } : {}),
    edges,
    distanceMeters,
    durationSeconds,
  };
}

/**
 * Road ridden again: metres of the line that come back within `tolerance`
 * of a point already ridden at least `backMeters` earlier, sampled every
 * 20 m. It sees what the vertex-keyed overlap cannot — a way back over a
 * parallel way a few metres off, or the same way sampled differently — and
 * is how item 28 found the near-mirror spur and how a loop is judged below.
 * Direction does not matter: riding a road again is riding it again.
 */
export function revisitedMeters(line: Point[], tolerance = MIRROR_TOLERANCE_M, backMeters = 300): number {
  if (line.length < 2) return 0;
  const step = 20;
  const lat0 = line[0][1];
  const kx = 111195 * Math.cos((lat0 * Math.PI) / 180), ky = 111195;
  const px: number[] = [], py: number[] = [], ps: number[] = [];
  let along = 0;
  for (let i = 1; i < line.length; i++) {
    const x0 = line[i - 1][0] * kx, y0 = line[i - 1][1] * ky;
    const dx = line[i][0] * kx - x0, dy = line[i][1] * ky - y0;
    const d = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(d / step));
    if (i === 1) { px.push(x0); py.push(y0); ps.push(0); }
    for (let k = 1; k <= n; k++) { px.push(x0 + (dx * k) / n); py.push(y0 + (dy * k) / n); ps.push(along + (d * k) / n); }
    along += d;
  }
  const grid = new Map<string, number[]>();
  let pending = 0, meters = 0;
  for (let k = 0; k < ps.length; k++) {
    while (pending < k && ps[k] - ps[pending] >= backMeters) {
      const key = `${Math.floor(px[pending] / tolerance)},${Math.floor(py[pending] / tolerance)}`;
      const list = grid.get(key);
      if (list) list.push(pending); else grid.set(key, [pending]);
      pending++;
    }
    if (k === 0) continue;
    const cx = Math.floor(px[k] / tolerance), cy = Math.floor(py[k] / tolerance);
    let hit = false;
    for (let gx = cx - 1; gx <= cx + 1 && !hit; gx++) for (let gy = cy - 1; gy <= cy + 1 && !hit; gy++) {
      for (const m of grid.get(`${gx},${gy}`) ?? []) {
        if (Math.hypot(px[k] - px[m], py[k] - py[m]) <= tolerance) { hit = true; break; }
      }
    }
    if (hit) meters += ps[k] - ps[k - 1];
  }
  return meters;
}

// ---------------------------------------------------------------------------
// A loop instead of the cut
// ---------------------------------------------------------------------------

export type Nogo = { lon: number; lat: number; radius: number };

/**
 * What it takes to offer a loop where a spur was: the waypoints the
 * candidate was routed through and which of them the builder invented, a
 * router that keeps out of no-go circles, and the ride's shared allowance.
 */
export type SpurLoopOptions = {
  waypoints: Point[];
  generatedViaIndices: number[];
  route: (points: Point[], nogos: Nogo[]) => Promise<RoutePath>;
  budget: SpurLoopBudget;
  /** each fenced request's own deadline; an unanswered one is simply no loop */
  timeoutMs?: number;
};

/**
 * How many fenced requests one ride may spend on loops. Every candidate that
 * routes with a spur draws on the same allowance, first come, first served,
 * so a generation's extra router work is bounded whatever the candidates
 * look like: 16 requests is eight spurs tried both ways (`VARIANTS_PER_SPUR`).
 *
 * And only early in the search (`SPUR_LOOP_WINDOW_MS` from the ride's first
 * spur): each loop holds its candidate's batch for up to `LOOP_TIMEOUT_MS`,
 * and our BRouter has one CPU. Measured without the window on Circle K →
 * Jelgava and the rider's ride, both generations ran into the 50 s budget
 * and dropped 7 of 23 candidates.
 */
export const SPUR_LOOP_REQUESTS_PER_RIDE = 16;
const VARIANTS_PER_SPUR = 2;
/**
 * The longest spur (one way) a loop is tried for. A cheap loop is a few
 * kilometres through the country around a via; a candidate that rode 30 km
 * out and back to a corridor via is a different ride once cut, and routing a
 * 30 km fenced alternative for it is a candidate of its own, not a repair.
 * Measured on the rider's ride: 10 of 19 candidates' spurs were 9–34 km one
 * way and exhausted the allowance before the 1.6 km one that was shown.
 */
export const SPUR_LOOP_MAX_ONE_WAY_M = 5_000;
const LOOP_TIMEOUT_MS = 1_500;
export const SPUR_LOOP_WINDOW_MS = 20_000;

export class SpurLoopBudget {
  private readonly until: number;
  constructor(private requests = SPUR_LOOP_REQUESTS_PER_RIDE, windowMs = SPUR_LOOP_WINDOW_MS) {
    this.until = Date.now() + windowMs;
  }
  take(n: number): boolean {
    if (this.requests < n || Date.now() > this.until) return false;
    this.requests -= n;
    return true;
  }
  get left(): number { return this.requests; }
}

const budgets = new WeakMap<object, SpurLoopBudget>();

/**
 * The loop settings for one candidate of one ride on our BRouter. `ride` is
 * any object that lives exactly as long as the generation (the route intent)
 * — every candidate of that ride shares its allowance through it.
 */
export function spurLoopsFor(params: {
  ride: object;
  profileOptions: MotoProfileOptions;
  waypoints: Point[];
  generatedViaIndices: number[];
}): SpurLoopOptions {
  let budget = budgets.get(params.ride);
  if (!budget) { budget = new SpurLoopBudget(); budgets.set(params.ride, budget); }
  return {
    waypoints: params.waypoints,
    generatedViaIndices: params.generatedViaIndices,
    budget,
    route: (points, nogos) => fetchRouteAvoiding({ points, profileOptions: params.profileOptions, nogos }),
  };
}

/**
 * Whether a loop may replace a cut spur — the one rule, kept pure so it can
 * be tested on its own.
 *
 * - It must not ride the same road twice itself: what it adds to the ride's
 *   `revisitedMeters` stays under `LOOP_SHARED_MIN_M`, edit mode's line
 *   between "a stop's own entrance" and "a spur worth noticing", and under
 *   half the spur's one-way length, so a short spur is never swapped for a
 *   shorter out-and-back.
 * - It may cost at most edit mode's `LOOP_EXTRA_PER_SHARED` per metre of road
 *   it stops riding twice: the new stretch is at most the out-and-back it
 *   replaces × 1.5, plus whatever of the ride it rejoins beyond the base.
 */
export function acceptSpurLoop(params: {
  /** the removed out-and-back, both legs */
  outAndBackMeters: number;
  /** ride beyond the spur's base that the loop replaces (0 when it returns to the base) */
  skippedMeters: number;
  /** the loop's own stretch, base to rejoin */
  loopMeters: number;
  /** what the loop adds to the ride's `revisitedMeters` over the cut ride */
  addedRevisitMeters: number;
}): boolean {
  const oneWay = params.outAndBackMeters / 2;
  if (params.addedRevisitMeters > Math.min(LOOP_SHARED_MIN_M, oneWay / 2)) return false;
  const extra = params.loopMeters - params.skippedMeters - params.outAndBackMeters;
  return extra <= LOOP_EXTRA_PER_SHARED * oneWay;
}

/** What happened to the spurs of one path, for the log and measurement. */
export type SpurReport = {
  cut: number; cutMeters: number; looped: number; loopTried: number; loopMs: number;
  /** per spur tried: one-way metres, and the nearest variant's extra metres over its bound and revisit added */
  notes: string[];
};
export const spurReports = new WeakMap<RoutePath, SpurReport>();

/**
 * `pruneSpurs`, and where the ride turned at a via the builder invented, a
 * loop through the country there instead of the cut when one is cheap.
 *
 * The rider's Daugavgrīvas iela → Mālpils šoseja spur turned 57 m from a
 * corridor via in a forest full of tracks: cutting it loses the via's whole
 * point, riding there. So for each cut spur (`LOOP_SHARED_MIN_M` to
 * `SPUR_LOOP_MAX_ONE_WAY_M` one way) whose nearest waypoint is a generated
 * via, the way back from the tip is routed again with the way in fenced off
 * (`nogosAlong`, as edit mode does) towards the ride two spur lengths past
 * the base, and joins it where it first meets it — and the mirror, the way in
 * fenced off the way back, from as far before it. Both at once, each under
 * its own deadline; of those
 * `acceptSpurLoop` allows, the one adding least road ridden twice, then the
 * shortest, replaces the cut. The rider's own stops are never here: their
 * spurs are protected before anything is cut.
 */
export async function pruneOrLoopSpurs(
  path: RoutePath,
  options: PruneSpursOptions & { loop?: SpurLoopOptions } = {},
): Promise<RoutePath> {
  const plan = planSpurCuts(path, options);
  if (!plan) return path;
  const cutPath = rebuild(path, [path], plan.seq.map((i) => [0, i]));
  const report: SpurReport = { cut: plan.cuts.length, cutMeters: 0, looped: 0, loopTried: 0, loopMs: 0, notes: [] };
  const top = outermost(plan.cuts);
  report.cutMeters = Math.round(top.reduce((s, c) => s + c.meters, 0));
  // One line per candidate that had spurs: what went, what became a loop,
  // and the km the ride ends up with — how item 28 is measured.
  const done = (result: RoutePath, note = ""): RoutePath => {
    spurReports.set(result, report);
    console.log(`spurs: ${report.cut} cut (${(report.cutMeters / 1000).toFixed(2)} km) → ${(result.distanceMeters / 1000).toFixed(1)} km${note}`);
    return result;
  };
  const loop = options.loop;
  if (!loop) return done(cutPath);

  const coords = path.coordinates;
  const generated = new Set(loop.generatedViaIndices);
  const eligible = top.filter((cut) => {
    if (cut.meters / 2 < LOOP_SHARED_MIN_M || cut.meters / 2 > SPUR_LOOP_MAX_ONE_WAY_M) return false;
    let nearest = -1, best = Infinity;
    loop.waypoints.forEach((w, i) => {
      const d = haversineMeters(w, coords[cut.tip]);
      if (d < best) { best = d; nearest = i; }
    });
    return generated.has(nearest);
  }).sort((x, y) => y.meters - x.meters);
  if (!eligible.length) return done(cutPath);

  const cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversineMeters(coords[i - 1], coords[i]));
  const protect = options.protect ?? [];
  const tolerance = options.toleranceMeters ?? DEFAULT_TOLERANCE_M;
  const started = Date.now();
  const timeout = loop.timeoutMs ?? LOOP_TIMEOUT_MS;

  /**
   * One way to ride through a spur's country instead of in and out, asked of
   * the router with the spur's other leg fenced off:
   *
   * - `back`: keep the way in, and from the tip ride on to the ride two spur
   *   lengths past the base. The answer is cut where it first comes onto the
   *   ride (a vertex the ride has too), so one request finds the loop that
   *   rejoins one length on as well as two: measured on six rides, the first
   *   was taken 12 times and the second 4, and every request costs our
   *   one-CPU router time the candidates need.
   * - `in`: the mirror — leave the ride two lengths before the base, cut where
   *   the answer last leaves it, reach the tip, and keep the way back.
   *
   * Not back to the base itself: a loop that closes there is also found by
   * rejoining further on, and on the rider's spur the closed loop was 5.5 km
   * back to a base the ride leaves again at once.
   */
  type Variant = { cut: SpurCut; label: "back" | "in"; points: Point[]; nogos: Nogo[]; along: number };
  const variants: Variant[] = [];
  for (const cut of eligible) {
    if (!loop.budget.take(VARIANTS_PER_SPUR)) break;
    const reach = cut.meters; // two spur lengths, one way each
    const others = top.filter((c) => c !== cut);
    let r = cut.to;
    while (r < coords.length - 2 && cum[r] - cum[cut.to] < reach) r++;
    if (r > cut.to &&
        !others.some((c) => c.from < r && c.to > cut.to) &&
        !skipsProtected(coords, cut.to, r, protect, tolerance)) {
      variants.push({
        cut, label: "back", along: r, points: [coords[cut.tip], coords[r]],
        nogos: nogosAlong(coords.slice(cut.from, cut.tip + 1), [coords[cut.tip], coords[cut.from], coords[r]]),
      });
    }
    let d = cut.from;
    while (d > 1 && cum[cut.from] - cum[d] < reach) d--;
    if (d < cut.from &&
        !others.some((c) => c.to > d && c.from < cut.from) &&
        !skipsProtected(coords, d, cut.from, protect, tolerance)) {
      variants.push({
        cut, label: "in", along: d, points: [coords[d], coords[cut.tip]],
        nogos: nogosAlong(coords.slice(cut.tip, cut.to + 1), [coords[cut.tip], coords[cut.to], coords[d]]),
      });
    }
  }
  if (!variants.length) {
    return done(cutPath, `; ${eligible.length} at a generated via, no loop tried (allowance ${loop.budget.left})`);
  }
  report.loopTried = variants.length;

  const answers = await Promise.all(variants.map((v) => withTimeout(loop.route(v.points, v.nogos), timeout)));
  report.loopMs = Date.now() - started;

  /**
   * An answered variant as a splice: the fenced leg's vertices `fencedFrom..
   * fencedTo` replace the ride's `replaceFrom..replaceTo` and go in after
   * `replaceFrom - 1`; `skippedMeters` is the ride beyond the base it replaces.
   */
  type Splice = { label: string; fenced: RoutePath; fencedFrom: number; fencedTo: number; replaceFrom: number; replaceTo: number; skippedMeters: number };
  const key = (p: Point) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const spliceOf = (v: Variant, fenced: RoutePath): Splice | null => {
    const f = fenced.coordinates;
    if (f.length < 2) return null;
    // The fenced leg must start and end where it was asked to, or it is not
    // a piece of this ride.
    if (haversineMeters(f[0], v.points[0]) > 15 || haversineMeters(f.at(-1)!, v.points[1]) > 15) return null;
    const { cut } = v;
    const ride = new Map<string, number>();
    if (v.label === "back") {
      for (let j = cut.to; j <= v.along; j++) if (!ride.has(key(coords[j]))) ride.set(key(coords[j]), j);
      for (let i = 1; i < f.length; i++) {
        const j = ride.get(key(f[i]));
        if (j === undefined) continue;
        return { label: `back+${Math.round(((cum[j] - cum[cut.to]) / cut.meters) * 20) / 10}`, fenced, fencedFrom: 0, fencedTo: i,
          replaceFrom: cut.tip + 1, replaceTo: j, skippedMeters: cum[j] - cum[cut.to] };
      }
      return { label: "back+2", fenced, fencedFrom: 0, fencedTo: f.length - 1, replaceFrom: cut.tip + 1, replaceTo: v.along, skippedMeters: cum[v.along] - cum[cut.to] };
    }
    for (let j = cut.from; j >= v.along; j--) if (!ride.has(key(coords[j]))) ride.set(key(coords[j]), j);
    for (let i = f.length - 2; i >= 0; i--) {
      const j = ride.get(key(f[i]));
      if (j === undefined) continue;
      return { label: `in-${Math.round(((cum[cut.from] - cum[j]) / cut.meters) * 20) / 10}`, fenced, fencedFrom: i, fencedTo: f.length - 1,
        replaceFrom: j, replaceTo: cut.tip - 1, skippedMeters: cum[cut.from] - cum[j] };
    }
    return { label: "in-2", fenced, fencedFrom: 0, fencedTo: f.length - 1, replaceFrom: v.along, replaceTo: cut.tip - 1, skippedMeters: cum[cut.from] - cum[v.along] };
  };

  // The ride with some spurs looped and the rest cut, from the ORIGINAL
  // path: every cut's vertices are dropped except a looped spur's own (its
  // nested cuts still go), and each loop's replaced vertices give way to its
  // piece of fenced leg.
  const assemble = (loops: Map<SpurCut, Splice>): RoutePath => {
    const drops = new Int32Array(coords.length);
    for (const cut of plan.cuts) for (let j = cut.from + 1; j <= cut.to; j++) drops[j]++;
    const insertAfter = new Map<number, { source: number; from: number; to: number }>();
    const sources: RoutePath[] = [path];
    for (const [cut, splice] of loops) {
      for (let j = cut.from + 1; j <= cut.to; j++) drops[j]--;
      for (let j = splice.replaceFrom; j <= splice.replaceTo; j++) drops[j]++;
      insertAfter.set(splice.replaceFrom - 1, { source: sources.length, from: splice.fencedFrom, to: splice.fencedTo });
      sources.push(splice.fenced);
    }
    const refs: [number, number][] = [];
    for (let j = 0; j < coords.length; j++) {
      if (drops[j] <= 0) refs.push([0, j]);
      const piece = insertAfter.get(j);
      if (piece) for (let i = piece.from; i <= piece.to; i++) refs.push([piece.source, i]);
    }
    return rebuild(path, sources, refs);
  };
  const lineMeters = (line: Point[]) => {
    let m = 0;
    for (let i = 1; i < line.length; i++) m += haversineMeters(line[i - 1], line[i]);
    return m;
  };

  // Accept per spur, in ride order, each judged on the ride as it stands
  // with the loops already taken, so two loops never share a road unseen.
  const loops = new Map<SpurCut, Splice>();
  let current = cutPath;
  let currentRevisit = revisitedMeters(current.coordinates);
  let currentMeters = lineMeters(current.coordinates);
  for (const cut of [...eligible].sort((x, y) => x.from - y.from)) {
    let best: { path: RoutePath; revisit: number; meters: number; score: number; splice: Splice } | null = null;
    let nearest: { over: number; added: number } | null = null;
    const answered = variants.filter((v, i) => v.cut === cut && answers[i]).length;
    variants.forEach((variant, i) => {
      const fenced = answers[i];
      if (variant.cut !== cut || !fenced) return;
      const splice = spliceOf(variant, fenced);
      if (!splice) return;
      const candidate = assemble(new Map([...loops, [cut, splice]]));
      const revisit = revisitedMeters(candidate.coordinates);
      const meters = lineMeters(candidate.coordinates);
      const added = Math.max(0, revisit - currentRevisit);
      const loopMeters = meters - currentMeters + splice.skippedMeters;
      const over = loopMeters - splice.skippedMeters - cut.meters - LOOP_EXTRA_PER_SHARED * cut.meters / 2;
      if (!nearest || over + added < nearest.over + nearest.added) nearest = { over, added };
      if (!acceptSpurLoop({ outAndBackMeters: cut.meters, skippedMeters: splice.skippedMeters, loopMeters, addedRevisitMeters: added })) return;
      // Least road ridden twice first (to 50 m), then the least extra riding.
      const score = Math.round(added / 50) * 1e7 + (meters - currentMeters);
      if (!best || score < best.score) best = { path: candidate, revisit, meters, score, splice };
    });
    const n = nearest as { over: number; added: number } | null;
    const won = best as { path: RoutePath; revisit: number; meters: number; splice: Splice } | null;
    report.notes.push(`${Math.round(cut.meters / 2)} m ${won ? `looped ${won.splice.label}` : "cut"} (${answered} answered${n ? `, nearest ${Math.round(n.over)} m over bound, +${Math.round(n.added)} m ridden twice` : ""})`);
    if (!won) continue;
    loops.set(cut, won.splice);
    current = won.path;
    currentRevisit = won.revisit;
    currentMeters = won.meters;
    report.looped++;
  }
  return done(current, `; ${report.looped} of ${eligible.length} looped instead (${report.loopTried} tries, ${report.loopMs} ms): ${report.notes.join("; ")}`);
}

/** The cuts not inside another cut. */
function outermost(cuts: SpurCut[]): SpurCut[] {
  return cuts.filter((c) => !cuts.some((o) => o !== c && o.from <= c.from && o.to >= c.to && (o.from < c.from || o.to > c.to)));
}

/** Whether the ride between vertices `from` and `to` is where it reaches a protected place. */
function skipsProtected(coords: Point[], from: number, to: number, protect: Point[], tolerance: number): boolean {
  for (const stop of protect) {
    let inside = Infinity, outside = Infinity;
    for (let j = 0; j + 1 < coords.length; j++) {
      const d = segmentMeters(stop, coords[j], coords[j + 1]);
      if (j >= from && j < to) inside = Math.min(inside, d);
      else outside = Math.min(outside, d);
    }
    if (inside <= tolerance && inside <= outside) return true;
  }
  return false;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    (timer as { unref?: () => void }).unref?.();
    promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}

/**
 * How deep into the excursion around tip `seq[t]` (mirrored `k` points) the
 * ride has to go to visit a protected place, as a position in `seq` between
 * the base `t-k` and the tip `t`; -1 when the excursion visits nothing.
 *
 * It is a visit when the place is within `tolerance` of the excursion's
 * outbound half and nothing the ride keeps comes closer. The second half lets
 * a spur that a generated via made next to a named village go — the village
 * is reached by the road the ride stays on — while the lane to a farmstead,
 * which the main road passes 500 m away, stays. The depth is the first
 * vertex past the closest point, so the place is reached exactly as close as
 * the unpruned ride reached it.
 */
function visitDepth(coords: Point[], seq: number[], t: number, k: number, protect: Point[], tolerance: number): number {
  let deepest = -1;
  for (const stop of protect) {
    let spur = Infinity, at = -1;
    for (let j = t - k; j < t; j++) {
      const d = segmentMeters(stop, coords[seq[j]], coords[seq[j + 1]]);
      if (d < spur) { spur = d; at = j + 1; }
    }
    if (spur > tolerance || at <= deepest) continue;
    let kept = Infinity;
    for (let j = 0; j < seq.length - 1 && kept > spur; j++) {
      // The pieces the ride keeps: up to the base, and on from the mirror
      // image of the base. The segment that bridges the two after removal is
      // the base itself (identical points), so it adds nothing.
      if (j >= t - k && j < t + k) continue;
      kept = Math.min(kept, segmentMeters(stop, coords[seq[j]], coords[seq[j + 1]]));
    }
    if (spur < kept) deepest = at;
  }
  return deepest;
}

/** Metres from `p` to the segment a-b, in a local flat frame (as `visitsRequiredStops`). */
function segmentMeters(p: Point, a: Point, b: Point): number {
  const lonScale = 111195 * Math.cos(p[1] * Math.PI / 180);
  const x = (a[0] - p[0]) * lonScale, y = (a[1] - p[1]) * 111195;
  const dx = (b[0] - a[0]) * lonScale, dy = (b[1] - a[1]) * 111195;
  const norm = dx * dx + dy * dy;
  const s = Math.max(0, Math.min(1, norm ? -(x * dx + y * dy) / norm : 0));
  return Math.hypot(x + s * dx, y + s * dy);
}
