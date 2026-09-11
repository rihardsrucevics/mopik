import { RouteIntent } from "@/lib/types";

/**
 * Valhalla `motorcycle` costing options per riding profile.
 * https://valhalla.github.io/valhalla/api/route/api-reference/
 *
 * `use_trails` is the one knob that matters for this product — Valhalla
 * documents it as "a rider's desire for adventure", where 0 avoids trails,
 * tracks, unclassified roads and bad surfaces, and 1 seeks them out.
 *
 * It is deliberately overloaded upstream: one value governs unpaved tolerance,
 * track/trail appetite AND a tendency to avoid major roads. So the app's
 * separate `gravelPreference` and `trailPreference` must be folded into a
 * single number rather than mapped to separate options — there are none.
 *
 * Valhalla has no equivalent of GraphHopper's track_type (GRADE1-5), so
 * difficulty can no longer penalise rough grades specifically; it only shifts
 * the base `use_trails` level.
 */

export type MotorcycleCostingOptions = {
  /** 0-1, appetite for tracks/trails/unpaved. Valhalla default is 0.0 */
  use_trails: number;
  /** 0-1, propensity to use highways. Valhalla default is 0.5 */
  use_highways: number;
  /** 0-1, propensity to use toll roads. Valhalla default is 0.5 */
  use_tolls?: number;
  /** km/h ceiling, 10-252 */
  top_speed?: number;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function buildCostingOptions(intent: RouteIntent): MotorcycleCostingOptions {
  // Base adventure level from difficulty.
  let useTrails =
    intent.difficulty === "hard" ? 0.85 : intent.difficulty === "adventure" ? 0.55 : 0.2;

  // Nudge by the gravel slider, centred on its 40% default.
  useTrails += (intent.gravelPreference - 40) / 200;

  // Explicit trail appetite adjusts the derived value — but because
  // `use_trails` also governs unpaved tolerance, "no single-track" must not
  // drag the rider back onto asphalt when they asked for lots of gravel.
  // Wanting gravel roads without trails is an ordinary adventure request.
  if (intent.trailPreference === "lots") {
    useTrails = Math.max(useTrails, 0.9);
  } else if (intent.trailPreference === "none") {
    const gravelFloor = intent.gravelPreference / 100;
    useTrails = Math.min(useTrails, Math.max(0.35, gravelFloor));
  }

  let useHighways = intent.avoidMotorways ? 0.05 : 0.5;
  if (intent.avoidMainRoads) useHighways = Math.min(useHighways, 0.1);

  return {
    use_trails: clamp01(useTrails),
    use_highways: clamp01(useHighways),
    // The Baltics are effectively toll-free; leave Valhalla's default.
    use_tolls: 0.5,
    top_speed: topSpeedFor(intent, clamp01(useTrails)),
  };
}

/**
 * The speed ceiling is what actually gets a route onto gravel — and it is
 * also physically honest, since nobody rides a loaded adventure bike at
 * 90 km/h down a forest track.
 *
 * Valhalla routes by TIME, so asphalt wins on speed almost regardless of
 * `use_trails`; capping the vehicle's speed removes that advantage. Measured
 * on five Baltic point pairs, share of unpaved distance:
 *
 *   pair         use_trails 1.0 alone   + top_speed 35   + top_speed 25
 *   Kekava                        20%              56%             82%
 *   Kuldiga                        3%              61%             72%
 *   Aluksne                        1%              68%             67%
 *   Sigulda                       35%              41%             41%
 *   Riga                          10%              13%             17%
 *
 * Note how little `use_trails` achieves on its own — it barely moved any pair
 * (an earlier single-pair test suggested otherwise and was misleading). Near
 * Riga even the cap does little, simply because there is scarce gravel there.
 */
function topSpeedFor(intent: RouteIntent, useTrails: number): number {
  // The surface request outranks the difficulty label: "easy" would otherwise
  // keep the 90 km/h ceiling and cancel out a high gravel setting entirely,
  // which is what happened when a prompt asked for maximum unpaved while the
  // difficulty control was still on Easy. Easy then means gentler capping,
  // not no capping.
  const wantsUnpaved = useTrails >= 0.6;
  if (intent.difficulty === "easy") return wantsUnpaved ? 45 : 90;
  const hard = intent.difficulty === "hard";
  if (useTrails >= 0.85) return hard ? 25 : 32;
  if (useTrails >= 0.6) return hard ? 32 : 38;
  return hard ? 38 : 45;
}

export function profileName(intent: RouteIntent): string {
  return intent.difficulty; // easy | adventure | hard
}
