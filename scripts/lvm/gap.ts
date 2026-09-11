/**
 * Measure the gap between LVM GEO forest roads and OSM highways.
 *
 * For each study area:
 *   - total km of LVM forest road
 *   - km of LVM road farther than 15 m from ANY OSM highway  (= what OSM misses)
 *   - km of OSM track/path farther than 15 m from any LVM road (context)
 *   - km per LVM class  (LVM publishes NO class/surface attribute -> grouped by
 *     forest district `lvm_district_code` instead; see REPORT.md)
 *
 * Method: sample every line every 25 m, test each sample against OSM segments
 * via a ~200 m grid index.
 *
 * Run: npx tsx scripts/lvm/gap.ts      (fetch.ts must have run first)
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AREAS } from "./fetch.js";

const DATA = join(process.cwd(), "data", "lvm");
const NEAR_M = 15;
const STEP_M = 25;
const CELL_M = 200;

type LL = [number, number]; // [lon, lat]

// ---- planar approximation (metres, local tangent) -------------------------
const R = 6371008.8;
function proj(lat0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    x: (lon: number) => (lon * Math.PI / 180) * R * k,
    y: (lat: number) => (lat * Math.PI / 180) * R,
  };
}

type Seg = { x1: number; y1: number; x2: number; y2: number };

function distPointSeg(px: number, py: number, s: Seg): number {
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - s.x1, py - s.y1);
  let t = ((px - s.x1) * dx + (py - s.y1) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
}

/** Grid index over segments; query returns candidates within `NEAR_M`. */
class SegIndex {
  private cells = new Map<string, Seg[]>();
  constructor(segs: Seg[]) {
    for (const s of segs) {
      const i0 = Math.floor(Math.min(s.x1, s.x2) / CELL_M);
      const i1 = Math.floor(Math.max(s.x1, s.x2) / CELL_M);
      const j0 = Math.floor(Math.min(s.y1, s.y2) / CELL_M);
      const j1 = Math.floor(Math.max(s.y1, s.y2) / CELL_M);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const k = `${i}:${j}`;
          let a = this.cells.get(k);
          if (!a) this.cells.set(k, (a = []));
          a.push(s);
        }
    }
  }
  minDist(px: number, py: number): number {
    const i = Math.floor(px / CELL_M), j = Math.floor(py / CELL_M);
    let best = Infinity;
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const s of this.cells.get(`${i + di}:${j + dj}`) ?? [])
          best = Math.min(best, distPointSeg(px, py, s));
    return best;
  }
}

function linesOf(geom: any): LL[][] {
  if (!geom) return [];
  if (geom.type === "LineString") return [geom.coordinates];
  if (geom.type === "MultiLineString") return geom.coordinates;
  return [];
}

/** Walk a line in metres, sampling every STEP_M; returns [samples, lengthM]. */
function sampleLine(line: LL[], P: ReturnType<typeof proj>): { pts: [number, number][]; len: number } {
  const xy = line.map(([lon, lat]) => [P.x(lon), P.y(lat)] as [number, number]);
  const pts: [number, number][] = [];
  let len = 0, carry = 0;
  for (let i = 0; i < xy.length - 1; i++) {
    const [x1, y1] = xy[i], [x2, y2] = xy[i + 1];
    const d = Math.hypot(x2 - x1, y2 - y1);
    if (d === 0) continue;
    len += d;
    let t = carry;
    while (t < d) {
      pts.push([x1 + ((x2 - x1) * t) / d, y1 + ((y2 - y1) * t) / d]);
      t += STEP_M;
    }
    carry = t - d;
  }
  return { pts, len };
}

function segsOf(lines: LL[][], P: ReturnType<typeof proj>): Seg[] {
  const out: Seg[] = [];
  for (const l of lines)
    for (let i = 0; i < l.length - 1; i++)
      out.push({
        x1: P.x(l[i][0]), y1: P.y(l[i][1]),
        x2: P.x(l[i + 1][0]), y2: P.y(l[i + 1][1]),
      });
  return out;
}

type Row = {
  area: string;
  lvmKm: number;
  lvmMissingKm: number;
  lvmFeatures: number;
  osmTrackKm: number;
  osmTrackNotLvmKm: number;
  byDistrict: Record<string, number>;
  byOsmClassNear: Record<string, number>;
};

