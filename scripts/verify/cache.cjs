// Record / replay for the router-backed API routes, as a Playwright `page.route` layer.
//
//   default     replay: a hit is answered from scripts/verify/cache/api/<hash>.json,
//               a miss falls through to the dev server (which calls whatever
//               BROUTER_BASE_URL it was started with) and is counted.
//   RECORD=1    a miss is fetched from the dev server and written to the cache.
//   CACHE=off   no layer at all: every call goes to the dev server.
//   CACHE=stale-ok  replay even though routing code changed since recording.
//
// The key is sha256(method + path + query + body). The cache also stores a
// under a fingerprint of the server routing code (see FINGERPRINT_PATHS): when
// that code changes, the recordings are stale and are NOT replayed — every
// call goes to the real router and the run says so, until RECORD=1 is run
// again (CACHE=stale-ok replays the newest old recording on purpose).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(__dirname, "cache", "api");

/** The API routes whose answers are recorded. Everything else goes live. */
const ROUTES = ["/api/reroute-leg", "/api/routable-point", "/api/detour", "/api/route-pois"];
/** Reverse geocoding (Photon) is recorded too: it is slow and not what the edit flow tests. */
const REVERSE_PLACES = /\/api\/places\?(?=.*\blat=)/;

/** Server code that decides what a recorded answer says. Changing any of it makes the cache stale. */
const FINGERPRINT_PATHS = [
  "app/api/reroute-leg", "app/api/routable-point", "app/api/detour", "app/api/route-pois", "app/api/places",
  "lib/routing", "lib/geo", "lib/chat/ride-plan.ts", "lib/chat/ride-limits.ts", "lib/poi",
];

function walk(p, out) {
  const abs = path.join(ROOT, p);
  if (!fs.existsSync(abs)) return;
  const st = fs.statSync(abs);
  if (st.isDirectory()) for (const f of fs.readdirSync(abs).sort()) walk(path.join(p, f), out);
  else if (/\.(ts|tsx|js|mjs|cjs|json)$/.test(p) && !/\.test\./.test(p)) out.push(p);
}
function fingerprint() {
  const files = [];
  for (const p of FINGERPRINT_PATHS) walk(p, files);
  const h = crypto.createHash("sha256");
  for (const f of files) { h.update(f); h.update(fs.readFileSync(path.join(ROOT, f))); }
  return h.digest("hex").slice(0, 16);
}

function mode() {
  if (process.env.CACHE === "off") return "off";
  if (process.env.RECORD === "1") return "record";
  return "replay";
}

const stats = { hit: 0, miss: 0, recorded: 0, stale: false, misses: [], missBodies: [] };

/**
 * Recordings live in cache/api/<fingerprint>/, so a routing-code change can
 * never replay an answer recorded against the old code. Returns the directory
 * to read from, or null when there is none for the current code.
 */
let dirChosen;
function cacheDir() {
  if (dirChosen !== undefined) return dirChosen;
  const now = fingerprint();
  const cur = path.join(DIR, now);
  if (mode() === "record") {
    fs.mkdirSync(cur, { recursive: true });
    // Older fingerprints are dead weight once a fresh recording exists.
    for (const d of fs.readdirSync(DIR)) if (d !== now) fs.rmSync(path.join(DIR, d), { recursive: true, force: true });
    return (dirChosen = cur);
  }
  if (fs.existsSync(cur)) return (dirChosen = cur);
  stats.stale = true;
  if (process.env.CACHE === "stale-ok" && fs.existsSync(DIR)) {
    const dirs = fs.readdirSync(DIR).map((d) => path.join(DIR, d)).filter((d) => fs.statSync(d).isDirectory()).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    return (dirChosen = dirs[0] ?? null);
  }
  return (dirChosen = null);
}

function keyOf(req) {
  const u = new URL(req.url());
  return crypto.createHash("sha256").update(`${req.method()} ${u.pathname}${u.search}\n${req.postData() ?? ""}`).digest("hex").slice(0, 24);
}

/** Install the layer on a page (or context). Returns the stats object. */
async function installCache(target) {
  const m = mode();
  if (m === "off") return stats;
  const dir = cacheDir();
  const handler = async (route) => {
    const req = route.request();
    const key = keyOf(req);
    const file = dir && path.join(dir, key + ".json");
    if (file && fs.existsSync(file)) {
      const rec = JSON.parse(fs.readFileSync(file, "utf8"));
      stats.hit++;
      return route.fulfill({ status: rec.status, contentType: rec.contentType ?? "application/json", body: rec.body });
    }
    stats.miss++;
    stats.misses.push(new URL(req.url()).pathname);
    stats.missBodies.push({ url: req.url(), body: req.postData() ?? null });
    if (m !== "record") return route.fallback();
    let res;
    try { res = await route.fetch({ timeout: 120000 }); } catch (e) { return route.abort(); }
    const body = await res.text();
    // An aborted or failed call is not an answer worth replaying.
    if (res.status() < 500) {
      fs.writeFileSync(file, JSON.stringify({ url: new URL(req.url()).pathname + new URL(req.url()).search, status: res.status(), contentType: res.headers()["content-type"], request: req.postData() ?? null, body }) + "\n");
      stats.recorded++;
    }
    return route.fulfill({ status: res.status(), headers: res.headers(), body });
  };
  for (const r of ROUTES) await target.route(`**${r}`, handler);
  await target.route(REVERSE_PLACES, handler);
  return stats;
}

function summary() {
  const m = mode();
  if (m === "off") return "cache off";
  const s = `cache ${m}: ${stats.hit} hit, ${stats.miss} miss${m === "record" ? `, ${stats.recorded} recorded` : ""}`;
  if (stats.stale && process.env.CACHE === "stale-ok") return `${s} — replayed a recording made for OLDER routing code (CACHE=stale-ok)`;
  return stats.stale ? `${s} — STALE: routing code changed since recording, every call went to the real router. Re-record: RECORD=1` : s;
}

module.exports = { installCache, summary, stats, fingerprint, FINGERPRINT_PATHS };
