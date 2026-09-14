import fs from "fs";
import path from "path";

/**
 * Yard evidence — farmyard polygons, the buildings beside farm tracks, and the
 * gates on them. Loaded lazily by bounding box, grid-indexed for the spatial
 * questions `lib/routing/classify.ts` asks.
 *
 * Backlog item 12: routes run through private property, and sometimes that is
 * somebody's farmyard. `docs/private-property-options.md` measured why this
 * cannot be a profile change:
 *
 * - Across six rides, 187 route edges ran within 25 m of a building. Between
 *   them they carried **one** `motor_vehicle=destination`, two
 *   `access=permissive`, two `motor_vehicle=permissive` and one
 *   `motor_vehicle=yes`. Zero `private`, zero `no`. `noexit` on none.
 *   Respecting access tags was never going to solve this: **the tags are
 *   absent, not permissive**.
 * - All 33 ridden `highway=service` ways carried no `service=*` subtag, so the
 *   profile's existing `service=driveway` ban catches nothing.
 * - `building` and `landuse` are **not in BRouter's `lookups.dat`**, so a cost
 *   script structurally cannot see them; naming a key it does not know kills
 *   the whole profile with a bare 500.
 * - Overpass over one route's box took 40–90 s against a 60 s budget for the
 *   whole generation. On-the-fly lookup is not slow, it is larger than the
 *   request.
 *
 * ## Proximity is evidence, never the verdict
 *
 * The first version of this module answered "is a building within 25 m?" and
 * the router was penalised for yes. The rider rejected that:
 *
 *   "A house near the road does not make the road private. Only a road that
 *   goes THROUGH the yard does. I do not want the route changed because a
 *   house is 25 m from the road — private houses stand beside public roads
 *   all the time."
 *
 * He is right, and the investigation's own numbers say so: 100.4 km of the
 * 601 km measured lay within 25 m of a building, and most of it is ordinary
 * Latvian village gravel road — public, with houses along it. Banning that
 * would delete the country. So this module exposes the *evidence* and
 * `classify.ts` applies the passing-through rules to it:
 *
 *   (a) the edge lies inside a `landuse=farmyard`, or a small
 *       `landuse=residential`, polygon — OSM saying outright that this is a yard
 *   (b) buildings on **both sides** within ~20 m over a stretch — the drive
 *       between the house and the barn
 *   (c) the route enters and leaves the cluster by the same way — a dead end at
 *       somebody's door
 *   (d) a `barrier=gate|lift_gate|chain` node on the edge — the one explicit
 *       signal OSM does give
 *
 * ## Information only
 *
 * Nothing here ranks or rejects a route. `quality.yardKm` and the per-segment
 * `yard` flag become a RISKI row and a map badge, exactly the path
 * `unverifiedPathKm` already takes.
 *
 * ## Shape mirrors `lib/geo/poi.ts` deliberately
 *
 * `public/yards/index.json` lists countries with the 0.25° cells their data
 * occupies; `public/yards/<CC>.geojson` is parsed lazily, only when a route's
 * own bounding box touches one of those cells, then cached for the life of the
 * instance. Everything is **synchronous** for the same reason the POI loader is:
 * `classify.ts` runs inside the candidate loop and is not async.
 *
 * Built by `scripts/build_yard_dataset.py`, published by
 * `npx tsx scripts/publish-yards.ts`.
 */

/**
 * How close a building must be to count as evidence at all, in metres.
 *
 * Measured: of 125.9 km of `highway=track` ridden across the six rides, 7.8 %
 * lay within 25 m of a building and 26.7 % within 50 m. At Latvian homestead
 * scale the drive passes between the house and the barn, and 25 m from a
 * centroid is inside that. This is the collection radius, not the verdict —
 * see the rules above.
 */
export const YARD_RADIUS_M = 25;

/**
 * How close a building must be to count as being "on this side" of the way.
 *
 * Tighter than YARD_RADIUS_M because rule (b) is the strong claim — the route
 * is passing *between* two buildings — and a 25 m half-width would call a 50 m
 * gap a farmyard drive. 20 m each side is a 40 m corridor, which is about as
 * wide as a homestead yard gets before it is a field with houses at its edges.
 */
