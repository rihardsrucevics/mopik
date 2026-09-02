import { CustomModel } from "./profiles";

const GH_BASE = "https://graphhopper.com/api/1";

export type PathDetailEntry = [number, number, string | number | null];

export type GraphHopperPath = {
  distance: number; // meters
  time: number; // milliseconds
  points: { type: "LineString"; coordinates: [number, number][] };
  details?: {
    road_class?: PathDetailEntry[];
    surface?: PathDetailEntry[];
    track_type?: PathDetailEntry[];
  };
};

export type RoundTripParams = {
  start: { lat: number; lon: number };
  distanceMeters: number;
  seed: number;
  customModel: CustomModel;
};

function requireKey(): string {
  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) {
    throw new Error(
      "GRAPHHOPPER_API_KEY is not set. Add it to .env.local (get a free key at graphhopper.com)."
    );
  }
  return key;
}

export type RoundTripResult = {
  path: GraphHopperPath;
  /** false when the API key's plan does not support custom models (free tier) */
  customModelApplied: boolean;
  seed: number;
};

// Free GraphHopper packages reject flexible mode; remember it per process
// so we stop retrying with a custom model on every request.
let flexibleModeSupported = true;

async function callRoute(body: Record<string, unknown>, key: string): Promise<Response> {
  return fetch(`${GH_BASE}/route?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * Round-trip route via the hosted GraphHopper Routing API.
 *
 * Custom models require flexible mode (ch.disable), which is not available
 * on free API keys — in that case we degrade to the plain car profile.
 * Round-trip point generation can also land in water ("Could not find a
 * valid point"); we retry with a fresh seed a few times.
 */
export async function fetchRoundTrip(params: RoundTripParams): Promise<RoundTripResult> {
  const key = requireKey();

  let seed = params.seed;
  let lastError = "";

  for (let attempt = 0; attempt < 4; attempt++) {
    const baseBody: Record<string, unknown> = {
      profile: "car",
      points: [[params.start.lon, params.start.lat]],
      algorithm: "round_trip",
      "round_trip.distance": params.distanceMeters,
      "round_trip.seed": seed,
      points_encoded: false,
      instructions: false,
      calc_points: true,
      elevation: false,
      locale: "en",
      details: ["road_class", "surface", "track_type"],
    };

    const useCustomModel = flexibleModeSupported;
    const body = useCustomModel
      ? { ...baseBody, "ch.disable": true, custom_model: params.customModel }
      : baseBody;

    const res = await callRoute(body, key);

    if (res.ok) {
      const data = await res.json();
      const path: GraphHopperPath | undefined = data.paths?.[0];
      if (!path) throw new Error("GraphHopper returned no route");
      return { path, customModelApplied: useCustomModel, seed };
    }

    lastError = await res.text();

    if (useCustomModel && /flexible mode/i.test(lastError)) {
      flexibleModeSupported = false;
      console.warn(
        "GraphHopper key does not support custom models (free plan); falling back to basic car profile."
      );
      continue; // retry same seed without custom model
    }

    if (/Could not find a valid point/i.test(lastError)) {
      seed = Math.floor(Math.random() * 1_000_000);
      continue; // round-trip point landed in water/off-road — new seed
    }

    throw new Error(`GraphHopper routing failed (${res.status}): ${lastError}`);
  }

  throw new Error(`GraphHopper routing failed after retries: ${lastError}`);
}

/**
 * Plain route through 2–5 points (free-plan limit), e.g. start → TET via
 * points → back to start. Same custom-model fallback as fetchRoundTrip.
 */
export async function fetchMultiPointRoute(params: {
  points: [number, number][]; // [lon, lat]
  customModel: CustomModel;
}): Promise<{ path: GraphHopperPath; customModelApplied: boolean }> {
  const key = requireKey();

  for (let attempt = 0; attempt < 2; attempt++) {
    const baseBody: Record<string, unknown> = {
      profile: "car",
      points: params.points,
      points_encoded: false,
      instructions: false,
      calc_points: true,
      elevation: false,
      locale: "en",
      details: ["road_class", "surface", "track_type"],
    };

    const useCustomModel = flexibleModeSupported;
    const body = useCustomModel
      ? { ...baseBody, "ch.disable": true, custom_model: params.customModel }
      : baseBody;

    const res = await callRoute(body, key);

    if (res.ok) {
      const data = await res.json();
      const path: GraphHopperPath | undefined = data.paths?.[0];
      if (!path) throw new Error("GraphHopper returned no route");
      return { path, customModelApplied: useCustomModel };
    }

    const text = await res.text();
    if (useCustomModel && /flexible mode/i.test(text)) {
      flexibleModeSupported = false;
      continue;
    }
    throw new Error(`GraphHopper routing failed (${res.status}): ${text}`);
  }

  throw new Error("GraphHopper routing failed");
}
