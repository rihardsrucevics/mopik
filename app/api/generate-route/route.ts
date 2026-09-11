import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, nextPlanQuestion, planToIntent } from "@/lib/chat/ride-plan";
import { hasBeachLikePath, hasUnverifiedMotorPath } from "@/lib/routing/access";
import { visitsRequiredStops } from "@/lib/routing/required-stops";
import {
  expectedAvgSpeedKmh,
  parseDestinationPlace,
  parseRoutePrompt,
  parseStartPlace,
  resolveTargetDistanceKm,
} from "@/lib/ai/parse-route-prompt";
import { bearingDegrees, haversineMeters, inSector, type BearingSector } from "@/lib/geo/geometry";
import { geocode, GeocodeResult } from "@/lib/geo/geocode";
import { findResolvedPlace, type ResolvedPlace } from "@/lib/chat/places";
// Isochrones come from Valhalla (BRouter has none); the routes themselves
// come from BRouter, whose profile we write ourselves — on 25-30 km Baltic
// legs that yields 57-92% unpaved against Valhalla's 1-50%.
import { fetchIsochrone } from "@/lib/routing/valhalla";
import { fetchRoutePath } from "@/lib/routing/brouter";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { buildCostingOptions, profileName } from "@/lib/routing/profiles";
import { pruneSpurs } from "@/lib/routing/prune-spurs";
import { loopRank, meetsRideLimits } from "@/lib/routing/score";
import { classifyRoute } from "@/lib/routing/classify";
import { measureTetCoverage } from "@/lib/routing/tet-coverage";
import { pickTetSlice } from "@/lib/routing/tet";
import { parseIsochrone, type IsoRing } from "@/lib/geo/isochrone";
import { planLoop, type LoopStop } from "@/lib/routing/loop";
import { detectLocale, nameLoop, stopLabels } from "@/lib/routing/name-route";
import {
  GeneratedRoute,
  GenerateRouteResponse,
  RoutePath,
  RouteIntent,
  RouteIntentSchema,
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
    .max(12)
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
const SHOWN_VARIANTS = 3;

/**
 * The three versions shown, in this order: the smoothest and quickest way
 * to ride the request, the balanced one the ranking prefers, and the one
 * that goes deepest into the tracks. All three come from the same candidate
 * pool and pass the same acceptance checks; they differ only in what they
 * optimise. A loop cannot be "straight", so for loops "direct" means few
 * turns and few rough tracks; for one-way rides it is close to the direct road.
 */
export type RouteVariant = "direct" | "balanced" | "complex";

/** Two loops sharing more than this share of their road pieces are one option. */
const DUPLICATE_SHARE = 0.8;

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
};

