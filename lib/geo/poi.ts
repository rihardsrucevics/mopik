import fs from "fs";
import path from "path";
import { haversineMeters } from "./geometry";

/**
 * Places worth riding to, used to anchor generated loops.
 *
 * Routing to real OSM objects rather than to points on a circle is what keeps
 * via points on actual roads — a computed circle point lands in a lake or a
 * bog often enough to matter.
 *
 * ## Per country, from an index (2026-09-14)
 *
 * This used to read one `public/poi-baltics.geojson` built from Overpass
 * *bounding boxes*. Two things were wrong with that, and they are fixed
 * together because the fix for one is the fix for the other:
 *
 * 1. **The country label was the rectangle, not the country.** Overpass
 *    honours the bbox it is given, so 326 "LV" points sat south of Latvia
 *    (Klaipėda terminals, villages near Pskov, a ferry in Sweden), and a third
 *    of Lithuania was filed as LV because the LV rectangle was queried first
 *    and the shared thinning pass let it claim those points. `loop.ts` picks
 *    anchors by proximity and `hasPlaceData()` gates the honesty notice, so a
 *    Latvian loop could anchor on a village near Pskov. The Geofabrik `.pbf`
 *    extracts are clipped to the real country polygon, so `country` is now
 *    trustworthy — see `source: "geofabrik"` on every Poi.
 * 2. **Europe does not fit one file.** Phase 1 (LV LT EE PL DE CH AT IT SI) is
 *    ~39 MB and all of Europe ~161 MB, against 3.6 MB today. One file means a
 *    seconds-long `JSON.parse` on every cold serverless invocation, inside a
 *    wall-clock budget the app already cannot exceed.
 *
 * So: `public/poi/index.json` lists the countries with the 0.25° cells their
 * data occupies, and `public/poi/<CC>.geojson` is parsed **lazily, only when a
 * ride's own search area touches one of those cells**, then cached in module
 * memory for the life of the instance. A Latvian ride parses 0.92 MB instead
 * of 161 MB.
 *
 * The same mechanism becomes per-tile without another rewrite: the index
 * already names cells, and only `countriesForBBox` and `loadCountry` know that
 * the unit of loading is currently a whole country.
 *
 * ## Why cells rather than a bounding box per country
 *
 * Measured, not assumed. A `route=ferry` way's centroid sits in open water,
 * often at the far terminal, so Estonia's file holds points from lat 54.63 to
 * 60.21 and lon 19.07 to 28.41 — a box covering the entire Baltics. Every ride
 * anywhere would have parsed Estonia. Trimming the box to a percentile instead
 * throws away ~2 % of the points, and those turn out to be real border
 * villages rather than only sea ferries. The occupied-cell set is exact in
 * both directions and costs 6 KB for three countries (~89 KB for Europe).
 *
 * ## Why `fs`, still
 *
 * The files are read with `fs` from `process.cwd()/public/poi/`, exactly as
 * the single file was, because every export here is **synchronous** and its
 * callers (`loop.ts` inside a search loop, `route-pois.ts`, the generate-route
 * API) are written against that. `next.config.ts` names the directory in
 * `outputFileTracingIncludes`, which is what makes it visible to the
 * serverless bundler — a `path.join(process.cwd(), …)` it cannot see through
 * otherwise. Do not switch this to `fetch` of the public asset without making
 * the whole chain async first.
 *
 * Built by `scripts/build_poi_dataset.py --pbf` into `data/`, published by
 * `npx tsx scripts/publish-poi.ts`.
 */

export type PoiCategory =
  | "ferry"
  | "ford"
  | "tower"
  | "hillfort"
  | "lighthouse"
  | "waterfall"
  | "manor"
  | "viewpoint"
  | "mill"
  | "reserve"
  | "village";

export type Poi = {
  id: string;
  lon: number;
  lat: number;
  category: PoiCategory;
  /** how much of a detour this is worth, 1 (filler) to 10 (water crossing) */
  score: number;
  /**
   * ISO country code. Trustworthy since 2026-09-14: the point comes from a
   * Geofabrik extract clipped to the country polygon, not from a rectangle.
   */
  country: string;
  /**
   * Which build produced this point; only `geofabrik` is clipped to real
   * borders, so only `geofabrik` has a trustworthy `country`.
   *
   * Optional on the type, always set by the loader. Callers that construct a
   * `Poi` by hand — `scripts/route-pois.test.ts` builds fixtures — must keep
   * compiling; making this required would have been a breaking change to an
   * exported shape other work depends on.
   */
  source?: PoiSource;
  nameLv?: string;
  nameEn?: string;
  /** Latvian accusative, for "Caur {X}" route names */
  nameLvAcc?: string;
};

