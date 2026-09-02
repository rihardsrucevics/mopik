import { z } from "zod";

export const RouteIntentSchema = z.object({
  routeType: z.enum(["round_trip", "point_to_point"]).default("round_trip"),
  distanceKm: z.number().min(20).max(600).optional(),
  durationHours: z.number().min(0.5).max(16).optional(),
  difficulty: z.enum(["easy", "adventure", "hard"]).default("easy"),
  /** 0–100, how much unpaved/gravel the rider wants */
  gravelPreference: z.number().min(0).max(100).default(40),
  /** appetite for trail / single-track ("dotted line") segments */
  trailPreference: z.enum(["none", "some", "lots"]).default("none"),
  avoidMotorways: z.boolean().default(true),
  avoidMainRoads: z.boolean().default(false),
  returnToStart: z.boolean().default(true),
  /** rider wants to follow part of the TET (Trans Euro Trail) */
  includeTet: z.boolean().default(false),
});

export type RouteIntent = z.infer<typeof RouteIntentSchema>;

export type RoadClass = "road" | "track" | "trail";

export type SurfaceClass =
  | "asphalt"
  | "gravel"
  | "compacted"
  | "ground"
  | "dirt"
  | "sand"
  | "unknown";

export type RouteSegmentProperties = {
  roadClass: RoadClass;
  surface: SurfaceClass;
  trackGrade?: string;
  distanceMeters: number;
};

export type RouteMix = {
  roadPercent: number;
  trackPercent: number;
  trailPercent: number;
  roadKm: number;
  trackKm: number;
  trailKm: number;
};

export type SurfaceMix = {
  asphaltPercent: number;
  gravelPercent: number;
  dirtPercent: number;
  unknownPercent: number;
};

export type GeneratedRoute = {
  id: string;
  name: string;
  geometry: GeoJSON.LineString;
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties>;
  distanceMeters: number;
  durationSeconds: number;
  roadMix: RouteMix;
  surfaces: SurfaceMix;
  profile: string;
  /** false when the GraphHopper plan doesn't support custom models (free tier) */
  customModelApplied: boolean;
  seed: number;
  sourcePrompt: string;
  /** short label distinguishing this alternative, e.g. "TET northbound" */
  variant: string;
  /** set when the route follows a TET slice */
  tet?: { sectionName: string; sliceKm: number };
};

export type GenerateRouteResponse = {
  intent: RouteIntent;
  start: { lat: number; lon: number; label: string };
  destination?: { lat: number; lon: number; label: string };
  routes: GeneratedRoute[];
};
