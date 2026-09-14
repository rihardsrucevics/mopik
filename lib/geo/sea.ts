import fs from "fs";
import path from "path";

/**
 * Where the sea is. Nearest-coastline distance for a point, loaded lazily per
 * country by the ride's own bounding box.
 *
 * Backlog item 11c, and it exists because of what item 11b measured:
 *
 * > From `lookups.dat` (BRouter 1.7.10), the file that defines every tag the
 * > cost script may read: there is a `waterway` key and **no `natural` key at
 * > all** — no `coastline`, no `water`, no `sea`.
 *
 * So the router structurally cannot prefer the coast, and
 * `estimated_river_class` — which item 11a used for the beach-path fix — is a
 * *river* signal that is blind to the Baltic. Probed directly onto roads that
 * are unarguably on the coast (the P111 at Jurkalne, the Pāvilosta seafront,
 * the Kolka cape road) every one reports class 1 or no class at all. The
 * distinction between "beside the sea" and "beside a river" therefore has to
 * come from coastline geometry, which is this module, and it can only be
 * applied where the app ranks candidates: `classify.ts` measures it,
 * `score.ts` ranks on it.
 *
 * ## Cost, measured before it was built (item 11b)
 *
 * The Baltic `natural=coastline` extract is 569,155 vertices, but
 * grid-deduplicated at ~200 m it is 31,594 points / 0.36 MB. Building the grid
 * is 177 ms once per process; scoring one 204 km route (3,891 shape points) is
 * 11 ms, about 0.4 s across a 36-candidate generation. That is what made a
 * runtime term affordable at all.
 *
 * ## Shape mirrors lib/geo/yards.ts and lib/geo/poi.ts deliberately
 *
 * `public/sea/index.json` lists countries with the 0.25° cells their coastline
 * occupies; `public/sea/<CC>.json` is parsed lazily, only when a route's own
 * bounding box touches one of those cells, then cached for the life of the
 * instance. Everything is **synchronous** for the same reason the POI and yard
 * loaders are: `classify.ts` runs inside the candidate loop and is not async.
 *
 * `next.config.ts` names `public/sea/` in `outputFileTracingIncludes` — a
 * `path.join(process.cwd(), …)` the serverless bundler cannot see through
 * otherwise.
 *
 * Built by `npx tsx scripts/build-coastline.ts LV LT EE`.
 */

/**
 * Lookup grid inside one country. ~11 km cells, matching `yards.ts`: a country
 * holds tens of thousands of points, so a few hundred per cell.
 */
const CELL_DEGREES = 0.1;

/** Must match `INDEX_CELL_DEGREES` in `scripts/build-coastline.ts`. */
const INDEX_CELL_DEGREES = 0.25;
const INDEX_VERSION = 1;

/**
 * The grid the dataset was thinned at, in metres. Reported by the index so a
 * mismatch is visible; the loader does not depend on the number, but a query
 * cannot be more precise than this and the scoring bands are chosen with it in
 * mind (the tightest is 1 km, five times this).
 */
export const DEDUPE_METERS = 200;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

