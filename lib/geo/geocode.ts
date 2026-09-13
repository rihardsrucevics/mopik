import { lookupPlace } from "@/lib/chat/photon";

const GH_BASE = "https://graphhopper.com/api/1";

export type GeocodeResult = { lat: number; lon: number; label: string };

/**
 * Free-text geocoding is worldwide but anchored. The bounding box that used to
 * fence it to the Baltics is what made Latvian case forms work: measured
 * without one, "Cēsīm" returns Ćesim in Bosnia and "Tukumu" returns Tukumunga
 * in Papua New Guinea. A distance cut-off from the ride's own anchor does the
 * same job without deciding which continent a rider lives on.
 */
const FAR_KM = 2500;
export const DEFAULT_ANCHOR = { lat: 56.9496, lon: 24.1052 };

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Nominative candidates for a Latvian place name written in another case.
 *
 * Riders write "ap Cēsīm", "no Tukuma", "Siguldā", "līdz Valmierai". The
 * geocoder knows none of those forms: without help "Cēsīm" was Bosnia and
 * "Tukumu" Papua New Guinea. The LLM parser normalises when it runs; this is
 * the fallback for the heuristic path, and it is deliberately generous — the
 * geocoder decides which candidate is a real Baltic place.
 */
export function latvianNominativeCandidates(word: string): string[] {
  const out = new Set<string>([word]);
  const add = (stem: string, endings: string[]) => endings.forEach((e) => out.add(stem + e));
  const m = (re: RegExp) => re.exec(word);

  let r: RegExpExecArray | null;
  if ((r = m(/^(.+?)(ā|u|as|ai|ām)$/u))) add(r[1], ["a", "e", "s"]); // Sigulda, Baldone, Tukums
  if ((r = m(/^(.+?)(ē|es|ei|ēm|i)$/u))) add(r[1], ["e", "is", "s", "a"]); // Baldone, Ogre, Cēsis
  if ((r = m(/^(.+?)(īm|īs|ij|ī)$/u))) add(r[1], ["is", "e", "a"]); // Cēsis, Līgatne
  if ((r = m(/^(.+?)(os|iem|us|um)$/u))) add(r[1], ["i", "s", "a"]); // Ropaži, Tukums
  if ((r = m(/^(.+?)(as|s)$/u))) add(r[1], ["a", "e"]); // Rīgas -> Rīga
  return [...out];
}

type Hit = { result: GeocodeResult; name: string; rank: number; isPlace: boolean; near: boolean };

const SETTLEMENT_RANK: Record<string, number> = {
  city: 5,
  town: 4,
  municipality: 3,
  village: 2,
  hamlet: 1,
  isolated_dwelling: 1,
};

/** The free GraphHopper plan has a per-minute cap; one form is enough to stop on. */
const MAX_CANDIDATES = 4;

async function query(q: string, anchor: { lat: number; lon: number }): Promise<Hit[]> {
  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) throw new Error("GRAPHHOPPER_API_KEY is not set");

  const url = new URL(`${GH_BASE}/geocode`);
  url.searchParams.set("q", q);
  // Latvian locale returns Latvian spellings ("Cēsis", not "Cesis"). `point`
  // biases results toward the ride rather than fencing them: a bbox here is
  // what stopped "Innsbruck" resolving at all.
  url.searchParams.set("locale", "lv");
  url.searchParams.set("limit", "5");
  url.searchParams.set("point", `${anchor.lat},${anchor.lon}`);
  url.searchParams.set("key", key);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  const hits: Array<{
    name: string;
    country?: string;
    osm_key?: string;
    osm_value?: string;
    point: { lat: number; lng: number };
  }> = data.hits ?? [];

  return hits.map((h) => ({
    result: {
      lat: h.point.lat,
      lon: h.point.lng,
      label: [h.name, h.country].filter(Boolean).join(", "),
    },
    name: h.name,
    // city 4 … hamlet 1; used to prefer the town Baldone over the hamlet Baldoņi
    rank: SETTLEMENT_RANK[h.osm_value ?? ""] ?? 0,
    // Settlements over streets, buildings and water bodies named after them:
    // "Rīgas" must not become the cathedral or the Gulf of Riga.
    isPlace: h.osm_key === "place" || h.osm_key === "boundary",
    // "Near the ride", which is what `baltic` was really testing.
    near: distanceKm(anchor, { lat: h.point.lat, lon: h.point.lng }) <= FAR_KM,
  }));
}

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Geocode a free-text location via the GraphHopper Geocoding API, worldwide,
 * anchored near the ride being planned.
 *
 * A Latvian case form is tried alongside its likely nominatives, and an
 * exact-name settlement wins over the fuzzy first hit: on its own "Baldoni"
 * returns Baldoniškis (LT) and "Ogri" returns Ogriņi, while the candidate
 * "Baldone" / "Ogre" returns the town the rider meant.
 */
export async function geocode(input: string, anchor = DEFAULT_ANCHOR): Promise<GeocodeResult> {
  const q = input.trim();
  let fallback: Hit | null = null;
  let best: Hit | null = null;

  // Settlements first, from the same Photon lookup the form's picker uses,
  // ranked around the same anchor. GraphHopper's fuzzy search
  // put a "Valmiera" office in Rīga ahead of the city; a settlement whose
  // name matches the typed (or de-inflected) word is what a rider means.
  for (const candidate of latvianNominativeCandidates(q).slice(0, MAX_CANDIDATES)) {
    const hit = await lookupPlace(candidate, anchor).catch(() => null);
    if (hit && fold(hit.name) === fold(candidate)) return { lat: hit.lat, lon: hit.lon, label: hit.label };
  }

  for (const candidate of latvianNominativeCandidates(q).slice(0, MAX_CANDIDATES)) {
    let hits: Hit[];
    try {
      hits = await query(candidate, anchor);
    } catch (err) {
      // Rate-limited or down: use whatever earlier forms found.
      if (best || fallback) break;
      throw err;
    }
    const exact = hits.find((h) => h.isPlace && h.near && fold(h.name) === fold(candidate));
    // A town beats a hamlet of the same name; stop early once a real town matches.
    if (exact && (!best || exact.rank > best.rank)) best = exact;
    if (best && best.rank >= SETTLEMENT_RANK.town) break;
    fallback ??=
      hits.find((h) => h.isPlace && h.near) ?? hits.find((h) => h.near) ?? hits[0] ?? null;
  }
  if (best) return best.result;
  if (fallback) return fallback.result;
  throw new Error(`Location not found: "${q}"`);
}
