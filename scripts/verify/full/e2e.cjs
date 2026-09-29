const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "phone" : "desk";
const CHIP_RE = /^\d+(,\d)? → \d+(,\d)? km · [+−±-]?\d+ (min|h( \d+ min)?) · atkārtoti \d+ → \d+ %/;
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail) : ""}`); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const fit = L.fit;
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/e2e-ls-${tag}-${n}.png` });
  await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  if (phone) await shot("00-edit");
  const idle = await L.state(page);
  console.log("idle slots", JSON.stringify(idle.slots));

  const slot = async (n) => (await L.slotBtn(page, n)).click();
  const pointOn = async (frac, north = 0, east = 0) => {
    const c = await L.line(page);
    let tot = 0; const cum = [0];
    const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    for (let i = 1; i < c.length; i++) cum.push(tot += hv(c[i - 1], c[i]));
    const want = tot * frac; const i = cum.findIndex((m) => m >= want);
    const p = c[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(900); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); };
  const marker = (name) => page.locator(`.maplibregl-marker[aria-label="${name}"]`).first();
  const sheetRow = (label) => page.getByText(label, { exact: true }).first();

  // ── gestures ──
  let added = 0;
  const g = {
    addStop: async () => {
      const ll = await pointOn(0.3, 400, 0); await zoomTo(ll);
      await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    },
    batch: async () => {
      const a = await pointOn(0.55, 350, 250), b = await pointOn(0.6, -350, 250); await zoomTo(a);
      await slot(1); await page.waitForTimeout(400); await tapAt(a); await page.waitForTimeout(TAP_SETTLE);
      await zoomTo(b); const n = log.reroute; await tapAt(b);
      // B is named first (reverse geocode); its proposal is the batch's second route.
      for (let k = 0; k < 80 && log.reroute < n + 1; k++) await page.waitForTimeout(100);
    },
    dragStop: async () => {
      await fit(page, await L.line(page));
      await marker("Līgatne").click(); await page.waitForTimeout(500);
      await sheetRow("Pārvietot").click(); await page.waitForTimeout(1200);
      const box = await marker("Līgatne").boundingBox();
      const p = { x: box.x + box.width / 2 + 70, y: box.y + box.height / 2 - 40 };
      if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    },
    bend: async () => {
      const ll = await pointOn(0.8); await zoomTo(ll, 14);
      const p = await L.px(page, ll);
      if (phone) {
        const cdp = await page.context().newCDPSession(page);
        const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        await tp("touchStart", p.x, p.y); await page.waitForTimeout(450);
        for (let k = 1; k <= 10; k++) { await tp("touchMove", p.x + k * 8, p.y - k * 6); await page.waitForTimeout(30); }
        await tp("touchEnd");
      } else {
        await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(450);
        for (let k = 1; k <= 10; k++) { await page.mouse.move(p.x + k * 8, p.y - k * 6); await page.waitForTimeout(30); }
        await page.mouse.up();
      }
    },
    movePass: async () => {
      const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
      await dot.waitFor({ timeout: 5000 });
      await fit(page, await L.line(page));
      await dot.click(); await page.waitForTimeout(500);
      await sheetRow("Pārvietot").click(); await page.waitForTimeout(1200);
      const box = await dot.boundingBox();
      const p = { x: box.x + box.width / 2 - 60, y: box.y + box.height / 2 - 60 };
      if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y);
    },
    remove: async () => {
      await fit(page, await L.line(page));
      await marker("Līgatne").click(); await page.waitForTimeout(500);
      await sheetRow("Izņemt").click();
    },
  };
  const TAP_SETTLE = 700;

  async function exercise(name, gesture, { keep = false, cancelWith = "x" } = {}) {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page);
    await gesture();
    const s1 = await L.waitChip(page);
    // A stop at a dead end is a plain proposal again (rider, 2026-09-28): only profile / detour / a pass-through spur warn.
    const chipOk = (s1.chip?.tone === "proposed" || (name !== "add-stop" && s1.chip?.tone === "warn")) && CHIP_RE.test(s1.chip.text);
    rec(`${name}: chip`, chipOk, s1.chip);
    const haloM = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("proposal-halo")?.source); const d = src?._data?.geojson; const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }; return d ? d.features.map((f) => Math.round(f.geometry.coordinates.reduce((s, c, i, a) => s + (i ? hv(a[i - 1], c) : 0), 0))) : null; });
    console.log(`  ${name}: halo metres ${JSON.stringify(haloM)}`);
    rec(`${name}: halo over dimmed ride`, s1.proposalLayers.length > 0 && s1.routeOpacity !== null && JSON.stringify(s1.routeOpacity).includes("0.3"), { layers: s1.proposalLayers, opacity: s1.routeOpacity });
    if (!chipOk) { await shot(`fail-${name}`); console.log("warns", log.warns.slice(-3)); await slot("x"); await page.waitForTimeout(800); return; }
    await shot(`${name}-proposed`);
    // ✕
    if (cancelWith === "x") await slot("x"); else await page.keyboard.press("Escape");
    await page.waitForTimeout(900);
    const s2 = await L.state(page);
    rec(`${name}: ✕ leaves line + undo`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0 && !s2.chip && !s2.notices.some((t) => /Punkts pārvietots/.test(t)), { notices: s2.notices });
    // ✓
    await gesture(); const s3 = await L.waitChip(page);
    if (s3.chip?.tone !== "proposed" && s3.chip?.tone !== "warn") { rec(`${name}: second proposal`, false, s3.chip); await slot("x"); return; }
    const n0 = log.reroute;
    if (s3.chip.tone === "warn") {
      const ok = await L.slotBtn(page, 3);
      rec(`${name}: warned — ✓ is off, the chip says „Tomēr braukt” once`, (await ok.isDisabled()) && s3.chip.text.split("Tomēr braukt").length === 2, s3.chip.text);
      await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
    } else await slot(3);
    await page.waitForTimeout(1500);
    const s4 = await L.state(page); const h1 = L.hash(await L.line(page));
    rec(`${name}: ✓ commits, 0 extra reroute`, h1 !== h0 && log.reroute === n0 && !s4.chip && !s4.notices.some((t) => /Punkts pārvietots/.test(t)), { extra: log.reroute - n0, notices: s4.notices, changed: h1 !== h0 });
    rec(`${name}: undo enabled after ✓`, (await L.undoEnabled(page)) === true);
    // ↶
    await slot(2); await page.waitForTimeout(1200);
    rec(`${name}: ↶ undoes`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    if (keep) { await gesture(); const s5 = await L.waitChip(page); if (s5.chip?.tone === "proposed") { await slot(3); await page.waitForTimeout(1500); } else if (s5.chip?.tone === "warn") { await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click(); await page.waitForTimeout(1500); } }
  }

  await exercise("add-stop", g.addStop);
  await exercise("batch", g.batch);
  await exercise("drag-stop", g.dragStop, { cancelWith: "esc" });
  await exercise("bend", g.bend, { keep: true });
  await exercise("move-pass", g.movePass);
  await exercise("remove", g.remove);

  // ── ✓ while routing: the router slowed to 2.5 s so the state can be seen ──
  const slow = async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.fallback(); };
  await page.route("**/api/reroute-leg", slow);
  {
    const h0 = L.hash(await L.line(page));
    const ll = await pointOn(0.45, -400, 0); await zoomTo(ll);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    let busy = null;
    for (let k = 0; k < 200 && !busy; k++) { const s = await L.state(page); const c = s.slots.find((x) => x.slot === "3"); if (c?.confirm === "busy") busy = s; else await page.waitForTimeout(20); }
    if (busy) { await page.waitForTimeout(300); await shot("busy-confirm"); await slot(3); }
    await page.waitForTimeout(3000);
    const s = await L.state(page);
    rec("✓ while routing: spins in slot 3, commits on landing", !!busy && L.hash(await L.line(page)) !== h0 && !s.chip, { busySlots: busy?.slots, after: s.slots });
    if (busy) await slot(2), await page.waitForTimeout(1200);
  }

  // ── slot rects across states ──
  {
    const rects = {};
    rects.idle = (await L.state(page)).slots;
    const ll = await pointOn(0.5, 400, 0); await zoomTo(ll);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    for (let k = 0; k < 200; k++) { const s = await L.state(page); if (s.chip?.tone === "routing") { rects.routing = s.slots; break; } await page.waitForTimeout(15); }
    const sp = await L.waitChip(page); rects.proposed = sp.slots;
    if (sp.chip?.tone === "proposed") await shot("chip-halo");
    await slot("x"); await page.waitForTimeout(800);
    // refused: a stop in the Gulf of Riga
    await zoomTo([24.35, 57.25], 9);
    await slot(1); await page.waitForTimeout(400); await tapAt([24.35, 57.25]);
    const sr = await L.waitChip(page, ["refused"], 30000); rects.refused = sr.slots;
    if (sr.chip?.tone === "refused") await shot("refused");
    rec("refused state reached", sr.chip?.tone === "refused", sr.chip);
    await slot("x"); await page.waitForTimeout(800);
    const key = (arr, n) => arr?.find((x) => x.slot === n)?.rect ?? null;
    const same = ["1", "2", "3", "x"].map((n) => ({ n, v: Object.fromEntries(Object.entries(rects).map(([k, a]) => [k, key(a, n)])) }));
    for (const { n, v } of same) {
      const vals = Object.entries(v).map(([, x]) => x);
      rec(`slot ${n} rect stable, drawn in every state`, new Set(vals).size === 1 && !vals.includes(null) && vals.length === 4, v);
    }
  }

  await page.unroute("**/api/reroute-leg", slow);
  // ── kind switches in edit ──
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const n0 = log.reroute;
    await zoomTo(await pointOn(0.5), 11);
    await marker("Līgatne").click(); await page.waitForTimeout(500);
    await shot("sheet-stop");
    await sheetRow("Padarīt caurbraucamu").click(); await page.waitForTimeout(1200);
    const hasDot = await page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').count();
    rec("edit demote: line unchanged, no reroute, undo step", L.hash(await L.line(page)) === h0 && log.reroute === n0 && (await L.undoEnabled(page)) === true && hasDot > 0 && !(await marker("Līgatne").count()), { hasDot });
    const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
    await dot.click(); await page.waitForTimeout(500);
    await shot("sheet-pass");
    await sheetRow("Padarīt par pieturu").click(); await page.waitForTimeout(2500);
    rec("edit promote: line unchanged, no reroute", L.hash(await L.line(page)) === h0 && log.reroute === n0, {});
    await slot(2); await page.waitForTimeout(1000);
    const dotBack = await page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').count();
    rec("↶ after promote = one step (dot back)", dotBack > 0 && L.hash(await L.line(page)) === h0, { dotBack });
    await slot(2); await page.waitForTimeout(1000);
    rec("↶ after demote = one step (stop back)", (await marker("Līgatne").count()) > 0 && (await L.undoEnabled(page)) === u0, { stop: await marker("Līgatne").count(), undo: await L.undoEnabled(page), u0 });
  }

  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log("warns", log.warns);
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
