import { angleDiff, bearingDegrees, haversineMeters } from "@/lib/geo/geometry";
import { estimateRideSeconds } from "./speed";
import { isUnverifiedMotorPath } from "./access";
import {
  OverlapStats,
  RoadClass,
  RouteEdge,
  RouteMix,
  RoutePath,
  RouteQuality,
  RouteSegmentProperties,
  SurfaceClass,
  SurfaceMix,
} from "@/lib/types";

/**
 * Classify a routed path into the adventure rider mental model:
 *   Road  = "solid line"  (normal public roads, paved OR gravel)
 *   Track = "dashed line" (highway=track — field/forest access roads)
 *   Trail = "dotted line" (paths & friends — single-track)
 *
 * Road class and surface are deliberately kept as SEPARATE concepts:
 * a gravel unclassified road is still a Road; an asphalt track is still a Track.
 *
 * Input is Valhalla's per-edge attributes. Note its enums differ from OSM's
 * raw tags: `use` carries track/path information (Valhalla's `road_class` has
 * no track or path values at all), and there is no track grade equivalent.
 */

/**
 * Both routers' vocabularies are accepted: BRouter reports the OSM `highway`
 * tag verbatim, Valhalla reports its own `use` enum.
 */
const TRACK_USES = new Set(["track", "driveway", "alley", "parking_aisle"]);
const TRAIL_USES = new Set([
  "footway",
  "cycleway",
  "mountain_bike",
  "steps",
  "sidewalk",
  "path",
  "pedestrian",
  "bridleway",
]);

function toRoadClass(use: string | undefined): RoadClass {
  const v = (use ?? "").toLowerCase();
  if (TRACK_USES.has(v)) return "track";
  if (TRAIL_USES.has(v)) return "trail";
  return "road";
}

/**
 * Surface values cover both raw OSM tags (BRouter reports the tag verbatim)
 * and Valhalla's normalised enum, so either router's output classifies the
 * same way.
 */
function toSurfaceClass(
  surface: string | undefined,
  unpaved?: boolean,
  use?: string
): SurfaceClass {
  // An untagged `highway=track` is a farm or forest track; OSM simply hasn't
  // recorded its surface. Reporting a third of a forest route as "unknown"
  // when its road class already says unpaved is needlessly vague — and shows
  // on the map as washed-out grey rather than as the gravel it is.
  if (!surface && use === "track") return "gravel";

  switch ((surface ?? "").toLowerCase()) {
    // Valhalla enum
    case "paved_smooth":
    case "paved_rough":
    // OSM tags
    case "paved":
    case "asphalt":
    case "concrete":
    case "concrete:plates":
    case "paving_stones":
    case "sett":
    case "cobblestone":
    case "chipseal":
    case "metal":
    case "wood":
      return "asphalt";
    case "compacted":
    case "fine_gravel":
      return "compacted";
    case "gravel":
    case "pebblestone":
    case "unpaved":
      return "gravel";
    case "dirt":
    case "mud":
      return "dirt";
    case "sand":
      return "sand";
    case "ground":
    case "earth":
    case "grass":
    case "path":
    case "impassable":
      return "ground";
    default:
      // No surface reported: the unpaved flag is still a useful signal.
      return unpaved ? "gravel" : "unknown";
  }
}

export type ClassifiedRoute = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  roadMix: RouteMix;
  surfaces: SurfaceMix;
  overlap: OverlapStats;
  quality: RouteQuality;
  /** riding time from the surface-aware speed model, not the router's flat rate */
  durationSeconds: number;
};

const STREET_HIGHWAYS = new Set(["residential", "living_street", "service"]);
const ROUGH_SMOOTHNESS = new Set(["bad", "very_bad", "horrible", "very_horrible", "impassable"]);
type Landscape = "forest" | "riverside" | "open" | "urban";

