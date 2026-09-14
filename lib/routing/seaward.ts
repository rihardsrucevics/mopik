import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { bboxOf, hasSeaData, seaLookup, type BBox, type SeaLookup } from "@/lib/geo/sea";

/**
 * Via points placed deliberately on the coastal side of an A-to-B corridor.
 *
 * Backlog item 11d, and it exists because of what item 11c measured. The sea
 * term in `score.ts` ranks a coastal candidate above an inland one correctly —
 * when there is a coastal candidate to rank. On the rider's own example there
 * is not:
 *
 * > A via ride between two towns produces a handful of shapes — measured on
 * > the dev server, an A-to-B generation returned **2 candidates**, both taking
 * > the same inland line, both reporting the same coastal kilometres. A term
 * > that ranks cannot choose a road nothing routed.
 *
 * ## Why the existing via candidates cannot reach the coast
 *
 * `perpendicularVia` offsets the straight A→B line by ±`reach·scale`. On a
 * coast-parallel ride that is exactly the wrong axis: **one side is the sea**.
 * Measured on Liepāja → Ventspils (reach 12.45 km), distance from each via
 * point to the coastline:
 *
 * | scale | side +1 (west) | side −1 (east) |
 * |---:|---:|---:|
 * | 0.35 | 4.1 km | 4.0 km |
 * | 0.7 | 8.2 km | 7.9 km |
 * | 1.4 | 14.7 km | 15.8 km |
 * | 2.8 | 30.0 km | 33.4 km |
 *
 * The +1 points are 4–30 km *offshore*, in the Baltic; the −1 points are the
 * same distances inland. **Not one of the fifteen lands on the coastal strip**,
 * and the P111 — the road the rider is asking for — runs about 1 km from the
 * water. The offshore ones do not merely score badly: they cost the generation
 * its budget, because BRouter answers `error re-tracking track` for a point in
 * the sea and `fetchRoutePath` then spends the endpoint-nudge ring and a
 * segmented retry on each (measured 60 s for one candidate against 1.5 s for
 * the direct line).
 *
 * So the fix is not a weight. It is a via point in the right *place*, which is
 * what this module computes: walk out from the corridor to the coastline, then
 * step back inland far enough to be on the shore road rather than in the water.
 *
 * ## Gated on `hasSeaData`, like everything else in item 11
 *
 * No published coastline cell over the ride's bbox means no seaward candidates
 * and a byte-for-byte unchanged search — the same gate `classify.ts` and
 * `score.ts` use, for the same reason.
 */

/**
 * How near the corridor must come to the sea before seaward candidates are
 * worth building at all.
 *
 * 15 km is chosen from the measured legs rather than picked: Liepāja →
 * Ventspils runs 2.3–10.7 km out along its whole length (item 11b sampled it
 * every 5 km), Rīga → Ainaži touches 0.2 km, and the inland controls — Sigulda
 * → Cēsis, Cēsis → Madona — have no coastline within range at all, so they are
 * excluded by the data before this threshold is even consulted. A corridor that
 * never comes within 15 km of the water is an inland ride, and detouring it to
 * the shore would be a different ride rather than a better one.
 */
export const COASTAL_CORRIDOR_M = 15000;

/**
 * Where a seaward via point wants to sit: near enough for the shore road,
 * never in the water.
 *
 * The lower bound is the important one. The published coastline dataset is
 * thinned to a 200 m grid (`DEDUPE_METERS`), and item 11a spent a day removing
 * beach and dune footpaths from these rides — the thing physically nearest the
 * water on the Baltic is the sand, not a road. 1 km keeps the target off it and
 * matches the band `classify.ts` counts `coastKm` in, so a via point that hits
 * this window scores in the band the ranking rewards.
 *
 * The upper bound is where the coastal road actually is. The P111 runs about
 * 1 km out for most of its length and swings to 3 km around Jūrkalne, so 3 km
 * is the widest that still names the shore road rather than the inland line.
 */
export const SEAWARD_MIN_M = 1000;
export const SEAWARD_MAX_M = 3000;
const SEAWARD_TARGET_M = (SEAWARD_MIN_M + SEAWARD_MAX_M) / 2;

