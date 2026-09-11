import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { RidePlanSchema, nextPlanQuestion, planToIntent } from "@/lib/chat/ride-plan";
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
import { fetchRoutePath } from "@/lib/routing/brouter";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { buildCostingOptions, profileName } from "@/lib/routing/profiles";
import { pruneSpurs } from "@/lib/routing/prune-spurs";
import { joinPaths } from "@/lib/routing/join-paths";
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
  // The complex version's own profile: as much forest and gravel as the
  // rider's surface choice allows. Asphalt-only riders keep asphalt.
  const deepOptions = intent.gravelPreference > 10
    ? buildMotoProfileOptions({ ...intent, gravelPreference: 100, preferForest: true })
    : profileOptions;
  const route = async (points: [number, number][], options = profileOptions) => {
    const path = await fetchRoutePath({ points, profileOptions: options });
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
    const selfHostedVia = !!process.env.BROUTER_BASE_URL;
    const scales = intent.rideStyle === "direct" ? [0, 0.25, 0.5] : selfHostedVia ? [0, 0.35, 0.7, 1, 1.4, 1.8, 2.2, 2.8] : [0, 0.7, 1.4, 2.2];
    const candidates: Candidate[] = [];
    // On a round trip the -1 side is the +1 shape ridden the other way round
    // (same roads, same overlap — measured identical to the metre), so there
    // it becomes a different shape instead: the way out at full offset, the
    // way back at about half, bent at other points.
    const roundTrip = !destination;
    for (const scale of scales) for (const side of (scale === 0 ? [1] : [1,-1])) {
      const asymmetric = roundTrip && side === -1;
      candidates.push({ variant: `via-${scale}-${asymmetric ? "a" : side}`, competing: true, run: async () => {
        const points: [number, number][] = [startPt];
        for (let i = 1; i < places.length; i++) {
          if (scale) {
            const fractions = asymmetric ? (i === 1 ? [0.3, 0.7] : [0.35, 0.65]) : intent.rideStyle === "explore" ? [0.3,0.7] : [0.5];
            const legScale = asymmetric && i > 1 ? scale * 0.55 : scale;
            for (const fraction of fractions) points.push(perpendicularVia(places[i-1], places[i], fraction, reach*legScale*(asymmetric ? 1 : side)));
          }
          points.push([places[i].lon, places[i].lat]);
        }
        return { path: await route(points) };
      }});
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

/**
 * Wall-clock budget for one generation. Vercel's hobby plan kills the function
 * at 60 s and answers with an HTML error page; the browser then fails to parse
 * JSON (Safari: "The string did not match the expected pattern") — that was
 * the "bug" riders saw on long rides via the public BRouter. Below the cap the
 * search stops launching new batches and answers with the best it has.
 */
const TIME_BUDGET_MS = process.env.BROUTER_BASE_URL ? 110_000 : 40_000;

/** Rejects when the budget runs out; the underlying fetch is left to finish alone. */
function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("time budget exhausted")), Math.max(0, ms));
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const remainingMs = () => TIME_BUDGET_MS - (Date.now() - startedAt);
  const outOfTime = () => remainingMs() <= 0;
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
        console.log(`remote loop: ${origin.label.split(",")[0]} → ${focus.label.split(",")[0]} ${(out.distanceMeters / 1000).toFixed(0)} km / ${Math.round(outSeconds / 60)} min out, ${(back.distanceMeters / 1000).toFixed(0)} km / ${Math.round(backSeconds / 60)} min back (shares ${Math.round(sharedWithOut(back) * 100)}%)`);
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
    const fixedPlaces = [start, ...requiredVia, destination ?? start];
    const fixedDirectKm = fixedPlaces.slice(1).reduce((sum, p, i) => sum + Math.hypot((p.lat - fixedPlaces[i].lat) * 111, (p.lon - fixedPlaces[i].lon) * 61), 0);
    let targetKm = body.plan?.budget.mode === "flexible"
      ? (remote ? 60 : body.lucky ? 120 : (requiredVia.length || destination) ? Math.max(80, Math.round(fixedDirectKm * 1.25)) : 80)
      : resolveTargetDistanceKm(intent);

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
        }, direction, requiredVia);
        const retry = again.candidates.filter((c) => !c.exploratory);
        const second = await runAll(process.env.BROUTER_BASE_URL ? retry : retry.slice(0, PUBLIC_SECOND_PASS_SHAPES));
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
    const reachesStops = (s: Scored) => visitsRequiredStops(s.path.coordinates, requiredVia.map(p => [p.lon,p.lat])) &&
      haversineMeters(s.path.coordinates[0], [start.lon,start.lat]) <= 300 &&
      haversineMeters(s.path.coordinates[s.path.coordinates.length-1], [destination?.lon ?? start.lon,destination?.lat ?? start.lat]) <= 300;
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
      if (process.env.BROUTER_BASE_URL && built.fromShapes && !outOfTime()) {
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
    const selection = budgeted
      ? (withinBudget.length ? withinBudget : [...worthShowing].sort((a, b) => excessDriftPercent(a) - excessDriftPercent(b)))
      : worthShowing;

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
    // The complex version is the interesting one: tracks, trails, forest and
    // as many turns as the roads offer. A route that doubles back through
    // the woods for a while is a feature here, not a fault.
    const complexScore = (c: Scored) =>
      common(c) -
      (c.classified.roadMix.trackPercent + c.classified.roadMix.trailPercent) * 0.6 -
      roughShare(c) * 0.3 -
      (c.classified.quality.natureScore ?? 0) * 0.15 -
      c.classified.quality.turnsPer10Km * 1.2;
    const detour = (c: Scored) => /^(around|zig)-/.test(c.variant);
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
    pick("direct", [...selection].filter((c) => !detour(c)).sort((a, b) => directScore(a) - directScore(b)));
    // Balanced is the clean middle: plain corridors first, a ring or wiggle
    // only if nothing else is left — those belong to the complex version.
    pick("balanced", [...selection.filter((c) => !detour(c)), ...selection.filter(detour)]);
    // The complex version may run a little past the free band — a ring
    // around the stop on slow forest tracks costs minutes, and the panel
    // states the overshoot plainly — but only a little: 10% of the request.
    const COMPLEX_EXTRA_DRIFT = 10;
    const complexPool = budgeted && withinBudget.length
      ? worthShowing.filter((c) => withinTolerance(c) || (detour(c) && excessDriftPercent(c) <= COMPLEX_EXTRA_DRIFT))
      : selection;
    pick("complex", [...complexPool].sort((a, b) => complexScore(a) - complexScore(b)));
    const order: RouteVariant[] = ["direct", "balanced", "complex"];
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

    const startName = start.label.split(",")[0];
    const originName = origin.label.split(",")[0];
    const locale = detectLocale(body.prompt);

    const routes: GeneratedRoute[] = chosen.map((chosenScored) => {
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
          ? `${startName} → ${destination.label.split(",")[0]}${tet ? " via TET" : ""}`
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
        stops: [...(remote ? [{ name: startName, category: "via" }] : []), ...requiredVia.map(p => ({ name: p.label.split(",")[0], category: "via" })), ...stopLabels(stops, locale)],
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
          ascent: s.classified.quality.elevationGainM,
          excessDrift: Math.round(excessDriftPercent(s)),
          acceptable: acceptable(s),
          shown: chosen.includes(s),
        }))
      : undefined;

    if (routes.length === 0) {
      const firstError =
        settled[0].status === "rejected"
          ? String((settled[0] as PromiseRejectedResult).reason)
          : "unknown";
      return NextResponse.json(
        {
          error: body.plan ? "Neizdevās atrast maršrutu, kas izpilda pieturvietas un norādītās robežas. Precizē ilgumu vai prasības čatā." : `All route candidates failed: ${firstError}`,
          ...(debugCandidates ? { debugCandidates } : {}),
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
