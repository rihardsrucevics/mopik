const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "phone" : "desk";
(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/${tag}-${n}.png` });
  const TOWNS = { "ant": { name: "Antiņciems", label: "Antiņciems, Lapmežciema pagasts", lat: 56.976606, lon: 23.463252 }, "puķ": { name: "Puķes", label: "Puķes, Babītes pagasts", lat: 56.846034, lon: 23.778456 }, "rīg": { name: "Rīgas apvedceļš", label: "Rīgas apvedceļš (Salaspils — Babīte), Mārupes pagasts", lat: 56.91126, lon: 23.914963 } };
  await page.route("**/api/places?**", (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  await L.plan(page, ["Antiņciems", "Puķes", "Rīgas apvedceļš"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const grabDrop = async (frac, dist, side) => {
    const c = await L.line(page); const cum = [0]; for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + hv(c[i - 1], c[i]));
    const tot = cum.at(-1); const at = (m) => { const i = Math.max(1, cum.findIndex((x) => x >= m)); const t = (m - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1); return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; };
    const g = at(tot * frac), a = at(Math.min(tot, tot * frac + 30));
    const dx = (a[0] - g[0]) * Math.cos(g[1] * Math.PI / 180), dy = a[1] - g[1], n = Math.hypot(dx, dy) || 1;
    const n2 = side * dist * (dx / n), e2 = -side * dist * (dy / n);
    return { grab: g, drop: [g[0] + e2 / (111195 * Math.cos(g[1] * Math.PI / 180)), g[1] + n2 / 111195] };
  };
  const bend = async (grab, drop) => {
    await page.evaluate(({ ll }) => window.__map.jumpTo({ center: ll, zoom: 14 }), { ll: grab }); await page.waitForTimeout(900);
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
  const chips = () => page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.getBoundingClientRect().width > 0).map((b) => b.textContent.trim()).filter((t) => /Tomēr braukt|Pārrēķināt posmu|Vest pa taisno/.test(t)));
  const report = async (name) => {
    await L.waitChip(page, ["proposed", "refused", "warn"], 40000); await page.waitForTimeout(600); const s = await L.state(page);
    const confirm = s.slots.find((x) => x.slot === "3");
    console.log(`${name}: chip ${JSON.stringify(s.chip)} | ✓ ${confirm?.confirm} "${confirm?.label}" | chips ${JSON.stringify(await chips())}`);
    await shot(name);
    return s;
  };
  const clickChip = async (text) => { const c = page.locator("button:visible", { hasText: text }).first(); if (!(await c.count())) return false; await c.click(); return true; };
  const drawnOnRide = () => page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn).reduce((s, f) => s + (f.properties.distanceMeters || 0), 0); });
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page);
    const { grab, drop } = await grabDrop(0.214642, 452.829, -1);
    await bend(grab, drop);
    const s1 = await report("S1-no-road");
    const offered = (await chips()).length;
    if (await clickChip("Vest pa taisno")) {
      const s2 = await report("S2-straight-proposed");
      await page.evaluate(({ ll }) => window.__map.jumpTo({ center: ll, zoom: 15 }), { ll: drop }); await page.waitForTimeout(1200); await shot("S2b-straight-zoom");
      const ok = await L.slotBtn(page, 3);
      if (!(await ok.isDisabled())) await ok.click();
      await page.waitForTimeout(1800);
      console.log(`  ✓: line changed ${L.hash(await L.line(page)) !== h0}, drawn metres on the ride ${await drawnOnRide()}, undo ${await L.undoEnabled(page)}`);
      const panel = await page.evaluate(() => [...document.querySelectorAll("[data-drawn-line]")].map((e) => e.textContent.trim()));
      console.log("  panel:", JSON.stringify(panel));
      await shot("S3-committed");
      await (await L.slotBtn(page, 2)).click(); await page.waitForTimeout(1500);
      console.log(`  ↶ (first): line back ${L.hash(await L.line(page)) === h0}`);
      // Once more, then finish editing: the result panel says what is drawn; the GPX carries it.
      await bend(grab, drop); await L.waitChip(page, ["refused"], 40000); await clickChip("Vest pa taisno"); await L.waitChip(page, ["proposed"], 40000); await page.waitForTimeout(500);
      const ok2 = await L.slotBtn(page, 3); if (!(await ok2.isDisabled())) await ok2.click(); await page.waitForTimeout(1800);
      if (phone) { const close = page.getByRole("button", { name: "Aizvērt pilnekrāna karti" }); if (await close.count()) { await close.first().evaluate((b) => b.click()); // the dev overlay badge sits over it at bottom-left
      await page.waitForTimeout(800); } }
    const done = page.getByRole("button", { name: "Pabeigt labošanu" }); if (await done.count()) { await done.first().click(); await page.waitForTimeout(1500); }
      console.log("  result panel:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll("[data-drawn-line]")].map((e) => e.textContent.trim()))));
      await shot("S4-result");
      console.log(`  end: line back ${L.hash(await L.line(page)) === h0}, undo as before ${(await L.undoEnabled(page)) === u0}, drawn ${await drawnOnRide()}`);
    } else console.log("  no „Vest pa taisno” chip; chips", offered, JSON.stringify(s1.chip));
  }
  console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 3)), "reroutes", log.reroute);
  await browser.close();
})();