export const BOTH_SIDES_M = 20;

/** Lookup grid inside one country. ~11 km cells; a few thousand points per country. */
const CELL_DEGREES = 0.1;

/** Must match `INDEX_CELL_DEGREES` in `scripts/publish-yards.ts`. */
const INDEX_CELL_DEGREES = 0.25;
const INDEX_VERSION = 1;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

export type YardKind = "building" | "gate" | "yard";

export type YardPoint = {
  lon: number;
  lat: number;
  kind: "building" | "gate";
  /** which class of way put this point in the dataset */
  nearHighway: "track" | "service";
  country: string;
};

export type YardPolygon = {
  /** `farmyard`, or a `residential` polygon small enough to be one homestead */
  landuse: "farmyard" | "residential";
  /** closed outer ring, [lon, lat] */
  ring: [number, number][];
  /** how many collected buildings the ring holds — the smallness evidence */
  buildings: number;
  /** [minLon, minLat, maxLon, maxLat], precomputed for the grid walk */
  bbox: BBox;
  country: string;
};

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

export type YardCountry = {
  cc: string;
  count: number;
  buildings: number;
  gates: number;
  yards: number;
  bbox: BBox;
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

type YardIndexFile = {
  version: number;
  source: "geofabrik";
  cellDegrees: number;
  nearMeters: number;
  countries: YardCountry[];
};

const YARD_DIR = () => path.join(process.cwd(), "public", "yards");

type CountryData = {
  points: YardPoint[];
  polygons: YardPolygon[];
  pointCells: Map<string, YardPoint[]>;
  polygonCells: Map<string, YardPolygon[]>;
};

let index: YardCountry[] | null = null;
let cellOwners: Map<string, string[]> | null = null;
let indexMissing = false;
const loaded = new Map<string, CountryData>();

const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / CELL_DEGREES)}:${Math.floor(lat / CELL_DEGREES)}`;

/** Test seam: drop every cache so a test can publish a fixture and reload. */
export function resetYardCache(): void {
  index = null;
  cellOwners = null;
  indexMissing = false;
  loaded.clear();
  bboxCountryCache.clear();
}

/** The countries the published index knows about. */
export function yardCountries(): YardCountry[] {
  return loadIndex();
}

function loadIndex(): YardCountry[] {
  if (index) return index;
  if (indexMissing) return [];

  const file = path.join(YARD_DIR(), "index.json");
  if (!fs.existsSync(file)) {
    // Absent data must not break routing — it means no yard is ever reported,
    // which is exactly the behaviour before this feature existed.
    indexMissing = true;
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as YardIndexFile;
    if (parsed.version !== INDEX_VERSION) {
      console.warn(
        `public/yards/index.json is version ${parsed.version}, this loader reads ` +
          `${INDEX_VERSION} — re-run \`npx tsx scripts/publish-yards.ts\`.`
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
    console.warn(`public/yards/index.json is unreadable (${String(err)}) — no yard data.`);
    indexMissing = true;
    return [];
  }
  return index;
}

/**
 * The published file's shape — packed arrays, not GeoJSON features.
 *
 * Measured on Latvia: 248,488 buildings and 13,529 gates are 42.9 MB as
 * minified GeoJSON and **5.4 MB** as `[lon, lat, nearHighway]` triples. The
 * per-feature scaffolding is eight times the payload, and this is parsed on a
 * cold serverless invocation, so the scaffolding is the whole cost. Ids are
 * dropped with it: the runtime asks "is there a building here", never
 * "which one". Yard rings keep their coordinates — the shape is the
 * information.
 */
type YardFile = {
  country: string;
  nearMeters: number;
  /** [lon, lat, 0 = near a track | 1 = near a service way] */
  buildings: [number, number, number][];
  gates: [number, number, number][];
  yards: { landuse: string; buildings: number; ring: [number, number][] }[];
};

