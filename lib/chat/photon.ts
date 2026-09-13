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
  properties: {
    name?: string; osm_key?: string; osm_value?: string; countrycode?: string;
    state?: string; county?: string; city?: string; district?: string;
    street?: string; housenumber?: string;
  };
};

/** Bigger places first when the names tie. */
const RANK: Record<string, number> = { city: 5, town: 4, village: 3, hamlet: 2, isolated_dwelling: 1 };

/**
 * What a rider may pick, in the order the list shows it.
 *
 * Settlements-only was the 2026-09-11 fix for "Valmiera" resolving to a
 * company office in Rīga. But a rider planning a ride also wants a specific
 * address, a fuel stop before the forest, or a landmark to ride past, so the
 * rule is now ordering rather than exclusion: a settlement always outranks a
 * railway platform of the same name. Only things a motorcycle can reach are
 * offered — an information board or a bus platform never is.
 */
const KIND_GROUP: Record<string, number> = {
  // 0 — settlements
  "place:city": 0, "place:town": 0, "place:village": 0, "place:hamlet": 0,
  "place:suburb": 0, "place:isolated_dwelling": 0, "place:municipality": 0, "place:locality": 0,
  // 1 — a street or house number the rider typed
  "highway:residential": 1, "highway:unclassified": 1, "highway:tertiary": 1, "highway:secondary": 1,
  "highway:primary": 1, "highway:trunk": 1, "highway:living_street": 1, "highway:track": 1,
  // 2 — places a rider stops at
  "amenity:fuel": 2, "amenity:charging_station": 2, "amenity:restaurant": 2, "amenity:cafe": 2,
  "amenity:parking": 2, "tourism:hotel": 2, "tourism:guest_house": 2, "tourism:camp_site": 2,
  // 3 — landmarks worth riding past
  "tourism:attraction": 3, "tourism:viewpoint": 3, "tourism:museum": 3,
  "historic:castle": 3, "historic:ruins": 3, "historic:manor": 3, "historic:monument": 3,
  "natural:peak": 3, "natural:beach": 3, "natural:water": 3, "waterway:waterfall": 3,
  "leisure:nature_reserve": 3, "boundary:national_park": 3, "boundary:protected_area": 3,
  "historic:archaeological_site": 3, "historic:fort": 3, "historic:church": 3,
  "historic:memorial": 3, "tourism:artwork": 3, "amenity:place_of_worship": 3,
  "natural:cave_entrance": 3, "natural:cliff": 3, "natural:spring": 3, "leisure:park": 3,
};

const KIND_LABELS: Record<string, string> = {
  "amenity:fuel": "degviela", "amenity:charging_station": "uzlāde", "amenity:restaurant": "ēstuve",
  "amenity:cafe": "kafejnīca", "amenity:parking": "stāvvieta", "tourism:hotel": "naktsmītne",
  "tourism:guest_house": "naktsmītne", "tourism:camp_site": "kempings", "tourism:attraction": "apskates vieta",
  "tourism:viewpoint": "skatu punkts", "tourism:museum": "muzejs", "historic:castle": "pils",
  "historic:ruins": "drupas", "historic:manor": "muiža", "historic:monument": "piemineklis",
  "natural:peak": "kalns", "natural:beach": "pludmale", "natural:water": "ūdens",
  "waterway:waterfall": "ūdenskritums", "leisure:nature_reserve": "dabas liegums",
  "boundary:national_park": "nacionālais parks", "boundary:protected_area": "aizsargājama teritorija",
  "historic:archaeological_site": "pilskalns", "historic:fort": "cietoksnis", "historic:church": "baznīca",
  "historic:memorial": "piemiņas vieta", "tourism:artwork": "objekts", "amenity:place_of_worship": "baznīca",
  "natural:cave_entrance": "ala", "natural:cliff": "klints", "natural:spring": "avots", "leisure:park": "parks",
};

/** Never offered: you cannot ride to a bench, a board or a bus platform. */
const EXCLUDED_KEYS = new Set(["information", "railway", "public_transport", "barrier", "entrance", "man_made", "power", "advertising", "office", "shop", "healthcare"]);

function kindOf(p: PhotonFeature["properties"]): { group: number; label: string } | null {
  const key = p.osm_key ?? "", value = p.osm_value ?? "";
  if (EXCLUDED_KEYS.has(key)) return null;
  const group = KIND_GROUP[`${key}:${value}`];
  // A house number is an address whatever the building happens to be tagged as.
  if (group === undefined) return p.housenumber ? { group: 1, label: "adrese" } : null;
  return { group, label: group === 0 ? "" : group === 1 ? "adrese" : KIND_LABELS[`${key}:${value}`] ?? "vieta" };
}

export type PlaceSuggestion = ResolvedPlace & {
  kind: string;
  /** "degviela", "pils", "adrese"… empty for a settlement. */
  kindLabel: string;
};

const cache = new Map<string, { at: number; places: PlaceSuggestion[] }>();

export async function searchPlaces(q: string): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const key = query.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const url = new URL(PHOTON);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "30");
  url.searchParams.set("bbox", BALTIC_BBOX);
  // No osm_tag filter any more: addresses, fuel stops and landmarks are
  // wanted too. KIND_GROUP below decides what is rideable and in what order,
  // so a settlement still outranks a railway platform of the same name.

  let features: PhotonFeature[] = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mopik/0.1 (adventure motorcycle route planner)" } });
    if (res.ok) features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
  } catch (err) {
    console.warn("place search failed:", err);
  }

  const seen = new Set<string>();
  const places: PlaceSuggestion[] = features
    .filter((f) => (f.properties.name || f.properties.street) && COUNTRIES.has(f.properties.countrycode ?? ""))
    .flatMap((f) => {
      const kind = kindOf(f.properties);
      if (!kind) return [];
      const q = f.properties;
      // An address carries no name of its own: "Brīvības iela 105, Rīga".
      const street = [q.street ?? q.name, q.housenumber].filter(Boolean).join(" ");
      const name = kind.group === 1 && street ? street : q.name ?? street;
      if (!name) return [];
      const where = q.city ?? q.district ?? q.county ?? q.state ?? "";
      const suffix = [kind.label, where && where !== name ? where : ""].filter(Boolean).join(" · ");
      return [{
        name, label: suffix ? `${name} · ${suffix}` : name,
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        kind: q.osm_value ?? "place", kindLabel: kind.label,
        group: kind.group, rank: RANK[q.osm_value ?? ""] ?? 0, lv: q.countrycode === "LV",
      }];
    })
    // Settlements first, then addresses, stops and landmarks; Latvia before
    // its neighbours; bigger places before smaller ones of the same name.
    .sort((a, b) => a.group - b.group || Number(b.lv) - Number(a.lv) || b.rank - a.rank)
    .filter((x) => {
      const k = `${x.label}|${x.lat.toFixed(4)}|${x.lon.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8)
    .map(({ name, label, lat, lon, kind, kindLabel }) => ({ name, label, lat, lon, kind, kindLabel }));

  cache.set(key, { at: Date.now(), places });
  return places;
}

/** The most likely place for a typed name, or null when Photon has nothing. */
export async function lookupPlace(name: string): Promise<PlaceSuggestion | null> {
  return (await searchPlaces(name))[0] ?? null;
}

// The pre-routing arithmetic lives in `feasibility.ts` (pure, shared with the
// client); re-exported here for the callers that reason about places.
export { estimateTransit } from "./feasibility";
