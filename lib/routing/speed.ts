import { haversineMeters } from "@/lib/geo/geometry";
import type { RouteIntent, RoutePath } from "@/lib/types";

/**
 * One speed model for planning and for what the rider is shown.
 *
 * Before this, two models disagreed: BRouter's `total-time` is a flat
 * ~45 km/h whatever the surface (measured 401 km / 534 min, 41 / 55, 58 / 77),
 * while the planner assumed 16-34 km/h. A 3 h request therefore targeted
 * 48 km and was displayed as "1h 17m". Neither matched a rider, who averages
 * roughly 35-40 km/h on mixed Latvian gravel including short stops.
 *
 * The figures here are moving speeds for a loaded adventure bike, by what the
 * OSM tags say the way is. They are a starting point to be calibrated
 * against ridden GPX tracks, which is why they sit in one place.
 */

/** km/h by way kind. */
const SPEED = {
  primary: 75,
  secondary: 70,
  tertiary: 62,
  asphaltMinor: 58, // unclassified / residential outside town, asphalt
  gravelRoad: 50, // unclassified + gravel, the classic Latvian grants ceļš
  compactedRoad: 55,
  street: 32, // residential / living_street / service: junctions, yards, 30 zones
  trackGrade1: 42,
  trackGrade2: 36,
  trackGrade3: 28,
  trackGrade4: 20,
  trackGrade5: 14,
  trackUntagged: 30,
  soft: 30, // ground / dirt / earth / grass
  sand: 18,
  mud: 14,
  trail: 15,
  unknown: 50,
} as const;

/** Seconds lost per junction turn (slow, look, accelerate). */
const TURN_PENALTY_S = 8;

const PAVED = new Set([
  "asphalt",
  "paved",
  "concrete",
  "concrete:plates",
  "paving_stones",
  "sett",
  "cobblestone",
  "chipseal",
  "metal",
  "wood",
]);
const STREETS = new Set(["residential", "living_street", "service"]);
const SOFT = new Set(["ground", "dirt", "earth", "grass", "unpaved", "pebblestone"]);
const ROUGH_SMOOTHNESS: Record<string, number> = {
  bad: 0.85,
  very_bad: 0.65,
  horrible: 0.45,
  very_horrible: 0.3,
  impassable: 0.3,
};

/** Moving speed for one way, from its OSM tags. */
export function waySpeedKmh(tags: Record<string, string>): number {
  const hw = tags.highway ?? "";
  const surface = tags.surface;
  let speed: number;

  if (surface === "sand") speed = SPEED.sand;
  else if (surface === "mud") speed = SPEED.mud;
  else if (hw === "track") {
    speed =
      tags.tracktype === "grade1"
        ? SPEED.trackGrade1
        : tags.tracktype === "grade2"
          ? SPEED.trackGrade2
          : tags.tracktype === "grade3"
            ? SPEED.trackGrade3
            : tags.tracktype === "grade4"
              ? SPEED.trackGrade4
              : tags.tracktype === "grade5"
                ? SPEED.trackGrade5
                : SPEED.trackUntagged;
    if (surface && SOFT.has(surface)) speed = Math.min(speed, SPEED.soft);
  } else if (["path", "footway", "cycleway", "bridleway"].includes(hw)) speed = SPEED.trail;
  else if (STREETS.has(hw)) speed = SPEED.street;
  else if (surface && SOFT.has(surface)) speed = SPEED.soft;
  else if (surface === "gravel" || surface === "fine_gravel") speed = SPEED.gravelRoad;
  else if (surface === "compacted") speed = SPEED.compactedRoad;
  else if (hw === "primary" || hw === "trunk" || hw === "motorway") speed = SPEED.primary;
  else if (hw === "secondary") speed = SPEED.secondary;
  else if (hw === "tertiary") speed = SPEED.tertiary;
  else if (surface && PAVED.has(surface)) speed = SPEED.asphaltMinor;
  else speed = SPEED.unknown;

  const rough = tags.smoothness ? ROUGH_SMOOTHNESS[tags.smoothness] : undefined;
  return rough ? speed * rough : speed;
}

/**
 * Riding time for a routed path, from its per-way tags plus a penalty per
 * junction turn. Falls back to a flat average when the router returned no
 * tag detail.
 */
export function estimateRideSeconds(path: RoutePath, turns: number): number {
  const coords = path.coordinates;
  if (path.edges.length === 0) {
    return Math.round((path.distanceMeters / 1000 / SPEED.unknown) * 3600);
  }

  let seconds = 0;
  let covered = 0;
  for (const edge of path.edges) {
    let meters = 0;
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = edge.beginShapeIndex + 1; i <= end; i++) {
      meters += haversineMeters(coords[i - 1], coords[i]);
    }
    covered += meters;
    seconds += (meters / 1000 / waySpeedKmh(edge.tags ?? {})) * 3600;
  }
  // Anything the edge list didn't cover (rare, at the ends) at the flat rate.
  const uncovered = Math.max(0, path.distanceMeters - covered);
  seconds += (uncovered / 1000 / SPEED.unknown) * 3600;

  return Math.round(seconds + turns * TURN_PENALTY_S);
}

/**
 * Planning average for turning a duration into a target distance, before
 * anything is routed. Derived from the same table: the more unpaved the
 * rider asks for, the closer the mix sits to gravel and track speeds. The
 * corrective routing pass then replaces this with the speed the region
 * actually delivers.
 */
export function plannedAvgSpeedKmh(intent: RouteIntent): number {
  const g = intent.gravelPreference / 100;
  // 0% unpaved: quiet asphalt with some streets; 100%: gravel roads and tracks.
  let speed = 58 - 20 * g;
  if (intent.difficulty === "hard") speed -= 8;
  if (intent.trailPreference === "lots") speed -= 5;
  else if (intent.trailPreference === "some") speed -= 2;
  return Math.round(Math.max(22, speed));
}
