import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";

/**
 * Including a suggested sight, without re-planning the ride.
 *
 * The rider settled this after living with "Pārģenerēt": ticking a place cost
 * a full 20–50 s generation, so three places cost three generations and he
 * could never see what two of them did together. Pre-computing every
 * combination is not an option — a generation searches 36 candidates — but
 * the shape of the problem lets us do something much cheaper.
 *
 * A *nearby* suggestion is 0.2–3 km off a line that is already drawn. Riding
 * to it is therefore not a new route: it is a **detour** off the drawn one and
 * back onto it, two short legs the router answers in a second or two. So the
 * suggestions' detours are routed in the background as soon as a ride is
 * shown, and ticking one splices the stretch in on the spot.
 *
 * ## What this module is, and what it is not
 *
 * Everything here is arithmetic on a polyline: where a detour leaves the
 * route, where it rejoins, and what the ride looks like with several of them
 * spliced in. No routing, no `fs`, no dataset — so the same functions run on
 * the server (choosing the entry and exit points to route between) and in the
 * browser (splicing the answer into the drawn line the moment a box is
 * ticked). That is deliberate: a splice computed one way on the server and
 * another way on the client is a class of bug this avoids entirely.
 *
 * "Optimizēt maršrutu" — the old Pārģenerēt — is still there and still runs
 * the full search with the sights as vias. The difference is that it is now
 * optional: the detour is a real routed line, not a preview of one.
 */

/**
 * How much cheaper a loop detour must be before it beats riding out and back.
 *
 * The rider's own rule, in his words: *"uz apskates vietu var braukt turp un
 * atpakaļ pa vienu ceļu, ja vien braukt apli (nebraukt atpakaļ pa to pašu) ir
 * par X % izdevīgāk."* Riding the same 300 m twice to see a waterfall is what
 * a rider actually does and costs him nothing he minds; the product's
 * no-repeated-roads rule is about the *ride*, not about a spur to a viewpoint.
 *
 * So out-and-back is the default and a loop has to earn its place. 15 % to
 * start, which on a typical 600 m spur means the loop must save ~180 m — small
 * enough that a genuinely better loop still wins, large enough that a loop
 * which is merely different does not.
 *
 * This also removes a real failure mode by construction. Measured on the
 * Sigulda round trip: Taurētāju kalns sits 205 m off the route across the
 * Gauja ravine, and the entry → sight → exit shape had to go 15.9 km round by
 * the nearest bridge. Out-and-back to the same sight is always available and
 * always the honest number, so a sight can no longer be priced at a detour the
 * rider would never make.
 */
export const LOOP_MUST_BEAT_OUT_AND_BACK_BY = 0.15;

/**
 * When a detour is so much longer than the straight line that it deserves a
 * second look rather than a checkbox.
 *
 * Measured on the Sigulda round trip, and this is why the rule exists. Two
 * sights sit ~200 m off the route across the Gauja:
 *
 * | sight            | off route | our profile | `trekking` | `car-fast` |
 * |------------------|-----------|-------------|------------|------------|
 * | Gūtmaņa ala      | 170 m     | 10.4 km     | 0.77 km    | 10.48 km   |
 * | Taurētāju kalns  | 206 m     | 10.3 km     | 1.02 km    | 0.50 km    |
 *
 * Both readings are *true* and they mean different things. Gūtmaņa ala is
 * reachable in 800 m on foot or by bicycle and 10.5 km by car — the near bank
 * has a footpath and no road, so a motorcycle really must go round by the
 * bridge. Taurētāju kalns a car reaches in 500 m, so our own forest profile is
 * declining a road it could use.
 *
 * A "+10 km" next to a "205 m" reads as a contradiction, and the rider
 * reported it as one. The first answer was to withhold the checkbox; he
 * rejected that, for the third time in as many days and in the same words:
 * **Mopik does not decide for the rider, it shows honest numbers and lets him
 * choose.** Taking the tick away decided for him — a detour he might well want
 * (the ride past Gūtmaņa ala *is* a ride, and 17 km of it is his to judge)
 * became something he could only get by spending a whole generation.
 *
 * So this flag is now a **label, not a gate**. The row keeps its checkbox and
 * its plain, unmuted numbers, and adds a quiet "garš apbrauciens" after the
 * delta with one sentence in Vairāk saying why the two figures disagree.
 * Ticking one works exactly like any other detour. "Optimizēt maršrutu"
 * remains the way to have the whole ride planned through the place, and may
 * still find a road the spur search did not.
 *
 * `4 x straight-line + 3 km`: the constant absorbs short spurs where a bend in
 * the road easily doubles the crow-flight distance, and the multiplier catches
 * the "across the river" shape at every scale.
 */
