import { decodePolyline, encodePolyline } from "./polyline";
import { MotorcycleCostingOptions } from "./profiles";
import { haversineMeters } from "@/lib/geo/geometry";
import type { RouteEdge, RoutePath } from "@/lib/types";

/**
 * Valhalla routing client.
 *
 * Valhalla is used instead of GraphHopper because it has a real `motorcycle`
 * costing model with a `use_trails` knob (0-1, "the rider's desire for
 * adventure") — GraphHopper's hosted API only offers car/bike/foot, where
 * `car` never sees highway=track/path and `bike` routes onto cycleways that
 * motorcycles may not use.
 *
 * The base URL is configurable so a self-hosted Valhalla (Apache 2.0, same
 * API) is a config change rather than a rewrite — relevant because the Stadia
 * free tier forbids commercial use.
 */

const DEFAULT_BASE_URL = "https://api.stadiamaps.com";

/** Valhalla has no round-trip algorithm, but allows many locations per route. */
export const MAX_LOCATIONS = 50;

const ISOCHRONE_TIMEOUT_MS = 6_000;
const ROUTE_TIMEOUT_MS = 12_000;

export type LatLon = { lat: number; lon: number };

export type ValhallaLocationType = "break" | "through" | "via" | "break_through";

export type ValhallaLocation = LatLon & {
  type?: ValhallaLocationType;
  /** meters Valhalla may snap within — POI centers can sit just off-network */
  radius?: number;
};

function baseUrl(): string {
  return process.env.VALHALLA_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL;
}

/**
 * Stadia authenticates with an api_key; a self-hosted Valhalla needs none.
 * Only require a key when talking to the hosted service.
 */
function requireAuth(): { keyParam: string } {
  const key = process.env.STADIA_API_KEY;
  if (!key) {
    if (process.env.VALHALLA_BASE_URL) return { keyParam: "" };
    throw new Error(
      "STADIA_API_KEY is not set. Add it to .env.local (free key at client.stadiamaps.com), " +
        "or set VALHALLA_BASE_URL to a self-hosted Valhalla."
    );
  }
  return { keyParam: `?api_key=${encodeURIComponent(key)}` };
}

