import { z } from "zod";
import type { FeasibilityVerdict } from "@/lib/chat/feasibility";

export const RouteIntentSchema = z.object({
  routeType: z.enum(["round_trip", "point_to_point"]).default("round_trip"),
  distanceKm: z.number().min(20).max(600).optional(),
  durationHours: z.number().min(0.5).max(16).optional(),
  rideStyle: z.enum(["direct", "balanced", "explore"]).default("balanced"),
  minimumDurationHours: z.number().nonnegative().optional(),
  minimumDistanceKm: z.number().nonnegative().optional(),
  maxRepeatedPercent: z.number().min(0).max(100).optional(),
  prioritizeLowOverlap: z.boolean().default(false),
  durationIsMaximum: z.boolean().default(false),
  distanceIsMaximum: z.boolean().default(false),
  difficulty: z.enum(["easy", "adventure", "hard"]).default("easy"),
  /** 0–100, how much unpaved/gravel the rider wants */
  gravelPreference: z.number().min(0).max(100).default(40),
  /** appetite for trail / single-track ("dotted line") segments */
  trailPreference: z.enum(["none", "some", "lots"]).default("none"),
  /** Whether a bare OSM path may be used without explicit motorcycle access. */
  accessPolicy: z.enum(["verified", "allow_unverified"]).default("verified"),
  /** Forest riding is distinct from gravel roads and permission to use trails. */
  preferForest: z.boolean().default(false),
  /** Tourist stops only when explicitly requested. */
  includeSightseeing: z.boolean().default(false),
  avoidMotorways: z.boolean().default(true),
  avoidMainRoads: z.boolean().default(false),
  /** "bez dziļām smiltīm" — deep sand is the hazard riders most often ask to avoid */
  noSand: z.boolean().default(false),
  /** stay out of residential streets, yards and town centres */
  avoidTowns: z.boolean().default(false),
  returnToStart: z.boolean().default(true),
  /** Consider TET sections as optional candidates, alongside ordinary loops. */
  includeTet: z.boolean().default(false),
  /**
   * How much of the area around a stop to ride: "some" puts a small ring
   * around each via place into the winding/complex versions; "more" spends
   * more of the spare budget there ("vairāk apkārtnes").
   */
  surroundings: z.enum(["some", "more"]).default("some"),
  /**
   * How far from the requested distance/duration a route may land, as a
   * percentage. Loop length can't be dialled in precisely — a loop's length
   * is whatever the road network allows between its anchors — so this lets
   * the rider trade exactness for routes that cover more new ground.
   */
  distanceTolerancePercent: z.number().min(5).max(60).default(20),
});

export type RouteIntent = z.infer<typeof RouteIntentSchema>;

/**
 * Provider-neutral routed path, so classification doesn't depend on which
 * routing engine produced it.
 */
export type RoutePath = {
  distanceMeters: number;
  /** seconds — note Valhalla reports seconds where GraphHopper used ms */
  durationSeconds: number;
  coordinates: [number, number][]; // [lon, lat]
  /** DEM elevation aligned with coordinates; null where the router has no value. */
  elevations?: (number | null)[];
  /** per-edge detail; empty when the attribute lookup was unavailable */
  edges: RouteEdge[];
};

/** One routed edge, carrying raw provider enum values for classification. */
export type RouteEdge = {
  beginShapeIndex: number;
  endShapeIndex: number;
  surface?: string;
  use?: string;
  roadClass?: string;
  unpaved?: boolean;
  /** edge length in km, as reported by the router */
  lengthKm?: number;
  /** OSM way id — the key to detecting roads ridden more than once */
  wayId?: number;
  /**
   * Raw OSM tags of the way (BRouter reports them verbatim). Everything the
   * rider-facing quality signals need — tracktype, smoothness, access,
   * service type — lives here rather than in the few normalised fields above.
   */
  tags?: Record<string, string>;
};

/**
 * How much of a route retraces roads it already used.
 *
 * The point of a loop is covering new ground, so this — not how closely the
 * distance hits the target, nor how circular the shape looks — is the measure
 * of a good route. An oval or an irregular sprawl is fine; riding the same
 * road twice is not.
 */
export type OverlapStats = {
  /** distance ridden on roads already covered earlier in the route */
  repeatedKm: number;
  /** distinct road distance covered */
  distinctKm: number;
  repeatedPercent: number;
};

export type RoadClass = "road" | "track" | "trail";

export type SurfaceClass =
  | "asphalt"
  | "gravel"
  | "compacted"
  | "ground"
  | "dirt"
  | "sand"
  | "unknown";

export type RouteSegmentProperties = {
  roadClass: RoadClass;
  surface: SurfaceClass;
  trackGrade?: string;
  distanceMeters: number;
};

export type RouteMix = {
  roadPercent: number;
  trackPercent: number;
  trailPercent: number;
  roadKm: number;
  trackKm: number;
  trailKm: number;
};

/**
 * What a rider feels that the mix percentages don't show. All measured from
 * the raw OSM tags and the geometry; see classify.ts.
 */
