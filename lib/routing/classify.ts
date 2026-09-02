import { GraphHopperPath, PathDetailEntry } from "./graphhopper";
import {
  RoadClass,
  RouteMix,
  RouteSegmentProperties,
  SurfaceClass,
  SurfaceMix,
} from "@/lib/types";

/**
 * Classify GraphHopper path details into the adventure rider mental model:
 *   Road  = "solid line"  (normal public roads, paved OR gravel)
 *   Track = "dashed line" (highway=track — field/forest access roads)
 *   Trail = "dotted line" (highway=path & friends — single-track)
 *
 * Road class and surface are deliberately kept as SEPARATE concepts:
 * a gravel unclassified road is still a Road; an asphalt track is still a Track.
 */

const TRAIL_CLASSES = new Set(["path", "footway", "cycleway", "bridleway", "steps", "pedestrian"]);

function toRoadClass(value: string | number | null | undefined): RoadClass {
  const v = String(value ?? "").toLowerCase();
  if (v === "track") return "track";
  if (TRAIL_CLASSES.has(v)) return "trail";
  return "road";
}

function toSurfaceClass(value: string | number | null | undefined): SurfaceClass {
  const v = String(value ?? "").toLowerCase();
  if (["asphalt", "paved", "concrete", "paving_stones", "sett"].includes(v)) return "asphalt";
  if (["gravel", "fine_gravel", "pebblestone", "unpaved"].includes(v)) return "gravel";
  if (v === "compacted") return "compacted";
  if (["ground", "earth", "grass"].includes(v)) return "ground";
  if (["dirt", "mud"].includes(v)) return "dirt";
  if (v === "sand") return "sand";
  return "unknown";
}

function haversineMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const lat1 = (a[1] * Math.PI) / 180;
  const lat2 = (b[1] * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function detailValueAt(details: PathDetailEntry[] | undefined, index: number) {
  if (!details) return undefined;
  for (const [from, to, value] of details) {
    if (index >= from && index < to) return value;
  }
  return undefined;
}

export type ClassifiedRoute = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  roadMix: RouteMix;
  surfaces: SurfaceMix;
};

export function classifyRoute(path: GraphHopperPath): ClassifiedRoute {
  const coords = path.points.coordinates;
  const features: GeoJSON.Feature<GeoJSON.LineString, RouteSegmentProperties>[] = [];

  const distByRoad: Record<RoadClass, number> = { road: 0, track: 0, trail: 0 };
  const distBySurface: Record<"asphalt" | "gravel" | "dirt" | "unknown", number> = {
    asphalt: 0,
    gravel: 0,
    dirt: 0,
    unknown: 0,
  };

  let segStart = 0;
  let current: { roadClass: RoadClass; surface: SurfaceClass; trackGrade?: string } | null =
    null;

  const flush = (endIndex: number) => {
    if (!current || endIndex <= segStart) return;
    const slice = coords.slice(segStart, endIndex + 1);
    let meters = 0;
    for (let i = 1; i < slice.length; i++) meters += haversineMeters(slice[i - 1], slice[i]);

    features.push({
      type: "Feature",
      geometry: { type: "LineString", coordinates: slice },
      properties: { ...current, distanceMeters: Math.round(meters) },
    });

    distByRoad[current.roadClass] += meters;
    if (current.surface === "asphalt") distBySurface.asphalt += meters;
    else if (current.surface === "gravel" || current.surface === "compacted")
      distBySurface.gravel += meters;
    else if (["ground", "dirt", "sand"].includes(current.surface))
      distBySurface.dirt += meters;
    else distBySurface.unknown += meters;
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const roadClass = toRoadClass(detailValueAt(path.details?.road_class, i));
    const surface = toSurfaceClass(detailValueAt(path.details?.surface, i));
    const trackGradeRaw = detailValueAt(path.details?.track_type, i);
    const trackGrade = trackGradeRaw ? String(trackGradeRaw) : undefined;

    if (
      !current ||
      current.roadClass !== roadClass ||
      current.surface !== surface ||
      current.trackGrade !== trackGrade
    ) {
      flush(i);
      segStart = i;
      current = { roadClass, surface, trackGrade };
    }
  }
  flush(coords.length - 1);

  const total = distByRoad.road + distByRoad.track + distByRoad.trail || 1;
  const pct = (m: number) => Math.round((m / total) * 100);
  const km = (m: number) => Math.round(m / 100) / 10;

  return {
    segments: { type: "FeatureCollection", features },
    roadMix: {
      roadPercent: pct(distByRoad.road),
      trackPercent: pct(distByRoad.track),
      trailPercent: pct(distByRoad.trail),
      roadKm: km(distByRoad.road),
      trackKm: km(distByRoad.track),
      trailKm: km(distByRoad.trail),
    },
    surfaces: {
      asphaltPercent: pct(distBySurface.asphalt),
      gravelPercent: pct(distBySurface.gravel),
      dirtPercent: pct(distBySurface.dirt),
      unknownPercent: pct(distBySurface.unknown),
    },
  };
}
