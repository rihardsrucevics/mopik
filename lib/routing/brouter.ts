import { buildMotoProfile, type MotoProfileOptions } from "./moto-profile";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { joinPaths } from "./join-paths";
import { recallLeg } from "./fetch-route-probe";
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
export function edgesFromMessages(
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
  /**
   * Which intermediate points this caller invented, by index into `points`.
   *
   * Item 11g. A refused leg is rescued differently depending on whose point
   * is at fault. The rider's own places — a start, a destination, a stop
   * typed into the form or added from a suggestion — are *what the ride is*,
   * so they get the full endpoint-nudge ring: 3 radii x 8 bearings, up to 24
   * requests, because moving them is the only alternative to telling the
   * rider their ride is impossible. A via this code generated (a seaward
   * anchor, a perpendicular corridor offset) is a *guess at a nice shape*,
   * and spending 24 requests defending a guess is what cost Liepāja →
   * Ventspils 209 s of a 50 s budget across six candidates.
   *
   * So generated vias listed here get `GENERATED_VIA_BUDGET_MS` of cheap
   * alternatives instead, and are dropped rather than defended. Omitted or
   * empty means every point is the rider's, which is the old behaviour.
   */
  generatedViaIndices?: number[];
}): Promise<RoutePath> {
  if (params.points.length < 2) throw new Error("A route needs at least 2 points");
  if (params.points.length > MAX_LOCATIONS) {
    throw new Error(`Too many waypoints (${params.points.length})`);
  }

  const profileId = await uploadProfile(params.profileOptions);

  // The feasibility probe may already have routed exactly this leg on exactly
  // this profile, and on a long ride that leg is the most expensive search of
  // the whole generation. Paying for it twice would eat the budget the probe
  // exists to protect.
  const probed = recallLeg(profileId, params.points);
  if (probed) return probed;

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
  /**
   * How many intermediate points may be dropped before the leg is a straight
   * A-to-B and there is nothing left to drop.
   *
   * `length - 2` rather than `length - 3`: a 3-point list is start, one via,
   * end, and dropping that via leaves a perfectly good two-point route. The
   * old figure was zero there, so a via on a routing island was never dropped
   * on the commonest shape of all — one stop between two places — and the
   * candidate failed instead. (Item 11g; found by the test below, not in the
   * wild, because the shapes that hit it most were A-to-B candidates whose
   * refusal looked like the 209 s problem rather than this one.)
   */
  const maxDrops = Math.max(0, points.length - 2);

  // Item 11g. Which of these points this code invented rather than the rider.
  // Tracked as a Set of the point *values* rather than of indices, because
  // the island-drop above rewrites `points` and every index after a dropped
  // one shifts; the coordinates themselves do not move.
  const generated = new Set(
    (params.generatedViaIndices ?? [])
      .filter((i) => i > 0 && i < params.points.length - 1)
      .map((i) => pointKey(params.points[i]))
  );

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
        // Item 11g. Before the expensive ring, try the cheap thing: if one of
        // OUR OWN generated vias is what the router cannot reach, give it two
        // bounded attempts and then let it go. The ring below exists for the
        // rider's named places and costs up to 24 requests; spending that on a
        // guessed corridor anchor is what burned 209 s on Liepāja → Ventspils.
        // `MOPIK_NO_VIA_RESCUE=1` restores the pre-item-11g behaviour — every
        // point defended by the endpoint-nudge ring — so the measurement
        // harness can produce a BEFORE column from the same checkout as the
        // AFTER one. Nothing in the app reads it.
        if (generated.size && process.env.MOPIK_NO_VIA_RESCUE !== "1") {
          const rescued = await rescueGeneratedVias(points, generated, profileId);
          if (rescued) return rescued;
        }
        const nudged = await routeWithNudgedEndpoints(points, profileId, generated);
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
      if (!island) throw err;

      // Sections are 0-based: section N runs from point N to point N+1, and
      // the unreachable end is point N+1. (Reading them as 1-based meant
      // "section 0" never matched an intermediate point and the candidate
      // failed anyway.)
      const index = Number(island[1]) + 1;
      if (index <= 0 || index >= points.length - 1) throw err;

      // Backlog item 20. An island is where a *named* via and a generated one
      // part company. Satezeles pilskalns (24.8707, 57.17161) snaps onto a
      // fragment with no routable link on this profile, and BRouter answers
      // "target island detected" rather than "re-tracking track" — so the
      // rescue above never saw it and this line quietly deleted the rider's
      // stop. Dropping a stop the rider pressed "Pievienot" on is worse than
      // failing: the ride comes back not going where they asked, and nothing
      // says so. A named island via gets the same bounded ring a mis-snapped
      // destination gets; only if that finds nothing does the request fail,
      // honestly. Generated vias are still dropped on sight — that is the
      // cheap behaviour item 11g wants and this loop has always given them.
      if (!generated.has(pointKey(points[index])) && process.env.MOPIK_NO_VIA_RESCUE !== "1") {
        // Note this is checked BEFORE `maxDrops`: that counter bounds how many
        // points may be *deleted*, and a 3-point round trip (start, stop,
        // start) allows zero — which is exactly the item 20 shape, so the old
        // `drop >= maxDrops` guard threw before a named via could be rescued.
        const nudged = await routeWithNudgedEndpoints(points, profileId, generated);
        if (nudged) return nudged;
        throw err;
      }
      if (drop >= maxDrops) throw err;
      points = [...points.slice(0, index), ...points.slice(index + 1)];
    }
  }
}