/**
 * Where along the corridor to sample.
 *
 * Deliberately not the endpoints: A and B are the rider's own places and a via
 * point on top of one of them is a no-op that costs a routed leg. The interior
 * fractions give a candidate that comes to the coast early, one that holds it
 * through the middle, and one that meets it late — which is the shape of the
 * complaint, since Liepāja → Ventspils already reaches the water for its last
 * ~30 km and misses it for the first 110.
 */
const SAMPLE_FRACTIONS = [0.25, 0.5, 0.75] as const;

/**
 * The most seaward candidates one generation may route, however many legs the
 * ride has. The brief asks for 2–4; each leg of a coastal ride yields three, so
 * a multi-stop ride needs a ceiling or the coast starts buying slots from the
 * corridors the rider actually asked for.
 */
export const MAX_SEAWARD_CANDIDATES = 4;

/** Bearings tried when stepping back inland from a coastline point. */
const INLAND_BEARINGS = 16;

export type SeawardVia = {
  /** the via point itself, on the landward side of the coastline */
  point: Point;
  /** how far along the A→B line it was sampled from, 0–1 */
  fraction: number;
  /** its own distance to the coastline, metres */
  coastDistanceM: number;
};

/** Great-circle point at `bearingDeg` and `meters` from `origin`, in lon/lat. */
function offset(origin: Point, bearingDeg: number, meters: number): Point {
  const rad = (bearingDeg * Math.PI) / 180;
  const lat = origin[1] + (meters * Math.cos(rad)) / 110540;
  const lon =
    origin[0] + (meters * Math.sin(rad)) / (111320 * Math.cos((origin[1] * Math.PI) / 180));
  return [lon, lat];
}

