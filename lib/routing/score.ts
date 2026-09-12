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
  return metrics.repeatedPercent * (intent.prioritizeLowOverlap ? 2 : 1)
    + (wantsUnpaved ? Math.max(0, 55 - metrics.unpavedPercent) : 0)
    + trailShortfall
    + (intent.preferForest ? Math.max(0, 100 - metrics.trackPercent - metrics.trailPercent) * 0.5 : 0)
    + metrics.excessDriftPercent
    + metrics.streetPercent * (intent.avoidTowns ? 1 : 0.3)
    - (metrics.natureScore ?? 0) * natureWeight;
}

/** Bounds are enforced on the estimated ride, independently of ranking. */
export function meetsRideLimits(intent: RouteIntent, metrics: { durationSeconds: number; distanceMeters: number; repeatedPercent: number }): boolean {
  return (!intent.durationIsMaximum || metrics.durationSeconds <= (intent.durationHours ?? Infinity)*3600)
    && (!intent.distanceIsMaximum || metrics.distanceMeters <= (intent.distanceKm ?? Infinity)*1000)
    && metrics.durationSeconds >= (intent.minimumDurationHours ?? 0)*3600
    && metrics.distanceMeters >= (intent.minimumDistanceKm ?? 0)*1000
    && metrics.repeatedPercent <= (intent.maxRepeatedPercent ?? 100);
}