export type SeaCountry = {
  cc: string;
  count: number;
  bbox: BBox;
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

type SeaIndexFile = {
  version: number;
  source: "overpass";
  cellDegrees: number;
  dedupeMeters: number;
  countries: SeaCountry[];
};

/**
 * The published file's shape — integer 1e5 deltas in one flat array, sorted by
 * latitude then longitude so the deltas stay small. Same reasoning as the
 * packed yard file: the per-feature GeoJSON scaffolding is many times the
 * payload, and this is parsed on a cold serverless invocation.
 */
type SeaFile = {
  country: string;
  dedupeMeters: number;
  deltas: number[];
};

const SEA_DIR = () => path.join(process.cwd(), "public", "sea");

type CountryData = {
  /** every coastline point, [lon, lat] */
  points: [number, number][];
  /** the same points bucketed into CELL_DEGREES cells */
  cells: Map<string, [number, number][]>;
};

let index: SeaCountry[] | null = null;
let cellOwners: Map<string, string[]> | null = null;
let indexMissing = false;
const loaded = new Map<string, CountryData>();
const bboxCountryCache = new Map<string, CountryData[]>();

/** Test seam: drop every cache so a test can publish a fixture and reload. */
export function resetSeaCache(): void {
  index = null;
  cellOwners = null;
  indexMissing = false;
  loaded.clear();
  bboxCountryCache.clear();
}

/** The countries the published index knows about. */
export function seaCountries(): SeaCountry[] {
  return loadIndex();
}

function loadIndex(): SeaCountry[] {
  if (index) return index;
  if (indexMissing) return [];

  const file = path.join(SEA_DIR(), "index.json");
  if (!fs.existsSync(file)) {
    // Absent data must not break routing — it means the sea term is 0
    // everywhere, which is exactly the behaviour before this feature existed.
    indexMissing = true;
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as SeaIndexFile;
    if (parsed.version !== INDEX_VERSION) {
      console.warn(
        `public/sea/index.json is version ${parsed.version}, this loader reads ` +
          `${INDEX_VERSION} — re-run \`npx tsx scripts/build-coastline.ts\`.`
      );
      indexMissing = true;
      return [];
    }
    const countries = parsed.countries ?? [];
    const owners = new Map<string, string[]>();
    for (const c of countries) {
      for (const cell of c.cells ?? []) {
        const list = owners.get(cell);
        if (list) list.push(c.cc);
        else owners.set(cell, [c.cc]);
      }
    }
    index = countries;
    cellOwners = owners;
  } catch (err) {
    console.warn(`public/sea/index.json is unreadable (${String(err)}) — no sea data.`);
    indexMissing = true;
    return [];
  }
  return index;
}

function loadCountry(cc: string): CountryData {
  const cached = loaded.get(cc);
  if (cached) return cached;

  const empty: CountryData = { points: [], cells: new Map() };
  const file = path.join(SEA_DIR(), `${cc}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`public/sea/${cc}.json missing though index.json lists it.`);
    loaded.set(cc, empty);
    return empty;
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as SeaFile;

  const points: [number, number][] = [];
  let lon = 0;
  let lat = 0;
  const deltas = raw.deltas ?? [];
  for (let i = 0; i + 1 < deltas.length; i += 2) {
    lon += deltas[i];
    lat += deltas[i + 1];
    points.push([lon / 1e5, lat / 1e5]);
  }

  const cells = new Map<string, [number, number][]>();
  for (const point of points) {
    const key = `${Math.floor(point[0] / CELL_DEGREES)}:${Math.floor(point[1] / CELL_DEGREES)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(point);
    else cells.set(key, [point]);
  }

  const data = { points, cells };
  loaded.set(cc, data);
  return data;
}

/** Which published countries hold coastline inside `bbox`. */
export function countriesForBBox(bbox: BBox): string[] {
  loadIndex();
  if (!cellOwners) return [];

  const minX = Math.floor(bbox[0] / INDEX_CELL_DEGREES);
  const maxX = Math.floor(bbox[2] / INDEX_CELL_DEGREES);
  const minY = Math.floor(bbox[1] / INDEX_CELL_DEGREES);
  const maxY = Math.floor(bbox[3] / INDEX_CELL_DEGREES);

  const hit = new Set<string>();
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      const owners = cellOwners.get(`${x},${y}`);
      if (owners) for (const cc of owners) hit.add(cc);
    }
  }
  return [...hit].sort();
}

function dataForBBox(bbox: BBox): CountryData[] {
  const key = [
    Math.floor(bbox[0] / INDEX_CELL_DEGREES),
    Math.floor(bbox[1] / INDEX_CELL_DEGREES),
    Math.floor(bbox[2] / INDEX_CELL_DEGREES),
    Math.floor(bbox[3] / INDEX_CELL_DEGREES),
  ].join(":");
  const cached = bboxCountryCache.get(key);
  if (cached) return cached;
  const data = countriesForBBox(bbox).map(loadCountry);
  bboxCountryCache.set(key, data);
  return data;
}

