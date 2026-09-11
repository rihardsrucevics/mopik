/**
 * Does a rider-quality profile change what BRouter returns? Measured, not
 * assumed: the same 25-30 km legs are routed with the current generated
 * profile (frozen as `legacyProfile`) and with the current `buildMotoProfile` per difficulty, and the results compared on what a
 * rider feels — rough tracks, sand, yards and streets, surface ping-pong,
 * turns per 10 km — not only on % unpaved.
 *
 *   npx tsx scripts/experiment-profile.ts
 */
import { buildMotoProfile } from "../lib/routing/moto-profile";

/** BRouter to test against; the local server when BROUTER_BASE_URL is set. */
const BASE = (process.env.BROUTER_BASE_URL ?? "https://brouter.de").replace(/\/$/, "");

type Leg = { name: string; lonlats: string };
const LEGS: Leg[] = [
  { name: "Sigulda→Nītaure", lonlats: "24.8530,57.1530|25.0500,57.0800" },
  { name: "Kuldīga→Renda", lonlats: "21.9608,56.9686|22.2900,57.0700" },
  { name: "Tukums→Jaunpils", lonlats: "23.1525,56.9670|23.0100,56.7300" },
  { name: "Alūksne→Ape", lonlats: "27.0505,57.4205|26.6900,57.5400" },
  { name: "Rīga(Bergi)→Ropaži", lonlats: "24.2600,57.0100|24.6300,56.9700" },
  { name: "Rīga centrs→Baldone", lonlats: "24.1052,56.9496|24.3900,56.7400" },
];

/**
 * The profile as it was before the 2026-09-03 audit, frozen here as the
 * baseline (with reporting keys referenced so its tracktype/smoothness/town
 * figures are honest). Compare `buildMotoProfile` against this.
 */
function legacyProfile(offRoad: number): string {
  const t = offRoad;
  const c = {
    track: (2.2 - 1.9 * t).toFixed(2),
    unpavedBonus: (1 - 0.45 * t).toFixed(2),
    unclassified: (1.6 - 0.5 * t).toFixed(2),
    residential: (2.4 + 2 * t).toFixed(2),
    tertiary: (3 + 9 * t).toFixed(2),
    secondary: (5 + 25 * t).toFixed(2),
    primary: (12 + 60 * t).toFixed(2),
  };
  return `---context:global
assign consider_elevation = false
assign validForCars = 1
---context:way
assign turncost = 0
assign initialclassifier = 0
assign initialcost = 0
assign motor_forbidden =
  or highway=path or highway=footway or highway=cycleway
  or highway=bridleway or highway=steps or highway=pedestrian
  or highway=construction or highway=proposed
  or motor_vehicle=no or motor_vehicle=private
  or motor_vehicle=agricultural
  or access=no access=private
assign surface_factor = switch or surface=gravel or surface=fine_gravel or surface=ground or surface=dirt or surface=earth or surface=compacted or surface=unpaved or surface=sand surface=grass ${c.unpavedBonus} 1.0
assign report_probe = or tracktype=grade1 or tracktype=grade2 or tracktype=grade3 or tracktype=grade4 or tracktype=grade5
  or smoothness=bad or smoothness=very_bad or smoothness=horrible or smoothness=impassable
  or estimated_town_class=3 or estimated_town_class=4 or estimated_town_class=5
  or service=driveway or service=parking_aisle or motorcycle=no vehicle=no
assign costfactor
  switch motor_forbidden 100000
  multiply surface_factor
  switch highway=track         ${c.track}
  switch highway=unclassified  ${c.unclassified}
  switch highway=service       2.0
  switch highway=residential   ${c.residential}
  switch highway=living_street 2.5
  switch highway=tertiary      ${c.tertiary}
  switch highway=secondary     ${c.secondary}
  switch highway=primary       ${c.primary}
  switch or highway=trunk highway=motorway 100000
  6.0
---context:node
assign initialcost = 0
`;
}

