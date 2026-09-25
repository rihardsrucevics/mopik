import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, nextPlanQuestion, planToIntent } from "@/lib/chat/ride-plan";
import { MAX_STOPS } from "@/lib/chat/ride-limits";
import { interleaveShapes, type ShapePoint } from "@/lib/routing/shape-points";
import { estimateLegs } from "@/lib/chat/feasibility";
import { plannedAvgSpeedKmh } from "@/lib/routing/speed";
import { hasBeachLikePath, hasUnverifiedMotorPath } from "@/lib/routing/access";
import { visitsRequiredStops } from "@/lib/routing/required-stops";
import {
  expectedAvgSpeedKmh,
  parseDestinationPlace,
  parseRoutePrompt,
  parseStartPlace,
  resolveTargetDistanceKm,
} from "@/lib/ai/parse-route-prompt";
import { bearingDegrees, destinationPoint, haversineMeters, inSector, type BearingSector } from "@/lib/geo/geometry";
import { geocode, GeocodeResult } from "@/lib/geo/geocode";
import { findResolvedPlace, type ResolvedPlace } from "@/lib/chat/places";
// Isochrones come from Valhalla (BRouter has none); the routes themselves
// come from BRouter, whose profile we write ourselves — on 25-30 km Baltic
// legs that yields 57-92% unpaved against Valhalla's 1-50%.
import { fetchIsochrone } from "@/lib/routing/valhalla";
import { fetchRoutePath, probeSnapPoint } from "@/lib/routing/brouter";
import { canOfferMove, checkRoutablePoint } from "@/lib/routing/routable-point";
// The feasibility probe: one timed leg before the search, so a ride Mopik
// cannot plan in one go is named up front instead of after a 50 s wait.
import {
  affordableCandidates,
  candidateCostSeconds,
  directLegOffer,
  DIRECT_OFFER_PROFILE,
  probeSegments,
  rideSegments,
  segmentsWorthProbing,
  PROBE_BUDGET_MS,
  snapDistanceM,
} from "@/lib/routing/fetch-route-probe";
import { buildMotoProfileOptions, type MotoProfileOptions } from "@/lib/routing/moto-profile";
import { buildCostingOptions, profileName } from "@/lib/routing/profiles";
import { pruneOrLoopSpurs, pruneSpurs, spurLoopsFor } from "@/lib/routing/prune-spurs";
import { joinPaths } from "@/lib/routing/join-paths";
import { loopRank, meetsRideLimits } from "@/lib/routing/score";
import { classifyRoute } from "@/lib/routing/classify";
import { measureTetCoverage } from "@/lib/routing/tet-coverage";
import { hasPlaceData } from "@/lib/geo/poi";
import { pickTetSlice } from "@/lib/routing/tet";
import { pickRiddenSlice } from "@/lib/routing/ridden";
import { parseIsochrone, type IsoRing } from "@/lib/geo/isochrone";
import { planLoop, type LoopStop } from "@/lib/routing/loop";
// Item 11d: via points placed on the coastal side of an A-to-B corridor, and
// the rule that folds them in without spending time the generation lacks.
import { dropOffshoreVias, seawardBearing, seawardCorridors, seawardVias, withSeawardCandidates, type ViaProbe } from "@/lib/routing/seaward";
import { detectLocale, nameLoop, stopLabels } from "@/lib/routing/name-route";
// The direct-road offer reuses the share code's simplification: a 600 km car
// route is tens of thousands of points and the refusal must stay small.
import { simplifyIndices, SIMPLIFY_TOLERANCE_M } from "@/lib/share/route-code";
import {
  GeneratedRoute,
  GenerateRouteResponse,
  RoutePath,
  RouteIntent,
  RouteIntentSchema,
  UnplannableVerdict,
  UnreachableStop,
} from "@/lib/types";

/**
 * A generation is a calibration route, up to twelve loop shapes, possibly a
 * second pass, plus one Claude call: 5-30 s normally, ~100 s for a long Riga
 * loop. Vercel's default is 10 s; 60 s is the hobby-plan ceiling.
 */
export const maxDuration = 60;

const RequestSchema = z.object({
  /** optional: places normally come from the prompt itself */
  start: z.string().optional(),
  destination: z.string().optional(),
  prompt: z.string().default(""),
  plan: RidePlanSchema.optional(),
  /**
   * Places the rider picked from the suggestion list, with coordinates. A
   * name that matches one of these is never geocoded again — the pick is the
   * rider's answer to "which Valmiera".
   */
  places: z
    .array(z.object({ name: z.string(), label: z.string(), lat: z.number(), lon: z.number() }))
    // The start, every stop the plan may carry, and the finish.
    .max(MAX_STOPS + 2)
    .optional(),
  /** form controls, used as defaults that the prompt overrides */
  settings: RouteIntentSchema.partial().optional(),
  /** fully resolved intent, e.g. on "Generate another" — skips parsing */
  intent: RouteIntentSchema.optional(),
  /**
   * Start only, no destination, flexible time — "surprise me". Aims for a
   * fuller day than the flexible default so there is something to find.
   */
  lucky: z.boolean().optional(),
  /**
   * Include per-edge raw OSM tags in each route (`debugEdges`). For
   * measurement scripts; never set by the UI.
   */
  debug: z.boolean().optional(),
});

/**
 * The waypoint list each routed path was asked to pass through, for
 * `debugCandidates` only: which via made a candidate's shape (item 28 traced
 * an out-and-back to one this way). Weak, so nothing outlives its request.
 */
const routedThrough = new WeakMap<RoutePath, [number, number][]>();

/** point offset perpendicular to the start→end line at fraction t, by `meters` */
function perpendicularVia(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  t: number,
  meters: number
): [number, number] {
  const midLat = a.lat + (b.lat - a.lat) * t;
  const midLon = a.lon + (b.lon - a.lon) * t;
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((midLat * Math.PI) / 180);
  // direction vector a→b in meters
  const dx = (b.lon - a.lon) * lonScale;
  const dy = (b.lat - a.lat) * latScale;
  const len = Math.hypot(dx, dy) || 1;
  // perpendicular unit vector
  const px = -dy / len;
  const py = dx / len;
  return [midLon + (px * meters) / lonScale, midLat + (py * meters) / latScale];
}

/** One loop shape: how many stops, which way it faces, how far out, from which ring. */
type LoopShape = {
  stops: number;
  bearingOffset: number;
  radiusScale: number;
  contourIndex: number;
  absoluteRadiusMeters?: number;
  exploratory?: boolean;
  sector?: { centreDeg: number; halfWidthDeg: number };
  /** which isochrone ring set to take anchors from; "wide" is the relaxation ring */
  ringSet?: "base" | "wide";
};

type Candidate = {
  variant: string;
  run: () => Promise<{ path: RoutePath; stops?: LoopStop[]; shape?: LoopShape }>;
  /** loops compete on overlap and are pruned to the best few */
  competing?: boolean;
  /**
   * A deliberately out-of-tolerance probe. It doesn't compete for a slot on
   * equal terms — it exists to find out what the area *can* do, so that when
   * nothing inside tolerance loops cleanly the rider is offered a concrete
   * alternative instead of just being told the network won't allow it.
   */
  exploratory?: boolean;
};

/** How many loop shapes survive to the UI. */
const SHOWN_VARIANTS = 2;

/**
 * The place's own name, without the region that labels carry for
 * disambiguation. Labels are "Sigulda · Siguldas novads" and
 * "München · Bayern" — the separator is a middle dot, and splitting on a comma
 * left "München · Bayern Adventure Loop" in the route name once place search
 * went worldwide. Handles both, since older saved labels use commas.
 */
function placeName(label: string): string {
  return label.split(/[·,]/)[0].trim();
}

/**
 * The three versions shown, in this order: the smoothest and quickest way
 * to ride the request, the balanced one the ranking prefers, and the one
 * that goes deepest into the tracks. All three come from the same candidate
 * pool and pass the same acceptance checks; they differ only in what they
 * optimise. A loop cannot be "straight", so for loops "direct" means few
 * turns and few rough tracks; for one-way rides it is close to the direct road.
 */
/**
 * `balanced` is no longer shown — two categories a rider can tell apart beat
 * three that blur — but it stays in the type because share codes created
 * before this carry it and must keep decoding.
 */
export type RouteVariant = "direct" | "balanced" | "complex";

/** Two loops sharing more than this share of their road pieces are one option. */
const DUPLICATE_SHARE = 0.8;
/** Alternatives only need to be a different ride, not a different-looking one. */
const ALTERNATIVE_DUPLICATE_SHARE = 0.95;

/** Undirected road pieces of a shape, the same keying `measureOverlap` uses. */
function roadPieceKeys(coordinates: [number, number][]): Set<string> {
  const keys = new Set<string>();
  const key = (p: [number, number]) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  for (let i = 1; i < coordinates.length; i++) {
    const a = key(coordinates[i - 1]);
    const b = key(coordinates[i]);
    keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
  }
  return keys;
}

/** Above this share of retraced roads a loop is flagged in the UI. */
export const OVERLAP_WARN_PERCENT = 5;

/**
 * Routed loop length divided by anchor radius, measured on POI anchors at
 * Riga / Sigulda / Cesis / Aluksne / Kuldiga with use_trails 0.65.
 *
 * A perfect circle would give 2π ≈ 6.3; the road network never runs straight
 * between anchors, and each extra stop adds detour, so the real factor is far
 * higher and grows with stop count. Anchors go at D / factor, so
 * under-estimating this is what makes loops come back much too long.
 *
 * Spread across regions is wide (at 7 stops: 10.6 near Sigulda vs 16.7 near
 * Kuldiga), so distance is inherently approximate here — acceptable, because
 * the target is covering new ground rather than an exact length.
 *
 * Re-measured for BRouter, which runs far more winding than Valhalla did
 * because it is actively seeking gravel: at 5 stops the ratio is ~30 where
 * Valhalla gave ~15. Using the Valhalla numbers here produced 175 km loops
 * against a 2 h target.
 */
const LOOP_PERIMETER_FACTOR: Record<number, number> = {
  2: 11.4,
  3: 18.2,
  4: 25.3,
  5: 30.2,
  6: 29.7,
  7: 31,
  8: 32,
};

/** Extrapolated past the measured range at the observed ~1.05 per stop. */
function perimeterFactor(stops: number): number {
  return LOOP_PERIMETER_FACTOR[stops] ?? 18.7 + (stops - 8) * 1.35;
}

/**
 * Below this the anchors are so close together that the router treats them as
 * one place and returns whatever length it likes.
 *
 * Lowered for BRouter: with its perimeter factor of ~11 at two stops, a 3 km
 * floor forced a 34 km loop even when the rider asked for 10 km. There is
 * still a floor on what a loop can be — leaving town and returning by other
 * roads costs a certain minimum — but it should come from the road network,
 * not from this constant.
 */
const MIN_ANCHOR_RADIUS_M = 1200;


function anchorRadiusMeters(targetKm: number, stops: number): number {
  return Math.max(MIN_ANCHOR_RADIUS_M, (targetKm * 1000) / perimeterFactor(stops));
}

/**
 * Contours around the target radius. Inner and outer rings cost nothing extra
 * — contour count doesn't change the request price — and give the shape
 * variants something to differ by, plus headroom for distance correction.
 */
const CONTOUR_FRACTIONS = [0.8, 1, 1.25];

async function loopRings(
  start: GeocodeResult,
  anchorRadius: number,
  intent: RouteIntent,
  costingOptions: ReturnType<typeof buildCostingOptions>
): Promise<Map<number, IsoRing[]>> {
  const avgSpeed = expectedAvgSpeedKmh(intent);

  // The ring must land at the anchor radius, so derive the contour from that
  // radius rather than guessing a separate time divisor — the two drifting
  // apart is what put rings 30% too far out. Straight-line reach is slower
  // than road distance, hence the detour allowance when converting radius to
  // minutes.
  const targetRadiusKm = anchorRadius / 1000;
  const ROAD_DETOUR = 1.3;
  const midMinutes = ((targetRadiusKm * ROAD_DETOUR) / avgSpeed) * 60;

  const fc = await fetchIsochrone({
    center: start,
    contoursMinutes: [...new Set(CONTOUR_FRACTIONS.map((f) =>
      Math.max(0.1, Math.min(120, Math.round(midMinutes * f * 10) / 10))
    ))],
    costingOptions,
  });
  return parseIsochrone(fc);
}


/**
 * Scale stops with distance, but never pack many stops into a tiny radius:
 * a 40 km target at 5 stops put anchors 2.6 km out, effectively one place,
 * and the router then wandered off to 96 km against a 40 km target.
 */
function stopsFor(targetKm: number): number {
  // Never fewer than three: two stops is a there-and-back with a kink, and a
  // 30-minute request near Turaida came back 49% retraced for exactly that
  // reason. Three stops is the smallest shape that can be a loop.
  return targetKm < 60
    ? 3
      : targetKm < 90
        ? 4
        : Math.min(8, Math.round(targetKm / 25));
}

type LoopCalibration = {
  /** anchor radius for `stopsFor(targetKm)` stops that should deliver targetKm */
  radiusMeters: number;
  /** target after correcting a duration request by the region's real speed */
  targetKm: number;
  /** the calibration route itself — a real candidate, not thrown away */
  result: { path: RoutePath; stops: LoopStop[] };
  measuredFactor: number;
  measuredKmh: number;
  /**
   * The calibration loop spent a large share of its length on streets: the
   * start is in a town big enough that a loop *around* it stays urban. Such
   * starts get teardrop shapes that leave town in one direction and come back
   * in another.
   */
  cityStart: boolean;
  /** set on the re-planned candidates of a second pass (no calibration route to add) */
  secondPass?: boolean;
};

/** Street share of the calibration loop above which the start counts as a city. */
const CITY_STREET_SHARE = 0.25;

/**
 * Route one loop at the table radius and learn from it.
 *
 * `LOOP_PERIMETER_FACTOR` is a regional average, and the audit showed how far
 * off it can be: for a 200 km Riga request the anchors sat 6 km out, inside
 * the city, and the loop came back at 83-154 km on suburb streets; around
 * Tukums a 2 h request delivered 20 km. One calibration route costs a single
 * request and replaces the constant with the factor this region, this
 * profile and this stop count actually produce. For a duration request the
 * same route also gives the real average speed, so "3 h" becomes the
 * distance three hours cover *here* rather than a table guess.
 */
