import { buildMotoProfile, type MotoProfileOptions } from "./moto-profile";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RoutePath, RouteEdge } from "@/lib/types";

/**
 * BRouter client.
 *
 * Chosen over hosted Valhalla because the routing profile is ours to write:
 * costs per road class and surface are set in a script we generate, rather
 * than being reachable only through one overloaded `use_trails` dial. On
 * 25-30 km Baltic legs that difference is large — a custom profile returns
 * 57-92% unpaved where Valhalla's motorcycle costing returned 1-50%.
 *
 * Two further practical advantages: responses carry the raw OSM tags per
 * segment (so surface reporting is exact rather than a normalised enum), and
 * there are no request credits or commercial-use restrictions.
 */

const DEFAULT_BASE_URL = "https://brouter.de";
const ROUTE_TIMEOUT_MS = 20_000;

/** BRouter accepts long waypoint lists; this is a sanity bound, not a limit. */
export const MAX_LOCATIONS = 30;

function baseUrl(): string {
  return process.env.BROUTER_BASE_URL?.replace(/\/$/, "") ?? DEFAULT_BASE_URL;
}

/**
 * Uploaded profiles are cached server-side by content, so the same options
 * reuse the same id instead of re-uploading on every request.
 */
const profileIdCache = new Map<string, string>();

export async function uploadProfile(options: MotoProfileOptions): Promise<string> {
  const script = buildMotoProfile(options);
  const cached = profileIdCache.get(script);
  if (cached) return cached;

  const res = await fetch(`${baseUrl()}/brouter/profile`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: script,
    signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS),
  });

  if (!res.ok) {
    // A 500 here almost always means the script referenced a tag value that
    // isn't in BRouter's lookups.dat; the response carries no detail.
    throw new Error(
      `BRouter rejected the routing profile (${res.status}). ` +
        "Check that every tag value used exists in BRouter's lookup table."
    );
  }

  const { profileid } = (await res.json()) as { profileid: string };
  profileIdCache.set(script, profileid);
  return profileid;
}

/**
 * The public brouter.de instance throttles bursts, answering 403 "Please,
 * retry later!" after roughly half a dozen quick requests. Routes are
 * therefore retried with a short backoff, and callers should keep concurrency
 * low. Pointing BROUTER_BASE_URL at a self-hosted instance removes the limit
 * entirely — BRouter is a small Java server with regional data files.
 */
const RETRY_DELAYS_MS = [1500, 3000, 6000, 10000];

/**
 * Minimum gap between requests to the public instance. It counts bursts, so
 * spacing requests out costs little wall-clock and avoids the 403 entirely
 * in normal use; a self-hosted `BROUTER_BASE_URL` needs no gap.
 */
const MIN_GAP_MS = 350;
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Serialises requests with a small gap; the queue never rejects. */
function paced<T>(fn: () => Promise<T>): Promise<T> {
  // The public throttle must not serialise the self-hosted server.
  if (process.env.BROUTER_BASE_URL) return fn();
  const run = queue.then(async () => {
    if (!process.env.BROUTER_BASE_URL) {
      const wait = lastRequestAt + MIN_GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastRequestAt = Date.now();
    }
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt - 1]));
    }
    const res = await paced(() => fetch(url, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }));
    if (res.ok) return res;

    lastStatus = res.status;
    lastBody = await res.text();
    // Only throttling is worth retrying; a bad profile or unroutable points
    // will fail the same way however often we ask. The public instance also
    // answers 400 "killed by thread-priority-watchdog" under load, which is
    // load, not our request.
    const watchdog = res.status === 400 && /watchdog/.test(lastBody);
    if (res.status !== 403 && res.status !== 429 && res.status < 500 && !watchdog) break;
  }

  throw new Error(
    `BRouter routing failed (${lastStatus})${lastBody ? `: ${lastBody.slice(0, 160)}` : ""}`
  );
}

type BrouterFeature = {
  geometry: { type: "LineString"; coordinates: [number, number, number?][] };
  properties: {
    "track-length": string | number;
    "total-time": string | number;
    messages?: string[][];
  };
};

const PAVED = new Set([
  "asphalt",
  "paved",
  "concrete",
  "concrete:plates",
  "paving_stones",
  "sett",
  "cobblestone",
  "chipseal",
  "metal",
  "wood",
]);

/**
 * BRouter reports one message row per way segment with the raw OSM tags, so
 * segment attributes are derived rather than mapped from an enum.
 */
