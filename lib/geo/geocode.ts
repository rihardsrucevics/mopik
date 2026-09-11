const GH_BASE = "https://graphhopper.com/api/1";

export type GeocodeResult = { lat: number; lon: number; label: string };

/** Latvia, Lithuania and Estonia, with a little sea around them. */
const BALTIC_BBOX = "20.9,53.8,28.3,59.7";
const BALTICS = new Set(["Latvia", "Latvija", "Lithuania", "Lietuva", "Estonia", "Eesti"]);

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

type Hit = { result: GeocodeResult; name: string; rank: number; isPlace: boolean; baltic: boolean };

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

async function query(q: string): Promise<Hit[]> {
  const key = process.env.GRAPHHOPPER_API_KEY;
  if (!key) throw new Error("GRAPHHOPPER_API_KEY is not set");

  const url = new URL(`${GH_BASE}/geocode`);
  url.searchParams.set("q", q);
  // Latvian locale returns Latvian spellings ("Cēsis", not "Cesis") and, with
  // the bounding box, resolves case forms like "Siguldā" and "Kuldīgu" that a
  // worldwide search sends abroad.
  url.searchParams.set("locale", "lv");
  url.searchParams.set("limit", "5");
  url.searchParams.set("bbox", BALTIC_BBOX);
  url.searchParams.set("point", "56.9496,24.1052");
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
    baltic: !!h.country && BALTICS.has(h.country),
  }));
}

const fold = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Geocode a free-text location via the GraphHopper Geocoding API, restricted
 * to the Baltics.
 *
 * A Latvian case form is tried alongside its likely nominatives, and an
 * exact-name settlement wins over the fuzzy first hit: on its own "Baldoni"
 * returns Baldoniškis (LT) and "Ogri" returns Ogriņi, while the candidate
 * "Baldone" / "Ogre" returns the town the rider meant.
 */
export async function geocode(input: string): Promise<GeocodeResult> {
  const q = input.trim();
  let fallback: Hit | null = null;
  let best: Hit | null = null;

  for (const candidate of latvianNominativeCandidates(q).slice(0, MAX_CANDIDATES)) {
    let hits: Hit[];
    try {
      hits = await query(candidate);
    } catch (err) {
      // Rate-limited or down: use whatever earlier forms found.
      if (best || fallback) break;
      throw err;
    }
    const exact = hits.find((h) => h.isPlace && h.baltic && fold(h.name) === fold(candidate));
    // A town beats a hamlet of the same name; stop early once a real town matches.
    if (exact && (!best || exact.rank > best.rank)) best = exact;
    if (best && best.rank >= SETTLEMENT_RANK.town) break;
    fallback ??=
      hits.find((h) => h.isPlace && h.baltic) ?? hits.find((h) => h.baltic) ?? hits[0] ?? null;
  }
  if (best) return best.result;
  if (fallback) return fallback.result;
  throw new Error(`Location not found: "${q}"`);
}
