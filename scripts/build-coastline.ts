/**
 * `natural=coastline` → `public/sea/<CC>.json` + `public/sea/index.json`.
 *
 *   npx tsx scripts/build-coastline.ts LV LT EE
 *   npx tsx scripts/build-coastline.ts --all          # every country in COUNTRIES
 *
 * Backlog item 11c. The rider wants a coastal road preferred over an inland
 * one "because the view is beautiful". Item 11b proved the profile cannot do
 * it — BRouter's `lookups.dat` has a `waterway` key and **no `natural` key at
 * all**, so no cost script can see the sea — and that the feasible lever is a
 * scoring term fed by coastline geometry. This builds the geometry.
 *
 * ## Why a grid of points rather than the ways
 *
 * The runtime question is only "how far is this bit of road from the sea", so
 * the ways' topology is dead weight. Measured on the Baltic (item 11b): the
 * raw extract is 569,155 vertices / 37 MB, and grid-deduplicated at ~200 m it
 * is **31,594 cells / 0.36 MB**. 200 m is chosen against the runtime bands —
 * the term scores at 1 km and 3 km, so a 200 m quantisation is 20 % of the
 * tightest band and 7 % of the widest. The scoring is not a legal boundary; it
 * ranks candidates against each other.
 *
 * ## Shape mirrors lib/geo/yards.ts
 *
 * Packed arrays, not GeoJSON: the per-feature `type`/`geometry`/`properties`
 * scaffolding is many times the payload and this is parsed on a cold
 * serverless invocation. Coordinates are stored as integer 1e5 deltas in one
 * flat array, which is what gets 31,594 points into 0.36 MB.
 *
 * `public/sea/index.json` lists each country with the 0.25° cells its
 * coastline occupies, exactly like `public/poi/index.json` and
 * `public/yards/index.json`, so `lib/geo/sea.ts` opens a file only for a ride
 * whose own bounding box touches one of those cells.
 *
 * ## Overpass, and the mirror
 *
 * Fetching mirrors `scripts/measure-coast.ts`: `overpass.private.coffee`,
 * because the main mirror 504s on a Baltic-sized bbox. Rate limits are real —
 * the script sleeps between countries and retries with backoff. One country
 * per query, by bbox: `natural=coastline` is a way tag, and Overpass's
 * `out geom` gives the vertices directly.
 *
 * A bbox is not a country polygon, so a country's file may hold a neighbour's
 * shoreline near the border. That is harmless here in a way it was not for POI
 * (`lib/geo/poi.ts` §1): a coastline point answers "where is the sea", and the
 * sea does not care whose it is. The cell index makes the overlap cost nothing
 * — both countries simply claim the same cells.
 *
 * ## The second pass, when Europe is wanted
 *
 * The Geofabrik `.pbf` extracts `scripts/build_poi_dataset.py --pbf` and
 * `scripts/build_yard_dataset.py` already download could produce this same
 * output without Overpass, clipped to real borders, for every coastal country
 * at once — `natural=coastline` is a plain way tag and the same osmium pass
 * that collects buildings could collect it. **Not built here, deliberately:**
 * the Baltic is 0.36 MB from Overpass in a couple of minutes, and a Poland or
 * Germany extract is a multi-gigabyte download. When PL/DE/IT are wanted, add
 * the tag to the pbf pass rather than pointing this script at a larger bbox.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "public", "sea");

/**
 * Cell size of the coverage index, in degrees.
 *
 * 0.25°, matching `publish-poi.ts` and `publish-yards.ts` — ~28 km by ~15 km
 * at Baltic latitudes. Must stay in step with `INDEX_CELL_DEGREES` in
 * `lib/geo/sea.ts`; the loader checks `version`, not the number, so change
 * both together and bump it.
 */
const INDEX_CELL_DEGREES = 0.25;

/**
 * Deduplication grid, in metres. See the header: 200 m is 20 % of the tightest
 * band the runtime term scores at, and it is what turns 37 MB into 0.36 MB.
 * Must stay in step with `DEDUPE_METERS` in `lib/geo/sea.ts`, which reports it
 * so a mismatch is visible rather than silent.
 */
