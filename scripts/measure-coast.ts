/**
 * Backlog item 11 — how close do coastal rides get to the sea, do they ride
 * on the beach, and WHICH road carries the coastal kilometres?
 *
 *   npx tsx scripts/measure-coast.ts [outDir]
 *
 * Routes the coastal legs below with the app's own Adventure profile through
 * `BROUTER_BASE_URL`, writes one JSON per leg ({coordinates, edges}) and — when
 * a coastline index is available — scores each leg in this process and prints
 * the table item 11 is measured with.
 *
 * Routing here is deliberately a single leg per ride rather than the full
 * generation: the question is what the *cost profile* does beside the sea,
 * and a 36-candidate generation answers it with loop-shape noise on top.
 *
 * ## The coastline index
 *
 * `COAST_INDEX` (default `scratchpad/sea/coast-dense.json`) is a JSON array of
 * `[lon, lat]` vertices of OSM `natural=coastline` over the Baltic bbox,
 * already ≤100 m apart — 6,038 ways / 575,551 vertices, fetched once from
 * Overpass (`overpass.private.coffee`; the main mirror 504s on this bbox). It
 * is 12 MB and deliberately NOT committed; without it the script still routes
 * and writes the legs, and only the scoring is skipped.
 *
 * `BEACH_INDEX` (default `scratchpad/sea/beach.json`) is the raw Overpass
 * answer for `natural=beach|sand|dune|shingle` ways and relations — the
 * "is the bike on the sand" half. Also optional.
 *
 * Scoring walks each edge's shape points, takes each sub-segment's length and
 * midpoint, and asks the index for the distance to the nearest coastline
 * vertex. BRouter shape points are 10–40 m apart, so the midpoint
 * approximation costs metres, not hundreds of metres.
 */
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema, type RouteEdge } from "../lib/types";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";

type Leg = { name: string; points: [number, number][] };

/** The reported case first, then one leg per stretch of Baltic coast. */
const LEGS: Leg[] = [
  { name: "riga-ainazi", points: [[24.1052, 56.9496], [24.3594, 57.8686]] },
  { name: "jurmala-kolka", points: [[23.7708, 56.9680], [22.5936, 57.7481]] },
  { name: "liepaja-ventspils", points: [[21.0107, 56.5047], [21.5606, 57.3894]] },
  { name: "parnu-haapsalu", points: [[24.4971, 58.3859], [23.5417, 58.9431]] },
  { name: "klaipeda-palanga", points: [[21.1443, 55.7033], [21.0687, 55.9175]] },
  { name: "ventspils-kolka", points: [[21.5606, 57.3894], [22.5936, 57.7481]] },
];

/** Two inland legs, to catch a fix that quietly degrades ordinary rides. */
const INLAND: Leg[] = [
  { name: "inland-sigulda-cesis", points: [[24.8530, 57.1530], [25.2717, 57.3120]] },
  { name: "inland-cesis-madona", points: [[25.2717, 57.3120], [26.2181, 56.8531]] },
];

/**
 * The default Adventure preset exactly as the composer builds it — hard /
 * riding / forest, i.e. gravel 100, trails "lots", `allow_unverified`. Read
 * from `ride-profile.ts` rather than restated, so this measures what a rider
 * actually gets.
 */
const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));

// ---------------------------------------------------------------------------
// Coastline / beach scoring
// ---------------------------------------------------------------------------

const CELL = 0.02;
const M_PER_DEG_LAT = 111_320;

/**
 * Where the two indexes live. `SEA_DIR` points at the directory holding
 * `coast-dense.json` and `beach.json`; both are scratchpad artefacts of the
 * Overpass fetch and are not in the repo, so pass `SEA_DIR=...` (or the two
 * specific variables) when re-running this from a fresh checkout.
 */
const SEA_DIR = process.env.SEA_DIR ?? "scratchpad/sea";
const COAST_INDEX = process.env.COAST_INDEX ?? `${SEA_DIR}/coast-dense.json`;
const BEACH_INDEX = process.env.BEACH_INDEX ?? `${SEA_DIR}/beach.json`;

type Ring = [number, number][];
type BeachArea = { ring: Ring; bbox: [number, number, number, number]; natural: string };

/** Coastline vertices bucketed into 0.02° cells; nearest-vertex distance. */
function loadCoastGrid(): Map<string, [number, number][]> | null {
  if (!existsSync(COAST_INDEX)) return null;
  const pts = JSON.parse(readFileSync(COAST_INDEX, "utf8")) as [number, number][];
  const grid = new Map<string, [number, number][]>();
  for (const [lon, lat] of pts) {
    const key = `${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`;
    const cell = grid.get(key);
    if (cell) cell.push([lon, lat]);
    else grid.set(key, [[lon, lat]]);
  }
  return grid;
}