function edgesFromMessages(
  messages: string[][] | undefined,
  coordinates: Point[]
): RouteEdge[] {
  if (!messages || messages.length < 2) return [];

  const header = messages[0];
  const iLon = header.indexOf("Longitude");
  const iLat = header.indexOf("Latitude");
  const iTags = header.indexOf("WayTags");
  if (iLon < 0 || iLat < 0 || iTags < 0) return [];

  // Message rows are positioned by coordinate, so walk the shape alongside
  // them to recover each segment's index range.
  const edges: RouteEdge[] = [];
  let shapeIndex = 0;

  for (const row of messages.slice(1)) {
    const lon = Number(row[iLon]) / 1e6;
    const lat = Number(row[iLat]) / 1e6;

    // Advance to the coordinate this message refers to.
    let end = shapeIndex;
    let bestDist = Infinity;
    for (let i = shapeIndex; i < coordinates.length; i++) {
      const d = haversineMeters(coordinates[i], [lon, lat]);
      if (d < bestDist) {
        bestDist = d;
        end = i;
      }
      if (d < 5) break;
    }
    if (end <= shapeIndex) end = Math.min(shapeIndex + 1, coordinates.length - 1);

    const tags: Record<string, string> = {};
    for (const pair of String(row[iTags] ?? "").split(/\s+/)) {
      const eq = pair.indexOf("=");
      if (eq > 0) tags[pair.slice(0, eq)] = pair.slice(eq + 1);
    }

    let meters = 0;
    for (let i = shapeIndex + 1; i <= end; i++) {
      meters += haversineMeters(coordinates[i - 1], coordinates[i]);
    }

    edges.push({
      beginShapeIndex: shapeIndex,
      endShapeIndex: end,
      // Raw OSM values, translated to the enum names the classifier expects.
      use: tags.highway,
      surface: tags.surface,
      roadClass: tags.highway,
      unpaved: tags.surface ? !PAVED.has(tags.surface) : undefined,
      lengthKm: meters / 1000,
      // OSM way ids aren't in the message rows, so overlap is keyed on the
      // way's tag signature plus position instead.
      wayId: undefined,
      tags,
    });

    shapeIndex = end;
  }

  return edges;
}

/**
 * Route through `points` in order ([lon, lat]).
 *
 * BRouter has no round-trip algorithm either, so loops are still built from
 * via points by the caller.
 */
export async function fetchRoutePath(params: {
  points: Point[];
  profileOptions: MotoProfileOptions;
}): Promise<RoutePath> {
  if (params.points.length < 2) throw new Error("A route needs at least 2 points");
  if (params.points.length > MAX_LOCATIONS) {
    throw new Error(`Too many waypoints (${params.points.length})`);
  }

  const profileId = await uploadProfile(params.profileOptions);

  // A via point can land on a disconnected fragment of the network — a track
  // with no routable link to anything, which BRouter reports as "target
  // island detected for section N". Losing a whole candidate to one bad
  // anchor is wasteful when the rest of the loop is fine, so unreachable
  // intermediate points are dropped and the route retried. Start and end are
  // never dropped: they are what the rider asked for.
  let points = params.points;
  const maxDrops = Math.max(0, points.length - 3);

  for (let drop = 0; ; drop++) {
    const lonlats = points.map(([lon, lat]) => `${lon},${lat}`).join("|");
    const url =
      `${baseUrl()}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
      `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;

    try {
      return await requestPath(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const island = /island detected for section (\d+)/.exec(message);
      if (!island || drop >= maxDrops) throw err;

      // Sections are 0-based: section N runs from point N to point N+1, and
      // the unreachable end is point N+1. (Reading them as 1-based meant
      // "section 0" never matched an intermediate point and the candidate
      // failed anyway.)
      const index = Number(island[1]) + 1;
      if (index <= 0 || index >= points.length - 1) throw err;
      points = [...points.slice(0, index), ...points.slice(index + 1)];
    }
  }
}

async function requestPath(url: string): Promise<RoutePath> {
  const res = await fetchWithRetry(url);
  const data = (await res.json()) as { features?: BrouterFeature[] };
  const feature = data.features?.[0];
  if (!feature) throw new Error("BRouter returned no route");

  const rawCoordinates = feature.geometry.coordinates;
  const coordinates: Point[] = rawCoordinates.map(([lon, lat]) => [lon, lat]);
  const elevations = rawCoordinates.map((coordinate) =>
    typeof coordinate[2] === "number" && Number.isFinite(coordinate[2]) ? coordinate[2] : null
  );
  if (coordinates.length < 2) throw new Error("BRouter returned an empty shape");

  return {
    distanceMeters: Math.round(Number(feature.properties["track-length"])),
    durationSeconds: Math.round(Number(feature.properties["total-time"])),
    coordinates,
    ...(elevations.some((elevation) => elevation !== null) ? { elevations } : {}),
    edges: edgesFromMessages(feature.properties.messages, coordinates),
  };
}