async function calibrateLoop(
  start: GeocodeResult,
  intent: RouteIntent,
  initialTargetKm: number,
  route: (points: [number, number][]) => Promise<RoutePath>,
  direction?: BearingSector
): Promise<LoopCalibration | null> {
  const stops = stopsFor(initialTargetKm);
  const radius = anchorRadiusMeters(initialTargetKm, stops);
  const startPt: [number, number] = [start.lon, start.lat];

  const plan = planLoop({
    start,
    fallbackRadiusMeters: radius,
    stopCount: stops,
    bearingOffsetDeg: 0,
    sector: direction,
    includeSightseeing: intent.includeSightseeing,
  });
  let path: RoutePath;
  try {
    path = await route([startPt, ...plan.viaPoints, startPt]);
  } catch (err) {
    console.warn("calibration route failed; using table radius:", err);
    return null;
  }

  const routedKm = path.distanceMeters / 1000;
  const classified = classifyRoute(path);
  const measuredKmh = routedKm / Math.max(0.05, classified.durationSeconds / 3600);
  const measuredFactor = path.distanceMeters / radius;

  // A duration request is re-targeted at the speed this region delivers.
  const targetKm =
    intent.distanceKm || !intent.durationHours
      ? initialTargetKm
      : Math.round(intent.durationHours * measuredKmh);

  // The factor moves with stop count (see LOOP_PERIMETER_FACTOR), so carry
  // the table's ratio when the corrected target changes the stop count.
  const newStops = stopsFor(targetKm);
  const factorForNewStops =
    measuredFactor * (perimeterFactor(newStops) / perimeterFactor(stops));
  const tableRadius = anchorRadiusMeters(targetKm, newStops);
  // The factor is not constant in radius: a wider loop runs straighter, so
  // its factor is lower and a proportional correction undershoots (Riga:
  // 105 km at the table radius, 105-159 km after a 1.9x correction against a
  // 200 km target). Over-correct a little.
  const CORRECTION_EXPONENT = 1.3;
  const corrected =
    radius * Math.pow((targetKm * 1000) / Math.max(1, factorForNewStops) / radius, CORRECTION_EXPONENT);
  // Clamped: one route is a sample, not the truth, and a freak island drop
  // or shortcut must not send anchors to the next county.
  const radiusMeters = Math.max(
    MIN_ANCHOR_RADIUS_M,
    Math.min(tableRadius * 3, Math.max(tableRadius * 0.4, corrected))
  );

  console.log(
    `calibration: ${routedKm.toFixed(0)} km at radius ${(radius / 1000).toFixed(1)} km ` +
      `(factor ${measuredFactor.toFixed(1)} vs table ${perimeterFactor(stops)}), ` +
      `${measuredKmh.toFixed(0)} km/h → target ${targetKm} km, radius ${(radiusMeters / 1000).toFixed(1)} km`
  );

  const cityStart = classified.quality.streetKm / Math.max(1, routedKm) > CITY_STREET_SHARE;

  return {
    radiusMeters,
    targetKm,
    result: { path, stops: plan.stops },
    measuredFactor,
    measuredKmh,
    cityStart,
  };
}

type BuiltCandidates = {
  candidates: Candidate[];
  /** loops only: turn further shapes (mutations of good ones) into candidates */
  fromShapes?: (shapes: LoopShape[]) => Candidate[];
  /**
   * Item 11d: A-to-B candidates deliberately routed through the coastal strip.
   * Kept apart from `candidates` because they are merged under the time budget
   * rather than appended to it — see `withSeawardCandidates`.
   */
  seaward?: Candidate[];
};

