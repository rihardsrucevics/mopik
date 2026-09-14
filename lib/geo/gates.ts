import fs from "fs";
import path from "path";

/**
 * Gates on the road — the one explicit fact OSM gives about who controls a
 * track. Loaded lazily by bounding box, grid-indexed, and read synchronously by
 * `lib/routing/classify.ts` inside the candidate loop.
 *
 * ## Backlog item 12, second attempt — and why the first one is gone
 *
 * `docs/private-property-options.md` measured the problem (routes run through
 * somebody's farmyard) and found that OSM in rural Latvia records almost nothing
 * explicit: across six rides, 187 route edges ran within 25 m of a building and
 * between them carried **one** `motor_vehicle=destination`, two
 * `access=permissive`, two `motor_vehicle=permissive` and one
 * `motor_vehicle=yes` — zero `private`, zero `no`. So the first build shipped
 * buildings, farmyard polygons and small residential polygons, and inferred a
 * yard from buildings on both sides, from polygon containment, and from
 * dead-ending at a cluster.
 *
 * The rider refused the approach, not the thresholds:
 *
 *   "šī pieeja nav korekta — mēs nevaram minēt; vairumā gadījumu tur nebūs
 *   ierobežojuma; ja mums nav datu par privātajiem ceļiem, labāk šo ceļu no
 *   maršruta neizslēgt. Sākam vismaz ar vārtiem."
 *
 * We cannot guess. In most cases there is no restriction there, and with no data
 * about private roads it is better to leave the road in the route than to take
 * it out. Start with gates.
 *
 * The numbers had already said the same thing: Latvia's first build found
 * **248,488 buildings** within 25 m of a track or service way, 90 % of them
 * beside a `service` way, 16 % of the file inside a box around greater Rīga —
 * apartment blocks beside parking access roads. Every inference resting on that
 * is a guess about property rights read off a building footprint.
 *
 * ## What is left, and what it means
 *
 * One fact: a `barrier=gate|lift_gate|swing_gate|chain|bollard|cattle_grid`
 * **node that is a member of** a `highway=track|service|unclassified` way. Not
 * near it — on it, in the way's own node list, which is OSM stating that this
 * gate is across this road. `barrier=kerb` is excluded: a kerb is street
 * furniture, not access control.
 *
 * **Nothing here changes a route.** No cost, no penalty, no rejection. It is
 * counted and shown — "Vārti uz ceļa · N", and a small map marker later. A gate
 * on a Latvian forest track stands open more often than not, which is precisely
 * why it is reported rather than avoided.
 *
 * ## Shape mirrors `lib/geo/poi.ts` deliberately
 *
 * `public/gates/index.json` lists countries with the 0.25° cells their data
 * occupies; `public/gates/<CC>.json` is parsed lazily, only when a route's own
 * bounding box touches one of those cells, then cached for the life of the
 * instance. Everything is **synchronous** for the same reason the POI loader is:
 * `classify.ts` is not async.
 *
 * Built by `scripts/build_gates_dataset.py`, published by
 * `npx tsx scripts/publish-gates.ts`.
 */

/**
 * Default radius, in metres, for "is there a gate on this stretch".
 *
 * A gate is a node of the way, so it lies on the routed line by construction —
 * this radius absorbs the difference between the way's geometry and BRouter's
 * returned shape (rounding to 5 decimals is ~1 m, and the router may report a
 * simplified line), not any spatial guessing. 15 m is generous for that and far
 * too small to reach a gate on the next road.
 */
export const GATE_RADIUS_M = 15;

/** Lookup grid inside one country. ~11 km cells; a few thousand points per country. */
const CELL_DEGREES = 0.1;

/** Must match `INDEX_CELL_DEGREES` in `scripts/publish-gates.ts`. */
const INDEX_CELL_DEGREES = 0.25;
const INDEX_VERSION = 1;

const M_PER_DEG_LAT = 110540;
const M_PER_DEG_LON_EQ = 111320;

/** The barrier values collected. Order matches the build script's packed index. */
export const BARRIER_KINDS = [
  "gate",
  "lift_gate",
  "swing_gate",
  "chain",
  "bollard",
  "cattle_grid",
] as const;
export type BarrierKind = (typeof BARRIER_KINDS)[number];

/** The way classes a gate is collected on. Order matches the packed index. */
export const GATE_HIGHWAYS = ["track", "service", "unclassified"] as const;
export type GateHighway = (typeof GATE_HIGHWAYS)[number];

