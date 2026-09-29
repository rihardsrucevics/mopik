// Smoke suite: the core edit flow on fixture rides and the router cache.
//   node scripts/verify/smoke.cjs phone|desk
// Normally run through smoke.sh, which runs both viewports in parallel.
if (!process.env.DPR) process.env.DPR = "1"; // see README: layout is in CSS px, DPR 1 is 4× fewer pixels
const L = require("./lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const T0 = Date.now();
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`[${tag}] ${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " " + JSON.stringify(detail) : ""}`); };
const CHIP_RE = /^\d+(,\d)? → \d+(,\d)? km · [+−±-]?\d+ (min|h( \d+ min)?) · atkārtoti \d+ → \d+ %/;
const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/smoke-${tag}-${n}.png` });
  const slot = async (n) => (await L.slotBtn(page, n)).click();
  const tapXY = async (x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); await tapXY(p.x, p.y); };
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(500); };
  const marker = (name) => page.locator(`.maplibregl-marker[aria-label="${name}"]`).first();
  const dotsLoc = () => page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]');
  const sheetRow = (label) => page.getByText(label, { exact: true }).first();
  const rects = async () => Object.fromEntries((await L.state(page)).slots.map((s) => [s.slot, s.rect]));
  const cum = async () => { const c = await L.line(page); const m = [0]; for (let i = 1; i < c.length; i++) m.push(m[i - 1] + hv(c[i - 1], c[i])); return { c, m, tot: m.at(-1) }; };
  const pointOn = async (frac, north = 0, east = 0) => {
    const { c, m, tot } = await cum(); const i = m.findIndex((x) => x >= tot * frac); const p = c[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  // The grab / drop pair the straight and guard scripts were tuned on (Antiņciems ride).
  const grabDrop = async (frac, dist, side) => {
    const { c, m: cm, tot } = await cum();
    const at = (x) => { const i = Math.max(1, cm.findIndex((y) => y >= x)); const t = (x - cm[i - 1]) / ((cm[i] - cm[i - 1]) || 1); return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; };
    const g = at(tot * frac), a = at(Math.min(tot, tot * frac + 30));
    const dx = (a[0] - g[0]) * Math.cos(g[1] * Math.PI / 180), dy = a[1] - g[1], n = Math.hypot(dx, dy) || 1;
    const n2 = side * dist * (dx / n), e2 = -side * dist * (dy / n);
    return { grab: g, drop: [g[0] + e2 / (111195 * Math.cos(g[1] * Math.PI / 180)), g[1] + n2 / 111195] };
  };
  const bend = async (grab, drop) => {
    await zoomTo(grab, 14);
    const p = await L.px(page, grab), q = await L.px(page, drop);
    if (phone) {
      const cdp = await page.context().newCDPSession(page);
      const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      await tp("touchStart", p.x, p.y); await page.waitForTimeout(450);
      for (let k = 1; k <= 12; k++) { await tp("touchMove", p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
      await tp("touchEnd");
    } else {
      await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(450);
      for (let k = 1; k <= 12; k++) { await page.mouse.move(p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
      await page.mouse.up();
    }
  };
  const moveMarker = async (loc, dx, dy) => {
    await loc.click(); await page.waitForTimeout(400);
    await sheetRow("Pārvietot").click(); await page.waitForTimeout(700);
    const box = await loc.boundingBox();
    await tapXY(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  };

  /**
   * One edit, the whole way: proposal → chip (numbers) → halo over a dimmed
   * ride → ✕ leaves everything → again → ✓ commits with no extra routing →
   * ↶ undoes. The four button slots keep their rects in every state.
   */
  async function exercise(name, gesture, { tones = ["proposed", "warn"], idle } = {}) {
    const t = Date.now();
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page);
    const r0 = idle ?? (await rects());
    await gesture();
    const s1 = await L.waitChip(page);
    const chipOk = tones.includes(s1.chip?.tone) && CHIP_RE.test(s1.chip.text);
    rec(`${name}: chip with numbers`, chipOk, s1.chip);
    rec(`${name}: halo over the dimmed ride`, s1.proposalLayers.length > 0 && JSON.stringify(s1.routeOpacity).includes("0.3"), { layers: s1.proposalLayers, opacity: s1.routeOpacity });
    rec(`${name}: slots did not move (proposal)`, JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    if (!chipOk) { await shot(`fail-${name}`); await slot("x"); await page.waitForTimeout(500); return; }
    await slot("x"); await page.waitForTimeout(500);
    const s2 = await L.state(page);
    rec(`${name}: ✕ leaves line and undo`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0 && !s2.chip);
    await gesture(); const s3 = await L.waitChip(page);
    if (!["proposed", "warn"].includes(s3.chip?.tone)) { rec(`${name}: second proposal`, false, s3.chip); await slot("x"); return; }
    const n0 = log.reroute;
    if (s3.chip.tone === "warn") await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
    else await slot(3);
    await page.waitForTimeout(800);
    const s4 = await L.state(page);
    rec(`${name}: ✓ commits, no extra routing`, L.hash(await L.line(page)) !== h0 && log.reroute === n0 && !s4.chip, { extra: log.reroute - n0 });
    rec(`${name}: ↶ enabled after ✓`, (await L.undoEnabled(page)) === true);
    rec(`${name}: slots did not move (committed)`, JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    await slot(2); await page.waitForTimeout(700);
    rec(`${name}: ↶ undoes`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    console.log(`[${tag}]   ${name} ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  // ── 1. Sigulda → Līgatne → Cēsis: add a stop, move a stop, the line sheet ──
  let t = Date.now();
  await L.openRide(page, "sigulda-cesis");
  console.log(`[${tag}]   openRide sigulda-cesis ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const idle = await rects();
  rec("edit mode: four slots drawn", ["1", "2", "3", "x"].every((k) => idle[k]), idle);
  await exercise("add stop", async () => { const ll = await pointOn(0.3, 400, 0); await zoomTo(ll); await slot(1); await page.waitForTimeout(300); await tapAt(ll); }, { tones: ["proposed"], idle });
  await exercise("move stop", async () => { await L.fit(page, await L.line(page)); await moveMarker(marker("Līgatne"), 70, -40); }, { idle });
  {
    const h0 = L.hash(await L.line(page)); const n0 = log.reroute;
    const ll = await pointOn(0.3); await zoomTo(ll, 13);
    await tapAt(ll); await page.waitForTimeout(500);
    const kind = await page.locator('[data-point-sheet="menu"]').getAttribute("data-sheet-kind").catch(() => null);
    rec("line sheet opens on a tap on the line", kind === "line", { kind });
    rec("line sheet: slots did not move", JSON.stringify(await rects()) === JSON.stringify(idle));
    const d0 = await dotsLoc().count();
    await page.getByText("Pievienot punktu šeit", { exact: true }).click(); await page.waitForTimeout(700);
    rec("„Pievienot punktu šeit”: one more dot, same line, nothing routed", (await dotsLoc().count()) === d0 + 1 && L.hash(await L.line(page)) === h0 && log.reroute === n0, { d0, d1: await dotsLoc().count(), reroutes: log.reroute - n0 });
    rec("…and ↶ is live", (await L.undoEnabled(page)) === true);
    await slot(2); await page.waitForTimeout(600);
    rec("…↶ takes the dot away", (await dotsLoc().count()) === d0);
  }

  // ── 2. The rider's ride-0928 (four pass-through points): move one ──
  t = Date.now();
  await L.openRide(page, "ride-0928");
  console.log(`[${tag}]   openRide ride-0928 ${((Date.now() - t) / 1000).toFixed(1)} s`);
  rec("ride-0928 opens with its four pass-through points", (await dotsLoc().count()) === 4, { dots: await dotsLoc().count() });
  await exercise("move pass-through point", async () => { await L.fit(page, await L.line(page)); await moveMarker(dotsLoc().nth(1), -50, -50); });

  // ── 3. Antiņciems → Puķes → Rīgas apvedceļš: „Vest pa taisno” and the „Tomēr braukt” guard ──
  t = Date.now();
  await L.openRide(page, "antinciems-rigas");
  console.log(`[${tag}]   openRide antinciems-rigas ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const { grab, drop } = await grabDrop(0.214642, 452.829, -1);
    await bend(grab, drop);
    const s1 = await L.waitChip(page, ["refused", "proposed", "warn"], 40000);
    const straight = page.locator("button:visible", { hasText: "Vest pa taisno" }).first();
    const offered = (await straight.count()) > 0;
    rec("no road there: refused, „Vest pa taisno” offered", s1.chip?.tone === "refused" && offered, s1.chip);
    rec("refused: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    if (offered) {
      await straight.click();
      const s2 = await L.waitChip(page, ["proposed", "warn"], 20000);
      rec("„Vest pa taisno” → a proposal", ["proposed", "warn"].includes(s2.chip?.tone), s2.chip);
      const ok = await L.slotBtn(page, 3);
      if (!(await ok.isDisabled())) await ok.click(); else await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
      await page.waitForTimeout(800);
      const drawn = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn).reduce((s, f) => s + (f.properties.distanceMeters || 0), 0); });
      rec("✓ keeps a drawn (straight) stretch in the ride", L.hash(await L.line(page)) !== h0 && drawn > 0, { drawn });
      await slot(2); await page.waitForTimeout(700);
      rec("↶ takes the straight stretch back", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else { await slot("x"); await page.waitForTimeout(500); await shot("fail-straight"); }
  }
  {
    // The guard: the strict profile cannot reach it (forced 422), the relaxed one can → warned.
    const force = async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (!body.relax) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "unreachable" }) });
      return route.fallback();
    };
    await page.route("**/api/reroute-leg", force);
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const { grab, drop } = await grabDrop(0.348306, 286.026, -1);
    await bend(grab, drop);
    const s = await L.waitChip(page, ["warn", "proposed", "refused"], 40000);
    const ok = await L.slotBtn(page, 3);
    rec("guard: warned, ✓ off, „Tomēr braukt” said once", s.chip?.tone === "warn" && (await ok.isDisabled()) && s.chip.text.split("Tomēr braukt").length === 2, s.chip);
    rec("guard: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    await page.evaluate(() => document.querySelectorAll('[data-slot="3"]').forEach((b) => b.click()));
    await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    rec("guard: a forced click on ✓ and Enter keep nothing", L.hash(await L.line(page)) === h0);
    const acc = page.locator("button:visible", { hasText: "Tomēr braukt" }).first();
    if (await acc.count()) {
      await acc.click(); await page.waitForTimeout(900);
      rec("„Tomēr braukt” commits", L.hash(await L.line(page)) !== h0 && (await L.undoEnabled(page)) === true);
      await slot(2); await page.waitForTimeout(700);
      rec("↶ after „Tomēr braukt”", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else rec("„Tomēr braukt” offered", false);
    await page.unroute("**/api/reroute-leg", force);
  }

  await shot("end");
  // A 422 is how /api/reroute-leg says "no road reaches it" — the refused and
  // guard cases above ask for exactly that, and Chromium logs every non-2xx load.
  const errors = log.errors.filter((e) => !/status of 422 \(Unprocessable Entity\)/.test(e));
  rec("no console errors", errors.length === 0, errors.slice(0, 5));
  const fail = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`[${tag}] ${L.cacheSummary()}${L.cacheStats.misses.length ? " — misses: " + [...new Set(L.cacheStats.misses)].join(", ") : ""}`);
  console.log(`[${tag}] ${results.length - fail.length}/${results.length} pass in ${((Date.now() - T0) / 1000).toFixed(1)} s${fail.length ? " — FAIL: " + fail.join("; ") : ""}`);
  if (L.cacheStats.missBodies.length) require("fs").writeFileSync(`${__dirname}/out/misses-${tag}.json`, JSON.stringify(L.cacheStats.missBodies, null, 1));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(`[${tag}]`, e); process.exit(2); });