/**
 * How long the whole rescue of a generated via may take, per failing leg.
 *
 * Measured, item 11g: one request to `brouter.mopik.eu` for a refused pair
 * answers in 60-370 ms, and one that routes in 43-200 ms. Two alternatives
 * plus their verification is therefore comfortably inside two seconds on our
 * own instance, and the budget is what stops the public one — where a refusal
 * costs a 1.5 s backoff — from turning the same two attempts into a minute.
 *
 * The budget is deliberately checked *between* attempts rather than enforced
 * with an AbortController: an attempt already in flight is nearly free to
 * finish and its answer may be the rescue, while starting a third one is not.
 */
export const GENERATED_VIA_BUDGET_MS = 2_000;

/**
 * How far a generated via is moved along the corridor before being given up.
 *
 * Item 11g's refusals are not local: the via at 21.421589,56.921915 is refused
 * from A and from every point within 600 m of it in all eight bearings, while
 * a point 10 km back along the same corridor routes fine. So a small nudge is
 * measurably useless here — the useful move is a corridor-scale one, which is
 * why this is 300-600 m *along the line*, not a ring around the point.
 */
const GENERATED_VIA_SHIFT_M = [300, 600];

/**
 * Time held back from the shift attempts so the drop always gets its turn.
 *
 * One request against our own instance answers in 60-370 ms refused and
 * 43-200 ms routed, so 700 ms buys the drop its single request with room for
 * a slow one. Without this reserve a candidate carrying two generated vias
 * spent the whole budget failing to shift them and then paid the 24-request
 * ring anyway — which is the cost item 11g exists to remove.
 */
const DROP_RESERVE_MS = 700;

/** Identity of a point, for the generated-via set. */
const pointKey = ([lon, lat]: Point) => `${lon},${lat}`;

/**
 * Rescue a leg that BRouter refused because one of OUR generated vias cannot
 * be reached from the point before it — cheaply, and with a hard time bound.
 *
 * ## What is actually wrong, measured (item 11g)
 *
 * Item 11e read this signature as a refused *approach direction* — "the way it
 * snaps onto cannot be entered from A's side (one-way? a `motor_forbidden`
 * class on the last metres?)". Measured, it is none of those:
 *
 * ```
 * A → via        REFUSED  error re-tracking track   (370 ms)
 * via → B        OK 79.4 km                         (187 ms)
 * A → B          OK 140.5 km                        (195 ms)
 * via → probe 200 m at 0/90/180/270°   all OK, snap 13 m every time
 * probe → via    at 0/90/180/270°      all OK
 * ```
 *
 * The via snaps 13 m onto a `highway=track tracktype=grade4` (an abandoned
 * railway, `Vecais dzelzceļš`) and is routable **in and out, in every
 * direction**. There is no one-way and no forbidden class on the last metres.
 * Nor is it an island: `via → ring point` routes at 1, 3, 5, 8, 11, 15 and
 * 20 km on all four bearings.
 *
 * What it really is: **BRouter's own search is asymmetric, and it is the
 * distance that breaks it, not the direction.** The same pair, reversed,
 * routes:
 *
 * ```
 * A  → P7   REFUSED        P7 → A   OK
 * B  → P7   REFUSED        P7 → B   OK
 * A  → P6   OK 66.5 km     (P6 and P7 are 400 m apart on one secondary road)
 * A  → P6 → P7  OK         (the identical journey, with one point inserted)
 * ```
 *
 * `A → via` fails at 53 km and succeeds at 11 km; every point within 600 m of
 * the via fails from A, and a point 10 km back along the corridor routes. It
 * is deterministic (five for five), unaffected by `alternativeidx`, `timeout`
 * and `maxRunningTime`, and **it does not happen on BRouter's stock profiles**
 * — `trekking`, `car-fast` and `shortest` all route `A → via` — nor is it any
 * single option of ours (bisected across offRoad, difficulty, trails,
 * avoidMainRoads, avoidMotorways, noSand, avoidTowns, preferForest: all
 * refuse). It is the interaction of our cost magnitudes with BRouter's
 * bidirectional search over a long, expensive leg: `A → P6` rides 66.5 km for
 * a 42.5 km crow flight, and when the forward and backward searches meet, the
 * re-tracking step cannot rebuild the track and answers 400.
 *
 * The fast failure is the tell. These refusals come back in 60-370 ms — this
 * is not a search that ran out of anything, it is one that tried and gave up
 * at once. The 209 s was never BRouter's: it was `fetchRoutePath` answering a
 * 250 ms refusal with a 24-request nudge ring and then a segmented retry.
 *
 * ## So the rescue is a shift, not a ring
 *
 * Two attempts, in this order, and then the via goes:
 *
 * 1. **Move it 300 m, then 600 m, along the corridor** (towards the point
 *    before it — the direction the refused approach came from). This is the
 *    move with a reason behind it: the failure varies with position along the
 *    line and not with bearing around the point, so a ring is the wrong shape
 *    of search. Each shifted point is checked for a decent snap before it
 *    costs a full leg, so a shift into a lake is not paid for twice.
 * 2. **Drop the via and route the rest.** A corridor candidate with only its
 *    exit via is still a coastal candidate, and a ride the rider can see beats
 *    a slot spent proving that a guess was unroutable.
 *
 * Returns null when the budget runs out or nothing works, so the caller falls
 * through to the nudge ring — which is right when the *rider's* endpoint is
 * the unroutable one and our generated via was an innocent bystander.
 */