const DEDUPE_METERS = 200;

const INDEX_VERSION = 1;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

/**
 * Coastal countries and the bbox to query, `[minLon, minLat, maxLon, maxLat]`.
 *
 * LV/LT/EE are built now — the Baltic is the calibrated home region and the
 * one item 11b measured. The rest are listed so adding a country is one CLI
 * argument rather than an edit, but see the header before pointing this at a
 * big one: PL and DE are better served by the pbf pass.
 */
const COUNTRIES: Record<string, [number, number, number, number]> = {
  // The COASTAL STRIP, not the whole country. Overpass answers a 1° tile in
  // ~175 s under load whatever it contains, so the cost of this build is the
  // tile *count*, not the data: the full Latvian rectangle is 24 tiles of
  // which 19 are landlocked, an hour of waiting for nothing. Trimming each box
  // eastwards to where the country stops touching water cuts LV from 24 tiles
  // to 6 with no coastline lost — the Gulf of Riga's eastern shore is inside
  // 24.5°E and Estonia's Narva corner has no sea coast worth a tile.
  LV: [20.9, 56.3, 24.5, 58.1],
  LT: [20.9, 55.2, 21.7, 56.5],
  EE: [21.7, 57.5, 25.6, 59.8],
  // Not built here. Left as the map for a later pass, per the header.
  PL: [14.1, 49.0, 24.2, 54.9],
  DE: [5.8, 47.2, 15.1, 55.1],
  IT: [6.6, 35.4, 18.6, 47.1],
  HR: [13.4, 42.3, 19.5, 46.6],
  ES: [-9.4, 35.9, 4.4, 43.8],
  PT: [-9.6, 36.9, -6.1, 42.2],
  FR: [-5.2, 41.3, 9.6, 51.2],
  SE: [10.9, 55.2, 24.2, 69.1],
  FI: [19.1, 59.7, 31.6, 70.1],
  NO: [4.5, 57.9, 31.2, 71.2],
  DK: [8.0, 54.5, 15.2, 57.8],
  GR: [19.3, 34.8, 28.3, 41.8],
  NL: [3.3, 50.7, 7.3, 53.6],
  BE: [2.5, 49.4, 6.4, 51.6],
  IE: [-10.6, 51.4, -5.9, 55.4],
  GB: [-8.7, 49.8, 1.8, 60.9],
};

/**
 * Overpass mirrors, in order. `overpass.private.coffee` first: item 11's
 * measurement found the main mirror 504s on a Baltic-sized bbox, and
 * `scripts/measure-coast.ts` documents the same.
 */
