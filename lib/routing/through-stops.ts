import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { fetchRouteAvoiding, fetchRoutePath } from "@/lib/routing/brouter";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";
import type { RoutePath } from "@/lib/types";
import {
  JOIN_GAP_M,
  THROUGH_SHARED_MIN_M,
  chooseLoop,
  nogosAlong,
  outAndBacks,
  sharedRoad,
  spurBaseIndex,
  type LegPair,
} from "@/lib/routing/reroute-leg";

/**
 * A stretch of an edited ride routed so that every place in it is ridden
 * THROUGH — reached one way and left another — whenever the map allows it.
 *
 * The rider's rule, restated on 2026-09-25 after his own stops came back as
 * spurs again: a stop he adds must be passed and ridden on from, never
 * reached by riding out and back the same way; if the place sits at the end
 * of a dead end, a loop is better than the out-and-back; and a retrace that
 * cannot be avoided is never silent.
 *
 * The measurement that shows why each piece is needed:
 *
 * - **Every place, not only a lone one.** The loop search used to run only
 *   for a stretch with exactly one place in it (`join → stop → join`). A
 *   batch of stops, a stop added next to another, the whole-span fallback —
 *   each went to the router in one request, and BRouter reaches a via by the
 *   cheapest way in and leaves it by the cheapest way out, which is the same
 *   road whenever the via sits off the through road. Here each leg between
 *   consecutive points is routed on its own, so a place's way in and way out
 *   can be compared.
 * - **Short spurs too.** The search started at 300 m of shared road
 *   (`LOOP_SHARED_MIN_M`); the rider's stop 2 was 250-600 m up a dead-end
 *   track and nothing was tried. It starts at `THROUGH_SHARED_MIN_M`, and the
 *   fences keep clear of the place by only a little more than their own
 *   radius (BRouter drops a no-go circle that contains a waypoint anyway), so
 *   a short spur is fenced at all.
 * - **Loops before out-and-backs.** `chooseLoop`'s bound gives a loop at
 *   least `LOOP_EXTRA_FLOOR_M` of extra road, so a 300 m spur is not kept
 *   because every way round is longer than 300 m.
 *
 * A place still at the end of a spur afterwards is what it is: a **stop** is
 * kept there (it is where the rider asked to go) and the spur is reported in
 * `deadEndMeters`; a **shaping point** is only a bend the rider gave the
 * line, not a place to visit, so its spur is cut — the line goes through the
 * spur's base instead, and `snapToLine` puts the dot there.
 *
 * Pure routing, no geometry of the ride: the client decides the stretch and
 * splices the answer (`lib/routing/reroute-leg.ts`).
 */

/**
 * How long the fenced second attempts may take, and when the whole loop
 * search must have answered — see `/api/reroute-leg` for the measurements
 * behind both.
 */
export const LOOP_BUDGET_MS = 2_500;

type Attempt = { path: RoutePath } | { refused: true } | { unanswered: true };

/** Two routed legs as one path, the second's edges shifted onto the joined shape. */
export function joinPaths(a: RoutePath, b: RoutePath): RoutePath {
  const offset = a.coordinates.length - 1;
  return {
    distanceMeters: a.distanceMeters + b.distanceMeters,
    durationSeconds: a.durationSeconds + b.durationSeconds,
    coordinates: [...a.coordinates, ...b.coordinates.slice(1)],
    ...(a.elevations && b.elevations ? { elevations: [...a.elevations, ...b.elevations.slice(1)] } : {}),
    edges: [
      ...a.edges,
      ...b.edges.map((e) => ({ ...e, beginShapeIndex: e.beginShapeIndex + offset, endShapeIndex: e.endShapeIndex + offset })),
    ],
  };
}

const asPair = (approach: RoutePath, departure: RoutePath): LegPair => ({
  approach: { coordinates: approach.coordinates, distanceMeters: approach.distanceMeters },
  departure: { coordinates: departure.coordinates, distanceMeters: departure.distanceMeters },
});

const last = (p: RoutePath): Point => p.coordinates[p.coordinates.length - 1];

export type ThroughResult = {
  path: RoutePath;
  /** The longest out-and-back a stop in the stretch is still reached by, metres. */
  deadEndMeters: number;
  /** …and that is only because the loop search ran out of time. */
  deadEndUnchecked?: boolean;
  /** Whose spur `deadEndMeters` is: a shaping point's, or a stop's (absent: a stop's). */
  deadEndAtShape?: boolean;
};