/** natural=beach|sand|dune|shingle outer rings, indexed by bounding box. */
function loadBeachGrid(): Map<string, BeachArea[]> | null {
  if (!existsSync(BEACH_INDEX)) return null;
  const raw = JSON.parse(readFileSync(BEACH_INDEX, "utf8")) as {
    elements: {
      type: string;
      tags?: Record<string, string>;
      geometry?: { lon: number; lat: number }[];
      members?: { role?: string; geometry?: { lon: number; lat: number }[] }[];
    }[];
  };
  const grid = new Map<string, BeachArea[]>();
  for (const el of raw.elements) {
    const natural = el.tags?.natural ?? "?";
    const rings: Ring[] = [];
    if (el.type === "way") {
      const g = el.geometry ?? [];
      if (g.length >= 4) rings.push(g.map((p) => [p.lon, p.lat] as [number, number]));
    } else {
      for (const m of el.members ?? []) {
        if (m.role && m.role !== "outer") continue;
        const g = m.geometry ?? [];
        if (g.length >= 4) rings.push(g.map((p) => [p.lon, p.lat] as [number, number]));
      }
    }
    for (const ring of rings) {
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      const bbox: [number, number, number, number] = [
        Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats),
      ];
      const area = { ring, bbox, natural };
      for (let i = Math.floor(bbox[1] / CELL); i <= Math.floor(bbox[3] / CELL); i++) {
        for (let j = Math.floor(bbox[0] / CELL); j <= Math.floor(bbox[2] / CELL); j++) {
          const key = `${i},${j}`;
          const cell = grid.get(key);
          if (cell) cell.push(area);
          else grid.set(key, [area]);
        }
      }
    }
  }
  return grid;
}

function insideRing(ring: Ring, lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-18) + xi) inside = !inside;
  }
  return inside;
}

function beachHit(grid: Map<string, BeachArea[]>, lon: number, lat: number): string | null {
  const cell = grid.get(`${Math.floor(lat / CELL)},${Math.floor(lon / CELL)}`);
  if (!cell) return null;
  for (const { ring, bbox, natural } of cell) {
    if (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3] && insideRing(ring, lon, lat)) {
      return natural;
    }
  }
  return null;
}

/**
 * Distance in metres to the nearest coastline vertex. Rings of cells are
 * searched outwards and the search stops as soon as the best distance found
 * is inside the ring already scanned — otherwise a point 40 km inland would
 * scan the whole grid.
 */
function nearestCoastM(grid: Map<string, [number, number][]>, lon: number, lat: number): number {
  const mx = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const ci = Math.floor(lat / CELL);
  const cj = Math.floor(lon / CELL);
  let best = Infinity;
  for (const r of [1, 2, 4, 8, 16, 32]) {
    for (let i = ci - r; i <= ci + r; i++) {
      for (let j = cj - r; j <= cj + r; j++) {
        const cell = grid.get(`${i},${j}`);
        if (!cell) continue;
        for (const [plon, plat] of cell) {
          const d = ((plon - lon) * mx) ** 2 + ((plat - lat) * M_PER_DEG_LAT) ** 2;
          if (d < best) best = d;
        }
      }
    }
    const bm = Math.sqrt(best);
    if (bm <= r * CELL * Math.min(M_PER_DEG_LAT, mx)) return bm;
  }
  return Math.sqrt(best);
}

function segmentMeters(a: [number, number], b: [number, number]): number {
  const mx = M_PER_DEG_LAT * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * mx, (b[1] - a[1]) * M_PER_DEG_LAT);
}

export type CoastScore = {
  totalKm: number;
  /** km ridden within 300 m / 1 km / 3 km of the coastline */
  km300: number;
  km1000: number;
  km3000: number;
  /** km on beach/dune/sand ground — the thing that must stay ~0 */
  beachKm: number;
  /** km within 1 km of the sea, on `highway=path` (never a real road) */
  shorePathKm: number;
  /** what carries the <1 km metres, by `highway/surface`, km */
  coastalWays: Record<string, number>;
  /** named ways carrying the <1 km metres — which road was actually chosen */
  coastalNames: Record<string, number>;
};

/** A path is not a road: it is the thing item 11a made dear, counted apart. */
function isPath(tags: Record<string, string>, edge: RouteEdge): boolean {
  return (tags.highway ?? edge.use) === "path";
}