/**
 * How far out the ring search may go before giving up, in CELL_DEGREES cells.
 *
 * The runtime only asks "is this within 3 km of the sea", so a point 40 km
 * inland needs no exact answer — it needs a cheap one. Four cells is ~44 km at
 * Baltic latitudes, comfortably past every band the scoring uses, and the
 * search stops far earlier than that as soon as it has an answer it can prove
 * is the nearest.
 */
const MAX_RING = 4;

/** Metre-per-degree scale at one latitude. Derived per ride, never fixed:
 * `tet-coverage.ts` learned the hard way that `cos(57°)` is 26 % wrong in x by
 * the time a ride reaches Spain, which silently stops a metre tolerance
 * matching with no error anywhere. */
function metricScale(lat: number): { kx: number; ky: number } {
  return { kx: M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180), ky: M_PER_DEG_LAT };
}

/**
 * A coastline lookup bound to one route's own bounding box.
 *
 * Built once per candidate and asked per segment, exactly like `yardLookup`:
 * the country set and the metric frame are identical for every segment of one
 * route, and re-deriving them per segment is what made the POI loader slow
 * (measured there: 21 ms per call against 0.06 ms).
 */
export type SeaLookup = {
  /** how many coastline points are loadable for this box at all */
  size: number;
  /**
   * Metres to the nearest coastline point, or `Infinity` when nothing is
   * within `MAX_RING` cells. Accurate to the dataset's own 200 m grid.
   */
  distanceM: (lon: number, lat: number) => number;
};

const EMPTY_LOOKUP: SeaLookup = { size: 0, distanceM: () => Infinity };

export function seaLookup(bbox: BBox): SeaLookup {
  const countries = dataForBBox(bbox);
  if (!countries.length) return EMPTY_LOOKUP;

  const size = countries.reduce((n, c) => n + c.points.length, 0);
  if (!size) return EMPTY_LOOKUP;

  const scale = metricScale((bbox[1] + bbox[3]) / 2);

  /**
   * Rings of cells are searched outwards and the search stops as soon as the
   * best distance found is inside the ring already scanned — otherwise every
   * inland point would walk the whole grid. This is the same shape
   * `scripts/measure-coast.ts` uses for its own scoring, and it is what keeps
   * a 204 km route at 11 ms.
   */
  const distanceM = (lon: number, lat: number): number => {
    const ci = Math.floor(lon / CELL_DEGREES);
    const cj = Math.floor(lat / CELL_DEGREES);
    let best = Infinity;
    for (let r = 0; r <= MAX_RING; r++) {
      for (let x = ci - r; x <= ci + r; x++) {
        for (let y = cj - r; y <= cj + r; y++) {
          // Only the new ring: the inner cells were scanned on the last pass.
          if (r > 0 && x > ci - r && x < ci + r && y > cj - r && y < cj + r) continue;
          const key = `${x}:${y}`;
          for (const country of countries) {
            const bucket = country.cells.get(key);
            if (!bucket) continue;
            for (const [plon, plat] of bucket) {
              const dx = (plon - lon) * scale.kx;
              const dy = (plat - lat) * scale.ky;
              const d = dx * dx + dy * dy;
              if (d < best) best = d;
            }
          }
        }
      }
      if (best === Infinity) continue;
      // The ring just scanned guarantees everything within `r` cells has been
      // seen, so an answer inside that radius is final.
      const proven = r * CELL_DEGREES * Math.min(scale.kx, scale.ky);
      if (Math.sqrt(best) <= proven) break;
    }
    return Math.sqrt(best);
  };

  return { size, distanceM };
}

/** Bounding box of a routed line, for `seaLookup`. */
export function bboxOf(coordinates: [number, number][]): BBox {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [lon, lat] of coordinates) {
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/**
 * Whether any published country covers this box — the honesty question, and
 * the gate on the scoring term.
 *
 * `score.ts` only applies the sea term where this is true. Everywhere else the
 * term is 0 and ranking is byte-for-byte what it was before item 11c, which is
 * what makes an inland ride in a country with no coastline file provably
 * unchanged rather than merely unaffected in practice.
 */
export function hasSeaData(bbox: BBox): boolean {
  return countriesForBBox(bbox).length > 0;
}
