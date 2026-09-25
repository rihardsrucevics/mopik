import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { MotoProfileOptions } from "@/lib/routing/moto-profile";
import type { RoutePath } from "@/lib/types";
import { cumulative } from "@/lib/routing/detour";
import {
  EDIT_WINDOW_M,
  LOOP_EXTRA_FLOOR_M,
  LOOP_EXTRA_PER_SHARED,
  THROUGH_SHARED_MIN_M,
  nearestAlong,
  recomputeOverlap,
  sharedRoad,
  spurBaseIndex,
} from "@/lib/routing/reroute-leg";
import { routeThroughPlaces, type ThroughResult } from "@/lib/routing/through-stops";
import { pruneSpurs, rebuildPath } from "@/lib/routing/prune-spurs";

/**
 * A generated ride's own stops ridden THROUGH, not reached by an out-and-back
 * (2026-09-25).
 *
 * The rider's rule: a stop must be passed and ridden on from; only a real dead
 * end may keep its out-and-back, and then it is said. The search protects a
 * rider's stop from spur pruning (`pruneOrLoopSpurs`: the spur IS the visit)
 * and loops only spurs at vias it invented, so a stop off the through road was
 * reached in and out the same way — on his Taaza Cinnamon → Gaujaslīču iela 22
 * ride, stop 1 "Cinītes 2" up 780 m of road ridden in and out, stop 2 "Vecās
 * piķa bedres ceļš" up 629 m.
 *
 * This runs on the rides the generation returns, after the search: each stop
 * whose way in and way out share more than `THROUGH_SHARED_MIN_M` gets a
 * window of the ride around its spur, from `EDIT_WINDOW_M` before the spur's
 * base to as far after where the ride leaves it (never past a neighbouring
 * stop), and edit mode's `routeThroughPlaces` re-routes that window leg by
 * leg with the spur fenced off both ways. The window is put in only when the
 * whole ride then rides less of the same road twice, no stop is left on a
 * longer spur, and the window grew by no more than edit mode's own bound — so
 * a window that trades the spur for road ridden twice elsewhere, or finds a
 * loop that is a detour, leaves the ride as it was. A stop still on a spur
 * after that is a real dead end, and `deadEndMeters` says how long.
 *
 * The stop is passed to the router as the ride's own nearest vertex, not the
 * rider's pin: the pin may be off any road (the rider's "Cinītes 2" sits
 * 400 m from one), and the ride already found where it can be reached.
 */

/** What one stop's spur was, and is. */
export type StopSpur = { stop: number; beforeMeters: number; afterMeters: number };

export type ThroughStopsResult = {
  path: RoutePath;
  spurs: StopSpur[];
  /** The longest out-and-back a stop is still reached by, metres (0: none). */
  deadEndMeters: number;
};

type Through = (params: { points: Point[]; profileOptions: MotoProfileOptions; deadlineAt: number }) => Promise<ThroughResult>;

/** Where a stop sits on the line, and the spur that reaches it. */
type StopOnLine = { stop: number; along: number; tip: number; spur: number; from: number; to: number };

/**
 * Each stop's place on the line (in order) and the road its way in and way
 * out share, looked for within `EDIT_WINDOW_M` of it and never past the
 * neighbouring stops.
 */
export function stopSpurs(line: Point[], stops: Point[]): StopOnLine[] {
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const alongs: number[] = [];
  let min = 0;
  for (const s of stops) {
    const at = nearestAlong(s, line, cum, min).alongMeters;
    alongs.push(at);
    min = at;
  }
  const index = (m: number) => {
    let i = 0;
    while (i < cum.length - 1 && cum[i + 1] <= m) i++;
    return i + 1 < cum.length && cum[i + 1] - m < m - cum[i] ? i + 1 : i;
  };
  return alongs.map((along, s) => {
    const tip = index(along);
    const lo = Math.max(s > 0 ? alongs[s - 1] : 0, along - EDIT_WINDOW_M);
    const hi = Math.min(s < alongs.length - 1 ? alongs[s + 1] : total, along + EDIT_WINDOW_M);
    const from = index(lo), to = index(hi);
    const approach = line.slice(from, tip + 1), departure = line.slice(tip, to + 1);
    const spur = approach.length > 1 && departure.length > 1 ? sharedRoad(approach, departure).meters : 0;
    return { stop: s, along, tip, spur, from, to };
  });
}

