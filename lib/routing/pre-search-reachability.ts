import type { Point } from "@/lib/geo/geometry";
import type { UnreachableStop } from "@/lib/types";
import { canOfferMove, judgeSnap, probeLegFor, type RoutablePointResult, type SnapProbe } from "./routable-point";

/**
 * Backlog 27: is every place the rider named reachable *before* the search?
 *
 * ## Why this runs before the search, not only after it
 *
 * Measured 2026-09-20 in production: a ride finishing at "Pilskalni 2" (a
 * farmstead behind `access=private` roads) came back with the place named
 * and two chips — but only after all ~36 candidates had routed, reached
 * nothing, and been thrown away by the 300 m stop check: **55 s** against a
 * 60 s cap. BRouter never refuses such a point; it answers 200 and ends the
 * line at the nearest node the profile allows (471 m off here). Every
 * candidate is therefore doomed from the start, and one short request per
 * place says so in well under a second.
 *
 * Map picks were already checked at Confirm (`/api/routable-point`); typed
 * places were not. This checks them all, whichever way they came in.
 *
 * ## What it may accuse, and what it may not
 *
 * Only **"too far from road"** refuses: the router answered and its line
 * ends further from the pin than the stop check will ever accept. Nothing in
 * the generation can rescue that — the endpoint-nudge ring runs only from a
 * `catch` on "target island" / "error re-tracking track", and a 200 raises
 * neither — so the refusal is certain, not a guess.
 *
 * Everything else lets the ride through to the search, which stays the
 * backstop (and still diagnoses after the fact, `findUnreachableStop`):
 *
 * - **"unroutable"** (island, re-tracking): exactly the case the nudge ring
 *   exists for. Satezeles pilskalns answers "target island" and routes after
 *   a 400 m nudge (backlog 20); refusing it here would be a regression.
 * - **"probe-failed"**: a slow or unanswered probe says nothing about the
 *   ground and must never turn into an accusation about the rider's pin.
 *
 * ## Why it costs nothing on a normal ride
 *
 * Each probe is a synthetic ~1.2 km leg beside the pin (`probeLegFor`), not
 * a real approach: the snap is a property of the pin, not of where the rider
 * comes from, and a short leg keeps the search tiny. All places are probed
 * **at once**, so the ride pays the slowest single probe, not their sum, and
 * each probe has its own short deadline. A place that looks unreachable is
 * asked once more from the opposite side before it is named — only on that
 * path, so a normal ride never pays for it — so that an unlucky offset point
 * cannot be what accuses a real place.
 *
 * Pure apart from the injected `probe`, which is `probeSnapPoint` in the
 * app and a stub in `scripts/pre-search-reachability.test.ts`.
 */

/** One place the rider named, in ride order. */
export type RiderPlace = {
  point: Point;
  /** the name the chat uses for it */
  name: string;
  /** 0 is the start, then each via, the finish last — as `UnreachableStop.index` */
  index: number;
  role: UnreachableStop["role"];
};

export type ReachabilityReport = {
  /** the first place in ride order that cannot be reached, if any */
  unreachable?: UnreachableStop;
  /** each distinct place's verdict, in ride order, for the log */
  verdicts: { place: RiderPlace; result: RoutablePointResult }[];
  /** wall-clock for the whole check */
  ms: number;
};

/** How far off the pin the probe leg starts; `probeLegFor`'s default. */
const PROBE_OFFSET_M = 1200;

/**
 * Probe every rider place at once and name the first that cannot be reached.
 *
 * Places at the same coordinate (a round trip's start and finish) are
 * probed once and judged as the first of them, so the refusal points at the
 * field the rider filled first.
 */
export async function checkRiderPlaces(params: {
  places: RiderPlace[];
  probe: (leg: [Point, Point]) => Promise<SnapProbe>;
  now?: () => number;
}): Promise<ReachabilityReport> {
  const now = params.now ?? Date.now;
  const startedAt = now();
  const seen = new Set<string>();
  const distinct = params.places.filter((p) => {
    const key = `${p.point[0]},${p.point[1]}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const verdicts = await Promise.all(
    distinct.map(async (place) => {
      let result = judgeSnap(place.point, await params.probe(probeLegFor(place.point, PROBE_OFFSET_M)));
      if (!result.ok && result.reason === "too-far-from-road") {
        // Asked again from the other side before anyone is told their place
        // is unreachable: a pin that snaps within tolerance from either side
        // is not a dead end, and the search stays the judge of it. When both
        // sides are too far, the first answer stands — it is the same leg
        // the Confirm-time check asks, so the two offer the same road.
        // (Measured on Pilskalni 2: five real approaches, from Ādaži to
        // Ērgļi, all end at 471 m; the west offset alone ends at 369 m on
        // another road, so its snapped point is not the one to offer.)
        const second = judgeSnap(place.point, await params.probe(probeLegFor(place.point, -PROBE_OFFSET_M)));
        if (second.ok) result = second;
      }
      return { place, result };
    })
  );

  const bad = verdicts.find((v) => !v.result.ok && v.result.reason === "too-far-from-road");
  return {
    verdicts,
    ms: now() - startedAt,
    ...(bad ? { unreachable: toUnreachableStop(bad.place, bad.result) } : {}),
  };
}

/** The verdict in the shape the refusal and the chips already speak. */
export function toUnreachableStop(place: RiderPlace, result: RoutablePointResult): UnreachableStop {
  return {
    name: place.name,
    index: place.index,
    role: place.role,
    lat: place.point[1],
    lon: place.point[0],
    ...(result.snappedTo ? { snappedTo: result.snappedTo } : {}),
    ...(result.distanceM !== undefined ? { distanceM: result.distanceM } : {}),
    canMove: canOfferMove(result),
  };
}
