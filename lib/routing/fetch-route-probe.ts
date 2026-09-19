import { edgesFromMessages, uploadProfile } from "./brouter";
import type { MotoProfileOptions } from "./moto-profile";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { RoutePath } from "@/lib/types";

/**
 * The feasibility probe: route the headline leg **once**, under a deadline,
 * before the candidate search commits to ~36 of them.
 *
 * Why this exists. A generation routes ~36 candidates inside a 50 s budget.
 * Whether that fits is decided by how hard the *search* is, not by how long
 * the ride is — measured on our own server, single legs:
 *
 *   Rīga → Berlin    1133 km   23 s
 *   Como → Budapest  1126 km   74 s
 *   Rīga → Roma         —      never answers (504 after 300 s)
 *
 * The same distance, three times the work, because the Alps are harder to
 * search than the North European plain. So a kilometre threshold cannot
 * decide this. The probe **measures** instead: it pays for one leg, and the
 * cost of that leg says what the rest of the generation can afford.
 *
 * ## BRouter has no server-side time limit we can use
 *
 * Measured against `brouter.mopik.eu` (BRouter 1.7.10) on 2026-09-14 —
 * **neither `maxRunningTime` nor `timeout` is honoured**:
 *
 *   Como → Budapest, maxRunningTime=10   → 200 after 77.2 s
 *   Como → Budapest, maxRunningTime=300  → 200 after 76.5 s
 *   Berlin → Warszawa, timeout=3         → 200 after 29.6 s
 *
 * The 400 "killed by thread-priority-watchdog after N seconds" replies that
 * looked like the parameter working were the server's own watchdog reacting
 * to *overlapping* requests, not to what we asked for — they reproduce with
 * no parameter at all when two searches overlap, and the number in the
 * message tracks the overlap rather than the value passed.
 *
 * So the deadline is enforced **here, on our side**, with an AbortController.
 * The server keeps burning CPU on an abandoned search for a while afterwards;
 * that is the price of a router with no cancel, and it is far cheaper than
 * the rider waiting 50 s for a 422.
 *
 * ## The server is one vCPU, so concurrency is not free
 *
 * Also measured 2026-09-14: with one long search already running, Berlin →
 * Warszawa went from 14.7 s to 35-40 s, and Como → Budapest from 77 s to
 * 137 s. A candidate does not cost what the probe cost divided by the
 * concurrency — it costs roughly what the probe cost, and running four at a
 * time mostly buys overlap of the non-routing work. `affordableCandidates`
 * below is deliberately conservative for exactly this reason.
 */

/** What one probe attempt cost, and what came back. */
export type ProbeOutcome =
  | {
      ok: true;
      /** wall-clock for the routed leg, seconds */
      seconds: number;
      /** the routed leg itself, so the candidate search need not pay again */
      path: RoutePath;
      /** the leg that was routed, as given */
      points: Point[];
    }
  | {
      ok: false;
      /** wall-clock actually spent before giving up, seconds */
      seconds: number;
      /** "timeout" when the deadline struck, "error" when BRouter refused */
      reason: "timeout" | "error";
      /** BRouter's own words, when it had any */
      detail?: string;
    };

/**
 * How long the probe may take before the ride is called unplannable.
 *
 * Reasoning from the measurements. Rīga → Tallinn (343 km) routes in 2.4 s
 * and Berlin → Warszawa (646 km) in 14.4 s, both of which generate fine
 * today. Como → Budapest at 74 s does not, and never can: 36 candidates at
 * 74 s is 44 minutes against a 50 s budget. 10 s sits above every leg that
 * works today and well below the ones that cannot, and leaves 40 s of the
 * budget for the search when the probe passes.
 */
export const PROBE_BUDGET_MS = 10_000;

/**
 * Overhead a generation pays outside the routed candidates: the intent parse,
 * geocoding, the isochrone, classification and building the response.
 * Measured at roughly 5 s on a normal request; the probe's own leg is
 * counted separately by the caller, since it is already spent.
 */