export const SUSPICIOUS_DETOUR_FACTOR = 4;
export const SUSPICIOUS_DETOUR_SLACK_M = 3_000;

/**
 * Whether a detour is so far past the straight line that it deserves a word of
 * explanation beside its numbers. A display flag only — it never removes the
 * rider's choice. See `SUSPICIOUS_DETOUR_FACTOR`.
 */
export function isSuspiciousDetour(params: {
  /** how far the sight is from the route, in metres */
  offRouteMeters: number;
  /** what the detour actually adds, in metres */
  deltaMeters: number;
}): boolean {
  const expected = params.offRouteMeters * 2 * SUSPICIOUS_DETOUR_FACTOR + SUSPICIOUS_DETOUR_SLACK_M;
  return params.deltaMeters > expected;
}

/** How far before the nearest point the detour leaves the route. */
export const ENTRY_BACK_M = 500;

/** The band the entry point is allowed to land in; see `pickEntryExit`. */
export const ENTRY_MIN_M = 300;
export const ENTRY_MAX_M = 800;

/**
 * How far past the nearest point the detour rejoins.
 *
 * Symmetric with the entry on purpose. The replaced stretch is then centred
 * on the point nearest the sight, which is the stretch a rider would actually
 * skip by turning off — and a detour that rejoined *at* the nearest point
 * would double back along its own entry leg to get there.
 */
export const EXIT_FORWARD_M = 500;

/** Cap per request: eight is `MAX_NEARBY`, which is the whole nearby list. */
export const MAX_DETOUR_POIS = 8;

/**
 * Cumulative distance along a line, in metres, per vertex.
 *
 * Same computation `lib/poi/route-pois.ts` does for the same reason: once per
 * route rather than once per POI.
 */
export function cumulative(line: Point[]): number[] {
  const out = new Array<number>(line.length);
  out[0] = 0;
  for (let i = 1; i < line.length; i++) out[i] = out[i - 1] + haversineMeters(line[i - 1], line[i]);
  return out;
}

/**
 * The point on the line at a given distance along it, plus the vertex index
 * it falls at or after.
 *
 * Interpolated rather than snapped to the nearest vertex: BRouter emits
 * vertices tens of metres apart on a straight road, and snapping would move
 * an entry point by up to that much — enough, on a short detour, to turn a
 * 400 m entry leg into a 340 m one and make two ticked sights overlap when
 * they do not.
 */
export function pointAtDistance(
  line: Point[],
  cum: number[],
  meters: number
): { point: Point; index: number } {
  const total = cum[cum.length - 1];
  const target = Math.max(0, Math.min(total, meters));
  // Linear scan is fine: this runs at most a handful of times per POI, and a
  // binary search here would be a micro-optimisation over a 6,000-vertex array.
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;
  const span = cum[i] - cum[i - 1];
  const t = span > 0 ? (target - cum[i - 1]) / span : 0;
  const a = line[i - 1];
  const b = line[i];
  return {
    point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
    index: i,
  };
}

/**
 * Where a detour to a place `alongMeters` into the ride leaves the route and
 * where it rejoins.
 *
 * Both are pushed away from the nearest point rather than being it, and this
 * is the whole reason the spliced line does not look like a mistake. A detour
 * that left and rejoined at the same point would be an out-and-back spur
 * drawn on top of itself; one that left at the nearest point and rejoined
 * further on would still ride the first stretch twice. Leaving ~500 m early
 * and rejoining ~500 m late replaces a real stretch of the ride, so the
 * result reads as a line that goes past the sight.
 *
 * Near the ends of a one-way ride there may not be 500 m to give. The band is
 * then whatever is available down to `ENTRY_MIN_M`; below that the detour
 * starts at the route's own end, which is correct — a sight 200 m into the
 * ride is reached by leaving from the start.
 */
export function pickEntryExit(params: {
  line: Point[];
  cum: number[];
  alongMeters: number;
  backMeters?: number;
  forwardMeters?: number;
}): { entry: Point; exit: Point; entryMeters: number; exitMeters: number; entryIndex: number; exitIndex: number } {
  const { line, cum, alongMeters } = params;
  const total = cum[cum.length - 1];
  const back = params.backMeters ?? ENTRY_BACK_M;
  const forward = params.forwardMeters ?? EXIT_FORWARD_M;

  const entryMeters = Math.max(0, alongMeters - back);
  const exitMeters = Math.min(total, alongMeters + forward);
  const entry = pointAtDistance(line, cum, entryMeters);
  const exit = pointAtDistance(line, cum, exitMeters);
  return {
    entry: entry.point,
    exit: exit.point,
    entryMeters,
    exitMeters,
    entryIndex: entry.index,
    exitIndex: exit.index,
  };
}