export async function rideThroughStops(params: {
  path: RoutePath;
  stops: Point[];
  profileOptions: MotoProfileOptions;
  /** When the whole step must have answered (epoch ms); past it the ride stays as it was. */
  deadlineAt: number;
  /**
   * The rider's shaping points: a window that would ride past one is not
   * re-routed, so the bend he gave the line stays where he put it.
   */
  keep?: Point[];
  through?: Through;
}): Promise<ThroughStopsResult> {
  const { path, stops, profileOptions, deadlineAt } = params;
  const through: Through = params.through ?? ((p) => routeThroughPlaces(p));
  const line = path.coordinates;
  const unchanged = (at: StopOnLine[]): ThroughStopsResult => ({
    path,
    spurs: at.map((s) => ({ stop: s.stop, beforeMeters: Math.round(s.spur), afterMeters: Math.round(s.spur) })),
    deadEndMeters: deadEnd(at.map((s) => s.spur)),
  });
  if (!stops.length || line.length < 3) return unchanged([]);
  const on = stopSpurs(line, stops);
  if (!on.some((s) => s.spur > THROUGH_SHARED_MIN_M) || Date.now() >= deadlineAt) return unchanged(on);

  // In passes: each pass takes the stops still reached by a spur, gives each
  // a window of its own — from `EDIT_WINDOW_M` before the spur's base on the
  // way in to as far past where the way out leaves it, never past a
  // neighbouring stop — and routes the windows that do not overlap, at once.
  // One stop per window, because two places in one request compete for the
  // leg between them (`routeThroughPlaces` replaces a leg once): measured on
  // the rider's ride, stops 1 and 2 are 3 km apart and the second kept its
  // spur. A stop is asked about once.
  let current = path;
  let repeated = recomputeOverlap(line).repeatedKm;
  const asked = new Set<number>();
  for (let pass = 0; pass < stops.length && Date.now() < deadlineAt; pass++) {
    const ride = current.coordinates;
    const cum = cumulative(ride);
    const total = cum[cum.length - 1];
    const here = stopSpurs(ride, stops);
    type Run = { stop: number; from: number; to: number; spur: number };
    const wanted: Run[] = here.filter((s) => s.spur > THROUGH_SHARED_MIN_M && !asked.has(s.stop)).map((s) => {
      const base = s.from + spurBaseIndex(ride.slice(s.from, s.tip + 1), ride.slice(s.tip, s.to + 1));
      const back = s.along + (s.along - cum[base]);
      const prev = s.stop > 0 ? here[s.stop - 1].tip : 0;
      const next = s.stop < here.length - 1 ? here[s.stop + 1].tip : ride.length - 1;
      return {
        stop: s.stop, spur: s.spur,
        from: Math.max(prev, vertexAt(cum, Math.max(0, cum[base] - EDIT_WINDOW_M))),
        to: Math.min(next, vertexAt(cum, Math.min(total, back + EDIT_WINDOW_M))),
      };
    });
    if (!wanted.length) break;
    // The longest spurs first; a window that overlaps one already chosen
    // waits for the next pass, on the ride that one leaves.
    const runs: Run[] = [];
    const kept = (params.keep ?? []).map((k) => nearestAlong(k, ride, cum).alongMeters);
    for (const w of [...wanted].sort((a, b) => b.spur - a.spur)) {
      if (w.from >= here[w.stop].tip || w.to <= here[w.stop].tip || kept.some((k) => k > cum[w.from] && k < cum[w.to])) { asked.add(w.stop); continue; }
      if (runs.some((r) => w.from < r.to && w.to > r.from)) continue;
      runs.push(w);
      asked.add(w.stop);
    }
    runs.sort((a, b) => a.from - b.from);
    if (!runs.length) break;
    const answers = await Promise.all(runs.map(async (run) => {
      const points: Point[] = [ride[run.from], ride[here[run.stop].tip], ride[run.to]];
      const answer = await withDeadline(through({ points, profileOptions, deadlineAt }), deadlineAt - Date.now());
      if (!answer) return null;
      // A plain leg in the window can carry a dead-end excursion of its own
      // (measured: 250 m on the way to the rider's stop 2); it goes the way
      // the search's own do, the stop and the window's ends kept.
      try {
        return { ...answer, path: pruneSpurs(answer.path, { protect: points.slice(1), toleranceMeters: 30, requireCircuit: false }) };
      } catch {
        return answer;
      }
    }));

    // Each window is judged on the ride with the ones before it put in: it
    // must lower what the whole ride rides twice, and may grow by no more than
    // edit mode allows a loop through a place. Every version is assembled
    // from this pass's ride, so indices never drift.
    const assemble = (taken: number[]): RoutePath => {
      const sources: RoutePath[] = [current];
      const refs: [number, number][] = [];
      let j = 0;
      for (const r of taken) {
        for (; j <= runs[r].from; j++) refs.push([0, j]);
        const source = sources.push(answers[r]!.path) - 1;
        answers[r]!.path.coordinates.forEach((_, i) => refs.push([source, i]));
        j = runs[r].to;
      }
      for (; j < ride.length; j++) refs.push([0, j]);
      return rebuildPath(current, sources, refs);
    };
    const taken: number[] = [];
    let next = current;
    runs.forEach((run, r) => {
      const piece = answers[r]?.path.coordinates;
      if (!piece || piece.length < 2) return;
      // It must join the ride where it was asked to.
      if (haversineMeters(piece[0], ride[run.from]) > 30 || haversineMeters(piece.at(-1)!, ride[run.to]) > 30) return;
      let newMeters = 0;
      for (let i = 1; i < piece.length; i++) newMeters += haversineMeters(piece[i - 1], piece[i]);
      if (newMeters - (cum[run.to] - cum[run.from]) > Math.max(LOOP_EXTRA_PER_SHARED * run.spur, LOOP_EXTRA_FLOOR_M)) return;
      const candidate = assemble([...taken, r]);
      const again = recomputeOverlap(candidate.coordinates).repeatedKm;
      if (again >= repeated - 0.05) return;
      // And no stop may be left on a longer spur than it had: a window ends
      // at its neighbour's stop, and measured on Rīga → Ķekava → Baldone, a
      // way through one stop turned its neighbour's 250 m spur into 1.2 km.
      const before = stopSpurs(next.coordinates, stops);
      if (stopSpurs(candidate.coordinates, stops).some((s, i) => s.spur > (before[i]?.spur ?? 0) + 20)) return;
      taken.push(r);
      next = candidate;
      repeated = again;
    });
    current = next;
  }
  if (current === path) return unchanged(on);
  const after = stopSpurs(current.coordinates, stops);
  return {
    path: current,
    spurs: on.map((s, i) => ({ stop: s.stop, beforeMeters: Math.round(s.spur), afterMeters: Math.round(after[i]?.spur ?? s.spur) })),
    deadEndMeters: deadEnd(after.map((s) => s.spur)),
  };
}

const deadEnd = (spurs: number[]): number => {
  const worst = Math.max(0, ...spurs);
  return worst > THROUGH_SHARED_MIN_M ? Math.round(worst) : 0;
};

function vertexAt(cum: number[], meters: number): number {
  let i = 0;
  while (i < cum.length - 1 && cum[i] < meters) i++;
  return i;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  if (ms <= 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    (timer as { unref?: () => void }).unref?.();
    promise.then((v) => { clearTimeout(timer); resolve(v); }, () => { clearTimeout(timer); resolve(null); });
  });
}