export const GENERATION_OVERHEAD_MS = 5_000;

/**
 * How many candidates a generation can afford when one leg costs `legMs`.
 *
 * The arithmetic the rider asked for: `(budget − overhead) / T`, where T is
 * what one routed leg costs. Concurrency is deliberately NOT divided in —
 * the router is a single vCPU and overlapping searches measured *slower per
 * search*, not faster, so treating four-at-a-time as four times the capacity
 * would promise a budget that does not exist.
 *
 * Clamped to at least one candidate: a ride whose probe passed has a routed
 * leg in hand, so there is always something to show, and returning one
 * version beats returning a 422.
 */
export function affordableCandidates(params: {
  /** total wall-clock for the generation, ms */
  budgetMs: number;
  /** already spent, ms — the probe's own leg and anything before it */
  spentMs: number;
  /** what one routed leg costs, ms (the probe's measurement) */
  legMs: number;
  /** fixed non-routing cost of the generation, ms */
  overheadMs?: number;
  /** never plan more than the search actually built */
  cap: number;
}): number {
  const overhead = params.overheadMs ?? GENERATION_OVERHEAD_MS;
  const remaining = params.budgetMs - params.spentMs - overhead;
  // A leg that measured as instant must not divide into infinity.
  const perLeg = Math.max(250, params.legMs);
  const affordable = Math.floor(remaining / perLeg);
  return Math.max(1, Math.min(params.cap, affordable));
}

/**
 * The leg that decides the request: the longest straight-line hop between
 * the places the rider named. A ride is unplannable because of its hardest
 * single search, not because of the sum of its easy ones, and the corridor
 * candidates all span these same places — so this is the leg every one of
 * them will pay for.
 */
export function headlineLeg(points: Point[]): { from: Point; to: Point; km: number } | null {
  if (points.length < 2) return null;
  let best = { from: points[0], to: points[1], km: 0 };
  for (let i = 0; i < points.length - 1; i++) {
    const km = haversineMeters(points[i], points[i + 1]) / 1000;
    if (km >= best.km) best = { from: points[i], to: points[i + 1], km };
  }
  return best;
}

/**
 * The rider's ride, cut at the places they named: start → via1, via1 → via2,
 * … → finish. One entry per hop, carrying both the points and the names, so
 * a refusal can say *which* hop is the problem in the rider's own words.
 *
 * Why per segment and not one headline leg (backlog item 7, step 2d). The
 * headline leg is the right question for "is this whole ride too hard", but
 * it is the wrong question once the rider has named intermediate places:
 * measured on 2026-09-19, Berlin → Poznań → Warszawa has a headline leg of
 * only ~300 km, which probes fast and waves the request through — and then
 * the generation spends 29 s and returns a 422 anyway, because the *other*
 * hop was the expensive one and nobody had measured it. Probing every hop
 * turns that into an answer.
 *
 * A single-leg ride (no vias) yields exactly one segment, which is the same
 * question `headlineLeg` asked — so the old behaviour is the one-segment
 * case of this one, not a separate path.
 */
export type RideSegment = {
  /** position in the ride, 0-based, for keying the verdict back to the plan */
  index: number;
  from: Point;
  to: Point;
  /** how the rider named these places; "" when the place has no name */
  fromName: string;
  toName: string;
  /** straight-line km of the hop */
  km: number;
};

/**
 * Cut a ride into its rider-named segments.
 *
 * `points` and `names` are start, vias, finish in riding order. Names are
 * positional and may be short — a missing name yields "", which the caller
 * renders as the place's own label rather than inventing one.
 */
export function rideSegments(points: Point[], names: string[] = []): RideSegment[] {
  const segments: RideSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    segments.push({
      index: i,
      from: points[i],
      to: points[i + 1],
      fromName: names[i] ?? "",
      toName: names[i + 1] ?? "",
      km: haversineMeters(points[i], points[i + 1]) / 1000,
    });
  }
  return segments;
}

