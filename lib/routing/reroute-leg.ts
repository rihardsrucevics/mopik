import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { GeneratedRoute, RouteMix, RouteSegmentProperties, SurfaceMix } from "@/lib/types";
import type { ResolvedPlace } from "@/lib/chat/places";
import type { RidePlan } from "@/lib/chat/ride-plan";
import { placeRoles } from "@/lib/map/place-roles";
import { cumulative, lineMeters, pointAtDistance, sliceBetween, splicedSurfaces } from "@/lib/routing/detour";
import { segmentSpeedKmh } from "@/lib/routing/speed";
import { visitsRequiredStops } from "@/lib/routing/required-stops";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { interleaveShapes, shapesAfterPlaces, type ShapePoint } from "@/lib/routing/shape-points";

/**
 * Correcting a ride on the map, without searching for a new one.
 *
 * Three riders asked for the same thing in their own words: after a ride is
 * generated, fix it on the map — move the finish, drag a stop, add one — and
 * see the new line at once, not after another minute of searching. A full
 * generation is ~36 candidates and 30-60 s. Moving one place a couple of
 * kilometres does not need any of that: it changes **the legs either side of
 * that place** and leaves the rest of the line exactly where the router put it.
 *
 * So an edit here is: work out which stretch of the drawn line the change
 * invalidates, throw that stretch away, route a replacement through the new
 * point on the ride's own profile, and splice it in. A couple of short legs is
 * one to three seconds on our own BRouter.
 *
 * ## What this module is, and what it is not
 *
 * Arithmetic on a polyline, a segment collection and two lists of places — no
 * routing, no `fs`, no dataset — exactly like `detour.ts`, and for the same
 * reason: the client decides what to cut and splices the answer, the server
 * only routes the points it is sent, and nothing derived travels between them.
 * The BRouter calls live in `app/api/reroute-leg/route.ts`; the page's side in
 * `home-page.tsx`.
 *
 * ## What it deliberately does NOT do
 *
 * It does not re-rank, re-score or re-search. An edited ride is the rider's own
 * line, not one Mopik chose, and "never substitute silently" cuts both ways:
 * Mopik must not quietly replace his edit with something it likes better, and
 * it must not let his edit pass as a Mopik-planned ride either. Hence
 * `recomputeOverlap` — an edit can raise the retraced figure and the rider has
 * to see that — and the "Labots ar roku" kicker the panel draws from it. The
 * full search stays one explicit tap away ("Meklēt labāku apli").
 */

/**
 * How much of the line a move or a new stop re-routes, either side of it.
 *
 * The obvious reading of "re-route the two legs around the place" is "route
 * from the place before to the place after". For a ride between two towns
 * that is right. For a loop it is a disaster, and it was measured as one: on a
 * 126 km Sigulda round trip with one stop 1 km in, a point added 25 km along
 * fell in the leg "stop (1 km) → finish (126 km)", and routing that leg
 * straight replaced 125 km of ride with one short line — **the ride came back
 * as 12 km and 43 % retraced.** The shape of a loop lives in the corridor vias
 * the search generated, and those are not places the rider named, so they are
 * not anchors here and a straight re-route between anchors throws them away.
 *
 * So a move or an addition replaces a bounded window around the change —
 * this far each way along the line, or out to the neighbouring place when that
 * is nearer — and keeps everything beyond it. 3 km each way gives the router
 * real road either side to join, and keeps the request the one-to-three-second
 * search this feature promises.
 */
export const EDIT_WINDOW_M = 3_000;

/**
 * The window grows with how far the place moved: twice the distance, as the
 * crow flies. A stop nudged 200 m re-routes the 3 km around it; a finish moved
 * 12 km away re-routes 24 km back from the end, so the new line reaches it
 * along real road instead of hairpinning off a stub the old finish left.
 */
export const WINDOW_PER_METRE_MOVED = 2;

/** Two coordinates are the same place when they agree to ~10 cm. */
function same(a: { lat: number; lon: number }, b: { lat: number; lon: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lon - b.lon) < 1e-6;
}

const toPoint = (p: { lat: number; lon: number }): Point => [p.lon, p.lat];

/**
 * A place the ride is pinned to: the start, a stop, the finish.
 *
 * `name` is what the plan and the form's row call it; `label` is the
 * disambiguating string the picker showed. Both travel, because the plan is
 * rebuilt from names and the share code from coordinates, and an edit that
 * updated only one of them is how a stop comes back from the dead.
 */
export type RidePlace = ResolvedPlace & {
  /**
   * Where the edit that put this stop here joined the kept ride — the two
   * ends of the stretch it re-routed. Taking the stop out again re-routes
   * exactly that stretch, so an added and removed stop gives back the ride it
   * started as. Measured without it: a stop that had pulled a 26 km ride out
   * to 37 km was removed with a window around the stop alone, the two sides
   * of its loop were kept and joined, and the ride came back 37 km and 13 %
   * retraced. Absent on the search's own stops.
   */
  joins?: [Point, Point];
  /**
   * For a stop made by grabbing the drawn line and moving that point (edit
   * mode, 2026-09-25): where on the line it was grabbed. The stop goes into
   * the ride at that point's place along the line, and the stretch around it
   * is re-routed as if a stop there had been moved to where it now is —
   * rather than wherever the line happens to pass nearest the new spot.
   */
  grabbedAt?: Point;
  /**
   * A shaping point („maršruta punkts”, 2026-09-25), not a stop: where the
   * rider bent the line by grabbing it. It sits among the vias in riding
   * order because to the router it IS a via — every stretch, window and
   * loop rule here treats it exactly like a stop — but it has no row, no
   * name, no waypoint and no visit check: the rows, the plan's names, the
   * share code's places and the GPX all read the stops only (`stopsOf`).
   */
  shape?: true;
  /**
   * Reached straight, off any road („Vest pa taisno”, design C `reach:
   * "straight"`): the ride goes as far as a road goes and then straight to
   * it and back (`lib/map/straight.ts`). Its `joins` are where the straight
   * stretch leaves the ride; taking the point out takes the whole stretch
   * out, nothing re-routed.
   */
  reach?: "straight";
};

/** Whether a via is a shaping point rather than a stop. */
export const isShape = (p: RidePlace): boolean => p.shape === true;

/** The ride's stops: its vias without the shaping points. */
export function stopsOf(places: RidePlaces): RidePlace[] {
  return places.vias.filter((v) => !isShape(v));
}

/** The ride's shaping points, in riding order. */
export function shapesOf(places: RidePlaces): RidePlace[] {
  return places.vias.filter(isShape);
}

/** A shaping point as a via: no name, because it is not a place. */
function shapeVia(p: { lat: number; lon: number }): RidePlace {
  return { name: "", label: "", lat: p.lat, lon: p.lon, shape: true };
}

/**
 * The shaping points as the plan carries them — each with the place it
 * follows — or none. See `RidePlanSchema.shapePoints`.
 */
export function shapePointsOf(places: RidePlaces): ShapePoint[] {
  return shapesAfterPlaces(places.vias, isShape, (v) => ({ lat: Number(v.lat.toFixed(6)), lon: Number(v.lon.toFixed(6)) }));
}

/**
 * The ride's places, by role, as the edit leaves them.
 *
 * `finish` is null on a round trip (the ride returns to its start) and on a
 * one-way "man vienalga" ride, which ends wherever the router took it — the
 * end of the drawn line is then the last fixed point, not a place.
 */
export type RidePlaces = {
  start: RidePlace;
  vias: RidePlace[];
  finish: RidePlace | null;
  roundTrip: boolean;
};

/**
 * The fixed points of a ride, in riding order, as coordinates.
 *
 * A round trip ends where it started, so its start is listed twice — first and
 * last — and a ride with no finish ends at the drawn line's own end. That last
 * point is what makes "the leg after the last stop" exist on a ride that has
 * no finish of its own.
 */
export function anchorsOf(places: RidePlaces, lineEnd: Point): Point[] {
  const tail: Point[] = places.roundTrip
    ? [toPoint(places.start)]
    : places.finish ? [toPoint(places.finish)] : [lineEnd];
  return [toPoint(places.start), ...places.vias.map(toPoint), ...tail];
}

/**
 * The nearest point on a polyline to a place, and how far along it that is.
 *
 * `minMeters` keeps the answer at or past a point already placed: a ride that
 * passes through the same village twice would otherwise put its second stop at
 * the first pass, before the stop that precedes it, and the stretch between
 * them would run backwards.
 */
export function nearestAlong(
  target: Point,
  line: Point[],
  cum: number[],
  minMeters = 0,
): { meters: number; alongMeters: number } {
  let best = { meters: Infinity, alongMeters: minMeters };
  for (let i = 0; i < line.length - 1; i++) {
    if (cum[i + 1] < minMeters) continue;
    const a = line[i];
    const b = line[i + 1];
    // Local flat projection on the route's own latitude, as route-pois does.
    const cosLat = Math.cos((a[1] * Math.PI) / 180) || 1;
    const M = 111_320;
    const ax = a[0] * cosLat * M, ay = a[1] * M;
    const bx = b[0] * cosLat * M, by = b[1] * M;
    const px = target[0] * cosLat * M, py = target[1] * M;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const span = cum[i + 1] - cum[i];
    // The segment straddling `minMeters` is only eligible from that point on.
    if (cum[i] < minMeters && span > 0) t = Math.max(t, (minMeters - cum[i]) / span);
    const meters = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (meters >= best.meters) continue;
    best = { meters, alongMeters: cum[i] + t * span };
  }
  return best;
}

/**
 * Where along the drawn line each fixed point sits.
 *
 * The first is 0 and the last is the line's full length by construction — a
 * round trip's last anchor is its start, and pinning it by proximity would put
 * it at 0 m and make the last leg run backwards (measured: a 140 km loop became
 * 6 km on the first edit of its last stop). The ones between are placed in
 * order, each at or after the one before.
 */
export function anchorsAlong(anchors: Point[], line: Point[], cum: number[]): number[] {
  const total = cum[cum.length - 1];
  const out: number[] = [];
  anchors.forEach((a, i) => {
    if (i === 0) out.push(0);
    else if (i === anchors.length - 1) out.push(total);
    else out.push(nearestAlong(a, line, cum, out[i - 1]).alongMeters);
  });
  return out;
}

/**
 * What kind of change the rider made, named the way the analytics and the
 * tests talk about it.
 *
 * `reorder` covers anything that is not one of the five single changes — an
 * arrow in the form that swapped two stops, or a list re-seeded after a refused
 * edit — and is answered by re-routing the whole stretch between the first and
 * last place that changed.
 */
export type EditKind = "move-start" | "move-stop" | "move-finish" | "add-stop" | "add-stops" | "remove-stop" | "reorder";

/**
 * One stretch of the old line to throw away, and the points to route instead.
 *
 * `points[0]` and the last point are where the replacement joins the kept
 * ride. They are ON the old line wherever the kept ride continues — so the
 * splice has no gap — and are the rider's own place where the stretch reaches
 * a moved end.
 */
export type EditRun = {
  fromMeters: number; toMeters: number; points: Point[];
  /** Nothing to route: the stretch is simply taken out (a straight point removed). */
  drop?: true;
};

export type EditPlan = {
  kind: EditKind;
  runs: EditRun[];
  /**
   * The places as the edit leaves them. Usually exactly what the form sent;
   * for a new stop, re-sequenced to where the line meets it — see `planEdit`.
   */
  places: RidePlaces;
};

/**
 * How far an out-and-back spur runs back from a point, in metres.
 *
 * A stop at the end of a dead-end road is visited by riding in and back out
 * the same way. Removing it has to remove the whole spur, not just the few
 * kilometres around the tip: walks outwards while the line on both sides is
 * the same road (within 40 m), and reports how far that went.
 */
