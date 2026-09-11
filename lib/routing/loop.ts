import {
  angleDiff,
  bearingDegrees,
  destinationPoint,
  haversineMeters,
  inSector,
  type BearingSector,
  type Point,
} from "@/lib/geo/geometry";
import { anchorNearestBearing, ringAnchors, type Anchor, type IsoRing } from "@/lib/geo/isochrone";
import { poisNear, type Poi } from "@/lib/geo/poi";

/**
 * Via points steer a returning ride through a region. Their angular order
 * is a search heuristic, not a requirement that the routed ride be circular.
 * Tourist POIs are used only when explicitly requested; otherwise use the
 * isochrone/geometric anchors and let the motorcycle router connect them.
 * Geometric anchors are provisional: a future road-network sampler should
 * choose connected forest corridors and avoid forcing dead-end visits.
 */

export type LoopStop = {
  point: Point;
  poi?: Poi;
};

export type LoopPlan = {
  /** ordered via points, excluding the start */
  viaPoints: Point[];
  stops: LoopStop[];
  /** how far out the anchors were taken, for logging and correction */
  radiusMeters: number;
  /** straight-line estimate before routing, in km */
  estimatedKm: number;
};

/**
 * How far from an anchor to look for a POI, as a share of the ring radius,
 * widened until something is found.
 *
 * Proportional rather than fixed: a fixed 8 km first ring meant that on a
 * 40 km target (ring radius ~3.7 km) a stop could land 10.8 km out — three
 * times the intended radius — and the loop overshot badly.
 */
const POI_SEARCH_SHARES = [0.35, 0.7, 1.2];
const POI_SEARCH_MIN_M = 2500;
const POI_SEARCH_MAX_M = 25000;

/**
 * Rural roads run 20-30% longer than the straight line between points, so a
 * straight-line sum underestimates the routed distance.
 */
const WINDING_FACTOR = 1.25;

/** Penalty weights when ranking POI candidates for one target bearing. */
const BEARING_ERROR_WEIGHT = 2.5; // per 10 degrees off the target bearing
const RADIUS_ERROR_WEIGHT = 1.5; // per 5 km off the ring radius
const CLUSTER_PENALTY = 6; // for sitting on top of an already-chosen stop
/**
 * Stops closer together than this share of the ring radius count as one
 * place (floored at 1.5 km). A fixed 5 km made every stop of a 20 km loop
 * "clustered", so the penalty stopped meaning anything at short distances.
 */
const CLUSTER_RADIUS_SHARE = 0.7;
const CLUSTER_RADIUS_MIN_M = 1500;

/**
 * Unnamed POIs are worth riding to but can't be named in a route title, and
 * OSM has a great many nondescript `ford=yes` culverts tagged identically to
 * real river crossings. Without this, every stop near Sigulda came back as an
 * anonymous "ford" and route names had nothing to work with.
 */
const UNNAMED_PENALTY = 3;

/** Stops closer to the start than this share of the ring radius are rejected. */
const MIN_STOP_RADIUS_SHARE = 0.6;

export type PlanLoopParams = {
  start: { lat: number; lon: number };
  includeSightseeing?: boolean;
  /** ring to take anchor directions from; omit to use a plain circle */
  ring?: IsoRing;
  /** fallback radius when no ring is available */
  fallbackRadiusMeters: number;
  stopCount: number;
  /** rotates the whole layout, so variants explore different sides */
  bearingOffsetDeg: number;
  /** restrict stops to a direction, e.g. "towards Sigulda" */
  sector?: BearingSector | null;
  /** a place the rider explicitly asked to pass through */
  mandatoryVia?: { lat: number; lon: number } | null;
};

function rankCandidate(
  poi: Poi,
  targetBearing: number,
  bearingOf: (p: Point) => number,
  radiusOf: (p: Point) => number,
  targetRadius: number,
  chosen: LoopStop[]
): number {
  // The same place twice is not a stop, it is a hairpin: "Tukuma pilskalns un
  // Tukuma pilskalns loks" came from the cluster penalty being outbid by a
  // high POI score.
  if (chosen.some((s) => s.poi?.id === poi.id)) return -Infinity;

  const point: Point = [poi.lon, poi.lat];
  // A stop close to the start is not a stop, it is a detour through town:
  // Riga loops kept picking viewpoints 3 km out inside the city and rode
  // 50 km of streets to link them. Half the ring radius is the floor.
  if (radiusOf(point) < targetRadius * MIN_STOP_RADIUS_SHARE) return -Infinity;

  const bearingError = Math.abs(angleDiff(bearingOf(point), targetBearing));
  const radiusError = Math.abs(radiusOf(point) - targetRadius);
  const clusterRadius = Math.max(CLUSTER_RADIUS_MIN_M, targetRadius * CLUSTER_RADIUS_SHARE);
  const clustered = chosen.some(
    (s) => haversineMeters(s.point, point) < clusterRadius
  );

  const named = !!(poi.nameLv ?? poi.nameEn);

  return (
    poi.score -
    BEARING_ERROR_WEIGHT * (bearingError / 10) -
    RADIUS_ERROR_WEIGHT * (radiusError / 5000) -
    (clustered ? CLUSTER_PENALTY : 0) -
    (named ? 0 : UNNAMED_PENALTY)
  );
}