/**
 * Which segments are worth probing, and in which order.
 *
 * Two rules, both from measurement. Short hops are never the problem — Rīga →
 * Baldone (46 km) probes in 2-3 s of pure cost on a request that was always
 * going to work — so a hop under `aboveKm` is skipped outright. And the
 * remaining ones are probed **longest first**, because the probe budget is
 * shared across the whole ride: if it runs out, it should have spent itself
 * on the hop most likely to be the one that refuses, not on the first one in
 * riding order. Ties keep riding order, so a refusal reads left to right.
 */
export function segmentsWorthProbing(segments: RideSegment[], aboveKm: number): RideSegment[] {
  return segments
    .filter((s) => s.km >= aboveKm)
    .sort((a, b) => b.km - a.km || a.index - b.index);
}

/**
 * The segment whose timing scales the search: the slowest one measured.
 *
 * Every corridor candidate rides the whole ride, so it pays for every
 * segment — but the search is scaled by the slowest rather than by the sum,
 * matching what `affordableCandidates` means by "what one routed leg costs".
 * Using the sum would double-count on a ride whose segments were all probed
 * and all fast, and cut a search that measured fine.
 *
 * Deliberately *not* the mean: one hard segment among three easy ones is
 * still a hard search, and the mean would hide it.
 */
export function slowestSegmentSeconds(measured: { seconds: number }[]): number {
  return measured.reduce((worst, m) => Math.max(worst, m.seconds), 0);
}

/**
 * What **one candidate** costs, given what the probe measured.
 *
 * This is the number `affordableCandidates` needs, and on a multi-segment
 * ride it is not the slowest segment. A corridor candidate rides the *whole*
 * ride — every hop, plus the detour the corridor adds — so it pays for every
 * segment, not just the worst one.
 *
 * Measured 2026-09-19, and this is why the helper exists. Berlin → Poznań →
 * Warszawa: the probe measured one hop at 9.6 s, the slowest-segment
 * arithmetic said three candidates were affordable, and **all three timed
 * out** — because each of them was routing both hops, not one. Pricing a
 * candidate at the slowest segment promised a budget that did not exist.
 *
 * So: the probed segments are summed, and the ones the shared budget never
 * reached are charged at the slowest measured rate rather than at nothing.
 * Charging them nothing is the mistake above; charging them the slowest is
 * conservative in the direction that returns a ride instead of a 422.
 *
 * ## And a candidate is dearer than the sum of the rider's own legs
 *
 * The probe routes start → via → finish *straight*. A corridor candidate
 * does not: it inserts offset vias to push the ride off the direct line,
 * which is the entire point of Mopik, and that is a longer and harder search
 * than the leg the probe measured. Measured 2026-09-19 on Berlin → Poznań →
 * Warszawa: pricing candidates at the bare segment sum (8.1 s probed, 16.2 s
 * for both hops) allowed two, and **both timed out**.
 *
 * `CORRIDOR_MARGIN` prices that difference. It is a margin, not a
 * measurement — the honest reading of the evidence is "a candidate costs
 * meaningfully more than the straight legs", and erring high costs the rider
 * a version while erring low costs them the whole ride.
 */
export const CORRIDOR_MARGIN = 1.5;

export function candidateCostSeconds(params: {
  /** what each probed segment measured, seconds */
  measured: number[];
  /** how many segments the ride has in total, probed or not */
  totalSegments: number;
  /** how much dearer a corridor candidate is than the straight legs */
  corridorMargin?: number;
}): number {
  if (!params.measured.length) return 0;
  const measuredTotal = params.measured.reduce((sum, s) => sum + s, 0);
  const slowest = Math.max(...params.measured);
  // Hops below the probe floor are short by definition, but "short" is not
  // "free" — they are still a search the candidate pays for. The slowest
  // measured rate is the only evidence available about them.
  const unprobed = Math.max(0, params.totalSegments - params.measured.length);
  const straight = measuredTotal + unprobed * slowest;
  return straight * (params.corridorMargin ?? CORRIDOR_MARGIN);
}

