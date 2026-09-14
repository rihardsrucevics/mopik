import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Place lookup on Photon (komoot's OSM geocoder). Used by the form's picker
 * and by the chat when it needs coordinates to reason about a plan (how far
 * is the focus area from the start?) before anything is routed.
 *
 * **Worldwide, biased rather than fenced.** This was Baltics-only — a bbox
 * plus a `{LV,LT,EE}` allowlist — which is why "Innsbruck" and "Warszawa"
 * returned nothing at all. The fence cannot simply go, though: Latvian case
 * forms depend on it. Measured without any bbox, "Cēsīm" returns Ćesim in
 * Bosnia and "Tukumu" returns Tukumunga in Papua New Guinea. So results are
 * *ranked* by distance from where the rider is instead, and the caller passes
 * that home point.
 */
const PHOTON = "https://photon.komoot.io/api/";
const PHOTON_REVERSE = "https://photon.komoot.io/reverse";
/** Where a rider is assumed to be until the app knows better. */
export const DEFAULT_HOME = { lat: 56.9496, lon: 24.1052 };
/**
 * A hit this far from home is almost certainly the geocoder reaching for a
 * same-spelled place on another continent, not what was typed. Generous
 * enough to plan a ride across Europe from the Baltics.
 */
const FAR_KM = 2500;
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

/**
 * The machine name of each kind, for the client to translate.
 *
 * These are *enum values*, never display text: the label a rider reads is
 * looked up per language in `lib/i18n/messages.ts` (`kind*` keys). This used
 * to hold Latvian words, which the API then baked into `label` too — so an
 * English or Lithuanian UI still read "adrese", and a Latvian word stored
 * with a recent place came back in whatever language the rider switched to.
 * A server that has no locale must not produce prose.
 */
const KIND_OF_TAG: Record<string, PlaceKind> = {
  "amenity:fuel": "fuel", "amenity:charging_station": "charging", "amenity:restaurant": "restaurant",
  "amenity:cafe": "cafe", "amenity:parking": "parking", "tourism:hotel": "hotel",
  "tourism:guest_house": "hotel", "tourism:camp_site": "campsite", "tourism:attraction": "attraction",
  "tourism:viewpoint": "viewpoint", "tourism:museum": "museum", "historic:castle": "castle",
  "historic:ruins": "ruins", "historic:manor": "manor", "historic:monument": "monument",
  "natural:peak": "peak", "natural:beach": "beach", "natural:water": "water",
  "waterway:waterfall": "waterfall", "leisure:nature_reserve": "natureReserve",
  "boundary:national_park": "nationalPark", "boundary:protected_area": "protectedArea",
  "historic:archaeological_site": "hillfort", "historic:fort": "fort", "historic:church": "church",
  "historic:memorial": "memorial", "tourism:artwork": "artwork", "amenity:place_of_worship": "church",
  "natural:cave_entrance": "cave", "natural:cliff": "cliff", "natural:spring": "spring",
  "leisure:park": "park",
};

/**
 * Every kind a suggestion can carry. `settlement` is the blank one — a city
 * or a village needs no word beside its name, because the name is the thing.
 */
export type PlaceKind =
  | "settlement" | "address" | "place"
  | "fuel" | "charging" | "restaurant" | "cafe" | "parking" | "hotel" | "campsite"
  | "attraction" | "viewpoint" | "museum" | "castle" | "ruins" | "manor" | "monument"
  | "peak" | "beach" | "water" | "waterfall" | "natureReserve" | "nationalPark"
  | "protectedArea" | "hillfort" | "fort" | "church" | "memorial" | "artwork"
  | "cave" | "cliff" | "spring" | "park";

/** Never offered: you cannot ride to a bench, a board or a bus platform. */
const EXCLUDED_KEYS = new Set(["information", "railway", "public_transport", "barrier", "entrance", "man_made", "power", "advertising", "office", "shop", "healthcare"]);

function kindOf(p: PhotonFeature["properties"]): { group: number; kind: PlaceKind } | null {
  const key = p.osm_key ?? "", value = p.osm_value ?? "";
  if (EXCLUDED_KEYS.has(key)) return null;
  const group = KIND_GROUP[`${key}:${value}`];
  // A house number is an address whatever the building happens to be tagged as.
  if (group === undefined) return p.housenumber ? { group: 1, kind: "address" } : null;
  return {
    group,
    kind: group === 0 ? "settlement" : group === 1 ? "address" : KIND_OF_TAG[`${key}:${value}`] ?? "place",
  };
}

export type PlaceSuggestion = ResolvedPlace & {
  /**
   * What sort of place this is, as a machine value the client translates
   * (`kind*` in `lib/i18n/messages.ts`). Never a word a rider reads: this
   * server has no locale, and the Latvian it used to return showed up
   * verbatim in the English and Lithuanian lists.
   */
  kind: PlaceKind;
};

/** Great-circle km; only used to rank and to cut off other continents. */
function distanceKm(home: { lat: number; lon: number }, [lon, lat]: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat - home.lat), dLon = toRad(lon - home.lon);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(home.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const cache = new Map<string, { at: number; places: PlaceSuggestion[] }>();

export async function searchPlaces(q: string, home = DEFAULT_HOME): Promise<PlaceSuggestion[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const key = `${query.toLowerCase()}|${home.lat.toFixed(1)},${home.lon.toFixed(1)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const url = new URL(PHOTON);
  url.searchParams.set("q", query);
  url.searchParams.set("limit", "30");
  // Bias, not a fence: Photon sorts by distance from this point but still
  // returns Innsbruck when Innsbruck is what was typed.
  url.searchParams.set("lat", String(home.lat));
  url.searchParams.set("lon", String(home.lon));
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
    // Anything with a name, anywhere — except the far-flung namesakes that a
    // Latvian case form drags in ("Cēsīm" → Ćesim, Bosnia).
    .filter((f) => (f.properties.name || f.properties.street) && distanceKm(home, f.geometry.coordinates) <= FAR_KM)
    .flatMap((f) => {
      const kind = kindOf(f.properties);
      if (!kind) return [];
      const q = f.properties;
      // An address carries no name of its own: "Brīvības iela 105, Rīga".
      const street = [q.street ?? q.name, q.housenumber].filter(Boolean).join(" ");
      const name = kind.group === 1 && street ? street : q.name ?? street;
      if (!name) return [];
      // A named POI needs its street: Rīga has a dozen Circle K, and
      // "Circle K · Rīga" is the same line for every one of them. The address
      // is what tells them apart, so it goes between the name and the town.
      // Addresses already carry theirs in `name`.
      //
      // The kind itself is deliberately *not* in this label any more. It used
      // to be, as a Latvian word, which is how "adrese" reached the English
      // and Lithuanian lists — and how it got stored, in Latvian, with every
      // recent place. The client renders the kind beside the label instead,
      // translated.
      const at = kind.group > 1 && street && street !== name ? street : "";
      const where = q.city ?? q.district ?? q.county ?? q.state ?? "";
      const suffix = [at, where && where !== name ? where : ""].filter(Boolean).join(" · ");
      return [{
        name, label: suffix ? `${name} · ${suffix}` : name,
        lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
        kind: kind.kind,
        group: kind.group, rank: RANK[q.osm_value ?? ""] ?? 0, distanceKm: distanceKm(home, f.geometry.coordinates),
      }];
    })
    // Settlements first, then addresses, stops and landmarks; Latvia before
    // its neighbours; bigger places before smaller ones of the same name.
    // Kind, then importance, then nearness. Sorting on distance before rank
    // was measured putting "Siguldas novads" above Sigulda and a hamlet called
    // Warszawa above the capital: the nearest thing with the right name is
    // rarely the one meant. Distance only separates equals — which is exactly
    // what "LV first" used to do, without assuming the rider is in Latvia.
    .sort((a, b) => a.group - b.group || b.rank - a.rank || a.distanceKm - b.distanceKm)
    .filter((x) => {
      const k = `${x.label}|${x.lat.toFixed(4)}|${x.lon.toFixed(4)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8)
    .map(({ name, label, lat, lon, kind }) => ({ name, label, lat, lon, kind }));

  cache.set(key, { at: Date.now(), places });
  return places;
}

/** The most likely place for a typed name, or null when Photon has nothing. */
export async function lookupPlace(name: string, home = DEFAULT_HOME): Promise<PlaceSuggestion | null> {
  return (await searchPlaces(name, home))[0] ?? null;
}

// The pre-routing arithmetic lives in `feasibility.ts` (pure, shared with the
// client); re-exported here for the callers that reason about places.
export { estimateTransit } from "./feasibility";


/**
 * Coordinates → the place they are in, for "Mana atrašanās vieta" in the form.
 *
 * The browser gives a point; a rider needs a name they recognise before
 * spending a generation on it. Photon's reverse endpoint answers with the same
 * feature shape as the search, so the label is built the same way — a rider
 * sees "Ķekava" or "Brīvības iela 105 · Rīga", not a pair of numbers.
 * Returns null rather than throwing: the caller falls back to typing.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<PlaceSuggestion | null> {
  const url = new URL(PHOTON_REVERSE);
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("limit", "1");
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mopik/0.1 (adventure motorcycle route planner)" } });
    if (!res.ok) return null;
    const features = ((await res.json()) as { features?: PhotonFeature[] }).features ?? [];
    const f = features[0];
    if (!f) return null;
    const q = f.properties;
    const street = [q.street ?? q.name, q.housenumber].filter(Boolean).join(" ");
    // A point in a field has no name of its own; the town it sits in is the
    // useful answer, so fall back through the administrative levels.
    const name = q.name ?? street ?? q.city ?? q.district ?? q.county ?? q.state ?? "";
    if (!name) return null;
    const where = q.city ?? q.district ?? q.county ?? q.state ?? "";
    return {
      name,
      label: where && where !== name ? `${name} · ${where}` : name,
      // The browser's point, not Photon's — the rider is standing here, and
      // the match is only there to give the place a name.
      lat, lon,
      // The rider is standing here; naming the spot is the whole job, and a
      // kind word beside their own location would say nothing.
      kind: "settlement" as const,
    };
  } catch (err) {
    console.warn("reverse geocode failed:", err);
    return null;
  }
}