function classNumber(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** BRouter returns DEM height as the third geometry ordinate. Smooth it before
 * accumulating ascent so one-metre raster noise does not become fake hills. */
function measureElevation(path: RoutePath): { gain: number; range: number } {
  if (!path.elevations || path.elevations.length !== path.coordinates.length) return { gain: 0, range: 0 };
  const samples: number[] = [];
  let run = 0;
  for (let i = 0; i < path.coordinates.length; i++) {
    if (i > 0) run += haversineMeters(path.coordinates[i - 1], path.coordinates[i]);
    const elevation = path.elevations[i];
    if (elevation === null || (samples.length > 0 && run < 100 && i < path.coordinates.length - 1)) continue;
    samples.push(elevation);
    run = 0;
  }
  if (samples.length < 2) return { gain: 0, range: 0 };
  const smooth = samples.map((value, index) => {
    const from = Math.max(0, index - 1);
    const to = Math.min(samples.length, index + 2);
    return samples.slice(from, to).reduce((sum, item) => sum + item, 0) / (to - from);
  });
  let gain = 0;
  for (let i = 1; i < smooth.length; i++) gain += Math.max(0, smooth[i] - smooth[i - 1]);
  return {
    gain: Math.round(gain / 10) * 10,
    range: Math.round(Math.max(...smooth) - Math.min(...smooth)),
  };
}

/**
 * Rider's-eye quality from the raw tags plus the shape.
 *
 * These are the things the 2026-09-03 audit found riders notice and the mix
 * percentages hide: a route can be 60% gravel and still be miserable if it
 * is 45% suburb streets, or flips between asphalt and gravel 120 times. The
 * tags only arrive because the profile references them (BRouter reports
 * nothing the profile doesn't mention), so a route without edge detail
 * reports zeros rather than guesses.
 */
function measureQuality(path: RoutePath): RouteQuality & { turns: number } {
  const coords = path.coordinates;
  let rough = 0;
  let sand = 0;
  let street = 0;
  let unverifiedPath = 0;
  let forest = 0;
  let riverside = 0;
  let ruralOpen = 0;
  let noisy = 0;
  let hasLandscapeSignal = false;
  const landscapeMeters: Record<Exclude<Landscape, "urban">, number> = { forest: 0, riverside: 0, open: 0 };
  const landscapeRuns: { type: Landscape; meters: number }[] = [];
  let switches = 0;
  let lastUnpaved: boolean | null = null;

  for (const edge of path.edges) {
    const tags = edge.tags ?? {};
    let meters = 0;
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = edge.beginShapeIndex + 1; i <= end; i++) {
      meters += haversineMeters(coords[i - 1], coords[i]);
    }
    const hw = tags.highway ?? edge.use ?? "";

    if (
      hw === "track" &&
      (tags.tracktype === "grade4" || tags.tracktype === "grade5" || ROUGH_SMOOTHNESS.has(tags.smoothness ?? ""))
    ) {
      rough += meters;
    }
    if (tags.surface === "sand") sand += meters;
    if (STREET_HIGHWAYS.has(hw)) street += meters;
    if (isUnverifiedMotorPath(tags)) unverifiedPath += meters;

    const forestClass = classNumber(tags.estimated_forest_class);
    const riverClass = classNumber(tags.estimated_river_class);
    const townClass = classNumber(tags.estimated_town_class);
    const noiseClass = classNumber(tags.estimated_noise_class);
    if (tags.estimated_forest_class || tags.estimated_river_class || tags.estimated_town_class || tags.estimated_noise_class) hasLandscapeSignal = true;
    if (forestClass >= 3) forest += meters;
    if (riverClass >= 4) riverside += meters;
    if (noiseClass >= 4) noisy += meters;

    const landscape: Landscape = townClass >= 4 || STREET_HIGHWAYS.has(hw)
      ? "urban"
      : riverClass >= 4
        ? "riverside"
        : forestClass >= 3
          ? "forest"
          : "open";
    if (landscape === "open") ruralOpen += meters;
    if (landscape !== "urban") landscapeMeters[landscape] += meters;
    const lastRun = landscapeRuns.at(-1);
    if (lastRun?.type === landscape) lastRun.meters += meters;
    else landscapeRuns.push({ type: landscape, meters });

    const unpaved =
      edge.unpaved ?? (hw === "track" || (tags.tracktype !== undefined && tags.tracktype !== "grade1"));
    if (lastUnpaved !== null && unpaved !== lastUnpaved) switches++;
    lastUnpaved = unpaved;
  }

  // Heading change between consecutive ~40 m steps; over 70° reads as a
  // turn at a junction rather than a bend in the road.
  let turns = 0;
  let prevBearing: number | null = null;
  let run = 0;
  let lastIdx = 0;
  for (let i = 1; i < coords.length; i++) {
    run += haversineMeters(coords[i - 1], coords[i]);
    if (run < 40) continue;
    const b = bearingDegrees(coords[lastIdx], coords[i]);
    if (prevBearing !== null && Math.abs(angleDiff(prevBearing, b)) > 70) turns++;
    prevBearing = b;
    lastIdx = i;
    run = 0;
  }
  const totalKm = path.distanceMeters / 1000 || 1;
  const totalMeters = path.distanceMeters || 1;
  const meaningfulRunMeters = Math.max(600, totalMeters * 0.006);
  const meaningfulRuns = landscapeRuns.filter((run) => run.type !== "urban" && run.meters >= meaningfulRunMeters);
  let landscapeTransitions = 0;
  for (let i = 1; i < meaningfulRuns.length; i++) {
    if (meaningfulRuns[i - 1].type !== meaningfulRuns[i].type) landscapeTransitions++;
  }
  const materialLandscapeMeters = Math.max(1000, totalMeters * 0.04);
  const landscapeTypes = Object.values(landscapeMeters).filter((meters) => meters >= materialLandscapeMeters).length;
  const elevation = measureElevation(path);

  // Bounded components prevent one feature (for example 40 km beside the
  // same river) from beating a genuinely varied ride by itself.
  const forestValue = Math.min(1, forest / totalMeters / 0.55);
  const riverValue = Math.min(1, riverside / totalMeters / 0.18);
  const openValue = Math.min(1, ruralOpen / totalMeters / 0.35);
  const varietyValue = landscapeTypes / 3;
  const transitionValue = Math.min(1, landscapeTransitions / Math.max(2, totalKm / 25));
  const hillValue = Math.min(1, elevation.gain / totalKm / 8);
  const quietValue = 1 - Math.min(1, noisy / totalMeters / 0.25);
  const natureScore = hasLandscapeSignal
    ? Math.round(100 * (0.28 * forestValue + 0.18 * riverValue + 0.10 * openValue + 0.18 * varietyValue + 0.10 * transitionValue + 0.10 * hillValue + 0.06 * quietValue))
    : 0;

  const km = (m: number) => Math.round(m / 100) / 10;
  return {
    turns,
    roughTrackKm: km(rough),
    sandKm: km(sand),
    streetKm: km(street),
    unverifiedPathKm: km(unverifiedPath),
    surfaceSwitches: switches,
    turnsPer10Km: Math.round((turns / totalKm) * 100) / 10,
    forestKm: km(forest),
    riversideKm: km(riverside),
    ruralOpenKm: km(ruralOpen),
    landscapeTransitions,
    landscapeTypes,
    elevationGainM: elevation.gain,
    elevationRangeM: elevation.range,
    natureScore,
  };
}

