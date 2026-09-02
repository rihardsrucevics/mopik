const GH_BASE = "https://graphhopper.com/api/1";

export type GeocodeResult = { lat: number; lon: number; label: string };

/**
 * Geocode a free-text location via the GraphHopper Geocoding API
 * (same API key as routing). Biased towards the Baltics.
 */
export async function geocode(query: string): Promise<GeocodeResult> {
  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) throw new Error("GRAPHHOPPER_API_KEY is not set");

  const url = new URL(`${GH_BASE}/geocode`);
  url.searchParams.set("q", query);
  url.searchParams.set("locale", "en");
  url.searchParams.set("limit", "5");
  // Bias results towards Latvia / the Baltics.
  url.searchParams.set("point", "56.9496,24.1052");
  url.searchParams.set("key", key);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const hits: Array<{ name: string; country?: string; point: { lat: number; lng: number } }> =
    data.hits ?? [];
  // The point bias alone is weak — "Cesis" without diacritics returns Ukraine
  // first. This is a Baltic product, so prefer Baltic hits explicitly.
  const BALTICS = new Set(["Latvia", "Lithuania", "Estonia"]);
  const hit = hits.find((h) => h.country && BALTICS.has(h.country)) ?? hits[0];
  if (!hit) throw new Error(`Location not found: "${query}"`);

  return {
    lat: hit.point.lat,
    lon: hit.point.lng,
    label: [hit.name, hit.country].filter(Boolean).join(", "),
  };
}
