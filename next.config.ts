import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The route API reads the POI and TET datasets from /public with fs, which
  // the serverless bundler cannot see through path.join(process.cwd(), …).
  outputFileTracingIncludes: {
    "/api/generate-route": ["./public/poi-baltics.geojson", "./public/tet-lv.geojson"],
  },
};

export default nextConfig;