const PAVED = new Set(["asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "cobblestone", "chipseal", "metal", "wood"]);
const R = 6371000;
const hav = (a: number[], b: number[]) => {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const bearing = (a: number[], b: number[]) => {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180, dLon = ((b[0] - a[0]) * Math.PI) / 180;
  return ((Math.atan2(Math.sin(dLon) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon)) * 180) / Math.PI + 360) % 360;
};

async function upload(script: string): Promise<string> {
  const res = await fetch(`${BASE}/brouter/profile`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: script });
  if (!res.ok) throw new Error(`profile upload ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { profileid: string }).profileid;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function route(profileId: string, lonlats: string) {
  const url = `${BASE}/brouter?lonlats=${encodeURIComponent(lonlats)}&profile=${profileId}&alternativeidx=0&format=geojson`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url);
    if (res.ok) return (await res.json()) as { features: { geometry: { coordinates: number[][] }; properties: { "track-length": string; "total-time": string; messages: string[][] } }[] };
    const text = await res.text();
    if (res.status === 403 || res.status === 429 || /watchdog/.test(text)) { await sleep(3000 * (attempt + 1)); continue; }
    throw new Error(`${res.status} ${text.slice(0, 200)}`);
  }
  throw new Error("throttled");
}

function summarise(data: Awaited<ReturnType<typeof route>>) {
  const f = data.features[0];
  const coords = f.geometry.coordinates;
  const [header, ...rows] = f.properties.messages;
  const iTags = header.indexOf("WayTags"), iLon = header.indexOf("Longitude"), iLat = header.indexOf("Latitude");
  const km: Record<string, number> = {};
  const add = (k: string, v: number) => (km[k] = (km[k] ?? 0) + v);
  let shapeIndex = 0;
  const runs: { cls: string; km: number }[] = [];
  for (const row of rows) {
    const lon = Number(row[iLon]) / 1e6, lat = Number(row[iLat]) / 1e6;
    let end = shapeIndex, best = Infinity;
    for (let i = shapeIndex; i < coords.length; i++) { const d = hav(coords[i], [lon, lat]); if (d < best) { best = d; end = i; } if (d < 5) break; }
    let m = 0;
    for (let i = shapeIndex + 1; i <= end; i++) m += hav(coords[i - 1], coords[i]);
    shapeIndex = end;
    const tags: Record<string, string> = {};
    for (const pair of String(row[iTags]).split(/\s+/)) { const e = pair.indexOf("="); if (e > 0) tags[pair.slice(0, e)] = pair.slice(e + 1); }
    const hw = tags.highway ?? "?";
    const d = m / 1000;
    add("total", d);
    if (hw === "track") { add("track", d); add(`tt:${tags.tracktype ?? "untagged"}`, d); }
    if (["residential", "living_street", "service"].includes(hw)) add("streets", d);
    if (tags.surface === "sand") add("sand", d);
    if (tags.smoothness && /bad|horrible|impassable/.test(tags.smoothness)) add("rough", d);
    if (tags.estimated_town_class && Number(tags.estimated_town_class) >= 3) add("town3+", d);
    if (tags.estimated_forest_class && Number(tags.estimated_forest_class) >= 4) add("forest4+", d);
    const unpaved = tags.surface ? !PAVED.has(tags.surface) : hw === "track";
    if (unpaved) add("unpaved", d);
    const cls = unpaved ? "u" : "p";
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.km += d; else runs.push({ cls, km: d });
  }
  let turns = 0, prevB: number | null = null, acc = 0, lastIdx = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += hav(coords[i - 1], coords[i]);
    if (acc < 40) continue;
    const b = bearing(coords[lastIdx], coords[i]);
    if (prevB !== null && Math.abs(((prevB - b + 540) % 360) - 180) > 70) turns++;
    prevB = b; lastIdx = i; acc = 0;
  }
  const total = km.total || 1;
  const pct = (k: string) => Math.round(((km[k] ?? 0) / total) * 100);
  const r1 = (k: string) => Math.round((km[k] ?? 0) * 10) / 10;
  return {
    km: Math.round(Number(f.properties["track-length"]) / 100) / 10,
    min: Math.round(Number(f.properties["total-time"]) / 60),
    unpaved: `${pct("unpaved")}%`,
    track: `${pct("track")}%`,
    grade45: r1("tt:grade4") + r1("tt:grade5"),
    gradeUntagged: r1("tt:untagged"),
    rough: r1("rough"),
    sand: r1("sand"),
    streets: r1("streets"),
    town3plus: r1("town3+"),
    forest4plus: `${pct("forest4+")}%`,
    flips: runs.length - 1,
    shortRuns: runs.filter((r, i) => i > 0 && i < runs.length - 1 && r.km < 0.5).length,
    turnsPer10km: Math.round((turns / total) * 100) / 10,
  };
}

async function main() {
  const common = { offRoad: 0.8, avoidMainRoads: false, avoidMotorways: true, noSand: false, avoidTowns: false, trails: "none" } as const;
  const profiles: Record<string, string> = {
    legacy: await upload(legacyProfile(0.8)),
    "easy/none": await upload(buildMotoProfile({ ...common, difficulty: "easy" })),
    "adv/none": await upload(buildMotoProfile({ ...common, difficulty: "adventure" })),
    "adv/some": await upload(buildMotoProfile({ ...common, difficulty: "adventure", trails: "some" })),
    "adv/lots": await upload(buildMotoProfile({ ...common, difficulty: "adventure", trails: "lots" })),
    "hard/lots": await upload(buildMotoProfile({ ...common, difficulty: "hard", trails: "lots" })),
  };
  console.log("profiles:", profiles);

  const only = process.env.ONLY?.split(",");
  for (const leg of LEGS) {
    console.log(`\n== ${leg.name}`);
    for (const [name, id] of Object.entries(profiles)) {
      if (only && !only.includes(name)) continue;
      try {
        const data = await route(id, leg.lonlats);
        console.log(`${name.padEnd(20)} ${JSON.stringify(summarise(data))}`);
      } catch (err) {
        console.log(`${name.padEnd(20)} FAILED: ${err instanceof Error ? err.message : err}`);
      }
      if (!process.env.BROUTER_BASE_URL) await sleep(1500);
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