export function spurLength(line: Point[], cum: number[], alongMeters: number, step = 100): number {
  const total = cum[cum.length - 1];
  let w = 0;
  while (alongMeters - w - step >= 0 && alongMeters + w + step <= total) {
    const a = pointAtDistance(line, cum, alongMeters - w - step).point;
    const b = pointAtDistance(line, cum, alongMeters + w + step).point;
    if (haversineMeters(a, b) > 40) break;
    w += step;
  }
  return w;
}

/**
 * How far past a neighbouring place a stretch reaches when, cut at that
 * place, it came back as an out-and-back from it (`throughBlockedPlaces`):
 * enough road beyond the place for its way out to be a way on, not so much
 * that an edit next to a stop re-routes the next leg too.
 */
export const THROUGH_NEIGHBOUR_M = 1_000;

/**
 * The step `planEdit` walks a neighbouring place's spur in: fine enough to
 * see the 50-300 m out-and-backs `spurLength`'s 100 m step reads as none.
 */
export const SPUR_TIP_STEP_M = 20;

/**
 * Which points of a stretch are shaping points — sent with it, so the router
 * cuts a spur to one instead of keeping it (`routeThroughPlaces`).
 */
export function shapeFlags(run: EditRun, places: RidePlaces): boolean[] {
  const shapes = shapesOf(places);
  return run.points.map((p) => shapes.some((s) => Math.abs(s.lon - p[0]) < 1e-9 && Math.abs(s.lat - p[1]) < 1e-9));
}

/**
 * Where a stop's recorded joins sit on the line now, if both still do (within
 * 30 m) and in order — a later edit may have re-routed the road they were on.
 */
function joinsOnLine(joins: [Point, Point] | undefined, line: Point[], cum: number[], min: number, max: number): [number, number] | null {
  if (!joins) return null;
  const a = nearestAlong(joins[0], line, cum, min);
  const b = nearestAlong(joins[1], line, cum, a.alongMeters);
  if (a.meters > 30 || b.meters > 30 || b.alongMeters > max + 1) return null;
  return [a.alongMeters, b.alongMeters];
}

/**
 * The joins to record on a stop the edit added or moved: the ends of the
 * stretch it re-routed, widened to any joins the stop already had that are
 * still on the new line — a moved stop's own loop may reach further than the
 * window its move re-routed.
 */
export function joinsFor(line: Point[], run: EditRun, previous?: [Point, Point]): [Point, Point] {
  const first = run.points[0];
  const last = run.points[run.points.length - 1];
  if (!previous) return [first, last];
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const at = (p: Point) => nearestAlong(p, line, cum);
  const known = joinsOnLine(previous, line, cum, 0, total);
  const runFrom = at(first).alongMeters;
  const runTo = at(last).alongMeters;
  if (!known) return [first, last];
  return [
    known[0] < runFrom ? previous[0] : first,
    known[1] > runTo ? previous[1] : last,
  ];
}

/**
 * Which stretch of the ride an edit re-routes, for each kind of edit.
 *
 * The rule for each, and why:
 *
 * - **Move a stop** — a window around where it was, `EDIT_WINDOW_M` each way
 *   (more when it moved far), never past the places either side. The legs
 *   around the stop and nothing else.
 * - **Move the start / the finish** — from the moved end to a point that far
 *   into the ride. A round trip's start is also its finish, so moving it
 *   re-routes both ends: two stretches, routed together.
 * - **Add a stop** — a window around where the line passes nearest to it. The
 *   new stop is placed in the list where the line meets it, whatever row the
 *   form put it in: the ride visits places in the order the line reaches them,
 *   and a list that said otherwise would describe a different ride.
 * - **Remove a stop** — the spur to it, when the ride rode in and back out,
 *   and a window beyond: the same stretch adding it would have re-routed, so
 *   adding a stop and taking it out again gives back the ride it started as.
 *   Routing "place before → place after" straight instead was measured on
 *   Sigulda → Cēsis: the 55 km ride the search found came back as a 59 km
 *   router line with none of the search's shape left in it. A ride that has
 *   nothing left once the stop goes — a pure out-and-back — is refused.
 * - **Anything else** — the whole stretch between the first and last place
 *   that changed, place to place.
 *
 * Null when nothing changed; `{ error }` when there is no sensible answer.
 */
export function planEdit(params: {
  line: Point[];
  cum: number[];
  before: RidePlaces;
  after: RidePlaces;
  /**
   * New stops stay where `after` has them (Phase 1, 2026-09-28: a new point
   * goes into its nearest leg, or the leg the rider chose — see
   * `lib/map/insert-leg.ts` and `mergeAddedInOrder`). Each is re-routed
   * where its own leg's line passes nearest to it. Without it, a new stop is
   * re-slotted wherever the whole line passes nearest.
   */
  keepOrder?: boolean;
  /**
   * Metre intervals of the line that are drawn straight (`drawnIntervals`):
   * fixed — a window stops at them and never re-routes them (design C).
   */
  fixed?: [number, number][];
}): EditPlan | { error: "degenerate" } | null {
  const { line, cum, before } = params;
  const fixed = params.fixed ?? [];
  const keep = params.keepOrder === true;
  let after = params.after;
  const total = cum[cum.length - 1];
  const end = line[line.length - 1];
  const at = (m: number): Point => pointAtDistance(line, cum, m).point;
  const oldA = anchorsOf(before, end);
  const along = anchorsAlong(oldA, line, cum);
  const windowFor = (moved: number) => Math.max(EDIT_WINDOW_M, moved * WINDOW_PER_METRE_MOVED);
  const plan = (kind: EditKind, runs: EditRun[]): EditPlan => ({ kind, runs, places: after });

  const startMoved = !same(before.start, after.start);
  const sameVias = before.vias.length === after.vias.length && before.vias.every((v, i) => same(v, after.vias[i]));
  const finishMoved = !before.roundTrip && (
    (before.finish === null) !== (after.finish === null) ||
    (before.finish !== null && after.finish !== null && !same(before.finish, after.finish))
  );

  // The start.
  if (startMoved && sameVias && !finishMoved) {
    const moved = haversineMeters(toPoint(before.start), toPoint(after.start));
    const w = windowFor(moved);
    const head: EditRun = {
      fromMeters: 0,
      toMeters: Math.min(along[1], w),
      points: [toPoint(after.start), at(Math.min(along[1], w))],
    };
    if (!before.roundTrip) return plan("move-start", [head]);
    const last = along.length - 1;
    const tailFrom = Math.max(along[last - 1], total - w);
    // A loop with no stops has one leg; if the two windows would meet, the
    // stretch between them is too short to keep and the whole loop is routed
    // from the new start and back.
    if (tailFrom <= head.toMeters) {
      return plan("move-start", [{ fromMeters: 0, toMeters: total, points: [toPoint(after.start), at(total / 2), toPoint(after.start)] }]);
    }
    return plan("move-start", [head, { fromMeters: tailFrom, toMeters: total, points: [at(tailFrom), toPoint(after.start)] }]);
  }

  // The finish (one-way only: a round trip's finish is its start).
  if (finishMoved && !startMoved && sameVias) {
    const last = along.length - 1;
    const target = after.finish ? toPoint(after.finish) : end;
    const moved = haversineMeters(oldA[last], target);
    const from = Math.max(along[last - 1], total - windowFor(moved));
    return plan("move-finish", [{ fromMeters: from, toMeters: total, points: [at(from), target] }]);
  }

  if (!startMoved && !finishMoved) {
    const bv = before.vias, av = after.vias;
    /**
     * The stretch around one changed place: `w` each way along the line from
     * `centre`, never past the places either side (anchors `lo` and `hi`) —
     * unless that place sits at the tip of an out-and-back on the line. Then
     * the stretch reaches past it, taking it in as a place to ride through:
     * a stretch that stops ON such a place keeps the spur to it for ever,
     * whatever the edit does (measured on the rider's ride, 2026-09-25: his
     * stop 2 was the tip of a 600 m out-and-back, the stops he added beside
     * it were re-routed up to it and no further, and it stayed a spur).
     */
    type Piece = { from: number; to: number; points: { along: number; p: Point }[] };
    const pieceAround = (centre: number, w: number, lo: number, hi: number, p: Point): Piece => {
      const out: Piece = { from: Math.max(along[lo], centre - w), to: Math.min(along[hi], centre + w), points: [{ along: centre, p }] };
      // A neighbour reached straight is not a spur to ride through: its
      // out-and-back is the one the rider drew (design C: fixed).
      const isVia = (k: number) => k > 0 && k < oldA.length - 1 && before.vias[k - 1]?.reach !== "straight";
      if (out.from <= along[lo] + 1 && isVia(lo)) {
        const spur = spurLength(line, cum, along[lo], SPUR_TIP_STEP_M);
        if (spur >= THROUGH_SHARED_MIN_M) {
          out.points.unshift({ along: along[lo], p: oldA[lo] });
          out.from = Math.max(along[lo - 1], along[lo] - spur - EDIT_WINDOW_M);
        }
      }
      if (out.to >= along[hi] - 1 && isVia(hi)) {
        const spur = spurLength(line, cum, along[hi], SPUR_TIP_STEP_M);
        if (spur >= THROUGH_SHARED_MIN_M) {
          out.points.push({ along: along[hi], p: oldA[hi] });
          out.to = Math.min(along[hi + 1], along[hi] + spur + EDIT_WINDOW_M);
        }
      }
      // A drawn straight stretch is fixed: the window stops at its edge.
      for (const [a, b] of fixed) {
        if (b <= centre && b > out.from) out.from = b;
        if (a >= centre && a < out.to) out.to = a;
      }
      return out;
    };
    /**
     * Pieces that overlap are one stretch, through every place in both, in
     * the order the line reaches them. Two that only touch — at a place both
     * stop on — stay two: merged, the place between them would be left out.
     */
    const runsOf = (pieces: Piece[]): EditRun[] => {
      const sorted = [...pieces].sort((x, y) => x.from - y.from);
      const merged: Piece[] = [];
      for (const q of sorted) {
        const open = merged[merged.length - 1];
        if (open && q.from < open.to) {
          open.to = Math.max(open.to, q.to);
          for (const pt of q.points) if (!open.points.some((o) => o.p[0] === pt.p[0] && o.p[1] === pt.p[1])) open.points.push(pt);
          continue;
        }
        merged.push({ ...q, points: [...q.points] });
      }
      return merged.map((q) => ({
        fromMeters: q.from,
        toMeters: q.to,
        points: [at(q.from), ...q.points.sort((x, y) => x.along - y.along).map((pt) => pt.p), at(q.to)],
      }));
    };
    // One stop moved.
    if (bv.length === av.length) {
      const changed = bv.map((v, i) => (same(v, av[i]) ? -1 : i)).filter((i) => i >= 0);
      if (changed.length === 0) return null;
      if (changed.length === 1) {
        const k = changed[0] + 1; // anchor index
        const moved = haversineMeters(oldA[k], toPoint(av[changed[0]]));
        return plan("move-stop", runsOf([pieceAround(along[k], windowFor(moved), k - 1, k + 1, toPoint(av[changed[0]]))]));
      }
    }
    // One stop added: every old stop still there, in order, plus one.
    if (av.length === bv.length + 1) {
      const extra = av.findIndex((v) => !bv.some((b) => same(b, v)));
      const rest = av.filter((_, i) => i !== extra);
      if (extra >= 0 && rest.every((v, i) => same(v, bv[i]))) {
        const added = av[extra];
        // A grabbed line point enters the ride where it was grabbed, and the
        // window is sized by how far it was moved from there. A stop placed
        // in its leg (`keep`) meets the line in that leg.
        const inLeg = keep && !added.grabbedAt;
        const nearest = added.grabbedAt
          ? { ...nearestAlong(added.grabbedAt, line, cum), meters: haversineMeters(added.grabbedAt, toPoint(added)) }
          : inLeg ? nearestWithin(toPoint(added), line, cum, along[extra], along[extra + 1])
          : nearestAlong(toPoint(added), line, cum);
        // Its slot is between the two fixed points the line passes it between.
        let slot = 0;
        if (inLeg) slot = extra;
        else while (slot < bv.length && along[slot + 1] <= nearest.alongMeters) slot++;
        after = { ...after, vias: [...bv.slice(0, slot), added, ...bv.slice(slot)] };
        return plan("add-stop", runsOf([pieceAround(nearest.alongMeters, windowFor(nearest.meters), slot, slot + 1, toPoint(added))]));
      }
    }
    // Several stops added at once (a batch, 2026-09-25): every old stop still
    // there, in order, plus two or more. Each goes into the ride where the
    // line passes it, exactly as one added stop does, and each gets its own
    // window; windows that meet are one stretch, routed through every stop in
    // it in the order the line reaches them. All the stretches go to the
    // router in one request and are routed in parallel.
    if (av.length > bv.length + 1) {
      const isOld = (v: RidePlace) => bv.some((b) => same(b, v));
      const kept = av.filter(isOld);
      if (kept.length === bv.length && kept.every((v, i) => same(v, bv[i]))) {
        const extras = av.map((added, i) => ({ added, i })).filter(({ added }) => !isOld(added)).map(({ added, i }) => {
          const anchor = added.grabbedAt ?? toPoint(added);
          // Placed in its leg (`keep`): the leg is the old places either side of it in `after`.
          const inLeg = keep && !added.grabbedAt;
          const legSlot = av.slice(0, i).filter(isOld).length;
          const n = inLeg ? nearestWithin(anchor, line, cum, along[legSlot], along[legSlot + 1]) : nearestAlong(anchor, line, cum);
          const meters = added.grabbedAt ? haversineMeters(added.grabbedAt, toPoint(added)) : n.meters;
          let slot = 0;
          if (inLeg) slot = legSlot;
          else while (slot < bv.length && along[slot + 1] <= n.alongMeters) slot++;
          return { added, order: i, alongMeters: n.alongMeters, slot, piece: pieceAround(n.alongMeters, windowFor(meters), slot, slot + 1, toPoint(added)) };
        }).sort((a, b) => (keep ? a.order - b.order : a.alongMeters - b.alongMeters));
        const vias: RidePlace[] = [];
        for (let slot = 0; slot <= bv.length; slot++) {
          if (slot > 0) vias.push(bv[slot - 1]);
          for (const e of extras) if (e.slot === slot) vias.push(e.added);
        }
        after = { ...after, vias };
        return plan("add-stops", runsOf(extras.map((e) => e.piece)));
      }
    }
    // One stop removed.
    if (av.length === bv.length - 1) {
      const gone = bv.findIndex((v, i) => !av[i] || !same(v, av[i]));
      const rest = bv.filter((_, i) => i !== gone);
      if (gone >= 0 && rest.every((v, i) => same(v, av[i]))) {
        const k = gone + 1;
        // Reached straight: its whole stretch — road out, straight there and
        // back, road back — comes out, and the ride joins where it left it.
        const straight = bv[gone].reach === "straight" ? bv[gone].joins : undefined;
        if (straight) {
          const f = nearestWithin(straight[0], line, cum, along[k - 1], along[k]);
          const t = nearestWithin(straight[1], line, cum, along[k], along[k + 1]);
          if (f.meters <= 30 && t.meters <= 30) {
            return plan("remove-stop", [{ fromMeters: f.alongMeters, toMeters: t.alongMeters, points: [at(f.alongMeters), at(t.alongMeters)], drop: true }]);
          }
        }
        // The stretch the edit that added it re-routed, when the joins are
        // still on the line; otherwise the spur to the stop, if it was
        // visited by riding in and back out, and a window beyond it. Never
        // past the places either side.
        const joined = joinsOnLine(bv[gone].joins, line, cum, along[k - 1], along[k + 1]);
        const w = spurLength(line, cum, along[k]) + EDIT_WINDOW_M;
        const f = joined && joined[0] < along[k] ? joined[0] : Math.max(along[k - 1], along[k] - w);
        const t = joined && joined[1] > along[k] ? joined[1] : Math.min(along[k + 1], along[k] + w);
        const fp = at(f);
        const tp = at(t);
        if (haversineMeters(fp, tp) < 50) return { error: "degenerate" };
        return plan("remove-stop", [{ fromMeters: f, toMeters: t, points: [fp, tp] }]);
      }
    }
  }

  // Anything else: the stretch between the first and the last changed place.
  const newA = anchorsOf(after, end);
  let p = 0;
  while (p < oldA.length && p < newA.length && same({ lon: oldA[p][0], lat: oldA[p][1] }, { lon: newA[p][0], lat: newA[p][1] })) p++;
  if (p === oldA.length && p === newA.length) return null;
  let s = 0;
  while (
    s < oldA.length - p && s < newA.length - p &&
    same({ lon: oldA[oldA.length - 1 - s][0], lat: oldA[oldA.length - 1 - s][1] }, { lon: newA[newA.length - 1 - s][0], lat: newA[newA.length - 1 - s][1] })
  ) s++;
  // The kept anchors either side, or the moved ends themselves.
  const fromIdx = p - 1;
  const toIdx = oldA.length - s;
  const fromMeters = fromIdx >= 0 ? along[fromIdx] : 0;
  const toMeters = toIdx < oldA.length ? along[toIdx] : total;
  const middle = newA.slice(Math.max(p, 0), newA.length - s);
  const points: Point[] = [
    ...(fromIdx >= 0 ? [at(fromMeters)] : []),
    ...middle,
    ...(toIdx < oldA.length ? [at(toMeters)] : []),
  ];
  if (points.length < 2 || haversineMeters(points[0], points[points.length - 1]) < 50 && points.length < 3) return { error: "degenerate" };
  return plan("reorder", [{ fromMeters, toMeters, points }]);
}