/** The stretch of the route a detour replaces, as its own polyline. */
export function sliceBetween(
  line: Point[],
  cum: number[],
  fromMeters: number,
  toMeters: number
): Point[] {
  const a = pointAtDistance(line, cum, fromMeters);
  const b = pointAtDistance(line, cum, toMeters);
  const middle = line.slice(a.index, b.index);
  return [a.point, ...middle, b.point];
}

/** Length of a polyline in metres. */
export function lineMeters(line: Point[]): number {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += haversineMeters(line[i - 1], line[i]);
  return total;
}

/**
 * One routed detour, as the API returns it and the client splices it.
 *
 * `segments` is the SAME shape route segments have — a FeatureCollection of
 * LineStrings with `RouteSegmentProperties` — so the map colours a detour with
 * exactly the machinery it already colours the ride with, and a gravel spur to
 * a hillfort is brown the first time it is drawn.
 */
/**
 * Which shape the detour takes.
 *
 * `outAndBack` — ride to the sight and back the same way, rejoining where it
 * left. The default, and what a rider does for a viewpoint off the road.
 * `loop` — leave the route before the sight and rejoin after it, riding no
 * stretch twice. Used only when it is meaningfully cheaper (see
 * `LOOP_MUST_BEAT_OUT_AND_BACK_BY`).
 *
 * Shown to the rider in the row's detail, because the two are different rides
 * and which one a suggestion means is his to judge.
 */
export type DetourShape = "outAndBack" | "loop";

export type DetourResult =
  | {
      ok: true;
      poiId: string;
      shape: DetourShape;
      /** entry → sight → exit, as one line (out-and-back rejoins where it left) */
      coordinates: Point[];
      segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
      /** the detour's own length and riding time */
      distanceMeters: number;
      durationSeconds: number;
      /** what it costs over the stretch it replaces — the "+4,2 km · +9 min" */
      deltaMeters: number;
      deltaSeconds: number;
      /**
       * Where it leaves and rejoins the ride, in metres along the original.
       *
       * Equal for an out-and-back: nothing of the ride is replaced, the spur is
       * inserted at one point. `orderDetours` still uses them for ordering and
       * overlap, and two out-and-backs at the same point are the only case the
       * two numbers being equal has to be reasoned about — see there.
       */
      entryMeters: number;
      exitMeters: number;
    }
  | {
      ok: false;
      poiId: string;
      /** why the router could not get there; `unreachable` is BACKLOG item 20 */
      reason: "unreachable" | "timeout" | "error";
    };

/**
 * A POI the client asked for a detour to.
 *
 * `alongMeters` is NOT taken from the client: the server recomputes it from
 * the geometry it was given, because it is the number every subsequent
 * decision rests on. What the client sends is the identity and the place.
 */
export type DetourRequestPoi = { id: string; lat: number; lon: number };

/**
 * The ticked detours, in along-route order, with overlapping ones dropped.
 *
 * **Overlaps are refused, not merged.** Two sights whose replaced stretches
 * touch cannot both be spliced: the second one's entry point is inside the
 * first one's replaced stretch, so there is no ride left there to leave from —
 * the arithmetic would produce a line that jumps. Merging them would mean
 * routing a new leg sight-1 → sight-2, which is a request to the router and
 * therefore not instant, which is the one thing this feature promises. So the
 * earlier sight wins, the later one is reported back, and the card says so in
 * a line the rider can act on (untick one, or press Optimizēt maršrutu, which
 * plans them properly as vias).
 *
 * "Earlier wins" rather than "the one ticked first wins" because the result
 * must not depend on the order the boxes were pressed in: the same two ticks
 * must always give the same ride.
 */
export function orderDetours(detours: DetourResult[]): {
  applied: Extract<DetourResult, { ok: true }>[];
  refused: Extract<DetourResult, { ok: true }>[];
} {
  const usable = detours.filter((d): d is Extract<DetourResult, { ok: true }> => d.ok);
  const sorted = [...usable].sort((a, b) => a.entryMeters - b.entryMeters);
  const applied: Extract<DetourResult, { ok: true }>[] = [];
  const refused: Extract<DetourResult, { ok: true }>[] = [];
  let lastExit = -Infinity;
  for (const d of sorted) {
    // An out-and-back replaces nothing — it is a spur inserted at one point —
    // so it can never conflict with what came before, and two of them at the
    // same point are simply two spurs. Only a loop, which consumes a real
    // stretch of the ride, can leave a later detour with no route to leave
    // from. Without this distinction `entryMeters < lastExit` refused every
    // out-and-back that shared a point with the previous one.
    const consumesRoute = d.exitMeters > d.entryMeters;
    if (d.entryMeters < lastExit) {
      refused.push(d);
      continue;
    }
    applied.push(d);
    if (consumesRoute) lastExit = d.exitMeters;
  }
  return { applied, refused };
}

