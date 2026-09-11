// Rider's-eye measurement of generated routes, end to end through the API.
//
//   node scripts/measure-prompts.mjs [out.json]      (dev server on :3000, local BRouter)
//   ONLY=tukums-2h,riga-gravel node scripts/measure-prompts.mjs
//   API=https://…vercel.app/api/generate-route node scripts/measure-prompts.mjs
//
// POSTs each prompt with debug:true and prints what the app itself does not
// show: per-highway km, tracktype, sand, streets, surface flips, turns per
// 10 km, the calibration figures and which parser ran. Compare runs to see
// whether a change helped the rider, not just the stats page.

import fs from "node:fs";

const API = process.env.API ?? "http://localhost:3000/api/generate-route";

const PROMPTS = [
  { id: "sigulda-easy", prompt: "Sāku Siguldā, gribu 4h izbraucienu, ap 50% grants, easy adventure, bez lielajām šosejām" },
  { id: "kuldiga-forest", prompt: "150 km loks ap Kuldīgu, maksimāli daudz meža ceļu, bez dziļām smiltīm" },
  { id: "cesis-hard", prompt: "3 stundas ap Cēsīm, daudz raustīto, nedaudz punktoto, hard" },
  { id: "riga-gravel", prompt: "200 km from Riga, mostly gravel, avoid towns and main roads" },
  { id: "tukums-2h", prompt: "2h ap Tukumu, daudz grants" },
  { id: "aluksne-adv", prompt: "Adventure ride around Aluksne, 120 km, lots of dashed lines, some dotted" },
  { id: "riga-forest", prompt: "Sāku Rīgā, Mežaparkā. 130 km pa meža ceļiem un takām, daudz punktoto, smiltis nebaida" },
];

const R = 6371000;
function hav(a, b) {
  const dLat = ((b[1] - a[1]) * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const la1 = (a[1] * Math.PI) / 180, la2 = (b[1] * Math.PI) / 180;
  const dLon = ((b[0] - a[0]) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const PAVED = new Set(["asphalt", "paved", "concrete", "concrete:plates", "paving_stones", "sett", "cobblestone", "chipseal", "metal", "wood"]);

function analyse(route) {
  const coords = route.geometry.coordinates;
  const edges = route.debugEdges ?? [];
  const totalKm = route.distanceMeters / 1000;
  const edgeKm = (e) => {
    let m = 0;
    for (let i = e.begin + 1; i <= e.end && i < coords.length; i++) m += hav(coords[i - 1], coords[i]);
    return m / 1000;
  };
  const km = {};
  const add = (k, v) => (km[k] = (km[k] ?? 0) + v);
  const runs = [];
  for (const e of edges) {
    const t = e.tags, d = edgeKm(e);
    const hw = t.highway ?? "?";
    add(`hw:${hw}`, d);
    if (hw === "track") add(`tt:${t.tracktype ?? "untagged"}`, d);
    if (t.surface === "sand") add("sand", d);
    if (hw === "residential" || hw === "living_street" || hw === "service") add("streets", d);
    if (t.estimated_forest_class && Number(t.estimated_forest_class) >= 4) add("forest4+", d);
    const cls = t.surface ? (PAVED.has(t.surface) ? "paved" : "unpaved") : hw === "track" ? "unpaved" : "paved";
    const last = runs[runs.length - 1];
    if (last && last.cls === cls) last.km += d; else runs.push({ cls, km: d });
  }
  let turns = 0, prevB = null, acc = 0, lastIdx = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += hav(coords[i - 1], coords[i]);
    if (acc < 40) continue;
    const b = bearing(coords[lastIdx], coords[i]);
    if (prevB !== null && angDiff(prevB, b) > 70) turns++;
    prevB = b; lastIdx = i; acc = 0;
  }
  const seen = new Set(); let inRep = false, repRuns = 0;
  const key = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;
  for (let i = 1; i < coords.length; i++) {
    const a = key(coords[i - 1]), b = key(coords[i]);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) { if (!inRep) { repRuns++; inRep = true; } } else { seen.add(k); inRep = false; }
  }
  const pct = (k) => Math.round(((km[k] ?? 0) / totalKm) * 100);
  const r1 = (k) => Math.round((km[k] ?? 0) * 10) / 10;
  return {
    name: route.name,
    km: Math.round(totalKm),
    min: Math.round(route.durationSeconds / 60),
    repeated: `${route.overlap.repeatedPercent}% in ${repRuns} stretches`,
    unpaved: `${route.surfaces.gravelPercent + route.surfaces.dirtPercent}%`,
    track: `${route.roadMix.trackPercent}%`,
    trailKm: route.roadMix.trailKm,
    forest4plus: `${pct("forest4+")}%`,
    highway: Object.fromEntries(Object.entries(km).filter(([k]) => k.startsWith("hw:")).map(([k, v]) => [k.slice(3), `${Math.round(v)}km`]).sort()),
    tracktype: Object.fromEntries(Object.entries(km).filter(([k]) => k.startsWith("tt:")).map(([k, v]) => [k.slice(3), `${r1(k)}km`]).sort()),
    sandKm: r1("sand"),
    streetsKm: r1("streets"),
    surfaceFlips: runs.length - 1,
    turnsPer10km: Math.round((turns / totalKm) * 100) / 10,
    quality: route.quality,
    stops: (route.stops ?? []).map((s) => `${s.name} (${s.category})`),
  };
}

const only = process.env.ONLY?.split(",");
const out = [];
for (const { id, prompt } of PROMPTS) {
  if (only && !only.includes(id)) continue;
  const t0 = Date.now();
  let res, json;
  try {
    res = await fetch(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, debug: true }) });
    json = await res.json();
  } catch (err) {
    console.log(`\n### ${id}: request failed: ${err}`);
    continue;
  }
  const secs = Math.round((Date.now() - t0) / 100) / 10;
  console.log(`\n### ${id} — "${prompt}" (${secs}s, HTTP ${res.status})`);
  if (!res.ok) { console.log(json); out.push({ id, prompt, error: json }); continue; }
  console.log("intent:", JSON.stringify(json.intent), "parser:", json.parser);
  if (json.debugCalibration) console.log("calibration:", JSON.stringify(json.debugCalibration));
  for (const w of ["distanceWarning", "overlapWarning", "longerSuggestion"]) if (json[w]) console.log(`${w}:`, JSON.stringify(json[w]));
  const routes = json.routes.map(analyse);
  for (const r of routes) {
    const q = r.quality ?? {};
    console.log(`  ${String(r.km).padStart(4)}km ${String(r.min).padStart(4)}min rep=${r.repeated.padEnd(20)} unp=${r.unpaved.padEnd(4)} trk=${r.track.padEnd(4)} trail=${r.trailKm} forest4+=${r.forest4plus} rough=${q.roughTrackKm} sand=${r.sandKm} streets=${r.streetsKm} t/10=${r.turnsPer10km}  ${r.name}`);
  }
  out.push({ id, prompt, intent: json.intent, parser: json.parser, calibration: json.debugCalibration, start: json.start, routes });
}
const file = process.argv[2] ?? "measure-out.json";
fs.writeFileSync(file, JSON.stringify(out, null, 1));
console.log(`\nsaved ${file}`);