/**
 * Route one leg under a wall-clock deadline.
 *
 * Deliberately *not* `fetchRoutePath`: none of its rescue machinery belongs
 * in a probe. Nudging a mis-snapped endpoint, dropping island via points and
 * splitting a refused leg all exist to save a candidate, and each one costs
 * another round trip — which is precisely the budget the probe is trying to
 * measure. A probe that quietly took four attempts would report a leg cost
 * four times the truth and refuse a ride that generates fine.
 *
 * So this is one request, one deadline, one answer. A leg that fails here for
 * a rescuable reason still fails *fast*, and the caller can tell the rider
 * something honest instead of making them wait for the full search to
 * discover the same thing.
 */
export async function probeLeg(params: {
  points: Point[];
  /** the ride's profile; not needed, and ignored, when `stockProfile` is set */
  profileOptions?: MotoProfileOptions;
  budgetMs?: number;
  /**
   * Route on one of BRouter's own built-in profiles instead of ours, by
   * name. Only the direct-road offer uses this — see `directLegOffer` for
   * the measurement that made it necessary.
   */
  stockProfile?: string;
  /** the rider's own cancel; aborts the probe like the deadline does */
  signal?: AbortSignal;
}): Promise<ProbeOutcome> {
  const budgetMs = params.budgetMs ?? PROBE_BUDGET_MS;
  const startedAt = Date.now();
  const spent = () => (Date.now() - startedAt) / 1000;

  let profileId: string;
  if (params.stockProfile) {
    // A profile BRouter ships with: nothing to upload, and nothing of ours
    // in it. Deliberately not remembered for the candidate search either —
    // a `car-fast` line is not a leg any Mopik candidate would ride.
    profileId = params.stockProfile;
  } else if (params.profileOptions) {
    try {
      // Profile upload is cached by content, so this is free for every request
      // after the first with these settings — and when it is not, it is part of
      // what the generation would have paid anyway.
      profileId = await uploadProfile(params.profileOptions);
    } catch (err) {
      return { ok: false, seconds: spent(), reason: "error", detail: message(err) };
    }
  } else {
    return { ok: false, seconds: spent(), reason: "error", detail: "no profile" };
  }

  const base = process.env.BROUTER_BASE_URL?.trim()
    ? process.env.BROUTER_BASE_URL.trim().replace(/\/$/, "")
    : "https://brouter.de";
  const token = process.env.BROUTER_TOKEN;
  const lonlats = params.points.map(([lon, lat]) => `${lon},${lat}`).join("|");
  const url =
    `${base}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
    `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;

  // The deadline is ours because BRouter's own is not usable (see the module
  // comment). `AbortSignal.any` folds the rider's cancel into the same wire.
  const deadline = AbortSignal.timeout(budgetMs);
  const signal = params.signal ? AbortSignal.any([deadline, params.signal]) : deadline;

  try {
    const res = await fetch(url, {
      headers: token ? { "X-Mopik-Token": token } : {},
      signal,
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 160);
      // The watchdog kill is the server giving up on a hard search under
      // load, which is the same verdict as our own deadline: too slow.
      const watchdog = res.status === 400 && /watchdog/.test(body);
      return {
        ok: false,
        seconds: spent(),
        reason: watchdog ? "timeout" : "error",
        detail: `${res.status}: ${body}`,
      };
    }
    const data = (await res.json()) as {
      features?: {
        geometry: { coordinates: [number, number, number?][] };
        properties: {
          "track-length": string | number;
          "total-time": string | number;
          messages?: string[][];
        };
      }[];
    };
    const feature = data.features?.[0];
    if (!feature) return { ok: false, seconds: spent(), reason: "error", detail: "no route" };
    const coordinates: Point[] = feature.geometry.coordinates.map(([lon, lat]) => [lon, lat]);
    if (coordinates.length < 2) {
      return { ok: false, seconds: spent(), reason: "error", detail: "empty shape" };
    }
    const path: RoutePath = {
      distanceMeters: Math.round(Number(feature.properties["track-length"])),
      durationSeconds: Math.round(Number(feature.properties["total-time"])),
      coordinates,
      edges: edgesFromMessages(feature.properties.messages, coordinates),
    };
    // Hand the leg to the candidate search: it is about to ask for exactly
    // this one, and on a long ride it is the most expensive search of the
    // generation. A stock-profile leg is not offered — it is a `car-fast`
    // line, which no Mopik candidate would ride, and the cache is keyed by
    // profile anyway, so keeping it would only hold memory.
    if (!params.stockProfile) rememberLeg(profileId, params.points, path);
    return { ok: true, seconds: spent(), points: params.points, path };
  } catch (err) {
    const aborted = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      seconds: spent(),
      reason: aborted ? "timeout" : "error",
      detail: aborted ? undefined : message(err),
    };
  }
}