/**
 * The ride with its ticked detours spliced in.
 *
 * Runs in the browser on every tick, so it is written to be cheap: one pass
 * over the route's own segments, slicing rather than re-deriving. Measured in
 * single-digit milliseconds on a 200 km ride — which is the point of the whole
 * exercise, against a 23 s regeneration.
 *
 * The segment metadata of the replaced stretches goes with them and the
 * detour's own segments take their place, so the map's colours, the surface
 * percentages and the GPX description all describe the line that is actually
 * drawn.
 */
export type SplicedRoute = {
  coordinates: Point[];
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  /** what the detours added, for the "≈" line */
  addedMeters: number;
  addedSeconds: number;
  /** the detours actually applied, and the ones an overlap refused */
  applied: Extract<DetourResult, { ok: true }>[];
  refused: Extract<DetourResult, { ok: true }>[];
};

/**
 * Cut a segment FeatureCollection at a distance along the route, keeping the
 * part before `fromMeters` and the part after `toMeters`, and return both
 * halves' features with their geometry trimmed at the cut.
 *
 * Segment properties are preserved exactly: a segment cut in half is still the
 * same road, so both halves keep its surface, class and flags, and only
 * `distanceMeters` is recomputed. That is what lets the map draw a spliced
 * ride with no special case at all.
 */
function cutSegments(
  features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[],
  fromMeters: number,
  toMeters: number
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

    // This segment straddles a cut. Slice it on its own cumulative distances.
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

/**
 * Splice every ticked detour into a ride.
 *
 * The route's own segments are the source of truth for the geometry, not the
 * `geometry.coordinates` field: they are what the map draws, and rebuilding
 * the line from them guarantees the drawn line and the reported numbers
 * describe the same ride.
 */
export function spliceDetours(params: {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  detours: DetourResult[];
}): SplicedRoute {
  const { applied, refused } = orderDetours(params.detours);
  let features = params.segments.features as GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[];

  let addedMeters = 0;
  let addedSeconds = 0;
  // Applied back to front, so each splice's distances still refer to the
  // original route: splicing forwards would shift everything after the first
  // detour by its delta and every later entry point would land in the wrong
  // place.
  for (const detour of [...applied].reverse()) {
    const { before, after } = cutSegments(features, detour.entryMeters, detour.exitMeters);
    features = [...before, ...detour.segments.features, ...after];
    addedMeters += detour.deltaMeters;
    addedSeconds += detour.deltaSeconds;
  }

  const coordinates: Point[] = [];
  for (const f of features) {
    const own = f.geometry.coordinates as Point[];
    for (const c of own) {
      const last = coordinates[coordinates.length - 1];
      // Consecutive segments share their joining vertex; a duplicate would
      // show up in the GPX as a zero-length leg.
      if (last && last[0] === c[0] && last[1] === c[1]) continue;
      coordinates.push(c);
    }
  }

  return {
    coordinates,
    segments: { type: "FeatureCollection", features },
    distanceMeters: Math.round(params.distanceMeters + addedMeters),
    durationSeconds: Math.round(params.durationSeconds + addedSeconds),
    addedMeters,
    addedSeconds,
    applied,
    refused,
  };
}

/**
 * The surface mix of a spliced ride, recomputed from its segments.
 *
 * The headline "gravel %" has to move when a gravel spur is added, or the
 * number on screen stops describing the line beside it. Computed on the same
 * denominator `classify.ts` uses — the sum of the segments' own lengths — so a
 * ride with no detours reproduces the API's figure to within rounding.
 */
export function splicedSurfaces(
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>
): { asphaltPercent: number; gravelPercent: number; dirtPercent: number; unknownPercent: number } {
  let asphalt = 0, gravel = 0, dirt = 0, unknown = 0;
  for (const f of segments.features) {
    const meters = f.properties.distanceMeters;
    const s = f.properties.surface;
    if (s === "asphalt") asphalt += meters;
    else if (s === "gravel" || s === "compacted") gravel += meters;
    else if (s === "ground" || s === "dirt" || s === "sand") dirt += meters;
    else unknown += meters;
  }
  const total = asphalt + gravel + dirt + unknown || 1;
  return {
    asphaltPercent: Math.round((asphalt / total) * 100),
    gravelPercent: Math.round((gravel / total) * 100),
    dirtPercent: Math.round((dirt / total) * 100),
    unknownPercent: Math.round((unknown / total) * 100),
  };
}