export type PoiSource = "geofabrik";

type PoiProperties = Omit<Poi, "lon" | "lat" | "source"> & { source?: PoiSource };

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

export type PoiCountry = {
  cc: string;
  count: number;
  /** envelope of the occupied cells — a cheap box, not the coverage authority */
  bbox: BBox;
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  /** cells holding something other than a sea centroid — what counts as covered */
  placeCells: string[];
  builtAt: string;
  bytes: number;
};

type PoiIndexFile = {
  version: number;
  source: PoiSource;
  cellDegrees: number;
  countries: PoiCountry[];
};

/** Coarse spatial index inside one country: a few thousand points don't warrant an R-tree. */
const CELL_DEGREES = 0.1;

/**
 * Cell size of the published coverage index, in degrees.
 *
 * 0.25° — ~28 km by ~15 km at Baltic latitudes. `scripts/publish-poi.ts` has
 * the measurements behind the choice; the short version is that at 1° a
 * Latvian ride near Sigulda parsed all three country files, because Estonian
 * ferry centroids in the Gulf of Riga share its coarse cells.
 *
 * Must match `INDEX_CELL_DEGREES` there; `INDEX_VERSION` is what makes a
 * mismatch loud rather than silently wrong.
 */
const INDEX_CELL_DEGREES = 0.25;
const INDEX_VERSION = 3;

/**
 * Slack around a country's covered cells, in degrees.
 *
 * A ride starting just outside the border still passes through the data, and
 * the old loader allowed exactly this much. Kept at the same values so the
 * `sparsePlaceData` notice does not change behaviour at borders that already
 * worked.
 */
const COVERAGE_SLACK_LAT = 1;
const COVERAGE_SLACK_LON = 1.5;

const POI_DIR = () => path.join(process.cwd(), "public", "poi");

type CountryData = { all: Poi[]; cells: Map<string, Poi[]> };

/**
 * Module-level caches, reused across warm serverless invocations.
 *
 * `index` is read once and is small (a few hundred bytes per country);
 * `loaded` holds only the countries some ride has actually touched.
 */
let index: PoiCountry[] | null = null;
/** cell key -> the countries whose files hold a point in it */
let cellOwners: Map<string, string[]> | null = null;
/** cells that hold a real place, not only a ferry centroid — coverage only */
let placeCells: Set<string> | null = null;
let indexMissing = false;
const loaded = new Map<string, CountryData>();
/**
 * The flattened all-countries array `loadPois()` hands out.
 *
 * Memoised because `route-pois.ts` calls it per request and the concatenation
 * is not free: rebuilding 13,450 entries on every call cost 66 ms against the
 * 60 ms budget `route-pois.test.ts` pins, where the single-file loader had
 * simply returned its own array. Invalidated whenever another country is
 * parsed, so a ride that widens the set still sees the new points.
 */
let allCache: Poi[] | null = null;