async function buildCandidates(
  intent: RouteIntent,
  start: GeocodeResult,
  destination: GeocodeResult | null,
  targetKm: number,
  calibration: LoopCalibration | null,
  direction?: BearingSector,
  requiredVia: GeocodeResult[] = [],
  shapePoints: ShapePoint[] = []
): Promise<BuiltCandidates> {
  const costingOptions = buildCostingOptions(intent);
  const startPt: [number, number] = [start.lon, start.lat];

  const profileOptions = buildMotoProfileOptions(intent);
  // The complex version's own profile: as much forest and gravel as the
  // rider's surface choice allows. Asphalt-only riders keep asphalt.
  const deepOptions = intent.gravelPreference > 10
    ? buildMotoProfileOptions({ ...intent, gravelPreference: 100, preferForest: true })
    : profileOptions;
  /**
   * Route one candidate's waypoint list.
   *
   * Item 11g: every point this builder invented is declared as generated, so
   * a leg BRouter refuses is rescued cheaply (shift the via along the
   * corridor, else drop it) instead of spending the endpoint-nudge ring on a
   * guess. The rider's own places are never in that list — they keep the ring.
   * The named points are `startPt`, each `requiredVia` and the destination,
   * which is exactly what `namedPoints` below collects; anything else in the
   * list was put there by the shapes above.
   */
  // The rider's shaping points (2026-09-25) ride with the stops, in the leg
  // each was put in: every candidate shape below is built through them, so
  // the ride keeps the bend he gave it. They are named points — rescued by
  // the endpoint-nudge ring when they sit off a road, never dropped as a
  // guess — but not stops: the visit check below is for stops alone.
  const routedVia = interleaveShapes(requiredVia, shapePoints, (p): GeocodeResult => ({ lat: p.lat, lon: p.lon, label: "" }));
  const namedPoints = new Set(
    [start, ...routedVia, ...(destination ? [destination] : [])].map((p) => `${p.lon},${p.lat}`)
  );
  const route = async (points: [number, number][], options = profileOptions) => {
    const generatedViaIndices = points
      .map((point, index) => ({ point, index }))
      .filter(({ point, index }) =>
        index > 0 && index < points.length - 1 && !namedPoints.has(`${point[0]},${point[1]}`)
      )
      .map(({ index }) => index);
    const path = await fetchRoutePath({ points, profileOptions: options, generatedViaIndices });
    routedThrough.set(path, points);
    const stops = [...requiredVia, ...(destination ? [destination] : [])].map(p => [p.lon, p.lat] as [number, number]);
    // A spur out to a shaping point is the rider's own bend, not a detour the
    // builder invented; it is kept like a spur to a stop.
    const kept = [...stops, ...shapePoints.map((p) => [p.lon, p.lat] as [number, number])];
    // A place the profile cannot route to at all (a centre mapped onto a
    // footway) is reached as closely as the network allows; `fetchRoutePath`
    // says how far that was, and the stop check has to allow the same, or the
    // rescued route is thrown away here before anything can use it.
    const stopTolerance = Math.max(300, (path.endpointMovedMeters ?? 0) + ENDPOINT_SNAP_MARGIN_M);
    if (!visitsRequiredStops(path.coordinates, stops, stopTolerance)) throw new Error("Route did not reach all required stops in order");
    // Item 28: exact out-and-back excursions go on A-to-B rides too, not
    // only on free loops. Measured on the rider's Circle K → Jelgava: a
    // corridor via landed 16 m from the end of a dead-end service road and
    // the ride went 1.26 km in and 1.26 km back; A-to-B rides had skipped
    // this since the 2026-09-09 audit. What that audit protected is protected
    // here instead, per spur: a spur that is the ride's visit to a
    // rider-named stop or the destination stays.
    //
    // A sightseeing LOOP is still left alone. Its anchors are the sights, and
    // pruning the rest reshuffled which shapes seed the mutation search:
    // measured, the Sigulda pick went 2 % → 7 % repeated and Cēsis 3 % →
    // 10 % (Kuldīga unchanged), each by riding further out and back to a sight.
    if (!destination && intent.includeSightseeing) return path;
    let cleaned: RoutePath;
    try {
      // A spur that turned at a via this builder invented is offered as a
      // loop through that country first, the cut only when no loop is cheap
      // (item 28, `pruneOrLoopSpurs`); the ride shares one request allowance.
      cleaned = await pruneOrLoopSpurs(path, {
        protect: kept,
        toleranceMeters: stopTolerance,
        requireCircuit: !destination,
        loop: spurLoopsFor({ ride: intent, profileOptions: options, waypoints: points, generatedViaIndices }),
      });
    }
    catch (error) { if (routedVia.length) return path; throw error; }
    if (cleaned === path) return path;
    routedThrough.set(cleaned, points);
    // Belt and braces: the order check sees the whole ride, the spur check one spur.
    return visitsRequiredStops(cleaned.coordinates, stops, stopTolerance) ? cleaned : path;
  };


  if (routedVia.length || destination) {
    const places = [start, ...routedVia, destination ?? start];
    const directKm = places.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.lat-places[i].lat)*111, (p.lon-places[i].lon)*61), 0);
    const spareMeters = Math.max(0, targetKm-directKm) * 1000;
    // How far the corridors are pushed apart. From the spare budget when
    // there is one, but never less than a share of the leg itself: with a
    // flexible budget the 80 km default left Rīga → Valmiera → Rīga (210 km
    // direct) no spare at all, the offsets shrank to 1 km, and the way back
    // ran on the way out — 34-49% repeated on every candidate.
    const legMeters = (directKm * 1000) / Math.max(1, places.length - 1);
    const reach = Math.min(20000, Math.max(3000, spareMeters / (places.length * 5), legMeters * 0.12));
    // The public brouter.de answers ~2-3 s a route and throttles by IP (Vercel's
    // egress is shared), so there the via search runs a quarter of the shapes
    // and lets the time budget do the rest; self-hosted runs them all.
    const selfHostedVia = selfHostedRouter();
    const scales = intent.rideStyle === "direct" ? [0, 0.25, 0.5] : selfHostedVia ? [0, 0.35, 0.7, 1, 1.4, 1.8, 2.2, 2.8] : [0, 0.7, 1.4, 2.2];
    const candidates: Candidate[] = [];
    // On a round trip the -1 side is the +1 shape ridden the other way round
    // (same roads, same overlap — measured identical to the metre), so there
    // it becomes a different shape instead: the way out at full offset, the
    // way back at about half, bent at other points.
    const roundTrip = !destination;
    // Item 11e: what each via candidate would ride through, and the land-side
    // shape to fall back on when that point turns out to be in the sea.
    const viaProbes: ViaProbe<string>[] = [];
    const mirrorRuns = new Map<string, Candidate>();
    // The via points of a plain (never asymmetric) corridor at any offset — the
    // shape a substitute takes. Kept out of the scale loop so a substitute can
    // use an offset that loop never visits.
    const substituteVias = (s: number, side: number): [number, number][] => {
      const out: [number, number][] = [];
      for (let i = 1; i < places.length; i++) {
        const fractions = intent.rideStyle === "explore" ? [0.3, 0.7] : [0.5];
        for (const fraction of fractions) out.push(perpendicularVia(places[i-1], places[i], fraction, reach*s*side));
      }
      return out;
    };
    const makeSubstitute = (s: number, side: number, variant: string): Candidate => ({
      variant, competing: true, run: async () => {
        const vias = substituteVias(s, side);
        const points: [number, number][] = [startPt];
        let v = 0;
        for (let i = 1; i < places.length; i++) {
          const per = intent.rideStyle === "explore" ? 2 : 1;
          for (let k = 0; k < per; k++) points.push(vias[v++]);
          points.push([places[i].lon, places[i].lat]);
        }
        return { path: await route(points) };
      },
    });
    for (const scale of scales) for (const side of (scale === 0 ? [1] : [1,-1])) {
      const asymmetric = roundTrip && side === -1;
      // The via points this candidate would route through, as a function of
      // which side it is offset to. Item 11e probes one of these against the
      // router before the candidate is allowed to cost a leg, and builds the
      // mirrored candidate from the same function with the side negated — so a
      // substitute is a shape this builder would have produced anyway, not an
      // improvised point.
      const viaPointsFor = (s: number): [number, number][] => {
        const out: [number, number][] = [];
        if (!scale) return out;
        for (let i = 1; i < places.length; i++) {
          const fractions = asymmetric ? (i === 1 ? [0.3, 0.7] : [0.35, 0.65]) : intent.rideStyle === "explore" ? [0.3,0.7] : [0.5];
          const legScale = asymmetric && i > 1 ? scale * 0.55 : scale;
          for (const fraction of fractions) out.push(perpendicularVia(places[i-1], places[i], fraction, reach*legScale*(asymmetric ? 1 : s)));
        }
        return out;
      };
      const makeVia = (s: number, variant: string): Candidate => ({ variant, competing: true, run: async () => {
        const vias = viaPointsFor(s);
        const points: [number, number][] = [startPt];
        let v = 0;
        for (let i = 1; i < places.length; i++) {
          if (scale) {
            const per = asymmetric ? (i === 1 ? 2 : 2) : intent.rideStyle === "explore" ? 2 : 1;
            for (let k = 0; k < per; k++) points.push(vias[v++]);
          }
          points.push([places[i].lon, places[i].lat]);
        }
        return { path: await route(points) };
      }});
      const variant = `via-${scale}-${asymmetric ? "a" : side}`;
      candidates.push(makeVia(side, variant));
      if (scale) {
        // What item 11e probes: the furthest-out via of this candidate, the one
        // most likely to be in the water.
        const own = viaPointsFor(side);
        // What it swaps in when that via is at sea. The plain mirror is NOT a
        // usable substitute here: `scales` is built symmetrically, so
        // `via-1.4-1`'s mirror is exactly `via-1.4--1`, which the pool already
        // has — measured, that routed seven byte-identical pairs. The land side
        // is instead reached at offsets the pool does NOT already hold, halfway
        // between the built scales, so a dropped candidate is replaced by a
        // genuinely different ride rather than by a copy of its neighbour.
        const index = scales.indexOf(scale);
        const next = scales[index + 1];
        const betweens = [
          ...(next ? [(scale + next) / 2] : [scale * 1.3]),
          (scale + (scales[index - 1] ?? 0)) / 2,
        ].filter((s) => s > 0 && !scales.includes(s));
        const substitutes: { item: string; point: [number, number] }[] = [];
        for (const s of betweens) {
          const name = `via-${Math.round(s * 100) / 100}-${-side}s`;
          if (mirrorRuns.has(name)) continue;
          const points = substituteVias(s, -side);
          if (!points.length) continue;
          substitutes.push({ item: name, point: points[points.length - 1] });
          mirrorRuns.set(name, makeSubstitute(s, -side, name));
        }
        viaProbes.push({ item: variant, point: own[own.length - 1] ?? own[0], substitutes });
      }
    }

    // The surroundings. A ride "to Baldone and back" is, for most riders, a
    // ride to ride *around* Baldone: a small ring around each stop, entered
    // on one side and left on the other, spends the spare budget where the
    // rider wanted to be. The corridors out and back are pushed apart like
    // the plain via candidates' (a straight there-and-back retraces ~48%
    // near Riga, offset corridors 1-4%). Routed with the deep profile;
    // competes for the winding and complex slots, never the straight one.
    const viaIndices = places.map((_, i) => i).filter((i) => i > 0 && i < places.length - 1);
    if (viaIndices.length && spareMeters > 6000) {
      const more = intent.surroundings === "more";
      // Radius that spends part of the spare length on rings (perimeter ≈ 2π·1.4r on real roads).
      const spend = spareMeters / (viaIndices.length * 2 * Math.PI * 1.4);
      const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
      // Measured on Rīga → Baldone → Rīga at 3 h: a 2.3 km ring with the deep
      // profile came back 45 min over budget (the whole ride slowed to
      // 27 km/h), so the ring is small and the corridor keeps the rider's own
      // profile; the ring itself is the interest.
      const radii = [
        clamp(spend * (more ? 0.6 : 0.35), 1200, more ? 6000 : 3500),
        ...(selfHostedVia ? [clamp(spend * (more ? 1.0 : 0.6), 1500, more ? 8000 : 5000)] : []),
      ];
      for (const r of radii) for (const side of [1, -1]) {
        candidates.push({ variant: `around-${Math.round(r / 100)}-${side}`, competing: true, run: async () => {
          const points: [number, number][] = [startPt];
          for (let i = 1; i < places.length; i++) {
            const here: [number, number] = [places[i].lon, places[i].lat];
            // A short corridor: the ring is where the time goes.
            points.push(perpendicularVia(places[i - 1], places[i], 0.5, reach * 0.7 * side));
            points.push(here);
            if (viaIndices.includes(i)) {
              // Arrive, swing round one side, pass beyond, come back the other side, leave.
              const b = bearingDegrees([places[i - 1].lon, places[i - 1].lat], here);
              points.push(destinationPoint(here, b + 90 * side, r), destinationPoint(here, b, r), destinationPoint(here, b - 90 * side, r));
            }
          }
          return { path: await route(points) };
        }});
      }
    }

    // Wiggles along the corridor: the overall direction holds, the road does
    // not. Three offsets per leg on one side with the amplitude breathing
    // (wide, narrow, wide) — turns, short opposite-direction stretches and
    // the tracks between, without crossing the line, which retraced half the
    // route when tried. The complex version's raw material.
    if (intent.rideStyle !== "direct") {
      // Two flavours: the rider's profile with a wide wiggle, the deep
      // profile with a narrow one (deep tracks are slow; the budget is time).
      const flavours = selfHostedVia ? ([[1.2, profileOptions], [0.7, deepOptions]] as const) : ([[0.7, deepOptions]] as const);
      for (const [scale, options] of flavours) {
        candidates.push({ variant: `zig-${scale}`, competing: true, run: async () => {
          const points: [number, number][] = [startPt];
          for (let i = 1; i < places.length; i++) {
            const side = 1;
            for (const [fraction, amplitude] of [[0.2, 1], [0.5, 0.35], [0.8, 1]] as const) {
              points.push(perpendicularVia(places[i - 1], places[i], fraction, reach * scale * amplitude * side));
            }
            points.push([places[i].lon, places[i].lat]);
          }
          return { path: await route(points, options) };
        }});
      }
    }

    // The coast, and this is item 11d's whole reason for existing.
    //
    // Item 11c shipped a scoring term that ranks a coastal candidate above an
    // inland one correctly, and then measured that on the rider's own example
    // there is no coastal candidate to rank: Liepāja → Ventspils returned two
    // candidates, both on the same inland line. The cause is above —
    // `perpendicularVia` offsets the A→B line, and on a coast-parallel ride one
    // of those two sides IS the sea. Measured on that leg (reach 12.45 km) not
    // one of the fifteen via points lands on the coastal strip: side +1 sits
    // 4–30 km offshore, side −1 the same distances inland, and the P111 the
    // rider is asking for runs about 1 km from the water.
    //
    // So these candidates are placed against the coastline itself rather than
    // against the straight line: sampled along the corridor, walked out to the
    // shore and stepped back onto land at 1–3 km. `seawardVias` opens no file
    // at all unless `hasSeaData` covers the corridor, so an inland ride builds
    // exactly the pool it built before.
    //
    // Sampled per leg, not once across the whole ride: a via belongs on the
    // corridor it was measured against, and on a multi-stop ride the leg that
    // runs along the coast may not be the first one. The rider's own places
    // stay in their order and only the corridor between two of them bends
    // towards the water.
    const seawardByLeg = places.slice(1).map((to, i) =>
      seawardVias([places[i].lon, places[i].lat], [to.lon, to.lat])
    );
    const seawardCandidates: Candidate[] = seawardByLeg.flatMap((vias, leg) =>
      vias.map((via) => ({
        variant: places.length > 2 ? `sea${leg + 1}-${via.fraction}` : `sea-${via.fraction}`,
        competing: true,
        run: async () => {
          const points: [number, number][] = [startPt];
          for (let i = 1; i < places.length; i++) {
            if (i === leg + 1) points.push(via.point);
            points.push([places[i].lon, places[i].lat]);
          }
          return { path: await route(points) };
        },
      }))
    );
    // Item 11f. The one-via candidates above go TO the coast; these go ALONG
    // it. The rider's ruling is that the view may not be bought with retraced
    // roads — *"jūras skata maksa nedrīkst būt 10 % pieaugums atkārtotos
    // ceļos"* — and item 11d's `sea-0.5` cost exactly that. Measured, its 10 %
    // is a single 16.5 km out-and-back whose turn-around point IS the via: one
    // via can only express "to the coast", so the route rides down one
    // connector to the shore and back up the same one.
    //
    // A corridor candidate carries two vias instead, entry and exit, each
    // anchored onto the 1–3 km band in its own right, so the shore stretch runs
    // between them and the approach and return use different roads. Measured:
    // Liepāja → Ventspils 10 % → 3 %, Ventspils → Kolka a 0 % candidate at
    // 53.6 coastal km, Jūrmala → Kolka 48.8 coastal km at 2 %.
    //
    // Same gate as `seawardVias`, so an inland ride opens no coastline file.
    const corridorsByLeg = places.slice(1).map((to, i) =>
      seawardCorridors([places[i].lon, places[i].lat], [to.lon, to.lat])
    );
    const corridorCandidates: Candidate[] = corridorsByLeg.flatMap((corridors, leg) =>
      corridors.map((corridor) => ({
        variant:
          places.length > 2
            ? `seaCorridor${leg + 1}-${corridor.fractions[0]}-${corridor.fractions[1]}`
            : `seaCorridor-${corridor.fractions[0]}-${corridor.fractions[1]}`,
        competing: true,
        run: async () => {
          const points: [number, number][] = [startPt];
          for (let i = 1; i < places.length; i++) {
            if (i === leg + 1) points.push(...corridor.points);
            points.push([places[i].lon, places[i].lat]);
          }
          return { path: await route(points) };
        },
      }))
    );

    const seaward = seawardByLeg.flat();
    // Along-the-coast candidates go first: they are the ones that satisfy the
    // rider's rule, and `withSeawardCandidates` keeps a prefix under the cap.
    const allSeaward = [...corridorCandidates, ...seawardCandidates];
    if (allSeaward.length) {
      console.log(
        `seaward: ${corridorCandidates.length} corridor + ${seawardCandidates.length} single-via ` +
          `coastal candidates at ` +
          seaward.map((v) => `${v.coastDistanceM} m`).join(", ")
      );
    }

    // Item 11e. Before any of these costs a leg, ask the router which of their
    // via points are in the water — measured at ~40 ms each against the 24 s a
    // single offshore candidate burns on the endpoint-nudge ring and the
    // segmented retry. An offshore candidate is replaced by the same offset
    // mirrored to the land side, so a coastal ride keeps a full pool instead of
    // losing two thirds of its versions.
    //
    // `dropOffshoreVias` gates itself on `hasSeaData`, so an inland ride makes
    // no probe at all and this block returns the pool it was given, unchanged.

    const filtered = await dropOffshoreVias({
      probes: viaProbes,
      snap: (point) => snapDistanceM({ point, profileOptions }),
    });
    if (filtered.dropped) {
      console.log(
        `offshore: ${filtered.dropped} of ${filtered.probed} via points in the water, ` +
          `${filtered.substituted} mirrored to land (${filtered.ms} ms)`
      );
      // Rebuild the pool in build order: the scale-0 direct line and the
      // shapes that carry no perpendicular via (around-*, zig-*) were never
      // probed and are kept as they were.
      const keptVia = new Set(filtered.kept);
      const rebuilt: Candidate[] = [];
      const placed = new Set<string>();
      for (const candidate of candidates) {
        const probe = viaProbes.find((p) => p.item === candidate.variant);
        if (!probe) { rebuilt.push(candidate); continue; }
        if (keptVia.has(candidate.variant)) rebuilt.push(candidate);
        // A substitute takes the slot of the candidate it replaced, so the pool
        // keeps its build order — which is what `route.ts` relies on when it
        // slices a prefix under the time budget.
        for (const substitute of probe.substitutes) {
          if (!keptVia.has(substitute.item) || placed.has(substitute.item)) continue;
          const run = mirrorRuns.get(substitute.item);
          if (run) { rebuilt.push(run); placed.add(substitute.item); }
        }
      }
      return { candidates: rebuilt, seaward: allSeaward };
    }
    return { candidates, seaward: allSeaward };
  }

  // Round trip. Valhalla has no round-trip algorithm, so the loop is built
  // from via points of our own.
  //
  // Anchor directions come from an isochrone rather than a circle, because
  // the isochrone is computed with the same motorcycle costing as the route
  // and so follows the road network: purely geometric anchors gave 7-34%
  // retraced roads with no stable radius or stop count, since an anchor can
  // land where only one road leads and the router is forced to reuse it.
  // Each anchor is then snapped to a real POI, so via points sit on roads
  // rather than in lakes and bogs.
  //
  // More shapes are generated than are shown: the goal is not a circle or an
  // exact distance but covering new ground, so the caller keeps whichever
  // shapes retrace themselves least. An oval or a lopsided sprawl beats a
  // tidy circle that doubles back.
  // Stop count is the strongest lever on retracing: a denser ring gives the
  // router more ways round. Measured at a 120 km target, 3 stops retraced 38%
  // near Aluksne and 46% near Kuldiga, while 5-7 stops brought those to 11%
  // and 24%. Sparse networks need MORE stops, not better-placed ones — the
  // POI anchors were already landing within a few degrees of target. More
  // stops also give the route title more named places to work with.
  // Scale stops with distance, but never pack many stops into a tiny radius:
  // a 40 km target at 5 stops put anchors 2.6 km out, effectively one place,
  // and the router then wandered off to 96 km against a 40 km target. Short
  // rides need fewer stops so the ring stays wide enough to steer with.
  //
  // Note there is a floor on what a loop can be: near Baldone the shortest
  // achievable gravel loop is ~17 km (2 stops at a 1.5 km ring), because
  // leaving town and coming back another way already costs that. Targets
  // below roughly 25 km will overshoot however few stops we use.
  const baseStops = stopsFor(targetKm);
  // Radius from the calibration route when there is one, else the table.
  const baseRadius = calibration?.radiusMeters ?? anchorRadiusMeters(targetKm, baseStops);
  const radiusFor = (stops: number) =>
    stops === baseStops
      ? baseRadius
      : (baseRadius * perimeterFactor(baseStops)) / perimeterFactor(stops);
  // Variants differ mainly by which side of town they explore (bearing
  // offset); the contour is mostly held at the calibrated middle ring so
  // distances stay near target, with one inner and one outer for spread.
  // Candidate quality swings a lot between regions and the good ones aren't
  // predictable, so several shapes are generated and ranked. Five rather than
  // eight: the public BRouter instance answers 403 "retry later" after about
  // half a dozen quick requests, and a self-hosted instance would lift this.
  //
  // The radius multipliers matter as much as the bearings. Around Sigulda a
  // ring at the target radius retraced 41% however it was rotated, because
  // the Gauja valley offers few ways out and the route has to come back
  // through one of them; a ring 1.5x wider dropped that to 13%. So when the
  // rider allows drift, some candidates deliberately run wide — that is
  // precisely the trade the tolerance setting buys.
  const wide = 1 + intent.distanceTolerancePercent / 100;
  // Against the public brouter.de instance: four shapes plus the calibration
  // route and the probe, six requests, because its burst limit lost two of
  // six test prompts at eight. A self-hosted server (~0.2 s a route) makes
  // more shapes free, and more shapes is more chances at a low-retrace loop.
  const selfHosted = selfHostedRouter();
  const extraStops = Math.min(10, baseStops + 1);
  const cityStart = calibration?.cityStart ?? false;

  // Teardrops: stops fanned across a 100° sector at a wider radius, so the
  // loop leaves town along one corridor, loops in the countryside and comes
  // back along another. A ring around a city start stays inside the city —
  // Riga loops rode 50-80 km of streets to link viewpoints 6-12 km out.
  // Perimeter of a fan ≈ 2r + 1.75r against 2πr for a ring, so the radius is
  // scaled up to keep the length.
  const TEARDROP_HALF_WIDTH_DEG = 50;
  const TEARDROP_RADIUS_SCALE = 1.7;
  const teardrop = (centreDeg: number) => ({
    stops: Math.max(3, baseStops),
    bearingOffset: 0,
    radiusScale: TEARDROP_RADIUS_SCALE,
    contourIndex: 1,
    sector: { centreDeg, halfWidthDeg: TEARDROP_HALF_WIDTH_DEG },
  });
  // Which way the sea is from the start, or null when this is an inland ride —
  // in which case nothing below changes and no coastline file is opened.
  const seaBearing = seawardBearing(startPt);
  if (seaBearing !== null) {
    console.log(`seaward: loop start is coastal, biasing anchors towards ${Math.round(seaBearing)}°`);
  }
  const shapes: LoopShape[] = [
    { stops: baseStops, bearingOffset: 45, radiusScale: 1, contourIndex: 1 },
    { stops: baseStops, bearingOffset: 90, radiusScale: 1, contourIndex: 1 },
    { stops: baseStops, bearingOffset: 20, radiusScale: wide, contourIndex: 2 },
    { stops: extraStops, bearingOffset: 65, radiusScale: wide, contourIndex: 2 },
    ...(selfHosted
      ? [
          { stops: baseStops, bearingOffset: 135, radiusScale: 1, contourIndex: 1 },
          { stops: baseStops, bearingOffset: 0, radiusScale: 1, contourIndex: 0 },
          { stops: extraStops, bearingOffset: 110, radiusScale: 1, contourIndex: 1 },
          { stops: extraStops, bearingOffset: 155, radiusScale: wide, contourIndex: 2 },
          teardrop(0),
          teardrop(90),
          teardrop(180),
          teardrop(270),
        ]
      : cityStart
        ? [teardrop(45), teardrop(225)]
        : []),
    // Item 11d, the loop half. A start within ~15 km of the sea gets one or two
    // shapes deliberately aimed at the water, so at least some candidates run
    // along the coast and the item 11c ranking has something coastal to pick.
    //
    // A rotation, not a displacement — which is why this is safe where the
    // A-to-B case needed a coastline-anchored point. A loop's anchors are
    // placed by bearing around the start and then snapped to an isochrone
    // direction and a real POI, so aiming a sector at the sea cannot put a via
    // point in the water the way `perpendicularVia`'s wrong side does.
    //
    // **The rest of the shapes are untouched on purpose.** Inland loops stay
    // available from the same start, and the overlap rule still decides:
    // "galvenais nebraukt tos pašus ceļus" outranks the view, and a coastal
    // teardrop that retraces loses to an inland ring exactly as item 11c's
    // weight of 8 was chosen to guarantee.
    ...(seaBearing === null
      ? []
      : selfHosted
        ? [teardrop(seaBearing), teardrop((seaBearing + 45) % 360)]
        : [teardrop(seaBearing)]),
    // The relaxation ladder. Some places cannot loop cleanly at the requested
    // length — the Gauja valley at Turaida, Tukums under ~150 km — and a
    // rider then does what a rider does: goes a bit further out. These
    // shapes run at 1.6× and 2.4× the radius (a ring and a teardrop each) and
    // compete in the ranking like any other, where the drift penalty decides
    // whether "a bit further" is acceptable: for a 30-minute request +15 min
    // is free, for a 4-hour request it is not. Whichever wider loop ranks
    // best but still falls outside tolerance is offered to the rider with its
    // numbers, never silently substituted. (An earlier absolute 18 km probe
    // answered a 30-minute request with a 171 km ride.)
    //
    // With floors: a 30-minute request has a 1.2 km ring, and 1.6× of that is
    // still the same village. "A bit further out" for a rider means the next
    // forest, 3-6 km away, whatever the ring says.
    //
    // They take their anchors from a second, wider isochrone: a plain circle
    // at 5 km around Turaida put anchors in the Gauja valley and every wide
    // loop retraced 32-46%, while ring anchors at the same radius found 11%.
    {
      stops: Math.max(3, baseStops),
      bearingOffset: 30,
      radiusScale: 1.6,
      absoluteRadiusMeters: Math.max(baseRadius * 1.6, 3000),
      contourIndex: 0,
      ringSet: "wide",
      exploratory: true,
    },
    // Teardrops in four directions at the relaxation radius: which side of
    // town has the forest is exactly what we don't know in advance.
    ...[45, 135, 225, 315].map((deg) => ({
      ...teardrop(deg),
      radiusScale: TEARDROP_RADIUS_SCALE * 1.6,
      absoluteRadiusMeters: Math.max(baseRadius * TEARDROP_RADIUS_SCALE * 1.6, 5000),
      exploratory: true,
    })),
    {
      stops: Math.max(3, baseStops),
      bearingOffset: 75,
      radiusScale: 2.4,
      absoluteRadiusMeters: Math.max(baseRadius * 2.4, 5000),
      contourIndex: 1,
      ringSet: "wide",
      exploratory: true,
    },
    {
      stops: Math.max(3, baseStops),
      bearingOffset: 165,
      radiusScale: 2.4,
      absoluteRadiusMeters: Math.max(baseRadius * 2.4, 5000),
      contourIndex: 1,
      ringSet: "wide",
      exploratory: true,
    },
    ...[0, 180].map((deg) => ({
      ...teardrop(deg),
      radiusScale: TEARDROP_RADIUS_SCALE * 2.4,
      absoluteRadiusMeters: Math.max(baseRadius * TEARDROP_RADIUS_SCALE * 2.4, 7000),
      exploratory: true,
    })),
  ];
  if (direction) {
    const directionalShapes: LoopShape[] = [0.85, 1.2, 1.7, 2.4].flatMap((scale) =>
      [30, 50, 65].map((halfWidthDeg) => ({
        stops: baseStops, bearingOffset: 0, radiusScale: scale, contourIndex: 1,
        sector: { centreDeg: direction.centreDeg, halfWidthDeg },
        exploratory: scale > 1.7,
      }))
    );
    shapes.splice(0, shapes.length, ...(selfHosted ? directionalShapes : [directionalShapes[2], directionalShapes[5], directionalShapes[8], directionalShapes[11]]));
  }
  const wideRadius = Math.max(baseRadius * 2.4, 5000);

  // One isochrone serves every shape. If it fails the loops still get built,
  // from a plain circle plus POI snapping — worse, but never a dead end.
  let rings: Map<number, IsoRing[]> | null = null;
  let ringsWide: Map<number, IsoRing[]> | null = null;
  try {
    // Directional fans use their own radii, so neither contour set is used.
    if (!direction) [rings, ringsWide] = await Promise.all([
      loopRings(start, baseRadius, intent, costingOptions),
      loopRings(start, wideRadius, intent, costingOptions),
    ]);
  } catch (err) {
    console.warn("isochrone unavailable; falling back to circular anchors:", err);
  }
  const contoursOf = (set: Map<number, IsoRing[]> | null) =>
    set ? [...set.keys()].sort((a, b) => a - b) : [];
  const contours = contoursOf(rings);
  const contoursWide = contoursOf(ringsWide);

  const calibrationCandidate: Candidate[] = calibration && !calibration.secondPass
    ? [
        {
          variant: "calibration",
          competing: true,
          run: async () => calibration.result,
        },
      ]
    : [];

  const toCandidate = (inputShape: LoopShape): Candidate => {
    // Preserve the requested direction in every pass and mutation. The
    // sector steers via points; actual roads may bend outside it.
    const shape: LoopShape = direction
      ? { ...inputShape, sector: {
          centreDeg: direction.centreDeg,
          halfWidthDeg: Math.min(direction.halfWidthDeg, inputShape.sector?.halfWidthDeg ?? 65),
        } }
      : inputShape;
    const { stops, bearingOffset, radiusScale, absoluteRadiusMeters, contourIndex, exploratory, sector, ringSet } = shape;
    return {
      variant: `s${stops}b${bearingOffset}r${radiusScale.toFixed(1)}${sector ? `t${sector.centreDeg}` : ""}${ringSet === "wide" ? "w" : ""}`,
      // Only loops compete on overlap; TET and point-to-point have fixed shapes.
      competing: true,
      exploratory: exploratory ?? false,
      run: async () => {
        // A candidate with its own radius must not take one from the base
        // isochrone, or that radius is silently discarded — the ring is
        // exactly what pins the radius to the target. Relaxation shapes take
        // theirs from the wide ring instead.
        let ring: IsoRing | undefined;
        if (ringSet === "wide") {
          const contour = contoursWide[Math.min(contourIndex, contoursWide.length - 1)];
          ring = contour !== undefined ? ringsWide?.get(contour)?.[0] : undefined;
        } else if (radiusScale === 1 && absoluteRadiusMeters === undefined) {
          const contour = contours[Math.min(contourIndex, contours.length - 1)];
          ring = contour !== undefined ? rings?.get(contour)?.[0] : undefined;
        }

        const plan = planLoop({
          start,
          ring,
          fallbackRadiusMeters: absoluteRadiusMeters ?? radiusFor(stops) * radiusScale,
          stopCount: stops,
          bearingOffsetDeg: bearingOffset,
          sector: sector ?? null,
          includeSightseeing: intent.includeSightseeing,
        });

        return {
          path: await route([startPt, ...plan.viaPoints, startPt]),
          stops: plan.stops,
          shape,
        };
      },
    };
  };

  // TET is one possible ingredient. These candidates compete with all normal
  // loops under the same quality/duration rules and never override direction.
  const tetCandidates: Candidate[] = [];
  if (selfHosted && !calibration?.secondPass &&
      (intent.includeTet || intent.preferForest || intent.gravelPreference >= 60)) {
    for (const variant of [0, 1] as const) {
      const slice = pickTetSlice(start, Math.min(30000, targetKm * 200), variant, 8);
      if (!slice || slice.entryDistanceKm > targetKm * 0.35) continue;
      if (direction && !slice.viaPoints.every(p => inSector(bearingDegrees(startPt, p), direction))) continue;
      tetCandidates.push({
        variant: `optional-tet-${variant}`, competing: true,
        run: async () => ({ path: await route([startPt, ...slice.viaPoints, startPt]) }),
      });
    }
  }
  // Roads a rider has ridden are the same kind of ingredient as TET, offered
  // on the same terms: these candidates compete with all normal loops under
  // the same direction and quality rules, and never override them. Item 6.
  //
  // Not gated on `includeTet` — there is no "ridden roads mode" to ask for and
  // the rider never has to know the layer exists. The gates are the ones that
  // already decide whether a reference layer is worth routing through at all:
  // a local router (this costs requests), and a rider who wants unpaved.
  const riddenCandidates: Candidate[] = [];
  if (selfHosted && !calibration?.secondPass &&
      (intent.preferForest || intent.gravelPreference >= 60 || intent.trailPreference !== "none")) {
    for (const variant of [0, 1] as const) {
      const slice = pickRiddenSlice(start, Math.min(30000, targetKm * 200), variant, 8);
      if (!slice || slice.entryDistanceKm > targetKm * 0.35) continue;
      if (direction && !slice.viaPoints.every((p) => inSector(bearingDegrees(startPt, p), direction))) continue;
      riddenCandidates.push({
        variant: `optional-ridden-${variant}`, competing: true,
        run: async () => ({ path: await route([startPt, ...slice.viaPoints, startPt]) }),
      });
    }
  }
  return {
    candidates: [...calibrationCandidate, ...shapes.map(toCandidate), ...tetCandidates, ...riddenCandidates],
    fromShapes: (more) => more.map(toCandidate),
  };
}

