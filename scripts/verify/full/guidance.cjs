// Identity and guidance for every edit state (rider, 2026-09-28).
const L = require("../lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail ? JSON.stringify(detail) : ""}`); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/guidance-${n}-${tag}.png` });
  await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  // The one-time hint is not what this is about.
  const tipX = page.locator("[data-edit-tip] button"); if (await tipX.count()) await tipX.click();
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
  const view = () => page.evaluate(() => {
    const sheet = document.querySelector('[data-point-sheet="menu"]');
    const move = document.querySelector('[data-point-sheet="move"]');
    const guide = [...document.querySelectorAll("[data-edit-guide]")].map((e) => ({ where: e.dataset.editGuide, text: e.textContent.trim() }));
    const chip = document.querySelector("[data-proposal-chip]");
    const ring = document.querySelector("[data-selection-ring]")?.dataset.selectionRing ?? null;
    return {
      mark: sheet?.querySelector("[data-sheet-mark]")?.dataset.sheetMark ?? null,
      markText: sheet?.querySelector("[data-sheet-mark]")?.textContent ?? null,
      label: sheet?.getAttribute("aria-label") ?? null,
      explainer: sheet?.querySelector("[data-sheet-explainer]")?.textContent ?? null,
      rows: sheet ? [...sheet.querySelectorAll("button")].map((b) => ({ label: b.querySelector("span span")?.textContent ?? b.textContent.trim(), detail: b.querySelector("[data-row-detail]")?.textContent ?? null })).filter((r) => r.label) : [],
      move: move?.textContent.trim() ?? null,
      guide, ring,
      chip: chip ? { tone: chip.dataset.proposalChip, text: chip.querySelector("[data-proposal-text]")?.textContent.trim() } : null,
    };
  });
  const guideText = (v) => v.guide.find((g) => g.where === (phone ? "sheet" : "notice"))?.text ?? null;
  const closeSheet = async () => { await page.getByRole("button", { name: "Atcelt", exact: true }).last().click(); await page.waitForTimeout(400); };

  // ── a stop ──
  await L.fit(page, await L.line(page));
  await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().click(); await page.waitForTimeout(600);
  let v = await view();
  rec("stop: orange numbered disc, „Pietura 1 · Līgatne”, explainer", v.mark === "stop" && v.markText === "1" && v.label === "Pietura 1 · Līgatne" && v.explainer === "Maršruts iet caur šo vietu, un tā ir GPX failā.", v);
  rec("stop: each row has its detail", v.rows.find((r) => r.label === "Padarīt caurbraucamu")?.detail === "Vairs nebūs numura un nebūs GPX pieturas" && v.rows.filter((r) => r.label !== "Atcelt").every((r) => r.detail), v.rows);
  rec("stop: guidance „Pietura 1 izvēlēta – izvēlies darbību.”", guideText(v) === "Pietura 1 izvēlēta – izvēlies darbību.", v.guide);
  rec("stop: ringed in orange", v.ring === "#f56300", { ring: v.ring });
  await shot("stop");
  await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(700);
  v = await view();
  rec("move: „Pārvieto „Pietura 1” – pieskaries jaunajai vietai kartē.”", v.move === "Pārvieto „Pietura 1” – pieskaries jaunajai vietai kartē.", { move: v.move });
  await shot("move");
  // Routing, then proposed (router slowed so routing can be seen).
  const slow = async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.fallback(); };
  await page.route("**/api/reroute-leg", slow);
  const box = await page.locator('.maplibregl-marker[aria-label="Līgatne"]').first().boundingBox();
  await tapXY(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40);
  let routing = null;
  for (let k = 0; k < 100 && !routing; k++) { const s = await view(); if (s.chip?.tone === "routing") routing = s; else await page.waitForTimeout(20); }
  rec("routing: „Pārrēķinu… – vari jau spiest ✓, apstiprināšu, tiklīdz būs gatavs.”", routing?.chip?.text === "Pārrēķinu… – vari jau spiest ✓, apstiprināšu, tiklīdz būs gatavs.", routing?.chip);
  await shot("routing-chip");
  await L.waitChip(page);
  v = await view();
  rec("proposed: the delta, then „– ✓ apstiprina, ✕ atmet.”", v.chip?.tone === "proposed" && /^\d+([,.]\d)? → \d+([,.]\d)? km · .* – ✓ apstiprina, ✕ atmet\.$/.test(v.chip.text), v.chip);
  await shot("proposed");
  await slot("x"); await page.waitForTimeout(800);
  await page.unroute("**/api/reroute-leg", slow);

  // ── the start ──
  await L.fit(page, await L.line(page));
  await page.locator(".maplibregl-marker").filter({ has: page.locator('svg [fill="#16a34a"]') }).first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(600);
  v = await view();
  rec("start: green pin, its own explainer, guidance", v.mark === "start" && v.explainer === "Šeit brauciens sākas, un tas ir GPX failā." && guideText(v) === "Starts izvēlēts – izvēlies darbību." && v.ring === "#16a34a", v);
  await shot("start");
  if (v.mark) await closeSheet();

  // ── a road stretch ──
  const ll = await pointOn(0.3); await zoomTo(ll, 13);
  await tapAt(ll); await page.waitForTimeout(700);
  v = await view();
  rec("stretch: line swatch, „Ceļa posms · … km asfalts”, explainer", v.mark === "line" && /^Ceļa posms · \d+([,.]\d)? km [a-zāčēģīķļņšūž ]+$/.test(v.label) && v.explainer === "Šo gabalu var virzīt citur vai pievienot tam punktu.", v);
  rec("stretch: row details", v.rows.find((r) => r.label === "Virzīt caur citu vietu")?.detail === "Pieskaries kartē vietai, caur kuru braukt" && v.rows.find((r) => r.label === "Pievienot punktu šeit")?.detail === "Līnija nemainās – punktu varēs pārvietot", v.rows);
  rec("stretch: guidance „Ceļa posms izvēlēts – izvēlies darbību.”", guideText(v) === "Ceļa posms izvēlēts – izvēlies darbību.", v.guide);
  await shot("stretch");
  await page.getByText("Virzīt caur citu vietu", { exact: true }).click(); await page.waitForTimeout(600);
  v = await view();
  rec("via: „Virzi posmu – pieskaries vietai, caur kuru braukt.”", v.move === "Virzi posmu – pieskaries vietai, caur kuru braukt.", { move: v.move });
  await shot("via");
  // ✕ on the hint: back to nothing
  await page.locator('[data-point-sheet="move"] button').click(); await page.waitForTimeout(500);

  // ── a pass-through point (dropped on the line) ──
  await tapAt(ll); await page.waitForTimeout(700);
  await page.getByText("Pievienot punktu šeit", { exact: true }).click(); await page.waitForTimeout(1000);
  const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
  await dot.click(); await page.waitForTimeout(600);
  v = await view();
  rec("pass-through: white dot, explainer, guidance, dark ring", v.mark === "pass" && v.label === "Caurbraucams punkts" && v.explainer === "Tikai virza līniju, bez numura un bez apstāšanās." && guideText(v) === "Caurbraucams punkts izvēlēts – izvēlies darbību." && v.ring === "#1c1917", v);
  rec("pass-through: „Izņemt” says what it does", v.rows.find((r) => r.label === "Izņemt")?.detail === "Līnija vairs netiks virzīta caur šo punktu", v.rows);
  await shot("pass");
  await closeSheet();
  await slot(2); await page.waitForTimeout(900);

  // ── refused: a stop in the Gulf of Riga ──
  await zoomTo([24.35, 57.25], 9);
  await slot(1); await page.waitForTimeout(400); await tapAt([24.35, 57.25]);
  const sr = await L.waitChip(page, ["refused"], 30000);
  v = await view();
  rec("refused: the reason, then „– izvēlies citu vietu.”", sr.chip?.tone === "refused" && / – (izvēlies citu vietu|spied „Pārrēķināt posmu” vai ✕ atmet)\.$/.test(v.chip?.text ?? "") && !/\. – /.test(v.chip?.text ?? ""), v.chip);
  await shot("refused");
  await slot("x"); await page.waitForTimeout(800);

  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
