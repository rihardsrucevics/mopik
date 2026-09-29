const L = require("../lib.cjs");
const fs = require("fs");
const BASE = L.BASE;
const SHOTS = L.SHOTS;
const phone = process.argv[2] === "phone";
const tag = process.argv[3] || "gate";
const places = (process.argv[4] || "Vangaži|Inčukalns").split("|");

const gatesOnPage = (page) => page.evaluate(() => [...document.querySelectorAll("button[data-gate]")].map((b) => {
  const r = b.getBoundingClientRect();
  return { label: b.getAttribute("aria-label"), x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
}));

(async () => {
  const { browser, page, log } = await L.open({ phone });
  await page.goto(BASE + "/?lang=lv");
  await page.waitForTimeout(2500);
  await L.pick(page, page.getByPlaceholder("Pilsēta, adrese vai vieta").first(), places[0]);
  await L.pick(page, page.getByPlaceholder("Nav obligāts — man vienalga").first(), places.at(-1));
  for (const stop of places.slice(1, -1)) {
    await page.getByRole("button", { name: "Pievienot pieturvietu" }).click();
    await page.waitForTimeout(300);
    const inputs = page.getByPlaceholder("Nav obligāts — man vienalga");
    const vals = await inputs.evaluateAll((els) => els.map((e) => e.value));
    await L.pick(page, inputs.nth(Math.max(0, vals.indexOf(""))), stop);
  }
  const t0 = Date.now();
  await L.generate(page);
  console.log("generated in", ((Date.now() - t0) / 1000).toFixed(1), "s");
  let gates = await gatesOnPage(page);
  if (!gates.length) {
    // try the other version
    const other = page.getByText("Sarežģītāks").first();
    if (await other.count()) { await other.click(); await page.waitForTimeout(2500); gates = await gatesOnPage(page); }
  }
  console.log("gate markers:", gates.length, gates.map((g) => g.label));
  if (!gates.length) { await page.screenshot({ path: SHOTS + `/${tag}-nogates.png` }); await browser.close(); return; }

  if (process.env.DBG) {
    console.log("DBG", JSON.stringify(await page.evaluate(() => {
      const m = window.__map;
      const src = m.getSource(m.getLayer("route-road").source);
      const fsx = src._data?.geojson?.features ?? src._data.features;
      const d = (a, b) => Math.hypot((a[0] - b[0]) * 60700, (a[1] - b[1]) * 111000);
      const out = [];
      fsx.forEach((f, idx) => (f.properties.gatePoints ?? []).forEach((g) => {
        const cs = f.geometry.coordinates;
        let best = 1e9, bi = -1; cs.forEach((c, i) => { const x = d(c, g); if (x < best) { best = x; bi = i; } });
        out.push({ idx, g, nearestM: Math.round(best * 10) / 10, bi, n: cs.length, cls: f.properties.roadClass, first: cs[0], last: cs[cs.length - 1], prevLast: idx ? fsx[idx - 1].geometry.coordinates.at(-1) : null });
      }));
      return out;
    })));
  }
  // RISKI in Detaļas
  const det = page.getByRole("button", { name: /Detaļas/ }).first();
  if (await det.count()) { await det.click().catch(() => {}); await page.waitForTimeout(600); }
  const riski = await page.evaluate(() => {
    const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Riski");
    return h ? h.parentElement.innerText : null;
  });
  console.log("RISKI:", JSON.stringify(riski));
  await page.evaluate(() => {
    const h = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Riski");
    h?.parentElement.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + `/${tag}-riski.png` });

  // phone: open the map full screen first
  if (phone) {
    const mapEl = page.locator(".maplibregl-canvas").first();
    await mapEl.scrollIntoViewIfNeeded();
    const box = await mapEl.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + 30);
    await page.waitForTimeout(1500);
  }

  console.log("maps:", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".maplibregl-map")].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), e === window.__map.getContainer()]; }))));
  // Zoom to the first gate (by marker lngLat)
  const pts = await page.evaluate(() => {
    const m = window.__map;
    return [...document.querySelectorAll("button[data-gate]")].map((b) => {
      const r = b.getBoundingClientRect(), c = m.getContainer().getBoundingClientRect();
      const ll = m.unproject([r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y]);
      return [ll.lng, ll.lat];
    });
  });
  const target = pts[Math.min(pts.length - 1, Number(process.env.GATE_I || 0))];
  await page.evaluate((t) => window.__map.jumpTo({ center: t, zoom: 16 }), target);
  await page.waitForTimeout(1500);
  gates = await gatesOnPage(page);
  const c = await page.evaluate(() => { const r = window.__map.getContainer().getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  const g = gates.sort((a, b) => Math.hypot(a.x - c.x, a.y - c.y) - Math.hypot(b.x - c.x, b.y - c.y))[0];
  console.log("hit box", g.w, "x", g.h, "at", Math.round(g.x), Math.round(g.y));
  // Tap off-centre, 16 px right of the pill, still inside the hit area
  const reroute0 = log.reroute;
  if (phone) await page.touchscreen.tap(g.x + 16, g.y + 10);
  else await page.mouse.click(g.x + 16, g.y + 10);
  await page.waitForTimeout(900);
  const card = await page.evaluate(() => {
    const el = document.querySelector("[data-gate-card]");
    const m = window.__map;
    const src = m.getSource("gate-highlight");
    const d = src?._data?.geojson ?? src?._data;
    const coords = d?.features?.[0]?.geometry?.coordinates ?? [];
    let len = 0;
    const R = 6371000, rad = Math.PI / 180;
    for (let i = 1; i < coords.length; i++) {
      const [a, b] = [coords[i - 1], coords[i]];
      const x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad), y = (b[1] - a[1]) * rad;
      len += Math.hypot(x, y) * R;
    }
    return { text: el?.innerText ?? null, link: el?.querySelector("a")?.href ?? null, highlightM: Math.round(len), routeFilter: JSON.stringify(m.getFilter("route-highlight")) };
  });
  console.log("card:", JSON.stringify(card));
  console.log("pending points after tap:", await page.evaluate(() => document.querySelectorAll(".maplibregl-marker").length), "reroutes", log.reroute - reroute0);
  await page.screenshot({ path: SHOTS + `/${tag}-card.png` });

  // Segment card: tap the line ~60 m from the gate

  const close = page.locator(".maplibregl-popup-close-button").first();
  if (await close.count()) { await close.click(); await page.waitForTimeout(400); }
  const segPt = await page.evaluate((t) => {
    const m = window.__map;
    const src = m.getSource(m.getLayer("route-road").source);
    const fsx = src._data?.geojson?.features ?? src._data.features;
    const layers = ["route-road", "route-track", "route-trail"].filter((id) => m.getLayer(id));
    const dbg = [];
    window.__dbg = dbg;
    for (const f of fsx) {
      const gp = f.properties.gatePoints;
      if (!gp) continue;
      const r = m.getContainer().getBoundingClientRect();
      const cs = f.geometry.coordinates;
      for (let i = 0; i < cs.length - 1; i++) {
        const mid = [(cs[i][0] + cs[i + 1][0]) / 2, (cs[i][1] + cs[i + 1][1]) / 2];
        const p = m.project(mid);
        if (p.x < 40 || p.y < 200 || p.x > r.width - 40 || p.y > r.height - 80) continue;
        const hit = m.queryRenderedFeatures([[p.x - 3, p.y - 3], [p.x + 3, p.y + 3]], { layers })[0];
        dbg.push([Math.round(p.x), Math.round(p.y), hit?.properties.segmentId, f.properties.segmentId]);
        if (hit && hit.properties.segmentId === f.properties.segmentId) return { x: r.x + p.x, y: r.y + p.y, id: f.properties.segmentId };
      }
    }
    return null;
  }, target);
  if (segPt) console.log("at segPt:", JSON.stringify(await page.evaluate((p) => { const e = document.elementFromPoint(p.x, p.y); const r = window.__map.getContainer().getBoundingClientRect(); return { el: e?.className?.baseVal ?? e?.className, tag: e?.tagName, rect: [r.x, r.y, r.width, r.height], vv: [innerWidth, innerHeight] }; }, segPt)));
  console.log("segment tap at", JSON.stringify(segPt), JSON.stringify(await page.evaluate(() => window.__dbg.slice(0, 20))));
  if (segPt) {
    if (phone) await page.touchscreen.tap(segPt.x, segPt.y); else await page.mouse.click(segPt.x, segPt.y);
    await page.waitForTimeout(900);
    let seg = await page.evaluate(() => document.querySelector(".maplibregl-popup-content")?.innerText ?? null);
    if (!seg) {
      await page.waitForTimeout(1200);
      if (phone) await page.touchscreen.tap(segPt.x, segPt.y); else await page.mouse.click(segPt.x, segPt.y);
      await page.waitForTimeout(1200);
      seg = await page.evaluate(() => document.querySelector(".maplibregl-popup-content")?.innerText ?? null);
      console.log("second tap on the line:", JSON.stringify(seg));
    }
    console.log("segment card:", JSON.stringify(seg));
    await page.screenshot({ path: SHOTS + `/${tag}-segment.png` });
  }
  if (process.env.ALL) {
    for (let i = 0; i < pts.length; i++) {
      const cl = page.locator(".maplibregl-popup-close-button").first();
      if (await cl.count()) { await cl.click().catch(() => {}); await page.waitForTimeout(300); }
      await page.evaluate((t) => window.__map.jumpTo({ center: t, zoom: 16 }), pts[i]);
      await page.waitForTimeout(1200);
      const gs = await gatesOnPage(page);
      const cc = await page.evaluate(() => { const r = window.__map.getContainer().getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      const gg = gs.sort((a, b) => Math.hypot(a.x - cc.x, a.y - cc.y) - Math.hypot(b.x - cc.x, b.y - cc.y))[0];
      await page.screenshot({ path: SHOTS + `/${tag}-marker-${i}.png`, clip: { x: gg.x - 60, y: gg.y - 45, width: 120, height: 90 } });
      const before = await page.evaluate(() => document.querySelectorAll(".maplibregl-marker").length);
      const rr = log.reroute;
      if (phone) await page.touchscreen.tap(gg.x, gg.y); else await page.mouse.click(gg.x, gg.y);
      await page.waitForTimeout(800);
      const afterM = await page.evaluate(() => document.querySelectorAll(".maplibregl-marker").length);
      console.log("markers before/after tap", before, afterM, "reroutes", log.reroute - rr, "fullscreen/w", await page.evaluate(() => window.__map.getContainer().getBoundingClientRect().width));
      const t = await page.evaluate(() => { const el = document.querySelector("[data-gate-card]"); return el ? el.innerText.replace(/\n/g, " | ") + " → " + (el.querySelector("a")?.href ?? "-") : null; });
      console.log("gate", i, t);
      await page.screenshot({ path: SHOTS + `/${tag}-card-${i}.png` });
    }
  }
  console.log("errors", log.errors.slice(0, 5));
  await browser.close();
})();
