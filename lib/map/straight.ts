import type { Point } from "@/lib/geo/geometry";
import { haversineMeters } from "@/lib/geo/geometry";
import type { RouteSegmentProperties } from "@/lib/types";
import { cumulative, lineMeters } from "@/lib/routing/detour";
import { connector, drawnSeconds } from "@/lib/routing/drawn";
import { nearestAlong, type RoutedRun, type EditRun } from "@/lib/routing/reroute-leg";

/**
 * „Vest pa taisno” (rider, 2026-09-28; the design's „Savienot taisni” /
 * `reach: "straight"`, docs/DESIGN-route-editing.md B3, C, D6): no road
 * reaches the point on any profile, and the rider wants it anyway. The ride
 * goes as far as a road goes toward it, then straight to it and back along
 * the same straight line — a stated, deliberate out-and-back, never a spur
 * Mopik made on its own.
 */

type Segments = GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
type Feature = Segments["features"][number];

/** The same features ridden the other way: order and every line reversed. */
export function reversed(features: Feature[]): Feature[] {
  return [...features].reverse().map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: [...f.geometry.coordinates].reverse() } }));
}

/**
 * The stretch to splice in at `join` (a point on the ride): the road the
 * router found from there toward the point (`road`, ending where the road
 * ends — or none, when the ride itself is nearest), the straight connector
 * to `point` and back, and the road back to `join`. As one zero-length run
 * at `join`, for `applyRuns`.
 */
export function straightRun(params: { line: Point[]; point: Point; road?: RoutedRun | null }): {
  run: EditRun;
  routed: RoutedRun;
  /** Straight metres one way — the connector from the road's end to the point. */
  straightMeters: number;
  /** Where the connector leaves the road. */
  from: Point;
} {
  const { line, point } = params;
  const cum = cumulative(line);
  const at = nearestAlong(point, line, cum);
  const roadFeatures = (params.road?.segments.features ?? []).filter((f) => f.geometry.coordinates.length >= 2);
  const roadLine = roadFeatures.flatMap((f) => f.geometry.coordinates as Point[]);
  // The road helps only if it ends nearer the point than the ride does.
  const roadEnd = roadLine.length ? roadLine[roadLine.length - 1] : null;
  const useRoad = Boolean(roadEnd && haversineMeters(roadEnd, point) + 1 < at.meters);
  const join: Point = useRoad ? (roadLine[0] as Point) : (pointAt(line, cum, at.alongMeters));
  const from: Point = useRoad ? (roadEnd as Point) : join;
  const out = connector(from, point);
  const back = connector(point, from);
  const way = useRoad ? roadFeatures : [];
  const features: Feature[] = [...way, out, back, ...reversed(way)];
  const straightMeters = out.properties.distanceMeters;
  const roadMeters = useRoad ? params.road!.distanceMeters : 0;
  const roadSeconds = useRoad ? params.road!.durationSeconds : 0;
  const joinAlong = useRoad ? nearestAlong(join, line, cum).alongMeters : at.alongMeters;
  return {
    run: { fromMeters: joinAlong, toMeters: joinAlong, points: [join, point, join] },
    routed: {
      segments: { type: "FeatureCollection", features },
      distanceMeters: Math.round(2 * roadMeters + 2 * straightMeters),
      durationSeconds: Math.round(2 * roadSeconds + drawnSeconds(2 * straightMeters)),
    },
    straightMeters,
    from,
  };
}

function pointAt(line: Point[], cum: number[], meters: number): Point {
  for (let i = 1; i < line.length; i++) {
    if (cum[i] >= meters) {
      const t = (meters - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1);
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
  }
  return line[line.length - 1];
}

/**
 * Where on the ride its drawn geometry lies, as metre intervals along
 * `segments` — the fixed stretches a later edit must not re-route (design C:
 * a straight leg is a fixed interval).
 */
export function drawnIntervals(segments: Segments): [number, number][] {
  const out: [number, number][] = [];
  let walked = 0;
  for (const f of segments.features) {
    const m = lineMeters(f.geometry.coordinates as Point[]);
    if (f.properties.drawn) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - walked) < 1) last[1] = walked + m;
      else out.push([walked, walked + m]);
    }
    walked += m;
  }
  return out;
}