/**
 * Total wall-clock the whole probing phase may take, however many segments
 * the rider named.
 *
 * The constraint the rider set: probing N segments must not itself eat the
 * budget. A per-segment deadline alone does not bound it — four segments at
 * `PROBE_BUDGET_MS` each is 40 s of a 50 s budget, and the ride would be
 * refused for lack of time to plan it rather than for being hard. So the
 * phase gets the same 10 s the single-leg probe always had, and segments
 * draw from it in turn.
 *
 * The consequence is deliberate: a segment reached with little left gets
 * little, and a segment that would have passed in 8 s may be called slow.
 * That errs towards the honest refusal, which names the segment and offers
 * the direct road, rather than towards a 50 s wait ending in a 422.
 */
export const SEGMENT_PROBE_TOTAL_MS = 10_000;

/**
 * The least a segment's own deadline may be cut to. Below this the answer
 * stops being a measurement — every segment times out and the verdict names
 * whichever one happened to be probed last, which is worse than not probing.
 */
export const MIN_SEGMENT_PROBE_MS = 2_500;

/** One segment, measured. */
export type SegmentProbe = {
  segment: RideSegment;
  outcome: ProbeOutcome;
  /** wall-clock this segment cost, seconds — `outcome.seconds`, hoisted */
  seconds: number;
};

/** A segment that did not route: the same shape, with the failure narrowed. */
export type FailedSegmentProbe = SegmentProbe & {
  outcome: Extract<ProbeOutcome, { ok: false }>;
};

/** What the probing phase concluded about the ride as a whole. */
export type SegmentProbeReport = {
  /** every segment actually probed, in the order they were probed */
  probed: SegmentProbe[];
  /** the first segment that failed, if any — the one the rider must fix */
  failed: FailedSegmentProbe | null;
  /** the slowest measured segment's cost, seconds; 0 when nothing was probed */
  slowestSeconds: number;
  /** total wall-clock of the phase, seconds */
  totalSeconds: number;
};

/**
 * Probe each rider-named segment, under a shared total deadline.
 *
 * ## Sequential, on purpose — the server is one vCPU
 *
 * The obvious optimisation is `Promise.all` over the segments, and it is the
 * wrong one here. Measured 2026-09-14 and unchanged: with one long search
 * already running, Berlin → Warszawa went 14.7 s → 35-40 s and Como →
 * Budapest 77 s → 137 s. Overlapping two searches on one vCPU does not halve
 * the wall-clock, it roughly doubles each search — so a concurrent probe of
 * three segments would measure all three as slow and refuse a ride that
 * plans fine sequentially. Worse, the measurement would be *wrong* in the
 * direction that costs the rider their ride.
 *
 * So segments are probed one at a time, longest first, each drawing from what
 * the phase has left. Concurrency is not free, and here it is not even
 * cheaper.
 *
 * ## One slow segment does not degrade the rest
 *
 * A segment that probes fast keeps its full search: `slowestSeconds` scales
 * the candidate pool, and a fast ride measures fast. Only a segment that
 * actually fails stops the ride, and then the verdict names it.
 */