/**
 * Nearby variations of a shape that worked: rotate it, widen or tighten it,
 * add or drop a stop. With a local router at ~0.1 s a route this is the
 * cheapest way to "look around" a good loop the way a rider fiddling with a
 * map would, and it is how a 21% loop becomes an 11% one.
 */
function mutations(shape: LoopShape): LoopShape[] {
  const scaled = (f: number): LoopShape => ({
    ...shape,
    radiusScale: shape.radiusScale * f,
    absoluteRadiusMeters:
      shape.absoluteRadiusMeters !== undefined ? shape.absoluteRadiusMeters * f : undefined,
    // a scaled shape can no longer use the ring that pinned the original
    ringSet: undefined,
  });
  const turned = (deg: number): LoopShape =>
    shape.sector
      ? { ...shape, bearingOffset: shape.bearingOffset + deg, sector: { ...shape.sector, centreDeg: (shape.sector.centreDeg + deg + 360) % 360 } }
      : { ...shape, bearingOffset: (shape.bearingOffset + deg + 360) % 360 };
  return [
    turned(25),
    turned(-25),
    scaled(0.85),
    scaled(1.2),
    { ...shape, stops: Math.max(3, shape.stops - 1) },
    { ...shape, stops: Math.min(10, shape.stops + 1) },
  ].map((m) => ({ ...m, exploratory: shape.exploratory }));
}

/**
 * Wall-clock budget for one generation. Vercel's hobby plan kills the function
 * at 60 s and answers with an HTML error page; the browser then fails to parse
 * JSON (Safari: "The string did not match the expected pattern") — that was
 * the "bug" riders saw on long rides via the public BRouter. Below the cap the
 * search stops launching new batches and answers with the best it has.
 */
/**
 * How far past a moved endpoint the route's own end may sit. BRouter snaps
 * the point it is given to the nearest routable node, so a 400 m nudge
 * measured 402 m out — the endpoint checks have to allow the router's snap
 * on top of the nudge or a rescued route fails by a couple of metres.
 */
const ENDPOINT_SNAP_MARGIN_M = 150;

/**
 * When every candidate failed, is one of the rider's own pins simply
 * unreachable on this profile?
 *
 * Measured 2026-09-19, and the reason this runs at all. A ride through
 * Glāziņpurvs → Sporta iela 36 → Lielpurvi → Tūjas → Pilskalni 2 on
 * Grūti · Sports · Meži returned "Neizdevās atrast maršrutu, kas izpilda
 * pieturvietas un norādītās robežas" in 15 s, naming nothing. Every leg of
 * that ride routes; the finish is the problem. Pilskalni 2 is a farmstead
 * behind `access=private` service roads, and BRouter **does not refuse it** —
 * it answers 200 and ends the line 471 m short, which `visitsRequiredStops`
 * then rejects on all ~36 candidates.
 *
 * Because nothing was ever thrown, none of the existing rescues could see it:
 * the endpoint-nudge ring runs only from a `catch` on "target island" /
 * "error re-tracking track". It would not have helped either — measured, its
 * best offset lands 495 m from the pin, *worse* than the plain 471 m snap,
 * because there is no legal road within 300 m to find. The honest answer is
 * to name the pin and offer the two ways out.
 *
 * Deliberately only on the failure path, and only for the rider's own places:
 * this costs one short request per pin, which is nothing against a generation
 * that has already spent its whole budget, but it would be real money on the
 * happy path where every candidate routed.
 */
