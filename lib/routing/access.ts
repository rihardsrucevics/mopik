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

/** Beach routes in the reported Rīga–Ainaži GPX are mapped as sandy paths. */
export function isBeachLikePath(tags: Record<string, string> | undefined): boolean {
  return tags?.highway === "path" && tags.surface === "sand";
}

export function hasBeachLikePath(path: RoutePath): boolean {
  return path.edges.some((edge) => isBeachLikePath(edge.tags));
}