export async function probeSegments(params: {
  segments: RideSegment[];
  profileOptions: MotoProfileOptions;
  /** total for the whole phase; per-segment deadlines are carved from it */
  totalBudgetMs?: number;
  signal?: AbortSignal;
}): Promise<SegmentProbeReport> {
  const totalBudgetMs = params.totalBudgetMs ?? SEGMENT_PROBE_TOTAL_MS;
  const startedAt = Date.now();
  const probed: SegmentProbe[] = [];
  let failed: FailedSegmentProbe | null = null;

  for (let i = 0; i < params.segments.length; i++) {
    const segment = params.segments[i];
    const spent = Date.now() - startedAt;
    const left = totalBudgetMs - spent;
    // Nothing left to measure with: stop rather than fire a request that is
    // certain to time out and would only slander the segment it lands on.
    if (left < MIN_SEGMENT_PROBE_MS) break;
    // Share what remains between the segments still to go, but never below
    // the floor — an even split across many segments would starve them all.
    const remainingSegments = params.segments.length - i;
    const budgetMs = Math.max(MIN_SEGMENT_PROBE_MS, Math.floor(left / remainingSegments));

    const outcome = await probeLeg({
      points: [segment.from, segment.to],
      profileOptions: params.profileOptions,
      budgetMs,
      signal: params.signal,
    });
    const entry: SegmentProbe = { segment, outcome, seconds: outcome.seconds };
    probed.push(entry);
    if (!outcome.ok) {
      // The first failure is the answer. Probing the rest would spend the
      // rider's remaining seconds learning something they cannot act on —
      // they have to fix this segment before any other one matters.
      failed = { ...entry, outcome };
      break;
    }
  }

  return {
    probed,
    failed,
    slowestSeconds: slowestSegmentSeconds(probed.filter((p) => p.outcome.ok)),
    totalSeconds: (Date.now() - startedAt) / 1000,
  };
}

/**
 * How long the direct-road offer may take. It is an extra, not the answer:
 * the rider has already waited the whole probe phase by the time this runs,
 * so it gets a fixed slice and stays silent if it cannot make it.
 *
 * Measured 2026-09-19 on `car-fast`, the profile the offer actually uses:
 * Berlin → Warszawa 5.7 s, Innsbruck → Wien (the Alpine hop that refuses
 * Como → Budapest) 17.3 s. 20 s covers both with room for a loaded router.
 *
 * It is the last thing a refused request does, and it runs only on the
 * refusal path, so the arithmetic that matters is the refusal's total: a
 * ~10 s probe phase plus this still lands inside the 50 s budget. The rider
 * waits a few seconds longer for a refusal that comes with a way forward,
 * which is the trade item 7 is about.
 */
export const DIRECT_OFFER_BUDGET_MS = 20_000;

/**
 * BRouter's own car profile, which is what the offer routes on.
 *
 * Measured 2026-09-19 on Berlin → Warszawa against `brouter.mopik.eu`, the
 * leg this offer exists for:
 *
 *   our moto profile, flattened to offRoad 0 / no trails   **never answers** (null at 91 s)
 *   stock `trekking`                                       53.2 s
 *   stock `car-fast`                                       **5.7 s**
 *
 * Nearly a factor of ten, and the flattened moto profile does not finish at
 * all. The cost is our cost script — the turn, surface, grade and off-road
 * terms that make a Mopik route interesting are what make the search
 * expensive — so flattening its dials does not buy a fast search, it only
 * buys a duller one. Innsbruck → Wien tells the same story: 28-43 s on our
 * flattened profile, both with and without motorways.
 *
 * This is also the *honest* profile for the offer. "Taisnākais ceļš" is the
 * road a car would take, and saying so with a car profile is more truthful
 * than dressing our adventure profile down and calling the result direct.
 */
export const DIRECT_OFFER_PROFILE = "car-fast";