function loadCountry(cc: string): CountryData {
  const cached = loaded.get(cc);
  if (cached) return cached;

  const empty: CountryData = {
    points: [],
    polygons: [],
    pointCells: new Map(),
    polygonCells: new Map(),
  };
  const file = path.join(YARD_DIR(), `${cc}.geojson`);
  if (!fs.existsSync(file)) {
    console.warn(`public/yards/${cc}.geojson missing though index.json lists it.`);
    loaded.set(cc, empty);
    return empty;
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as YardFile;

  const points: YardPoint[] = [];
  for (const [lon, lat, hw] of raw.buildings ?? []) {
    points.push({ lon, lat, kind: "building", nearHighway: hw === 1 ? "service" : "track", country: cc });
  }
  for (const [lon, lat, hw] of raw.gates ?? []) {
    points.push({ lon, lat, kind: "gate", nearHighway: hw === 1 ? "service" : "track", country: cc });
  }

  const polygons: YardPolygon[] = [];
  for (const y of raw.yards ?? []) {
    const ring = y.ring ?? [];
    if (ring.length < 4) continue;
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const [lon, lat] of ring) {
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    polygons.push({
      landuse: y.landuse === "farmyard" ? "farmyard" : "residential",
      ring,
      buildings: y.buildings ?? 0,
      bbox: [minLon, minLat, maxLon, maxLat],
      country: cc,
    });
  }

  const pointCells = new Map<string, YardPoint[]>();
  for (const p of points) {
    const key = cellKey(p.lon, p.lat);
    const bucket = pointCells.get(key);
    if (bucket) bucket.push(p);
    else pointCells.set(key, [p]);
  }

  // A polygon is registered in every cell its bounding box touches, so a yard
  // straddling a cell edge is found from either side.
  const polygonCells = new Map<string, YardPolygon[]>();
  for (const poly of polygons) {
    const x0 = Math.floor(poly.bbox[0] / CELL_DEGREES);
    const x1 = Math.floor(poly.bbox[2] / CELL_DEGREES);
    const y0 = Math.floor(poly.bbox[1] / CELL_DEGREES);
    const y1 = Math.floor(poly.bbox[3] / CELL_DEGREES);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        const bucket = polygonCells.get(key);
        if (bucket) bucket.push(poly);
        else polygonCells.set(key, [poly]);
      }
    }
  }

  const data = { points, polygons, pointCells, polygonCells };
  loaded.set(cc, data);
  return data;
}

/** Which published countries hold yard data inside `bbox`. */
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

const bboxCountryCache = new Map<string, CountryData[]>();

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

/** Metre-per-degree scale at one latitude. Derived per route, never fixed:
 * `tet-coverage.ts` learned the hard way that `cos(57°)` is 26 % wrong in x by
 * the time a ride reaches Spain, which silently stops a metre tolerance
 * matching with no error anywhere. */
function metricScale(lat: number): { kx: number; ky: number } {
  return { kx: M_PER_DEG_LON_EQ * Math.cos((lat * Math.PI) / 180), ky: M_PER_DEG_LAT };
}