/**
 * A place the router could not ride right up to, and how close it came.
 *
 * BRouter does not refuse a point in a field: it answers, and the line turns
 * back at the nearest way the profile allows — measured on the verification
 * ride, a stop put in a clearing was reached from a track end 373 m away, and
 * nothing said so. The full search judges stops by the same gap (300 m,
 * `STOP_TOLERANCE_M`), so a place left where the rider put it would make the
 * next "Meklēt labāku apli" refuse a ride the map had just drawn.
 *
 * So each place the edit changed is measured against the new line. Within
 * `SNAP_SILENT_M` it is on the road and nothing is said. Up to
 * `MOVE_OFFER_MAX_M` it is moved to where the ride actually reaches it, and
 * the page says by how much — the move the planning map offers as "pārvietot
 * uz tuvāko ceļu", made here because the rider is watching the line reach
 * that spot. Beyond it the edit is refused: a ride that ends a kilometre from
 * the finish the rider chose is a different ride, not a correction.
 */
export const SNAP_SILENT_M = 25;

export function snapToLine(params: {
  line: Point[];
  before: RidePlaces;
  after: RidePlaces;
  maxMoveMeters: number;
}): { places: RidePlaces; movedMeters: number } | { error: "too-far"; meters: number } {
  const { line, before, after, maxMoveMeters } = params;
  const cum = cumulative(line);
  const known = [before.start, ...before.vias, ...(before.finish ? [before.finish] : [])];
  let moved = 0;
  let refused = 0;
  const snap = (p: RidePlace): RidePlace => {
    if (known.some((k) => same(k, p))) return p;
    const near = nearestAlong(toPoint(p), line, cum);
    // A shaping point goes onto the line wherever the router took it, and
    // nothing is said: it is not a place the rider will look for, only the
    // bend he asked for, and a later edit measures along the line from it.
    if (isShape(p)) {
      if (near.meters <= 1) return p;
      const [lon, lat] = pointAtDistance(line, cum, near.alongMeters).point;
      return { ...p, lat, lon };
    }
    if (near.meters <= SNAP_SILENT_M) return p;
    if (near.meters > maxMoveMeters) { refused = Math.max(refused, near.meters); return p; }
    moved = Math.max(moved, near.meters);
    const [lon, lat] = pointAtDistance(line, cum, near.alongMeters).point;
    return { ...p, lat, lon };
  };
  const places: RidePlaces = {
    ...after,
    start: snap(after.start),
    vias: after.vias.map(snap),
    finish: after.finish ? snap(after.finish) : null,
  };
  if (refused > 0) return { error: "too-far", meters: Math.round(refused) };
  return { places, movedMeters: Math.round(moved) };
}

/**
 * An edit that rides out to a stop and back the same way is the thing the
 * rider's one rule forbids, and it was measured on his own ride: a stop added
 * between Rīga and Annužas 1 ("Vasara 46") came back as the tip of a 6.03 km
 * out-and-back — 79 identical vertices each way, 12 km of 65.6 km retraced —
 * because the router, asked for "join → stop → join", chose the same road for
 * both halves.
 *
 * So the two halves of a stop's stretch are routed separately and compared.
 * When they share more than this, the departure is routed again with the
 * shared road fenced off (BRouter `nogos`), and — the mirror — the approach
 * too, and the edit takes whichever rides least of the same road twice,
 * within `LOOP_EXTRA_PER_SHARED`. 300 m is past the few hundred metres any
 * stop off a through road shares with itself at its own entrance, and far
 * below a spur worth a rider's notice.
 */
export const LOOP_SHARED_MIN_M = 300;

/**
 * How much longer a loop may make the stretch, per metre of shared road it
 * removes. 1: a loop may add as much as the one-way length of the spur it
 * replaces, i.e. ride at most 1.5x the out-and-back — for the 6 km spur, up to
 * 6 km more than riding in and out. Beyond that the loop is a detour the rider
 * did not ask for, and the out-and-back stays, said out loud.
 */
export const LOOP_EXTRA_PER_SHARED = 1;

/**
 * The least extra road a loop through a place may cost in edit mode, however
 * short the spur it replaces (rider, 2026-09-25: "if the only way is a dead
 * end, prefer looping"). With the bound at `LOOP_EXTRA_PER_SHARED` alone a
 * 300 m spur allowed a loop 300 m longer than the out-and-back — no way
 * round a Latvian forest block is — so short spurs were always kept. Edit
 * mode only: the generation's spur loops (`prune-spurs.ts`) keep their own
 * bound.
 */
export const LOOP_EXTRA_FLOOR_M = 1_500;

/**
 * The shared road between a place's way in and way out from which the edit
 * looks for a way through it (`routeThroughPlaces`). Below this is the few
 * metres two legs share at any place set a little off the road; above it is
 * a spur the rider would ride twice. Much lower than `LOOP_SHARED_MIN_M`
 * (which the generation keeps): the rider's stop 2 sat 250-600 m up a dead-end
 * track and edit mode never looked for a way round it.
 */
export const THROUGH_SHARED_MIN_M = 50;

/**
 * Where a place's spur begins on its way in: the index in `approach` of the
 * first vertex of the stretch the way out rides back along (0 when the whole
 * approach is shared, the approach's last index when nothing is). A shaping
 * point on a spur is moved there (`routeThroughPlaces`).
 */
export function spurBaseIndex(approach: Point[], departure: Point[]): number {
  const inD = new Set<string>();
  for (let i = 1; i < departure.length; i++) inD.add(pairKey(departure[i - 1], departure[i]));
  let k = approach.length - 1;
  while (k > 0 && inD.has(pairKey(approach[k - 1], approach[k]))) k--;
  return k;
}

/**
 * Every out-and-back on a line: a stretch ridden to a tip and straight back
 * along the same vertices. `apex` is the tip's index, `base` the index where
 * the way in and the way out part (both in `coordinates`), `meters` the
 * one-way length. The router never makes one inside a single leg — it is
 * always a via at the tip, or a cut — so on a routed stretch each one is a
 * place reached by a spur.
 */
