// The in-between phase (rider, 2026-09-28): from the instant a pin is dropped
// until its proposal lands, something must always say what is happening —
// the chip (routing / proposed / refused) or ✓'s spinner — and ✓ must be
// pressable. Samples every 20 ms in the page.
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail) : ""}`); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  let ladder = 0;
  page.on("request", (r) => { if (r.url().includes("/api/reroute-leg")) { const b = JSON.parse(r.postData()); if (b.relax || b.keepSpurs) ladder++; console.log("  reroute", Date.now() % 100000, "runs", b.runs.length, b.runs.map((x) => x.length).join(","), (b.plan.viaPlaces || []).join("/"), "relax", b.relax ?? 0, "keepSpurs", b.keepSpurs ?? false); } });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/guidance-${n}-${tag}.png` });
  await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const pointOn = async (frac, north = 0, east = 0) => {
    const c = await L.line(page); let tot = 0; const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(tot += hv(c[i - 1], c[i]));
    const i = cum.findIndex((m) => m >= tot * frac); const p = c[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(900); };
  const tapXY = async (x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); await tapXY(p.x, p.y); };
  const slot = async (n) => (await L.slotBtn(page, n)).click();

  // The sampler: what the rider sees, every 20 ms.
  const startSampling = () => page.evaluate(() => {
    window.__samples = [];
    // The drop: the release of the finger or the button (the last one wins —
    // a tap's click follows its touchend).
    window.__dropAt = Infinity;
    if (!window.__dropHooked) {
      window.__dropHooked = true;
      for (const type of ["touchend", "mouseup", "click"]) window.addEventListener(type, () => { window.__dropAt = performance.now(); }, true);
    }
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    window.__sampler = setInterval(() => {
      const chip = document.querySelector("[data-proposal-chip]");
      const c = [...document.querySelectorAll('[data-slot="3"]')].find(vis);
      const pending = document.querySelector('[data-map-pending="true"]') !== null;
      window.__samples.push({ t: performance.now(), pending, chip: chip?.dataset.proposalChip ?? null, confirm: c?.dataset.confirm ?? null, disabled: c ? c.disabled : null, guide: document.querySelector("[data-edit-guide]")?.textContent ?? null });
    }, 20);
  });
  const stopSampling = () => page.evaluate(() => { clearInterval(window.__sampler); return window.__samples.filter((s) => s.t >= window.__dropAt); });

  async function measure(name, gesture, { commit = false } = {}) {
    const n0 = log.reroute; const l0 = ladder;
    // `gesture` gets ready (opens the sheet, zooms, holds the line) and
    // returns the drop itself; sampling starts just before the drop.
    const drop = await gesture();
    await startSampling();
    await drop();
    const landed = await L.waitChip(page, ["proposed", "refused", "warn"], 30000);
    await page.waitForTimeout(100);
    const samples = await stopSampling();
    // From the first sample with something pending until the proposal landed.
    const first = samples.findIndex((s) => s.pending);
    const done = samples.findIndex((s, i) => i >= first && (s.chip === "proposed" || s.chip === "refused" || s.chip === "warn"));
    const window = first >= 0 ? samples.slice(first, done >= 0 ? done + 1 : undefined) : [];
    const gaps = window.filter((s) => s.pending && !s.chip && s.confirm !== "busy");
    const offWhileRouting = window.filter((s) => s.pending && s.chip === "routing" && s.disabled);
    const routingSeen = window.some((s) => s.chip === "routing" || s.confirm === "busy");
    rec(`${name}: no gap from drop to proposal (${window.length} samples, ${window.length ? Math.round(window[window.length - 1].t - window[0].t) : 0} ms)`, first >= 0 && done >= 0 && gaps.length === 0, { gaps: gaps.length, sample: gaps.slice(0, 3), landed: landed.chip?.tone, text: landed.chip?.text, reroutes: log.reroute - n0 });
    rec(`${name}: ✓ pressable while routing`, offWhileRouting.length === 0 && routingSeen, { off: offWhileRouting.length, routingSeen });
    rec(`${name}: one routing request (its own rung; ${ladder - l0} ladder rungs after)`, log.reroute - n0 - (ladder - l0) === 1, { reroutes: log.reroute - n0, ladder: ladder - l0 });
    if (commit && landed.chip?.tone === "proposed") { await slot(3); await page.waitForTimeout(1500); } else { await slot("x"); await page.waitForTimeout(900); }
  }

  // Slow the router so the routing phase is long enough to see and to press.
  const slow = async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); };
  await page.route("**/api/reroute-leg", slow);

  // pin move: Līgatne → „Pārvietot” → a tap
  await measure("pin move", async () => {
    await L.fit(page, await L.line(page));
    await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().click(); await page.waitForTimeout(500);
    await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(900);
    const box = await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().boundingBox();
    return () => tapXY(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40);
  });
  // new stop: „+” → a tap
  await measure("new stop", async () => {
    const ll = await pointOn(0.3, 400, 0); await zoomTo(ll);
    await slot(1); await page.waitForTimeout(400);
    return () => tapAt(ll);
  });
  // line bend: hold-drag
  await measure("line bend", async () => {
    const ll = await pointOn(0.8); await zoomTo(ll, 14);
    const p = await L.px(page, ll);
    if (phone) {
      const cdp = await page.context().newCDPSession(page);
      const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
      await tp("touchStart", p.x, p.y); await page.waitForTimeout(450);
      for (let k = 1; k <= 10; k++) { await tp("touchMove", p.x + k * 8, p.y - k * 6); await page.waitForTimeout(30); }
      return () => tp("touchEnd");
    }
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(450);
    for (let k = 1; k <= 10; k++) { await page.mouse.move(p.x + k * 8, p.y - k * 6); await page.waitForTimeout(30); }
    return () => page.mouse.up();
  }, { commit: true });
  // pass-through move: the bend's dot → „Pārvietot” → a tap
  await measure("pass-through move", async () => {
    const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
    await dot.waitFor({ timeout: 8000 });
    await dot.click(); await page.waitForTimeout(500);
    await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(900);
    const box = await dot.boundingBox();
    return () => tapXY(box.x + box.width / 2 - 60, box.y + box.height / 2 - 60);
  });

  // ✓ pressed the instant the pin lands (while it is still being named and routed): it commits when ready, under its name.
  {
    await L.fit(page, await L.line(page));
    const h0 = L.hash(await L.line(page));
    await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().click(); await page.waitForTimeout(500);
    await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(900);
    const box = await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().boundingBox();
    await tapXY(box.x + box.width / 2 + 50, box.y + box.height / 2 + 40);
    await page.waitForTimeout(phone ? 350 : 60);
    const at = await L.state(page);
    await shot("routing");
    await slot(3);
    // Committed as soon as the line lands; the name follows when the lookup answers.
    await page.waitForTimeout(2500);
    const committedAt = { chip: (await L.state(page)).chip, changed: L.hash(await L.line(page)) !== h0 };
    let names = [];
    for (let k = 0; k < 60; k++) {
      names = await page.evaluate(() => [...document.querySelectorAll("input")].map((e) => e.value).filter(Boolean));
      if (!names.some((n) => /^\d+[.,]\d{3,}/.test(n))) break;
      await page.waitForTimeout(500);
    }
    console.log("  committed before the name:", JSON.stringify(committedAt));
    const h1 = L.hash(await L.line(page));
    rec("✓ at once: committed when ready, the stop named (not coordinates)", h1 !== h0 && !(await L.state(page)).chip && names.length >= 3 && !names.some((n) => /^\d+[.,]\d{3,}/.test(n)), { atPress: at.slots.find((s) => s.slot === "3"), names: names.slice(0, 4) });
    await slot(2); await page.waitForTimeout(1200);
  }
  await page.unroute("**/api/reroute-leg", slow);
  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