/**
 * How much of the route retraces ground it already covered.
 *
 * Measured on the geometry itself: each consecutive coordinate pair is one
 * piece of road, keyed on its two endpoints with the order removed, so riding
 * a stretch in the opposite direction counts as the same road. Everything
 * beyond the first pass over a piece is retraced.
 *
 * Three router-attribute approaches were tried first and all misreport:
 *  - repeated Valhalla `edge.id` reads ~0% even for a pure out-and-back,
 *    because its edge ids are directional;
 *  - any repeated OSM `way_id` reads ~80% for good loops, because one way is
 *    split across many consecutive edges;
 *  - keying on tag signature plus length (needed because BRouter reports no
 *    way ids) under-reports: a delivered 15.8 km Tukums loop measured 39%
 *    that way while the geometry showed 48% ridden twice.
 *
 * Working from coordinates also makes the number independent of which router
 * produced the route, and directly checkable against an exported GPX.
 */
function measureOverlap(coordinates: [number, number][]): OverlapStats {
  let riddenKm = 0;
  let repeatedKm = 0;
  const seen = new Set<string>();

  // ~1 m of precision: enough that the same road matches, not so much that
  // routers' rounding splits one piece of road into two.
  const key = (p: [number, number]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

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

/** Attribute lookup per coordinate index, from the edge shape-index ranges. */
function buildIndexLookup(edges: RouteEdge[], coordCount: number): (RouteEdge | undefined)[] {
  const byIndex: (RouteEdge | undefined)[] = new Array(coordCount).fill(undefined);
  for (const edge of edges) {
    const end = Math.min(edge.endShapeIndex, coordCount - 1);
    for (let i = Math.max(0, edge.beginShapeIndex); i < end; i++) {
      byIndex[i] = edge;
    }
  }
  return byIndex;
}

export function classifyRoute(path: RoutePath): ClassifiedRoute {
  const coords = path.coordinates;
  const edgeAt = buildIndexLookup(path.edges, coords.length);
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];

  const distByRoad: Record<RoadClass, number> = { road: 0, track: 0, trail: 0 };
  const distBySurface: Record<"asphalt" | "gravel" | "dirt" | "unknown", number> = {
    asphalt: 0,
    gravel: 0,
    dirt: 0,
    unknown: 0,
  };

  let segStart = 0;
  // `unverified` travels with the segment so the map can mark exactly the
  // stretches the panel already counts in `unverifiedPathKm` — a path with no
  // positive motor access in OSM. Splitting on it too means a run is either
  // wholly unverified or wholly not, never half.
  let current: { roadClass: RoadClass; surface: SurfaceClass; trackGrade?: string; unverified?: boolean } | null = null;

  const flush = (endIndex: number) => {
    if (!current || endIndex <= segStart) return;
    const slice = coords.slice(segStart, endIndex + 1);
    let meters = 0;
    for (let i = 1; i < slice.length; i++) meters += haversineMeters(slice[i - 1], slice[i]);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      properties: { ...current, distanceMeters: Math.round(meters) },
    });

    distByRoad[current.roadClass] += meters;
    if (current.surface === "asphalt") distBySurface.asphalt += meters;
    else if (current.surface === "gravel" || current.surface === "compacted")
      distBySurface.gravel += meters;
    else if (["ground", "dirt", "sand"].includes(current.surface))
      distBySurface.dirt += meters;
    else distBySurface.unknown += meters;
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const edge = edgeAt[i];
    const roadClass = toRoadClass(edge?.use);
    const surface = toSurfaceClass(edge?.surface, edge?.unpaved, edge?.use);
    const trackGrade = roadClass === "track" ? edge?.tags?.tracktype : undefined;
    const unverified = isUnverifiedMotorPath(edge?.tags);

    if (
      !current ||
      current.roadClass !== roadClass ||
      current.surface !== surface ||
      current.trackGrade !== trackGrade ||
      Boolean(current.unverified) !== unverified
    ) {
      flush(i);
      segStart = i;
      current = { roadClass, surface, ...(trackGrade ? { trackGrade } : {}), ...(unverified ? { unverified: true } : {}) };
    }
  }
  flush(coords.length - 1);

  const { turns, ...quality } = measureQuality(path);
  const total = distByRoad.road + distByRoad.track + distByRoad.trail || 1;
  const pct = (m: number) => Math.round((m / total) * 100);
  const km = (m: number) => Math.round(m / 100) / 10;

  return {
    segments: { type: "FeatureCollection", features },
    overlap: measureOverlap(coords),
    quality,
    durationSeconds: estimateRideSeconds(path, turns),
    roadMix: {
      roadPercent: pct(distByRoad.road),
      trackPercent: pct(distByRoad.track),
      trailPercent: pct(distByRoad.trail),
      roadKm: km(distByRoad.road),
      trackKm: km(distByRoad.track),
      trailKm: km(distByRoad.trail),
    },
    surfaces: {
      asphaltPercent: pct(distBySurface.asphalt),
      gravelPercent: pct(distBySurface.gravel),
      dirtPercent: pct(distBySurface.dirt),
      unknownPercent: pct(distBySurface.unknown),
    },
  };
}
