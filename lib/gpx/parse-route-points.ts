import { z } from "zod";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { MAX_DETOUR_POIS } from "@/lib/routing/detour";
import type { GpxRoutePointOut } from "@/lib/gpx/generate-gpx";

/**
 * The Garmin route's anchors (`rideRoutePoints`), as `<rte>`. Validated on its
 * own, after the body: a malformed or oversized list costs the file its
 * `<rte>`, never the download — the `<trk>` and the `<wpt>`s are the ride, the
 * route is an extra a Garmin re-plans from. Over the cap it is dropped rather
 * than cut, because a route missing its last anchors ends somewhere the ride
 * does not.
 */
/**
 * The most anchors a ride can have: start, `MAX_STOPS` stops, finish (or the
 * repeated start), `MAX_SHAPE_POINTS` pass-through points — and the
 * `MAX_DETOUR_POIS` ticked sights, which the `<rte>` carries as vias too.
 */
export const MAX_ROUTE_POINTS = MAX_STOPS + MAX_SHAPE_POINTS + MAX_DETOUR_POIS + 2;

const RoutePointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  name: z.string().max(160).optional(),
  kind: z.enum(["via", "shape"]),
});
const RoutePointsSchema = z.array(RoutePointSchema).min(2).max(MAX_ROUTE_POINTS);

export function parseRoutePoints(raw: unknown): GpxRoutePointOut[] | undefined {
  const parsed = RoutePointsSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
