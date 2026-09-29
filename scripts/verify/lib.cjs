// Shared helpers for the verification kit. See README.md.
//
// Env:
//   PORT (3290)       the dev server this agent started — each agent its own port
//   BASE              full base URL instead of PORT (e.g. a preview deployment)
//   SHOTS             screenshot directory (default scripts/verify/out/shots)
//   RECORD=1 / CACHE=off|stale-ok   see cache.cjs
//   TILES=blank|cache|live          OSM raster tiles (default blank; see README)
//   GL=swiftshader|gpu              WebGL backend (default swiftshader: identical on every machine)
//   DPR               phone device scale factor (default 1 in smoke, 2 in full)
const fs = require("fs");
const path = require("path");
const { installCache, summary: cacheSummary, stats: cacheStats } = require("./cache.cjs");

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, "playwright", "/Users/rr/.npm/_npx/e41f203b7505f1fb/node_modules/playwright"].filter(Boolean);
  for (const t of tries) { try { return require(t); } catch {} }
  throw new Error("playwright not found: `npm i -D playwright` or set PLAYWRIGHT_PATH to its folder");
}
const { chromium, devices } = loadPlaywright();

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || 3290}`;
const SHOTS = process.env.SHOTS || path.join(__dirname, "out", "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const PLACES = JSON.parse(fs.readFileSync(path.join(__dirname, "places.json"), "utf8"));
const FIXTURES = path.join(__dirname, "fixtures");
const TILE_DIR = path.join(__dirname, "cache", "tiles");
// A 1×1 light-grey PNG: the map still draws every layer of ours on top of it.
const BLANK_TILE = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN49+YFAAWOAsPjYYTVAAAAAElFTkSuQmCC", "base64");

function launchArgs() {
  if (process.env.GL === "gpu") return ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];
  return ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
}

async function installTiles(context) {
  const mode = process.env.TILES || "blank";
  if (mode === "live") return;
  await context.route(/tile\.openstreetmap\.org\//, async (route) => {
    if (mode === "blank") return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_TILE });
    const u = new URL(route.request().url());
    const file = path.join(TILE_DIR, u.pathname.replace(/[^0-9/]/g, "").split("/").filter(Boolean).join("_") + ".png");
    if (fs.existsSync(file)) return route.fulfill({ status: 200, contentType: "image/png", body: fs.readFileSync(file) });
    try {
      const res = await route.fetch();
      const body = await res.body();
      if (res.status() === 200) { fs.mkdirSync(TILE_DIR, { recursive: true }); fs.writeFileSync(file, body); }
      return route.fulfill({ status: res.status(), contentType: "image/png", body });
    } catch { return route.abort(); }
  });
}

/** Place search stub: the first three letters of `q` pick a place from places.json. */
async function installPlaces(context) {
  if (process.env.PLACES === "live") return;
  await context.route(/\/api\/places\?(?=.*\bq=)/, (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    const p = PLACES[q];
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: p ? [p] : [] }) });
  });
}

async function open({ phone, dpr } = {}) {
  const browser = await chromium.launch({ headless: true, args: launchArgs() });
  const scale = Number(dpr ?? process.env.DPR ?? 2);
  const context = phone
    ? await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 375, height: 812 }, deviceScaleFactor: scale, hasTouch: true, isMobile: true })
    : await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await installTiles(context);
  await installPlaces(context);
  await installCache(context);
  const page = await context.newPage();
  const log = { reroute: 0, generate: [], errors: [], warns: [], exports: [] };
  page.on("request", (r) => {
    if (r.url().includes("/api/reroute-leg")) log.reroute++;
    if (r.url().includes("/api/generate-route")) log.generate.push(r.postData());
    if (r.url().includes("/api/export-gpx")) log.exports.push(r.postData());
  });
  page.on("console", (m) => {
    if (m.type() === "error") log.errors.push(m.text());
    if (m.type() === "warning" && m.text().includes("mopik")) log.warns.push(m.text());
  });
  page.on("pageerror", (e) => log.errors.push("pageerror: " + e.message));
  return { browser, context, page, log };
}

// ── fixtures ──────────────────────────────────────────────────────────────

function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name + ".json"), "utf8"));
}
function fixtureNames() {
  return fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
}
/**
 * The plain fixture (no shaping points) for these places, if one exists.
 * Places compare by their first three letters, the rule the place stub uses
 * ("Grostonas" in a script is the fixture's "Grostonas iela 19").
 */
function fixtureFor(places) {
  const key = (list) => list.map((p) => p.toLowerCase().slice(0, 3)).join("|");
  for (const n of fixtureNames()) {
    const f = fixture(n);
    if (!f.shapePoints?.length && key(f.places) === key(places)) return f;
  }
  return null;
}

/**
 * Load a fixture ride into the planner and stop on its result: the plan comes
 * in `?p=` (with `go=1`, which generates on arrival) and /api/generate-route is
 * answered with the recorded generation. No form, no router: ~2 s.
 */
async function loadRide(page, f) {
  const handler = (route) => route.fulfill({ status: 200, contentType: "application/json", body: f.response });
  await page.route("**/api/generate-route", handler);
  await page.goto(`${BASE}/?lang=lv&p=${encodeURIComponent(f.planCode)}&go=1`);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).waitFor({ timeout: 30000 });
  await page.unroute("**/api/generate-route", handler);
  await page.waitForTimeout(500);
}

/** Open a fixture ride and enter edit mode („Labot”). */
async function openRide(page, name) {
  await loadRide(page, fixture(name));
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.locator('[data-slot="1"]:visible').first().waitFor({ timeout: 15000 });
  // The map's own fit animation settles before the first gesture.
  await page.waitForTimeout(900);
}

// ── the old form path (kept for scripts that test the form itself) ──────

async function pick(page, input, text) {
  await input.click();
  await input.fill("");
  await input.type(text, { delay: 20 });
  const opt = page.locator('[role="option"]').first();
  await opt.waitFor({ timeout: 15000 });
  await page.waitForTimeout(300);
  await page.locator('[role="option"]').first().click();
  await page.waitForTimeout(400);
}

let pendingFixture = null;
/**
 * Fill the form: places [start, ...stops, finish], one way. When a plain
 * fixture exists for exactly these places (and FIXTURES is not "off"), the
 * form is skipped: the ride is loaded from the fixture by the following
 * `generate()` — the ported scripts need no other change.
 */
async function plan(page, places) {
  const f = process.env.FIXTURES === "off" ? null : fixtureFor(places);
  if (f) { pendingFixture = f; return; }
  pendingFixture = null;
  await page.goto(BASE + "/?lang=lv");
  await page.waitForTimeout(1500);
  await pick(page, page.getByPlaceholder("Pilsēta, adrese vai vieta").first(), places[0]);
  await pick(page, page.getByPlaceholder("Nav obligāts — man vienalga").first(), places.at(-1));
  for (const stop of places.slice(1, -1)) {
    await page.getByRole("button", { name: "Pievienot pieturvietu" }).click();
    await page.waitForTimeout(300);
    const inputs = page.getByPlaceholder("Nav obligāts — man vienalga");
    // The new stop row is the empty one („Pievienot pieturvietu” leaves focus on the button).
    const vals = await inputs.evaluateAll((els) => els.map((e) => e.value));
    await pick(page, inputs.nth(Math.max(0, vals.indexOf(""))), stop);
  }
}

async function generate(page) {
  if (pendingFixture) { const f = pendingFixture; pendingFixture = null; return loadRide(page, f); }
  await page.getByRole("button", { name: "Izveidot maršrutu" }).click();
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).waitFor({ timeout: Number(process.env.GEN_TIMEOUT || 90000) });
  await page.waitForTimeout(1500);
}

// ── map and edit-state probes (unchanged from the pw32xx scripts) ────────

/** The ride's drawn line (route source), as [lon,lat][] */
async function line(page) {
  return page.evaluate(() => {
    const m = window.__map;
    const src = m.getSource(m.getLayer("route-road").source);
    const data = src._data?.geojson ?? src.serialize().data;
    const fs = typeof data === "string" ? [] : data.features ?? [];
    const out = [];
    for (const f of fs) for (const c of f.geometry.coordinates) out.push(c);
    return out;
  });
}
const hash = (coords) => `${coords.length}:${coords.reduce((s, c) => s + c[0] * 7 + c[1] * 13, 0).toFixed(6)}`;

async function px(page, lonlat) {
  return page.evaluate((ll) => {
    const m = window.__map;
    const p = m.project(ll);
    const r = m.getContainer().getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  }, lonlat);
}
async function fit(page, coords, padding = 60) {
  await page.evaluate(({ coords, padding }) => {
    const m = window.__map;
    const lons = coords.map((c) => c[0]), lats = coords.map((c) => c[1]);
    m.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding, duration: 0 });
  }, { coords, padding });
  await page.waitForTimeout(500);
}
async function state(page) {
  return page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const slots = [...document.querySelectorAll("[data-slot]")].filter(vis).map((e) => {
      const r = e.getBoundingClientRect();
      return { slot: e.dataset.slot, rect: [r.x, r.y, r.width, r.height].map(Math.round).join(","), confirm: e.dataset.confirm ?? null, label: e.getAttribute("aria-label"), disabled: e.disabled, invisible: getComputedStyle(e).visibility === "hidden" };
    });
    const chip = document.querySelector("[data-proposal-chip]");
    const m = window.__map;
    const layers = m?.getStyle ? m.getStyle().layers.map((l) => l.id) : [];
    const op = m?.getLayer && m.getLayer("route-road") ? m.getPaintProperty("route-road", "line-opacity") : null;
    const notices = [...document.querySelectorAll('[role="status"]')].filter(vis).map((e) => e.textContent.trim()).filter(Boolean);
    return { slots, chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null, proposalLayers: layers.filter((id) => /propos/i.test(id)), routeOpacity: op, notices };
  });
}
async function waitChip(page, tones = ["proposed", "refused", "warn"], timeout = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await state(page);
    if (s.chip && tones.includes(s.chip.tone)) {
      // The halo is drawn in the map's effect, a frame after the chip renders.
      if ((s.chip.tone === "proposed" || s.chip.tone === "warn") && !s.proposalLayers.length && Date.now() - t0 < timeout) { await page.waitForTimeout(40); const s2 = await state(page); if (s2.proposalLayers.length || (s2.chip?.tone !== "proposed" && s2.chip?.tone !== "warn")) return s2; continue; }
      return s;
    }
    await page.waitForTimeout(100);
  }
  return state(page);
}
async function slotBtn(page, slot) {
  return page.locator(`[data-slot="${slot}"]:visible`).first();
}
async function undoEnabled(page) {
  const b = await slotBtn(page, 2);
  return (await b.count()) ? !(await b.isDisabled()) : null;
}

module.exports = { open, openRide, loadRide, fixture, fixtureNames, fixtureFor, plan, generate, line, hash, px, fit, state, waitChip, slotBtn, undoEnabled, SHOTS, BASE, pick, PLACES, cacheSummary, cacheStats };