async function postJson<T>(
  path: string,
  body: unknown,
  timeoutMs: number
): Promise<T> {
  const { keyParam } = requireAuth();
  const res = await fetch(`${baseUrl()}${path}${keyParam}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
    // Next caches fetches by default, which silently returns stale routes for
    // repeated requests — and makes any measurement of route quality
    // meaningless. Routing results are also large and rarely re-requested
    // identically in practice.
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Valhalla ${path} failed (${res.status}): ${text.slice(0, 400)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------- route

type ValhallaTripResponse = {
  trip?: {
    summary?: { length?: number; time?: number };
    legs?: { shape?: string }[];
  };
};

/**
 * Route through `locations` in order.
 *
 * Intermediate points should be `type: "through"` — that forbids u-turns,
 * which is what stops a loop degenerating into "ride out to the tower, turn
 * around, come back the same road".
 */
export async function fetchRoute(params: {
  locations: ValhallaLocation[];
  costingOptions: MotorcycleCostingOptions;
}): Promise<{ distanceMeters: number; durationSeconds: number; coordinates: [number, number][] }> {
  if (params.locations.length < 2) {
    throw new Error("A route needs at least 2 locations");
  }
  if (params.locations.length > MAX_LOCATIONS) {
    throw new Error(`Valhalla accepts at most ${MAX_LOCATIONS} locations`);
  }

  const data = await postJson<ValhallaTripResponse>(
    "/route/v1",
    {
      locations: params.locations.map((l) => ({
        lat: l.lat,
        lon: l.lon,
        type: l.type ?? "break",
        ...(l.radius === undefined ? {} : { radius: l.radius }),
      })),
      costing: "motorcycle",
      costing_options: { motorcycle: params.costingOptions },
      directions_type: "none",
      units: "kilometers",
    },
    ROUTE_TIMEOUT_MS
  );

  const trip = data.trip;
  const legs = trip?.legs ?? [];
  if (!trip || legs.length === 0) throw new Error("Valhalla returned no route legs");

  // Each leg's shape repeats the previous leg's last point.
  const coordinates: [number, number][] = [];
  for (const leg of legs) {
    if (!leg.shape) continue;
    const decoded = decodePolyline(leg.shape);
    coordinates.push(...(coordinates.length === 0 ? decoded : decoded.slice(1)));
  }
  if (coordinates.length < 2) throw new Error("Valhalla returned an empty route shape");

  return {
    // summary.length is km (units: kilometers); summary.time is SECONDS
    // — GraphHopper returned milliseconds, hence the explicit note.
    distanceMeters: Math.round((trip.summary?.length ?? 0) * 1000),
    durationSeconds: Math.round(trip.summary?.time ?? 0),
    coordinates,
  };
}

// ------------------------------------------------------- trace attributes

type TraceAttributesResponse = {
  shape?: string;
  edges?: {
    surface?: string;
    road_class?: string;
    use?: string;
    unpaved?: boolean;
    length?: number;
    way_id?: number;
    begin_shape_index?: number;
    end_shape_index?: number;
  }[];
};

const TRACE_ATTRIBUTES = [
  "edge.surface",
  "edge.road_class",
  "edge.use",
  "edge.unpaved",
  "edge.length",
  "edge.way_id",
  "edge.begin_shape_index",
  "edge.end_shape_index",
  "shape",
];

/**
 * trace_attributes rejects paths over 200 km (error 154), and adventure loops
 * routinely exceed that, so long routes are traced in chunks. Kept under the
 * limit with margin because the snapped path can be slightly longer than the
 * shape we send.
 */
const TRACE_CHUNK_METERS = 180_000;

/**
 * Per-edge surface / road_class / use for a route shape.
 *
 * The /route response carries no edge attributes at all, so this second call
 * is what makes the Road/Track/Trail and surface breakdown possible.
 *
 * Two things that bite here:
 *  - the response returns its OWN shape, and begin/end_shape_index index into
 *    THAT shape, not the one we sent. So the caller must adopt the returned
 *    coordinates; mixing the two silently mis-colours segments.
 *  - `edge_walk` can hard-fail (error 443) even on Valhalla's own output, so
 *    we use `walk_or_snap`, which falls back to map snapping.
 */
async function traceChunk(
  coordinates: [number, number][],
  costingOptions: MotorcycleCostingOptions
): Promise<{ coordinates: [number, number][]; edges: RouteEdge[] }> {
  const data = await postJson<TraceAttributesResponse>(
    "/trace_attributes/v1",
    {
      encoded_polyline: encodePolyline(coordinates),
      shape_match: "walk_or_snap",
      costing: "motorcycle",
      costing_options: { motorcycle: costingOptions },
      filters: { action: "include", attributes: TRACE_ATTRIBUTES },
    },
    ROUTE_TIMEOUT_MS
  );

  if (!data.shape) throw new Error("trace_attributes returned no shape");

  const edges: RouteEdge[] = (data.edges ?? []).flatMap((e) =>
    e.begin_shape_index === undefined || e.end_shape_index === undefined
      ? []
      : [
          {
            beginShapeIndex: e.begin_shape_index,
            endShapeIndex: e.end_shape_index,
            surface: e.surface,
            use: e.use,
            roadClass: e.road_class,
            unpaved: e.unpaved,
            lengthKm: e.length,
            wayId: e.way_id,
          },
        ]
  );

  return { coordinates: decodePolyline(data.shape), edges };
}

/** Split a path into chunks each under `maxMeters` of length. */
function chunkByLength(
  coordinates: [number, number][],
  maxMeters: number
): [number, number][][] {
  const chunks: [number, number][][] = [];
  let current: [number, number][] = [coordinates[0]];
  let run = 0;

  for (let i = 1; i < coordinates.length; i++) {
    run += haversineMeters(coordinates[i - 1], coordinates[i]);
    current.push(coordinates[i]);
    if (run >= maxMeters && i < coordinates.length - 1) {
      chunks.push(current);
      // Overlap by one point so chunks stay contiguous.
      current = [coordinates[i]];
      run = 0;
    }
  }
  if (current.length > 1) chunks.push(current);
  return chunks;
}

/**
 * Per-edge surface / road_class / use for a route shape.
 *
 * The /route response carries no edge attributes at all, so this second call
 * is what makes the Road/Track/Trail and surface breakdown possible.
 *
 * Two things that bite here:
 *  - the response returns its OWN shape, and begin/end_shape_index index into
 *    THAT shape, not the one we sent. So the caller must adopt the returned
 *    coordinates; mixing the two silently mis-colours segments.
 *  - `edge_walk` can hard-fail (error 443) even on Valhalla's own output, so
 *    we use `walk_or_snap`, which falls back to map snapping.
 */
export async function fetchTraceAttributes(params: {
  coordinates: [number, number][];
  costingOptions: MotorcycleCostingOptions;
}): Promise<{ coordinates: [number, number][]; edges: RouteEdge[] }> {
  const chunks = chunkByLength(params.coordinates, TRACE_CHUNK_METERS);

  const traced = [];
  for (const chunk of chunks) {
    traced.push(await traceChunk(chunk, params.costingOptions));
  }

  // Stitch: each chunk's shape indices are local, so offset them by the
  // running coordinate count of the assembled geometry.
  const coordinates: [number, number][] = [];
  const edges: RouteEdge[] = [];
  for (const part of traced) {
    const offset = coordinates.length;
    coordinates.push(...part.coordinates);
    for (const e of part.edges) {
      edges.push({
        ...e,
        beginShapeIndex: e.beginShapeIndex + offset,
        endShapeIndex: e.endShapeIndex + offset,
      });
    }
  }

  return { coordinates, edges };
}

/**
 * Route plus per-edge attributes.
 *
 * Route delivery must never depend on the classification call: if
 * trace_attributes fails we return the plain route with no edges, and the
 * classifier degrades to "unknown surface" rather than losing the route.
 */
export async function fetchRoutePath(params: {
  locations: ValhallaLocation[];
  costingOptions: MotorcycleCostingOptions;
}): Promise<RoutePath> {
  const route = await fetchRoute(params);

  try {
    const traced = await fetchTraceAttributes({
      coordinates: route.coordinates,
      costingOptions: params.costingOptions,
    });
    return {
      distanceMeters: route.distanceMeters,
      durationSeconds: route.durationSeconds,
      coordinates: traced.coordinates,
      edges: traced.edges,
    };
  } catch (err) {
    console.warn("trace_attributes failed; returning route without edge detail:", err);
    return { ...route, edges: [] };
  }
}

// ------------------------------------------------------------- isochrone

export type IsochroneFeatureProperties = { contour: number; metric: string };

/**
 * Reachability contours under motorcycle costing.
 *
 * Contours are requested in one call: the number of contours does not change
 * the request cost, so having inner/outer rings on hand makes later distance
 * correction free.
 *
 * Note for callers: features come back sorted largest-value-first, and one
 * interval can emit several features — match on `properties.contour`, never
 * on array position.
 */
export async function fetchIsochrone(params: {
  center: LatLon;
  contoursMinutes: number[];
  costingOptions: MotorcycleCostingOptions;
}): Promise<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, IsochroneFeatureProperties>> {
  return postJson(
    "/isochrone/v1",
    {
      locations: [{ lat: params.center.lat, lon: params.center.lon }],
      costing: "motorcycle",
      costing_options: { motorcycle: params.costingOptions },
      contours: params.contoursMinutes.map((time) => ({ time })),
      polygons: true,
      // trims disconnected specks across rivers that would offer unreachable anchors
      denoise: 0.6,
      generalize: 200,
    },
    ISOCHRONE_TIMEOUT_MS
  );
}