function scoreLeg(
  coords: [number, number][],
  edges: RouteEdge[],
  coast: Map<string, [number, number][]>,
  beach: Map<string, BeachArea[]> | null
): CoastScore {
  let total = 0, near300 = 0, near1000 = 0, near3000 = 0, beachM = 0, shorePathM = 0;
  const coastalWays = new Map<string, number>();
  const coastalNames = new Map<string, number>();

  for (const edge of edges) {
    const tags = edge.tags ?? {};
    const hw = tags.highway ?? edge.use ?? "?";
    const surf = tags.surface ?? "?";
    const name = tags.name ?? tags.ref ?? "(unnamed)";
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = edge.beginShapeIndex + 1; i <= end; i++) {
      const a = coords[i - 1];
      const b = coords[i];
      const m = segmentMeters(a, b);
      if (m <= 0) continue;
      const mid: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      total += m;
      const d = nearestCoastM(coast, mid[0], mid[1]);
      if (d < 3000) near3000 += m;
      if (d < 1000) {
        near1000 += m;
        coastalWays.set(`${hw}/${surf}`, (coastalWays.get(`${hw}/${surf}`) ?? 0) + m);
        coastalNames.set(`${name} [${hw}]`, (coastalNames.get(`${name} [${hw}]`) ?? 0) + m);
        if (isPath(tags, edge)) shorePathM += m;
      }
      if (d < 300) near300 += m;
      if (beach && beachHit(beach, mid[0], mid[1])) beachM += m;
    }
  }

  const km = (m: number) => Math.round(m / 100) / 10;
  const top = (map: Map<string, number>, n: number) =>
    Object.fromEntries(
      [...map.entries()].sort((x, y) => y[1] - x[1]).slice(0, n).map(([k, v]) => [k, Math.round(v) / 1000])
    );
  return {
    totalKm: km(total),
    km300: km(near300),
    km1000: km(near1000),
    km3000: km(near3000),
    beachKm: Math.round(beachM) / 1000,
    shorePathKm: Math.round(shorePathM) / 1000,
    coastalWays: top(coastalWays, 10),
    coastalNames: top(coastalNames, 12),
  };
}

async function main() {
  const outDir = process.argv[2] ?? "/tmp/coast";
  mkdirSync(outDir, { recursive: true });
  const profileOptions = buildMotoProfileOptions(INTENT);
  console.log(`via ${process.env.BROUTER_BASE_URL}`, profileOptions);

  const coast = loadCoastGrid();
  const beach = loadBeachGrid();
  if (!coast) console.log(`no coastline index at ${COAST_INDEX} — routing only, no scoring`);
  if (coast && !beach) console.log(`no beach index at ${BEACH_INDEX} — beach km will read 0`);

  const scores: Record<string, CoastScore> = {};
  for (const leg of [...LEGS, ...INLAND]) {
    const t0 = Date.now();
    try {
      const path = await fetchRoutePath({ points: leg.points, profileOptions });
      writeFileSync(
        `${outDir}/${leg.name}.json`,
        JSON.stringify({ coordinates: path.coordinates, edges: path.edges })
      );
      console.log(
        `${leg.name}: ${(path.distanceMeters / 1000).toFixed(1)} km, ` +
          `${path.edges.length} edges, ${((Date.now() - t0) / 1000).toFixed(1)} s`
      );
      if (coast) {
        scores[leg.name] = scoreLeg(path.coordinates, path.edges, coast, beach);
      }
    } catch (err) {
      console.log(`${leg.name}: FAILED ${(err as Error).message}`);
    }
  }

  if (!coast) return;
  writeFileSync(`${outDir}/scores.json`, JSON.stringify(scores, null, 1));
  console.log("\nleg                    km     <300m  <1km   <3km   beach  shorePath");
  const sum = { totalKm: 0, km300: 0, km1000: 0, km3000: 0, beachKm: 0, shorePathKm: 0 };
  for (const [name, s] of Object.entries(scores)) {
    console.log(
      `${name.padEnd(22)} ${s.totalKm.toFixed(1).padStart(6)} ${s.km300.toFixed(1).padStart(6)} ` +
        `${s.km1000.toFixed(1).padStart(6)} ${s.km3000.toFixed(1).padStart(6)} ` +
        `${s.beachKm.toFixed(2).padStart(6)} ${s.shorePathKm.toFixed(2).padStart(9)}`
    );
    for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += s[k];
  }
  console.log(
    `${"TOTAL".padEnd(22)} ${sum.totalKm.toFixed(1).padStart(6)} ${sum.km300.toFixed(1).padStart(6)} ` +
      `${sum.km1000.toFixed(1).padStart(6)} ${sum.km3000.toFixed(1).padStart(6)} ` +
      `${sum.beachKm.toFixed(2).padStart(6)} ${sum.shorePathKm.toFixed(2).padStart(9)}`
  );
  console.log(`\nfull per-leg detail (which road carries the coastal km) in ${outDir}/scores.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