async function findUnreachableStop(
  places: { place: GeocodeResult; name: string; index: number; role: "start" | "via" | "destination" }[],
  profileOptions: MotoProfileOptions,
  signal: AbortSignal
): Promise<UnreachableStop | undefined> {
  for (const { place, name, index, role } of places) {
    if (signal.aborted) return undefined;
    // Probed from another place in the ride when there is one, so the leg is
    // a real approach rather than a synthetic hop beside the pin.
    const other = places.find((p) => p.place !== place)?.place;
    const verdict = await checkRoutablePoint({
      point: [place.lon, place.lat],
      from: other ? [other.lon, other.lat] : undefined,
      probe: (leg) => probeSnapPoint({ from: leg[0], to: leg[1], profileOptions, timeoutMs: 2_500 }),
    });
    // "We could not check" is not a verdict: a slow probe must never turn
    // into an accusation about the rider's pin.
    if (verdict.ok || verdict.reason === "probe-failed") continue;
    return {
      name,
      index,
      role,
      lat: place.lat,
      lon: place.lon,
      ...(verdict.snappedTo ? { snappedTo: verdict.snappedTo } : {}),
      ...(verdict.distanceM !== undefined ? { distanceM: verdict.distanceM } : {}),
      canMove: canOfferMove(verdict),
    };
  }
  return undefined;
}

/**
 * Whether Mopik has a BRouter of its own. An empty `BROUTER_BASE_URL` means
 * the public instance, so it must not read as truthy — a blank value would
 * otherwise unlock the self-hosted budget and concurrency against a server
 * that throttles.
 */
const selfHostedRouter = (): boolean => Boolean(process.env.BROUTER_BASE_URL?.trim());

/**
 * Wall-clock for one generation. It must stay inside `maxDuration` (60 s
 * above): Vercel kills the function at that cap and the client gets the
 * platform's HTML error page, not our JSON — the "string did not match the
 * expected pattern" failure. The self-hosted budget was 110 s, which could
 * never have been reached; 50 s leaves room for the response to be built and
 * sent. A self-hosted router still gets the longer half of the range because
 * it answers far faster per candidate and is not paced.
 */
const TIME_BUDGET_MS = selfHostedRouter() ? 50_000 : 40_000;

/** Rejects when the budget runs out; the underlying fetch is left to finish alone. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("time budget exhausted")), Math.max(0, ms));
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/**
 * The direct road, packaged so the chat can actually show it.
 *
 * Backlog item 7's (b) is a *named offer*, and an offer the rider cannot see
 * is a dead button. So the road the probe already routed on `car-fast` is
 * classified with the same classifier every other route uses — the km, the
 * riding time and the surfaces are therefore the real ones, not estimates —
 * and travels inside the refusal.
 *
 * Two deliberate differences from a planned ride:
 *
 * - **The name says what it is.** `variant: "direct"` and a name built from
 *   the two places, so nothing downstream can mistake this for one of the
 *   "versions" a generation produces. It is the road, not the ride.
 * - **The line is simplified to 10 m**, exactly as the share code does. A
 *   600 km car route is tens of thousands of points, and the refusal has to
 *   fit in a response the chat renders immediately.
 *
 * `overlap` and the rest come from the classifier, so a rider who exports
 * the GPX gets honest numbers for the road they chose.
 */
