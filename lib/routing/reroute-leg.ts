import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";
import { cumulative, lineMeters, pointAtDistance, sliceBetween } from "@/lib/routing/detour";

/**
 * Correcting a ride on the map, without searching for a new one.
 *
 * The rider's second complaint, in his words: *"I want to make corrections to
 * the offered route through the map and quickly see the new route on the map,
 * not wait for a full re-generation again."* A full generation is ~36
 * candidates and 20-30 s. Moving one stop two kilometres does not need any of
 * that — it changes **two legs** of the ride and leaves the rest of the line
 * exactly where it was.
 *
 * So an edit here is: take the stretch between the place before and the place
 * after, throw it away, route the two new legs through the moved (or new)
 * point, and splice the answer into the drawn line. Two short legs is one to
 * three seconds on our own BRouter, against half a minute for a search.
 *
 * ## What this module is, and what it is not
 *
 * Everything here is arithmetic on a polyline and a segment collection — no
 * routing, no `fs`, no dataset — exactly like `detour.ts`, and for the same
 * reason: the server picks the cut points and the client splices the answer,
 * and the two must not compute the cut differently. The BRouter calls live in
 * `app/api/reroute-leg/route.ts`; the map's side lives in `home-page.tsx`.
 *
 * ## What it deliberately does NOT do
 *
 * It does not re-rank, re-score or re-search. An edited ride is the rider's
 * own line, not one Mopik chose, and CLAUDE.md's "never substitute silently"
 * cuts both ways here: Mopik must not quietly replace his edit with something
 * it likes better, and it must not let his edit pass as a Mopik-planned ride
 * either. Hence `recomputeOverlap` below — an incremental edit can raise the
 * retraced figure and the rider has to see that — and the "labots ar roku"
 * kicker the panel draws from it.
 */

/**
 * How much of the ride a **tap** on the line re-routes, either side of it.
 *
 * A dragged stop re-routes its two real legs: previous place → the new spot →
 * next place, which is exactly what moving that stop invalidates. A tap is
 * different, and getting it wrong cost a measured 126 km ride.
 *
 * The first version cut a tap at its surrounding *anchors* too. On the
 * verification ride — Sigulda round trip, 126 km, one via 1 km in — a tap 25 km
 * along fell in the leg "via (1 km) → finish (126 km)", so the cut replaced
 * 125 km of ride with one short routed leg: **the ride came back as 12 km and
 * 43 % retraced.** The undo restored it in one tap, which is what that button
 * is for, but the edit itself was nonsense.
 *
 * The error was in reading "re-route the two adjacent legs" as "re-route
 * between the two adjacent *places*". For a drag those are the same thing. For
 * a tap they are not: the rider is adding a point to a stretch of line he is
 * looking at, and everything either side of that stretch is ride he did not
 * touch and expects to keep. So a tap re-routes a bounded window around
 * itself — out to this distance each way, or to the neighbouring anchor when
 * that is nearer, whichever comes first.
 *
 * 3 km each way: long enough that the router has real road either side to work
 * with and the new point is reached sensibly rather than by a hairpin, short
 * enough that two legs of ~3 km are the one-to-three-second search this
 * feature promises. On a leg shorter than that the anchors still bound it, so
 * a tap between two close stops behaves exactly as a drag does.
 */
export const TAP_WINDOW_M = 3_000;

/** A place the ride is pinned to, in riding order: the start, the vias, the finish. */
export type LegAnchor = {
  /** Where it is. For a via this is what the rider may have dragged. */
  lat: number;
  lon: number;
  /** What it is called, as the panel and the share code carry it. */
  label: string;
  /**
   * Its index in the plan's `viaPlaces`, or null for the start and the finish.
   *
   * Null is what makes the ends un-draggable by construction: the two legs of
   * an edit are "previous anchor → this → next anchor", and an end has no
   * anchor on one side to route from.
   */
  viaIndex: number | null;
};

