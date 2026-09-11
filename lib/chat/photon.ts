import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Place lookup on Photon (komoot's OSM geocoder): settlements only, Baltic
 * countries only, Latvia first. Used by the form's picker and by the chat
 * when it needs coordinates to reason about a plan (how far is the focus
 * area from the start?) before anything is routed.
 */
const PHOTON = "https://photon.komoot.io/api/";
const BALTIC_BBOX = "20.9,53.8,28.3,59.7";
const COUNTRIES = new Set(["LV", "LT", "EE"]);
const CACHE_TTL_MS = 10 * 60 * 1000;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: { name?: string; osm_value?: string; countrycode?: string; state?: string; county?: string; city?: string };
};

/** Bigger places first when the names tie. */
const RANK: Record<string, number> = { city: 5, town: 4, village: 3, hamlet: 2, isolated_dwelling: 1 };

export type PlaceSuggestion = ResolvedPlace & { kind: string };

const cache = new Map<string, { at: number; places: PlaceSuggestion[] }>();

export async function searchPlaces(q: string): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const url = new URL(PHOTON);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "10");
  url.searchParams.set("bbox", BALTIC_BBOX);
  for (const tag of ["place:city", "place:town", "place:village", "place:hamlet"]) url.searchParams.append("osm_tag", tag);

  let features: PhotonFeature[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mopik/0.1 (adventure motorcycle route planner)" } });
    if (res.ok) features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
  } catch (err) {
    console.warn("place search failed:", err);
  }

  const seen = new Set<string>();
  const places: PlaceSuggestion[] = features
    .filter((f) => f.properties.name && COUNTRIES.has(f.properties.countrycode ?? ""))
    .sort(
      (a, b) =>
        Number(b.properties.countrycode === "LV") - Number(a.properties.countrycode === "LV") ||
        (RANK[b.properties.osm_value ?? ""] ?? 0) - (RANK[a.properties.osm_value ?? ""] ?? 0)
    )
    .map((f) => {
      const region = f.properties.county ?? f.properties.state ?? "";
      const name = f.properties.name!;
      return { name, label: region && region !== name ? `${name}, ${region}` : name, lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], kind: f.properties.osm_value ?? "place" };
    })
    .filter((p) => {
      const k = `${p.label}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 6);

  cache.set(key, { at: Date.now(), places });
  return places;
}

/** The most likely place for a typed name, or null when Photon has nothing. */
export async function lookupPlace(name: string): Promise<PlaceSuggestion | null> {
  return (await searchPlaces(name))[0] ?? null;
}

/**
 * Transit estimate before routing: straight line × a Latvian road factor at
 * the pace a transit actually averages once the city streets at the start
 * are counted (Rīga → Baldone routed at 46 km / 59 min). Good to about
 * ±20%, enough to tell a rider that two hours will not fit a transit each
 * way and a forest loop.
 */
export function estimateTransit(a: { lat: number; lon: number }, b: { lat: number; lon: number }): { km: number; hours: number } {
  const km = Math.hypot((a.lat - b.lat) * 111.32, (a.lon - b.lon) * 111.32 * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)) * 1.3;
  return { km: Math.round(km), hours: km / 48 };
}