function directLegOfferRoute(
  path: RoutePath,
  segment: { fromName: string; toName: string }
): NonNullable<UnplannableVerdict["directLeg"]> {
  const keep = simplifyIndices(path.coordinates as [number, number][], SIMPLIFY_TOLERANCE_M);
  const simplified: RoutePath = {
    ...path,
    coordinates: keep.map((i) => path.coordinates[i]),
  };
  const classified = classifyRoute(simplified);
  return {
    distanceKm: Math.round(path.distanceMeters / 1000),
    durationMinutes: Math.round(classified.durationSeconds / 60),
    route: {
      id: crypto.randomUUID(),
      name: [segment.fromName, segment.toName].filter(Boolean).join(" → "),
      geometry: { type: "LineString", coordinates: simplified.coordinates },
      segments: classified.segments,
      distanceMeters: path.distanceMeters,
      durationSeconds: classified.durationSeconds,
      roadMix: classified.roadMix,
      surfaces: classified.surfaces,
      quality: classified.quality,
      overlap: classified.overlap,
      // The profile is named for what it is. This road was not planned on
      // the rider's dials and must never claim to have been.
      profile: DIRECT_OFFER_PROFILE,
      sourcePrompt: "",
      // Not one of the generation's categories — the panel keys the
      // "this is the road, not the ride" treatment off exactly this.
      variant: "direct",
    },
  };
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const remainingMs = () => TIME_BUDGET_MS - (Date.now() - startedAt);
  /**
   * How many candidates this generation may route. Unlimited until the
   * feasibility probe measures a slow leg, after which it is whatever the
   * remaining budget can pay for at that cost — reducing the search rather
   * than letting it run out of time and return nothing.
   */
  let candidateCap = Number.MAX_SAFE_INTEGER;
  // A rider who cancelled is not waiting for this any more, and on our own
  // BRouter the ~36 candidates left in flight are time we are still paying
  // for. Treated exactly like the budget running out: the batch loop stops.
  const outOfTime = () => remainingMs() <= 0 || req.signal.aborted;
  let body;
  try {
    body = RequestSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    // A resolved intent (from "Generate another") skips the intent parse,
    // but places still come from the prompt; the parser caches, so this is
    // one LLM call per distinct prompt, not per click.
    if (body.plan) {
      const question = nextPlanQuestion(body.plan, true);
      if (question) return NextResponse.json({ error: question }, { status: 422 });
    }
    const parsed = body.plan ? {
      intent: planToIntent(body.plan), startPlace: body.plan.startPlace!,
      destinationPlace: body.plan.returnToStart ? undefined : body.plan.destinationPlace ?? undefined,
      directionPlace: body.plan.directionPlace ?? undefined, source: "plan" as const,
    } : await parseRoutePrompt(body.prompt, body.settings);
    let intent: RouteIntent = body.plan ? parsed.intent : body.intent ?? parsed.intent;

    // Places come from the description ("around Baldone", "from Riga to
    // Cesis"). Explicit fields still win when a caller sends them, but the
    // UI no longer has any — a separate Start field that disagreed with the
    // text is how a request for Baldone produced a loop around Riga.
    const startQuery = body.plan ? parsed.startPlace : body.start?.trim() || parsed.startPlace || parseStartPlace(body.prompt);
    if (!startQuery) {
      return NextResponse.json(
        {
          error:
            "Tell us where to ride — mention a place, e.g. “2h around Sigulda”.",
        },
        { status: 400 }
      );
    }

    // When Claude read the prompt, trust its verdict on one-way vs round trip:
    // the regex mistook "uz Siguldas pusi" for a destination before.
    const destinationQuery =
      body.plan ? parsed.destinationPlace : body.destination?.trim() ||
      (parsed.source === "llm" ? parsed.destinationPlace : parseDestinationPlace(body.prompt));

    // A picked place carries its own coordinates; only free text is geocoded.
    const resolvePlace = async (name: string): Promise<GeocodeResult> => {
      const picked: ResolvedPlace | undefined = findResolvedPlace(body.places, name);
      return picked ? { lat: picked.lat, lon: picked.lon, label: picked.label } : geocode(name);
    };

    let start: GeocodeResult;
    try {
      start = await resolvePlace(startQuery);
    } catch {
      return NextResponse.json(
        { error: `We couldn't find “${startQuery}”. Try a nearby town.` },
        { status: 422 }
      );
    }

    // A destination we can't find shouldn't sink the whole request — fall
    // back to a round trip, which is what most rides are anyway.
    let destination: GeocodeResult | null = null;
    if (destinationQuery) {
      try {
        destination = await resolvePlace(destinationQuery);
      } catch {
        return NextResponse.json({ error: `Neizdevās atrast galamērķi “${destinationQuery}”. Precizē vietu čatā.` }, { status: 422 });
      }
    }

    let direction: BearingSector | undefined;
    if (parsed.directionPlace && !destination) {
      try {
        const place = await resolvePlace(parsed.directionPlace);
        direction = {
          centreDeg: bearingDegrees([start.lon, start.lat], [place.lon, place.lat]),
          halfWidthDeg: 65,
        };
      } catch {
        return NextResponse.json({ error: `We couldn't find the direction “${parsed.directionPlace}”. Try a nearby town.` }, { status: 422 });
      }
    }

    const requiredVia: GeocodeResult[] = [];
    for (const name of body.plan?.viaPlaces ?? []) {
      try { requiredVia.push(await resolvePlace(name)); }
      catch { return NextResponse.json({ error: `Neizdevās atrast obligāto pieturvietu “${name}”. Precizē to čatā.` }, { status: 422 }); }
    }
    // A focus area away from the start ("meža aplis Baldones mežos, no
    // Rīgas"): ride there directly, loop around it with the rider's own
    // settings, come back by another corridor. The loop is planned exactly
    // like a loop from the focus town; the two transits are routed once and
    // stitched on at the end. What the rider sees as the budget is the whole
    // day unless they said the hours are for the loop only.
    const origin = start;
    type RemoteLoop = { focus: GeocodeResult; out: RoutePath; back: RoutePath; outSeconds: number; backSeconds: number };
    let remote: RemoteLoop | null = null;
    if (body.plan?.focusArea && body.plan.returnToStart && !destination) {
      let focus: GeocodeResult;
      try { focus = await resolvePlace(body.plan.focusArea); }
      catch { return NextResponse.json({ error: `Neizdevās atrast apvidu “${body.plan.focusArea}”. Precizē vietu čatā.` }, { status: 422 }); }
      const startPt: [number, number] = [start.lon, start.lat];
      const focusPt: [number, number] = [focus.lon, focus.lat];
      if (haversineMeters(startPt, focusPt) > 3000) {
        // Transit is transit: direct, main roads allowed, little gravel.
        const transitIntent: RouteIntent = {
          ...intent, rideStyle: "direct", difficulty: "easy", avoidMainRoads: false, preferForest: false, trailPreference: "none",
          gravelPreference: 0, accessPolicy: "verified", includeSightseeing: false,
        };
        const profileOptions = buildMotoProfileOptions(transitIntent);
        const out = await fetchRoutePath({ points: [startPt, focusPt], profileOptions });
        // The way back should be a different corridor: the direct return
        // and two offset ones compete on how few road pieces they share with
        // the way out, with a mild penalty for extra length.
        const reach = Math.min(12000, Math.max(3000, haversineMeters(startPt, focusPt) * 0.2));
        const backSettled = await Promise.allSettled([
          fetchRoutePath({ points: [focusPt, startPt], profileOptions }),
          ...[1, -1].map((side) => fetchRoutePath({ points: [focusPt, perpendicularVia(focus, start, 0.5, reach * side), startPt], profileOptions })),
        ]);
        const backs = backSettled.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
        if (!backs.length) throw new Error("Neizdevās izplānot atpakaļceļu no apvidus.");
        const outKeys = roadPieceKeys(out.coordinates);
        const sharedWithOut = (p: RoutePath) => {
          const keys = roadPieceKeys(p.coordinates);
          let n = 0;
          for (const k of keys) if (outKeys.has(k)) n++;
          return n / Math.max(1, keys.size);
        };
        const cost = (p: RoutePath) => sharedWithOut(p) + Math.max(0, p.distanceMeters / out.distanceMeters - 1) * 0.8;
        backs.sort((a, b) => cost(a) - cost(b));
        const back = backs[0];
        const outSeconds = classifyRoute(out).durationSeconds;
        const backSeconds = classifyRoute(back).durationSeconds;
        remote = { focus, out, back, outSeconds, backSeconds };
        console.log(`remote loop: ${placeName(origin.label)} → ${placeName(focus.label)} ${(out.distanceMeters / 1000).toFixed(0)} km / ${Math.round(outSeconds / 60)} min out, ${(back.distanceMeters / 1000).toFixed(0)} km / ${Math.round(backSeconds / 60)} min back (shares ${Math.round(sharedWithOut(back) * 100)}%)`);
        if (body.plan.budgetScope === "total") {
          const transitHours = (outSeconds + backSeconds) / 3600;
          const transitKm = (out.distanceMeters + back.distanceMeters) / 1000;
          if (intent.durationHours) {
            intent = {
              ...intent,
              durationHours: Math.max(0.5, intent.durationHours - transitHours),
              minimumDurationHours: intent.minimumDurationHours ? Math.max(0, intent.minimumDurationHours - transitHours) : undefined,
            };
          } else if (intent.distanceKm) {
            intent = {
              ...intent,
              distanceKm: Math.max(20, intent.distanceKm - transitKm),
              minimumDistanceKm: intent.minimumDistanceKm ? Math.max(0, intent.minimumDistanceKm - transitKm) : undefined,
            };
          }
        }
        start = focus;
      }
    }
    // A flexible budget on a ride with fixed places means "as long as the
    // places take, with room to wander": the direct distance plus a quarter,
    // never below the plain-loop default.
    // The rider's shaping points, where the plan carries them: routed through
    // in order with the stops (`buildCandidates`), checked like nothing.
    const shapePoints = body.plan?.shapePoints ?? [];
    const fixedPlaces = [start, ...interleaveShapes(requiredVia, shapePoints, (p): GeocodeResult => ({ lat: p.lat, lon: p.lon, label: "" })), destination ?? start];
    const fixedDirectKm = fixedPlaces.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.lat - fixedPlaces[i].lat) * 111, (p.lon - fixedPlaces[i].lon) * 61), 0);
    let targetKm = body.plan?.budget.mode === "flexible"
      ? (remote ? 60 : body.lucky ? 120 : (requiredVia.length || shapePoints.length || destination) ? Math.max(80, Math.round(fixedDirectKm * 1.25)) : 80)
      : resolveTargetDistanceKm(intent);

    // The feasibility probe. Route the rider's legs once, under a short
    // shared deadline, before committing to ~36 of them — because whether
    // this request fits in 50 s is decided by how hard the *search* is, not
    // by how long the ride is (Rīga → Berlin is 1133 km and routes in 23 s;
    // Como → Budapest is 1126 km and takes 74 s). A kilometre threshold
    // cannot tell those apart, so this measures instead of guessing.
    //
    // Per **rider-named segment**, not per headline leg (backlog item 7,
    // step 2d). Measured 2026-09-19: Berlin → Poznań → Warszawa has a
    // headline leg of only ~300 km, which probed fast and waved the request
    // through — and the generation then spent 29 s and returned a 422,
    // because the hop nobody measured was the expensive one. Probing each
    // hop turns that into an answer the rider can act on: which segment is
    // too hard, and a stop inside it is the fix.
    //
    // Only rides with named places are probed. A plain loop has no segments —
    // its candidates are short shapes around one town, and the calibration
    // route below already measures the region at the app's own expense.
    // Probing it would pay for a leg twice and refuse nothing.
    let reducedSearch: GenerateRouteResponse["reducedSearch"];
    /** what the probe measured one leg to cost, seconds; 0 when it did not run */
    let probeSeconds = 0;
    const probePlaces = [start, ...requiredVia, ...(destination ? [destination] : [])];
    if (probePlaces.length > 1) {
      const allSegments = rideSegments(
        probePlaces.map((p) => [p.lon, p.lat] as [number, number]),
        probePlaces.map((p) => placeName(p.label))
      );
      // Short hops are never the problem and probing them would only add a
      // round trip to every ordinary ride. Measured: Rīga → Baldone (46 km)
      // probes in 2-3 s, which is pure cost on a request that was always
      // going to work. The floor is well above every ride that generates
      // today, and it applies per hop — so a ride whose every hop is short
      // is not probed at all, however long the ride is in total.
      const PROBE_ABOVE_KM = 250;
      const toProbe = segmentsWorthProbing(allSegments, PROBE_ABOVE_KM);
      if (toProbe.length) {
        const report = await probeSegments({
          segments: toProbe,
          profileOptions: buildMotoProfileOptions(intent),
          signal: req.signal,
        });
        console.log(
          `feasibility probe: ${report.probed.length} of ${allSegments.length} segments in ${report.totalSeconds.toFixed(1)} s — ` +
            report.probed
              .map(
                (p) =>
                  `${p.segment.fromName}→${p.segment.toName} ${Math.round(p.segment.km)} km ` +
                  `${p.seconds.toFixed(1)} s ${p.outcome.ok ? "ok" : p.outcome.reason}`
              )
              .join("; ")
        );
        if (report.failed) {
          // Said before the search, not after. The rider gets this in ~10 s
          // with something they can act on — *which* segment, and a stop
          // inside it — instead of ~50 s ending in 422.
          const bad = report.failed.segment;
          // (b) as a named offer: the direct road for this segment, on the
          // plainest profile, under its own short deadline. Never substituted
          // for the ride — the chat offers it and the rider chooses. A null
          // here simply means no offer, never a worse refusal.
          const direct = await directLegOffer({
            from: bad.from,
            to: bad.to,
            signal: req.signal,
          });
          const unplannable: UnplannableVerdict = {
            from: placeName(origin.label),
            to: placeName((destination ?? requiredVia[requiredVia.length - 1] ?? start).label),
            legKm: Math.round(bad.km),
            budgetSeconds: Math.round(PROBE_BUDGET_MS / 1000),
            reason: report.failed.outcome.reason,
            // Only when the rider actually named intermediate places. On a
            // plain A → B there is one segment, naming it says nothing the
            // `from`/`to` above do not, and there is nothing to split.
            ...(allSegments.length > 1
              ? {
                  segment: {
                    index: bad.index,
                    from: bad.fromName,
                    to: bad.toName,
                    km: Math.round(bad.km),
                    ofSegments: allSegments.length,
                  },
                }
              : {}),
            ...(direct ? { directLeg: directLegOfferRoute(direct, bad) } : {}),
          };
          // `intent` and `start` travel with the refusal so the chat can show
          // the direct road as a real result when the rider taps for it —
          // without them the panel has no ride to render around the route.
          return NextResponse.json(
            { unplannable, intent, parser: parsed.source, start: { lat: start.lat, lon: start.lon, label: start.label } },
            { status: 200 }
          );
        }
        // Every routed segment is already handed to the candidate search by
        // the probe (`rememberLeg`), so the corridor candidates reuse them
        // rather than paying for the same searches twice. Only the cost is
        // needed here.
        //
        // What one candidate costs is what scales the search — and on a ride
        // with stops that is *every* segment, not the slowest one. Measured
        // 2026-09-19: pricing Berlin → Poznań → Warszawa at its slowest hop
        // (9.6 s) allowed three candidates and all three timed out, because
        // each was routing both hops. `candidateCostSeconds` prices the whole
        // ride. The slowest segment is still what the rider is *shown* in
        // `reducedSearch`, since that is the hop that explains the reduction.
        //
        // A fast segment keeps its full search: a ride whose hops all measure
        // quick prices low and is not degraded because some other ride's
        // segment was slow.
        probeSeconds = report.slowestSeconds;
        const perCandidate = candidateCostSeconds({
          measured: report.probed.filter((p) => p.outcome.ok).map((p) => p.seconds),
          totalSegments: allSegments.length,
        });
        const affordable = affordableCandidates({
          budgetMs: TIME_BUDGET_MS,
          spentMs: Date.now() - startedAt,
          legMs: perCandidate * 1000,
          cap: Number.MAX_SAFE_INTEGER,
        });
        candidateCap = affordable;
      }
    }

    // Plain loops get a calibration route first (TET and one-way rides have
    // fixed shapes). It corrects the anchor radius — and, for a duration
    // request, the target distance — to what this region actually delivers.
    let calibration: LoopCalibration | null = null;
    if (!destination && !requiredVia.length && !shapePoints.length) {
      const profileOptions = buildMotoProfileOptions(intent);
      calibration = await calibrateLoop(start, intent, targetKm, (points) =>
        fetchRoutePath({ points, profileOptions }).then(path => intent.includeSightseeing ? path : pruneSpurs(path)), direction
      );
      if (calibration) targetKm = calibration.targetKm;
    }

    const built = await buildCandidates(intent, start, destination, targetKm, calibration, direction, requiredVia, shapePoints);
    // A slow leg means fewer versions, not a failure. The candidates are in
    // build order, which puts the plain corridors (the ones a rider actually
    // recognises as the ride they asked for) before the ornamental shapes, so
    // taking a prefix keeps the most useful ones.
    // Item 11d folds the coastal candidates in here rather than in
    // `buildCandidates`, because this is where the time budget is known: inside
    // a full pool they replace the widest perpendicular offsets (which on a
    // coastal ride are the ones that land in the sea) instead of extending it.
    const planned = built.candidates.length + (built.seaward?.length ?? 0);
    const candidates = withSeawardCandidates(built.candidates, built.seaward ?? [], candidateCap);
    if (candidates.length < planned) {
      reducedSearch = {
        tried: candidates.length,
        planned,
        legSeconds: Math.round(probeSeconds * 10) / 10,
      };
      console.warn(
        `feasibility: slow leg, routing ${candidates.length} of ${built.candidates.length} candidates`
      );
    }
    if (candidates.length === 0) {
      return NextResponse.json(
        { error: "Could not build a route request for this input" },
        { status: 422 }
      );
    }

    // Requests to BRouter are paced inside the client; concurrency here only
    // overlaps the planning work. Two at a time keeps the public instance
    // under its burst limit together with that pacing.
    type Scored = {
      variant: string;
      path: RoutePath;
      stops?: LoopStop[];
      shape?: LoopShape;
      classified: ReturnType<typeof classifyRoute>;
      competing: boolean;
      exploratory: boolean;
    };

    const CONCURRENCY = selfHostedRouter() ? 4 : 2;
    const runAll = async (cands: Candidate[]): Promise<{ settled: PromiseSettledResult<Awaited<ReturnType<Candidate["run"]>>>[]; scored: Scored[] }> => {
      const settled: PromiseSettledResult<Awaited<ReturnType<Candidate["run"]>>>[] = [];
      for (let i = 0; i < cands.length; i += CONCURRENCY) {
        if (outOfTime()) { console.warn(`time budget: stopping after ${i} of ${cands.length} candidates`); break; }
        const batch = cands.slice(i, i + CONCURRENCY);
        // A slow public instance with retries can hold one route for a minute;
        // a batch may not outlive the budget, whatever BRouter is doing.
        settled.push(...(await Promise.allSettled(batch.map((c) => withDeadline(c.run(), remainingMs())))));
      }
      const scored: Scored[] = [];
      settled.forEach((result, i) => {
        if (result.status !== "fulfilled") {
          console.warn(`candidate ${cands[i].variant} failed:`, result.reason);
          return;
        }
        if (hasBeachLikePath(result.value.path)) {
          console.warn(`candidate ${cands[i].variant} rejected: sandy highway=path`);
          return;
        }
        if (intent.accessPolicy === "verified" && hasUnverifiedMotorPath(result.value.path)) {
          console.warn(`candidate ${cands[i].variant} rejected: unverified highway=path motor access`);
          return;
        }
        scored.push({
          variant: cands[i].variant,
          ...result.value,
          classified: classifyRoute(result.value.path),
          competing: cands[i].competing ?? false,
          exploratory: cands[i].exploratory ?? false,
        });
      });
      return { settled, scored };
    };

    const first = await runAll(candidates);
    const settled = first.settled;
    let scored = first.scored;

    // Second correction pass. One calibration route predicts the loop length
    // imperfectly — the perimeter factor moves with radius, in different
    // directions in different regions (Riga undershoots, Tukums overshoots).
    // When the loops come back with their median length more than a quarter
    // off target, re-plan every shape at a radius scaled by that ratio and
    // route again. Self-hosted, every shape; on the public instance only a
    // few, because the time limit is the feature riders value most and a
    // 2-hour request that comes back at 3½ hours is a broken product, not a
    // saved request.
    const SECOND_PASS_TRIGGER = 0.25;
    const PUBLIC_SECOND_PASS_SHAPES = 4;
    if (calibration && !outOfTime()) {
      const lengths = scored
        .filter((c) => c.competing && !c.exploratory)
        .map((c) => c.path.distanceMeters / 1000)
        .sort((a, b) => a - b);
      const median = lengths[Math.floor(lengths.length / 2)];
      const ratio = median ? targetKm / median : 1;
      if (lengths.length > 0 && Math.abs(ratio - 1) > SECOND_PASS_TRIGGER) {
        const radiusMeters = Math.max(
          MIN_ANCHOR_RADIUS_M,
          calibration.radiusMeters * Math.min(2.5, Math.max(0.4, ratio))
        );
        console.log(
          `second pass: median ${median.toFixed(0)} km vs target ${targetKm} km → radius ` +
            `${(calibration.radiusMeters / 1000).toFixed(1)} → ${(radiusMeters / 1000).toFixed(1)} km`
        );
        const again = await buildCandidates(intent, start, destination, targetKm, {
          ...calibration,
          radiusMeters,
          secondPass: true,
        }, direction, requiredVia, shapePoints);
        const retry = again.candidates.filter((c) => !c.exploratory);
        const second = await runAll(selfHostedRouter() ? retry : retry.slice(0, PUBLIC_SECOND_PASS_SHAPES));
        scored = [...scored, ...second.scored];
      }
    }


    // Loops are generated in surplus and ranked on how little they retrace
    // themselves — covering new ground is the goal, not a tidy circle.
    //
    // Distance enters the ranking only once a route falls outside the rider's
    // tolerance. Inside it, length is free to vary and the comparison is
    // purely about quality; outside it, every further percent of drift costs
    // as much as a percent of retracing. Ranking on overlap alone also let a
    // 7%-gravel loop beat a 59%-gravel one for a rider who asked for woods,
    // hence the unpaved shortfall term.
    // Named places and maximum budgets are acceptance conditions, not score weights.
    // 300 m is "this ride starts and ends where you asked". The exception is
    // a place that cannot be routed to at all on this profile — Ērgļi's
    // centre geocodes onto a `highway=footway`, which the moto profile
    // forbids, and BRouter then refuses the whole request. The router moves
    // such an endpoint to the nearest routable ground and says how far, so
    // the ride is judged against the closest the road network allows rather
    // than thrown away. Nothing else gets the slack.
    // The moved point is where we *asked* to route; BRouter still snaps that
    // to the nearest node, which measured 402 m out for a 400 m nudge. The
    // snap margin is the router's, not ours, so the allowance is the nudge
    // plus one snap radius rather than the nudge exactly.
    const endpointTolerance = (s: Scored) =>
      Math.max(300, (s.path.endpointMovedMeters ?? 0) + ENDPOINT_SNAP_MARGIN_M);
    const reachesStops = (s: Scored) => visitsRequiredStops(s.path.coordinates, requiredVia.map(p => [p.lon,p.lat])) &&
      haversineMeters(s.path.coordinates[0], [start.lon,start.lat]) <= endpointTolerance(s) &&
      haversineMeters(s.path.coordinates[s.path.coordinates.length-1], [destination?.lon ?? start.lon,destination?.lat ?? start.lat]) <= endpointTolerance(s);
    const acceptable = (s: Scored) => reachesStops(s) && meetsRideLimits(intent, {
      durationSeconds: s.classified.durationSeconds,
      distanceMeters: s.path.distanceMeters,
      repeatedPercent: 100*s.classified.overlap.repeatedKm / Math.max(0.001, s.classified.overlap.distinctKm+s.classified.overlap.repeatedKm),
    });
    // Everything that routed and reaches the stops, limits or not. When no
    // candidate meets the limits, the shortest of these is the honest
    // answer to "how long does this take at least".
    const routed = scored.filter(reachesStops);
    scored = scored.filter(acceptable);
    let competing = scored.filter((s) => s.competing);
    const fixed = scored.filter((s) => !s.competing);

    // A hard cut before ranking: a candidate that an unreachable anchor sent
    // round the whole Gauja valley came back at 492 km against 177 km and was
    // still shown, because drift only enters the rank linearly. Nothing that
    // far off is what the rider asked for, however little it retraces. The
    // relaxation shapes are allowed further out — they exist to be offered.
    const MAX_LENGTH_RATIO = 1.8;
    const MAX_EXPLORATORY_RATIO = 3.5;
    const MIN_LENGTH_RATIO = 0.4;
    const plausible = competing.filter((s) => {
      if (body.plan?.budget.mode === "flexible") return true;
      const ratio = s.path.distanceMeters / 1000 / targetKm;
      return ratio <= (s.exploratory ? MAX_EXPLORATORY_RATIO : MAX_LENGTH_RATIO) && ratio >= MIN_LENGTH_RATIO;
    });
    if (plausible.length > 0) competing = plausible;

    // How far off the request a route is, as a share of the request, after a
    // free band. The band is the rider's tolerance setting or fifteen
    // minutes / ten kilometres, whichever is larger: nobody minds a
    // 45-minute ride when they asked for 30 if it is a real loop, while two
    // extra hours on a four-hour day is a different ride. Duration requests
    // are judged in minutes from the speed model, distance requests in km.
    const targetMinutes = intent.durationHours ? intent.durationHours * 60 : null;
    const excessDriftPercent = (s: Scored) => {
      if (body.plan?.budget.mode === "flexible") return 0;
      const tolerance = intent.distanceTolerancePercent / 100;
      // "Līdz 4 h" is a ceiling, not a target: a shorter ride is allowed and
      // costs half as much drift as it would against "~4 h", so near-ceiling
      // rides still lead but a clean 3 h loop is not thrown away.
      const isMaximum = body.plan?.budget.constraint === "maximum";
      const drift = (value: number, target: number, free: number) => {
        const off = Math.max(0, Math.abs(value - target) - free);
        return (off / target) * 100 * (isMaximum && value < target ? 0.5 : 1);
      };
      if (targetMinutes) {
        const minutes = s.classified.durationSeconds / 60;
        return drift(minutes, targetMinutes, Math.max(tolerance * targetMinutes, 15));
      }
      const km = s.path.distanceMeters / 1000;
      return drift(km, targetKm, Math.max(tolerance * targetKm, 10));
    };
    const withinTolerance = (s: Scored) => excessDriftPercent(s) === 0;

    if (competing.length > 0) {
      const rank = (s: Scored) => {
        const overlap = s.classified.overlap.repeatedPercent;
        const unpaved =
          s.classified.surfaces.gravelPercent + s.classified.surfaces.dirtPercent;
        const excessDrift = excessDriftPercent(s);

        // Streets count against a loop: fully when the rider asked to avoid
        // towns, a little always, since nobody rides a loop for the suburbs.
        const streetPercent =
          (s.classified.quality.streetKm / (s.path.distanceMeters / 1000)) * 100;

        return loopRank(intent, {
          repeatedPercent: overlap,
          unpavedPercent: unpaved,
          trackPercent: s.classified.roadMix.trackPercent,
          trailPercent: s.classified.roadMix.trailPercent,
          streetPercent,
          excessDriftPercent: excessDrift,
          natureScore: s.classified.quality.natureScore,
          // Backlog item 11c: a coastal road should beat an inland one of
          // otherwise equal quality. Zero away from a published coastline
          // (`hasSeaData`), so every inland ride ranks exactly as before.
          coastPercent: (s.classified.quality.coastKm / (s.path.distanceMeters / 1000)) * 100,
          coastNearPercent: (s.classified.quality.coastNearKm / (s.path.distanceMeters / 1000)) * 100,
          // Backlog item 6: roads a rider has ridden and confirmed. Zero where
          // no contributed GPX covers the area, so rides elsewhere rank
          // exactly as before, and bounded in `score.ts` so it can never buy
          // retracing.
          riddenPercent: (s.classified.quality.riddenKm / (s.path.distanceMeters / 1000)) * 100,
        });
      };

      const byRank = (a: Scored, b: Scored) => {
        const d = rank(a) - rank(b);
        if (Math.abs(d) > 1) return d;
        const err = (s: Scored) => Math.abs(s.path.distanceMeters / 1000 - targetKm);
        return err(a) - err(b);
      };
      competing.sort(byRank);

      // Look around the two best loops (self-hosted only: twelve more
      // routes). A rider with a map does exactly this — nudges the good
      // shape rather than starting over — and it finds loops the fixed
      // shape list misses.
      if (selfHostedRouter() && built.fromShapes && !outOfTime()) {
        // The two best by rank, plus the wide loop that retraces least: when
        // nothing inside tolerance loops cleanly, that is the one worth
        // refining into an offer.
        const bestWide = [...competing]
          .filter((s) => s.exploratory && s.shape)
          .sort((a, b) => a.classified.overlap.repeatedPercent - b.classified.overlap.repeatedPercent)[0];
        const seeds = [...competing.slice(0, 2), ...(bestWide ? [bestWide] : [])]
          .filter((s, i, arr) => s.shape && arr.indexOf(s) === i);
        if (seeds.length > 0) {
          const extra = await runAll(built.fromShapes(seeds.flatMap((s) => mutations(s.shape!))));
          scored = [...scored, ...extra.scored];
          const fresh = extra.scored.filter((s) => {
            const ratio = s.path.distanceMeters / 1000 / targetKm;
            return acceptable(s) && ratio <= (s.exploratory ? MAX_EXPLORATORY_RATIO : MAX_LENGTH_RATIO) && ratio >= MIN_LENGTH_RATIO;
          });
          competing = [...competing, ...fresh].sort(byRank);
        }
      }

      // Different shape parameters can converge on the same roads — offering
      // the rider two near-identical options wastes a slot. Compared on the
      // roads themselves: two loops sharing most of their road pieces are one
      // option, however their stop lists or lengths differ.
      const kept: { keys: Set<string> }[] = [];
      competing = competing.filter((s) => {
        const keys = roadPieceKeys(s.path.coordinates);
        const duplicate = kept.some((k) => {
          let shared = 0;
          for (const key of keys) if (k.keys.has(key)) shared++;
          return shared / Math.min(keys.size, k.keys.size) > DUPLICATE_SHARE;
        });
        if (duplicate) return false;
        kept.push({ keys });
        return true;
      });

      for (const s of competing.slice(0, SHOWN_VARIANTS)) {
        console.log(
          `loop kept: ${s.path.distanceMeters / 1000}km ` +
            `overlap=${s.classified.overlap.repeatedPercent}%`
        );
      }
    }
    // A third option that retraces twice as much as the first is not a
    // choice, it is noise: show fewer options rather than a bad one.
    const bestShown = Math.min(
      ...competing.slice(0, 5).map((s) => s.classified.overlap.repeatedPercent),
      100
    );
    // A version more than ~45% past the free band is a different ride: for a
    // 2-hour request that is already 3 h 15 min. Not shown, however clean.
    const MAX_EXCESS_DRIFT = 45;
    let worthShowing = competing.filter(
      (s) =>
        s.classified.overlap.repeatedPercent <= Math.max(15, bestShown + 10) &&
        excessDriftPercent(s) <= MAX_EXCESS_DRIFT &&
        acceptable(s)
    );
    const budgeted = Boolean(body.plan && body.plan.budget.mode !== "flexible");
    // Nothing near the request. Rīga → Jelgava → Rīga on forest and gravel
    // roads routes at 136–163 km / 4–4.7 h against 2 h (2026-09-11): every
    // candidate was past the cut and the answer was an error that hid
    // exactly the numbers the rider needed. Instead the nearest rides are
    // shown, time first, flagged `infeasible` with the minimum, and the chat
    // asks what to do — more time, asphalt, one way. The rider's limits (a
    // "līdz 2 h" ceiling) are set aside here on purpose: the shortest ride
    // that exists is the answer to "how long at least", and the client says
    // so in the same breath.
    const byNearest = (a: Scored, b: Scored) =>
      excessDriftPercent(a) - excessDriftPercent(b) || a.classified.overlap.repeatedPercent - b.classified.overlap.repeatedPercent;
    const nearest = routed.filter((s) => s.competing).sort(byNearest);
    const infeasible = budgeted && worthShowing.length === 0 && nearest.length > 0;
    if (infeasible) worthShowing = nearest;
    // Prefer routes inside the agreed approximate budget when any exist. Do
    // not silently trade a two-hour ride for 80 min. When none is inside,
    // the rider cares about the time first and the overlap second, so the
    // nearest-to-budget versions lead and the UI says how far off they are.
    const withinBudget = worthShowing.filter(withinTolerance);
    // Inside the free band, closest to what was actually asked for leads.
    // `withinTolerance` is a yes/no — 98 min and 118 min both "fit" a 2 h
    // request — so without this the panel could answer "~2 h" with 1 h 22 and
    // then apologise for it, while a 2 h ride sat unused in the pool.
    const shortfallMinutes = (s: Scored) =>
      targetMinutes ? Math.abs(s.classified.durationSeconds / 60 - targetMinutes) : 0;
    const selection = budgeted
      ? (withinBudget.length
          ? [...withinBudget].sort((a, b) => shortfallMinutes(a) - shortfallMinutes(b))
          : [...worthShowing].sort((a, b) => excessDriftPercent(a) - excessDriftPercent(b)))
      : worthShowing;

    // Three versions from one pool. `selection` is already in balanced-rank
    // order; the other two re-score it on their own axis. Each pick must be
    // a different road set from the ones already taken.
    const km = (c: Scored) => c.path.distanceMeters / 1000;
    const roughShare = (c: Scored) => (c.classified.quality.roughTrackKm / Math.max(1, km(c))) * 100;
    const streetShare = (c: Scored) => (c.classified.quality.streetKm / Math.max(1, km(c))) * 100;
    const common = (c: Scored) => c.classified.overlap.repeatedPercent + excessDriftPercent(c) + streetShare(c) * 0.3;
    // The quick one must genuinely be the quickest of the pair. Scoring the
    // length only against `targetKm` meant that when every candidate sat under
    // the budget the *longest* could win on smoothness alone — measured on a
    // Ķekava → Baldone request: "Taisnākā" came back 43 km / 1 h 22 against a
    // "Līkumotākā" of 25 km / 1 h 8, which makes the label a lie. Ranking is
    // now against the shortest ride actually found, so length always counts.
    const quickestMinutes = Math.min(...selection.map((c) => c.classified.durationSeconds / 60), Infinity);
    // Length is ranked against the quickest ride actually found, not against
    // `targetKm`: with every candidate under budget the *longest* could win on
    // smoothness alone, which is how "Taisnākā" came back 43 km / 1 h 22
    // against a "Līkumotākā" of 25 km / 1 h 8 and made the label a lie.
    const directScore = (c: Scored) =>
      common(c) + c.classified.quality.turnsPer10Km * 4 + roughShare(c) * 0.8 + c.classified.roadMix.trackPercent * 0.5 +
      ((c.classified.durationSeconds / 60) / Math.max(1, quickestMinutes)) * 30;
    // The complex version is the interesting one: tracks, trails, forest and
    // as many turns as the roads offer. A route that doubles back through
    // the woods for a while is a feature here, not a fault.
    const complexScore = (c: Scored) =>
      common(c) -
      (c.classified.roadMix.trackPercent + c.classified.roadMix.trailPercent * 3) * 1.6 -
      roughShare(c) * 0.3 -
      (c.classified.quality.natureScore ?? 0) * 0.15 -
      c.classified.quality.turnsPer10Km * 1.2;
    const detour = (c: Scored) => /^(around|zig)-/.test(c.variant);
    const variantOf = new Map<Scored, RouteVariant>();
    const takenKeys: Set<string>[] = [];
    const distinct = (c: Scored, threshold = DUPLICATE_SHARE) => {
      const keys = roadPieceKeys(c.path.coordinates);
      const dup = takenKeys.some((k) => {
        let shared = 0;
        for (const key of keys) if (k.has(key)) shared++;
        return shared / Math.min(keys.size, k.size) > threshold;
      });
      if (!dup) takenKeys.push(keys);
      return !dup;
    };
    const pick = (variant: RouteVariant, ordered: Scored[]) => {
      const c = ordered.find((x) => !variantOf.has(x) && distinct(x));
      if (c) variantOf.set(c, variant);
    };
    // The complex version may run a little past the free band — a ring
    // around the stop on slow forest tracks costs minutes, and the panel
    // states the overshoot plainly — but only a little: 10% of the request.
    const COMPLEX_EXTRA_DRIFT = 10;
    const complexPool = budgeted && withinBudget.length
      ? worthShowing.filter((c) => withinTolerance(c) || (detour(c) && excessDriftPercent(c) <= COMPLEX_EXTRA_DRIFT))
      : selection;
    const byComplex = [...complexPool].sort((a, b) => complexScore(a) - complexScore(b));
    // A rider who asked for trails gets the trail-rich candidate in the
    // version named for it. Picking in declaration order gave it to
    // "Taisnākā" instead — measured near Sigulda: 15% trail under direct,
    // 4% under complex, which reads as the app ignoring the request.
    if (intent.trailPreference === "lots") pick("complex", byComplex);
    pick("direct", [...selection].filter((c) => !detour(c)).sort((a, b) => directScore(a) - directScore(b)));
    pick("complex", byComplex);
    const order: RouteVariant[] = ["direct", "complex"];
    const picked = [...variantOf.entries()].sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1])).map(([c]) => c);
    // Fewer than three distinct picks (the public BRouter routes far fewer
    // shapes than a self-hosted one, and two shapes can converge on the same
    // roads): fill the remaining slots with the next distinct acceptable
    // candidates, nearest the budget first. A shorter or slightly longer
    // second option beats showing one.
    if (picked.length < SHOWN_VARIANTS) {
      const fillers = (infeasible ? worthShowing : competing)
        .filter((c) => !variantOf.has(c) && (infeasible || excessDriftPercent(c) <= MAX_EXCESS_DRIFT))
        .sort((a, b) => excessDriftPercent(a) - excessDriftPercent(b) || a.classified.overlap.repeatedPercent - b.classified.overlap.repeatedPercent);
      for (const c of fillers) {
        if (picked.length >= SHOWN_VARIANTS) break;
        const slot = order.find((v) => ![...variantOf.values()].includes(v));
        if (!slot || !distinct(c)) continue;
        variantOf.set(c, slot);
        picked.push(c);
      }
      picked.sort((a, b) => order.indexOf(variantOf.get(a)!) - order.indexOf(variantOf.get(b)!));
    }
    // When nothing fits, the nearest to the request leads whatever its label.
    if (infeasible) picked.sort(byNearest);
    const chosen = [...fixed, ...picked].slice(0, SHOWN_VARIANTS);

    /**
     * The runners-up, per category.
     *
     * 36 candidates are routed and all of them pass the acceptance checks;
     * three are shown. A rider who does not like the three should be able to
     * look further rather than spend another generation — so each category
     * carries its next best alternatives, scored exactly the way the shown one
     * was, and `distinct()` keeps them from being the same roads again.
     *
     * They travel as full routes because the rider puts them on the map; that
     * is what costs, hence a hard cap rather than the whole pool.
     */
    const ALTERNATIVES_PER_VARIANT = 2;
    const alternativesFor = new Map<RouteVariant, Scored[]>();
    if (!infeasible) {
      // A wider pool than the three headline picks draw from. Measured on a
      // Sigulda 2 h request: 36 candidates routed, but only 11 sit inside the
      // budget and three of those are already shown — so ranking alternatives
      // over `selection` yielded one. Alternatives may run over the free band
      // (the panel prints every duration, so nothing is hidden); they may not
      // run past MAX_EXCESS_DRIFT, which is the "don't waste my day" line.
      const pool = worthShowing.filter((c) => excessDriftPercent(c) <= MAX_EXCESS_DRIFT);
      const ranking: Record<RouteVariant, Scored[]> = {
        direct: [...pool].filter((c) => !detour(c)).sort((a, b) => directScore(a) - directScore(b)),
        balanced: [...pool.filter((c) => !detour(c)), ...pool.filter(detour)],
        complex: [...pool].sort((a, b) => complexScore(a) - complexScore(b)),
      };
      // Round-robin, not category by category. `distinct` is stateful — it
      // records every route it accepts — so running "direct" to exhaustion
      // first took every remaining road set and left the other two categories
      // empty (measured: 2 alternatives, both direct). One per category per
      // pass gives each an equal claim on what is left.
      const cursor = new Map<RouteVariant, number>(order.map((v) => [v, 0]));
      for (let round = 0; round < ALTERNATIVES_PER_VARIANT; round++) {
        for (const variant of order) {
          const list = ranking[variant] ?? [];
          let i = cursor.get(variant) ?? 0;
          while (i < list.length) {
            const c = list[i++];
            if (variantOf.has(c) || chosen.includes(c)) continue;
            // A looser bar than the three headline picks. Those must read as
            // three different rides at a glance; an alternative only has to be
            // a different ride, and at 0.8 almost every runner-up was rejected
            // as "the same roads".
            if (!distinct(c, ALTERNATIVE_DUPLICATE_SHARE)) continue;
            alternativesFor.set(variant, [...(alternativesFor.get(variant) ?? []), c]);
            break;
          }
          cursor.set(variant, i);
        }
      }
    }

    const startName = placeName(start.label);
    const originName = placeName(origin.label);
    const locale = detectLocale(body.prompt);

    const toRoute = (chosenScored: Scored): GeneratedRoute => {
      const { stops } = chosenScored;
      // A remote loop is shown and exported whole: out, round, back.
      const path = remote ? joinPaths([remote.out, chosenScored.path, remote.back]) : chosenScored.path;
      const classified = remote ? classifyRoute(path) : chosenScored.classified;
      const tet = measureTetCoverage(path.coordinates);
      return {
        id: crypto.randomUUID(),
        // Loops are named after the places they visit; fixed-shape routes
        // (destination, TET) keep their existing descriptive names.
        name: destination
          ? `${startName} → ${placeName(destination.label)}${tet ? " via TET" : ""}`
          : (remote ? `${originName} → ` : "") + nameLoop({
                startLabel: startName,
                difficulty: intent.difficulty,
                stops,
                locale,
                variant: "",
              }).trim(),
        geometry: { type: "LineString", coordinates: path.coordinates },
        segments: classified.segments,
        distanceMeters: path.distanceMeters,
        // From the surface-aware speed model; the router's own figure is a
        // flat ~45 km/h regardless of surface.
        durationSeconds: classified.durationSeconds,
        roadMix: classified.roadMix,
        surfaces: classified.surfaces,
        quality: classified.quality,
        overlap: classified.overlap,
        stops: [...(remote ? [{ name: startName, category: "via" }] : []), ...requiredVia.map(p => ({ name: placeName(p.label), category: "via" })), ...stopLabels(stops, locale)],
        profile: profileName(intent),
        sourcePrompt: body.prompt,
        variant: variantOf.get(chosenScored) ?? "balanced",
        tet,
        ...(body.debug
          ? {
              debugEdges: path.edges.map((e) => ({
                begin: e.beginShapeIndex,
                end: e.endShapeIndex,
                km: Math.round((e.lengthKm ?? 0) * 1000) / 1000,
                tags: e.tags ?? {},
              })),
            }
          : {}),
      };
    };

    const routes: GeneratedRoute[] = chosen.map(toRoute);
    // The runners-up, built the same way and labelled with the category they
    // belong to, so the panel can add them under the card they extend.
    const alternatives: GeneratedRoute[] = [...alternativesFor.entries()]
      .flatMap(([variant, list]) => list.map((c) => ({ ...toRoute(c), variant })));

    // The whole pool with its numbers — on the 422 as well, because "why did
    // nothing come back" is exactly the question that response raises.
    const debugCandidates = body.debug
      ? routed.map((s) => ({
          variant: s.variant,
          km: Math.round(s.path.distanceMeters / 100) / 10,
          min: Math.round(s.classified.durationSeconds / 60),
          repeated: s.classified.overlap.repeatedPercent,
          unpaved: s.classified.surfaces.gravelPercent + s.classified.surfaces.dirtPercent,
          nature: s.classified.quality.natureScore,
          forest: s.classified.quality.forestKm,
          riverside: s.classified.quality.riversideKm,
          // Item 11c: whether any candidate in the pool ever reaches the coast.
          // The search generates the pool and scoring only picks within it, so
          // when a coastal road is never routed at all the sea term cannot pick
          // it — this is the number that says which of the two is happening.
          coast: s.classified.quality.coastKm,
          ascent: s.classified.quality.elevationGainM,
          excessDrift: Math.round(excessDriftPercent(s)),
          acceptable: acceptable(s),
          shown: chosen.includes(s),
          points: routedThrough.get(s.path),
        }))
      : undefined;

    if (routes.length === 0) {
      const firstError =
        settled[0].status === "rejected"
          ? String((settled[0] as PromiseRejectedResult).reason)
          : "unknown";

      // Before blaming the budget, ask whether one of the rider's own pins is
      // simply unreachable on this profile. Measured 2026-09-19: a finish at
      // Pilskalni 2 (a farmstead behind `access=private` roads) killed all ~36
      // candidates while every leg of the ride routed, and the rider was told
      // to "precizē ilgumu" about a problem no amount of time could fix.
      //
      // The diagnosis is a 200 carrying an `unplannable` verdict, exactly like
      // item 7's: nothing broke, and the chat has something honest to say —
      // the place by name, and the two ways out. A 422 here would be a dead
      // end, which is what the rider asked us to stop doing.
      const named: { place: GeocodeResult; name: string; index: number; role: "start" | "via" | "destination" }[] = [
        { place: start, name: placeName(start.label), index: 0, role: "start" as const },
        ...requiredVia.map((p, i) => ({ place: p, name: placeName(p.label), index: i + 1, role: "via" as const })),
        ...(destination
          ? [{ place: destination, name: placeName(destination.label), index: requiredVia.length + 1, role: "destination" as const }]
          : []),
      ];
      const unreachableStop = await findUnreachableStop(
        named,
        buildMotoProfileOptions(intent),
        req.signal
      );
      if (unreachableStop) {
        console.warn(
          `every candidate failed: "${unreachableStop.name}" is not routable on this profile ` +
            `(nearest allowed ground ${unreachableStop.distanceM ?? "?"} m away)`
        );
        const unplannable: UnplannableVerdict = {
          from: placeName(start.label),
          to: placeName((destination ?? requiredVia[requiredVia.length - 1] ?? start).label),
          legKm: 0,
          budgetSeconds: Math.round(PROBE_BUDGET_MS / 1000),
          reason: "error",
          unreachableStop,
        };
        return NextResponse.json(
          {
            unplannable,
            intent,
            parser: parsed.source,
            start: { lat: start.lat, lon: start.lon, label: start.label },
            ...(debugCandidates ? { debugCandidates } : {}),
          },
          { status: 200 }
        );
      }

      // No single place is to blame. Say what was tried, in a shape the page
      // can put into the rider's language and answer with real ways out
      // (`noRoute`): without stops, or on an easier profile — never only
      // "try again", which asks the same question twice. "Precizē ilgumu" is
      // left out of a flexible ride, where no amount of time is the answer.
      // The router's own reason goes to the log and to `debug`: before
      // 2026-09-25 the plan path dropped it, and "no track found" on every
      // candidate was invisible.
      const flexible = body.plan?.budget.mode === "flexible";
      console.warn(`every candidate failed (${settled.length} tried): ${firstError}`);
      return NextResponse.json(
        {
          error: body.plan
            ? `Neizdevās atrast maršrutu, kas izpilda pieturvietas un norādītās robežas.${flexible ? "" : " Precizē ilgumu vai prasības čatā."}`
            : `All route candidates failed: ${firstError}`,
          ...(body.plan ? { noRoute: { tried: settled.length, stops: requiredVia.length, flexible } } : {}),
          ...(debugCandidates ? { debugCandidates, firstError } : {}),
        },
        { status: body.plan ? 422 : 502 }
      );
    }

    // Be honest when nothing came close to the requested length rather than
    // presenting a much longer ride as if it were what was asked for. The
    // threshold is the rider's own tolerance, so raising it in Settings also
    // silences the warning it makes irrelevant.
    // Judged on the loop itself: the transits are not part of the target.
    const shortestKm = Math.min(...chosen.map((c) => c.path.distanceMeters / 1000));
    const tolerated = 1 + intent.distanceTolerancePercent / 100;
    const overshoots = shortestKm > targetKm * tolerated;

    // Some places can't produce a low-overlap loop at the requested length at
    // all: near Tukums nothing under ~150 km gets below 41%. Say so rather
    // than presenting a heavily retraced route without comment.
    const bestOverlap = Math.min(...routes.map((r) => r.overlap.repeatedPercent));

    // The offer: when nothing within tolerance loops cleanly, the best
    // candidate outside it that retraces at least 10 points less. Drawn from
    // the same ranked pool, so it is proportionate to the request — a 30
    // minute ride gets a 45-60 minute suggestion, not a four-hour one.
    const inside = chosen.filter((s) => s.competing && withinTolerance(s));
    const insideBest = inside.length
      ? Math.min(...inside.map((s) => s.classified.overlap.repeatedPercent))
      : bestOverlap;
    // The offer is the NEAREST loop that solves the problem, not the cleanest
    // one anywhere: a 30-minute request near Turaida had a 60-minute loop at
    // 17% and a 93-minute one at 4%, and a rider asked for half an hour wants
    // the first. Among out-of-tolerance loops that retrace at most 20% (and
    // clearly beat the in-tolerance best), take the one closest to the
    // request; only if none is that good, fall back to the cleanest.
    const outside = competing.filter((s) => !withinTolerance(s));
    const solves = outside
      .filter(
        (s) =>
          s.classified.overlap.repeatedPercent <= 20 &&
          s.classified.overlap.repeatedPercent <= insideBest - 10
      )
      .sort((a, b) => excessDriftPercent(a) - excessDriftPercent(b));
    const probe =
      solves[0] ??
      [...outside].sort(
        (a, b) => a.classified.overlap.repeatedPercent - b.classified.overlap.repeatedPercent
      )[0] ??
      null;
    const probeOverlap = probe?.classified.overlap.repeatedPercent;
    const probeWorthOffering =
      probe !== null &&
      probeOverlap !== undefined &&
      insideBest > 20 &&
      probeOverlap <= insideBest - 10 &&
      !chosen.includes(probe);

    const response: GenerateRouteResponse = {
      intent,
      parser: parsed.source,
      ...(debugCandidates ? { debugCandidates } : {}),
      ...(body.debug && calibration
        ? {
            debugCalibration: {
              targetKm,
              radiusKm: Math.round(calibration.radiusMeters / 100) / 10,
              measuredFactor: Math.round(calibration.measuredFactor * 10) / 10,
              measuredKmh: Math.round(calibration.measuredKmh),
              calibrationKm: Math.round(calibration.result.path.distanceMeters / 1000),
            },
          }
        : {}),
      start: origin,
      destination: destination ?? undefined,
      via: remote ? [remote.focus, ...requiredVia] : requiredVia,
      routes,
      // Outside LV/LT/EE the ride is real but its stops are unnamed; say so.
      ...(hasPlaceData(start) ? {} : { sparsePlaceData: true }),
      // Any shown route stitched from sections means the free public router
      // could not plan this ride in one search — the rider is told, because a
      // long route otherwise just looks less considered for no visible reason.
      ...(chosen.some((c) => c.path.assembledFromSegments) ? { assembledFromSegments: true } : {}),
      ...(alternatives.length ? { alternatives } : {}),
      ...(remote
        ? {
            remoteLoop: {
              focus: remote.focus,
              transitOutKm: Math.round(remote.out.distanceMeters / 1000),
              transitOutMinutes: Math.round(remote.outSeconds / 60),
              transitBackKm: Math.round(remote.back.distanceMeters / 1000),
              transitBackMinutes: Math.round(remote.backSeconds / 60),
              loops: chosen.map((c) => ({ km: Math.round(c.path.distanceMeters / 1000), minutes: Math.round(c.classified.durationSeconds / 60) })),
            },
          }
        : {}),
      ...(infeasible
        ? {
            infeasible: {
              requestedMinutes: body.plan?.budget.mode === "duration" && body.plan.budget.value ? Math.round(body.plan.budget.value * 60) : null,
              requestedKm: body.plan?.budget.mode === "distance" && body.plan.budget.value ? Math.round(body.plan.budget.value) : Math.round(targetKm),
              // The whole ride as the rider will ride it: a remote loop's
              // transits count when the budget was for the whole day.
              minimumMinutes: Math.round((chosen[0].classified.durationSeconds + (remote && body.plan?.budgetScope === "total" ? remote.outSeconds + remote.backSeconds : 0)) / 60),
              minimumKm: Math.round((chosen[0].path.distanceMeters + (remote && body.plan?.budgetScope === "total" ? remote.out.distanceMeters + remote.back.distanceMeters : 0)) / 1000),
              ...estimateLegs(
                remote ? [origin, remote.focus, origin] : [origin, ...requiredVia, destination ?? origin],
                plannedAvgSpeedKmh(intent),
                plannedAvgSpeedKmh({ ...intent, gravelPreference: 0, trailPreference: "none" }),
                !destination
              ),
            },
          }
        : {}),
      ...(overshoots && !destination && !infeasible
        ? {
            distanceWarning: {
              targetKm: Math.round(targetKm),
              shortestKm: Math.round(shortestKm),
            },
          }
        : {}),
      ...(bestOverlap > 30 && !destination
        ? { overlapWarning: { bestPercent: bestOverlap } }
        : {}),
      ...(reducedSearch ? { reducedSearch } : {}),
      ...(probeWorthOffering && probe && !destination
        ? {
            longerSuggestion: {
              distanceKm: Math.round(probe.path.distanceMeters / 1000),
              durationMinutes: Math.round(probe.classified.durationSeconds / 60),
              repeatedPercent: probe.classified.overlap.repeatedPercent,
              unpavedPercent:
                probe.classified.surfaces.gravelPercent +
                probe.classified.surfaces.dirtPercent,
              insteadOfPercent: insideBest,
            },
          }
        : {}),
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Route generation failed";
    console.error("generate-route error:", err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