/**
 * Where along the drawn line an anchor sits, and which two anchors surround a
 * new point.
 *
 * The distance is measured along the route rather than as the crow flies,
 * because that is the question being asked: a stop 300 m off the line as the
 * crow flies may be 4 km along it, and the stretch to replace is the one the
 * ride actually covers between two anchors.
 */
export type AnchorAlong = LegAnchor & { alongMeters: number };

/**
 * The nearest point on a polyline to a place, and how far along it that is.
 *
 * The same computation `/api/detour` does for a suggestion (`nearestAlong`
 * there), repeated rather than shared because that one is a route handler's
 * private helper and this module is the pure half both sides import. A plain
 * scan: this runs a handful of times per edit, over a few thousand vertices.
 */
export function nearestAlong(
  target: Point,
  line: Point[],
  cum: number[],
): { meters: number; alongMeters: number } {
  let best = { meters: Infinity, alongMeters: 0 };
  for (let i = 0; i < line.length - 1; i++) {
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
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const meters = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (meters >= best.meters) continue;
    best = { meters, alongMeters: cum[i] + t * (cum[i + 1] - cum[i]) };
  }
  return best;
}

/**
 * Every anchor placed along the drawn line, in riding order.
 *
 * A round trip's start and finish are the same place, so the last anchor is
 * pinned to the END of the line rather than to the nearest point — which for a
 * loop is the start, at 0 m. Without that the ride's last leg would be
 * "previous stop → start at 0 m", the replaced stretch would run backwards,
 * and `sliceBetween` would return a two-point line: measured, this turned a
 * 140 km Sigulda loop into a 6 km one on the first drag of the last stop.
 */
export function anchorsAlong(params: {
  line: Point[];
  cum: number[];
  anchors: LegAnchor[];
  /** The ride returns to its start, so the final anchor is the line's end. */
  roundTrip: boolean;
}): AnchorAlong[] {
  const { line, cum, anchors, roundTrip } = params;
  const total = cum[cum.length - 1];
  return anchors.map((anchor, i) => {
    if (i === 0) return { ...anchor, alongMeters: 0 };
    if (i === anchors.length - 1 && (roundTrip || anchor.viaIndex === null)) {
      return { ...anchor, alongMeters: total };
    }
    return { ...anchor, alongMeters: nearestAlong([anchor.lon, anchor.lat], line, cum).alongMeters };
  });
}

/**
 * Which two anchors a new via belongs between, for a tap on the line.
 *
 * By distance ALONG the route, not by proximity to the anchors: the rider
 * tapped a point on the line he is looking at, and the leg it belongs to is
 * the one that stretch of line is part of. Comparing crow-flight distances to
 * the stops would put a tap near a hairpin into the wrong leg whenever the
 * ride passes close to an earlier stop.
 */
export function legForPoint(params: {
  anchors: AnchorAlong[];
  alongMeters: number;
}): { beforeIndex: number; afterIndex: number } | null {
  const { anchors, alongMeters } = params;
  if (anchors.length < 2) return null;
  for (let i = 0; i < anchors.length - 1; i++) {
    if (alongMeters >= anchors[i].alongMeters && alongMeters <= anchors[i + 1].alongMeters) {
      return { beforeIndex: i, afterIndex: i + 1 };
    }
  }
  // Past the last anchor (rounding at the very end of the line).
  return { beforeIndex: anchors.length - 2, afterIndex: anchors.length - 1 };
}

/**
 * Where a tap on the line re-routes from and to.
 *
 * Bounded by `TAP_WINDOW_M` around the tap, and by the neighbouring anchors,
 * whichever is nearer — see `TAP_WINDOW_M` for the 126 km ride that proved the
 * bound is needed. The two returned points are on the drawn line, so the
 * routed replacement joins the kept ride at places the router has already
 * agreed are on a road.
 *
 * The result reads the same way a drag's does: a `LegCut` to splice at, and
 * the two ends to route through the new point.
 */