export type RouteQuality = {
  /** tracks tagged grade4/grade5 or smoothness bad or worse */
  roughTrackKm: number;
  sandKm: number;
  /** residential streets, living streets, service roads and yards */
  streetKm: number;
  /** OSM highway=path distance without a positive motorcycle access tag. */
  unverifiedPathKm: number;
  /** paved↔unpaved switches; each one is a turn onto or off a side road */
  surfaceSwitches: number;
  /** heading changes over 70°, per 10 km — a proxy for junction turns */
  turnsPer10Km: number;
  /** Road distance in BRouter's medium/deep forest surroundings. */
  forestKm: number;
  /** Road distance with a strong BRouter river-proximity signal. */
  riversideKm: number;
  /** Quiet open-country distance; a provisional field/meadow proxy. */
  ruralOpenKm: number;
  /** Meaningful changes between forest, waterside and open-country runs. */
  landscapeTransitions: number;
  /** Number of the three landscape types covering a material part of the ride. */
  landscapeTypes: number;
  /** Smoothed cumulative ascent from the router's DEM elevations. */
  elevationGainM: number;
  /** Highest minus lowest routed elevation. */
  elevationRangeM: number;
  /** Internal 0–100 candidate-ranking signal; provisional until rider-labelled. */
  natureScore: number;
};

export type SurfaceMix = {
  asphaltPercent: number;
  gravelPercent: number;
  dirtPercent: number;
  unknownPercent: number;
};

export type GeneratedRoute = {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  roadMix: RouteMix;
  surfaces: SurfaceMix;
  quality: RouteQuality;
  /** how much of the route retraces its own roads — the key quality measure */
  overlap: OverlapStats;
  /** named places the loop was planned around, in riding order */
  stops?: { name: string; category: string }[];
  profile: string;
  sourcePrompt: string;
  /** short label distinguishing this alternative, e.g. "TET northbound" */
  variant: string;
  /** Approximate actual geometry overlap with the local TET reference. */
  tet?: { sectionName: string; sliceKm: number };
  /** raw per-edge OSM tags; only present when the request asked for `debug` */
  debugEdges?: { begin: number; end: number; km: number; tags: Record<string, string> }[];
};

export type GenerateRouteResponse = {
  intent: RouteIntent;
  /** which prompt parser produced the intent and places */
  parser: "llm" | "heuristic" | "plan";
  /** only with `debug: true`: every routed candidate, shown or not */
  debugCandidates?: {
    variant: string;
    km: number;
    min: number;
    repeated: number;
    unpaved: number;
    nature: number;
    forest: number;
    riverside: number;
    ascent: number;
    excessDrift: number;
    /** reaches the stops and meets the rider's limits (ceiling, minimum, max repeated) */
    acceptable: boolean;
    shown: boolean;
  }[];
  /** only with `debug: true`: what the calibration route measured */
  debugCalibration?: {
    targetKm: number;
    radiusKm: number;
    measuredFactor: number;
    measuredKmh: number;
    calibrationKm: number;
  };
  start: { lat: number; lon: number; label: string };
  destination?: { lat: number; lon: number; label: string };
  via?: { lat: number; lon: number; label: string }[];
  routes: GeneratedRoute[];
  /**
   * The runners-up per category — the rest of the pool the rider never saw.
   * 36 candidates are routed for a typical request and three are shown; these
   * let a rider who dislikes all three look further without spending another
   * generation. Each carries the `variant` of the card it extends.
   */
  alternatives?: GeneratedRoute[];
  /**
   * Set when the ride was built as transit → loop → transit around a focus
   * area away from the start ("meža aplis Baldones mežos, no Rīgas"). The UI
   * shows the split so the rider sees where the time goes.
   */
  remoteLoop?: {
    focus: { lat: number; lon: number; label: string };
    transitOutKm: number;
    transitOutMinutes: number;
    transitBackKm: number;
    transitBackMinutes: number;
    /** the loop part of each shown route, in route order */
    loops: { km: number; minutes: number }[];
  };
  /**
   * Set when every route came back well outside the requested length, so the
   * UI can say so instead of quietly presenting a much longer ride. Very
   * short targets are the usual cause: a loop that leaves town and returns a
   * different way has a floor of roughly 20 km whatever we ask for.
   */
  distanceWarning?: { targetKm: number; shortestKm: number };
  /**
   * Set when the ride is outside the pre-baked POI dataset (LV/LT/EE). The
   * route is real and the overlap figures are real; what is missing is the
   * named stops that turn a loop into "Caur Turaidu un Krimuldu". Said out
   * loud rather than left for the rider to notice.
   */
  sparsePlaceData?: boolean;
  /**
   * Set when nothing came close to the request and `routes` are the nearest
   * rides instead: Rīga → Jelgava → Rīga on forest roads is at least ~4 h,
   * whatever the rider typed. Carries the minimum we routed and the direct
   * legs' estimate so the client can ask what to do (more time, asphalt,
   * one way) instead of showing an error.
   */
  infeasible?: FeasibilityVerdict;
  /**
   * Set when even the best option retraces a lot of its own road. Around
   * Tukums, for instance, every loop under ~150 km repeats 41-52% however the
   * anchors, stop count or surface preference are set — the connected network
   * simply doesn't offer a way back that differs from the way out. Better to
   * say so than to let the rider assume the generator is at fault.
   */
  overlapWarning?: { bestPercent: number };
  /**
   * A concrete alternative found outside the requested length, offered when
   * nothing inside tolerance loops cleanly. It is never substituted for what
   * the rider asked for — it is shown as a choice, with the numbers, so
   * "the network won't allow it here" comes with something actionable.
   */
  longerSuggestion?: {
    distanceKm: number;
    durationMinutes: number;
    repeatedPercent: number;
    unpavedPercent: number;
    /** repeated share of the best in-tolerance option, for comparison */
    insteadOfPercent: number;
  };
};