export function outAndBacks(coordinates: Point[], minMeters = THROUGH_SHARED_MIN_M): { apex: number; base: number; meters: number }[] {
  // Vertices closer than a metre are one: a via snapped mid-edge comes back twice.
  const idx: number[] = [];
  for (let i = 0; i < coordinates.length; i++) {
    if (idx.length && haversineMeters(coordinates[idx[idx.length - 1]], coordinates[i]) < 1) continue;
    idx.push(i);
  }
  const pts = idx.map((i) => coordinates[i]);
  const cum = cumulative(pts);
  const out: { apex: number; base: number; meters: number }[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    let k = 0;
    while (i - k - 1 >= 0 && i + k + 1 < pts.length && haversineMeters(pts[i - k - 1], pts[i + k + 1]) < 3) k++;
    if (k === 0) continue;
    const meters = cum[i] - cum[i - k];
    if (meters >= minMeters) out.push({ apex: idx[i], base: idx[i - k], meters });
  }
  return out;
}

/** Undirected keys of a line's consecutive pairs, at `recomputeOverlap`'s ~1 m. */
function pairKey(p: Point, q: Point): string {
  const a = `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  const b = `${q[0].toFixed(5)},${q[1].toFixed(5)}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * The road two lines have in common, in metres of `b`, and where it is.
 *
 * The same measurement `recomputeOverlap` and `classify.ts` make — pairs of
 * consecutive vertices keyed at ~1 m with direction removed — applied between
 * two lines instead of within one, so "the way back is the way in" is judged
 * exactly the way the panel's retraced figure will judge it.
 */
export function sharedRoad(a: Point[], b: Point[]): { meters: number; points: Point[] } {
  const inA = new Set<string>();
  for (let i = 1; i < a.length; i++) inA.add(pairKey(a[i - 1], a[i]));
  let meters = 0;
  const points: Point[] = [];
  for (let i = 1; i < b.length; i++) {
    if (!inA.has(pairKey(b[i - 1], b[i]))) continue;
    meters += haversineMeters(b[i - 1], b[i]);
    points.push(b[i - 1], b[i]);
  }
  return { meters, points };
}

/**
 * No-go circles along a stretch of road, for BRouter to route around.
 *
 * One every `spacingM` along the shared road, `radiusM` wide — enough to cover
 * the carriageway without swallowing a parallel road a loop would take. None
 * within `clearM` of the points that must stay reachable (the stop itself,
 * the two joins): a stop at the end of a genuine dead end can then only be
 * left the way it was reached, the fenced request is refused, and the
 * out-and-back is known to be the only way rather than guessed to be.
 */
export function nogosAlong(
  points: Point[],
  keepClear: Point[],
  opts: {
    spacingM?: number; radiusM?: number; clearM?: number; maxCount?: number;
    /** A clearance per `keepClear` point, overriding `clearM` for it. */
    keepClearM?: number[];
  } = {},
): { lon: number; lat: number; radius: number }[] {
  const radius = opts.radiusM ?? 60;
  const clear = opts.clearM ?? 250;
  const max = opts.maxCount ?? MAX_NOGOS;
  const clearOf = (i: number) => opts.keepClearM?.[i] ?? clear;
  const place = (spacing: number) => {
    const out: { lon: number; lat: number; radius: number }[] = [];
    let last: Point | null = null;
    for (const p of points) {
      if (last && haversineMeters(last, p) < spacing * 0.95) continue;
      if (keepClear.some((k, i) => haversineMeters(k, p) < clearOf(i))) continue;
      out.push({ lon: p[0], lat: p[1], radius });
      last = p;
    }
    return out;
  };
  let spacing = opts.spacingM ?? 200;
  let out = place(spacing);
  // A long shared stretch gets its circles further apart rather than more of
  // them — see `MAX_NOGOS`. A circle every kilometre still stops the router
  // riding that road for more than a kilometre at a time.
  while (out.length > max) {
    spacing *= (out.length / max) * 1.05;
    out = place(spacing);
  }
  return out;
}

/**
 * The most no-go circles one fenced request carries. Each is ~34 characters
 * of URL once encoded; 80 is ~2.7 KB, well inside nginx's 8 KB request line.
 * Measured without a cap: a stop ~80 km off the line shared 95 km of road
 * with itself, 326 circles at 200 m made a URL the server refused with 414,
 * and that refusal read as "there is no other way".
 */
export const MAX_NOGOS = 80;

/** The two halves of a stop's stretch: in to the stop, and out of it. */
export type LegPair = {
  approach: { coordinates: Point[]; distanceMeters: number };
  departure: { coordinates: Point[]; distanceMeters: number };
};

/**
 * Which way through a stop to keep: the one that rides least of the same road
 * twice, as long as it is at most `LOOP_EXTRA_PER_SHARED` longer per metre of
 * shared road it saves. Ties go to the shorter. `index` is -1 when the plain
 * route stays — nothing better, or nothing within the bound — and
 * `sharedMeters` is what the kept pair still shares, which the page reports
 * as a dead end when it is over `LOOP_SHARED_MIN_M`.
 */
export function chooseLoop(base: LegPair, variants: (LegPair | null)[]): { index: number; pair: LegPair; sharedMeters: number } {
  const length = (p: LegPair) => p.approach.distanceMeters + p.departure.distanceMeters;
  const shared = (p: LegPair) => sharedRoad(p.approach.coordinates, p.departure.coordinates).meters;
  const baseShared = shared(base);
  let best = { index: -1, pair: base, sharedMeters: baseShared, length: length(base) };
  variants.forEach((v, index) => {
    if (!v) return;
    const s = shared(v);
    const saved = baseShared - s;
    if (saved <= 0) return;
    if (length(v) - length(base) > Math.max(LOOP_EXTRA_PER_SHARED * saved, LOOP_EXTRA_FLOOR_M)) return;
    if (s < best.sharedMeters || (s === best.sharedMeters && length(v) < best.length)) {
      best = { index, pair: v, sharedMeters: s, length: length(v) };
    }
  });
  return { index: best.index, pair: best.pair, sharedMeters: best.sharedMeters };
}

/**
 * How much of a line retraces roads it already used.
 *
 * The SAME measurement `classify.ts` makes — consecutive coordinate pairs,
 * keyed on their endpoints at ~1 m with direction removed — re-derived here
 * rather than imported because `classifyRoute` takes a whole `RoutePath` with
 * per-edge attributes, and an edited ride on the client has segments and
 * geometry but no edge table. Keeping the key format identical is what makes
 * the edited figure comparable with the API's: a ride edited and then left
 * alone reproduces the number the server reported, to rounding.
 *
 * **This is the honest half of an edit.** An incremental correction can raise
 * retracing — a stop dragged to the wrong side of a river is exactly the case —
 * and the rider's one rule is that he is never shown a ride whose repeated
 * figure has quietly stopped describing the line. So this runs on every edit
 * and the panel shows what it says, even when the answer is worse.
 */
export function recomputeOverlap(coordinates: Point[]): {
  repeatedKm: number;
  distinctKm: number;
  repeatedPercent: number;
} {
  let riddenKm = 0;
  let repeatedKm = 0;
  const seen = new Set<string>();
  const key = (p: Point) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

  for (let i = 1; i < coordinates.length; i++) {
    const km = haversineMeters(coordinates[i - 1], coordinates[i]) / 1000;
    riddenKm += km;
    const a = key(coordinates[i - 1]);
    const b = key(coordinates[i]);
    const undirected = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(undirected)) repeatedKm += km;
    else seen.add(undirected);
  }

  return {
    repeatedKm: Math.round(repeatedKm * 10) / 10,
    distinctKm: Math.round((riddenKm - repeatedKm) * 10) / 10,
    repeatedPercent: riddenKm > 0 ? Math.round((repeatedKm / riddenKm) * 100) : 0,
  };
}

type Features = GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[];
type Segments = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;

/**
 * The part of a segment collection between two distances along it.
 *
 * A segment cut in half is still the same road, so both halves keep its
 * surface, class and flags and only `distanceMeters` is recomputed — the same
 * rule `detour.ts` cuts by. Gates are kept only on the half that still holds
 * them: a gate is a point on the road, and counting it on both halves would
 * report two gates where the rider will meet one.
 */
export function segmentsBetween(features: Features, fromMeters: number, toMeters: number): Features {
  const out: Features = [];
  let walked = 0;
  for (const feature of features) {
    const coords = feature.geometry.coordinates as Point[];
    const own = lineMeters(coords);
    const start = walked;
    const endAt = walked + own;
    walked = endAt;
    if (endAt <= fromMeters || start >= toMeters) continue;
    if (start >= fromMeters && endAt <= toMeters) { out.push(feature); continue; }
    const cum = cumulative(coords);
    const piece = sliceBetween(coords, cum, Math.max(0, fromMeters - start), Math.min(own, toMeters - start));
    if (piece.length < 2) continue;
    const { gates, gatePoints, gateInfo, ...props } = feature.properties;
    const keptAt = (gatePoints ?? []).flatMap((g, i) => (piece.some((c) => haversineMeters(c, g) < 2) ? [i] : []));
    const kept = keptAt.map((i) => gatePoints![i]);
    const keptInfo = gateInfo ? keptAt.flatMap((i) => (gateInfo[i] ? [gateInfo[i]] : [])) : undefined;
    out.push({
      ...feature,
      geometry: { type: "LineString", coordinates: piece },
      properties: {
        ...props,
        ...(gates && kept.length
          ? { gates: kept.length, gatePoints: kept, ...(keptInfo?.length === kept.length ? { gateInfo: keptInfo } : {}) }
          : {}),
        distanceMeters: Math.round(lineMeters(piece)),
      },
    });
  }
  return out;
}

/** The coordinates of a segment collection, with the shared join vertices dropped. */
export function coordinatesOf(segments: Segments): Point[] {
  const coordinates: Point[] = [];
  for (const f of segments.features) {
    for (const c of f.geometry.coordinates as Point[]) {
      const last = coordinates[coordinates.length - 1];
      // Consecutive segments share their joining vertex; a duplicate shows up
      // in the GPX as a zero-length leg.
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      coordinates.push(c);
    }
  }
  return coordinates;
}

/** One routed replacement, as `/api/reroute-leg` returns it per run. */
export type RoutedRun = {
  segments: Segments;
  distanceMeters: number;
  durationSeconds: number;
};

/**
 * Put the routed replacements in place of the stretches they replace.
 *
 * Kept stretches take their share of the old ride's time weighted by how
 * fast each segment rides (`segmentSpeedKmh`) — there is no per-vertex
 * timing on the client, and a share by distance alone priced a thrown-away
 * trail spur at the ride's average, so adding one and removing it again left
 * the ride slower than it began. The weights only apportion the ride's own
 * total, so the kept part stays consistent with the headline it came from.
 * The routed stretches bring their own time from the server's speed model.
 * Kept distance is scaled by the ride's own ratio of reported to drawn
 * length, so a ride edited and left alone keeps its headline kilometres.
 */
