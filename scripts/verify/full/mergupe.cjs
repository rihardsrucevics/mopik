// Rider's production case 3 (2026-09-28): Grostonas iela 19 → Ērgļi through pass-through points near Mālpils; a bend/move onto V61 by the Mergupe.
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const DROP = process.argv[3] && process.argv[3] !== "ogre" ? JSON.parse(process.argv[3]) : [24.9700, 56.9720];
(async () => {
  const { browser, page, log } = await L.open({ phone });
  const TOWNS = {
    "gro": { name: "Grostonas iela 19", label: "Grostonas iela 19, Rīga", lat: 56.9704052, lon: 24.1244022 },
    "ērg": { name: "Ērgļi", label: "Ērgļi, Ērgļu pagasts", lat: 56.8962277, lon: 25.6398822 },
    "sid": { name: "Sidgunda", label: "Sidgunda, Mālpils pagasts", lat: 56.9597989, lon: 24.9171946 },
    "māl": { name: "Mālpils", label: "Mālpils, Mālpils pagasts", lat: 57.0094587, lon: 24.941152 },
    "aug": { name: "Augšmala", label: "Augšmala, Mālpils pagasts", lat: 56.9990, lon: 24.9650 },
  };
  await page.route("**/api/places?**", (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  // The same five places as chain.cjs: its captured generation (the live search took > 90 s at times).
  const CAP = null; // the ride comes from fixtures/grostonas-chain.json (lib plan/generate)
  if (CAP && require("fs").existsSync(CAP)) await page.route("**/api/generate-route", (route) => route.fulfill({ status: 200, contentType: "application/json", body: require("fs").readFileSync(CAP, "utf8") }));
  const answers = [];
  page.on("request", (r) => { if (r.url().includes("/api/reroute-leg")) { try { const b = JSON.parse(r.postData()); answers.push(`→ runs ${b.runs.map((x) => x.length).join(",")} relax ${b.relax ?? 0} keepSpurs ${b.keepSpurs ?? false}`); } catch {} } });
  page.on("response", async (r) => { if (r.url().includes("/api/reroute-leg")) { let b = ""; try { b = (await r.text()).slice(0, 200); } catch {} answers.push(`← ${r.status()} ${r.status() === 200 ? "" : b}`); } });
  await L.plan(page, ["Grostonas", "Sidgunda", "Mālpils", "Augšmala", "Ērgļi"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  console.log("markers", JSON.stringify(await page.evaluate(() => [...document.querySelectorAll(".maplibregl-marker")].map((e) => e.getAttribute("aria-label")))));
  await page.screenshot({ path: `${L.SHOTS}/mergupe-generated-${tag}.png` });
  // The pending connectors: one source, one layer, one colour (release B).
  const links = () => page.evaluate(() => {
    const m = window.__map; const src = m.getSource("move-preview");
    const f = src?._data?.geojson?.features ?? [];
    return { chains: f.map((x) => x.geometry.coordinates.length), color: m.getLayer("move-preview") ? m.getPaintProperty("move-preview", "line-color") : null, grabLine: Boolean(m.getSource("grab-line")) };
  });
  const marker = (name) => page.locator(`.maplibregl-marker[aria-label="${name}"]`).first();
  const km = async () => { const c = await L.line(page); let m = 0; for (let i = 1; i < c.length; i++) { const a = c[i - 1], b = c[i]; const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; m += 2 * R * Math.asin(Math.sqrt(h)); } return { lineKm: Math.round(m / 100) / 10, panel: await page.locator("[data-edit-summary]").first().textContent().catch(() => null), hash: L.hash(c) }; };
  console.log("before demote", JSON.stringify(await km()));
  for (const n of ["Sidgunda", "Mālpils", "Augšmala"]) {
    await L.fit(page, [[24.88, 56.94], [25.0, 57.03]], 30);
    // Always stop 1: each demoted stop leaves the numbering.
    const pin = page.locator(".maplibregl-marker").filter({ hasText: /^1$/ }).first();
    const box = await pin.boundingBox(); console.log("pin", n, JSON.stringify(box));
    if (phone) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(700);
    await page.getByText("Padarīt caurbraucamu", { exact: true }).first().click(); await page.waitForTimeout(1200);
    console.log("  after", n, JSON.stringify(await km()));
  }
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const chip = document.querySelector("[data-proposal-chip]");
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => g.textContent.trim());
    return { field: input ? (input.value || input.placeholder) : null, chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null, choices, dots: document.querySelectorAll('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').length };
  });
  console.log("demoted", JSON.stringify(await ui()), "reroutes so far", log.reroute, JSON.stringify(await km()));
  await page.screenshot({ path: `${L.SHOTS}/mergupe-ride-${tag}.png` });
  if (process.argv[3] === "ogre") {
    const OGRE = [24.6047, 56.8163];
    const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); };
    await L.fit(page, [OGRE, [24.2, 56.97], [24.95, 56.97]], 40);
    await (await L.slotBtn(page, 1)).click(); await page.waitForTimeout(400);
    await tapAt(OGRE);
    await L.waitChip(page, ["proposed", "refused", "warn"], 60000); await page.waitForTimeout(800);
    console.log("ogre stop", JSON.stringify(await ui()));
    await page.locator('[data-choice="pass"]').click(); await page.waitForTimeout(1500);
    await L.waitChip(page, ["proposed", "refused", "warn"], 60000); await page.waitForTimeout(800);
    console.log("ogre pass", JSON.stringify(await ui()));
    console.log("reroute", JSON.stringify(answers));
    await page.screenshot({ path: `${L.SHOTS}/ogre-pass-${tag}.png` });
    console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)));
    await browser.close(); return;
  }
  // Grab the line between Sidgunda and Mālpils (the rider's blue dot), drop by the Mergupe on V61.
  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const c = await L.line(page);
  const near = (ll) => c.reduce((best, p, i) => (hv(p, ll) < best[0] ? [hv(p, ll), i] : best), [Infinity, 0])[1];
  const iS = near([24.9172, 56.9598]), iM = near([24.9412, 57.0095]);
  const grab = c[Math.round(iS + (iM - iS) * 0.6)];
  console.log("grab", JSON.stringify(grab), "drop", JSON.stringify(DROP));
  await L.fit(page, [grab, DROP, [24.9172, 56.9598], [24.9650, 56.9990]], 60);
  const p = await L.px(page, grab), q = await L.px(page, DROP);
  if (phone) {
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await tp("touchStart", p.x, p.y); await page.waitForTimeout(450);
    for (let k = 1; k <= 12; k++) { await tp("touchMove", p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
    await page.screenshot({ path: `${L.SHOTS}/relb-mergupe-dragging-${tag}.png` });
    console.log("links while dragging", JSON.stringify(await links()));
    await tp("touchEnd");
  } else {
    await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.waitForTimeout(450);
    for (let k = 1; k <= 12; k++) { await page.mouse.move(p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
    await page.screenshot({ path: `${L.SHOTS}/relb-mergupe-dragging-${tag}.png` });
    console.log("links while dragging", JSON.stringify(await links()));
    await page.mouse.up();
  }
  await page.waitForTimeout(150);
  console.log("links after drop", JSON.stringify(await links()));
  await page.screenshot({ path: `${L.SHOTS}/relb-mergupe-pending-${tag}.png` });
  await page.waitForTimeout(1350);
  await L.waitChip(page, ["proposed", "refused", "warn"], 60000); await page.waitForTimeout(800);
  console.log("after bend", JSON.stringify(await ui()), "links", JSON.stringify(await links()));
  await page.screenshot({ path: `${L.SHOTS}/relb-mergupe-landed-${tag}.png` });
  console.log("reroute", JSON.stringify(answers));
  await page.screenshot({ path: `${L.SHOTS}/mergupe-bend-${tag}.png` });
  console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
