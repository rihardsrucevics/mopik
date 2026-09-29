// Phase 1 addition: nearest-leg insertion, kind switch, on-line move — driven in the real UI.
const L = require("./lib-insert.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "phone" : "desk";
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"} ${name} ${detail !== undefined ? JSON.stringify(detail) : ""}`); };
const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/insert-${tag}-${n}.png` });
  await L.plan(page, ["Sigulda", "Līgatne", "Cēsis"]);
  await L.generate(page);
  await page.getByRole("button", { name: "Labot maršrutu kartē" }).click();
  await page.waitForTimeout(2500);
  const slot = async (n) => (await L.slotBtn(page, n)).click();
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(900); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); if (phone) await page.touchscreen.tap(p.x, p.y); else await page.mouse.click(p.x, p.y); await page.waitForTimeout(800); };
  const lineNow = await L.line(page);
  const cum = [0]; for (let i = 1; i < lineNow.length; i++) cum.push(cum[i - 1] + hv(lineNow[i - 1], lineNow[i]));
  const total = cum.at(-1);
  const alongOf = (ll) => { let best = [Infinity, 0]; lineNow.forEach((c, i) => { const d = hv(c, ll); if (d < best[0]) best = [d, cum[i]]; }); return best[1]; };
  const pointAt = (frac, north = 0, east = 0) => {
    const i = cum.findIndex((m) => m >= total * frac); const p = lineNow[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const pins = [...document.querySelectorAll(".maplibregl-marker")].filter((e) => /^\d+$/.test(e.textContent.trim())).map((e) => `${e.getAttribute("aria-label")}=${e.textContent.trim()}${e.dataset.pending ? "*" : ""}`);
    const choices = [...document.querySelectorAll("[data-choice-group]")].map((g) => `${g.dataset.choiceGroup}[${[...g.querySelectorAll("[data-choice]")].map((b) => `${b.getAttribute("aria-checked") === "true" ? "●" : "○"}${b.textContent.trim()}`).join(" | ")}]`);
    const chip = document.querySelector("[data-proposal-chip]");
    const box = document.querySelector("[data-map-choices]")?.getBoundingClientRect();
    const chipBox = chip?.getBoundingClientRect();
    const dots = document.querySelectorAll('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').length;
    const finish = document.querySelectorAll('[data-pending="finish"]').length;
    return {
      field: input ? (input.value || input.placeholder) : null, pins, choices, dots, finish,
      chip: chip ? { tone: chip.dataset.proposalChip, text: chip.querySelector("[data-proposal-text]")?.textContent, notes: chip.querySelector("[data-proposal-notes]")?.textContent ?? null, h: Math.round(chipBox.height) } : null,
      choicesH: box ? Math.round(box.height) : 0,
    };
  });
  const waitChip = async () => { await L.waitChip(page); await page.waitForTimeout(300); return ui(); };
  const idle = await L.state(page);
  const slotsOf = (s) => JSON.stringify(s.slots.map((x) => `${x.slot}@${x.rect}`));
  const idleSlots = slotsOf(idle);
  console.log("idle", JSON.stringify(await ui()));
  const places = await page.evaluate(() => [...document.querySelectorAll(".maplibregl-marker")].map((e) => e.getAttribute("aria-label")).filter(Boolean));
  console.log("markers", places.join(" · "));
  const ligatne = await page.evaluate(() => { const e = [...document.querySelectorAll(".maplibregl-marker")].find((x) => x.getAttribute("aria-label") === "Līgatne"); if (!e) return null; const r = e.getBoundingClientRect(); const ll = window.__map.unproject([r.x + r.width / 2 - window.__map.getContainer().getBoundingClientRect().x, r.y + r.height / 2 - window.__map.getContainer().getBoundingClientRect().y]); return [ll.lng, ll.lat]; });
  const ligAlong = ligatne ? alongOf(ligatne) : total * 0.33;
  console.log("line km", Math.round(total / 100) / 10, "Līgatne at km", Math.round(ligAlong / 100) / 10);

  // ── 1. sure: into the first leg, Sigulda → Līgatne, live numbers ──
  {
    const ll = pointAt((ligAlong / total) * 0.5, 350); await zoomTo(ll);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    const s = await waitChip();
    console.log("sure", JSON.stringify(s));
    rec("sure: field names the leg", /^Pietura 1 · starp „Sigulda” un „Līgatne”/.test(s.field ?? ""), s.field);
    rec("sure: pins renumber live (new 1, Līgatne 2)", s.pins.includes("Līgatne=2") && s.pins.some((p) => p.endsWith("=1*")), s.pins);
    rec("sure: no leg chips, the kind switch shown", s.choices.length === 1 && s.choices[0].startsWith("kind[●Pietura"), s.choices);
    rec("sure: slots unchanged", slotsOf(await L.state(page)) === idleSlots);
    await shot("sure");
    const n0 = log.reroute;
    await slot(3); await page.waitForTimeout(1800);
    const after = await ui();
    rec("sure: ✓ commits it as stop 1, no extra routing", after.pins.includes("Līgatne=2") && log.reroute === n0 && !after.chip, { pins: after.pins, extra: log.reroute - n0 });
    await slot(2); await page.waitForTimeout(1500);
    const back = await ui();
    rec("sure: ↶ gives the old numbers back", back.pins.includes("Līgatne=1") && back.pins.length === 1, back.pins);
  }

  // ── 2. kind switch: stop → pass-through → stop → pass-through, ✓ ──
  {
    const ll = pointAt((ligAlong / total) * 0.5, 350); await zoomTo(ll);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    await waitChip();
    const r0 = log.reroute;
    await page.locator('[data-choice="pass"]').click(); await page.waitForTimeout(300);
    const s = await waitChip();
    console.log("pass", JSON.stringify(s));
    rec("kind: pass-through — no number, the stops keep theirs, a dashed dot waits", !s.pins.some((p) => p.endsWith("*")) && s.pins.includes("Līgatne=1") && /^Caurbraucams punkts · starp „Sigulda” un „Līgatne”/.test(s.field ?? ""), { pins: s.pins, field: s.field });
    rec("kind: re-proposed as a pass-through point", log.reroute > r0 && s.chip?.tone === "proposed", { reroutes: log.reroute - r0, chip: s.chip });
    rec("kind: slots unchanged", slotsOf(await L.state(page)) === idleSlots);
    await shot("kind-pass");
    await page.locator('[data-choice="stop"]').click(); await page.waitForTimeout(300);
    const t = await waitChip();
    rec("kind: back to a stop, numbered 1 again", t.pins.some((p) => p.endsWith("=1*")) && t.pins.includes("Līgatne=2"), t.pins);
    await page.locator('[data-choice="pass"]').click(); await page.waitForTimeout(300);
    await waitChip();
    const n0 = log.reroute;
    await slot(3); await page.waitForTimeout(1800);
    const after = await ui();
    rec("kind: ✓ commits a pass-through point (a dot, no new stop)", after.dots >= 1 && after.pins.includes("Līgatne=1") && log.reroute === n0, { dots: after.dots, pins: after.pins });
  }

  // ── 3. §3: move that dot onto the line elsewhere → keep / remove ──
  {
    await L.fit(page, lineNow, 40);
    const dot = page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]').first();
    await dot.evaluate((e) => e.click()); await page.waitForTimeout(500);
    await page.getByText("Pārvietot", { exact: true }).first().click(); await page.waitForTimeout(1000);
    // On the ride's line in the last leg (Cēsis → Valmiera), exactly on it.
    const onLine = pointAt(0.85); await zoomTo(onLine, 15);
    const r0 = log.reroute;
    await tapAt(onLine);
    const s = await waitChip();
    console.log("move", JSON.stringify(s));
    rec("move: a tap on the line is the new place (no grab), the two chips offered", s.choices.some((c) => c.startsWith("move[●Vest caur šejieni | ○Izņemt punktu")) && s.dots >= 1, s.choices);
    await shot("move-online");
    await page.locator('[data-choice="remove"]').click(); await page.waitForTimeout(300);
    const t = await waitChip();
    rec("move: „Izņemt punktu” re-proposes", t.choices.some((c) => c.includes("●Izņemt punktu")) && log.reroute > r0 + 1 && t.chip?.tone === "proposed", { chips: t.choices, reroutes: log.reroute - r0, chip: t.chip });
    await shot("move-remove");
    await slot(3); await page.waitForTimeout(1800);
    const after = await ui();
    rec("move: ✓ removed the point", after.dots === 0, { dots: after.dots });
    await slot(2); await page.waitForTimeout(1200); // back to the dot
    await slot(2); await page.waitForTimeout(1200); // back to before the dot
  }

  // ── 4. tie: beside Līgatne, as far from the leg before it as from the leg after ──
  const offset = (c, north, east) => [c[0] + east / (111195 * Math.cos((c[1] * Math.PI) / 180)), c[1] + north / 111195];
  const minTo = (ll, from, to) => { let d = Infinity; lineNow.forEach((c, i) => { if (cum[i] >= from && cum[i] <= to) d = Math.min(d, hv(c, ll)); }); return d; };
  let tiePoint = null;
  if (ligatne) for (const r of [250, 400, 600, 900]) for (let a = 0; a < 24 && !tiePoint; a++) {
    const ll = offset(ligatne, r * Math.cos((a * Math.PI) / 12), r * Math.sin((a * Math.PI) / 12));
    const d1 = minTo(ll, 0, ligAlong), d2 = minTo(ll, ligAlong, total);
    if (Math.abs(d1 - d2) <= 0.06 * Math.max(d1, d2) && Math.max(d1, d2) > 100) tiePoint = ll;
  }
  console.log("tie point", JSON.stringify(tiePoint));
  if (tiePoint) {
    const ll = tiePoint; await zoomTo(ll, 14);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    const s = await waitChip();
    console.log("tie", JSON.stringify(s));
    const leg = s.choices.find((c) => c.startsWith("leg["));
    rec("tie: two leg chips, the first preselected", Boolean(leg && /^leg\[●.* \| ○/.test(leg)), s.choices);
    rec("tie: slots unchanged", slotsOf(await L.state(page)) === idleSlots);
    await shot("tie");
    if (leg) {
      const before = s.field;
      await page.locator('[data-choice-group="leg"] [data-choice]').nth(1).click(); await page.waitForTimeout(300);
      const t = await waitChip();
      rec("tie: the other chip re-inserts it and re-proposes", t.field !== before && t.choices.find((c) => c.startsWith("leg["))?.includes("○") && t.chip?.tone === "proposed", { before, after: t.field, chip: t.chip });
      await shot("tie-other");
    }
    await slot("x"); await page.waitForTimeout(900);
  }

  // ── 5. beyond the finish: „Beigās (jauns finišs)” ──
  {
    const end = lineNow.at(-1), prev = lineNow[Math.max(0, lineNow.length - 40)];
    const dx = end[0] - prev[0], dy = end[1] - prev[1], k = 1500 / hv(prev, end);
    const ll = [end[0] + dx * k, end[1] + dy * k]; await zoomTo(ll, 12);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    const s = await waitChip();
    console.log("beyond", JSON.stringify(s));
    rec("beyond: the leg and „Beigās (jauns finišs)”", s.choices.some((c) => /^leg\[●(Starp „Līgatne” un „Cēsis”|Pēc „Līgatne”) \| ○Beigās \(jauns finišs\)\]/.test(c)), s.choices);
    await page.locator('[data-choice="extend"]').click(); await page.waitForTimeout(300);
    const t = await waitChip();
    console.log("extend", JSON.stringify(t));
    rec("beyond: new finish — field, red pending pin, Cēsis numbered 2", /^Jauns finišs · pēc „Cēsis”/.test(t.field ?? "") && t.finish === 1 && t.pins.includes("Cēsis=2"), { field: t.field, finish: t.finish, pins: t.pins });
    rec("beyond: proposal for the new finish", t.chip?.tone === "proposed" || t.chip?.tone === "refused", t.chip);
    await shot("extend");
    await slot("x"); await page.waitForTimeout(900);
  }

  // ── 6. far from the line ──
  {
    let ll = pointAt(0.5, 3500);
    for (let k = 1; k < 20 && minTo(ll, 0, total) < 2600; k++) ll = pointAt(0.5, 3500 + k * 500, k * 300);
    console.log("far point", Math.round(minTo(ll, 0, total)), "m from the line");
    await zoomTo(ll, 11);
    await slot(1); await page.waitForTimeout(400); await tapAt(ll);
    const s = await waitChip();
    console.log("far", JSON.stringify(s));
    rec("far: two leg chips", s.choices.some((c) => c.startsWith("leg[●")), s.choices);
    rec("far: notice compact (chips one row per group, chip ≤ 2 lines + notes)", s.choicesH <= (phone ? 66 : 34) && (!s.chip || s.chip.h <= 56), { choicesH: s.choicesH, chipH: s.chip?.h });
    await shot("far");
    await slot("x"); await page.waitForTimeout(900);
  }
  const end = await L.state(page);
  rec("slots identical at the end", slotsOf(end) === idleSlots);
  rec("no console errors", log.errors.length === 0, log.errors.slice(0, 5));
  console.log(JSON.stringify({ tag, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.name) }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
