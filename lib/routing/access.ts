import type { RoutePath } from "@/lib/types";

const POSITIVE = new Set(["yes", "designated"]);

/**
 * A generic OSM path is non-motorized by default. Only a mode-specific,
 * positive access tag makes it eligible for a motorcycle route. Keeping the
 * same rule outside the BRouter cost profile prevents an expensive forbidden
 * edge from slipping through when it is the only connection.
 */
export function isUnverifiedMotorPath(tags: Record<string, string> | undefined): boolean {
  if (tags?.highway !== "path") return false;
  return ![tags.motorcycle, tags.motor_vehicle, tags.vehicle].some((value) => value && POSITIVE.has(value));
}

export function hasUnverifiedMotorPath(path: RoutePath): boolean {
  return path.edges.some((edge) => isUnverifiedMotorPath(edge.tags));
}

/**
 * Ground that is beach rather than road.
 *
 * Riding *beside* the sea is the point — the rider wants the route to hug the
 * coast as closely as it can ("gar jūru braukt būtu izcili"). Riding *on* the
 * beach is the bug.
 *
 * Two things this is deliberately NOT, both settled by measurement on six
 * Baltic coastal legs with the Adventure profile (2026-09-14, PROGRESS.md):
 *
 *  - **Not `surface=sand` on its own.** Those legs rode 12.0 km of sand and
 *    only 2.8 km of it was anywhere near the sea; the rest was deep-forest
 *    sand track (`estimated_forest_class` 5–6, over 5 km inland) — exactly
 *    the Baltic riding the rider asks for. A blanket sand ban would have cost
 *    9.2 km of the right stuff to fix 2.8 km of the wrong stuff.
 *  - **Not proximity to the sea.** Being near the water is the goal, so
 *    nothing here or in the profile may price it.
 *
 * What actually carried the coastal problem was `highway=path` at the
 * shoreline — dune and beach footpaths mapped with `surface=ground`, `dirt`
 * or nothing at all, which `accessPolicy=allow_unverified` then permits.
 * 17.9 km of it across the coastal legs, 12.2 km on Jūrmala → Kolka alone.
 * That is priced by `shore_path_factor` in `moto-profile.ts` rather than
 * refused here, because the same tags on a river bank inland are a legitimate
 * forest path — and because refusing it drives the ride away from the coast.
 *
 * `smoothness=impassable|very_horrible` was tried here and measured out
 * again: refusing it cost Rīga → Ainaži a 20.6 km detour to avoid 1.8 km, and
 * the profile's existing multipliers already price it.
 *
 * This predicate must keep agreeing with `beach_like_path` in the profile;
 * they are the same rule stated twice, for the router and for the classifier.
 */
export function isBeachLikePath(tags: Record<string, string> | undefined): boolean {
  return tags?.highway === "path" && tags.surface === "sand";
}

export function hasBeachLikePath(path: RoutePath): boolean {
  return path.edges.some((edge) => isBeachLikePath(edge.tags));
}
