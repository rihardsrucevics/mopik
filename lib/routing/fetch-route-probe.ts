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
  profileOptions: MotoProfileOptions;
  budgetMs?: number;
  /** the rider's own cancel; aborts the probe like the deadline does */
  signal?: AbortSignal;
}): Promise<ProbeOutcome> {
  const budgetMs = params.budgetMs ?? PROBE_BUDGET_MS;
  const startedAt = Date.now();
  const spent = () => (Date.now() - startedAt) / 1000;

  let profileId: string;
  try {
    // Profile upload is cached by content, so this is free for every request
    // after the first with these settings — and when it is not, it is part of
    // what the generation would have paid anyway.
    profileId = await uploadProfile(params.profileOptions);
  } catch (err) {
    return { ok: false, seconds: spent(), reason: "error", detail: message(err) };
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
    // generation.
    rememberLeg(profileId, params.points, path);
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
