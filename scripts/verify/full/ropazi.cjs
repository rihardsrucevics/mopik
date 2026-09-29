// Rider's production case 2026-09-28: Grostonas iela 19 → Ērgļi, one way; new points near Ropaži, 2–5 km north of the line.
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const scenario = process.argv[3] ?? "three";
const tag = phone ? "375" : "1280";
(async () => {
  const { browser, page, log } = await L.open({ phone });
  const TOWNS = {
    "gro": { name: "Grostonas iela 19", label: "Grostonas iela 19, Rīga", lat: 56.9704052, lon: 24.1244022 },
    "ērg": { name: "Ērgļi", label: "Ērgļi, Ērgļu pagasts", lat: 56.8962277, lon: 25.6398822 },
  };
  await page.route("**/api/places?**", (route) => {
    const q = decodeURIComponent(new URL(route.request().url()).searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  const answers = [];
  page.on("response", async (r) => { if (r.url().includes("/api/reroute-leg")) { let b = ""; try { b = (await r.text()).slice(0, 160); } catch {} answers.push(`${r.status()} ${r.status() === 200 ? "" : b}`); } });
  await L.plan(page, ["Grostonas", "Ērgļi"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => `${g.dataset.choiceGroup}[${[...g.querySelectorAll("[data-choice]")].map((b) => `${b.getAttribute("aria-checked") === "true" ? "●" : "○"}${b.textContent.trim()}`).join(" | ")}]`);
    const chip = document.querySelector("[data-proposal-chip]");
    const guide = document.querySelector("[data-edit-guide]");
    return { field: input ? (input.value || input.placeholder) : null, choices, chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null, guide: guide?.textContent.trim() ?? null, finish: document.querySelectorAll('[data-pending="finish"]').length };
  });
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); };
  const pts = scenario === "three"
    ? [[24.4509, 56.9490], [24.5261, 56.9645], [24.5985, 56.9599]]
    : JSON.parse(scenario);
  await L.fit(page, pts.concat([[24.40, 56.93], [24.80, 56.93]]), 40);
  await (await L.slotBtn(page, 1)).click(); await page.waitForTimeout(400);
  const links = () => page.evaluate(() => { const m = window.__map; const f = m.getSource("move-preview")?._data?.geojson?.features ?? []; return f.map((x) => x.geometry.coordinates.length); });
  for (const ll of pts) { await tapAt(ll); console.log("after tap", JSON.stringify(ll), JSON.stringify(await ui()), "links", JSON.stringify(await links())); }
  await page.screenshot({ path: `${L.SHOTS}/relb-ropazi-pending-${tag}.png` });
  await page.waitForTimeout(6000);
  await L.waitChip(page, ["proposed", "refused", "warn"], 60000);
  await page.waitForTimeout(800);
  console.log("final", JSON.stringify(await ui()), "links", JSON.stringify(await links()));
  console.log("reroute answers", JSON.stringify(answers));
  await page.screenshot({ path: `${L.SHOTS}/relb-ropazi-${scenario === "three" ? "three" : "batch"}-${tag}.png` });
  console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
