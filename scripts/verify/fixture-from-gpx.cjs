// Build a fixture from a rider's exported Mopik GPX (a hand-edited ride the
// router would not generate again): the plan from its <wpt>/<rte> points, the
// "generation" from its <trk>, point for point.
//   node scripts/verify/fixture-from-gpx.cjs <name> <file.gpx> [--template=ride-0928]
//   e.g. kapselu-upmali scripts/fixtures/ride-kapselu-upmali-2026-09-29.gpx
// The plan's options (profile, TET, forest…) come from the template fixture's
// request, with the places and pass-through points replaced; the fixture's
// description and places come from fixtures.spec.json. The GPX carries no road
// classes, so the track is cut into ~1 km segments of `road|gravel` — the edit
// flow reads the geometry, not the classes.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const args = process.argv.slice(2);
const [name, file] = args.filter((a) => !a.startsWith("--"));
const template = args.find((a) => a.startsWith("--template="))?.slice(11) ?? "ride-0928";
if (!name || !file) { console.error("usage: fixture-from-gpx.cjs <name> <file.gpx> [--template=ride-0928]"); process.exit(1); }
const ROOT = path.resolve(__dirname, "../..");
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.spec.json"), "utf8"))[name];
if (!SPEC) throw new Error(`no fixture "${name}" in fixtures.spec.json`);
const gpx = fs.readFileSync(file, "utf8");
const attr = (s, k) => Number(new RegExp(`${k}="([-0-9.]+)"`).exec(s)[1]);
const unescape = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// <wpt>: start, stops, finish — name "Starts · X" / "1 · X" / "Finišs · X", desc the area.
const wpts = [...gpx.matchAll(/<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g)].map((m) => {
  const nm = unescape(/<name>([\s\S]*?)<\/name>/.exec(m[2])[1]).replace(/^[^·]*·\s*/, "");
  const desc = unescape(/<desc>([\s\S]*?)<\/desc>/.exec(m[2])?.[1] ?? "");
  return { name: nm, label: desc ? `${nm}, ${desc}` : nm, lat: attr(m[1], "lat"), lon: attr(m[1], "lon") };
});
// <rte>: every anchor in riding order; ShapingPoint = pass-through.
const rte = [...gpx.matchAll(/<rtept\b([^>]*)>([\s\S]*?)<\/rtept>/g)].map((m) => ({ lat: attr(m[1], "lat"), lon: attr(m[1], "lon"), shape: /ShapingPoint/.test(m[2]) }));
const shapePoints = [];
let placeIdx = 0;
rte.forEach((p, i) => { if (i === 0) return; if (p.shape) shapePoints.push({ lat: p.lat, lon: p.lon, afterPlace: placeIdx }); else placeIdx++; });
const coords = [...gpx.matchAll(/<trkpt\b([^>]*)\/?>/g)].map((m) => [attr(m[1], "lon"), attr(m[1], "lat")]);

const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
const features = [];
let cur = [coords[0]], len = 0, total = 0;
for (let i = 1; i < coords.length; i++) {
  const d = hv(coords[i - 1], coords[i]);
  cur.push(coords[i]); len += d; total += d;
  if (len >= 1000 || i === coords.length - 1) {
    features.push({ type: "Feature", geometry: { type: "LineString", coordinates: cur }, properties: { roadClass: "road", surface: "gravel", distanceMeters: Math.round(len) } });
    cur = [coords[i]]; len = 0;
  }
}

const tpl = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", template + ".json"), "utf8"));
const [start, ...rest] = wpts;
const finish = rest.pop();
const request = JSON.parse(JSON.stringify(tpl.request));
Object.assign(request.plan, { startPlace: start.name, viaPlaces: rest.map((v) => v.name), destinationPlace: finish.name, shapePoints, ...(SPEC.plan ?? {}) });
request.places = wpts.map(({ name, label, lat, lon }) => ({ name, label, lat, lon }));
request.prompt = `${wpts.map((w) => w.name).join(" → ")}, brīvs ilgums.`;
const title = unescape(/<metadata>[\s\S]*?<name>([\s\S]*?)<\/name>/.exec(gpx)[1]);
const tplRes = JSON.parse(tpl.response);
const route = {
  ...tplRes.routes[0],
  id: `gpx-${name}`,
  name: title,
  geometry: { type: "LineString", coordinates: coords },
  segments: { type: "FeatureCollection", features },
  distanceMeters: total,
  durationSeconds: Math.round(total / 9),
  overlap: { repeatedKm: 0, distinctKm: Math.round(total / 100) / 10, repeatedPercent: 0 },
  stops: rest.map((v) => ({ name: v.name, category: "via" })),
  sourcePrompt: request.prompt,
  variant: "direct",
};
const response = JSON.stringify({ ...tplRes, start: { lat: start.lat, lon: start.lon, label: start.label }, destination: { lat: finish.lat, lon: finish.lon, label: finish.label }, via: rest.map((v) => ({ lat: v.lat, lon: v.lon, label: v.label })), routes: [route], alternatives: [] });
const planCode = execFileSync("npx", ["tsx", path.join(__dirname, "encode-plan.ts")], { cwd: ROOT, input: JSON.stringify({ plan: request.plan, places: request.places }) }).toString();
const out = {
  name, description: SPEC.description, places: SPEC.places, shapePoints,
  recordedAt: new Date().toISOString(), source: `rider's GPX ${path.basename(file)} (template ${template})`,
  routes: [{ variant: "direct", km: Math.round(total / 100) / 10, points: coords.length }],
  planCode, request, response,
};
fs.writeFileSync(path.join(__dirname, "fixtures", name + ".json"), JSON.stringify(out, null, 1) + "\n");
console.log(`${name}: ${out.routes[0].km} km, ${coords.length} points, ${shapePoints.length} pass-through, places ${wpts.map((w) => w.name).join(" → ")}`);
