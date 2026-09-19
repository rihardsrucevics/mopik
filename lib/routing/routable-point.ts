import { haversineMeters, type Point } from "@/lib/geo/geometry";

/**
 * Can a motorcycle actually get to the spot the rider just tapped?
 *
 * ## The failure this exists for, measured 2026-09-19
 *
 * A rider planned Glāziņpurvs → Sporta iela 36 → Lielpurvi → Tūjas →
 * Pilskalni 2 on Grūti · Sports · Meži and got
 * "Neizdevās atrast maršrutu, kas izpilda pieturvietas un norādītās robežas" —
 * every candidate failed, and nothing said which place was at fault.
 *
 * The cause was **not** what it looked like. The suspicion was the stop beside
 * Ādažu poligons snapping onto a military way and BRouter refusing the leg.
 * Measured, every leg of that ride routes on both the rider's profile and
 * Adventure (110.9 km / 90.3 km end to end). The problem was the **finish**:
 * Pilskalni 2 (24.9353088, 57.1933514) is a farmstead whose only approach is
 * `access=private` service road — 141 m and 328 m away — with the nearest
 * public road (V83) 1.2 km off. BRouter does not refuse such a point. It
 * answers **200** and silently ends the route at the nearest node it is
 * allowed to use, 471 m away.
 *
 * That silence is the whole problem:
 *
 * - No `target island`, no `error re-tracking track`, so the endpoint-nudge
 *   ring in `fetchRoutePath` never runs — it lives in a `catch` on those two
 *   messages. Nothing was broken there; it was never reached.
 * - `endpointMovedMeters` stays undefined, so the 300 m stop tolerance is
 *   never widened, and `visitsRequiredStops` rejects the path.
 * - Every candidate dies the same way, at the same place, and the 422 blames
 *   the budget.
 *
 * Nudging could not have saved it either: the ring's best offset lands 495 m
 * from the pin, *worse* than the plain 471 m snap. There is genuinely no
 * legal road within 300 m. The honest answer is to tell the rider, at the
 * moment they drop the pin, and offer to move it — not to search for 15 s and
 * then blame their time budget.
 *
 * ## Why snap distance is the measurement, not a route
 *
 * "Is this point routable" is answered by where BRouter *ends up* when asked
 * to go there, not by whether a route comes back: the route always comes
 * back. So the probe routes a short leg to the point and measures the gap
 * between the pin and the last coordinate. That gap is the snap, and it is
 * the same number `visitsRequiredStops` will later judge.
 *
 * This module is pure. The network call is injected, so the thresholds and
 * the verdict are testable without a router (`scripts/routable-point.test.ts`)
 * and the same rules serve both callers: the Confirm-time check in the pick
 * flow and the refusal wording after a failed generation.
 */

/** The tolerance the stop check itself uses — see `visitsRequiredStops`. */
export const STOP_TOLERANCE_M = 300;

/**
 * How far a pin may be moved for the rider to still call it the same place.
 *
 * The coordinator's rule: offer "pārvietot uz tuvāko ceļu" only when the road
 * is close enough that moving the pin is a correction rather than a different
 * destination. Beyond this the only honest chip is "take the stop out" — at
 * Pilskalni 2 the nearest legal road is 1.2 km away, and silently finishing a
 * ride there would be the substitution CLAUDE.md forbids.
 */
export const MOVE_OFFER_MAX_M = 500;

/** Why a point cannot be ridden to, when it cannot. */
export type RoutablePointReason =
  /** BRouter's nearest allowed node is further than the stop tolerance */
  | "too-far-from-road"
  /** the router refused the point outright (island, re-tracking) */
  | "unroutable"
  /** no answer inside the time we allow a Confirm-time check */
  | "probe-failed";

export type RoutablePointResult = {
  ok: boolean;
  /** where the router would actually put the rider, when it answered */
  snappedTo?: { lat: number; lon: number };
  /** metres from the pin to `snappedTo` */
  distanceM?: number;
  reason?: RoutablePointReason;
};

/**
 * What a probe reported back: where the routed line ended, or that it failed.
 * Injected so the decision below can be tested with no network.
 */
export type SnapProbe =
  | { ok: true; end: Point }
  | { ok: false; refused: boolean };

/**
 * Turn a measured snap into the rider's answer.
 *
 * Pure and total: every branch produces something the pick flow can act on,
 * because a dead end is exactly what the rider asked us not to give them.
 */
export function judgeSnap(point: Point, probe: SnapProbe): RoutablePointResult {
  if (!probe.ok) {
    return { ok: false, reason: probe.refused ? "unroutable" : "probe-failed" };
  }
  const distanceM = Math.round(haversineMeters(point, probe.end));
  const snappedTo = { lat: probe.end[1], lon: probe.end[0] };
  if (distanceM <= STOP_TOLERANCE_M) return { ok: true, snappedTo, distanceM };
  return { ok: false, snappedTo, distanceM, reason: "too-far-from-road" };
}

/**
 * Whether the "move it to the nearest road" chip may be offered.
 *
 * Needs a real snapped point, a distance that already failed the stop check,
 * and a move small enough to still be the same place. `judgeSnap` may report
 * a snap with no offer — that is the Pilskalni 2 case, where the only chip is
 * to remove the stop.
 */
export function canOfferMove(result: RoutablePointResult): boolean {
  return (
    !result.ok &&
    result.snappedTo !== undefined &&
    result.distanceM !== undefined &&
    result.distanceM <= MOVE_OFFER_MAX_M
  );
}

/**
 * A short out-and-back beside the pin, used as the probe leg.
 *
 * A probe needs somewhere to start, and at Confirm time there may be no other
 * place in the ride yet. Routing from a point a little way off to the pin
 * answers the only question that matters — where does the router put the
 * rider when asked to come here — and keeps the search tiny, which is what
 * holds the check inside its ~2 s.
 *
 * The offset is east unless that would cross a pole's worth of longitude;
 * direction does not matter, because the snap is a property of the pin.
 */
export function probeLegFor(point: Point, offsetMeters = 1200): [Point, Point] {
  const [lon, lat] = point;
  const dLon = offsetMeters / (111320 * Math.cos((lat * Math.PI) / 180));
  const from: Point = [Number((lon + dLon).toFixed(7)), lat];
  return [from, point];
}

/**
 * The whole check, for one pin and one profile.
 *
 * `probe` is injected for the tests; in the app it is `probeSnapPoint` from
 * `./brouter`, which the API route passes in. Keeping the network out of this
 * file is what lets the thresholds be pinned without a router.
 */
export async function checkRoutablePoint(params: {
  point: Point;
  probe: (leg: [Point, Point]) => Promise<SnapProbe>;
  /** where to probe from, when the ride already has a place to come from */
  from?: Point;
}): Promise<RoutablePointResult> {
  const leg: [Point, Point] = params.from
    ? [params.from, params.point]
    : probeLegFor(params.point);
  return judgeSnap(params.point, await params.probe(leg));
}
