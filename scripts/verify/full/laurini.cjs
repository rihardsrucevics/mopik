// Rider's production case 2026-09-28 (images/33.png): Lauriņi → Ērgļi, a pass-through point moved
// across the Ogre onto a junction on a through road — was called „tikai strupceļš”, 9.8 km out and back.
const L = require("../lib.cjs");
const fs = require("fs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const WAS = [24.6885, 56.8108], JUNCTION = [24.7100, 56.8160];
(async () => {
  const { browser, page, log } = await L.open({ phone });
  const TOWNS = {
    "lau": { name: "Lauriņi", label: "Lauriņi, Ķekavas pagasts", lat: 56.81077, lon: 24.286293 },
    "ērg": { name: "Ērgļi", label: "Ērgļi, Ērgļu pagasts", lat: 56.8962277, lon: 25.6398822 },
  };
  await page.route("**/api/places?**", (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  // The captured generation of the same request: its "direct" ride is his GPX, point for point (2093).
  const generated = L.fixture("laurini-ergli").response;
  await page.route("**/api/generate-route", (route) => route.fulfill({ status: 200, contentType: "application/json", body: generated }));
  const answers = [];
  page.on("request", (r) => { if (r.url().includes("/api/reroute-leg")) { try { const b = JSON.parse(r.postData()); answers.push(`→ runs ${b.runs.map((x) => x.length).join(",")} relax ${b.relax ?? 0} keepSpurs ${b.keepSpurs ?? false}`); } catch {} } });
  page.on("response", async (r) => { if (r.url().includes("/api/reroute-leg")) { let b = ""; try { const t = await r.text(); b = r.status() === 200 ? JSON.stringify(JSON.parse(t).runs.map((x) => ({ km: Math.round(x.distanceMeters / 100) / 10, deadEnd: x.deadEndMeters, proved: x.deadEndProved ?? false, shape: x.deadEndAtShape ?? false }))) : t.slice(0, 120); } catch {} answers.push(`← ${r.status()} ${b}`); } });
  await L.plan(page, ["Lauriņi", "Ērgļi"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const chip = document.querySelector("[data-proposal-chip]");
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => g.textContent.trim());
    return { field: input ? (input.value || input.placeholder) : null, chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null, choices };
  });
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); };
  await L.fit(page, [WAS, JUNCTION, [24.66, 56.79], [24.73, 56.83]], 40);
  const c0 = await L.line(page);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2;
  const onLine = c0.reduce((best, p) => (d2(p, WAS) < d2(best, WAS) ? p : best), c0[0]);
  await (await L.slotBtn(page, 1)).click(); await page.waitForTimeout(400);
  await tapAt(onLine);
  await L.waitChip(page, ["proposed", "refused", "warn"], 60000); await page.waitForTimeout(600);
  await page.locator('[data-choice="pass"]').click(); await page.waitForTimeout(1200);
  await L.waitChip(page, ["proposed", "refused", "warn"], 60000); await page.waitForTimeout(600);
  console.log("pass added", JSON.stringify(await ui()));
  await (await L.slotBtn(page, 3)).click(); await page.waitForTimeout(2000);
  const before = await L.line(page);
  const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
  await dot.click(); await page.waitForTimeout(700);
  await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(1200);
  await L.fit(page, [WAS, JUNCTION, [24.66, 56.79], [24.73, 56.83]], 40);
  answers.length = 0;
  await tapAt(JUNCTION);
  await page.waitForTimeout(2000);
  await L.waitChip(page, ["proposed", "refused", "warn"], 90000); await page.waitForTimeout(1500);
  console.log("moved", JSON.stringify(await ui()));
  console.log("reroute", JSON.stringify(answers, null, 0));
  await page.screenshot({ path: `${L.SHOTS}/relb-laurini-move-${tag}.png` });
  console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)), "line pts before", before.length);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
