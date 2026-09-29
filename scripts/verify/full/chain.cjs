// Release B item 4: chain 2–3 edits before one ✓, with ↶ inside the chain.
// Grostonas iela 19 → Sidgunda → Mālpils → Augšmala → Ērgļi; each stop moved a little by its sheet's „Pārvietot”.
const L = require("../lib.cjs");
const fs = require("fs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const CAP = null; // the ride comes from fixtures/grostonas-chain.json (lib plan/generate)
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
    const u = new URL(route.request().url());
    const q = decodeURIComponent(u.searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    if (!q && u.searchParams.get("lat")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [] }) });
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  if (CAP && fs.existsSync(CAP)) await page.route("**/api/generate-route", (route) => route.fulfill({ status: 200, contentType: "application/json", body: fs.readFileSync(CAP, "utf8") }));
  else if (CAP) page.on("response", async (r) => { if (r.url().includes("/api/generate-route")) { try { fs.writeFileSync(CAP, await r.text()); } catch {} } });
  const answers = [];
  page.on("request", (r) => { if (r.url().includes("/api/reroute-leg")) answers.push("→"); });
  await L.plan(page, ["Grostonas", "Sidgunda", "Mālpils", "Augšmala", "Ērgļi"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const original = L.hash(await L.line(page));
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const chip = document.querySelector("[data-proposal-chip]");
    const slots = [...document.querySelectorAll("[data-slot]")].filter(vis).map((e) => `${e.dataset.slot}:${e.disabled ? "off" : "on"}`);
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => g.dataset.choiceGroup);
    return { chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim().slice(0, 170) } : null, slots, choices, panel: document.querySelector("[data-edit-summary]")?.textContent ?? null };
  });
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); };
  const pinAt = async (ll) => {
    const p = await L.px(page, ll);
    // The ride's own pin nearest the place.
    const box = await page.evaluate(({ x, y }) => {
      const els = [...document.querySelectorAll(".maplibregl-marker")].filter((e) => !e.dataset.pending);
      let best = null, d = Infinity;
      for (const e of els) { const r = e.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const dd = Math.hypot(cx - x, cy - y); if (dd < d) { d = dd; best = { x: cx, y: cy, d: dd, label: e.getAttribute("aria-label") }; } }
      return best;
    }, p);
    return box;
  };
  const movePin = async (place, to, label) => {
    await L.fit(page, [[24.86, 56.94], [25.02, 57.03]], 30);
    const box = await pinAt([place.lon, place.lat]);
    if (phone) await page.touchscreen.tap(box.x, box.y); else await page.mouse.click(box.x, box.y);
    await page.waitForTimeout(900);
    await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(900);
    // „Pārvietot” zooms in on the point; the new place must be on screen to be tapped.
    await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: Math.min(window.__map.getZoom(), 14) }), to); await page.waitForTimeout(700);
    await tapAt(to);
    await page.waitForTimeout(1200);
    await L.waitChip(page, ["proposed", "warn", "refused"], 60000); await page.waitForTimeout(900);
    const s = await ui();
    console.log(label, JSON.stringify(s));
    await page.screenshot({ path: `${L.SHOTS}/relb-chain-${label}-${tag}.png` });
    return s;
  };
  // 1. Sidgunda a little south-west along its road; 2. Mālpils a little; 3. Augšmala a little.
  const s1 = await movePin(TOWNS.sid, [24.905, 56.955], "1");
  const s2 = await movePin(TOWNS["māl"], [24.955, 57.002], "2");
  const s3 = await movePin(TOWNS.aug, [24.975, 56.994], "3");
  // ↶ inside the chain: the third goes, the chip is the first two again.
  await (await L.slotBtn(page, 2)).click(); await page.waitForTimeout(1200);
  const u1 = await ui(); console.log("after ↶", JSON.stringify(u1));
  await page.screenshot({ path: `${L.SHOTS}/relb-chain-undo-${tag}.png` });
  // ✓: both as ONE step of the undo.
  await (await L.slotBtn(page, 3)).click(); await page.waitForTimeout(2000);
  const c = await ui(); console.log("after ✓", JSON.stringify(c));
  const committed = L.hash(await L.line(page));
  // One history ↶ brings back the ride before both.
  await (await L.slotBtn(page, 2)).click(); await page.waitForTimeout(1500);
  const back = L.hash(await L.line(page));
  // Round 2: a move, then a bend of the line on top of it; ✕ drops both.
  const r1 = await movePin(TOWNS.aug, [24.975, 56.994], "r2-move");
  const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const c2 = await L.line(page);
  const near = (ll) => c2.reduce((best, p, i) => (hv(p, ll) < best[0] ? [hv(p, ll), i] : best), [Infinity, 0])[1];
  const iS = near([24.9172, 56.9598]), iM = near([24.9412, 57.0095]);
  const grab = c2[Math.round(iS + (iM - iS) * 0.6)], DROP = [24.9700, 56.9720];
  await L.fit(page, [grab, DROP, [24.9172, 56.9598], [24.9650, 56.9990]], 60);
  const gp = await L.px(page, grab), gq = await L.px(page, DROP);
  console.log("bend", JSON.stringify({ n: c2.length, iS, iM, grab, gp, gq }));
  await page.screenshot({ path: `${L.SHOTS}/dbg-bend-before.png` });
  if (phone) {
    const cdp = await page.context().newCDPSession(page);
    const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    await tp("touchStart", gp.x, gp.y); await page.waitForTimeout(450);
    for (let k = 1; k <= 12; k++) { await tp("touchMove", gp.x + (gq.x - gp.x) * k / 12, gp.y + (gq.y - gp.y) * k / 12); await page.waitForTimeout(30); }
    await tp("touchEnd");
  } else {
    await page.mouse.move(gp.x, gp.y); await page.mouse.down(); await page.waitForTimeout(450);
    for (let k = 1; k <= 12; k++) { await page.mouse.move(gp.x + (gq.x - gp.x) * k / 12, gp.y + (gq.y - gp.y) * k / 12); await page.waitForTimeout(30); }
    await page.mouse.up();
  }
  await page.waitForTimeout(1500);
  await L.waitChip(page, ["proposed", "warn", "refused"], 60000); await page.waitForTimeout(900);
  const b2 = await ui(); console.log("r2-bend", JSON.stringify(b2));
  await page.screenshot({ path: `${L.SHOTS}/relb-final-chain-${tag}.png` });
  // ✕: every pending change goes; the ride is the committed one.
  await (await L.slotBtn(page, "x")).click(); await page.waitForTimeout(1500);
  const d2 = await ui(); console.log("after ✕", JSON.stringify(d2));
  const dropped = L.hash(await L.line(page));
  console.log("RESULT", JSON.stringify({
    chip2: /2 izmaiņas/.test(s2.chip?.text ?? ""), chip3: /3 izmaiņas/.test(s3.chip?.text ?? ""), undo2: /2 izmaiņas/.test(u1.chip?.text ?? ""),
    committedChanged: committed !== original, oneStepBack: back === original, s1: s1.chip?.tone, s2: s2.chip?.tone, s3: s3.chip?.tone,
    bendChained: /2 izmaiņas/.test(b2.chip?.text ?? ""), bendTone: b2.chip?.tone, discardAll: dropped === original && !d2.chip,
  }));
  console.log("reroutes", answers.length, "errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
