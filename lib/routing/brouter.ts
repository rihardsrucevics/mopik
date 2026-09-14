import { buildMotoProfile, type MotoProfileOptions } from "./moto-profile";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { joinPaths } from "./join-paths";
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

/**
 * An empty `BROUTER_BASE_URL` is how you ask for the public instance —
 * `BROUTER_BASE_URL= next dev`, or a blank value in an environment that has no
 * way to unset one. `?? ` only catches undefined, so an empty string used to
 * survive and every URL came out relative ("/brouter/profile"), failing with
 * `ERR_INVALID_URL` on the server where there is no origin to resolve against.
 */
function baseUrl(): string {
  const configured = process.env.BROUTER_BASE_URL?.trim();
  return configured ? configured.replace(/\/$/, "") : DEFAULT_BASE_URL;
}

/** Whether Mopik has a BRouter of its own, rather than the throttled public one. */
function isSelfHosted(): boolean {
  return Boolean(process.env.BROUTER_BASE_URL?.trim());
}

/**
 * Our own instance is behind a shared secret — an open BRouter is a free
 * routing service for whoever finds the IP. Absent for brouter.de and for the
 * local dev server, which are reached without one.
 */
function authHeaders(): Record<string, string> {
  const token = process.env.BROUTER_TOKEN;
  return token ? { "X-Mopik-Token": token } : {};
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
    headers: { "Content-Type": "text/plain", ...authHeaders() },
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
  if (isSelfHosted()) return fn();
  const run = queue.then(async () => {
    if (!isSelfHosted()) {
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
    const res = await paced(() => fetch(url, { headers: authHeaders(), signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) }));
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

  // A leg already known to be beyond the public instance is split up front,
  // rather than every candidate paying for the same refusal (see
  // `publicRefusedBeyondKm`).
  if (!isSelfHosted() && longestLegKm(params.points) >= publicRefusedBeyondKm) {
    const pieced = await routeInSegments(params.points, profileId);
    if (pieced) return pieced;
  }

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

      // A start or destination can geocode onto a way this profile forbids —
      // Ērgļi's Photon coordinate sits on a `highway=footway`, which costs
      // 100000 here. BRouter snaps the endpoint to it anyway and then fails
      // the whole request with "error re-tracking track". The point is not
      // unreachable, it is only *this* profile's nearest way that is, so the
      // fix is to look for routable ground a short walk away rather than to
      // lose the ride. Only about one bearing in eight routes (see
      // NUDGE_RADII_M), so a single blind offset is a coin flip — the ring is
      // searched, nearest first.
      if (/re-tracking track/.test(message)) {
        const nudged = await routeWithNudgedEndpoints(points, profileId);
        if (nudged) return nudged;
        // The same error also means "this leg is too long for the public
        // instance" — see `routeInSegments`. Nudging cannot help there, so
        // the leg is ridden in pieces instead.
        // Remember how long a leg this instance refuses, so the rest of this
        // generation splits without asking first.
        publicRefusedBeyondKm = Math.min(publicRefusedBeyondKm, longestLegKm(points));
        const pieced = await routeInSegments(points, profileId);
        if (pieced) return pieced;
        throw err;
      }

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

/**
 * Distances a mis-snapped endpoint is looked for at, and the bearings tried
 * at each.
 *
 * Measured at Ērgļi (the case that found this bug), routing from Jūdaži:
 * nothing routes at 200 or 300 m, one bearing of eight at 400–700 m, two at
 * 900 m. So a close nudge is not merely unlucky — the forbidden footway
 * network around such a point extends a few hundred metres, and the search
 * has to clear it. 1200 m is the stop: beyond that the ride no longer starts
 * or ends at the place the rider named, and reporting the failure honestly
 * beats silently moving their destination.
 */
const NUDGE_RADII_M = [400, 700, 1200];
const NUDGE_BEARINGS_DEG = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A bad endpoint is bad for every candidate in the same generation — all ~36
 * of them start or end there — so the replacement found for it is remembered
 * per profile and reused. Without this the search runs once per candidate,
 * which on the throttled public instance costs more wall-clock than the whole
 * generation has. Keyed by profile because "routable" is a property of the
 * profile, not of the ground.
 */
const nudgeCache = new Map<string, Point>();
const nudgeKey = (profileId: string, [lon, lat]: Point) => `${profileId}|${lon},${lat}`;

function offsetPoint([lon, lat]: Point, bearingDeg: number, meters: number): Point {
  const rad = (bearingDeg * Math.PI) / 180;
  const dLat = (meters * Math.cos(rad)) / 111320;
  const dLon = (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return [Number((lon + dLon).toFixed(7)), Number((lat + dLat).toFixed(7))];
}

/**
 * Retry the route with the start or the end moved to nearby routable ground.
 * Only the endpoints are moved: an intermediate point that cannot be snapped
 * is already handled by the island-drop above, and the rider's two named
 * places are the ones worth saving.
 *
 * Returns null when nothing within `NUDGE_RADII_M` routes, so the caller can
 * report the original failure rather than a route to somewhere else.
 */
async function routeWithNudgedEndpoints(
  points: Point[],
  profileId: string
): Promise<RoutePath | null> {
  const last = points.length - 1;
  const request = async (candidate: Point[]) => {
    const lonlats = candidate.map(([lon, lat]) => `${lon},${lat}`).join("|");
    try {
      return await requestPath(
        `${baseUrl()}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
          `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`
      );
    } catch {
      return null;
    }
  };

  // A replacement already found for either endpoint is used straight away:
  // the first candidate of a generation pays for the search, the rest do not.
  const cachedStart = nudgeCache.get(nudgeKey(profileId, points[0]));
  const cachedEnd = nudgeCache.get(nudgeKey(profileId, points[last]));
  if (cachedStart || cachedEnd) {
    const settled = await request([
      cachedStart ?? points[0],
      ...points.slice(1, last),
      cachedEnd ?? points[last],
    ]);
    if (settled) {
      const moved = Math.max(
        cachedStart ? haversineMeters(points[0], cachedStart) : 0,
        cachedEnd ? haversineMeters(points[last], cachedEnd) : 0
      );
      return { ...settled, endpointMovedMeters: Math.round(moved) };
    }
  }

  // Which end is at fault is not in BRouter's message. The destination is
  // tried first and exhausted before the start is touched: a destination is
  // the far more common mis-snap (a start usually came from the rider's own
  // position or a previous ride), and interleaving the two doubles the cost
  // of the common case. Only one bearing in eight tends to work, so the
  // ordering is what keeps this affordable on the throttled public instance.
  for (const [index, label] of [[last, "end"], [0, "start"]] as const) {
    for (const meters of NUDGE_RADII_M) {
      for (const bearing of NUDGE_BEARINGS_DEG) {
        const moved = offsetPoint(points[index], bearing, meters);
        const candidate = [...points];
        candidate[index] = moved;
        const path = await request(candidate);
        if (path) {
          console.warn(
            `brouter: ${label} ${points[index].join(",")} is not routable on this profile; ` +
              `used a point ${meters} m away at ${bearing}°`
          );
          nudgeCache.set(nudgeKey(profileId, points[index]), moved);
          return { ...path, endpointMovedMeters: meters };
        }
      }
    }
  }
  return null;
}

/**
 * Longest leg the public instance will actually route. Measured 2026-09-14:
 * Como → Budapest (~800 km) and Berlin → Warszawa (~570 km, flat, no Alps)
 * both answer 400 `error re-tracking track`, while the same lengths route in
 * 4.4 s on our own instance — so it is the public server giving up on a long
 * search, not a limit of BRouter. 300 km is comfortably under the shortest
 * failure seen and leaves room for a leg that wanders.
 */
const PUBLIC_MAX_LEG_KM = 300;

/**
 * Whether the public instance has already refused a leg this long.
 *
 * Being too long is a property of the *request*, not of one candidate: all ~36
 * candidates of a generation span the same two places, so without this each
 * one rediscovers the refusal and pays for its own split. Measured: Como →
 * Budapest spent the whole 40 s budget that way and still returned nothing.
 * The first candidate to hit the wall records the crow-flight distance, and
 * the rest split immediately instead of asking again.
 */
let publicRefusedBeyondKm = Infinity;

/** Straight-line length of the longest leg in a waypoint list. */
function longestLegKm(points: Point[]): number {
  let longest = 0;
  for (let i = 0; i < points.length - 1; i++) {
    longest = Math.max(longest, haversineMeters(points[i], points[i + 1]) / 1000);
  }
  return longest;
}

/**
 * Ride a leg the public instance refuses in pieces, and stitch them together.
 *
 * This is the free fallback for when Mopik has no BRouter of its own: a long
 * European route still comes back, built from sections the public server will
 * answer. It is a worse route than one search over the whole leg would give —
 * the split points are arbitrary, so the router optimises each piece rather
 * than the ride — which is why it runs only after a self-hosted instance has
 * had its chance, never in front of one.
 *
 * Returns null when even the pieces fail, so the caller reports the original
 * error rather than half a ride.
 */
async function routeInSegments(points: Point[], profileId: string): Promise<RoutePath | null> {
  // A self-hosted instance has no such limit; if it refused this leg, the
  // reason is something else and splitting would only hide it.
  if (isSelfHosted()) return null;

  const fetchLeg = async (from: Point, to: Point): Promise<RoutePath | null> => {
    const lonlats = `${from[0]},${from[1]}|${to[0]},${to[1]}`;
    try {
      return await requestPath(
        `${baseUrl()}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
          `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`
      );
    } catch {
      return null;
    }
  };

  const parts: RoutePath[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i];
    const to = points[i + 1];
    const km = haversineMeters(from, to) / 1000;
    // Straight-line distance understates the ride, so the piece count is
    // deliberately generous: a 300 km crow-flight leg is often 400 km ridden.
    const pieces = Math.max(1, Math.ceil(km / PUBLIC_MAX_LEG_KM));
    let legFrom = from;

    for (let p = 1; p <= pieces; p++) {
      // Interpolating along the straight line puts each split point on
      // whatever ground happens to be there, which may itself be unroutable —
      // so each one gets the same nudge search the endpoints get.
      const t = p / pieces;
      const legTo: Point = p === pieces
        ? to
        : [
            Number((from[0] + (to[0] - from[0]) * t).toFixed(7)),
            Number((from[1] + (to[1] - from[1]) * t).toFixed(7)),
          ];
      const part = (await fetchLeg(legFrom, legTo)) ?? (await routeWithNudgedEndpoints([legFrom, legTo], profileId));
      if (!part) return null;
      parts.push(part);
      // Continue from where the piece actually ended, not from the point we
      // asked for: a nudged split point would otherwise leave a gap.
      legFrom = part.coordinates[part.coordinates.length - 1];
    }
  }

  if (!parts.length) return null;
  console.warn(
    `brouter: leg too long for the public instance; rode it in ${parts.length} pieces`
  );
  // The flag travels with the path so the UI can say the ride was assembled
  // rather than searched, and is honest about the quality that costs.
  return { ...joinPaths(parts), assembledFromSegments: true };
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