async function buildCandidates(
  intent: RouteIntent,
  start: GeocodeResult,
  destination: GeocodeResult | null,
  targetKm: number,
  calibration: LoopCalibration | null,
  direction?: BearingSector,
  requiredVia: GeocodeResult[] = []
): Promise<BuiltCandidates> {
  const costingOptions = buildCostingOptions(intent);
  const startPt: [number, number] = [start.lon, start.lat];

  const profileOptions = buildMotoProfileOptions(intent);
  const route = async (points: [number, number][]) => {
    const path = await fetchRoutePath({ points, profileOptions });
    const stops = [...requiredVia, ...(destination ? [destination] : [])].map(p => [p.lon, p.lat] as [number, number]);
    if (!visitsRequiredStops(path.coordinates, stops)) throw new Error("Route did not reach all required stops in order");
    if (destination || intent.includeSightseeing) return path;
    let cleaned: RoutePath;
    try { cleaned = pruneSpurs(path); }
    catch (error) { if (requiredVia.length) return path; throw error; }
    // A requested visit may itself need an out-and-back. Never remove it.
    return visitsRequiredStops(cleaned.coordinates, stops) ? cleaned : path;
  };


  if (requiredVia.length || destination) {
    const places = [start, ...requiredVia, destination ?? start];
    const directKm = places.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.lat-places[i].lat)*111, (p.lon-places[i].lon)*61), 0);
    const spareMeters = Math.max(0, targetKm-directKm) * 1000;
    const reach = Math.min(20000, Math.max(1000, spareMeters / (places.length * 5)));
    const scales = intent.rideStyle === "direct" ? [0, 0.25, 0.5] : [0, 0.35, 0.7, 1, 1.4, 1.8, 2.2, 2.8];
    const candidates: Candidate[] = [];
    for (const scale of scales) for (const side of (scale === 0 ? [1] : [1,-1])) {
      candidates.push({ variant: `via-${scale}-${side}`, competing: true, run: async () => {
        const points: [number, number][] = [startPt];
        for (let i = 1; i < places.length; i++) {
          if (scale) {
            const fractions = intent.rideStyle === "explore" ? [0.3,0.7] : [0.5];
            for (const fraction of fractions) points.push(perpendicularVia(places[i-1], places[i], fraction, reach*scale*side));
          }
          points.push([places[i].lon, places[i].lat]);
        }
        return { path: await route(points) };
      }});
    }
    return { candidates };
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
  const selfHosted = !!process.env.BROUTER_BASE_URL;
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
  return {
    candidates: [...calibrationCandidate, ...shapes.map(toCandidate), ...tetCandidates],
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

export async function POST(req: NextRequest) {
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
    const intent = body.plan ? parsed.intent : body.intent ?? parsed.intent;

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
    let targetKm = body.plan?.budget.mode === "flexible" ? (body.lucky ? 120 : 80) : resolveTargetDistanceKm(intent);

    // Plain loops get a calibration route first (TET and one-way rides have
    // fixed shapes). It corrects the anchor radius — and, for a duration
    // request, the target distance — to what this region actually delivers.
    let calibration: LoopCalibration | null = null;
    if (!destination && !requiredVia.length) {
      const profileOptions = buildMotoProfileOptions(intent);
      calibration = await calibrateLoop(start, intent, targetKm, (points) =>
        fetchRoutePath({ points, profileOptions }).then(path => intent.includeSightseeing ? path : pruneSpurs(path)), direction
      );
      if (calibration) targetKm = calibration.targetKm;
    }

    const built = await buildCandidates(intent, start, destination, targetKm, calibration, direction, requiredVia);
    const candidates = built.candidates;
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

    const CONCURRENCY = process.env.BROUTER_BASE_URL ? 4 : 2;
    const runAll = async (cands: Candidate[]): Promise<{ settled: PromiseSettledResult<Awaited<ReturnType<Candidate["run"]>>>[]; scored: Scored[] }> => {
      const settled: PromiseSettledResult<Awaited<ReturnType<Candidate["run"]>>>[] = [];
      for (let i = 0; i < cands.length; i += CONCURRENCY) {
        const batch = cands.slice(i, i + CONCURRENCY);
        settled.push(...(await Promise.allSettled(batch.map((c) => c.run()))));
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
    // route again. Only when self-hosted: it doubles the request count.
    const SECOND_PASS_TRIGGER = 0.25;
    if (calibration && process.env.BROUTER_BASE_URL) {
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
        }, direction, requiredVia);
        const second = await runAll(again.candidates.filter((c) => !c.exploratory));
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
    const acceptable = (s: Scored) => visitsRequiredStops(s.path.coordinates, requiredVia.map(p => [p.lon,p.lat])) &&
      haversineMeters(s.path.coordinates[0], [start.lon,start.lat]) <= 300 &&
      haversineMeters(s.path.coordinates[s.path.coordinates.length-1], [destination?.lon ?? start.lon,destination?.lat ?? start.lat]) <= 300 && meetsRideLimits(intent, {
      durationSeconds: s.classified.durationSeconds,
      distanceMeters: s.path.distanceMeters,
      repeatedPercent: 100*s.classified.overlap.repeatedKm / Math.max(0.001, s.classified.overlap.distinctKm+s.classified.overlap.repeatedKm),
    });
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
      if (targetMinutes) {
        const minutes = s.classified.durationSeconds / 60;
        const free = Math.max(tolerance * targetMinutes, 15);
        return (Math.max(0, Math.abs(minutes - targetMinutes) - free) / targetMinutes) * 100;
      }
      const km = s.path.distanceMeters / 1000;
      const free = Math.max(tolerance * targetKm, 10);
      return (Math.max(0, Math.abs(km - targetKm) - free) / targetKm) * 100;
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
      if (process.env.BROUTER_BASE_URL && built.fromShapes) {
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
    const worthShowing = competing.filter(
      (s) =>
        s.classified.overlap.repeatedPercent <= Math.max(15, bestShown + 10) &&
        excessDriftPercent(s) <= 60 &&
        acceptable(s)
    );
    // Prefer routes inside the agreed approximate budget when any exist. Do
    // not silently trade a two-hour ride for 80 min.
    const withinBudget = worthShowing.filter(withinTolerance);
    const selection = body.plan && body.plan.budget.mode !== "flexible" && withinBudget.length ? withinBudget : worthShowing;

    // Three versions from one pool. `selection` is already in balanced-rank
    // order; the other two re-score it on their own axis. Each pick must be
    // a different road set from the ones already taken.
    const km = (c: Scored) => c.path.distanceMeters / 1000;
    const roughShare = (c: Scored) => (c.classified.quality.roughTrackKm / Math.max(1, km(c))) * 100;
    const streetShare = (c: Scored) => (c.classified.quality.streetKm / Math.max(1, km(c))) * 100;
    const common = (c: Scored) => c.classified.overlap.repeatedPercent + excessDriftPercent(c) + streetShare(c) * 0.3;
    // "Direct" also means not longer than it needs to be: a smooth 87 km
    // loop should not outrank a smooth 65 km one on a 2-hour request.
    const directScore = (c: Scored) =>
      common(c) + c.classified.quality.turnsPer10Km * 4 + roughShare(c) * 0.8 + c.classified.roadMix.trackPercent * 0.5 +
      (km(c) / Math.max(1, targetKm)) * 25;
    const complexScore = (c: Scored) =>
      common(c) -
      (c.classified.roadMix.trackPercent + c.classified.roadMix.trailPercent) * 0.6 -
      roughShare(c) * 0.3 -
      (c.classified.quality.natureScore ?? 0) * 0.15;
    const variantOf = new Map<Scored, RouteVariant>();
    const takenKeys: Set<string>[] = [];
    const distinct = (c: Scored) => {
      const keys = roadPieceKeys(c.path.coordinates);
      const dup = takenKeys.some((k) => {
        let shared = 0;
        for (const key of keys) if (k.has(key)) shared++;
        return shared / Math.min(keys.size, k.size) > DUPLICATE_SHARE;
      });
      if (!dup) takenKeys.push(keys);
      return !dup;
    };
    const pick = (variant: RouteVariant, ordered: Scored[]) => {
      const c = ordered.find((x) => !variantOf.has(x) && distinct(x));
      if (c) variantOf.set(c, variant);
    };
    pick("direct", [...selection].sort((a, b) => directScore(a) - directScore(b)));
    pick("balanced", selection);
    pick("complex", [...selection].sort((a, b) => complexScore(a) - complexScore(b)));
    const order: RouteVariant[] = ["direct", "balanced", "complex"];
    const picked = [...variantOf.entries()].sort((a, b) => order.indexOf(a[1]) - order.indexOf(b[1])).map(([c]) => c);
    const chosen = [...fixed, ...picked].slice(0, SHOWN_VARIANTS);

    const startName = start.label.split(",")[0];
    const locale = detectLocale(body.prompt);

    const routes: GeneratedRoute[] = chosen.map((chosenScored) => {
      const { path, stops, classified } = chosenScored;
      const tet = measureTetCoverage(path.coordinates);
      return {
        id: crypto.randomUUID(),
        // Loops are named after the places they visit; fixed-shape routes
        // (destination, TET) keep their existing descriptive names.
        name: destination
          ? `${startName} → ${destination.label.split(",")[0]}${tet ? " via TET" : ""}`
          : nameLoop({
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
        stops: [...requiredVia.map(p => ({ name: p.label.split(",")[0], category: "via" })), ...stopLabels(stops, locale)],
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
    });

    if (routes.length === 0) {
      const firstError =
        settled[0].status === "rejected"
          ? String((settled[0] as PromiseRejectedResult).reason)
          : "unknown";
      return NextResponse.json(
        { error: body.plan ? "Neizdevās atrast maršrutu, kas izpilda pieturvietas un norādītās robežas. Precizē ilgumu vai prasības čatā." : `All route candidates failed: ${firstError}` },
        { status: body.plan ? 422 : 502 }
      );
    }

    // Be honest when nothing came close to the requested length rather than
    // presenting a much longer ride as if it were what was asked for. The
    // threshold is the rider's own tolerance, so raising it in Settings also
    // silences the warning it makes irrelevant.
    const shortestKm = Math.min(...routes.map((r) => r.distanceMeters / 1000));
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
      ...(body.debug
        ? {
            debugCandidates: scored.map((s) => ({
              variant: s.variant,
              km: Math.round(s.path.distanceMeters / 100) / 10,
              min: Math.round(s.classified.durationSeconds / 60),
              repeated: s.classified.overlap.repeatedPercent,
              unpaved: s.classified.surfaces.gravelPercent + s.classified.surfaces.dirtPercent,
              nature: s.classified.quality.natureScore,
              forest: s.classified.quality.forestKm,
              riverside: s.classified.quality.riversideKm,
              ascent: s.classified.quality.elevationGainM,
              excessDrift: Math.round(excessDriftPercent(s)),
              shown: chosen.includes(s),
            })),
          }
        : {}),
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
      start,
      destination: destination ?? undefined,
      via: requiredVia,
      routes,
      ...(overshoots && !destination
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