export function applyRuns(params: {
  segments: Segments;
  distanceMeters: number;
  durationSeconds: number;
  /** With its points when the caller has them: the places inside a run bound `retraceAtJoins`. */
  runs: { fromMeters: number; toMeters: number; points?: Point[] }[];
  routed: RoutedRun[];
  /**
   * The places on the kept line (the ride's places before the edit). A join
   * never slides past one (`retraceAtJoins`): the kept line must still reach it.
   */
  keep?: Point[];
}): {
  coordinates: Point[]; segments: Segments; distanceMeters: number; durationSeconds: number; runs: { fromMeters: number; toMeters: number }[];
  /** Per run: metres ridden out along the kept ride and back at a cut that is a place (`retraceAtJoins`). */
  blocked: { head: number; tail: number }[];
} {
  const features = params.segments.features as Features;
  const line = coordinatesOf(params.segments);
  const lineCum = cumulative(line);
  // Cut where each routed stretch really meets the kept ride (`meetRuns`),
  // then past any road it rode out to the cut and back on (`retraceAtJoins`).
  const met = meetRuns(line, lineCum, params.runs, params.routed);
  const joined = retraceAtJoins({
    line,
    cum: lineCum,
    runs: met.map((r, i) => ({ ...r, points: params.runs[i].points })),
    routed: params.routed,
    keep: params.keep ?? [],
  });
  const runs = joined.map(({ fromMeters, toMeters }) => ({ fromMeters, toMeters }));
  const drawn = lineMeters(line) || 1;
  const perMeter = params.distanceMeters / drawn;
  // Seconds per unit of "riding weight": metres over each segment's speed.
  const weightOf = (fs: Features) => fs.reduce((sum, f) => sum + lineMeters(f.geometry.coordinates as Point[]) / segmentSpeedKmh(f.properties), 0);
  const totalWeight = weightOf(features) || 1;
  const secondsPerWeight = params.durationSeconds / totalWeight;
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);

  const out: Features = [];
  let cursor = 0;
  let meters = 0;
  let seconds = 0;
  const keep = (from: number, to: number) => {
    const kept = segmentsBetween(features, from, to);
    out.push(...kept);
    meters += Math.max(0, Math.min(to, drawn) - from) * perMeter;
    seconds += weightOf(kept) * secondsPerWeight;
  };
  for (const run of order) {
    keep(cursor, run.fromMeters);
    const routed = params.routed[run.i];
    const { headMeters, tailMeters } = joined[run.i];
    if (headMeters > 0 || tailMeters > 0) {
      // The routed stretch without the road it rode out to its cut and back
      // on: its own time and distance shrink in proportion to what is left.
      const own = routed.segments.features as Features;
      const drawnRun = own.reduce((sum, f) => sum + lineMeters(f.geometry.coordinates as Point[]), 0) || 1;
      const piece = segmentsBetween(own, headMeters, drawnRun - tailMeters);
      const share = Math.max(0, drawnRun - headMeters - tailMeters) / drawnRun;
      out.push(...piece);
      meters += routed.distanceMeters * share;
      seconds += routed.durationSeconds * share;
    } else {
      out.push(...(routed.segments.features as Features));
      meters += routed.distanceMeters;
      seconds += routed.durationSeconds;
    }
    cursor = run.toMeters;
  }
  keep(cursor, drawn + 1);

  const segments: Segments = { type: "FeatureCollection", features: out };
  return {
    coordinates: coordinatesOf(segments),
    segments,
    distanceMeters: Math.round(meters),
    durationSeconds: Math.round(seconds),
    runs,
    blocked: joined.map((j) => ({ head: j.blockedHead, tail: j.blockedTail })),
  };
}

/**
 * The stretches again, each one that came back as an out-and-back from a
 * place it was cut at now taken THROUGH that place and `THROUGH_NEIGHBOUR_M`
 * beyond it — or null when no stretch needs it.
 *
 * A window stops at the places either side of an edit (`planEdit`), which is
 * right when the new line meets the kept ride there going on. Measured on
 * Antiņciems → Puķes (2026-09-28): a bend 3 km after the stop Puķes came
 * back leaving Puķes the way the kept ride arrived, 435-502 m, and back — a
 * stop the rider had ridden through became the tip of a spur, silently.
 * Taken into the stretch, the place is ridden through like any other
 * (`routeThroughPlaces` fences its way in off its way out).
 */
export function throughBlockedPlaces(params: {
  line: Point[];
  cum: number[];
  before: RidePlaces;
  runs: EditRun[];
  blocked: { head: number; tail: number }[];
}): EditRun[] | null {
  const { line, cum, before, runs, blocked } = params;
  if (!blocked.some((b) => b.head > 0 || b.tail > 0)) return null;
  const oldA = anchorsOf(before, line[line.length - 1]);
  const along = anchorsAlong(oldA, line, cum);
  const isVia = (k: number) => k > 0 && k < oldA.length - 1;
  const at = (m: number): Point => pointAtDistance(line, cum, m).point;
  const placeAt = (m: number) => along.findIndex((a, k) => isVia(k) && Math.abs(a - m) <= 30);
  const sorted = runs.map((r) => r.fromMeters).sort((a, b) => a - b);
  let changed = false;
  const out = runs.map((run, i) => {
    let { fromMeters, toMeters, points } = run;
    const next = sorted.find((f) => f > run.fromMeters + 1) ?? Infinity;
    const prev = runs.filter((r) => r.toMeters <= run.fromMeters + 1).reduce((m, r) => Math.max(m, r.toMeters), 0);
    if (blocked[i]?.tail > 0) {
      const k = placeAt(toMeters);
      if (k > 0) {
        toMeters = Math.min(along[k + 1], along[k] + THROUGH_NEIGHBOUR_M, next);
        points = [...points.slice(0, -1), oldA[k], at(toMeters)];
        changed = true;
      }
    }
    if (blocked[i]?.head > 0) {
      const k = placeAt(fromMeters);
      if (k > 0) {
        fromMeters = Math.max(along[k - 1], along[k] - THROUGH_NEIGHBOUR_M, prev);
        points = [at(fromMeters), oldA[k], ...points.slice(1)];
        changed = true;
      }
    }
    return { fromMeters, toMeters, points };
  });
  return changed ? out : null;
}

/**
 * How far off the kept line a routed stretch's end may lie and still count
 * as on it: the router's own nodes on the road the kept ride rides, to
 * rounding. A parallel road is further off than this.
 */
export const MEETS_LINE_M = 10;

/** How far along the kept line a cut may move to where its stretch really begins or ends. */
export const MEET_SHIFT_MAX_M = 1_000;

/** The nearest point of `line` to `target` between `from` and `to` metres along it. */
export function nearestWithin(target: Point, line: Point[], cum: number[], from: number, to: number): { meters: number; alongMeters: number } {
  let best = { meters: Infinity, alongMeters: from };
  const cosLat = Math.cos((target[1] * Math.PI) / 180) || 1;
  const M = 111_320;
  for (let i = 0; i < line.length - 1; i++) {
    const span = cum[i + 1] - cum[i];
    if (cum[i + 1] < from || cum[i] > to || span <= 0) continue;
    const [a, b] = [line[i], line[i + 1]];
    const ax = a[0] * cosLat * M, ay = a[1] * M, dx = (b[0] - a[0]) * cosLat * M, dy = (b[1] - a[1]) * M;
    const px = target[0] * cosLat * M, py = target[1] * M;
    let t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
    t = Math.max((from - cum[i]) / span, Math.min((to - cum[i]) / span, t));
    const meters = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (meters < best.meters) best = { meters, alongMeters: cum[i] + t * span };
  }
  return best;
}

/**
 * Where each routed stretch really meets the kept ride, as the stretch of the
 * old line it replaces.
 *
 * BRouter begins a route at a node of the road, not at the point it was
 * asked to start from. A cut in the middle of a long straight edge — 325 m
 * between nodes, measured on Mālpils → Mūrnieki → Allaži (2026-09-28) — came
 * back starting at the next node, 82 m further along the very road the kept
 * ride rides; spliced at the cut, that drew an 82 m hole and the edit was
 * refused as a line that could not be joined. The stretch did meet the kept
 * ride, only not at the cut. So each cut moves along the old line to where
 * its stretch's end lies ON it (within `MEETS_LINE_M`): no further than
 * `MEET_SHIFT_MAX_M`, never past a neighbouring stretch or its own other end.
 * An end that is off the line keeps its cut, and its gap stays a gap for
 * `spliceIsSound` to refuse. The ride's own ends (0 and the full length) never
 * move: a stretch there reaches a moved start or finish, not the kept ride.
 */
export function meetRuns(
  line: Point[],
  cum: number[],
  runs: { fromMeters: number; toMeters: number }[],
  routed: RoutedRun[],
): { fromMeters: number; toMeters: number }[] {
  const total = cum[cum.length - 1] ?? 0;
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);
  const out = runs.map((r) => ({ fromMeters: r.fromMeters, toMeters: r.toMeters }));
  let floor = 0;
  order.forEach((run, k) => {
    const coords = coordinatesOf(routed[run.i]?.segments ?? { type: "FeatureCollection", features: [] });
    const ceiling = order[k + 1]?.fromMeters ?? total;
    let from = run.fromMeters, to = run.toMeters;
    // A stretch spliced in at one spot (`straightRun`) starts and ends there.
    if (from === to) { out[run.i] = { fromMeters: from, toMeters: to }; floor = to; return; }
    if (coords.length >= 2 && from > 0) {
      const m = nearestWithin(coords[0], line, cum, Math.max(floor, from - MEET_SHIFT_MAX_M), Math.min(to - 1, from + MEET_SHIFT_MAX_M));
      if (m.meters <= MEETS_LINE_M) from = m.alongMeters;
    }
    if (coords.length >= 2 && to < total) {
      const m = nearestWithin(coords[coords.length - 1], line, cum, Math.max(from + 1, to - MEET_SHIFT_MAX_M), Math.min(ceiling, to + MEET_SHIFT_MAX_M));
      if (m.meters <= MEETS_LINE_M) to = m.alongMeters;
    }
    out[run.i] = { fromMeters: from, toMeters: to };
    floor = to;
  });
  return out;
}

/**
 * How far a join may slide to take a retrace off the line, and how exactly the
 * two lines must agree to count as the same road ridden twice.
 */
export const RETRACE_STEP_M = 5;
export const RETRACE_TOL_M = 8;
/** Below this a "retrace" at a join is the router's own node rounding, not a stub. */
export const RETRACE_MIN_M = 25;

/**
 * Where a routed stretch rides out along the kept ride to its cut and back —
 * and the joins moved so that it does not.
 *
 * The rider's ride of 2026-09-28 (Antiņciems → Puķes, bent near Gailīšu
 * purvs): a 1.17 km stub up a forest track, ridden out and back, with no
 * place at its tip. The tip was a CUT: the edit window ended 3 km from the
 * bend, on the old line, which came down that track from the north. The new
 * stretch no longer wanted the track — it reached the old line at the
 * junction below — but its end was pinned to the cut, so the router rode up
 * the track to it, and the kept ride rode back down. A cut is not a place:
 * nothing asked for the tip. So where the end of a routed stretch and the
 * kept ride beyond its cut are the same road in opposite directions, both are
 * cut back to where they part, and the stretch joins the kept ride there —
 * the junction the router actually came to.
 *
 * Bounded both ways: never past a place inside the stretch (the run's own
 * points), never past a place on the kept ride (`keep`), never into another
 * stretch, and never past the ride's own ends. A cut AT a place (a window
 * that stops on a stop) does not slide at all — the place must still be
 * reached — and the retrace there is reported as `blocked`: the place has
 * become the tip of a spur, and the page routes the stretch again through it
 * (`throughBlockedPlaces`).
 */