/**
 * The direct road for a segment Mopik could not plan interestingly —
 * backlog item 7's idea (b), as a **named offer**.
 *
 * Why a second request rather than reusing the probe's own leg. On a timeout
 * — which is the common failure — the probe has no path at all: it gave up
 * before BRouter answered, so there is nothing to hand over.
 *
 * Why BRouter's stock car profile rather than ours flattened: because ours
 * flattened **does not answer at all** on the legs that need this, while
 * `car-fast` answers in seconds. The numbers are on `DIRECT_OFFER_PROFILE`,
 * and they were a surprise — the first version of this function dressed our
 * own profile down, and measured, it was the slowest option of the three.
 *
 * Returns null whenever it cannot deliver, and the caller then simply makes
 * no offer. A failed offer must never become a failed refusal: the segment
 * verdict is the answer, and this is the extra tap beside it.
 *
 * **The geometry comes back with it, and that is deliberate.** The rider taps
 * "Rādi taisnāko ceļu" and the road must appear — it cannot be re-requested
 * from the client, because the client would ask with the *ride's* profile and
 * that profile is measured never to answer this leg (91 s, null). So the one
 * search that did succeed is the one that gets shown.
 *
 * Never returned *as* the ride. CLAUDE.md: "never substitute silently" —
 * the straightest line between two points is precisely the road an adventure
 * rider was trying to avoid, so the rider chooses it or they do not get it.
 */
