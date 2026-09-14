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
  /**
   * How far, in metres, an endpoint had to be moved to route at all. Some
   * places geocode onto a way this profile forbids — Ērgļi's centre sits on a
   * `highway=footway` — and BRouter then refuses the whole request rather
   * than stopping short. The router looks for routable ground nearby and
   * records the distance here so the endpoint check can allow exactly that
   * much slack instead of discarding a ride that is as close as the road
   * network permits. Absent when the route ends where it was asked to.
   */
  endpointMovedMeters?: number;
  /**
   * True when the leg was too long for the public BRouter and was ridden in
   * pieces and stitched together (see `routeInSegments`). The split points are
   * arbitrary, so the router optimised each piece rather than the whole ride —
   * the route is real and rideable, but not as good as one search would give,
   * and the UI says so rather than presenting it as equivalent.
   */
  assembledFromSegments?: boolean;
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
  /**
   * An OSM path with no positive motorcycle access tag. Already counted in
   * `quality.unverifiedPathKm`; carried per segment so the map can mark the
   * stretches the rider should check signs on.
   */
  unverified?: boolean;
  /**
   * How many gates stand on this stretch — `barrier=gate|lift_gate|swing_gate|
   * chain|bollard|cattle_grid` nodes that are members of the way's own node
   * list, matched as **vertices of the route geometry**, never by proximity: a
   * driveway's gate 10 m off the line is not a gate on this road. Absent rather
   * than 0 on the great majority of stretches.
   *
   * Already counted in `quality.gateCount`; carried per segment so the map can
   * mark them and the segment card can say so, the way `unverified` already
   * does. Unlike `unverified` it does not split a run: a gate is a point on the
   * road, not a property of it.
   */
  gates?: number;
  /**
   * Where those gates are, `[lon, lat]` each, in the order they are met.
   *
   * On the feature rather than on the route because `segments` is the only
   * thing that reaches the map, and because a spliced ride (a detour to a
   * sight) is built by concatenating features — so it keeps exactly the gates
   * of the stretches it kept. Present whenever `gates` is.
   */
  gatePoints?: [number, number][];
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
  /**
   * How many gates stand on the roads this ride uses — backlog item 12, as the
   * rider settled it.
   *
   * One explicit OSM fact and nothing derived from it: a
   * `barrier=gate|lift_gate|swing_gate|chain|bollard|cattle_grid` node that is a
   * **member of** a `highway=track|service|unclassified` way, and *on the road
   * actually ridden* — matched as a vertex of the route geometry, which is what
   * membership looks like once BRouter has returned the way. Never by
   * proximity: the rider's second correction, after a 15 m radius marked the
   * gates on driveways beside the route ("ja vārti nav uz paša maršruta ceļa —
   * jāņem ārā"). The earlier build that inferred a farmyard from nearby
   * buildings and `landuse` polygons was rejected the same way — "mēs nevaram
   * minēt", we cannot guess — and is gone.
   *
   * **No route is ever changed by it.** No cost, no penalty, no rejection: a
   * Latvian forest gate stands open more often than not, so it is reported the
   * way `unverifiedPathKm` is.
   *
   * A count, because a gate is a point. And `undefined`, never 0, where no
   * published country covers the ride — absent data means "not measured", not
   * "no gates", so the panel can stay silent instead of claiming a clean road
   * it has never looked at. Only Latvia is built (`lib/geo/gates.ts`).
   */
  gateCount?: number;
  /**
   * Kilometres ridden within 1 km of a coastline, on a real road — backlog
   * item 11c, the rider's "riding along the coast should be preferred, because
   * the view is beautiful".
   *
   * `highway=path` and the rest of the trail classes are excluded: on the
   * Baltic the thing physically nearest the water is usually the beach or dune
   * footpath, and item 11a spent a day making those dear. A coastal bonus that
   * counted them would hand it straight back.
   *
   * Measured geometrically against `lib/geo/sea.ts`, because BRouter's
   * `lookups.dat` has no `natural` key at all and `estimated_river_class` is a
   * river signal that reads 1 or nothing on roads that are unarguably on the
   * coast (item 11b). 0 where no coastline dataset covers the ride — "not
   * measured", not "nowhere near the sea".
   */
  coastKm: number;
  /** The same, at a 3 km band: within sight of the water rather than on the
   * shore road. Weighted far lower in `score.ts` for that reason. */
  coastNearKm: number;
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
    /** km within 1 km of a coastline on a real road — whether the pool ever
     * reaches the sea at all, which scoring cannot fix if it does not. */
    coast: number;
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
   * Set when the ride was too long for the free public router and had to be
   * assembled from shorter sections. The route is real and rideable, but each
   * section was optimised on its own rather than the whole ride, so it is
   * honestly a worse route than Mopik's own server would produce.
   */
  assembledFromSegments?: boolean;
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
  /**
   * Set when the feasibility probe measured the headline leg as slow and the
   * search was cut to what the remaining budget could pay for. The rider is
   * told how many versions were actually tried rather than being left to
   * wonder why one card came back instead of two.
   */
  reducedSearch?: {
    /** candidates the generation could afford at the measured leg cost */
    tried: number;
    /** candidates it would have tried on a fast leg */
    planned: number;
    /** what one routed leg cost, seconds — the probe's measurement */
    legSeconds: number;
  };
  /**
   * Set instead of `routes` when the feasibility probe showed the ride cannot
   * be planned in one go. A 200, not an error: nothing broke, and the chat
   * has something honest to say. `routes` is absent.
   */
  unplannable?: UnplannableVerdict;
};

/**
 * The ride is too hard to search for Mopik to plan in one go — said *before*
 * the candidate search rather than after 50 s of waiting. Carries what the
 * probe measured so the chat can be specific instead of generic.
 */
export type UnplannableVerdict = {
  /** the leg that decided it, as the rider named it */
  from: string;
  to: string;
  /** straight-line km of that leg */
  legKm: number;
  /** how long the probe was allowed, seconds */
  budgetSeconds: number;
  /** "timeout" when it ran out of time, "error" when the router refused */
  reason: "timeout" | "error";
};
