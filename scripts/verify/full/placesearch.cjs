// The place search's "slow" message, the live route, and no hover label after a tap on a phone.
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail) : ""}`); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  // 1. Photon did not answer: the field says so, it does not show an empty list.
  await page.route("**/api/places?q=*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [], unavailable: "timeout" }) }));
  await page.goto(L.BASE + "/?lang=lv"); await page.waitForTimeout(1500);
  const input = page.getByPlaceholder("Pilsēta, adrese vai vieta").first();
  await input.click(); await input.type("Sigulda", { delay: 40 }); await page.waitForTimeout(1200);
  const slow = await page.locator("[data-place-search-slow]").textContent().catch(() => null);
  rec("a timeout is said: „Vietu meklēšana šobrīd atbild lēni – mēģini vēlreiz”", slow === "Vietu meklēšana šobrīd atbild lēni – mēģini vēlreiz" && (await page.locator('[role="option"]').count()) === 0, { slow });
  await page.screenshot({ path: `${L.SHOTS}/place-search-slow-${tag}.png` });
  // Photon answers again: the list is back and the message gone.
  await page.unroute("**/api/places?q=*");
  await input.fill(""); await input.type("Siguld", { delay: 40 });
  await page.locator('[role="option"]').first().waitFor({ timeout: 25000 }).catch(() => {});
  rec("next answer: the list, no message", (await page.locator('[role="option"]').count()) > 0 && !(await page.locator("[data-place-search-slow]").count()));
  // 2. The live route: a real answer, no `unavailable`.
  const live = await page.evaluate(async () => (await fetch("/api/places?q=L%C4%ABgatne")).json());
  rec("live /api/places answers with places", live.places?.length > 0 && !live.unavailable, { n: live.places?.length, unavailable: live.unavailable ?? null });

  // 3. Phone: a tap on a flagged stretch shows no hover label.
  if (phone) {
    await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
    await L.generate(page);
    const target = await page.evaluate(() => {
      const m = window.__map; const src = m.getSource(m.getLayer("route-road").source);
      const f = src._data.geojson.features.find((x) => x.properties.accessUnverified || x.properties.roadClass === "trail");
      if (!f) return null; const c = f.geometry.coordinates; return c[Math.floor(c.length / 2)];
    });
    let shown = null;
    if (target) {
      await page.evaluate((ll) => window.__map.jumpTo({ center: ll, zoom: 15 }), target); await page.waitForTimeout(900);
      const p = await L.px(page, target); await page.touchscreen.tap(p.x, p.y);
      // The mousemove a phone browser makes up after a tap, at the same spot.
      await page.mouse.move(p.x + 1, p.y); await page.mouse.move(p.x, p.y); await page.waitForTimeout(900);
      shown = await page.evaluate(() => [...document.querySelectorAll('[aria-hidden="true"]')].some((e) => e.style.gridTemplateColumns && e.style.display === "grid"));
      await page.screenshot({ path: `${L.SHOTS}/place-search-phone-tap-${tag}.png` });
    }
    rec("phone: no hover label after a tap on a flagged stretch", Boolean(target) && shown === false, { target: Boolean(target), shown });
  }
  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
