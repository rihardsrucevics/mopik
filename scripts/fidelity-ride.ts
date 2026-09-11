/**
 * How much of a rider's real ride does our profile reproduce on its own?
 *
 *   BROUTER_BASE_URL=http://localhost:17777 npx tsx scripts/fidelity-ride.ts path/to/ride.gpx [viaCount]
 *
 * The ride is downsampled to `viaCount` via points (start, end and evenly
 * spaced stops), routed with several profile variants, and each result is
 * scored on the share of its length that lies within 30 m of the ridden
 * track — plus the usual rider-facing figures. Rides are ground truth for
 * what a rider wants; this is how the cost table gets calibrated.
 */
import fs from "node:fs";
import { buildMotoProfile, type MotoProfileOptions } from "../lib/routing/moto-profile";

const BASE = (process.env.BROUTER_BASE_URL ?? "https://brouter.de").replace(/\/$/, "");
const file = process.argv[2];
const viaCount = Number(process.argv[3] ?? 6);
if (!file) throw new Error("usage: fidelity-ride.ts ride.gpx [viaCount]");

const gpx = fs.readFileSync(file, "utf-8");
const pts: [number, number][] = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);

const R = 6371000;
const hav = (a: number[], b: number[]) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + hav(pts[i - 1], pts[i]));
const total = cum[cum.length - 1];
const via: [number, number][] = [];
for (let k = 0; k < viaCount; k++) {
  const target = (total * k) / (viaCount - 1);
  let i = 0; while (i < cum.length - 1 && cum[i] < target) i++;
  via.push(pts[i]);
}

// grid of ride points for the "on ride" test
const kx = 111320 * Math.cos((57 * Math.PI) / 180), ky = 111320, cell = 60;
const grid = new Map<string, [number, number][]>();
const key = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
for (let i = 1; i < pts.length; i++) {
  // densify to 15 m so the nearest-point test is fair
  const n = Math.max(1, Math.ceil(hav(pts[i - 1], pts[i]) / 15));
  for (let s = 0; s <= n; s++) {
    const p: [number, number] = [pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * s) / n, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * s) / n];
    const k = key(p[0] * kx, p[1] * ky); (grid.get(k) ?? grid.set(k, []).get(k)!).push(p);
  }
}
const onRide = (p: number[]) => {
  const x = p[0] * kx, y = p[1] * ky;
  for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
    for (const q of grid.get(`${Math.floor(x / cell) + ox}:${Math.floor(y / cell) + oy}`) ?? []) {
      if (Math.hypot(q[0] * kx - x, q[1] * ky - y) < 30) return true;
    }
  }
  return false;
};

/** A variant with the cost table nudged towards what the ride shows. */
function calibrated(o: MotoProfileOptions): string {
  return buildMotoProfile(o)
    // rough grades are the point of the ride, not a penalty
    .replace(/switch tracktype=grade5 [\d.]+/, "switch tracktype=grade5 0.85")
    .replace(/switch tracktype=grade4 [\d.]+/, "switch tracktype=grade4 0.85")
    .replace(/switch tracktype=grade3 [\d.]+/, "switch tracktype=grade3 0.95")
    // sand is ridden without complaint (12 km of it)
    .replace(/switch surface=sand [\d.]+/, "switch surface=sand 1.0")
    // hop onto side tracks freely
    .replace(/assign turncost = \d+/, "assign turncost = 30")
    .replace(/assign initialcost = \d+/, "assign initialcost = 100");
}

async function upload(script: string) {
  const res = await fetch(`${BASE}/brouter/profile`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: script });
  if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
  return ((await res.json()) as { profileid: string }).profileid;
}
async function route(profile: string) {
  const url = `${BASE}/brouter?lonlats=${via.map((p) => p.join(",")).join("|")}&profile=${profile}&alternativeidx=0&format=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  return (await res.json()).features[0] as { geometry: { coordinates: number[][] }; properties: { "track-length": string; messages: string[][] } };
}
function summarise(f: Awaited<ReturnType<typeof route>>) {
  const coords = f.geometry.coordinates;
  const [header, ...rows] = f.properties.messages;
  const iTags = header.indexOf("WayTags"), iLon = header.indexOf("Longitude"), iLat = header.indexOf("Latitude");
  let shapeIndex = 0; const km: Record<string, number> = {}; const add = (k: string, v: number) => (km[k] = (km[k] ?? 0) + v);
  let on = 0, all = 0;
  for (let i = 1; i < coords.length; i++) { const d = hav(coords[i - 1], coords[i]); all += d; if (onRide(coords[i])) on += d; }
  for (const row of rows) {
    const lon = Number(row[iLon]) / 1e6, lat = Number(row[iLat]) / 1e6;
    let end = shapeIndex, best = Infinity;
    for (let i = shapeIndex; i < coords.length; i++) { const d = hav(coords[i], [lon, lat]); if (d < best) { best = d; end = i; } if (d < 5) break; }
    let m = 0; for (let i = shapeIndex + 1; i <= end; i++) m += hav(coords[i - 1], coords[i]); shapeIndex = end;
    const tags: Record<string, string> = {};
    for (const pair of String(row[iTags]).split(/\s+/)) { const e = pair.indexOf("="); if (e > 0) tags[pair.slice(0, e)] = pair.slice(e + 1); }
    const hw = tags.highway ?? "?"; const d = m / 1000;
    if (hw === "track") { add("track", d); if (tags.tracktype === "grade4" || tags.tracktype === "grade5") add("g45", d); }
    if (tags.surface === "sand") add("sand", d);
    if (["primary", "secondary", "tertiary"].includes(hw)) add("main", d);
  }
  const t = all / 1000;
  const r1 = (k: string) => Math.round((km[k] ?? 0) * 10) / 10;
  return { km: Math.round(t), onRide: `${Math.round((on / all) * 100)}%`, track: `${Math.round(((km.track ?? 0) / t) * 100)}%`, grade45Km: r1("g45"), sandKm: r1("sand"), mainRoadKm: r1("main") };
}

async function main() {
  console.log(`ride ${(total / 1000).toFixed(1)} km, ${via.length} via points`);
  const common = { offRoad: 0.85, avoidMainRoads: false, avoidMotorways: true, noSand: false, avoidTowns: false } as const;
  const variants: Record<string, string> = {
    "adv/none": buildMotoProfile({ ...common, difficulty: "adventure", trails: "none" }),
    "adv/lots": buildMotoProfile({ ...common, difficulty: "adventure", trails: "lots" }),
    "hard/lots": buildMotoProfile({ ...common, difficulty: "hard", trails: "lots" }),
    "hard/lots calibrated": calibrated({ ...common, difficulty: "hard", trails: "lots" }),
    "adv/lots calibrated": calibrated({ ...common, difficulty: "adventure", trails: "lots" }),
  };
  for (const [name, script] of Object.entries(variants)) {
    try { console.log(name.padEnd(22), JSON.stringify(summarise(await route(await upload(script))))); }
    catch (e) { console.log(name.padEnd(22), "FAILED", e instanceof Error ? e.message : e); }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
