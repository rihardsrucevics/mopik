import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The route API reads the POI and TET datasets from /public with fs, which
  // the serverless bundler cannot see through path.join(process.cwd(), …).
  // POI is per country since 2026-09-14: the glob is what makes a country
  // published later (PL, DE, …) reach production without editing this file.
  outputFileTracingIncludes: {
    "/api/generate-route": [
      "./public/poi/index.json",
      "./public/poi/*.geojson",
      "./public/tet-lv.geojson",
      // Gates on tracks (backlog item 12), read by lib/geo/gates.ts the same
      // way. Same glob reasoning: a country published later reaches production
      // without editing this file.
      "./public/gates/index.json",
      "./public/gates/*.json",
      // Coastline (backlog item 11c), read by lib/geo/sea.ts the same way, so
      // `quality.coastKm` and the sea term in score.ts work in production.
      // Same glob reasoning again: PL, DE, IT published later need no edit here.
      "./public/sea/index.json",
      "./public/sea/*.json",
    ],
    // The suggestions endpoint reads the same dataset through route-pois.ts.
    "/api/route-pois": ["./public/poi/index.json", "./public/poi/*.geojson"],
  },
};

export default nextConfig;