export async function routeThroughPlaces(params: {
  points: Point[];
  /** Per point: a shaping point, whose spur is cut rather than kept. */
  shapes?: boolean[];
  profileOptions: MotoProfileOptions;
  /** When the loop search must have answered (epoch ms). */
  deadlineAt: number;
}): Promise<ThroughResult> {
  const { points, profileOptions, deadlineAt } = params;
  const shapes = params.shapes ?? [];
  const n = points.length;
  // One leg per pair of consecutive points. The run's two ends are cuts in
  // the kept ride and never move; the places between may be nudged onto a
  // road, like any place the rider named.
  const route = (pts: Point[], i: number, count: number) => fetchRoutePath({
    points: pts,
    profileOptions,
    generatedViaIndices: [],
    pinnedEnds: { start: i === 0, end: i + count === n - 1 },
  });
  const legs: RoutePath[] = await Promise.all(points.slice(1).map((p, i) => route([points[i], p], i, 1)));
  // Two legs that reach a place at different points (each nudged its own
  // way) would join with a jump. The way out is asked again from where the
  // way in arrived — so the place is one point, and its spur, if it has
  // one, is seen below. Only if that does not meet either is the stretch
  // ridden as one request, and then its spurs are still looked at
  // (`offSpurs`): measured on Kaņieris (2026-09-28), a bend dropped in a
  // field was reached from a track 208-528 m from where the way out began,
  // the one request rode up that track and back, and nothing said so.
  const whole = async (): Promise<ThroughResult> => offSpurs({
    path: await fetchRoutePath({ points, profileOptions, generatedViaIndices: [], pinnedEnds: true }),
    deadEndMeters: 0,
  }, points, shapes, profileOptions);
  for (let i = 1; i < legs.length; i++) {
    if (haversineMeters(last(legs[i - 1]), legs[i].coordinates[0]) <= JOIN_GAP_M) continue;
    try {
      legs[i] = await route([last(legs[i - 1]), points[i + 1]], i, 1);
    } catch {
      return whole();
    }
    if (haversineMeters(last(legs[i - 1]), legs[i].coordinates[0]) > JOIN_GAP_M) return whole();
  }

  // Where each place is reached by a spur: its way in and way out share road.
  const spurOf = (j: number) => sharedRoad(legs[j - 1].coordinates, legs[j].coordinates);
  const spurs = Array.from({ length: n }, (_, j) => (j > 0 && j < n - 1 ? spurOf(j) : null));

  type Variant = { via: number; leg: number; path: RoutePath; saved: number };
  const budget = Math.min(LOOP_BUDGET_MS, deadlineAt - Date.now());
  const attempt = (pts: Point[], nogos: { lon: number; lat: number; radius: number }[]): Promise<Attempt> => {
    if (budget < 300 || !nogos.length) return Promise.resolve({ unanswered: true });
    const request = fetchRouteAvoiding({ points: pts, profileOptions, nogos }).then(
      (path): Attempt => ({ path }),
      // A 400 is the router's own answer about these points — no way there
      // with the fences up. Anything else (a refused URL, a network error, a
      // 5xx) is not an answer about the map.
      (err): Attempt => (/routing failed \(400\)|no route|empty shape/i.test(err instanceof Error ? err.message : "") ? { refused: true } : { unanswered: true }),
    );
    return Promise.race([request, new Promise<Attempt>((resolve) => { setTimeout(() => resolve({ unanswered: true }), budget).unref?.(); })]);
  };

  // Both mirrors for every place on a spur, all at once: the way out fenced
  // off the way in, and the way in fenced off the way out — which side has
  // the other way is a fact about the map, not about the order.
  const asked: { via: number; leg: number; request: Promise<Attempt> }[] = [];
  for (let j = 1; j < n - 1; j++) {
    const spur = spurs[j];
    if (!spur || spur.meters <= THROUGH_SHARED_MIN_M) continue;
    const at = last(legs[j - 1]);
    const prev = legs[j - 1].coordinates[0];
    const next = last(legs[j]);
    const nogos = nogosAlong(spur.points, [at, prev, next], {
      keepClearM: [NOGO_CLEAR_OF_PLACE_M, 250, 250],
      spacingM: Math.max(40, Math.min(200, spur.meters / 3)),
    });
    asked.push({ via: j, leg: j, request: attempt([at, next], nogos) });
    asked.push({ via: j, leg: j - 1, request: attempt([prev, at], nogos) });
  }
  const answers = await Promise.all(asked.map((a) => a.request));

  // Each place's best way through, by `chooseLoop`; a leg can be replaced
  // only once, so the places that save the most road choose first.
  const meets = (leg: number, p: RoutePath) =>
    haversineMeters(p.coordinates[0], legs[leg].coordinates[0]) <= JOIN_GAP_M * 2 &&
    haversineMeters(last(p), last(legs[leg])) <= JOIN_GAP_M * 2;
  const choices: Variant[] = [];
  for (let j = 1; j < n - 1; j++) {
    const mine = asked.map((a, k) => ({ ...a, answer: answers[k] })).filter((a) => a.via === j);
    if (!mine.length) continue;
    const variants = mine.map((a) => ("path" in a.answer && meets(a.leg, a.answer.path) ? { leg: a.leg, path: a.answer.path } : null));
    const pairs = variants.map((v) => (!v ? null : v.leg === j ? asPair(legs[j - 1], v.path) : asPair(v.path, legs[j])));
    const choice = chooseLoop(asPair(legs[j - 1], legs[j]), pairs);
    if (choice.index < 0) continue;
    const v = variants[choice.index]!;
    choices.push({ via: j, leg: v.leg, path: v.path, saved: (spurs[j]?.meters ?? 0) - choice.sharedMeters });
  }
  const taken = new Set<number>();
  for (const c of choices.sort((a, b) => b.saved - a.saved)) {
    if (taken.has(c.leg)) continue;
    taken.add(c.leg);
    legs[c.leg] = c.path;
  }

  // What is left. A shaping point still on a spur is taken off it: the line
  // goes through the spur's base, where the way in and the way out part.
  let deadEnd = 0;
  let unchecked = false;
  const cuts: number[] = [];
  for (let j = 1; j < n - 1; j++) {
    const left = spurOf(j);
    if (left.meters <= THROUGH_SHARED_MIN_M) continue;
    // Two neighbouring cuts would both rebuild the leg between them.
    if (shapes[j]) { if (!cuts.includes(j - 1)) cuts.push(j); continue; }
    if (left.meters > deadEnd) {
      deadEnd = left.meters;
      unchecked = asked.some((a, k) => a.via === j && "unanswered" in answers[k]);
    }
  }
  if (cuts.length) {
    const rerouted = await Promise.all(cuts.map(async (j) => {
      const base = spurBaseIndex(legs[j - 1].coordinates, legs[j].coordinates);
      if (base <= 0) return null;
      const at = legs[j - 1].coordinates[base];
      const pts: Point[] = [legs[j - 1].coordinates[0], at, last(legs[j])];
      try {
        const path = await fetchRoutePath({ points: pts, profileOptions, generatedViaIndices: [], pinnedEnds: true });
        return { j, path };
      } catch { return null; }
    }));
    for (const r of rerouted) {
      if (!r) continue;
      // The pair of legs becomes one path through the base; kept as the
      // approach, with an empty departure that `joinPaths` below skips.
      legs[r.j - 1] = r.path;
      legs[r.j] = EMPTY_LEG(last(r.path));
    }
  }

  let path = legs[0];
  for (let i = 1; i < legs.length; i++) if (legs[i].coordinates.length > 1) path = joinPaths(path, legs[i]);
  const deadEndMeters = deadEnd > THROUGH_SHARED_MIN_M ? Math.round(deadEnd) : 0;
  return offSpurs({ path, deadEndMeters, ...(deadEndMeters && unchecked ? { deadEndUnchecked: true } : {}) }, points, shapes, profileOptions);
}