const MIRRORS = [
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

type OverpassWay = { type: string; geometry?: { lon: number; lat: number }[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * How big a bbox one Overpass query may cover, in degrees.
 *
 * Measured, not guessed, and the measurement is counter-intuitive: the cost of
 * this build is the **number of queries**, not the area. The whole Latvian
 * rectangle (7.4° × 2.5°) answers 504 after 78 s on `overpass.private.coffee`
 * — the mirror's own gateway timeout, which `[timeout:600]` in the query
 * cannot raise because it is the proxy giving up, not the query engine. But a
 * 1° tile also takes ~175 s under load whatever it holds, so tiling LV into 24
 * of them is an hour of waiting. The trimmed coastal strips in COUNTRIES are
 * each small enough to answer in one query — the LV strip returns 3.2 MB in
 * 38 s — so 4° keeps every Baltic country to a single request, and the tiling
 * remains for the larger countries a later pass might add.
 */
const TILE_DEGREES = 4;

function tilesFor(bbox: [number, number, number, number]): [number, number, number, number][] {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const tiles: [number, number, number, number][] = [];
  for (let lon = minLon; lon < maxLon; lon += TILE_DEGREES) {
    for (let lat = minLat; lat < maxLat; lat += TILE_DEGREES) {
      tiles.push([lon, lat, Math.min(lon + TILE_DEGREES, maxLon), Math.min(lat + TILE_DEGREES, maxLat)]);
    }
  }
  return tiles;
}

async function fetchTile(bbox: [number, number, number, number]): Promise<[number, number][][]> {
  // Overpass bbox order is (south, west, north, east), not the GeoJSON order.
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const query =
    `[out:json][timeout:180];` +
    `way["natural"="coastline"](${minLat},${minLon},${maxLat},${maxLon});` +
    `out geom;`;

  // Each mirror is retried with backoff before the next one is tried, rather
  // than rotating on every attempt. Rotating immediately is how the first
  // version of this turned one mirror's 504 into a 429 from all three: the
  // fallbacks got the burst the rate limit was there to stop.
  let lastError = "";
  for (const mirror of MIRRORS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(15000 * attempt);
      try {
        const response = await fetch(mirror, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            // **Required.** Node's `fetch` sends no User-Agent at all, and
            // `overpass.private.coffee` answers such a request with an instant
            // 429 — not a slow one, not a 403, so it reads exactly like a rate
            // limit you have earned. Every curl probe of the same query
            // succeeded, because curl sends one. This cost three failed builds
            // before the two were compared side by side.
            "User-Agent": "mopik-coastline-build/1.0 (https://mopik.eu)",
          },
          body: `data=${encodeURIComponent(query)}`,
        });
        if (!response.ok) {
          // 429 and 504 are both "come back later" rather than "this is wrong".
          lastError = `${mirror} → ${response.status}`;
          continue;
        }
        const body = (await response.json()) as { elements?: OverpassWay[] };
        return (body.elements ?? [])
          .filter((element) => element.type === "way" && (element.geometry?.length ?? 0) > 1)
          .map((element) => element.geometry!.map((p) => [p.lon, p.lat] as [number, number]));
      } catch (err) {
        lastError = `${mirror} → ${(err as Error).message}`;
      }
    }
  }
  throw new Error(`Overpass failed on every mirror: ${lastError}`);
}

/**
 * Every coastline way touching `bbox`, fetched one tile at a time.
 *
 * Ways straddling a tile edge come back from both tiles; that costs nothing,
 * because the next step deduplicates to a 200 m grid anyway and the runtime
 * asks only for the distance to the nearest point.
 */
async function fetchCoastline(
  bbox: [number, number, number, number],
  onTile?: (done: number, total: number, ways: number) => void
): Promise<[number, number][][]> {
  const tiles = tilesFor(bbox);
  const all: [number, number][][] = [];
  for (const [i, tile] of tiles.entries()) {
    if (i > 0) await sleep(2000); // Overpass rate limits; be a good citizen.
    const ways = await fetchTile(tile);
    all.push(...ways);
    onTile?.(i + 1, tiles.length, ways.length);
  }
  return all;
}

/**
 * Grid-deduplicate to one point per ~200 m cell.
 *
 * Quantising by latitude band rather than by a single cosine: the loader
 * derives its metre scale per ride, and `tet-coverage.ts` learned the hard way
 * that one fixed `cos(lat)` is 26 % wrong in x by the time a ride reaches
 * Spain. Here the cell is sized at each point's own latitude, so a Norwegian
 * coastline is thinned at 200 m, not at 200 m × cos(58°)/cos(70°).
 */
