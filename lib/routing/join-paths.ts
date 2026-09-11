import type { RoutePath } from "@/lib/types";

/**
 * Several routed legs as one path: transit out, the loop, transit back. Edge
 * shape indices are shifted so per-way classification still lines up with
 * the coordinates, and a leg's first point is dropped when it repeats the
 * previous leg's last point.
 */
export function joinPaths(parts: RoutePath[]): RoutePath {
  const coordinates: [number, number][] = [];
  const elevations: (number | null)[] = [];
  const edges: RoutePath["edges"] = [];
  let distanceMeters = 0;
  let durationSeconds = 0;
  let hasElevation = false;
  for (const part of parts) {
    const dup = coordinates.length > 0 && part.coordinates.length > 0 &&
      coordinates[coordinates.length - 1][0] === part.coordinates[0][0] && coordinates[coordinates.length - 1][1] === part.coordinates[0][1];
    const skip = dup ? 1 : 0;
    const offset = coordinates.length - skip;
    coordinates.push(...part.coordinates.slice(skip));
    if (part.elevations) { hasElevation = true; elevations.push(...part.elevations.slice(skip)); }
    else elevations.push(...part.coordinates.slice(skip).map(() => null));
    for (const e of part.edges) edges.push({ ...e, beginShapeIndex: Math.max(0, e.beginShapeIndex + offset), endShapeIndex: e.endShapeIndex + offset });
    distanceMeters += part.distanceMeters;
    durationSeconds += part.durationSeconds;
  }
  return { coordinates, edges, distanceMeters, durationSeconds, ...(hasElevation ? { elevations } : {}) };
}