/**
 * The last word on a stretch: a shaping point is never the tip of a spur
 * (rider, 2026-09-28: „caurbraucams punkts nedrīkst radīt atzaru”). Whatever
 * path got here — the legs, a failed cut, two neighbouring cuts of which only
 * one was made, the one-request fallback — every out-and-back still in it
 * whose tip is a shaping point is taken off: the point moves to where the
 * spur leaves the road, and the stretch is routed once more through that.
 * If that does not take it off, the spur is not hidden: it is reported as a
 * dead end, which the page says („Caurbraucamais punkts ir strupceļā…”).
 */
async function offSpurs(result: ThroughResult, points: Point[], shapes: boolean[], profileOptions: MotoProfileOptions): Promise<ThroughResult> {
  const tipOf = (path: RoutePath) => {
    const c = path.coordinates;
    return outAndBacks(c).map((o) => {
      const j = nearestInner(points, c[o.apex]);
      const atPlace = j > 0 && haversineMeters(points[j], c[o.apex]) <= SPUR_TIP_NEAR_M;
      return { ...o, j, atPlace, onShape: atPlace && shapes[j] === true };
    });
  };
  const tips = tipOf(result.path);
  const found = tips.filter((o) => o.onShape);
  // A place's spur that is not a shaping point's is a stop's: kept, and
  // said — also when it came from the one-request fallback, which never
  // measured it.
  const worst = (list: typeof tips) => Math.round(list.reduce((m, o) => Math.max(m, o.meters), 0));
  if (!found.length) {
    const stopSpur = worst(tips.filter((o) => o.atPlace));
    // Not searched for a way round here, so said as what the line does.
    return stopSpur > result.deadEndMeters ? { ...result, deadEndMeters: stopSpur, deadEndUnchecked: true } : result;
  }
  // At most twice: a point moved to a spur's base can land on the base of a
  // shorter one (measured: 327 m, then 54 m, then none).
  const onShapeMeters = (list: typeof tips) => list.filter((o) => o.onShape).reduce((m, o) => m + o.meters, 0);
  const others = (list: typeof tips) => list.filter((o) => !o.onShape).reduce((m, o) => m + o.meters, 0);
  let path = result.path;
  let left = tips;
  let via = points.slice();
  for (let round = 0; round < 2 && left.some((o) => o.onShape); round++) {
    const moved = via.slice();
    for (const o of left) if (o.onShape) moved[o.j] = path.coordinates[o.base];
    try {
      const again = await fetchRoutePath({ points: moved, profileOptions, generatedViaIndices: [], pinnedEnds: true });
      const tipsAgain = tipOf(again);
      if (onShapeMeters(tipsAgain) >= onShapeMeters(left) || others(tipsAgain) > others(tips) + 1) break;
      path = again; left = tipsAgain; via = moved;
    } catch {
      // Kept as it was, and said below.
      break;
    }
  }
  const atShape = worst(left.filter((o) => o.onShape));
  const deadEndMeters = Math.max(result.deadEndMeters, atShape, worst(left.filter((o) => o.atPlace && !o.onShape)));
  return {
    ...result,
    path,
    deadEndMeters,
    ...(deadEndMeters > result.deadEndMeters ? { deadEndUnchecked: true } : {}),
    ...(atShape && atShape === deadEndMeters ? { deadEndAtShape: true } : {}),
  };
}

/**
 * How far from a place a spur's tip may be and still be that place's spur:
 * the router's snap to a road, or its endpoint-nudge ring (up to 1.2 km,
 * `NUDGE_RADII_M` in `brouter.ts` — measured: a bend on Kaņieris reached
 * 631 m from where it was dropped).
 */
const SPUR_TIP_NEAR_M = 1_300;

/** The inner point (not a run end) nearest to `p`, or −1. */
function nearestInner(points: Point[], p: Point): number {
  let best = -1, meters = Infinity;
  for (let j = 1; j < points.length - 1; j++) {
    const d = haversineMeters(points[j], p);
    if (d < meters) { meters = d; best = j; }
  }
  return best;
}

/**
 * How far the fences stay off a place itself: a little more than their own
 * radius (60 m). BRouter drops a no-go circle that holds a waypoint, and a
 * wider clearance left a spur shorter than it unfenced — the loop search then
 * asked the same question twice and concluded "dead end" without trying.
 */
export const NOGO_CLEAR_OF_PLACE_M = 80;

/** A leg of one point: what a cut spur's departure becomes. */
const EMPTY_LEG = (at: Point): RoutePath => ({ distanceMeters: 0, durationSeconds: 0, coordinates: [at], edges: [] });