export function tapCut(params: {
  line: Point[];
  cum: number[];
  anchors: AnchorAlong[];
  /** how far along the line the rider tapped */
  alongMeters: number;
  windowMeters?: number;
}): { cut: LegCut; from: Point; to: Point } | null {
  const { line, cum, anchors, alongMeters } = params;
  const windowMeters = params.windowMeters ?? TAP_WINDOW_M;
  const leg = legForPoint({ anchors, alongMeters });
  if (!leg) return null;
  const legStart = anchors[leg.beforeIndex].alongMeters;
  const legEnd = anchors[leg.afterIndex].alongMeters;
  // Never past the anchors: beyond them is a different leg, whose own stop
  // would be swallowed by the splice.
  const fromMeters = Math.max(legStart, alongMeters - windowMeters);
  const toMeters = Math.min(legEnd, alongMeters + windowMeters);
  if (!(toMeters > fromMeters)) return null;
  return {
    cut: { fromMeters, toMeters },
    from: pointAtDistance(line, cum, fromMeters).point,
    to: pointAtDistance(line, cum, toMeters).point,
  };
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
 * retracing — a via dragged to the wrong side of a river is exactly the case —
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

/**
 * The stretch of the ride an edit replaces, as distances along the drawn line.
 *
 * `fromMeters` is the anchor before the edit, `toMeters` the anchor after it.
 * Everything between them is thrown away and the two routed legs take its
 * place — which is precisely why the cuts are at anchors and nowhere else.
 */
export type LegCut = { fromMeters: number; toMeters: number };

/**
 * A ride with one leg pair replaced.
 *
 * The same shape `SplicedRoute` has, deliberately: the map, the panel and the
 * GPX all already know how to draw a ride described this way, so an edited
 * ride needs no new path through any of them.
 */
export type ReroutedRoute = {
  coordinates: Point[];
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  /** what the edit changed, signed: negative when the new line is shorter */
  deltaMeters: number;
  deltaSeconds: number;
  /** recomputed over the whole edited line, never carried over */
  overlap: ReturnType<typeof recomputeOverlap>;
};

/**
 * A ride the rider has changed: sights committed without a search, a stop
 * dragged, a via tapped onto the line.
 *
 * Its own type rather than a `GeneratedRoute` with fields overwritten, because
 * the two are different claims and the panel has to be able to tell them
 * apart. A `GeneratedRoute` is a ride Mopik searched for and ranked; this is a
 * line the rider made. Everything the panel, the map and the GPX need is here
 * — the drawn geometry, the segments that colour it, the numbers that describe
 * it — and nothing that would let it pass as a search result: no score, no
 * variant, no rank.
 *
 * `vias` is what makes an edit survive the page. They are written back into
 * the plan, so sharing, saving, the GPX and a later full search all carry the
 * places the rider added — an edit that only changed the picture would be lost
 * the moment he pressed Saglabāt.
 */
export type EditedRide = {
  coordinates: Point[];
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  /** recomputed over the whole edited line, never inherited */
  overlap: ReturnType<typeof recomputeOverlap>;
  /**
   * The ride's places as the edit leaves them, in riding order, including the
   * start and the finish. What the plan, the share code and the map's pins are
   * rebuilt from.
   */
  vias: { lat: number; lon: number; label: string; category?: string }[];
  /**
   * Why this ride is not the one the API returned.
   *
   * `commit` — ticked sights were kept without a search, so the line is the
   * API's with real routed detours spliced in. `edit` — a leg was re-routed
   * through a point the rider chose. The panel's kicker distinguishes them:
   * committing sights is not "labots ar roku", it is the offer being accepted,
   * and calling it a hand edit would overstate what the rider did.
   */
  kind: "commit" | "edit";
};

/**
 * Cut a segment collection at two distances along the route and keep the ends.
 *
 * `detour.ts` has this as a private `cutSegments`; it is re-derived rather than
 * exported from there because that one's contract is "the stretch a detour
 * replaces" and this one's is "the stretch between two anchors", and the two
 * having one implementation would tie a change in either to both. The
 * arithmetic is the same and so is the rule behind it: a segment cut in half is
 * still the same road, so both halves keep its surface, class and flags and
 * only `distanceMeters` is recomputed.
 */
function cutSegments(
  features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[],
  fromMeters: number,
  toMeters: number,
): {
  before: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[];
  after: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[];
} {
  const before: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];
  const after: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];
  let walked = 0;

  for (const feature of features) {
    const coords = feature.geometry.coordinates as Point[];
    const own = lineMeters(coords);
    const start = walked;
    const end = walked + own;
    walked = end;

    if (end <= fromMeters) { before.push(feature); continue; }
    if (start >= toMeters) { after.push(feature); continue; }

    const cum = cumulative(coords);
    if (start < fromMeters) {
      const head = sliceBetween(coords, cum, 0, fromMeters - start);
      if (head.length >= 2) {
        before.push({
          ...feature,
          geometry: { type: "LineString", coordinates: head },
          properties: { ...feature.properties, distanceMeters: Math.round(lineMeters(head)) },
        });
      }
    }
    if (end > toMeters) {
      const tail = sliceBetween(coords, cum, toMeters - start, own);
      if (tail.length >= 2) {
        after.push({
          ...feature,
          geometry: { type: "LineString", coordinates: tail },
          properties: { ...feature.properties, distanceMeters: Math.round(lineMeters(tail)) },
        });
      }
    }
  }

  return { before, after };
}