/** Metre distance from p to the segment a→b, in a local metric frame. */
export function segmentDistanceM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  scale: { kx: number; ky: number }
): number {
  const px = p[0] * scale.kx, py = p[1] * scale.ky;
  const ax = a[0] * scale.kx, ay = a[1] * scale.ky;
  const bx = b[0] * scale.kx, by = b[1] * scale.ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Which side of the directed segment a→b the point lies on, and how far.
 *
 * Signed perpendicular offset in metres: positive is left of travel, negative
 * right. This is what makes rule (b) — "buildings on both sides" — answerable,
 * and it is why proximity alone is not enough: a row of houses along one side
 * of a village road is all one sign, and a drive between a house and a barn is
 * both.
 */
export function signedOffsetM(
  p: [number, number],
  a: [number, number],
  b: [number, number],
  scale: { kx: number; ky: number }
): number {
  const px = p[0] * scale.kx, py = p[1] * scale.ky;
  const ax = a[0] * scale.kx, ay = a[1] * scale.ky;
  const bx = b[0] * scale.kx, by = b[1] * scale.ky;
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(px - ax, py - ay);
  return ((px - ax) * dy - (py - ay) * dx) / len * -1;
}

/** Ray casting; `ring` is a closed list of [lon, lat]. */
export function pointInRing(lon: number, lat: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat) {
      const x = xi + ((lat - yi) * (xj - xi)) / (yj - yi);
      if (lon < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * A yard lookup bound to one route's own bounding box.
 *
 * Built once per candidate and asked per segment: the country set and the cell
 * ranges are identical for every segment of one route, and re-deriving them per
 * segment is what made the POI loader slow (measured there: 21 ms per call
 * against 0.06 ms).
 */
export type YardLookup = {
  /** how many features are loadable for this box at all */
  size: number;
  /** the buildings within `radiusM` of segment a→b, with their signed side */
  buildingsAlong: (
    a: [number, number],
    b: [number, number],
    radiusM?: number
  ) => { point: YardPoint; offsetM: number }[];
  /** the farmyard/small-residential polygon containing this point, if any */
  yardAt: (lon: number, lat: number) => YardPolygon | null;
  /** gate nodes within `radiusM` of segment a→b */
  gatesAlong: (a: [number, number], b: [number, number], radiusM?: number) => YardPoint[];
};

const EMPTY_LOOKUP: YardLookup = {
  size: 0,
  buildingsAlong: () => [],
  yardAt: () => null,
  gatesAlong: () => [],
};

export function yardLookup(bbox: BBox): YardLookup {
  const countries = dataForBBox(bbox);
  if (!countries.length) return EMPTY_LOOKUP;

  const size = countries.reduce((n, c) => n + c.points.length + c.polygons.length, 0);
  if (!size) return EMPTY_LOOKUP;

  const scale = metricScale((bbox[1] + bbox[3]) / 2);

  const pointsInWindow = (
    minLon: number,
    minLat: number,
    maxLon: number,
    maxLat: number
  ): YardPoint[] => {
    const out: YardPoint[] = [];
    const x0 = Math.floor(minLon / CELL_DEGREES);
    const x1 = Math.floor(maxLon / CELL_DEGREES);
    const y0 = Math.floor(minLat / CELL_DEGREES);
    const y1 = Math.floor(maxLat / CELL_DEGREES);
    for (const country of countries) {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const bucket = country.pointCells.get(`${x}:${y}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  };

  const windowFor = (a: [number, number], b: [number, number], radiusM: number) => {
    const padLon = radiusM / Math.max(1, scale.kx);
    const padLat = radiusM / scale.ky;
    return [
      Math.min(a[0], b[0]) - padLon,
      Math.min(a[1], b[1]) - padLat,
      Math.max(a[0], b[0]) + padLon,
      Math.max(a[1], b[1]) + padLat,
    ] as const;
  };

  const buildingsAlong = (a: [number, number], b: [number, number], radiusM = YARD_RADIUS_M) => {
    const [minLon, minLat, maxLon, maxLat] = windowFor(a, b, radiusM);
    const out: { point: YardPoint; offsetM: number }[] = [];
    for (const point of pointsInWindow(minLon, minLat, maxLon, maxLat)) {
      if (point.kind !== "building") continue;
      if (segmentDistanceM([point.lon, point.lat], a, b, scale) > radiusM) continue;
      out.push({ point, offsetM: signedOffsetM([point.lon, point.lat], a, b, scale) });
    }
    return out;
  };

  const gatesAlong = (a: [number, number], b: [number, number], radiusM = YARD_RADIUS_M) => {
    const [minLon, minLat, maxLon, maxLat] = windowFor(a, b, radiusM);
    return pointsInWindow(minLon, minLat, maxLon, maxLat).filter(
      (point) =>
        point.kind === "gate" &&
        segmentDistanceM([point.lon, point.lat], a, b, scale) <= radiusM
    );
  };

  const yardAt = (lon: number, lat: number) => {
    const key = cellKey(lon, lat);
    for (const country of countries) {
      for (const poly of country.polygonCells.get(key) ?? []) {
        if (lon < poly.bbox[0] || lon > poly.bbox[2] || lat < poly.bbox[1] || lat > poly.bbox[3]) continue;
        if (pointInRing(lon, lat, poly.ring)) return poly;
      }
    }
    return null;
  };

  return { size, buildingsAlong, yardAt, gatesAlong };
}

/** Bounding box of a routed line, for `yardLookup`. */
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

/** Whether any published country covers this box — the honesty question. */
export function hasYardData(bbox: BBox): boolean {
  return countriesForBBox(bbox).length > 0;
}
