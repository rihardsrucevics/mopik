import type { RouteIntent } from "@/lib/types";

/** Lower is better. Forest preference remains active above the gravel floor.
 * Track/trail share is a proxy for forest riding, not proof of forest cover.
 * These provisional weights must be checked against rider-approved routes.
 */
export function loopRank(intent: RouteIntent, metrics: {
  repeatedPercent: number;
  unpavedPercent: number;
  trackPercent: number;
  trailPercent: number;
  streetPercent: number;
  excessDriftPercent: number;
  /** Bounded 0–100 mix of forest, water, open country, relief and transitions. */
  natureScore?: number;
  /** Share of the ride within 1 km of a coastline on a real road, 0–100.
   * Only meaningful where `hasSeaData` covers the ride; 0 elsewhere. */
  coastPercent?: number;
  /** The same at a 3 km band — near the sea rather than on the shore road. */
  coastNearPercent?: number;
}): number {
  const wantsUnpaved = intent.gravelPreference >= 70 || intent.trailPreference === "lots";
  const natureWeight = intent.rideStyle === "explore" ? 0.18 : intent.rideStyle === "balanced" ? 0.12 : 0.08;
  // Trails are what "Grūti" and "Sports" actually mean to an adventure rider:
  // the dotted lines, not more gravel road. So a rider who asked for them is
  // owed a real share of them, and a candidate that found some beats one that
  // found none even when the rest is equal. The target is deliberately modest
  // (8% of the ride, ~5 km in a 60 km loop) because Latvian path density is
  // low — Blīdene has 3.8 km of path in a 15x13 km box — and an unreachable
  // target would just flatten the ranking.
  const trailTarget = intent.trailPreference === "lots" ? (intent.difficulty === "hard" ? 8 : 5) : intent.trailPreference === "some" ? 2 : 0;
  const trailShortfall = trailTarget ? Math.max(0, trailTarget - metrics.trailPercent) * 2.5 : 0;
  // Off-road share, counted the way a rider counts it: forest tracks and
  // trails, not "unpaved" — Latvian gravel farm roads are unpaved too, and a
  // loop can score 70% unpaved while riding almost no forest. Measured near
  // Sigulda: the area has 350 km of track+path, a direct leg through it
  // routes 55% on them, yet loops came back at 17-29%. The shortfall term
  // makes a candidate that found the forest beat one that found gravel road.
  const offRoadTarget = intent.trailPreference === "lots" ? 45 : intent.trailPreference === "some" ? 25 : 0;
  const offRoadShortfall = offRoadTarget
    ? Math.max(0, offRoadTarget - (metrics.trackPercent + metrics.trailPercent)) * 0.9
    : 0;
  // The sea, and it is deliberately NOT part of `natureScore`.
  //
  // The rider: "braukt gar krastu pa īstu ceļu jābūt labāk (vēlamāk) kā braukt
  // pa ceļu, kas neiet gar krastu — tāpēc, ka taču būtu smuks skats!" A coastal
  // road should beat an inland one of the same class, because of the view.
  //
  // Separate from `riverValue` because item 11b measured that the two cannot be
  // told apart from any tag BRouter has: its `lookups.dat` carries a `waterway`
  // key and no `natural` key at all, `estimated_river_class` reads 1 or nothing
  // on the P111 and the Kolka cape road, and the class 5–6 kilometres coastal
  // rides do collect sit 3–10 km inland on the Gauja, the Venta and the Irbe. A
  // discount keyed on it was built, swept and reverted: at 0.15 the routes got
  // 16 km longer and ended up *further* from the sea. So the sea is geometry
  // (`lib/geo/sea.ts`), measured in `classify.ts`, and spent here.
  //
  // ## The weight, and why this number
  //
  // Bounded like the landscape terms: the share within 1 km of the coast is
  // normalised against a 25 % target — a quarter of the ride beside the water
  // is a coastal ride, and the six legs item 11b measured ran 0.7–42 % — then
  // multiplied by SEA_WEIGHT. So the term spans 0 to −8 rank points, and the
  // 3 km band adds at most −2: near the sea is worth something, on the shore
  // road is worth four times more.
  //
  // 8 points is chosen to sit *between* two things, and both bounds are the
  // point:
  //
  //  - It must beat a tie. `natureScore` contributes up to 18 points and moves
  //    by a few between similar candidates, so a coastal candidate and an
  //    inland one of otherwise equal quality differ by well under 8 — the coast
  //    wins, which is exactly what the rider asked for.
  //  - It must never beat the things he ranks first. The repeated-road penalty
  //    is `repeatedPercent` at 1–2× — "galvenais nebraukt tos pašus ceļus" —
  //    so 8 points buys at most 8 % more retracing (4 % when
  //    `prioritizeLowOverlap`), and a genuinely retracing loop is 20–50 % and
  //    loses by tens of points. `offRoadShortfall` spans 40 and
  //    `trailShortfall` 20, so the coast can never buy a ride out of the
  //    tracks and trails an adventure rider came for. A seaside asphalt run
  //    cannot outrank a forest loop; it can only win between equals.
  //
  // Not scaled by `rideStyle` the way `natureWeight` is: the view from the
  // coast road is the same view whatever the rider asked for, and item 11b's
  // complaint was about a plain A-to-B leg.
  const SEA_WEIGHT = 8;
  const COAST_TARGET_PERCENT = 25;
  const coastValue = Math.min(1, (metrics.coastPercent ?? 0) / COAST_TARGET_PERCENT);
  const coastNearValue = Math.min(1, (metrics.coastNearPercent ?? 0) / COAST_TARGET_PERCENT);
  const seaBonus = SEA_WEIGHT * (coastValue + 0.25 * coastNearValue);

  return metrics.repeatedPercent * (intent.prioritizeLowOverlap ? 2 : 1)
    + (wantsUnpaved ? Math.max(0, 55 - metrics.unpavedPercent) : 0)
    + trailShortfall
    + offRoadShortfall
    + (intent.preferForest ? Math.max(0, 100 - metrics.trackPercent - metrics.trailPercent) * 0.5 : 0)
    + metrics.excessDriftPercent
    + metrics.streetPercent * (intent.avoidTowns ? 1 : 0.3)
    - (metrics.natureScore ?? 0) * natureWeight
    - seaBonus;
}

/** Bounds are enforced on the estimated ride, independently of ranking. */
export function meetsRideLimits(intent: RouteIntent, metrics: { durationSeconds: number; distanceMeters: number; repeatedPercent: number }): boolean {
  return (!intent.durationIsMaximum || metrics.durationSeconds <= (intent.durationHours ?? Infinity)*3600)
    && (!intent.distanceIsMaximum || metrics.distanceMeters <= (intent.distanceKm ?? Infinity)*1000)
    && metrics.durationSeconds >= (intent.minimumDurationHours ?? 0)*3600
    && metrics.distanceMeters >= (intent.minimumDistanceKm ?? 0)*1000
    && metrics.repeatedPercent <= (intent.maxRepeatedPercent ?? 100);
}