/** Target bearings for `count` stops, fanned across a sector when given. */
function targetBearings(
  count: number,
  offsetDeg: number,
  sector: BearingSector | null | undefined
): number[] {
  if (!sector) {
    return Array.from({ length: count }, (_, i) => offsetDeg + i * (360 / count));
  }
  // Fan across the sector rather than stacking on its axis, so a directional
  // hint still yields a loop and not an out-and-back corridor.
  const span = sector.halfWidthDeg * 2;
  // Small shifts explore nearby corridors while staying in the same sector.
  const phase = Math.max(-0.4, Math.min(0.4, offsetDeg / 90));
  return Array.from(
    { length: count },
    (_, i) => sector.centreDeg - sector.halfWidthDeg + (i + 0.5 + phase) * (span / count)
  );
}

export function planLoop(params: PlanLoopParams): LoopPlan {
  const origin: Point = [params.start.lon, params.start.lat];
  const bearingOf = (p: Point) => bearingDegrees(origin, p);
  const radiusOf = (p: Point) => haversineMeters(origin, p);

  let anchors: Anchor[] = params.ring ? ringAnchors(params.ring, params.start) : [];
  if (params.sector) {
    const inside = anchors.filter((a) => inSector(a.bearingDeg, params.sector!));
    // Never silently search the opposite direction. Empty sectors fall
    // back to geometric anchors inside the requested sector.
    anchors = inside;
  }

  const medianRadius =
    anchors.length > 0
      ? anchors.map((a) => a.radiusMeters).sort((x, y) => x - y)[
          Math.floor(anchors.length / 2)
        ]
      : params.fallbackRadiusMeters;

  const bearings = targetBearings(
    params.stopCount,
    params.bearingOffsetDeg,
    params.sector
  );

  const chosen: LoopStop[] = [];
  for (const bearing of bearings) {
    // Where to look: the isochrone boundary in this direction if we have one,
    // otherwise a plain circle.
    const anchor = anchorNearestBearing(anchors, bearing);
    const searchCentre: Point =
      anchor?.point ?? destinationPoint(origin, bearing, params.fallbackRadiusMeters);

    if (!params.includeSightseeing) {
      chosen.push({ point: searchCentre });
      continue;
    }

    let best: { poi: Poi; value: number } | null = null;
    for (const share of POI_SEARCH_SHARES) {
      const radius = Math.min(
        POI_SEARCH_MAX_M,
        Math.max(POI_SEARCH_MIN_M, medianRadius * share)
      );
      const nearby = poisNear({ lat: searchCentre[1], lon: searchCentre[0] }, radius);
      for (const poi of nearby) {
        if (params.sector && !inSector(bearingOf([poi.lon, poi.lat]), params.sector)) continue;
        const value = rankCandidate(
          poi,
          bearing,
          bearingOf,
          radiusOf,
          medianRadius,
          chosen
        );
        if (value > -Infinity && (!best || value > best.value)) best = { poi, value };
      }
      if (best) break;
    }

    if (best) {
      chosen.push({ point: [best.poi.lon, best.poi.lat], poi: best.poi });
    } else {
      // No POI anywhere near this bearing: use the anchor itself. Still on or
      // beside routable road when it came from an isochrone.
      chosen.push({ point: searchCentre });
    }
  }

  if (params.mandatoryVia) {
    const point: Point = [params.mandatoryVia.lon, params.mandatoryVia.lat];
    if (!chosen.some((s) => haversineMeters(s.point, point) < CLUSTER_RADIUS_MIN_M)) {
      chosen.push({ point });
    }
  }

  // Bearing order is what keeps the tour from crossing itself.
  chosen.sort((a, b) => params.sector
    ? angleDiff(bearingOf(a.point), params.sector.centreDeg) - angleDiff(bearingOf(b.point), params.sector.centreDeg)
    : bearingOf(a.point) - bearingOf(b.point));

  const viaPoints = chosen.map((s) => s.point);
  const legs = [origin, ...viaPoints, origin];
  let straightMeters = 0;
  for (let i = 1; i < legs.length; i++) {
    straightMeters += haversineMeters(legs[i - 1], legs[i]);
  }

  return {
    viaPoints,
    stops: chosen,
    radiusMeters: medianRadius,
    estimatedKm: Math.round(((straightMeters * WINDING_FACTOR) / 1000) * 10) / 10,
  };
}
