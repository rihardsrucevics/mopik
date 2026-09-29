const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail) : ""}`); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/line-sheet-${n}-${tag}.png` });
  await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);

  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const pointOn = async (frac, north = 0, east = 0) => {
    const c = await L.line(page);
    let tot = 0; const cum = [0];
    for (let i = 1; i < c.length; i++) cum.push(tot += hv(c[i - 1], c[i]));
    const want = tot * frac; const i = cum.findIndex((m) => m >= want);
    const p = c[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(900); };
  const tapXY = async (x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); await tapXY(p.x, p.y); };
  const SETTLE = 700;
  const sheet = () => page.locator('[data-point-sheet="menu"]');
  const sheetInfo = async () => page.evaluate(() => {
    const el = document.querySelector('[data-point-sheet="menu"]');
    if (!el) return null;
    const rows = [...el.querySelectorAll("button")].map((b) => ({ text: (b.querySelector("span span")?.textContent ?? b.textContent).trim(), disabled: b.disabled })).filter((r) => r.text);
    return { kind: el.dataset.sheetKind, label: el.getAttribute("aria-label"), rows };
  });
  const dots = () => page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').count();
  const slotRects = async () => (await L.state(page)).slots.map((s) => `${s.slot}:${s.rect}`).join(" ");

  // ── 1. the one-time hint ──
  const tip = page.locator("[data-edit-tip]");
  const tipShown = await tip.isVisible().catch(() => false);
  const tipText = tipShown ? (await tip.textContent()).trim() : null;
  let tipClear = null;
  if (tipShown) {
    tipClear = await page.evaluate(() => {
      const t = document.querySelector("[data-edit-tip]").getBoundingClientRect();
      const cols = [...document.querySelectorAll("[data-slot]")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0);
      return cols.every((r) => t.right <= r.left || t.left >= r.right || t.bottom <= r.top || t.top >= r.bottom);
    });
  }
  rec("hint shows on first edit entry, clear of the buttons", tipShown && tipText === "Pieskaries līnijai vai punktam, lai to mainītu" && tipClear === true, { tipText, tipClear });
  await shot("hint");
  const idleRects = await slotRects();

  // ── 2. desktop hover: grab cursor + tooltip ──
  if (!phone) {
    const ll = await pointOn(0.5); await zoomTo(ll, 13);
    const p = await L.px(page, ll);
    await page.mouse.move(p.x - 3, p.y); await page.mouse.move(p.x, p.y); await page.waitForTimeout(300);
    const hover = await page.evaluate(() => ({ cursor: window.__map.getCanvas().style.cursor, tip: document.querySelector("[data-line-tip]")?.textContent ?? null, shown: document.querySelector("[data-line-tip]")?.parentElement?.style.display }));
    rec("hover: grab cursor and the tooltip", hover.cursor === "grab" && hover.tip === "Velc, lai virzītu caur citu vietu · pieskaries, lai redzētu iespējas" && hover.shown === "grid", hover);
    await shot("hover");
  }

  // ── 3. tap the line → the line sheet ──
  const h0 = L.hash(await L.line(page));
  const n0 = log.reroute;
  const ll1 = await pointOn(0.3); await zoomTo(ll1, 13);
  await tapAt(ll1); await page.waitForTimeout(SETTLE);
  const s1 = await sheetInfo();
  rec("tap on the line opens the line sheet", s1?.kind === "line" && /^Ceļa posms · \d+([,.]\d)? km/.test(s1.label) && s1.rows.some((r) => r.text === "Virzīt caur citu vietu" && !r.disabled) && s1.rows.some((r) => r.text === "Pievienot punktu šeit" && !r.disabled) && s1.rows.some((r) => r.text === "Atcelt"), s1);
  rec("hint gone after the first tap", !(await tip.isVisible().catch(() => false)));
  rec("a tap routes nothing, grabs nothing", log.reroute === n0 && L.hash(await L.line(page)) === h0 && !(await L.state(page)).chip);
  rec("slots unchanged with the sheet open", (await slotRects()) === idleRects, { idleRects, now: await slotRects() });
  await shot("sheet");

  // Atcelt closes it
  await page.getByRole("button", { name: "Atcelt", exact: true }).last().click(); await page.waitForTimeout(400);
  rec("Atcelt closes the sheet", !(await sheet().count()));

  // ── 4. „Pievienot punktu šeit” ──
  {
    const d0 = await dots();
    await tapAt(ll1); await page.waitForTimeout(SETTLE);
    await page.getByText("Pievienot punktu šeit", { exact: true }).click(); await page.waitForTimeout(1200);
    const d1 = await dots();
    const h1 = L.hash(await L.line(page));
    rec("„Pievienot punktu šeit”: a dot, the line identical, nothing routed", d1 === d0 + 1 && h1 === h0 && log.reroute === n0 && !(await sheet().count()), { d0, d1, same: h1 === h0, reroutes: log.reroute - n0 });
    rec("…and ↶ is live", (await L.undoEnabled(page)) === true);
    await shot("pass-added");
    await (await L.slotBtn(page, 2)).click(); await page.waitForTimeout(1000);
    rec("…one ↶ takes exactly it back", (await dots()) === d0 && L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === false, { dots: await dots() });
  }

  // ── 5. „Virzīt caur citu vietu” ──
  {
    const d0 = await dots();
    const ll = await pointOn(0.78); await zoomTo(ll, 13);
    await tapAt(ll); await page.waitForTimeout(SETTLE);
    await page.getByText("Virzīt caur citu vietu", { exact: true }).click(); await page.waitForTimeout(500);
    const hint = await page.locator('[data-point-sheet="move"]').textContent().catch(() => null);
    rec("„Virzīt…”: the hint takes the sheet's place", (hint?.includes("Norādi kartē, caur kurieni braukt") || hint?.includes("Virzi posmu – pieskaries vietai, caur kuru braukt.")) && !(await sheet().count()), { hint });
    if (!phone) { const p = await L.px(page, await pointOn(0.78, 350, 250)); await page.mouse.move(p.x, p.y); await page.waitForTimeout(200); }
    await shot("via-hint");
    rec("slots unchanged in the hint state", (await slotRects()) === idleRects, { now: await slotRects() });
    const target = await pointOn(0.78, 400, 300);
    await tapAt(target);
    const sp = await L.waitChip(page);
    rec("the next tap is the new place: a proposal", sp.chip?.tone === "proposed" && log.reroute > n0, sp.chip);
    // Release B (c0662b6): one grey connector prev → new → next while pending; it goes when the proposal lands.
    const previewNow = () => page.evaluate(() => { const s = window.__map.getSource("move-preview"); return s?._data?.geojson?.features?.length ?? null; });
    let preview = await previewNow(); const t0 = Date.now();
    while (preview && Date.now() - t0 < 3000) { await page.waitForTimeout(150); preview = await previewNow(); }
    rec("the pending connector goes when the proposal lands", !preview, { preview, ms: Date.now() - t0 });
    await shot("via-proposed");
    await (await L.slotBtn(page, 3)).click(); await page.waitForTimeout(1500);
    const h2 = L.hash(await L.line(page));
    rec("✓ commits: line changed, one new pass-through dot, state over", h2 !== h0 && (await dots()) === d0 + 1 && !(await L.state(page)).chip && !(await page.locator('[data-point-sheet]').count()), { dots: await dots() });
    await (await L.slotBtn(page, 2)).click(); await page.waitForTimeout(1200);
    rec("↶ undoes it", L.hash(await L.line(page)) === h0 && (await dots()) === d0);
  }

  // ── 6. a tap on the line right beside a pin opens the pin's sheet ──
  {
    await L.fit(page, await L.line(page));
    const pin = page.locator('.maplibregl-marker[aria-label="Līgatne"]').first();
    const box = await pin.boundingBox();
    await page.evaluate(({ x, y }) => { const m = window.__map; const r = m.getContainer().getBoundingClientRect(); m.jumpTo({ center: m.unproject([x - r.x, y - r.y]), zoom: 14 }); }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForTimeout(900);
    const b = await pin.boundingBox();
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    // A point ON the drawn line, 16–24 px from the pin's centre (outside its disc).
    const spot = await page.evaluate(({ c }) => {
      const m = window.__map; const r = m.getContainer().getBoundingClientRect();
      const src = m.getSource(m.getLayer("route-road").source); const fs = src._data.geojson.features;
      let best = null;
      for (const f of fs) for (let i = 1; i < f.geometry.coordinates.length; i++) {
        const a = m.project(f.geometry.coordinates[i - 1]), bb = m.project(f.geometry.coordinates[i]);
        for (let t = 0; t <= 1; t += 0.05) {
          const x = r.x + a.x + (bb.x - a.x) * t, y = r.y + a.y + (bb.y - a.y) * t;
          const d = Math.hypot(x - c.x, y - c.y);
          if (d >= 17 && d <= 22 && (!best || Math.abs(d - 19) < Math.abs(best.d - 19))) best = { x, y, d };
        }
      }
      return best;
    }, { c });
    const onLine = spot && await page.evaluate(({ x, y }) => { const m = window.__map; const r = m.getContainer().getBoundingClientRect(); return m.queryRenderedFeatures([[x - r.x - 8, y - r.y - 8], [x - r.x + 8, y - r.y + 8]], { layers: ["route-road", "route-track", "route-trail"].filter((l) => m.getLayer(l)) }).length > 0; }, spot);
    const hitEl = spot && await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest(".maplibregl-marker") ? "marker" : "canvas", spot);
    if (spot) { await tapXY(spot.x, spot.y); await page.waitForTimeout(SETTLE); }
    const s = await sheetInfo();
    rec("a tap on the line beside a pin opens the pin's sheet", Boolean(spot) && onLine && hitEl === "canvas" && s?.kind === "point" && /Pietura 1/.test(s.label), { spot, onLine, hitEl, sheet: s });
    await shot("near-pin");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    if (await sheet().count()) { await page.getByRole("button", { name: "Atcelt", exact: true }).last().click(); await page.waitForTimeout(400); }
  }

  // ── 7. the result keeps the card; the hint does not come back ──
  {
    await page.getByRole("button", { name: /Pabeigt labošanu/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    if (!phone) {
      const ll = await pointOn(0.5); await zoomTo(ll, 13);
      await tapAt(ll); await page.waitForTimeout(SETTLE);
      const card = await page.locator(".maplibregl-popup").count();
      rec("result map: a line tap opens the segment card, no sheet", card > 0 && !(await sheet().count()), { card });
      await shot("result-card");
    }
    await page.getByRole("button", { name: "Labot maršrutu kartē" }).click(); await page.waitForTimeout(2500);
    rec("hint shows once: not on the second entry", !(await tip.isVisible().catch(() => false)));
  }

  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