async function rescueGeneratedVias(
  points: Point[],
  generated: Set<string>,
  profileId: string
): Promise<RoutePath | null> {
  const startedAt = Date.now();
  const spent = () => Date.now() - startedAt;
  const request = async (candidate: Point[]): Promise<RoutePath | null> => {
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

  const indices = points
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => index > 0 && index < points.length - 1 && generated.has(pointKey(point)))
    .map(({ index }) => index);
  if (!indices.length) return null;

  // 1. Shift each generated via back along the corridor. The direction is
  // towards the previous point because that is the approach the router
  // refused; a via pulled back towards where the ride is coming from is also
  // the one that keeps the candidate's shape.
  //
  // The budget is reserved for the drop below rather than spent to the last
  // millisecond here. Measured on Liepāja → Ventspils' corridor candidates,
  // which carry TWO generated vias: four refusals at ~600 ms each used the
  // whole 2 s and the drop — the step that actually rescues them — never ran,
  // so the candidate fell through to the nudge ring and cost 27 s. The shift
  // is the nice-to-have (it keeps the candidate's shape); the drop is the one
  // that always works, so the drop gets the guaranteed slot.
  shifts: for (const meters of GENERATED_VIA_SHIFT_M) {
    for (const index of indices) {
      if (spent() > GENERATED_VIA_BUDGET_MS - DROP_RESERVE_MS) break shifts;
      const via = points[index];
      const towards = points[index - 1];
      const shifted = shiftTowards(via, towards, meters);
      const candidate = [...points];
      candidate[index] = shifted;
      const path = await request(candidate);
      if (path) {
        console.warn(
          `brouter: generated via ${via.join(",")} could not be reached; ` +
            `moved it ${meters} m along the corridor`
        );
        return path;
      }
    }
  }

  // 2. Drop them. Every generated via at once rather than one at a time: the
  // budget does not stretch to a subset search, and the remaining named
  // places still describe the ride the rider asked for.
  const kept = points.filter((point, index) =>
    index === 0 || index === points.length - 1 || !generated.has(pointKey(point))
  );
  if (kept.length >= 2 && kept.length < points.length) {
    const path = await request(kept);
    if (path) {
      console.warn(
        `brouter: dropped ${points.length - kept.length} unreachable generated via point(s); ` +
          `routed the candidate without them`
      );
      return path;
    }
  }
  return null;
}

/** A point moved `meters` from `from` towards `to`, along the straight line. */
function shiftTowards(from: Point, to: Point, meters: number): Point {
  const lonScale = 111320 * Math.cos((from[1] * Math.PI) / 180);
  const dx = (to[0] - from[0]) * lonScale;
  const dy = (to[1] - from[1]) * 111320;
  const len = Math.hypot(dx, dy);
  if (!len) return from;
  const t = Math.min(1, meters / len);
  return [
    Number((from[0] + (to[0] - from[0]) * t).toFixed(7)),
    Number((from[1] + (to[1] - from[1]) * t).toFixed(7)),
  ];
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
  profileId: string,
  generated: Set<string> = new Set()
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
  // Backlog item 20. A place the RIDER named is nudged wherever it sits in the
  // list, not only at the ends. Pressing "Pievienot" on Satezeles pilskalns
  // (24.8707, 57.17161) put it in the middle of a Sigulda round trip and the
  // whole request 422'd, because this ring only ever moved index 0 and index
  // `last` — the same Ērgļi footway case as a destination, and the rider
  // cannot tell the difference between "my stop is on a footway" and "the app
  // is broken". Generated vias are excluded: they had their own cheap rescue
  // above and must never buy 24 requests here.
  const namedMiddle = points
    .map((point, index) => ({ point, index }))
    .filter(({ point, index }) => index > 0 && index < last && !generated.has(pointKey(point)))
    .map(({ index }) => [index, `via ${index}`] as const);

  for (const [index, label] of [[last, "end"] as const, [0, "start"] as const, ...namedMiddle]) {
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
