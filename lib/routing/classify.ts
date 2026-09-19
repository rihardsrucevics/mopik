import { angleDiff, bearingDegrees, haversineMeters } from "@/lib/geo/geometry";
import { estimateRideSeconds } from "./speed";
import { isUnverifiedMotorPath } from "./access";
import { bboxOf, gateLookup, hasGateData, type GateLookup } from "@/lib/geo/gates";
import { seaLookup, hasSeaData, type SeaLookup } from "@/lib/geo/sea";
import { riddenStepFlags, riddenMetersFrom } from "./ridden";
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

/**
 * The way classes a gate is collected on.
 *
 * It must match `GATE_HIGHWAYS` in `lib/geo/gates.ts`, which is the set the
 * dataset was *built* from: a barrier node is only kept when it is a member of
 * a `track`, `service` or `unclassified` way. Checking it again here is a cheap
 * pre-filter, not the test — the vertex match below is what decides. Kept
 * because it skips the lookup entirely on the asphalt majority of a ride.
 */
const GATE_HIGHWAY_CLASSES = new Set(["track", "service", "unclassified"]);

/**
 * How close a route vertex must be to a gate to BE that gate, in metres.
 *
 * This is a rounding tolerance and nothing else. A gate that is a member of a
 * ridden way is, by construction, one of that way's nodes — so BRouter returns
 * it as a **vertex of the route geometry**, at the same OSM node's coordinates.
 * The only gap between the two numbers is decimal rounding: the dataset and the
 * route are both stored to 5–6 decimals, which is ~1 m of latitude. 1.5 m
 * covers that and nothing else.
 *
 * ## Why this replaced a 15 m point-to-segment radius, 2026-09-14
 *
 * The first build asked "is there a gate near this stretch of line" and got the
 * wrong gates. The rider, reading the live map:
 *
 *   "Ja vārti nav uz paša maršruta ceļa — jāņem ārā."
 *
 * If the gate is not on the route's own road, take it out. What it was marking
 * were **driveway gates**: the barrier across a house's access road, 10–15 m off
 * the orange line, on a `service` way the rider never touches. Proximity cannot
 * tell those from a gate across the ridden track, because at 10 m they are the
 * same measurement — a driveway gate is *supposed* to be near the road it
 * leaves. Vertex identity can, exactly, and with no threshold to argue about:
 * either the router rode through that node or it did not.
 */
const GATE_VERTEX_TOLERANCE_M = 1.5;

/**
 * How many gates stand on the roads this route rides, and where.
 *
 * This is backlog item 12 as the rider settled it — a **fact only**:
 *
 *   "šī pieeja nav korekta — mēs nevaram minēt; vairumā gadījumu tur nebūs
 *   ierobežojuma; ja mums nav datu par privātajiem ceļiem, labāk šo ceļu no
 *   maršruta neizslēgt. Sākam vismaz ar vārtiem."
 *
 * We cannot guess. The build that inferred a farmyard from buildings on both
 * sides, from `landuse` polygons and from dead-ending at a cluster is gone with
 * its 9.4 MB of data; what is left is the one thing OSM states outright — a
 * `barrier=gate|lift_gate|swing_gate|chain|bollard|cattle_grid` node that is a
 * **member of** the way's own node list. Membership, not proximity.
 *
 * And membership is what is tested here, not nearness: a gate counts only when
 * it is a **vertex of the route geometry** (`GATE_VERTEX_TOLERANCE_M`). The
 * rider's rule, after the first build marked the gates on driveways beside the
 * road — "ja vārti nav uz paša maršruta ceļa — jāņem ārā".
 *
 * **Nothing here changes a route.** No cost, no penalty, no rejection, no
 * ranking term. A Latvian forest gate stands open more often than not, which is
 * precisely why it is reported rather than avoided: the rider wants to know a
 * gate is coming, not to be routed twenty kilometres around one.
 *
 * A **count**, not kilometres, and that is the product decision: a gate is a
 * point on the road. "0.74 km of gate" was the old shape's answer and it meant
 * nothing — it was the length of the shape segment the gate happened to sit on.
 * "Vārti uz ceļa · 3" is what a rider can act on.
 *
 * `count` is `undefined` — never 0 — where no published country covers the
 * ride. Absent data means "not measured", not "no gates", exactly as
 * `sparsePlaceData` says for POIs, and the UI stays silent rather than claiming
 * a clean road it has never looked at. Only Latvia is built.
 */
type GateMeasurement = {
  /** distinct gates ON the ridden way, or `undefined` where nothing is published */
  count: number | undefined;
  /** how many gates sit on each coordinate pair, for the segment flag and the markers */
  perPair: number[] | null;
  /** every gate's position, in the order they are met — what the map marks */
  points: [number, number][];
};