/** Straight-line interpolation along A→B at fraction `t`. */
function along(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/**
 * The bounding box the coastline is looked up over: the corridor itself, padded
 * so a coastline that runs outside the straight line between A and B is still
 * found. Padding is `COASTAL_CORRIDOR_M` plus the window, in degrees.
 */
function corridorBBox(a: Point, b: Point): BBox {
  const box = bboxOf([a, b]);
  const padLat = (COASTAL_CORRIDOR_M + SEAWARD_MAX_M) / 110540;
  const midLat = (box[1] + box[3]) / 2;
  const padLon =
    (COASTAL_CORRIDOR_M + SEAWARD_MAX_M) /
    (111320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return [box[0] - padLon, box[1] - padLat, box[2] + padLon, box[3] + padLat];
}

/**
 * Step from a point near the water to one `SEAWARD_MIN_M`–`SEAWARD_MAX_M` from
 * the coastline, on the land side.
 *
 * "Land side" cannot be read off the dataset: `public/sea/*.json` is a list of
 * coastline *vertices* with no inside/outside, so which way is dry is not a
 * property of any one point. It is found by trying — sixteen bearings at the
 * target distance, keeping whichever candidate the lookup then reports as
 * being in the window. A point in the sea and a point inland both sit the same
 * distance from the coastline, so the tie is broken the only way it can be
 * here: **prefer the one further from the corridor's own seaward extreme**, and
 * let BRouter be the final judge — an offshore point does not route and its
 * candidate is dropped, which is the pre-existing behaviour for a bad via.
 *
 * Returns null when no bearing lands in the window, which happens on a
 * corridor whose nearest coastline is a lagoon edge or another country's
 * island — better no candidate than one in the water.
 */
function stepInland(near: Point, lookup: SeaLookup, reference: Point): Point | null {
  let best: { point: Point; score: number } | null = null;
  for (let i = 0; i < INLAND_BEARINGS; i++) {
    const bearing = (360 / INLAND_BEARINGS) * i;
    const candidate = offset(near, bearing, SEAWARD_TARGET_M);
    const distance = lookup.distanceM(candidate[0], candidate[1]);
    if (distance < SEAWARD_MIN_M || distance > SEAWARD_MAX_M) continue;
    // Nearer the corridor is better: the ride still has to get there and back,
    // and a via point that drags the route 20 km sideways to reach the same
    // shore spends the budget the rider gave for riding.
    const score = haversineMeters(candidate, reference);
    if (!best || score < best.score) best = { point: candidate, score };
  }
  return best?.point ?? null;
}

/**
 * Via points on the coastal side of the A→B corridor, nearest-first along the
 * ride.
 *
 * Returns an empty array — and opens no coastline file — when `hasSeaData` is
 * false for the corridor, when the corridor never comes within
 * `COASTAL_CORRIDOR_M` of the sea, or when no sampled point can be stepped onto
 * land. Every caller must treat "no seaward vias" as the ordinary case.
 */
export function seawardVias(a: Point, b: Point, limit = SAMPLE_FRACTIONS.length): SeawardVia[] {
  if (limit <= 0) return [];
  const bbox = corridorBBox(a, b);
  // The gate. An inland ride never loads a coastline file, exactly as in
  // `classify.ts` — this is what makes item 11d free away from a coast.
  if (!hasSeaData(bbox)) return [];
  const lookup = seaLookup(bbox);
  if (!lookup.size) return [];

  // Is this corridor coastal at all? Item 11d's brief asks for either end or
  // the midpoint within ~15 km, which is what these three samples are.
  const ends: Point[] = [a, along(a, b, 0.5), b];
  const nearest = Math.min(...ends.map((p) => lookup.distanceM(p[0], p[1])));
  if (!(nearest <= COASTAL_CORRIDOR_M)) return [];

  const vias: SeawardVia[] = [];
  const seen: Point[] = [];
  for (const fraction of SAMPLE_FRACTIONS) {
    if (vias.length >= limit) break;
    const sample = along(a, b, fraction);
    const distance = lookup.distanceM(sample[0], sample[1]);
    if (!Number.isFinite(distance)) continue;

    // Walk from the sample towards the water in steps, so the search starts
    // from a point that is genuinely near the coastline rather than from a
    // guessed bearing. The first probe that lands inside the window is used
    // directly; otherwise the nearest approach found is stepped back inland.
    let near = sample;
    if (distance > SEAWARD_MAX_M) {
      // The lookup gives a distance, not a direction, so the way to the water
      // is found by descent: try bearings at 60 % of the current distance and
      // keep whichever reduces it most. Four steps of 0.6 cover 15 km down to
      // under 2 km, which is the whole corridor this module accepts.
      for (let step = 0; step < 4; step++) {
        const here = lookup.distanceM(near[0], near[1]);
        if (here <= SEAWARD_MAX_M) break;
        const reach = Math.max(SEAWARD_TARGET_M, here * 0.6);
        let bestPoint = near;
        let bestDistance = here;
        for (let i = 0; i < INLAND_BEARINGS; i++) {
          const probe = offset(near, (360 / INLAND_BEARINGS) * i, reach);
          const probed = lookup.distanceM(probe[0], probe[1]);
          if (probed < bestDistance) {
            bestDistance = probed;
            bestPoint = probe;
          }
        }
        if (bestPoint === near) break;
        near = bestPoint;
      }
    }

    const here = lookup.distanceM(near[0], near[1]);
    const point =
      here >= SEAWARD_MIN_M && here <= SEAWARD_MAX_M ? near : stepInland(near, lookup, sample);
    if (!point) continue;

    // Two samples that resolve to the same stretch of shore are one candidate,
    // not two: they would route the same line and each costs a leg.
    if (seen.some((p) => haversineMeters(p, point) < SEAWARD_MAX_M)) continue;
    seen.push(point);
    vias.push({
      point,
      fraction,
      coastDistanceM: Math.round(lookup.distanceM(point[0], point[1])),
    });
  }
  return vias;
}

/**
 * The compass bearing from a point towards the nearest coastline, or null when
 * the point is not in a coastal corridor at all.
 *
 * Used by `lib/routing/loop.ts` to aim one or two of a loop's anchor bearings
 * at the water. A loop's anchors are placed by bearing around the start, so
 * unlike the A-to-B case there is no wrong side to fall off — the bias is a
 * rotation, not a displacement, and the overlap rule still decides which
 * shapes survive.
 *
 * The direction is found the same way `stepInland` finds land: the dataset is a
 * list of vertices with no notion of inside or outside, so the bearing is read
 * off the nearest vertex the lookup can produce. That is a direction *towards*
 * the coastline, which on a seaside start is towards the shore road.
 *
 * Returns null beyond `COASTAL_CORRIDOR_M` and wherever `hasSeaData` is false,
 * so an inland loop is planned exactly as it was before item 11d.
 */
export function seawardBearing(start: Point): number | null {
  const pad = (COASTAL_CORRIDOR_M + SEAWARD_MAX_M) / 110540;
  const padLon =
    (COASTAL_CORRIDOR_M + SEAWARD_MAX_M) /
    (111320 * Math.max(0.2, Math.cos((start[1] * Math.PI) / 180)));
  const bbox: BBox = [start[0] - padLon, start[1] - pad, start[0] + padLon, start[1] + pad];
  if (!hasSeaData(bbox)) return null;
  const lookup = seaLookup(bbox);
  if (!lookup.size) return null;
  if (lookup.distanceM(start[0], start[1]) > COASTAL_CORRIDOR_M) return null;

  // Descend towards the water on a ring of probes and keep the bearing that
  // reduced the distance most. One ring is enough: the answer only has to be
  // good to a loop anchor's own precision, and `planLoop` then snaps the anchor
  // to an isochrone direction and a real POI anyway.
  const here = lookup.distanceM(start[0], start[1]);
  const reach = Math.max(SEAWARD_TARGET_M, Math.min(here, COASTAL_CORRIDOR_M) * 0.5);
  let best: { bearing: number; distance: number } | null = null;
  for (let i = 0; i < INLAND_BEARINGS; i++) {
    const bearing = (360 / INLAND_BEARINGS) * i;
    const probe = offset(start, bearing, reach);
    const distance = lookup.distanceM(probe[0], probe[1]);
    if (!best || distance < best.distance) best = { bearing, distance };
  }
  // A probe ring that found nothing nearer than the start itself means the
  // start already sits on the shore and every direction leads inland; a loop
  // there is coastal whichever way it faces, so there is no bias to apply.
  return best && best.distance < here ? best.bearing : null;
}

/**
 * Fold seaward candidates into a pool without spending more time than the
 * generation has.
 *
 * The brief's rule, and it is a real constraint rather than tidiness: item 7's
 * `affordableCandidates` decides how many legs a generation may route, and the
 * platform kills the request at 60 s. So inside a full pool the seaward
 * candidates **replace** the least promising inland ones instead of extending
 * it.
 *
 * Which inland ones are least promising is already settled by build order.
 * `route.ts` takes `candidates.slice(0, candidateCap)` for exactly this reason:
 *
 * > The candidates are in build order, which puts the plain corridors (the ones
 * > a rider actually recognises as the ride they asked for) before the
 * > ornamental shapes, so taking a prefix keeps the most useful ones.
 *
 * The tail is therefore the widest perpendicular offsets — which on a coastal
 * ride are the ones measured 15–33 km out to sea or inland, the candidates that
 * either fail outright or cost a minute each. Dropping those to pay for a
 * coastal line is the trade item 11d is making.
 *
 * The first candidate is never dropped: it is the direct line between the
 * rider's own places, the one guaranteed to route, and on a slow leg it may be
 * the only version shown.
 */
export function withSeawardCandidates<T>(pool: T[], seaward: T[], cap: number): T[] {
  if (cap <= 0) return [];
  if (!seaward.length) return pool.slice(0, cap);

  // A ride with several stops samples each leg, so a four-stop coastal ride
  // could otherwise bring nine extra legs into a pool of seventeen. The brief
  // asks for 2–4 and the measured legs produce three, so that is the ceiling:
  // beyond it the coast would be buying slots from the corridors the rider
  // actually asked for.
  const wanted = seaward.slice(0, MAX_SEAWARD_CANDIDATES);

  const room = cap - pool.length;
  if (room >= wanted.length) return [...pool, ...wanted];

  // Keep at least the direct line, then as many seaward candidates as the cap
  // allows, then refill from the front of the inland pool.
  const keptSeaward = wanted.slice(0, Math.max(0, cap - 1));
  const keptInland = pool.slice(0, Math.max(1, cap - keptSeaward.length));
  return [...keptInland, ...keptSeaward].slice(0, cap);
}

/**
 * ============================================================================
 * Item 11e — no vias in the water
 * ============================================================================
 *
 * Item 11d measured the cost of the offshore via points it could not prevent:
 *
 * > | | candidates | wall clock |
 * > |---|---:|---:|
 * > | routed | 8 | 6.6 s |
 * > | failed | 12 | **293.4 s** |
 *
 * 98 % of the search's time went on candidates that returned nothing, against a
 * 50 s budget — which is why item 11c saw a generation finish with two
 * candidates. Item 11d added coastal candidates but deliberately left the
 * offshore ones in the pool, because removing them changes the pool for *every*
 * ride and deserved its own measurement. This is that measurement.
 *
 * ## The test is the router, not the coastline
 *
 * The brief proposed inferring water from `sea.ts`: far from the coast AND the
 * 16-bearing land probe finds land on one side only. That was tried first and
 * **it does not work** — the dataset is coastline *vertices*, so nearest-coast
 * distance is symmetric about the shore and a point 8 km out to sea measures
 * exactly like one 8 km inland. The full numbers are in `snapDistanceM`, which
 * carries the alternative the brief also named and which does work: ask BRouter
 * where the nearest road is. Offshore it answers in kilometres, on land in
 * metres, and it costs ~40 ms.
 *
 * ## What "offshore" means here
 *
 * Two conditions, both required, because either alone would be wrong:
 *
 *  - **`hasSeaData` covers the via.** An inland ride must be byte-identical, so
 *    a ride with no coastline file is never probed and never altered. This is
 *    the same gate `classify.ts`, `score.ts` and `seawardVias` use.
 *  - **The snap distance exceeds `OFFSHORE_SNAP_M`.** Measured separation is
 *    883 m (worst inland) against 1944 m (best offshore), so the threshold sits
 *    in a gap of more than a kilometre rather than on a cliff edge.
 *
 * Note the deliberate absence of a coast-distance condition. `via-2.8-1` on
 * Liepāja → Ventspils is 30 km from the nearest coastline vertex and squarely
 * in open water; a "must be near the coast" guard would have kept it.
 */

/**
 * How far BRouter may move a via point before the via is judged to be in the
 * water.
 *
 * 1500 m, and the gap it sits in is wide. Measured across the four coastal
 * rides, every via point the perpendicular builder produces:
 *
 * | | snap distance |
 * |---|---|
 * | on land (48 vias) | 2 m – 1186 m |
 * | in the water (22 vias) | 1944 m – 45757 m |
 *
 * So 1500 m is not a tuned constant — anything between 1.2 km and 1.9 km
 * classifies identically on every measured ride. It is set at 1500 because a
 * legitimate via can land on a lake, a bog or a military area and need a
 * kilometre to reach a road, and losing such a via costs a candidate while
 * keeping an offshore one costs a minute.
 */
export const OFFSHORE_SNAP_M = 1500;

/**
 * A via point and the land-side alternative to use if it turns out to be in
 * the water.
 *
 * The caller supplies both because only it knows how the point was built:
 * `perpendicularVia` mirrors by negating the offset, and a mirrored point is a
 * ride the rider might plausibly have been offered anyway. `seaward.ts` cannot
 * reconstruct that from a coordinate.
 */
export type ViaProbe<T> = {
  /** the candidate this via belongs to */
  item: T;
  /** the point to test */
  point: Point;
  /**
   * Land-side stand-ins, best first. Tried in order; the first that is not
   * itself in the water replaces the dropped candidate. Empty means the
   * candidate is simply dropped.
   */
  substitutes: { item: T; point: Point }[];
};

export type OffshoreFilterResult<T> = {
  /** the pool to route, offshore candidates replaced or removed */
  kept: T[];
  /** how many vias were probed at all */
  probed: number;
  /** how many were judged to be in the water */
  dropped: number;
  /** how many of those were replaced by a land-side stand-in */
  substituted: number;
  /** wall clock spent probing, milliseconds */
  ms: number;
};

/**
 * Drop every candidate whose via point is in the water, substituting a
 * land-side one where the caller offered a mirror.
 *
 * ## Why substitute rather than merely drop
 *
 * Dropping alone shrinks a coastal ride's pool from 17 to 5 — the rider loses
 * two thirds of the versions on exactly the rides item 11 is about, and gets a
 * *worse* choice as the reward for not wasting five minutes. So each offshore
 * via is offered its mirror across the corridor: the same offset on the land
 * side, which is a shape `buildCandidates` would have produced for the opposite
 * `side` value and which the router can actually ride.
 *
 * The mirror is only used when it is **not already in the pool** — on a ride
 * where both sides are land, `via-1.4-1`'s mirror *is* `via-1.4--1`, which the
 * builder produced in its own right.
 *
 * **That check is against the whole pool, not against what has been kept so
 * far**, and the difference is not academic. Measured on Liepāja → Ventspils
 * before it was fixed: the probes run in build order, so `via-0.35-1`'s mirror
 * was considered before `via-0.35--1` had been reached, the "already kept" test
 * saw nothing there, and the mirror went in. The run then routed seven pairs of
 * byte-identical candidates — same kilometres, same rank, same everything:
 *
 * ```
 * via-1.8-1m  OK  178.4 km  <1km 15.4  rep 0  rank 5.3
 * via-1.8--1  OK  178.4 km  <1km 15.4  rep 0  rank 5.3
 * ```
 *
 * Half the pool spent on duplicates is worse than the offshore candidates this
 * exists to remove, so every probe's own point is seeded into the guard before
 * the loop starts.
 *
 * ## The probes are sequential
 *
 * BRouter is one vCPU (CLAUDE.md, and `affordableCandidates` is conservative
 * for the same reason). Fourteen sequential probes measured 0.56–0.65 s per
 * ride, which is the whole cost of this feature.
 *
 * A probe that fails returns null and the via is **kept**: a router hiccup must
 * never be read as "this is the sea", or one bad minute would empty the pool.
 */
export async function dropOffshoreVias<T>(params: {
  probes: ViaProbe<T>[];
  /** measures how far BRouter moves a point; injected so tests need no server */
  snap: (point: Point) => Promise<number | null>;
  signal?: AbortSignal;
}): Promise<OffshoreFilterResult<T>> {
  const started = Date.now();
  const empty = { probed: 0, dropped: 0, substituted: 0 };
  if (!params.probes.length) {
    return { kept: [], ...empty, ms: 0 };
  }

  // The gate. One bbox over every via, so an inland ride asks `hasSeaData`
  // once, gets false, and returns its pool untouched without a single probe —
  // which is what makes item 11e free away from a coast.
  const bbox = bboxOf(params.probes.map((p) => p.point));
  if (!hasSeaData(bbox)) {
    return { kept: params.probes.map((p) => p.item), ...empty, ms: Date.now() - started };
  }

  const kept: T[] = [];
  // Every via the pool already offers, whether or not it has been reached yet —
  // a substitute must not duplicate a candidate built later in the order. See
  // the note above: checking only what was kept so far routed seven identical
  // pairs on the headline ride.
  const poolPoints: Point[] = params.probes.map((p) => p.point);
  const keptPoints: Point[] = [];
  let probed = 0;
  let dropped = 0;
  let substituted = 0;

  // Memoised because a multi-stop ride can offer the same mirror as the
  // substitute for two different offshore vias, and a probe is a network call.
  const cache = new Map<string, number | null>();
  const measure = async (point: Point): Promise<number | null> => {
    const key = `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
    if (cache.has(key)) return cache.get(key)!;
    probed++;
    const value = await params.snap(point);
    cache.set(key, value);
    return value;
  };
  // A null probe is "no opinion", never "in the water" — see the note above.
  const inWater = (snap: number | null) => snap !== null && snap > OFFSHORE_SNAP_M;

  for (const probe of params.probes) {
    if (params.signal?.aborted) {
      // Cancelled mid-probe: keep what is left rather than returning a pool
      // thinned by however far the loop happened to get.
      kept.push(probe.item);
      continue;
    }

    if (!inWater(await measure(probe.point))) {
      kept.push(probe.item);
      keptPoints.push(probe.point);
      continue;
    }

    dropped++;
    for (const substitute of probe.substitutes) {
      // Already in the pool — either as a candidate the builder produced in its
      // own right (checked against every probe's point, not only the ones
      // reached so far) or as an earlier substitution. Routing the same line
      // twice buys nothing and costs a leg.
      const duplicate = [...poolPoints, ...keptPoints].some(
        (p) => haversineMeters(p, substitute.point) < SEAWARD_MAX_M
      );
      if (duplicate) continue;
      if (inWater(await measure(substitute.point))) continue;
      kept.push(substitute.item);
      keptPoints.push(substitute.point);
      substituted++;
      break;
    }
  }

  return { kept, probed, dropped, substituted, ms: Date.now() - started };
}