const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / CELL_DEGREES)}:${Math.floor(lat / CELL_DEGREES)}`;

const indexCellOf = (lonIndex: number, latIndex: number) => `${lonIndex},${latIndex}`;

/** The countries the published index knows about, with their cells and bbox. */
export function poiCountries(): PoiCountry[] {
  return loadIndex();
}

function loadIndex(): PoiCountry[] {
  if (index) return index;
  if (indexMissing) return [];

  const file = path.join(POI_DIR(), "index.json");
  if (!fs.existsSync(file)) {
    console.warn(
      "public/poi/index.json missing — run `npx tsx scripts/publish-poi.ts` " +
        "after `python3 scripts/build_poi_dataset.py --pbf`. Loops will fall " +
        "back to isochrone/geometric anchors without named stops."
    );
    indexMissing = true;
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as PoiIndexFile;
    if (parsed.version !== INDEX_VERSION) {
      // Better to route without named stops than to read cells at the wrong
      // size and quietly miss half a country.
      console.warn(
        `public/poi/index.json is version ${parsed.version}, this loader reads ` +
          `${INDEX_VERSION} — re-run \`npx tsx scripts/publish-poi.ts\`.`
      );
      indexMissing = true;
      return [];
    }
    const countries = parsed.countries ?? [];
    const owners = new Map<string, string[]>();
    const covered = new Set<string>();
    for (const c of countries) {
      for (const cell of c.cells ?? []) {
        const list = owners.get(cell);
        if (list) list.push(c.cc);
        else owners.set(cell, [c.cc]);
      }
      for (const cell of c.placeCells ?? []) covered.add(cell);
    }
    index = countries;
    cellOwners = owners;
    placeCells = covered;
  } catch (err) {
    console.warn(`public/poi/index.json is unreadable (${String(err)}) — no POI data.`);
    indexMissing = true;
    return [];
  }
  return index;
}

function loadCountry(cc: string): CountryData {
  const cached = loaded.get(cc);
  if (cached) return cached;

  const empty: CountryData = { all: [], cells: new Map() };
  const file = path.join(POI_DIR(), `${cc}.geojson`);
  if (!fs.existsSync(file)) {
    // The index said this country exists but the file is absent — a partial
    // publish. Cache the miss so a loop's ~17 candidates don't each stat it.
    console.warn(`public/poi/${cc}.geojson missing though index.json lists it.`);
    loaded.set(cc, empty);
    return empty;
  }

  const fc = JSON.parse(fs.readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection<
    GeoJSON.Point,
    PoiProperties
  >;

  const all: Poi[] = fc.features.map((f) => ({
    ...f.properties,
    // The file is the authority on which country these points are in — it was
    // clipped to that polygon. A stale `country` property in the data cannot
    // out-vote the filename.
    country: cc,
    source: f.properties.source ?? "geofabrik",
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  const cells = new Map<string, Poi[]>();
  for (const poi of all) {
    const key = cellKey(poi.lon, poi.lat);
    const bucket = cells.get(key);
    if (bucket) bucket.push(poi);
    else cells.set(key, [poi]);
  }

  const data = { all, cells };
  loaded.set(cc, data);
  allCache = null;
  return data;
}

/**
 * Which published countries hold data inside `bbox`.
 *
 * Exact: a country comes back only when one of its occupied cells intersects
 * the box, so a ride never parses a file whose points are all elsewhere.
 */
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
      const owners = cellOwners.get(indexCellOf(x, y));
      if (owners) for (const cc of owners) hit.add(cc);
    }
  }
  return [...hit].sort();
}

/**
 * Load (lazily, cached) every country holding data inside `bbox`.
 *
 * Memoised on the cell range, because `loop.ts` calls `poisNear` for every
 * bearing of every one of ~17 candidate shapes. Re-deriving the country set —
 * a Set, a sort and a Map lookup per cell — cost 21 ms per call against the
 * 0.06 ms the single-file loader managed; the work is identical for every
 * candidate around one start point, so it is done once.
 */
const bboxCountryCache = new Map<string, CountryData[]>();

function dataForBBox(bbox: BBox): CountryData[] {
  const key =
    `${Math.floor(bbox[0] / INDEX_CELL_DEGREES)}:${Math.floor(bbox[1] / INDEX_CELL_DEGREES)}:` +
    `${Math.floor(bbox[2] / INDEX_CELL_DEGREES)}:${Math.floor(bbox[3] / INDEX_CELL_DEGREES)}`;
  const cached = bboxCountryCache.get(key);
  if (cached) return cached;
  const data = countriesForBBox(bbox).map(loadCountry);
  bboxCountryCache.set(key, data);
  return data;
}

/**
 * Is this point somewhere the dataset actually covers?
 *
 * An index question now, not a scan of every POI: the point's own cell, or one
 * within the border slack, has to be occupied by some country. Two
 * consequences worth knowing —
 *
 *   - PL, DE and the rest start answering `true` the moment their files are
 *     published. Nothing here changes; the index grows.
 *   - Coverage follows `placeCells`, not every occupied cell. A `route=ferry`
 *     centroid sits in open water — Latvia's file reaches lon 10.86, off
 *     Germany — and those cells alone trail from Klaipėda across the Baltic.
 *     Counting them would have told a German ride it has place data, which is
 *     exactly the honesty this notice exists to provide.
 */
export function hasPlaceData(point: { lat: number; lon: number }): boolean {
  loadIndex();
  if (!placeCells || placeCells.size === 0) return false;

  const minX = Math.floor((point.lon - COVERAGE_SLACK_LON) / INDEX_CELL_DEGREES);
  const maxX = Math.floor((point.lon + COVERAGE_SLACK_LON) / INDEX_CELL_DEGREES);
  const minY = Math.floor((point.lat - COVERAGE_SLACK_LAT) / INDEX_CELL_DEGREES);
  const maxY = Math.floor((point.lat + COVERAGE_SLACK_LAT) / INDEX_CELL_DEGREES);

  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      if (placeCells.has(indexCellOf(x, y))) return true;
    }
  }
  return false;
}

