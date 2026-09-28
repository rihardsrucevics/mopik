import type { UiLocale } from "@/lib/i18n/locale";
import type { GpxWaypoint } from "@/lib/gpx/generate-gpx";
import { rideWaypoints, type RideWaypointPlace } from "@/lib/gpx/waypoints";
import { rideRoutePoints, type GpxRoutePoint } from "@/lib/gpx/route-points";
import { decodePlanPlaces, type SharedRoute } from "@/lib/share/route-code";

/**
 * The pins and the Garmin route (`<rte>`) a ride known only by its share
 * code can honestly put in its GPX — the shared page's download and the
 * saved-rides list's (a saved ride is its share code). One function for both,
 * so the two files cannot drift apart; before it, the saved list sent the
 * line alone, with no stops and no `<rte>` (release check, 2026-09-28).
 *
 * Less than the planner has, and deliberately so — a share code carries a
 * route, not a ride's full state — so each point is something the code says:
 *
 * - **The start** is always known: `share.points[0]` is where the line
 *   begins. Its *name* comes from the plan's resolved places when the code
 *   carries them (`pl`), else `share.startLabel`: links made before backlog
 *   26 (2026-09-25) carried the ride's first **stop** as `s`.
 * - **The stops** are the plan's resolved places after the start. A link
 *   made before `pl` existed decodes to none, and then the file claims
 *   nothing about stops it cannot name.
 * - **Sights** (the shared page's ticked detours) are passed in by the caller.
 *
 * The pins treat the ride as returning to its start — the shared page draws
 * no finish pin — so no red flag is guessed onto the last stop. The route
 * cannot assume that: its last point is where the device navigates to, and a
 * one-way ride sent back to its start is a wrong ride. So it reads the plan's
 * `returnToStart` when it says, the line's own ends (within 100 m) when it
 * does not; without `pl` only a closed line gets a route, and an open one
 * none rather than one that ends in the wrong place.
 */
export function sharedRideGpx(params: {
  share: SharedRoute;
  planCode: string | null;
  locale: UiLocale;
  sights?: RideWaypointPlace[];
  /** The exported track, `[lon, lat]` — the spliced one when sights are ticked. */
  line: readonly (readonly number[])[];
}): { waypoints: GpxWaypoint[]; routePoints: GpxRoutePoint[] | undefined } {
  const { share, planCode, locale, line } = params;
  const sights = params.sights ?? [];
  const planPlaces = planCode ? decodePlanPlaces(planCode) : [];
  const first = share.points[0];
  const last = share.points[share.points.length - 1];
  const start = { lat: first[1], lon: first[0] };
  const startPlace = { name: planPlaces[0]?.name ?? share.startLabel, label: planPlaces[0]?.label ?? share.startLabel, lat: start.lat, lon: start.lon };
  const stops = planPlaces.slice(1);

  const waypoints = rideWaypoints({ places: [startPlace, ...stops, ...sights], returnToStart: true, locale });

  const closed = Boolean(first && last)
    && Math.hypot((last[0] - first[0]) * Math.cos((first[1] * Math.PI) / 180), last[1] - first[1]) * 111_320 < 100;
  const loop = share.plan?.returnToStart === true || (share.plan?.returnToStart !== false && closed);
  const routePoints = !loop && planPlaces.length < 2
    ? undefined
    : rideRoutePoints({ places: [startPlace, ...stops], shapePoints: share.plan?.shapePoints, returnToStart: loop, locale, sights, line });
  return { waypoints, routePoints };
}