function analyse(area: string): Row | null {
  const lvmPath = join(DATA, `lvm-roads-${area}.geojson`);
  const osmPath = join(DATA, `osm-highways-${area}.json`);
  if (!existsSync(lvmPath) || !existsSync(osmPath)) {
    console.error(`missing data for ${area}; run scripts/lvm/fetch.ts`);
    return null;
  }
  const lvm = JSON.parse(readFileSync(lvmPath, "utf8"));
  const osm = JSON.parse(readFileSync(osmPath, "utf8"));
  const centreLat = AREAS[area].centre[0];
  const P = proj(centreLat);

  // --- OSM ---
  const osmWays = osm.elements.filter((e: any) => e.type === "way" && e.geometry);
  const osmAllLines: LL[][] = osmWays.map((w: any) =>
    w.geometry.map((g: any) => [g.lon, g.lat] as LL),
  );
  const osmAllIdx = new SegIndex(segsOf(osmAllLines, P));

  // OSM "offroad-ish" classes for the reverse comparison
  const OFFROAD = new Set(["track", "path", "bridleway", "unclassified", "service"]);
  const osmTrackLines: LL[][] = osmWays
    .filter((w: any) => OFFROAD.has(w.tags?.highway))
    .map((w: any) => w.geometry.map((g: any) => [g.lon, g.lat] as LL));

  // --- LVM ---
  let lvmKm = 0, lvmMissingM = 0;
  const byDistrict: Record<string, number> = {};
  const byOsmClassNear: Record<string, number> = {};

  // index of OSM ways with their highway class, to report what LVM roads match
  const classIdx: { idx: SegIndex; cls: string }[] = [];
  const byCls = new Map<string, LL[][]>();
  for (const w of osmWays) {
    const c = w.tags?.highway ?? "unknown";
    if (!byCls.has(c)) byCls.set(c, []);
    byCls.get(c)!.push(w.geometry.map((g: any) => [g.lon, g.lat] as LL));
  }
  for (const [cls, lines] of byCls) classIdx.push({ cls, idx: new SegIndex(segsOf(lines, P)) });

  for (const f of lvm.features) {
    const district = String(f.properties?.lvm_district_code ?? "unknown");
    for (const line of linesOf(f.geometry)) {
      const { pts, len } = sampleLine(line, P);
      lvmKm += len / 1000;
      byDistrict[district] = (byDistrict[district] ?? 0) + len / 1000;
      if (!pts.length) continue;
      const perPt = len / pts.length;
      for (const [x, y] of pts) {
        if (osmAllIdx.minDist(x, y) > NEAR_M) lvmMissingM += perPt;
        else {
          let best = "unknown", bd = Infinity;
          for (const { cls, idx } of classIdx) {
            const d = idx.minDist(x, y);
            if (d < bd) { bd = d; best = cls; }
          }
          byOsmClassNear[best] = (byOsmClassNear[best] ?? 0) + perPt / 1000;
        }
      }
    }
  }

  // --- reverse: OSM track/path not near any LVM road ---
  const lvmLines: LL[][] = lvm.features.flatMap((f: any) => linesOf(f.geometry));
  const lvmIdx = new SegIndex(segsOf(lvmLines, P));
  let osmTrackKm = 0, osmTrackNotLvmM = 0;
  for (const line of osmTrackLines) {
    const { pts, len } = sampleLine(line, P);
    osmTrackKm += len / 1000;
    if (!pts.length) continue;
    const perPt = len / pts.length;
    for (const [x, y] of pts) if (lvmIdx.minDist(x, y) > NEAR_M) osmTrackNotLvmM += perPt;
  }

  return {
    area,
    lvmKm,
    lvmMissingKm: lvmMissingM / 1000,
    lvmFeatures: lvm.features.length,
    osmTrackKm,
    osmTrackNotLvmKm: osmTrackNotLvmM / 1000,
    byDistrict,
    byOsmClassNear,
  };
}

function main() {
  const rows: Row[] = [];
  for (const area of Object.keys(AREAS)) {
    const r = analyse(area);
    if (r) rows.push(r);
  }

  const f = (n: number, d = 1) => n.toFixed(d).padStart(9);
  console.log("\nLVM GEO forest roads vs OSM  (near = within 15 m, sampled every 25 m)\n");
  console.log(
    "area      LVM feats    LVM km   missing   miss %   OSM trk km  trk not LVM",
  );
  console.log("-".repeat(76));
  for (const r of rows) {
    const pct = r.lvmKm ? (r.lvmMissingKm / r.lvmKm) * 100 : 0;
    console.log(
      `${r.area.padEnd(10)}${String(r.lvmFeatures).padStart(6)}  ${f(r.lvmKm)} ${f(
        r.lvmMissingKm,
      )} ${f(pct)}%  ${f(r.osmTrackKm)} ${f(r.osmTrackNotLvmKm)}`,
    );
  }

  for (const r of rows) {
    if (!r.lvmKm) {
      console.log(`\n[${r.area}] no LVM forest roads in this bbox (not LVM-managed land).`);
      continue;
    }
    console.log(`\n[${r.area}] LVM km by forest district (LVM publishes no road class):`);
    for (const [k, v] of Object.entries(r.byDistrict).sort((a, b) => b[1] - a[1]))
      console.log(`   district ${k.padEnd(8)} ${v.toFixed(1)} km`);
    console.log(`[${r.area}] LVM km matched onto each OSM highway class (within 15 m):`);
    for (const [k, v] of Object.entries(r.byOsmClassNear).sort((a, b) => b[1] - a[1]))
      console.log(`   ${k.padEnd(16)} ${v.toFixed(1)} km`);
  }
  console.log();
}

main();
