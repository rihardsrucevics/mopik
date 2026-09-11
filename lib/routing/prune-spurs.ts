import type { RoutePath, RouteEdge } from "@/lib/types";
import { haversineMeters } from "@/lib/geo/geometry";

/** Remove exact out-and-back excursions, without inventing any road segment.
 * Only call for free loops without requested stops. An access corridor that
 * leads to a real circuit survives; A-B-C-B-A collapses but A-B-C-D-B-A does not.
 */
export function pruneSpurs(path: RoutePath): RoutePath {
  const coords = path.coordinates;
  if (coords.length < 3) return path;
  const same = (a: number, b: number) => coords[a][0] === coords[b][0] && coords[a][1] === coords[b][1];
  const kept: number[] = [];
  for (let i = 0; i < coords.length; i++) {
    if (kept.length && same(kept[kept.length - 1], i)) continue;
    if (kept.length >= 2 && same(kept[kept.length - 2], i)) kept.pop();
    else kept.push(i);
  }
  if (kept.length === coords.length) return path;
  if (kept.length < 4) throw new Error("Candidate contains no circuit after removing dead-end excursions");

  // Each surviving incoming segment retains the tags of its ORIGINAL edge.
  // After cancellation the previous coordinate is identical to its original
  // predecessor; no straight-line shortcut is introduced.
  const edgeAt = new Map<number, RouteEdge>();
  for (const edge of path.edges) {
    for (let i = edge.beginShapeIndex + 1; i <= edge.endShapeIndex; i++) edgeAt.set(i, edge);
  }
  const coordinates = kept.map(i => coords[i]);
  const elevations = path.elevations?.length === coords.length
    ? kept.map((index) => path.elevations![index])
    : undefined;
  const edges: RouteEdge[] = [];
  let meters = 0, originalMeters = 0;
  for (let i = 1; i < coords.length; i++) originalMeters += haversineMeters(coords[i-1], coords[i]);
  let previousSource: RouteEdge | undefined;
  for (let i = 1; i < kept.length; i++) {
    const source = edgeAt.get(kept[i]);
    const length = haversineMeters(coordinates[i-1], coordinates[i]);
    meters += length;
    const last = edges.at(-1);
    if (last && source === previousSource) {
      last.endShapeIndex = i;
      last.lengthKm = (last.lengthKm ?? 0) + length / 1000;
    } else {
      edges.push({ ...source, beginShapeIndex: i-1, endShapeIndex: i, lengthKm: length / 1000 });
    }
    previousSource = source;
  }
  const ratio = originalMeters > 0 ? meters / originalMeters : 1;
  return { coordinates, ...(elevations ? { elevations } : {}), edges, distanceMeters: path.distanceMeters * ratio, durationSeconds: path.durationSeconds * ratio };
}