const EMPTY_GATES: GateMeasurement = { count: undefined, perPair: null, points: [] };

function measureGates(path: RoutePath, lookup: GateLookup | null): GateMeasurement {
  const coords = path.coordinates;
  // A covered bbox with nothing published in it is still a measurement: the
  // caller has already checked `hasGateData`, so a null lookup here means the
  // country files hold no gate near this ride — which is a real zero.
  if (!lookup || coords.length < 2) return EMPTY_GATES;

  // Which VERTICES sit on a gateable way. A vertex belongs to the pairs on
  // either side of it, so a vertex counts when either of them is gateable —
  // the node where a track meets the road it leaves from is on the track.
  // This is only a pre-filter that skips the lookup along the asphalt majority
  // of a ride; the vertex match below is the actual test.
  const gateable = new Array<boolean>(coords.length).fill(false);
  for (const edge of path.edges) {
    const hw = edge.tags?.highway ?? edge.use ?? "";
    if (!GATE_HIGHWAY_CLASSES.has(hw)) continue;
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = Math.max(0, edge.beginShapeIndex); i <= end; i++) gateable[i] = true;
  }

  const perPair = new Array<number>(coords.length - 1).fill(0);
  const points: [number, number][] = [];
  // One gate is one gate: a route that rides the same track twice passes the
  // same node twice, and the rider asked how many gates are on the road, not
  // how many times the line meets one.
  const seen = new Set<string>();

  for (let i = 0; i < coords.length; i++) {
    if (!gateable[i]) continue;
    // `gateAt` takes lat, lon. A gate ON the ridden way is this very vertex, so
    // the tolerance only has to absorb the two sides' coordinate rounding —
    // never the tens of metres that would also catch the gate on the driveway
    // leaving the road here, which is the whole point.
    const gate = lookup.gateAt(coords[i][1], coords[i][0], GATE_VERTEX_TOLERANCE_M);
    if (!gate) continue;
    const key = `${gate.lon},${gate.lat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    points.push([gate.lon, gate.lat]);
    // Attribute it to the pair starting here, or — at the very last vertex,
    // which starts no pair — to the one ending there, so the gate lands on a
    // real segment and the map can mark it.
    perPair[Math.min(i, perPair.length - 1)] += 1;
  }

  return { count: seen.size, perPair, points };
}

/**
 * The classes that may carry a coastal kilometre.
 *
 * `highway=path` is excluded, and that exclusion is the whole point of doing
 * this in code rather than by distance alone. Item 11a spent a day removing
 * 12.2 km of beach and dune footpath from one leg; a coastal *bonus* that
 * counted paths would hand that straight back, because on the Baltic the thing
 * physically nearest the water is usually the beach path. The rider's rule is
 * explicit about it:
 *
 *   "braukt gar krastu pa īstu ceļu jābūt labāk … pa īstu ceļu" — on a REAL
 *   road.
 *
 * So footway/cycleway/bridleway/steps go with it: everything in TRAIL_USES is
 * refused or dear already, and none of it is what "a real road" means. Tracks
 * stay in — item 11b measured that `highway=track` carries most of the coastal
 * kilometres these rides already collect (37.9 of Ventspils → Kolka's 46.4),
 * and a forest track along the dunes is exactly the riding asked for.
 */
const COAST_EXCLUDED_HIGHWAYS = TRAIL_USES;

/**
 * How near the sea a kilometre has to be to count, in metres.
 *
 * Both bands come from item 11b's measurement table, which reported every leg
 * at 300 m / 1 km / 3 km. 1 km is the band that separates "this ride is on the
 * coast road" from "this ride is in the same district as the sea": on
 * Liepāja → Ventspils the coastal P111 sits inside it and the inland line the
 * router actually picks sits at 5–10 km. 3 km is carried as a softer signal —
 * a ride that gets within sight of the water but not onto the shore road —
 * and is weighted far lower in `score.ts` for exactly that reason.
 */
const COAST_NEAR_M = 1000;
const COAST_WIDE_M = 3000;

type CoastMeasurement = {
  coastKm: number;
  coastNearKm: number;
  /** per-coordinate-pair verdict, for the optional segment flag */
  flags: boolean[] | null;
  /** whether any dataset covered this ride at all — 0 means "not measured" */
  measured: boolean;
};

const EMPTY_COAST: CoastMeasurement = { coastKm: 0, coastNearKm: 0, flags: null, measured: false };

/**
 * Which steps of the route run on a road the rider has ridden — item 6.
 *
 * Shaped like `CoastMeasurement` and used the same way: measured once per
 * candidate, asked per edge and per segment. `stepFlags` is per coordinate
 * pair, so it lines up with the segment loop's own index.
 */
type RiddenMeasurement = {
  riddenKm: number;
  stepFlags: boolean[];
};

/**
 * Kilometres ridden near the sea, on a real road.
 *
 * Item 11b established that this cannot come from the router: BRouter's
 * `lookups.dat` has no `natural` key, so no cost script can see a coastline,
 * and `estimated_river_class` — the nearest thing it has — tracks rivers and
 * reads 1 or nothing on the P111, the Pāvilosta seafront and the Kolka cape
 * road. The signal therefore has to be measured against geometry here, the way
 * `measureOverlap` and `measureGates` already are, and spent in ranking.
 *
 * Distances are taken at each sub-segment's midpoint against `lib/geo/sea.ts`.
 * BRouter shape points are 10–40 m apart and the coastline dataset is thinned
 * to a 200 m grid, so the midpoint approximation costs metres against a band
 * of a kilometre — the same approximation `scripts/measure-coast.ts` scores
 * with, deliberately, so the two agree.
 *
 * Returns zeros where no coastline data covers the route. Absent data reads as
 * "not measured", never as "nowhere near the sea".
 */
function measureCoast(path: RoutePath, lookup: SeaLookup | null): CoastMeasurement {
  const coords = path.coordinates;
  if (!lookup || !lookup.size || coords.length < 2) return EMPTY_COAST;

  const flags = new Array<boolean>(Math.max(0, coords.length - 1)).fill(false);

  // Which coordinate pairs sit on a class that may count at all. Everything
  // else is excluded before any distance is measured — see
  // COAST_EXCLUDED_HIGHWAYS for why a beach path must never earn this bonus.
  const onRealRoad = new Array<boolean>(coords.length - 1).fill(false);
  for (const edge of path.edges) {
    const hw = (edge.tags?.highway ?? edge.use ?? "").toLowerCase();
    if (COAST_EXCLUDED_HIGHWAYS.has(hw)) continue;
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = Math.max(0, edge.beginShapeIndex); i < end; i++) onRealRoad[i] = true;
  }

  let nearMeters = 0;
  let wideMeters = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    if (!onRealRoad[i]) continue;
    const a = coords[i];
    const b = coords[i + 1];
    const meters = haversineMeters(a, b);
    if (meters <= 0) continue;
    const distance = lookup.distanceM((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (distance < COAST_WIDE_M) wideMeters += meters;
    if (distance < COAST_NEAR_M) {
      nearMeters += meters;
      flags[i] = true;
    }
  }

  const km = (m: number) => Math.round(m / 100) / 10;
  return { coastKm: km(nearMeters), coastNearKm: km(wideMeters), flags, measured: true };
}

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
function measureQuality(
  path: RoutePath,
  gates: GateMeasurement,
  coast: CoastMeasurement,
  ridden: RiddenMeasurement
): RouteQuality & { turns: number } {
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
    // How much of this edge runs on a road the rider has ridden. Measured on
    // the edge's own steps rather than as a whole-edge verdict: a long edge
    // can join a ridden road part way along it.
    let riddenMeters = 0;
    for (let i = edge.beginShapeIndex + 1; i <= end; i++) {
      if (ridden.stepFlags[i - 1]) riddenMeters += haversineMeters(coords[i - 1], coords[i]);
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
    // Backlog item 6. A path with no positive motor access tag is unverified
    // *because nobody has said either way* — the tag is missing, not negative.
    // Where the rider has ridden the road, somebody has said: he did, and he
    // handed over the GPX saying every road in it is rideable. That is better
    // evidence than an absent OSM tag is evidence to the contrary, so the
    // ridden metres are not counted as unverified and carry no ⚠️.
    //
    // This never touches an *explicit* restriction. `isUnverifiedMotorPath` is
    // only ever true for a `highway=path` lacking a positive tag; a way tagged
    // `motor_vehicle=no|private` is refused by the profile long before here,
    // and no amount of ridden geometry changes that. "We do not guess about
    // private roads" (item 12) still holds — this removes a guess rather than
    // adding one.
    if (isUnverifiedMotorPath(tags)) unverifiedPath += Math.max(0, meters - riddenMeters);

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
    riddenKm: ridden.riddenKm,
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
    // A count, and `undefined` rather than 0 where nothing is published: the
    // panel must be able to stay silent instead of claiming "no gates" about a
    // country nobody has built the data for.
    gateCount: gates.count,
    coastKm: coast.coastKm,
    coastNearKm: coast.coastNearKm,
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
  // Measured once and reused: the lookup carries the loaded country files and
  // the route's own metric frame, and rebuilding it per segment is what made
  // the POI loader slow when it re-derived a country set per call.
  const bbox = coords.length >= 2 ? bboxOf(coords) : null;
  // `hasGateData` first, exactly as the coastline lookup does below: it is the
  // honesty gate as well as the cheap one. Outside a published country the
  // lookup is skipped and `gateCount` stays `undefined` — "not measured", never
  // "no gates".
  const lookup = bbox && hasGateData(bbox) ? gateLookup(bbox) : null;
  const gates = measureGates(path, lookup);
  // Same reasoning as the gate lookup: built once per candidate, asked per
  // segment. `hasSeaData` is checked first so an inland ride never opens a
  // coastline file — the great majority of rides, and the reason this costs
  // nothing away from a coast.
  const sea = bbox && hasSeaData(bbox) ? seaLookup(bbox) : null;
  const coast = measureCoast(path, sea);
  // Roads the rider has ridden, measured once for the whole candidate. Cheap
  // where no GPX covers the area: the loader returns nothing and the matcher
  // is never built.
  const riddenFlags = riddenStepFlags(coords);
  const ridden: RiddenMeasurement = {
    riddenKm: Math.round(riddenMetersFrom(coords, riddenFlags) / 100) / 10,
    stepFlags: riddenFlags,
  };
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];

  const distByRoad: Record<RoadClass, number> = { road: 0, track: 0, trail: 0 };
  const distBySurface: Record<"asphalt" | "gravel" | "dirt" | "unknown", number> = {
    asphalt: 0,
    gravel: 0,
    dirt: 0,
    unknown: 0,
  };

  // How many of `gates.points` have been handed to a segment already.
  let gatesTaken = 0;
  let segStart = 0;
  // `unverified` travels with the segment so the map can mark exactly the
  // stretches the panel already counts in `unverifiedPathKm` — a path with no
  // positive motor access in OSM. Splitting on it too means a run is either
  // wholly unverified or wholly not, never half.
  let current: { roadClass: RoadClass; surface: SurfaceClass; trackGrade?: string; unverified?: boolean } | null = null;
  // Gates accumulate into the run being built rather than splitting it. A gate
  // is a point, not a property of the road: splitting the line at every gate
  // would turn one forest track into three features that are identical in class
  // and surface, cost a dictionary entry and a varint pair each in the share
  // code, and tell the map nothing the count does not.
  let currentGates = 0;
  /**
   * Where those gates are, so the map can put a marker on each one.
   *
   * The positions ride on the segment rather than on the route because
   * `segments` is the only thing that reaches the map — `RouteMap` takes one
   * collection, the detour splicer rebuilds a ride by concatenating features,
   * and a route-level array would be dropped by both. Carried on the feature,
   * a spliced ride keeps exactly the gates of the stretches it kept.
   */
  let currentGatePoints: [number, number][] = [];

  const flush = (endIndex: number) => {
    if (!current || endIndex <= segStart) return;
    const slice = coords.slice(segStart, endIndex + 1);
    let meters = 0;
    for (let i = 1; i < slice.length; i++) meters += haversineMeters(slice[i - 1], slice[i]);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      // `gates` omitted at zero, the way every other optional flag is: it keeps
      // the property out of the great majority of features, and `undefined`
      // and absent read the same at every call site.
      properties: {
        ...current,
        ...(currentGates > 0
          ? { gates: currentGates, gatePoints: currentGatePoints }
          : {}),
        distanceMeters: Math.round(meters),
      },
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
    // Same rule the km accounting uses: a path the rider has ridden is not
    // unverified, so it carries no ⚠️ on the map either. The two must agree —
    // a badge on a stretch the panel does not count reads as a bug.
    const unverified = isUnverifiedMotorPath(edge?.tags) && !ridden.stepFlags[i];
    if (
      !current ||
      current.roadClass !== roadClass ||
      current.surface !== surface ||
      current.trackGrade !== trackGrade ||
      Boolean(current.unverified) !== unverified
    ) {
      flush(i);
      segStart = i;
      currentGates = 0;
      currentGatePoints = [];
      current = { roadClass, surface, ...(trackGrade ? { trackGrade } : {}), ...(unverified ? { unverified: true } : {}) };
    }
    // Counted into whichever run is open, including the one just started.
    const here = gates.perPair?.[i] ?? 0;
    if (here > 0) {
      currentGates += here;
      // `perPair` counts and `points` lists, both in coordinate-pair order, so
      // the next `here` positions are this pair's.
      currentGatePoints.push(...gates.points.slice(gatesTaken, gatesTaken + here));
      gatesTaken += here;
    }
  }
  flush(coords.length - 1);

  // No per-segment `coast` flag, deliberately, though `measureCoast` computes
  // the verdicts. Unlike `unverified` it would not be free: it is another key
  // in the run-splitting test above, so every coastal stretch
  // becomes its own feature, and the share code turns each distinct run into a
  // dictionary entry and a varint pair — bytes in every link, for a flag
  // nothing renders. `quality.coastKm` is the number; add the flag when
  // something on the map actually draws it.
  const { turns, ...quality } = measureQuality(path, gates, coast, ridden);
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