export type Gate = {
  lon: number;
  lat: number;
  /** what kind of barrier OSM says it is */
  barrier: BarrierKind;
  /** the class of way it sits on */
  highway: GateHighway;
  country: string;
};

/** [minLon, minLat, maxLon, maxLat] */
export type BBox = [number, number, number, number];

export type GateCountry = {
  cc: string;
  count: number;
  /** how many of each barrier value, so a build's shape is visible in the index */
  byBarrier: Partial<Record<BarrierKind, number>>;
  byHighway: Partial<Record<GateHighway, number>>;
  bbox: BBox;
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

type GateIndexFile = {
  version: number;
  source: "geofabrik";
  cellDegrees: number;
  countries: GateCountry[];
};

const GATE_DIR = () => path.join(process.cwd(), "public", "gates");

type CountryData = {
  gates: Gate[];
  cells: Map<string, Gate[]>;
};

let index: GateCountry[] | null = null;
let cellOwners: Map<string, string[]> | null = null;
let indexMissing = false;
const loaded = new Map<string, CountryData>();

const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / CELL_DEGREES)}:${Math.floor(lat / CELL_DEGREES)}`;

/** Test seam: drop every cache so a test can publish a fixture and reload. */
export function resetGateCache(): void {
  index = null;
  cellOwners = null;
  indexMissing = false;
  loaded.clear();
  bboxCountryCache.clear();
}

/** The countries the published index knows about. */
export function gateCountries(): GateCountry[] {
  return loadIndex();
}

function loadIndex(): GateCountry[] {
  if (index) return index;
  if (indexMissing) return [];

  const file = path.join(GATE_DIR(), "index.json");
  if (!fs.existsSync(file)) {
    // Absent data must not break routing — it means no gate is ever reported,
    // which is exactly the behaviour before this feature existed.
    indexMissing = true;
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as GateIndexFile;
    if (parsed.version !== INDEX_VERSION) {
      console.warn(
        `public/gates/index.json is version ${parsed.version}, this loader reads ` +
          `${INDEX_VERSION} — re-run \`npx tsx scripts/publish-gates.ts\`.`
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
    console.warn(`public/gates/index.json is unreadable (${String(err)}) — no gate data.`);
    indexMissing = true;
    return [];
  }
  return index;
}

/**
 * The published file's shape — packed arrays, not GeoJSON features.
 *
 * `[lon, lat, barrierIndex, highwayIndex]`. The per-feature
 * `type`/`geometry`/`properties` scaffolding of GeoJSON is several times the
 * payload, and this is parsed on a cold serverless invocation, so the
 * scaffolding is the whole cost. Ids are dropped with it: the runtime asks "is
 * there a gate here", never "which one".
 */
type GateFile = {
  country?: string;
  barrierKinds?: string[];
  highwayKinds?: string[];
  gates?: [number, number, number, number][];
};

function loadCountry(cc: string): CountryData {
  const cached = loaded.get(cc);
  if (cached) return cached;

  const empty: CountryData = { gates: [], cells: new Map() };
  const file = path.join(GATE_DIR(), `${cc}.json`);
  if (!fs.existsSync(file)) {
    console.warn(`public/gates/${cc}.json missing though index.json lists it.`);
    loaded.set(cc, empty);
    return empty;
  }

  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as GateFile;
  // The file names its own vocabulary, so a build that adds a barrier value does
  // not need this module changed in lockstep — an unknown index degrades to the
  // name the file gives, and only a file with no vocabulary at all falls back to
  // this module's constants.
  const barrierNames = raw.barrierKinds ?? BARRIER_KINDS;
  const highwayNames = raw.highwayKinds ?? GATE_HIGHWAYS;

  const gates: Gate[] = [];
  for (const [lon, lat, b, h] of raw.gates ?? []) {
    gates.push({
      lon,
      lat,
      barrier: (barrierNames[b] ?? "gate") as BarrierKind,
      highway: (highwayNames[h] ?? "track") as GateHighway,
      country: cc,
    });
  }

  const cells = new Map<string, Gate[]>();
  for (const g of gates) {
    const key = cellKey(g.lon, g.lat);
    const bucket = cells.get(key);
    if (bucket) bucket.push(g);
    else cells.set(key, [g]);
  }

  const data = { gates, cells };
  loaded.set(cc, data);
  return data;
}