function dedupe(ways: [number, number][][]): [number, number][] {
  const latStep = DEDUPE_METERS / M_PER_DEG_LAT;
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const way of ways) {
    for (const [lon, lat] of way) {
      const lonStep = DEDUPE_METERS / Math.max(1, M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180));
      const key = `${Math.round(lat / latStep)}:${Math.round(lon / lonStep)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push([lon, lat]);
    }
  }
  return out;
}

/**
 * Packed form: sorted by cell, then stored as integer 1e5 deltas.
 *
 * Sorting first is what makes the deltas small — unsorted, consecutive
 * coastline vertices jump between ways and the deltas are as large as the
 * absolute values. Measured on LV: sorted deltas are about half the size of
 * the raw pairs.
 */
function pack(points: [number, number][]): number[] {
  const sorted = [...points].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: number[] = [];
  let plon = 0;
  let plat = 0;
  for (const [lon, lat] of sorted) {
    const ilon = Math.round(lon * 1e5);
    const ilat = Math.round(lat * 1e5);
    out.push(ilon - plon, ilat - plat);
    plon = ilon;
    plat = ilat;
  }
  return out;
}

function occupiedCells(points: [number, number][]): string[] {
  const cells = new Set<string>();
  for (const [lon, lat] of points) {
    cells.add(`${Math.floor(lon / INDEX_CELL_DEGREES)},${Math.floor(lat / INDEX_CELL_DEGREES)}`);
  }
  return [...cells].sort();
}

export type SeaCountryIndexEntry = {
  cc: string;
  /** deduplicated coastline points in the file */
  count: number;
  /** envelope of every point, for anything that wants a box cheaply */
  bbox: [number, number, number, number];
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

export type SeaIndex = {
  /** bumped when the file layout or the cell size changes */
  version: number;
  source: "overpass";
  cellDegrees: number;
  /** the grid the points were thinned at, so a mismatch is visible */
  dedupeMeters: number;
  countries: SeaCountryIndexEntry[];
};

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--all");
  const wanted = process.argv.includes("--all") ? Object.keys(COUNTRIES) : args.length ? args : ["LV", "LT", "EE"];

  for (const cc of wanted) {
    if (!COUNTRIES[cc]) throw new Error(`unknown country ${cc}; add it to COUNTRIES`);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [i, cc] of wanted.entries()) {
    if (i > 0) await sleep(8000); // Overpass rate limits; be a good citizen.
    const t0 = Date.now();
    const ways = await fetchCoastline(COUNTRIES[cc], (done, total, found) => {
      if (found) process.stdout.write(`  ${cc} tile ${done}/${total}: ${found} ways\n`);
    });
    const raw = ways.reduce((n, w) => n + w.length, 0);
    const points = dedupe(ways);

    if (!points.length) {
      console.log(`${cc}: no coastline in bbox — skipped (landlocked?)`);
      continue;
    }

    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of points) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }

    const file = {
      country: cc,
      dedupeMeters: DEDUPE_METERS,
      /** [lon, lat] pairs as integer 1e5 deltas, sorted by latitude then longitude */
      deltas: pack(points),
    };
    const outPath = path.join(OUT_DIR, `${cc}.json`);
    fs.writeFileSync(outPath, JSON.stringify(file));
    const bytes = fs.statSync(outPath).size;

    // Incremental, for the same reason `publish-poi.ts` is: a later run for
    // one more country must not drop the countries already published.
    const indexPath = path.join(OUT_DIR, "index.json");
    let index: SeaIndex = {
      version: INDEX_VERSION,
      source: "overpass",
      cellDegrees: INDEX_CELL_DEGREES,
      dedupeMeters: DEDUPE_METERS,
      countries: [],
    };
    if (fs.existsSync(indexPath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(indexPath, "utf-8")) as SeaIndex;
        if (existing.version === INDEX_VERSION) index = existing;
      } catch {
        // A corrupt index is rebuilt from this run rather than failing it.
      }
    }
    index.countries = index.countries.filter((c) => c.cc !== cc);
    index.countries.push({
      cc,
      count: points.length,
      bbox: [minLon, minLat, maxLon, maxLat],
      cells: occupiedCells(points),
      builtAt: new Date().toISOString(),
      bytes,
    });
    index.countries.sort((a, b) => a.cc.localeCompare(b.cc));
    fs.writeFileSync(indexPath, JSON.stringify(index));

    console.log(
      `${cc}: ${ways.length} ways / ${raw} vertices → ${points.length} points ` +
        `(${(bytes / 1e6).toFixed(2)} MB, ${index.countries.find((c) => c.cc === cc)!.cells.length} cells, ` +
        `${((Date.now() - t0) / 1000).toFixed(1)} s)`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