export function retraceAtJoins(params: {
  line: Point[];
  cum: number[];
  runs: { fromMeters: number; toMeters: number; points?: Point[] }[];
  routed: RoutedRun[];
  keep: Point[];
}): { fromMeters: number; toMeters: number; headMeters: number; tailMeters: number; blockedHead: number; blockedTail: number }[] {
  const { line, cum, runs, routed } = params;
  const total = cum[cum.length - 1] ?? 0;
  const keptAlong = params.keep
    .map((p) => nearestAlong(p, line, cum))
    .filter((n) => n.meters <= 30)
    .map((n) => n.alongMeters);
  const order = runs.map((r, i) => ({ ...r, i })).sort((a, b) => a.fromMeters - b.fromMeters);
  const out = runs.map((r) => ({ fromMeters: r.fromMeters, toMeters: r.toMeters, headMeters: 0, tailMeters: 0, blockedHead: 0, blockedTail: 0 }));
  order.forEach((run, k) => {
    const coords = coordinatesOf(routed[run.i]?.segments ?? { type: "FeatureCollection", features: [] });
    if (coords.length < 2) return;
    const rc = cumulative(coords);
    const length = rc[rc.length - 1];
    // The places inside the stretch, as distances along what was routed.
    const inner = (run.points ?? []).slice(1, -1).map((p) => nearestAlong(p, coords, rc).alongMeters);
    const firstInner = inner.length ? Math.min(...inner) : length / 2;
    const lastInner = inner.length ? Math.max(...inner) : length / 2;
    const floor = k > 0 ? out[order[k - 1].i].toMeters : 0;
    const ceiling = order[k + 1]?.fromMeters ?? total;
    const walk = (runAt: (s: number) => number, lineAt: (s: number) => number, max: number, lineFrom: number, lineTo: number) => {
      let good = 0;
      for (let s = RETRACE_STEP_M; s <= max; s += RETRACE_STEP_M) {
        const p = pointAtDistance(coords, rc, runAt(s)).point;
        const m = nearestWithin(p, line, cum, lineFrom, lineTo);
        if (m.meters > RETRACE_TOL_M || Math.abs(m.alongMeters - lineAt(s)) > RETRACE_TOL_M * 2) break;
        good = s;
      }
      return good >= RETRACE_MIN_M ? good : 0;
    };
    const blocks = (from: number, to: number) => keptAlong.some((a) => a >= from - 1 && a <= to + 1);
    // The tail: the stretch's last metres against the kept ride after its cut.
    const to = run.toMeters;
    if (to < total) {
      const room = Math.min(length - lastInner, ceiling - to);
      const s = walk((d) => length - d, (d) => to + d, room, to, Math.min(ceiling, to + room + 30));
      if (s && blocks(to, to + s)) out[run.i] = { ...out[run.i], blockedTail: s };
      else if (s) out[run.i] = { ...out[run.i], toMeters: to + s, tailMeters: s };
    }
    // The head: the stretch's first metres against the kept ride before its cut.
    const from = run.fromMeters;
    if (from > 0) {
      const room = Math.min(firstInner, from - floor, length - out[run.i].tailMeters - RETRACE_MIN_M);
      const s = walk((d) => d, (d) => from - d, room, Math.max(floor, from - room - 30), from);
      if (s && blocks(from - s, from)) out[run.i] = { ...out[run.i], blockedHead: s };
      else if (s) out[run.i] = { ...out[run.i], fromMeters: from - s, headMeters: s };
    }
  });
  return out;
}

/**
 * The widest gap an edited line may have between one segment's end and the
 * next one's start. A router's line is continuous by construction; a splice
 * is continuous only if each routed stretch starts and ends where the kept
 * ride was cut. BRouter meets the cut within a few metres (it snaps to the
 * same way the old line rode); anything past this is a stretch that started
 * somewhere else — a nudged or snapped endpoint — and draws as a gap and a
 * stray stub.
 */
export const JOIN_GAP_M = 30;

/**
 * Where a line breaks: consecutive segments whose ends are more than
 * `JOIN_GAP_M` apart. A break the original ride already had (the same pair
 * of points) is not counted — the edit did not make it.
 */