/** Which published countries hold gate data inside `bbox`. */
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
 * A gate lookup bound to one route's own bounding box.
 *
 * Built once per candidate and asked per segment: the country set and the cell
 * ranges are identical for every segment of one route, and re-deriving them per
 * segment is what made the POI loader slow (measured there: 21 ms per call
 * against 0.06 ms).
 */
export type GateLookup = {
  /** how many gates are loadable for this box at all */
  size: number;
  /** the gates within `radiusM` of the segment a→b */
  gatesNear: (a: [number, number], b: [number, number], radiusM?: number) => Gate[];
  /** the nearest gate within `radiusM` of one point, or null */
  gateAt: (lat: number, lon: number, radiusM?: number) => Gate | null;
};

const EMPTY_LOOKUP: GateLookup = {
  size: 0,
  gatesNear: () => [],
  gateAt: () => null,
};

export function gateLookup(bbox: BBox): GateLookup {
  const countries = dataForBBox(bbox);
  if (!countries.length) return EMPTY_LOOKUP;

  const size = countries.reduce((n, c) => n + c.gates.length, 0);
  if (!size) return EMPTY_LOOKUP;

  const scale = metricScale((bbox[1] + bbox[3]) / 2);

  const inWindow = (minLon: number, minLat: number, maxLon: number, maxLat: number): Gate[] => {
    const out: Gate[] = [];
    const x0 = Math.floor(minLon / CELL_DEGREES);
    const x1 = Math.floor(maxLon / CELL_DEGREES);
    const y0 = Math.floor(minLat / CELL_DEGREES);
    const y1 = Math.floor(maxLat / CELL_DEGREES);
    for (const country of countries) {
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const bucket = country.cells.get(`${x}:${y}`);
          if (bucket) out.push(...bucket);
        }
      }
    }
    return out;
  };

  const gatesNear = (a: [number, number], b: [number, number], radiusM = GATE_RADIUS_M): Gate[] => {
    const padLon = radiusM / Math.max(1, scale.kx);
    const padLat = radiusM / scale.ky;
    const candidates = inWindow(
      Math.min(a[0], b[0]) - padLon,
      Math.min(a[1], b[1]) - padLat,
      Math.max(a[0], b[0]) + padLon,
      Math.max(a[1], b[1]) + padLat
    );
    return candidates.filter(
      (g) => segmentDistanceM([g.lon, g.lat], a, b, scale) <= radiusM
    );
  };

  /** `lat, lon` in that order — it reads as a coordinate at the call site. */
  const gateAt = (lat: number, lon: number, radiusM = GATE_RADIUS_M): Gate | null => {
    const padLon = radiusM / Math.max(1, scale.kx);
    const padLat = radiusM / scale.ky;
    let best: Gate | null = null;
    let bestD = radiusM;
    for (const g of inWindow(lon - padLon, lat - padLat, lon + padLon, lat + padLat)) {
      const d = Math.hypot((g.lon - lon) * scale.kx, (g.lat - lat) * scale.ky);
      if (d <= bestD) {
        bestD = d;
        best = g;
      }
    }
    return best;
  };

  return { size, gatesNear, gateAt };
}

/**
 * The gates on one routed line, deduplicated.
 *
 * The convenience the caller actually wants: `classify.ts` reports a count per
 * route, not per segment, and a gate sitting on a shared vertex would otherwise
 * be found by both segments that meet there.
 */
export function gatesOnRoute(
  coordinates: [number, number][],
  radiusM = GATE_RADIUS_M
): Gate[] {
  if (coordinates.length < 2) return [];
  const lookup = gateLookup(bboxOf(coordinates));
  if (!lookup.size) return [];

  const seen = new Set<string>();
  const out: Gate[] = [];
  for (let i = 0; i < coordinates.length - 1; i++) {
    for (const gate of lookup.gatesNear(coordinates[i], coordinates[i + 1], radiusM)) {
      const key = `${gate.lon},${gate.lat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(gate);
    }
  }
  return out;
}

/** Bounding box of a routed line, for `gateLookup`. */
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

/** Whether any published country covers this box — the honesty question.
 *
 * Only Latvia is built. Everywhere else this is false, which means "not
 * measured" and must be said out loud rather than read as "no gates", exactly
 * as `sparsePlaceData` does for POIs. */
export function hasGateData(bbox: BBox): boolean {
  return countriesForBBox(bbox).length > 0;
}
