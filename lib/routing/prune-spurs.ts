import type { RoutePath, RouteEdge } from "@/lib/types";
import { haversineMeters, type Point } from "@/lib/geo/geometry";

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
 * Remove exact out-and-back excursions, without inventing any road segment.
 *
 * An excursion is a run of points ridden out to a tip and back over exactly
 * the same points (A-B-C-B-A collapses to A). Nested dead ends collapse from
 * the inside out; an access corridor that leads to a real circuit survives
 * (A-B-C-D-B-A does not collapse). Geometry is only ever removed, never
 * re-routed: every surviving segment is one the router produced, and it
 * keeps the tags of its ORIGINAL edge, so surface, class and access
 * corridors stay as they were.
 *
 * Distance and the router's duration are scaled by the length actually
 * kept; everything else (`classifyRoute`'s km, surface shares, overlap and
 * its own duration) is measured from the pruned coordinates and edges.
 */
export function pruneSpurs(path: RoutePath, options: PruneSpursOptions = {}): RoutePath {
  const coords = path.coordinates;
  if (coords.length < 3) return path;
  const protect = options.protect ?? [];
  const tolerance = options.toleranceMeters ?? DEFAULT_TOLERANCE_M;
  const requireCircuit = options.requireCircuit ?? true;
  const same = (a: number, b: number) => coords[a][0] === coords[b][0] && coords[a][1] === coords[b][1];

  // Indices into `coords`, consecutive duplicates dropped (a leg ends where
  // the next begins, so every via join repeats a point).
  const seq: number[] = [];
  for (let i = 0; i < coords.length; i++) if (!seq.length || !same(seq[seq.length - 1], i)) seq.push(i);

  // Tips already judged to be a protected visit, by original index.
  const keptTips = new Set<number>();
  // Left to right; after a removal step back to where the spur hung, because
  // its base may itself be the tip of the next (outer) excursion.
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
      seq.splice(visit + 1, 2 * (t - visit));
      keptTips.add(seq[visit]);
      t = visit + 1;
      continue;
    }
    // seq[t-k] is the base; the points after it up to the mirror image of the
    // base go, and the ride continues from the base as if it had never left.
    seq.splice(t - k + 1, 2 * k);
    t = Math.max(1, t - k);
  }
  if (seq.length === coords.length) return path;
  if (requireCircuit && seq.length < 4) throw new Error("Candidate contains no circuit after removing dead-end excursions");

  // Each surviving incoming segment retains the tags of its ORIGINAL edge.
  // After cancellation the previous coordinate is identical to its original
  // predecessor; no straight-line shortcut is introduced.
  const edgeAt = new Map<number, RouteEdge>();
  for (const edge of path.edges) {
    for (let i = edge.beginShapeIndex + 1; i <= edge.endShapeIndex; i++) edgeAt.set(i, edge);
  }
  const coordinates = seq.map(i => coords[i]);
  const elevations = path.elevations?.length === coords.length
    ? seq.map((index) => path.elevations![index])
    : undefined;
  const edges: RouteEdge[] = [];
  let meters = 0, originalMeters = 0;
  for (let i = 1; i < coords.length; i++) originalMeters += haversineMeters(coords[i-1], coords[i]);
  let previousSource: RouteEdge | undefined;
  for (let i = 1; i < seq.length; i++) {
    const source = edgeAt.get(seq[i]);
    const length = haversineMeters(coordinates[i-1], coordinates[i]);
    meters += length;
    const last = edges.at(-1);
    if (last && source === previousSource) {
      last.endShapeIndex = i;
      last.lengthKm = (last.lengthKm ?? 0) + length / 1000;
    } else {
      edges.push({ ...source, beginShapeIndex: i-1, endShapeIndex: i, lengthKm: length / 1000 });
    }
    previousSource = source;
  }
  const ratio = originalMeters > 0 ? meters / originalMeters : 1;
  // Everything else the router said about the path (a moved endpoint, a
  // stitched-together leg) is still true of what is left of it.
  const { elevations: _unaligned, ...rest } = path;
  void _unaligned;
  return {
    ...rest,
    coordinates,
    ...(elevations ? { elevations } : {}),
    edges,
    distanceMeters: path.distanceMeters * ratio,
    durationSeconds: path.durationSeconds * ratio,
  };
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