export function lineBreaks(segments: Segments, original?: Segments): { index: number; meters: number }[] {
  const key = (a: Point, b: Point) => `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  const known = new Set<string>();
  if (original) {
    const of = original.features;
    for (let i = 1; i < of.length; i++) {
      const a = (of[i - 1].geometry.coordinates as Point[]).at(-1)!, b = (of[i].geometry.coordinates as Point[])[0];
      if (haversineMeters(a, b) > JOIN_GAP_M) known.add(key(a, b));
    }
  }
  const out: { index: number; meters: number }[] = [];
  const fs = segments.features;
  for (let i = 1; i < fs.length; i++) {
    const a = (fs[i - 1].geometry.coordinates as Point[]).at(-1), b = (fs[i].geometry.coordinates as Point[])[0];
    if (!a || !b) continue;
    const meters = haversineMeters(a, b);
    if (meters > JOIN_GAP_M && !known.has(key(a, b))) out.push({ index: i, meters: Math.round(meters) });
  }
  return out;
}

/**
 * The one rule an edited ride must keep (rider, 2026-09-25: a line with a
 * gap between two stops and an orphan stub is not a ride): it is one
 * continuous line (`lineBreaks`), and it passes every place in order within
 * `toleranceMeters`. The page shows an edit only when this holds.
 *
 * Places means stops: a shaping point is not visited, it is ridden past
 * wherever the router reached, and `snapToLine` puts it there — so it is
 * held to the continuous line and to nothing else.
 *
 * With `before`, a refusal says whether it was only the edit's own places
 * that the line did not reach (`offRoadMeters`: the line is one piece and
 * passes every kept place, and a place the edit added or moved is that far
 * from it). That is not a line that could not be joined: it is a pin in a
 * field, or a sight on a lake shore, further from any road this profile
 * rides than the edit may move it — and the rider must hear that, with the
 * distance, so he moves the pin rather than trying again (measured
 * 2026-09-28: a stop tapped 1 km off Kaņieris → Ragaciems was refused as
 * „neizdevās savienot … vienā līnijā”).
 */
export function spliceIsSound(params: {
  segments: Segments;
  original: Segments;
  places: RidePlaces;
  toleranceMeters: number;
  before?: RidePlaces;
}): { ok: true } | { ok: false; breaks: { index: number; meters: number }[]; missesPlaces: boolean; offRoadMeters?: number } {
  const breaks = lineBreaks(params.segments, params.original);
  const line = coordinatesOf(params.segments);
  const end = line[line.length - 1] ?? [0, 0];
  const places = anchorsOf({ ...params.places, vias: stopsOf(params.places) }, end);
  const missesPlaces = line.length < 2 || !visitsRequiredStops(line, places, params.toleranceMeters);
  if (!breaks.length && !missesPlaces) return { ok: true };
  const { before } = params;
  if (breaks.length || line.length < 2 || !before) return { ok: false, breaks, missesPlaces };
  // Which places the edit kept, and whether the line still rides through them all, in order.
  const known = [before.start, ...before.vias, ...(before.finish ? [before.finish] : [])];
  const kept = (p: RidePlace) => known.some((b) => same(b, p));
  const { start, finish, roundTrip } = params.places;
  const ends = [start, ...stopsOf(params.places), ...(roundTrip ? [start] : finish ? [finish] : [])];
  const keptOnly = anchorsOf({ ...params.places, vias: stopsOf(params.places).filter(kept) }, end)
    .filter((_, k, all) => k === 0 ? kept(start) : k === all.length - 1 ? (roundTrip ? kept(start) : finish ? kept(finish) : true) : true);
  if (!visitsRequiredStops(line, keptOnly, params.toleranceMeters)) return { ok: false, breaks, missesPlaces };
  const cum = cumulative(line);
  const far = Math.max(0, ...ends.filter((p) => !kept(p)).map((p) => nearestAlong(toPoint(p), line, cum).meters));
  return far > params.toleranceMeters ? { ok: false, breaks, missesPlaces, offRoadMeters: Math.round(far) } : { ok: false, breaks, missesPlaces };
}

/**
 * A place still reached by a spur of at least this much, when the router did
 * not prove it a dead end, is worth a wider stretch (`widenRun`).
 */
export const WIDEN_MIN_SPUR_M = 1_000;

/**
 * How much further each way the stretch is tried, in parallel. Measured on
 * the rider's Lauriņi → Ērgļi (2026-09-28): a pass-through point moved across
 * the Ogre onto a junction of a through road. The ±3 km window around where
 * it was cut the ride at two points on the WEST bank, so from the junction
 * the only way to the second cut was back up the east bank — 9.8 km ridden
 * twice and called a dead end. +5 km still turned back (7.5 km); +15 km rode
 * through the junction and on to the ride further along, 141.5 km and no
 * spur, against 149.5 km with the out-and-back.
 */
export const WIDEN_STEPS_M = [5_000, 15_000];

/**
 * The same stretch `by` metres wider each way along the line, never past a
 * kept place (`keptAlong`: the ride's anchors along the line) or into a drawn
 * straight stretch (`fixed`) — so the place in it can be ridden through and
 * on, where the window was too tight for any way on but the way in. An end
 * that is not a cut on the line (a moved start or finish) stays. Null when
 * neither end can move.
 */
export function widenRun(p: { run: EditRun; line: Point[]; cum: number[]; keptAlong: number[]; fixed?: [number, number][]; by: number }): EditRun | null {
  const { run, line, cum, by } = p;
  const total = cum[cum.length - 1];
  const at = (m: number): Point => pointAtDistance(line, cum, m).point;
  const onLine = (pt: Point, m: number) => haversineMeters(pt, at(m)) <= 1;
  let lo = 0, hi = total;
  for (const a of p.keptAlong) {
    if (a <= run.fromMeters + 1) lo = Math.max(lo, a);
    if (a >= run.toMeters - 1) hi = Math.min(hi, a);
  }
  for (const [a, b] of p.fixed ?? []) {
    if (b <= run.fromMeters + 1) lo = Math.max(lo, b);
    if (a >= run.toMeters - 1) hi = Math.min(hi, a);
  }
  const first = run.points[0], last = run.points[run.points.length - 1];
  const from = onLine(first, run.fromMeters) ? Math.max(lo, run.fromMeters - by) : run.fromMeters;
  const to = onLine(last, run.toMeters) ? Math.min(hi, run.toMeters + by) : run.toMeters;
  if (from >= run.fromMeters - 1 && to <= run.toMeters + 1) return null;
  return {
    fromMeters: from,
    toMeters: to,
    points: [from < run.fromMeters ? at(from) : first, ...run.points.slice(1, -1), to > run.toMeters ? at(to) : last],
  };
}

/**
 * The fallback when a splice breaks: the whole stretch from the last place
 * before the first changed run to the first place after the last one, as ONE
 * run through every place the edit left between them — cut at those places'
 * own points on the old line, so it meets the kept ride exactly where a
 * place already is. One request, no windows to disagree with each other.
 */
export function spanRun(params: {
  line: Point[];
  cum: number[];
  before: RidePlaces;
  after: RidePlaces;
  runs: EditRun[];
}): EditRun {
  const { line, cum, before, after, runs } = params;
  const end = line[line.length - 1];
  const oldA = anchorsOf(before, end);
  const along = anchorsAlong(oldA, line, cum);
  const total = cum[cum.length - 1];
  const from = Math.min(...runs.map((r) => r.fromMeters));
  const to = Math.max(...runs.map((r) => r.toMeters));
  let p = 0;
  for (let k = 0; k < along.length; k++) if (along[k] <= from + 1) p = k;
  let q = along.length - 1;
  for (let k = along.length - 1; k >= 0; k--) if (along[k] >= to - 1) q = k;
  const newA = anchorsOf(after, end);
  const same = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1];
  // The kept places at either end of the span, found in the new list by
  // their coordinates; an end that moved (a new start or finish) is the new
  // list's own end.
  const ip = newA.findIndex((a) => same(a, oldA[p]));
  let iq = -1;
  for (let k = newA.length - 1; k >= 0; k--) if (same(newA[k], oldA[q])) { iq = k; break; }
  const startIdx = ip >= 0 ? ip : 0;
  const endIdx = iq >= 0 && iq > startIdx ? iq : newA.length - 1;
  const at = (m: number): Point => pointAtDistance(line, cum, m).point;
  const fromMeters = ip >= 0 ? along[p] : 0;
  const toMeters = iq >= 0 && iq > startIdx ? along[q] : total;
  const points: Point[] = [
    ip >= 0 ? at(fromMeters) : newA[0],
    ...newA.slice(startIdx + 1, endIdx),
    iq >= 0 && iq > startIdx ? at(toMeters) : newA[newA.length - 1],
  ];
  return { fromMeters, toMeters, points };
}

/**
 * The place a removal takes out, and the kept places either side of it — the
 * two the merged leg has to join (rider, 2026-09-29: „Izņemt” on a stop by
 * the Rīga–Ērgļi road was refused as a line that could not be joined, with
 * roads all round). `named` are the nearest places either side that have a
 * name — the start, a stop, the finish — for saying which stretch it is: a
 * pass-through point has none of its own. Null when `after` is not `before`
 * with one via less. A round trip's last neighbour is its start; a one-way
 * ride with no finish has none (`to` null).
 */
export function removedNeighbours(before: RidePlaces, after: RidePlaces): {
  gone: RidePlace; from: RidePlace; to: RidePlace | null; named: { from: RidePlace; to: RidePlace | null };
} | null {
  if (after.vias.length !== before.vias.length - 1) return null;
  const i = before.vias.findIndex((v, k) => !after.vias[k] || !same(v, after.vias[k]));
  if (i < 0 || !before.vias.filter((_, k) => k !== i).every((v, k) => same(v, after.vias[k]))) return null;
  const list: (RidePlace | null)[] = [before.start, ...before.vias, before.roundTrip ? before.start : before.finish];
  let a = i, b = i + 2;
  while (a > 0 && list[a] && isShape(list[a]!)) a--;
  while (b < list.length - 1 && list[b] && isShape(list[b]!)) b++;
  return { gone: before.vias[i], from: list[i]!, to: list[i + 2] ?? null, named: { from: list[a]!, to: list[b] ?? null } };
}

/**
 * The places at the two ends of a span (`spanRun`): the kept places the
 * whole stretch is re-routed between, for saying which stretch it is. Null
 * for an end that is no place — the drawn line's own end on a one-way ride
 * with no finish.
 */
export function spanEnds(params: { line: Point[]; cum: number[]; before: RidePlaces; span: { fromMeters: number; toMeters: number } }): { from: RidePlace | null; to: RidePlace | null } {
  const { line, cum, before, span } = params;
  const along = anchorsAlong(anchorsOf(before, line[line.length - 1]), line, cum);
  const list: (RidePlace | null)[] = [before.start, ...before.vias, before.roundTrip ? before.start : before.finish];
  const first = along.findIndex((m) => Math.abs(m - span.fromMeters) <= 1);
  let last = -1;
  along.forEach((m, k) => { if (Math.abs(m - span.toMeters) <= 1) last = k; });
  return { from: first >= 0 ? list[first] ?? null : null, to: last >= 0 ? list[last] ?? null : null };
}

/**
 * The ride's road classes, surfaces and flagged kilometres, from its segments.
 *
 * On the same denominator `classify.ts` uses — the sum of the segments' own
 * lengths — so a ride with no edit reproduces the API's figures to within
 * rounding, and an edited one describes the line on the map rather than the
 * line it replaced. Gates are counted only where the original ride measured
 * them at all: `undefined` means "not measured" and must stay that way.
 */
export function summariseSegments(segments: Segments, gatesMeasured: boolean): {
  roadMix: RouteMix;
  surfaces: SurfaceMix;
  unverifiedPathKm: number;
  gateCount: number | undefined;
  /** Drawn straight, no road (`drawn`): not in the road mix, said on its own. */
  drawnKm: number;
} {
  const by = { road: 0, track: 0, trail: 0 };
  let unverified = 0;
  let gates = 0;
  let drawn = 0;
  for (const f of segments.features) {
    const m = f.properties.distanceMeters;
    if (f.properties.drawn) { drawn += m; continue; }
    by[f.properties.roadClass] += m;
    if (f.properties.unverified) unverified += m;
    gates += f.properties.gates ?? 0;
  }
  const total = by.road + by.track + by.trail || 1;
  const pct = (m: number) => Math.round((m / total) * 100);
  const km = (m: number) => Math.round(m / 100) / 10;
  return {
    roadMix: {
      roadPercent: pct(by.road), trackPercent: pct(by.track), trailPercent: pct(by.trail),
      roadKm: km(by.road), trackKm: km(by.track), trailKm: km(by.trail),
    },
    surfaces: splicedSurfaces(segments),
    unverifiedPathKm: km(unverified),
    gateCount: gatesMeasured ? gates : undefined,
    drawnKm: km(drawn),
  };
}

/**
 * A ride the rider has changed: ticked sights kept without a search, or a
 * place moved, added or taken out on the map.
 *
 * Its own type rather than a `GeneratedRoute` with fields overwritten, because
 * the two are different claims and the panel has to be able to tell them
 * apart. Everything the panel, the map, the GPX and the share code need is
 * here — the drawn geometry, the segments that colour it, the numbers that
 * describe it, recomputed rather than inherited — and nothing that would let
 * it pass as a search result.
 *
 * `places` is what makes an edit survive the page: they are written back into
 * the plan, so sharing, saving, the GPX and a later full search all carry the
 * places the rider chose. An edit that only changed the picture would be lost
 * the moment he pressed Saglabāt.
 */
export type EditedRide = {
  coordinates: Point[];
  segments: Segments;
  distanceMeters: number;
  durationSeconds: number;
  overlap: ReturnType<typeof recomputeOverlap>;
  summary: ReturnType<typeof summariseSegments>;
  places: RidePlaces;
  /**
   * `commit` — ticked sights kept without a search: the line is the API's with
   * real routed detours spliced in, which is accepting Mopik's offer, not
   * correcting it. `edit` — the rider moved, added or removed a place. Only an
   * `edit` earns the "Labots ar roku" kicker.
   */
  kind: "commit" | "edit";
  /**
   * Which edit made it, for the undo's analytics: an `EditKind`, "sights",
   * "promote" — a shaping point made a stop — or "demote" — a stop made a
   * pass-through point; neither of the last two changes the line.
   */
  how: EditKind | "sights" | "promote" | "demote";
};

/**
 * The edited ride in the shape every consumer of a ride already reads.
 *
 * The panel, the share code, a save and the GPX all take a `GeneratedRoute`,
 * and each of them must describe the line on the map — a share link that
 * carried the ride as it was before the edit would be the one place the edit
 * was silently dropped. So the edit is handed to them as one: the geometry,
 * segments and every number recomputed from them, and the rest (name, variant,
 * profile) the ride's own. Two things are deliberately not carried over, because
 * they were measured on the old line and cannot be re-measured on the client:
 * the TET slice, and the landscape figures — the panel hides those for an
 * edited ride rather than show numbers about a line that is gone.
 *
 * The id changes with the line, so anything keyed on the ride (the sights
 * near it, the detours to them) is asked again for the line that is drawn.
 */
export function asGeneratedRoute(route: GeneratedRoute, edited: EditedRide): GeneratedRoute {
  return {
    ...route,
    id: `${route.id}~${edited.distanceMeters}-${edited.coordinates.length}`,
    geometry: { type: "LineString", coordinates: edited.coordinates },
    segments: edited.segments,
    distanceMeters: edited.distanceMeters,
    durationSeconds: edited.durationSeconds,
    roadMix: edited.summary.roadMix,
    surfaces: edited.summary.surfaces,
    overlap: edited.overlap,
    quality: { ...route.quality, unverifiedPathKm: edited.summary.unverifiedPathKm, gateCount: edited.summary.gateCount },
    tet: undefined,
  };
}

/**
 * Stops added to a ride, each placed where the line reaches it.
 *
 * The rider's existing stops keep their order; each new one goes between the
 * two places the line passes it between. Ticked sights come back in the order
 * their detours leave the ride, which is usually that order already — this
 * makes it so, because the list becomes the plan's vias and a later search
 * plans through them in the order given.
 */
export function insertStopsByAlong(line: Point[], places: RidePlaces, added: RidePlace[]): RidePlaces {
  const cum = cumulative(line);
  let vias = [...places.vias];
  for (const stop of added) {
    const along = anchorsAlong(anchorsOf({ ...places, vias }, line[line.length - 1]), line, cum);
    const at = nearestAlong(toPoint(stop), line, cum).alongMeters;
    let slot = 0;
    while (slot < vias.length && along[slot + 1] <= at) slot++;
    vias = [...vias.slice(0, slot), stop, ...vias.slice(slot)];
  }
  // The cap counts stops; the shaping points all stay.
  let room = MAX_STOPS;
  return { ...places, vias: vias.filter((v) => isShape(v) || room-- > 0) };
}

/**
 * One step of undo.
 *
 * The rider asked for exactly one — a bad edit is one tap from reverting — and
 * a stack would raise the question of what "undo" means after a share, a save
 * or a new generation. The previous *whole ride* is kept, not an inverse
 * operation: an inverse would have to re-route what it restores, and a
 * re-route can come back different. A copy cannot. `null` for `previous` is
 * meaningful — it is the ride the API returned.
 */
/**
 * The edited ride and the rides before it — `past` is a stack, newest last,
 * `null` standing for the API's own ride (2026-09-25: one undo stack, ~20
 * steps, where there used to be one step). `previous` is the top of it.
 */
export type EditHistory = { current: EditedRide | null; past: (EditedRide | null)[]; previous: EditedRide | null; canUndo: boolean };

export const NO_EDITS: EditHistory = { current: null, past: [], previous: null, canUndo: false };

const EDIT_UNDO_DEPTH = 20;

function history(current: EditedRide | null, past: (EditedRide | null)[]): EditHistory {
  return { current, past, previous: past.length ? past[past.length - 1] : null, canUndo: past.length > 0 };
}

export function pushEdit(h: EditHistory, next: EditedRide): EditHistory {
  return history(next, [...h.past, h.current].slice(-EDIT_UNDO_DEPTH));
}

export function undoEdit(h: EditHistory): EditHistory {
  if (!h.canUndo) return h;
  return history(h.past[h.past.length - 1], h.past.slice(0, -1));
}

/**
 * The plan with the edit's places written into it, so the share code, a save
 * and "Meklēt labāku apli" all describe the ride on the map. The plan carries
 * `MAX_STOPS` stops at most; the form's cap is the same, so nothing is dropped
 * that the form could have added.
 *
 * The stops are the plan's names; the shaping points its `shapePoints`, each
 * with the place it follows. None means no key at all — a plan without them
 * must encode to the very code it always did (`encodePlanShare`, `rideId`).
 */
export function planWithPlaces(plan: RidePlan, places: RidePlaces): RidePlan {
  const { shapePoints: _was, ...rest } = plan;
  void _was;
  const shapes = shapePointsOf(places).slice(0, MAX_SHAPE_POINTS);
  return {
    ...rest,
    ...(shapes.length ? { shapePoints: shapes } : {}),
    startPlace: places.start.name,
    viaPlaces: stopsOf(places).slice(0, MAX_STOPS).map((v) => v.name),
    ...(places.roundTrip ? {} : places.finish
      ? { destinationPlace: places.finish.name, destinationAny: false }
      : {}),
  };
}

/**
 * The ride's places in riding order, as the share code and the API carry them
 * — stops only: a shaping point is not a place (it travels in the plan's
 * `shapePoints`), so it is never a waypoint in the GPX or a row reopened.
 */
export function resolvedOf(places: RidePlaces): ResolvedPlace[] {
  return [places.start, ...stopsOf(places), ...(places.finish ? [places.finish] : [])];
}

/**
 * A generated ride's places, as the form's rows will show them.
 *
 * The names are the plan's own where the plan and the routed places line up —
 * "Cēsis" rather than "Cēsis, Cēsu novads" — and the router's labels where
 * they do not. The coordinates are always the routed ones: they are what the
 * line was built through.
 */
export function placesFromRide(params: {
  plan: RidePlan;
  start: { lat: number; lon: number; label: string };
  via: { lat: number; lon: number; label: string }[];
  destination: { lat: number; lon: number; label: string } | null;
  /** places picked in the form, for the POI kind a sight was added with */
  picked: ResolvedPlace[];
}): RidePlaces {
  const { plan, picked } = params;
  // The POI category a stop was added with, if it came from a suggestion:
  // the router's label is the geocoder's full string ("Gūtmaņa ala, Siguldas
  // novads") while the picked place carries the bare name the rider ticked,
  // so the leading segment is compared. Only ticked places carry a kind, so a
  // typed stop never matches and keeps its number.
  const kindOf = (label: string) => {
    const heads = [label, label.split("·")[0].trim(), label.split(",")[0].trim()];
    return picked.find((p) => p.kind && heads.some((h) => h === p.name || h === p.label));
  };
  const place = (p: { lat: number; lon: number; label: string }, name: string | null | undefined): RidePlace => {
    const k = kindOf(p.label);
    return {
      name: name?.trim() || p.label,
      label: p.label,
      lat: p.lat,
      lon: p.lon,
      ...(k ? { kind: k.kind, poiId: k.poiId } : {}),
    };
  };
  const namesLineUp = plan.viaPlaces.length === params.via.length;
  // The API's vias are the stops; the plan's shaping points go back in
  // between them, where each was (`afterPlace`).
  const stops = params.via.map((v, i) => place(v, namesLineUp ? plan.viaPlaces[i] : null));
  return {
    start: place(params.start, plan.startPlace),
    vias: interleaveShapes(stops, plan.shapePoints, shapeVia),
    finish: plan.returnToStart === true || !params.destination ? null : place(params.destination, plan.destinationPlace),
    roundTrip: plan.returnToStart === true,
  };
}

/**
 * The form's rows for a ride's places: names by row, and the pick under each.
 * A shaping point has no row (rider, 2026-09-25: „just a moved route”, not a
 * stop); the editor draws it as a dot on the map instead.
 */
export function rowsOf(places: RidePlaces): { names: string[]; picked: Record<number, ResolvedPlace> } {
  const list = [places.start, ...stopsOf(places), ...(places.finish ? [places.finish] : [])];
  const names = list.map((p) => p.name);
  const picked: Record<number, ResolvedPlace> = {};
  list.forEach((p, i) => { picked[i] = p; });
  // The form always shows two rows; a one-way ride with no finish keeps its
  // second row empty ("Līdz" — anywhere), and a stopless loop gets a blank stop.
  while (names.length < 2) names.push("");
  if (!places.roundTrip && !places.finish && names.length === list.length) names.push("");
  return { names, picked };
}

/**
 * The form's rows back as places, or why they cannot be ridden.
 *
 * A row the rider typed but never pinned has no coordinates and is left out —
 * the same rule the planning map's pins follow — and a start or a finish with
 * none is refused rather than guessed at.
 */
export function placesFromRows(params: {
  picked: Record<number, ResolvedPlace | null>;
  rowCount: number;
  roundTrip: boolean;
  /** a one-way ride that had no finish may keep none */
  finishOptional: boolean;
}): RidePlaces | { error: "no-start" | "no-finish" } {
  const roles = placeRoles({ picked: params.picked, rowCount: params.rowCount, tripType: params.roundTrip ? "round_trip" : "one_way" });
  if (!roles.start) return { error: "no-start" };
  if (!params.roundTrip && !roles.finish && !params.finishOptional) return { error: "no-finish" };
  return { start: roles.start, vias: roles.vias, finish: params.roundTrip ? null : roles.finish, roundTrip: params.roundTrip };
}

/**
 * The form's rows committed over a ride that has shaping points: the rows are
 * stops only, so the shaping points are put back where they were.
 *
 * Each kind of change keeps them the way `planEdit` needs to see it:
 * - the same number of stops (a stop, the start or the finish moved): every
 *   shaping point stays exactly where it was among the vias;
 * - one stop fewer: that stop goes and the shaping points stay;
 * - more stops, the old ones still in order (added from the form, the search
 *   or a batch): the new ones are appended, and `planEdit` slots each where
 *   the line passes it, between whatever stops or shaping points it lies;
 * - anything else (the arrows reordered the stops): each shaping point
 *   follows the place it followed by index — the stretch between the first
 *   and last changed place is re-routed through all of them anyway.
 */
export function mergeShapes(before: RidePlaces, after: RidePlaces): RidePlaces {
  if (!before.vias.some(isShape)) return after;
  const oldStops = stopsOf(before);
  const newStops = after.vias;
  let k = 0;
  if (newStops.length === oldStops.length) {
    return { ...after, vias: before.vias.map((v) => (isShape(v) ? v : newStops[k++])) };
  }
  if (newStops.length === oldStops.length - 1) {
    const gone = oldStops.findIndex((v, i) => !newStops[i] || !same(v, newStops[i]));
    const rest = oldStops.filter((_, i) => i !== gone);
    if (gone >= 0 && rest.every((v, i) => same(v, newStops[i]))) {
      return { ...after, vias: before.vias.filter((v) => v !== oldStops[gone]) };
    }
  }
  if (newStops.length > oldStops.length) {
    const isOld = (v: RidePlace) => oldStops.some((o) => same(o, v));
    const kept = newStops.filter(isOld);
    if (kept.length === oldStops.length && kept.every((v, i) => same(v, oldStops[i]))) {
      return { ...after, vias: [...before.vias, ...newStops.filter((v) => !isOld(v))] };
    }
  }
  return { ...after, vias: interleaveShapes(newStops, shapePointsOf(before), shapeVia) };
}

/**
 * The rows committed over a ride when they only add stops, and the rows'
 * order says where each goes (Phase 1, 2026-09-28): the composer puts a new
 * point into the leg it is nearest to, or the one the rider chose
 * (`lib/map/insert-leg.ts`). Each new stop stays between the stops the rows
 * put it between; among the pass-through points there, it goes where the
 * line passes it nearest. For `planEdit` with `keepOrder`.
 *
 * Null when the rows are not exactly that — the start or the finish
 * changed, or the old stops are not all there in order — and `mergeShapes`
 * decides as before.
 */
export function mergeAddedInOrder(before: RidePlaces, after: RidePlaces, line: Point[]): RidePlaces | null {
  if (line.length < 2 || !same(before.start, after.start)) return null;
  if ((before.finish === null) !== (after.finish === null) || (before.finish && after.finish && !same(before.finish, after.finish))) return null;
  const oldStops = stopsOf(before);
  const newStops = after.vias;
  if (newStops.length <= oldStops.length) return null;
  const isOld = (v: RidePlace) => oldStops.some((o) => same(o, v));
  const kept = newStops.filter(isOld);
  if (kept.length !== oldStops.length || !kept.every((v, i) => same(v, oldStops[i]))) return null;
  const cum = cumulative(line);
  const total = cum[cum.length - 1];
  const along = anchorsAlong(anchorsOf(before, line[line.length - 1]), line, cum);
  // Each via's place in the order: its gap (how many old stops come before
  // it) — an old stop sits between two gaps — then where the line meets it.
  type Entry = { v: RidePlace; gap: number; along: number };
  const entries: Entry[] = [];
  let stopsSeen = 0;
  before.vias.forEach((v, i) => {
    if (isShape(v)) entries.push({ v, gap: stopsSeen, along: along[i + 1] });
    else { entries.push({ v, gap: stopsSeen + 0.5, along: along[i + 1] }); stopsSeen++; }
  });
  const stopAlong = before.vias.map((v, i) => (isShape(v) ? -1 : along[i + 1])).filter((m) => m >= 0);
  let gap = 0;
  for (const v of newStops) {
    if (isOld(v)) { gap++; continue; }
    const lo = gap === 0 ? 0 : stopAlong[gap - 1];
    const hi = gap === oldStops.length ? total : stopAlong[gap];
    entries.push({ v, gap, along: nearestWithin(toPoint(v), line, cum, lo, hi).alongMeters });
  }
  const vias = entries
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => a.gap - b.gap || a.along - b.along || a.i - b.i)
    .map((e) => e.v);
  return { ...after, vias };
}

/**
 * What the rider did to a shaping point on the map, one commit each:
 * - `add` — the line grabbed at `grabbedAt` and let go at the point;
 * - `move` — a dot dragged, and Confirmed;
 * - `remove` — „Izņemt” in the dot's popover;
 * - `promote` — „Padarīt par pieturu”: the dot becomes a numbered stop with
 *   a row, named by the reverse lookup (`place`), at the dot's own spot;
 * - `demote` — „Padarīt caurbraucamu” (Phase 1, P1-A): the stop becomes a
 *   pass-through point at its own spot, its row leaves the form, the line
 *   does not change. `stopIndex` counts the stops among `vias` in riding
 *   order, from 0 (not the start, not the finish).
 *
 * `index` counts the shaping points in riding order.
 */
export type ShapeEdit =
  | { kind: "add"; lat: number; lon: number; grabbedAt: Point }
  | { kind: "move"; index: number; lat: number; lon: number }
  | { kind: "remove"; index: number }
  | { kind: "promote"; index: number; place: ResolvedPlace }
  | { kind: "demote"; stopIndex: number };

/**
 * The places after one shaping-point edit, or why it cannot be made. An
 * added point goes last among the vias with where it was grabbed, and
 * `planEdit` puts it into the ride there (its add-stop path — a shaping point
 * is re-routed exactly as a stop would be). A promoted one keeps its place
 * in the list and its coordinates, so the line does not change at all.
 */
export function applyShapeEdit(places: RidePlaces, op: ShapeEdit): RidePlaces | { error: "shape-cap" | "stop-cap" | "no-such-point" } {
  const shapeIndex = (i: number) => {
    let seen = -1;
    return places.vias.findIndex((v) => isShape(v) && ++seen === i);
  };
  if (op.kind === "add") {
    if (shapesOf(places).length >= MAX_SHAPE_POINTS) return { error: "shape-cap" };
    return { ...places, vias: [...places.vias, { ...shapeVia(op), grabbedAt: op.grabbedAt }] };
  }
  // ── P1-A: demote ──
  // The stop becomes a pass-through point at its own spot: same coordinates,
  // same place among the vias, so the line does not change; its `joins` stay
  // so removing it later re-routes the stretch it came with. Its name, POI
  // and grab point go — a pass-through point is not a place.
  if (op.kind === "demote") {
    const at = stopViaIndex(places, op.stopIndex);
    if (at < 0) return { error: "no-such-point" };
    if (shapesOf(places).length >= MAX_SHAPE_POINTS) return { error: "shape-cap" };
    const { lat, lon, joins } = places.vias[at];
    const pass: RidePlace = { ...shapeVia({ lat, lon }), ...(joins ? { joins } : {}) };
    return { ...places, vias: places.vias.map((v, i) => (i === at ? pass : v)) };
  }
  // ── /P1-A: demote ──
  const at = shapeIndex(op.index);
  if (at < 0) return { error: "no-such-point" };
  if (op.kind === "move") {
    return { ...places, vias: places.vias.map((v, i) => (i === at ? { ...v, lat: op.lat, lon: op.lon } : v)) };
  }
  if (op.kind === "remove") return { ...places, vias: places.vias.filter((_, i) => i !== at) };
  if (stopsOf(places).length >= MAX_STOPS) return { error: "stop-cap" };
  const { lat, lon, joins } = places.vias[at];
  const stop: RidePlace = { ...op.place, lat, lon, ...(joins ? { joins } : {}) };
  return { ...places, vias: places.vias.map((v, i) => (i === at ? stop : v)) };
}

/** Where the `stopIndex`-th stop (riding order, from 0) sits among `vias`, or −1. */
function stopViaIndex(places: RidePlaces, stopIndex: number): number {
  if (!Number.isInteger(stopIndex) || stopIndex < 0) return -1;
  let seen = -1;
  return places.vias.findIndex((v) => !isShape(v) && ++seen === stopIndex);
}