/** The coordinates of a segment collection, with the shared join vertices dropped. */
export function coordinatesOf(
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>,
): Point[] {
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

/**
 * Splice a re-routed leg pair into a ride.
 *
 * `replacement` is the two new legs already joined into one line by the API —
 * previous anchor → edited point → next anchor — with its own classified
 * segments, so the map colours a gravel correction brown the first time it
 * draws it, exactly as it does a detour's.
 *
 * The replaced stretch's riding time is taken as its share of the ride's own
 * duration, the way `/api/detour` prices what a detour replaces: there is no
 * per-vertex timing to do better with, and this keeps the new total consistent
 * with the headline it replaces rather than a minute or two off it.
 */
export function spliceLeg(params: {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  cut: LegCut;
  replacement: {
    segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
    distanceMeters: number;
    durationSeconds: number;
  };
}): ReroutedRoute {
  const { segments, distanceMeters, durationSeconds, cut, replacement } = params;
  const features = segments.features as GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[];
  const { before, after } = cutSegments(features, cut.fromMeters, cut.toMeters);
  const merged: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> = {
    type: "FeatureCollection",
    features: [...before, ...replacement.segments.features, ...after],
  };

  const replacedMeters = Math.max(0, cut.toMeters - cut.fromMeters);
  const replacedSeconds =
    distanceMeters > 0 && durationSeconds > 0
      ? (replacedMeters / distanceMeters) * durationSeconds
      : 0;

  const deltaMeters = replacement.distanceMeters - replacedMeters;
  const deltaSeconds = replacement.durationSeconds - replacedSeconds;
  const coordinates = coordinatesOf(merged);

  return {
    coordinates,
    segments: merged,
    distanceMeters: Math.round(distanceMeters + deltaMeters),
    durationSeconds: Math.round(durationSeconds + deltaSeconds),
    deltaMeters: Math.round(deltaMeters),
    deltaSeconds: Math.round(deltaSeconds),
    // Over the WHOLE edited line, never the leg alone: retracing is a property
    // of the ride, and a new leg that rides back along a stretch the ride
    // already covered elsewhere is exactly the case the rider must be shown.
    overlap: recomputeOverlap(coordinates),
  };
}
