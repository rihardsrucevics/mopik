// Release B item 1: a batch with one bad point (Lielie Kangari bog, 588 m from a road) on Grostonas iela 19 → Ērgļi.
// argv: phone|desk, then "rest" (Pievienot pārējās) or "straight" (Vest pa taisno on the bad one).
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const fix = process.argv[3] ?? "rest";
const tag = phone ? "375" : "1280";
(async () => {
  const { browser, page, log } = await L.open({ phone });
  const TOWNS = {
    "gro": { name: "Grostonas iela 19", label: "Grostonas iela 19, Rīga", lat: 56.9704052, lon: 24.1244022 },
    "ērg": { name: "Ērgļi", label: "Ērgļi, Ērgļu pagasts", lat: 56.8962277, lon: 25.6398822 },
  };
  await page.route("**/api/places?**", (route) => {
    const u = new URL(route.request().url());
    const q = decodeURIComponent(u.searchParams.get("q") ?? "").toLowerCase().slice(0, 3);
    if (!q && u.searchParams.get("lat")) {
      // Reverse lookups: stable names for the three marks.
      const lon = Number(u.searchParams.get("lon"));
      const name = lon > 24.68 ? "Kangaru purvs" : lon > 24.55 ? "Rīgas iela" : "Silenieki";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [{ name, label: `${name}, Ropažu novads`, lat: Number(u.searchParams.get("lat")), lon }] }) });
    }
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: TOWNS[q] ? [TOWNS[q]] : [] }) });
  });
  const answers = [];
  page.on("response", async (r) => { const u = r.url(); if (u.includes("/api/reroute-leg") || u.includes("/api/routable-point")) { let b = ""; try { b = (await r.text()).slice(0, 90); } catch {} answers.push(`${u.includes("routable") ? "probe" : "reroute"} ${r.status()} ${b}`); } });
  await L.plan(page, ["Grostonas", "Ērgļi"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => `${g.dataset.choiceGroup}[${[...g.querySelectorAll("[data-choice]")].map((b) => b.textContent.trim()).join(" | ")}]`);
    const chip = document.querySelector("[data-proposal-chip]");
    const slots = [...document.querySelectorAll("[data-slot]")].filter(vis).map((e) => `${e.dataset.slot}:${e.disabled ? "off" : "on"}`);
    return { field: input ? (input.value || input.placeholder) : null, choices, chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null, blocked: [...document.querySelectorAll('[data-blocked="true"]')].map((e) => e.textContent.trim()), pins: document.querySelectorAll("[data-batch]").length, slots };
  });
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(900); };
  const pts = [[24.4509, 56.9490], [24.5985, 56.9599], [24.7000, 56.9650]];
  await L.fit(page, pts.concat([[24.40, 56.93], [24.80, 56.93]]), 40);
  await (await L.slotBtn(page, 1)).click(); await page.waitForTimeout(400);
  for (const ll of pts) await tapAt(ll);
  const t0 = Date.now();
  // Wait for the named verdict (the probes run after the refusal).
  while (Date.now() - t0 < 60000) { const s = await ui(); if (s.choices.some((c) => c.startsWith("block"))) break; await page.waitForTimeout(300); }
  console.log("named after", Date.now() - t0, "ms", JSON.stringify(await ui()));
  await page.screenshot({ path: `${L.SHOTS}/relb-batchbad-named-${tag}.png` });
  if (fix === "rest") {
    await page.locator('[data-choice-group="rest"] [data-choice="rest"]').click();
  } else if (fix === "move") {
    await page.locator('[data-choice-group="block"] [data-choice="move"]').click();
    await page.waitForTimeout(500);
    console.log("move armed", JSON.stringify(await ui()));
    await tapAt([24.7300, 56.9550]);
  } else {
    await page.locator('[data-choice-group="block"] [data-choice="straight"]').click();
  }
  await page.waitForTimeout(1500);
  await L.waitChip(page, ["proposed", "warn", "refused"], 60000); await page.waitForTimeout(1200);
  console.log(`after ${fix}`, JSON.stringify(await ui()));
  await page.screenshot({ path: `${L.SHOTS}/relb-batchbad-${fix}-${tag}.png` });
  // ✓ commits it, one step.
  const ok = await L.slotBtn(page, 3);
  if (!(await ok.isDisabled())) { await ok.click(); await page.waitForTimeout(2500); }
  console.log("after ✓", JSON.stringify(await ui()), "undo on", await L.undoEnabled(page));
  console.log("answers", JSON.stringify(answers));
  console.log("errors", JSON.stringify(log.errors.slice(0, 5)), "warns", JSON.stringify(log.warns.slice(0, 5)));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
