import { NextRequest, NextResponse } from "next/server";
import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Place suggestions for the ride form, from Photon (komoot's OSM geocoder).
 *
 * Why a picker at all: free-text geocoding of "Valmiera" or "Baldone" has to
 * guess between the city, a hamlet of the same name and a Belarusian village
 * with a similar one. Letting the rider pick from a short, labelled list —
 * settlements only, Baltic countries only — removes the guess, and the
 * coordinates travel with the plan so the API never geocodes the name again.
 *
 * Photon is free for fair use and understands Latvian names; requests are
 * debounced client-side and cached here for a while.
 */

const PHOTON = "https://photon.komoot.io/api/";
const BALTIC_BBOX = "20.9,53.8,28.3,59.7";
const COUNTRIES = new Set(["LV", "LT", "EE"]);
const CACHE_TTL_MS = 10 * 60 * 1000;

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    osm_value?: string;
    countrycode?: string;
    state?: string;
    county?: string;
    city?: string;
  };
};

/** Bigger places first when the names tie. */
const RANK: Record<string, number> = { city: 5, town: 4, village: 3, hamlet: 2, isolated_dwelling: 1 };

const cache = new Map<string, { at: number; places: ResolvedPlace[] }>();

export type PlaceSuggestion = ResolvedPlace & { kind: string };

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ places: [] });

  const hit = cache.get(q.toLowerCase());
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return NextResponse.json({ places: hit.places });

  const url = new URL(PHOTON);
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "10");
  url.searchParams.set("bbox", BALTIC_BBOX);
  for (const tag of ["place:city", "place:town", "place:village", "place:hamlet"]) {
    url.searchParams.append("osm_tag", tag);
  }

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
    // Latvia first (the product's home market), then bigger places first.
    .sort(
      (a, b) =>
        Number(b.properties.countrycode === "LV") - Number(a.properties.countrycode === "LV") ||
        (RANK[b.properties.osm_value ?? ""] ?? 0) - (RANK[a.properties.osm_value ?? ""] ?? 0)
    )
    .map((f) => {
      const region = f.properties.county ?? f.properties.state ?? "";
      const name = f.properties.name!;
      return {
        name,
        label: region && region !== name ? `${name}, ${region}` : name,
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        kind: f.properties.osm_value ?? "place",
      };
    })
    .filter((p) => {
      const key = `${p.label}|${p.lat.toFixed(2)}|${p.lon.toFixed(2)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);

  cache.set(q.toLowerCase(), { at: Date.now(), places });
  return NextResponse.json({ places });
}