/**
 * Every POI in every published country.
 *
 * Kept for `route-pois.ts`, which classifies a routed polyline and had no
 * bounding box to offer. Prefer `poisInBBox` where one is available: this
 * loads the whole published dataset, which is fine for the Baltics and will
 * not be once Europe lands.
 */
export function loadPois(): Poi[] {
  const countries = loadIndex();
  // `loadCountry` clears `allCache` when it parses a new file, so a cached
  // array is only reused while the loaded set is unchanged.
  for (const c of countries) loadCountry(c.cc);
  if (!allCache) allCache = countries.flatMap((c) => loaded.get(c.cc)?.all ?? []);
  return allCache;
}

/** Every POI in the countries whose files overlap `bbox`. Loads only those. */
export function poisInBBox(bbox: BBox): Poi[] {
  return dataForBBox(bbox).flatMap((d) => d.all);
}

/** POIs within `radiusMeters` of a point, nearest first. */
export function poisNear(
  point: { lat: number; lon: number },
  radiusMeters: number
): Poi[] {
  // Cell span needed to cover the radius at this latitude.
  const latSpan = radiusMeters / 111_320;
  const lonSpan = radiusMeters / (111_320 * Math.cos((point.lat * Math.PI) / 180) || 1);
  const cellsLat = Math.ceil(latSpan / CELL_DEGREES);
  const cellsLon = Math.ceil(lonSpan / CELL_DEGREES);

  // Only the countries this search circle can reach are parsed. A loop anchor
  // near Daugavpils touches LV and LT; one near Kuldīga touches LV alone.
  const searchBox: BBox = [
    point.lon - lonSpan,
    point.lat - latSpan,
    point.lon + lonSpan,
    point.lat + latSpan,
  ];
  const datasets = dataForBBox(searchBox);
  if (!datasets.length) return [];

  const baseLon = Math.floor(point.lon / CELL_DEGREES);
  const baseLat = Math.floor(point.lat / CELL_DEGREES);

  const found: { poi: Poi; distance: number }[] = [];
  for (const { cells } of datasets) {
    for (let dx = -cellsLon; dx <= cellsLon; dx++) {
      for (let dy = -cellsLat; dy <= cellsLat; dy++) {
        const bucket = cells.get(`${baseLon + dx}:${baseLat + dy}`);
        if (!bucket) continue;
        for (const poi of bucket) {
          const distance = haversineMeters([poi.lon, poi.lat], [point.lon, point.lat]);
          if (distance <= radiusMeters) found.push({ poi, distance });
        }
      }
    }
  }

  return found.sort((a, b) => a.distance - b.distance).map((f) => f.poi);
}

export function poiName(poi: Poi, locale: "lv" | "en"): string | undefined {
  return locale === "lv" ? (poi.nameLv ?? poi.nameEn) : (poi.nameEn ?? poi.nameLv);
}

/** Test seam: drop the module-level caches so a fixture directory is re-read. */
export function __resetPoiCache(): void {
  index = null;
  cellOwners = null;
  placeCells = null;
  allCache = null;
  bboxCountryCache.clear();
  indexMissing = false;
  loaded.clear();
}

/** Test seam: how many country files this instance has parsed. */
export function __loadedCountries(): string[] {
  return [...loaded.keys()].sort();
}