export async function directLegOffer(params: {
  from: Point;
  to: Point;
  budgetMs?: number;
  signal?: AbortSignal;
}): Promise<RoutePath | null> {
  const outcome = await probeLeg({
    points: [params.from, params.to],
    // The ride's own profile is deliberately not passed: the offer is a
    // different road on a different profile, and accepting the rider's dials
    // here would only imply it honours them.
    stockProfile: DIRECT_OFFER_PROFILE,
    budgetMs: params.budgetMs ?? DIRECT_OFFER_BUDGET_MS,
    signal: params.signal,
  });
  return outcome.ok ? outcome.path : null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Legs the probe has already routed in this request, so the candidate search
 * does not pay for the same search twice.
 *
 * The probe routes exactly the leg the `via-0` candidate routes — same two
 * points, same profile — and on the requests where the probe matters most
 * that leg is the single most expensive thing the generation does. Handing
 * the result over is the difference between spending the measurement and
 * spending it twice.
 *
 * Keyed by profile and by the exact point list, because "what this leg costs"
 * is a property of both. Scoped per request by the caller clearing it: a
 * module-level cache that outlived the request would serve a stale geometry
 * to a later rider, and a route is not something to guess at.
 */
const legCache = new Map<string, RoutePath>();

const legKey = (profileId: string, points: Point[]) =>
  `${profileId}|${points.map(([lon, lat]) => `${lon},${lat}`).join("|")}`;

/** Remember a routed leg for the rest of this generation. */
export function rememberLeg(profileId: string, points: Point[], path: RoutePath): void {
  legCache.set(legKey(profileId, points), path);
}

/** A leg already routed in this generation, if the probe paid for it. */
export function recallLeg(profileId: string, points: Point[]): RoutePath | undefined {
  return legCache.get(legKey(profileId, points));
}

/** Drop everything remembered; called once per request so nothing leaks between riders. */
export function forgetLegs(): void {
  legCache.clear();
}

/**
 * How far BRouter had to move a point to find a road this profile may ride —
 * the cheap "is this in the water" test, item 11e.
 *
 * ## Why a snap distance and not geometry
 *
 * Item 11e's brief proposed inferring water from the coastline dataset: a via
 * is offshore if it is far from the coast *and* the 16-bearing land probe
 * `seawardVias` uses finds land on one side only. **That was measured and it
 * does not work.** `public/sea/*.json` is a list of coastline vertices with no
 * inside/outside, so `distanceM` is symmetric about the coastline: a point 8 km
 * out to sea and a point 8 km inland return the same distance, and a ring of
 * probes around either reduces that distance on about half its bearings.
 * Measured on Liepāja → Ventspils, bearings out of 16 that moved *closer* to
 * the coastline, at four probe radii:
 *
 * ```
 * via-0.7-1  (8.2 km OFFSHORE)  2km:9/16  5km:9/16  10km:9/16  20km:6/16
 * via-0.7--1 (7.9 km INLAND)    2km:9/16  5km:8/16  10km:8/16  20km:5/16
 * ```
 *
 * Identical. No threshold separates them, because there is no asymmetry in the
 * data to find. A polygon dataset would answer this; we do not have one, and
 * item 11b already priced building one.
 *
 * ## What does work: ask the router where the nearest road is
 *
 * BRouter snaps each waypoint to the nearest way the profile may use. On land
 * that is metres away; in the sea it is however far the shore is. A 200 m leg
 * from the point is enough to make it answer, and the first returned
 * coordinate is the snapped position. Measured on the same fourteen vias:
 *
 * | | coast distance | snap distance |
 * |---|---:|---:|
 * | side +1 (in the Baltic) | 4.1–30.0 km | **4.1–24.6 km** |
 * | side −1 (inland) | 4.0–33.4 km | **13–883 m** |
 *
 * Three orders of magnitude apart, with nothing in between — and the coast
 * distance, the signal the brief proposed, is the same on both sides. It also
 * catches a case pure geometry cannot: `via-2.8-1` sits 30 km from the nearest
 * coastline vertex yet snaps 12 km, because it is in open water with the
 * *other* shore nearest.
 *
 * ## And it is cheap
 *
 * Measured against `brouter.mopik.eu`: **37–50 ms per probe**, 0.56–0.65 s for
 * a ride's full set of fourteen. Against the 293 s that ride's twelve offshore
 * candidates burned on the endpoint-nudge ring and the segmented retry, the
 * probe pays for itself roughly five hundred times over. It is one vCPU, so
 * the probes run sequentially like everything else here.
 *
 * Returns null when the probe itself fails — a router error must never be read
 * as "this point is in the sea", or a BRouter hiccup would silently empty the
 * candidate pool. The caller treats null as "no opinion" and keeps the via.
 */
export async function snapDistanceM(params: {
  point: Point;
  profileOptions: MotoProfileOptions;
  signal?: AbortSignal;
  budgetMs?: number;
}): Promise<number | null> {
  let profileId: string;
  try {
    profileId = await uploadProfile(params.profileOptions);
  } catch {
    return null;
  }

  // A one-point request is not a route, so the probe asks for the shortest leg
  // that still makes BRouter snap: 200 m due east. Direction does not matter —
  // both endpoints snap, and it is the *first* coordinate we read.
  const [lon, lat] = params.point;
  const dlon = 200 / (111320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const lonlats = `${lon},${lat}|${lon + dlon},${lat}`;

  const base = process.env.BROUTER_BASE_URL?.trim()
    ? process.env.BROUTER_BASE_URL.trim().replace(/\/$/, "")
    : "https://brouter.de";
  const token = process.env.BROUTER_TOKEN;
  const url =
    `${base}/brouter?lonlats=${encodeURIComponent(lonlats)}` +
    `&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;

  const deadline = AbortSignal.timeout(params.budgetMs ?? SNAP_PROBE_BUDGET_MS);
  const signal = params.signal ? AbortSignal.any([deadline, params.signal]) : deadline;

  try {
    const res = await fetch(url, { headers: token ? { "X-Mopik-Token": token } : {}, signal });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: { geometry: { coordinates: [number, number, number?][] } }[];
    };
    const first = data.features?.[0]?.geometry?.coordinates?.[0];
    if (!first) return null;
    return haversineMeters(params.point, [first[0], first[1]]);
  } catch {
    return null;
  }
}

/**
 * How long one snap probe may take. Measured at 37–50 ms against our own
 * instance, so three seconds is not a budget — it is a guard against a probe
 * that has hung, and a hung probe answers "no opinion" rather than holding the
 * generation it exists to protect.
 */
export const SNAP_PROBE_BUDGET_MS = 3_000;
