/**
 * Item 11f, part B — the beach check that item 11e left pending.
 *
 *   SEA_DIR=<dir with beach.json + coast-dense.json> \
 *     npx tsx scripts/measure-beach-picks.ts [outDir]
 *
 * Item 11e's handover left one number unmeasured and called it out:
 *
 * > On Rīga → Ainaži the winner `sea-0.25` carries **15.69 km** of
 * > `highway=path` within 1 km of the water. `sea-*` candidates are built by
 * > `seawardVias` and are never touched by the offshore filter, so this is
 * > inherited from item 11d — but it is now the ride that gets shown.
 *
 * `highway=path` near the water is a proxy, not the thing itself: item 11a's
 * rule is about *beach*, and its measurement was the `natural=beach|sand|dune|
 * shingle` polygons. 0.72 beach km across six legs was the figure it left. So
 * this scores the candidates a rider is actually shown today — the picks, not
 * the direct legs `measure-coast.ts` routes — against those same polygons, and
 * names the ways that carry any beach metres.
 *
 * ## Why a separate script rather than a flag on `measure-coast.ts`
 *
 * That one routes a fixed list of A→B legs with no vias, which is the right
 * question for a *profile* change and the wrong one for a *candidate* change:
 * the beach kilometres item 11f has to account for are the ones a chosen
 * candidate rides, and a candidate is a via list. Its scoring method — the
 * ray-cast polygon test, the 0.02° grid, the midpoint rule — is reproduced
 * here deliberately unchanged so the two sets of numbers are comparable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { classifyRoute } from "../lib/routing/classify";
import { seawardCorridors, seawardVias } from "../lib/routing/seaward";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema, type RouteEdge } from "../lib/types";

const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));
const OPTIONS = buildMotoProfileOptions(INTENT);

const CELL = 0.02;
const M_PER_DEG_LAT = 111_320;

const SEA_DIR = process.env.SEA_DIR ?? "scratchpad/sea";
const COAST_INDEX = process.env.COAST_INDEX ?? `${SEA_DIR}/coast-dense.json`;
const BEACH_INDEX = process.env.BEACH_INDEX ?? `${SEA_DIR}/beach.json`;

type Ring = [number, number][];
type BeachArea = { ring: Ring; bbox: [number, number, number, number]; natural: string };

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

function loadBeachGrid(): Map<string, BeachArea[]> | null {
  if (!existsSync(BEACH_INDEX)) return null;
  const raw = JSON.parse(readFileSync(BEACH_INDEX, "utf8")) as {
    elements: {
      type: string;
      id?: number;
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

type Score = {
  totalKm: number;
  km300: number;
  km1000: number;
  beachKm: number;
  shorePathKm: number;
  /** ways carrying any beach metres — the brief asks for these by name */
  beachWays: Record<string, number>;
};

function scoreLeg(
  coords: [number, number][],
  edges: RouteEdge[],
  coast: Map<string, [number, number][]>,
  beach: Map<string, BeachArea[]> | null
): Score {
  let total = 0, near300 = 0, near1000 = 0, beachM = 0, shorePathM = 0;
  const beachWays = new Map<string, number>();

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
      if (d < 1000) {
        near1000 += m;
        if (hw === "path") shorePathM += m;
      }
      if (d < 300) near300 += m;
      if (beach) {
        const hit = beachHit(beach, mid[0], mid[1]);
        if (hit) {
          beachM += m;
          const key = `${name} [${hw}/${surf}] on ${hit}`;
          beachWays.set(key, (beachWays.get(key) ?? 0) + m);
        }
      }
    }
  }

  const km = (m: number) => Math.round(m / 100) / 10;
  return {
    totalKm: km(total),
    km300: km(near300),
    km1000: km(near1000),
    beachKm: Math.round(beachM) / 1000,
    shorePathKm: Math.round(shorePathM) / 1000,
    beachWays: Object.fromEntries(
      [...beachWays.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([k, v]) => [k, Math.round(v) / 1000])
    ),
  };
}

type Leg = { name: string; a: [number, number]; b: [number, number] };
const LEGS: Leg[] = [
  { name: "riga-ainazi", a: [24.1052, 56.9496], b: [24.3594, 57.8686] },
  { name: "ventspils-kolka", a: [21.5606, 57.3894], b: [22.5936, 57.7481] },
  { name: "liepaja-ventspils", a: [21.0107, 56.5047], b: [21.5606, 57.3894] },
  { name: "jurmala-kolka", a: [23.7794, 56.9681], b: [22.5936, 57.7481] },
];

async function main() {
  const outDir = process.argv[2] ?? "/tmp/beach-picks";
  mkdirSync(outDir, { recursive: true });

  const coast = loadCoastGrid();
  const beach = loadBeachGrid();
  if (!coast) {
    console.error(`no coastline index at ${COAST_INDEX} — set SEA_DIR / COAST_INDEX`);
    process.exit(1);
  }
  console.log(`coast grid ${coast.size} cells; beach ${beach ? `${beach.size} cells` : "MISSING"}\n`);

  const report: Record<string, unknown> = {};

  for (const leg of LEGS) {
    console.log(`\n=== ${leg.name} ===`);
    // Every candidate a rider could be shown on this leg: the direct line, the
    // single-via coastal shapes and item 11f's corridor ones.
    const variants: { variant: string; points: [number, number][] }[] = [
      { variant: "via-0-1", points: [leg.a, leg.b] },
      ...seawardVias(leg.a, leg.b).map((v) => ({
        variant: `sea-${v.fraction}`,
        points: [leg.a, v.point, leg.b] as [number, number][],
      })),
      ...seawardCorridors(leg.a, leg.b).map((c) => ({
        variant: `seaCorridor-${c.fractions[0]}-${c.fractions[1]}`,
        points: [leg.a, ...c.points, leg.b] as [number, number][],
      })),
    ];

    const rows: Record<string, unknown>[] = [];
    for (const v of variants) {
      try {
        const path = await fetchRoutePath({ points: v.points, profileOptions: OPTIONS });
        const c = classifyRoute(path);
        const s = scoreLeg(path.coordinates, path.edges, coast, beach);
        console.log(
          `  ${v.variant.padEnd(24)} ${s.totalKm.toFixed(1).padStart(6)} km  ` +
            `beach ${s.beachKm.toFixed(2).padStart(5)}  shorePath ${s.shorePathKm.toFixed(2).padStart(5)}  ` +
            `coast<1km ${s.km1000.toFixed(1).padStart(5)}  <300m ${s.km300.toFixed(1).padStart(5)}  ` +
            `rep ${String(c.overlap.repeatedPercent).padStart(3)}%`
        );
        for (const [way, km] of Object.entries(s.beachWays)) {
          console.log(`        beach ${km.toFixed(3)} km on ${way}`);
        }
        rows.push({ variant: v.variant, ...s, repeatedPercent: c.overlap.repeatedPercent });
      } catch (err) {
        console.log(`  ${v.variant.padEnd(24)} FAILED  ${String((err as Error).message).slice(0, 45)}`);
        rows.push({ variant: v.variant, failed: String((err as Error).message).slice(0, 80) });
      }
    }
    report[leg.name] = rows;
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
  }

  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
  console.log(`\nfull detail in ${outDir}/report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
