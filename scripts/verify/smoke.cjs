// Smoke suite: the core edit flow on fixture rides and the router cache.
//   node scripts/verify/smoke.cjs phone|desk
// Normally run through smoke.sh, which runs both viewports in parallel.
if (!process.env.DPR) process.env.DPR = "1"; // see README: layout is in CSS px, DPR 1 is 4× fewer pixels
const L = require("./lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const T0 = Date.now();
// SECTIONS=1,reach runs section 1 (always) and only the listed groups: 1b-3, add, 4-10, reach. Unset: all.
const want = (k) => !process.env.SECTIONS || process.env.SECTIONS.split(",").includes(k);
const results = [];
const rec = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`[${tag}] ${ok ? "PASS" : "FAIL"} ${name}${!ok && detail ? " " + JSON.stringify(detail) : ""}`); };
const CHIP_RE = /^\d+(,\d)? → \d+(,\d)? km · [+−±-]?\d+ (min|h( \d+ min)?) · atkārtoti \d+ → \d+ %/;
const hv = (a, b) => { const R = 6371000, r = Math.PI / 180; const dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };

(async () => {
  const { browser, page, log } = await L.open({ phone });
  const shot = (n) => page.screenshot({ path: `${L.SHOTS}/smoke-${tag}-${n}.png` });
  const slot = async (n) => (await L.slotBtn(page, n)).click();
  const tapXY = async (x, y) => { if (phone) await page.touchscreen.tap(x, y); else await page.mouse.click(x, y); };
  const tapAt = async (ll) => { const p = await L.px(page, ll); await tapXY(p.x, p.y); };
  const zoomTo = async (ll, zoom = 13) => { await page.evaluate(({ ll, zoom }) => window.__map.jumpTo({ center: ll, zoom }), { ll, zoom }); await page.waitForTimeout(500); };
  const marker = (name) => page.locator(`.maplibregl-marker[aria-label="${name}"]`).first();
  const dotsLoc = () => page.locator('.maplibregl-marker[aria-label^="Caurbraucams punkts"]');
  const sheetRow = (label) => page.getByText(label, { exact: true }).first();
  // ── add-kind ── A stop starts from the map field (backlog 40): search is for stops; „+” adds pass-through points.
  const stopFromField = async () => { await page.locator("[data-map-chrome] input:visible").first().click(); await page.waitForTimeout(300); };
  const rects = async () => Object.fromEntries((await L.state(page)).slots.map((s) => [s.slot, s.rect]));
  // ── chain-polish ── how the chip's lines sit: lines of each part, and whether the clamped notes are cut.
  const chipFit = () => page.evaluate(() => {
    const part = (sel) => { const e = document.querySelector(`[data-proposal-chip] ${sel}`); if (!e) return null; const lh = parseFloat(getComputedStyle(e).lineHeight) || 14; return { lines: Math.round(e.getBoundingClientRect().height / lh), clipped: e.scrollHeight > e.clientHeight + 1, text: e.textContent.trim() }; };
    return { text: part("[data-proposal-text]"), notes: part("[data-proposal-notes]"), numbers: part("[data-proposal-numbers]"), title: document.querySelector("[data-proposal-chip]")?.getAttribute("title") ?? "" };
  });
  const fits = (f) => !f.notes || (f.notes.lines <= 3 && !f.notes.clipped);
  const cum = async () => { const c = await L.line(page); const m = [0]; for (let i = 1; i < c.length; i++) m.push(m[i - 1] + hv(c[i - 1], c[i])); return { c, m, tot: m.at(-1) }; };
  const pointOn = async (frac, north = 0, east = 0) => {
    const { c, m, tot } = await cum(); const i = m.findIndex((x) => x >= tot * frac); const p = c[Math.max(0, i)];
    return [p[0] + east / (111195 * Math.cos((p[1] * Math.PI) / 180)), p[1] + north / 111195];
  };
  // The grab / drop pair the straight and guard scripts were tuned on (Antiņciems ride).
  const grabDrop = async (frac, dist, side) => {
    const { c, m: cm, tot } = await cum();
    const at = (x) => { const i = Math.max(1, cm.findIndex((y) => y >= x)); const t = (x - cm[i - 1]) / ((cm[i] - cm[i - 1]) || 1); return [c[i - 1][0] + t * (c[i][0] - c[i - 1][0]), c[i - 1][1] + t * (c[i][1] - c[i - 1][1])]; };
    const g = at(tot * frac), a = at(Math.min(tot, tot * frac + 30));
    const dx = (a[0] - g[0]) * Math.cos(g[1] * Math.PI / 180), dy = a[1] - g[1], n = Math.hypot(dx, dy) || 1;
    const n2 = side * dist * (dx / n), e2 = -side * dist * (dy / n);
    return { grab: g, drop: [g[0] + e2 / (111195 * Math.cos(g[1] * Math.PI / 180)), g[1] + n2 / 111195] };
  };
  const bend = async (grab, drop) => {
    await zoomTo(grab, 14);
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
  // „Pārvietot” zooms in on the point: a tap read off the marker mid-animation lands somewhere else each run.
  const settled = async () => { for (let k = 0; k < 50 && (await page.evaluate(() => window.__map.isMoving() || window.__map.isZooming())); k++) await page.waitForTimeout(60); await page.waitForTimeout(100); };
  const moveMarker = async (loc, dx, dy) => {
    await loc.click(); await page.waitForTimeout(400);
    await sheetRow("Pārvietot").click(); await page.waitForTimeout(400); await settled();
    const box = await loc.boundingBox();
    await tapXY(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
  };

  /**
   * One edit, the whole way: proposal → chip (numbers) → halo over a dimmed
   * ride → ✕ leaves everything → again → ✓ commits with no extra routing →
   * ↶ undoes. The four button slots keep their rects in every state.
   */
  async function exercise(name, gesture, { tones = ["proposed", "warn"], idle } = {}) {
    const t = Date.now();
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page);
    const r0 = idle ?? (await rects());
    await gesture();
    const s1 = await L.waitChip(page);
    const chipOk = tones.includes(s1.chip?.tone) && CHIP_RE.test(s1.chip.text);
    rec(`${name}: chip with numbers`, chipOk, s1.chip);
    rec(`${name}: halo over the dimmed ride`, s1.proposalLayers.length > 0 && JSON.stringify(s1.routeOpacity).includes("0.3"), { layers: s1.proposalLayers, opacity: s1.routeOpacity });
    rec(`${name}: slots did not move (proposal)`, JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    if (!chipOk) { await shot(`fail-${name}`); await slot("x"); await page.waitForTimeout(500); return; }
    await slot("x"); await page.waitForTimeout(500);
    const s2 = await L.state(page);
    rec(`${name}: ✕ leaves line and undo`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0 && !s2.chip);
    await gesture(); const s3 = await L.waitChip(page);
    if (!["proposed", "warn"].includes(s3.chip?.tone)) { rec(`${name}: second proposal`, false, s3.chip); await slot("x"); return; }
    const n0 = log.reroute;
    if (s3.chip.tone === "warn") await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
    else await slot(3);
    await page.waitForTimeout(800);
    const s4 = await L.state(page);
    rec(`${name}: ✓ commits, no extra routing`, L.hash(await L.line(page)) !== h0 && log.reroute === n0 && !s4.chip, { extra: log.reroute - n0 });
    rec(`${name}: ↶ enabled after ✓`, (await L.undoEnabled(page)) === true);
    rec(`${name}: slots did not move (committed)`, JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    await slot(2); await page.waitForTimeout(700);
    rec(`${name}: ↶ undoes`, L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    console.log(`[${tag}]   ${name} ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  // ── 1. Sigulda → Līgatne → Cēsis: add a stop, move a stop, the line sheet ──
  let t = Date.now();
  await L.openRide(page, "sigulda-cesis");
  console.log(`[${tag}]   openRide sigulda-cesis ${((Date.now() - t) / 1000).toFixed(1)} s`);
  const idle = await rects();
  rec("edit mode: four slots drawn", ["1", "2", "3", "x"].every((k) => idle[k]), idle);
  await exercise("add stop", async () => { const ll = await pointOn(0.3, 400, 0); await zoomTo(ll); await stopFromField(); await tapAt(ll); }, { tones: ["proposed"], idle });
  await exercise("move stop", async () => { await L.fit(page, await L.line(page)); await moveMarker(marker("Līgatne"), 70, -40); }, { idle });
  {
    const h0 = L.hash(await L.line(page)); const n0 = log.reroute;
    const ll = await pointOn(0.3); await zoomTo(ll, 13);
    await tapAt(ll); await page.waitForTimeout(500);
    const kind = await page.locator('[data-point-sheet="menu"]').getAttribute("data-sheet-kind").catch(() => null);
    rec("line sheet opens on a tap on the line", kind === "line", { kind });
    rec("line sheet: slots did not move", JSON.stringify(await rects()) === JSON.stringify(idle));
    const d0 = await dotsLoc().count();
    await page.getByText("Pievienot punktu šeit", { exact: true }).click(); await page.waitForTimeout(700);
    rec("„Pievienot punktu šeit”: one more dot, same line, nothing routed", (await dotsLoc().count()) === d0 + 1 && L.hash(await L.line(page)) === h0 && log.reroute === n0, { d0, d1: await dotsLoc().count(), reroutes: log.reroute - n0 });
    rec("…and ↶ is live", (await L.undoEnabled(page)) === true);
    await slot(2); await page.waitForTimeout(600);
    rec("…↶ takes the dot away", (await dotsLoc().count()) === d0);
  }

  if (want("1b-3")) { // SECTIONS 1b-3
  // ── 1b. Backlog 36: a stretch selected, its end dragged, „Izslēgt šo posmu” → proposal → ✓ → ↶ ──
  {
    const t1 = Date.now();
    const SH = process.env.STRETCH_SHOTS || L.SHOTS;
    const stretchShot = (n) => tag === "375" && page.screenshot({ path: `${SH}/stretch-${n}.png` });
    const titleText = async () => ((await page.locator('[data-point-sheet="menu"] .truncate').first().textContent().catch(() => "")) ?? "").trim();
    const kmOf = (s) => { const m = /· (\d+),(\d) km/.exec(s); return m ? Number(`${m[1]}.${m[2]}`) : NaN; };
    const openStretch = async () => {
      await L.fit(page, await L.line(page));
      const ll = await pointOn(0.55); await zoomTo(ll, 13);
      await tapAt(ll); await page.waitForTimeout(700); await settled();
    };
    await openStretch();
    const group = page.locator('[data-sheet-group="stretch"]');
    const groupText = (await group.textContent().catch(() => "")) ?? "";
    rec("stretch: the line sheet shows „Šis posms” with „Izslēgt šo posmu”", (await group.count()) === 1 && /Šis posms/i.test(groupText) && groupText.includes("Izslēgt šo posmu"), { groupText });
    const title0 = await titleText();
    rec("stretch: the header says the stretch's length and road", /^Ceļa posms · \d+,\d km \S/.test(title0), { title0 });
    const handles = page.locator("[data-stretch-handle]");
    rec("stretch: two end handles, the yellow selection drawn", (await handles.count()) === 2 && (await page.evaluate(() => Boolean(window.__map.getLayer("stretch-sel")))), { handles: await handles.count() });
    const guideFit = await page.evaluate(() => {
      const e = document.querySelector('[data-edit-guide="sheet"]') ?? document.querySelector("[data-edit-guide]");
      if (!e) return null;
      const lh = parseFloat(getComputedStyle(e).lineHeight) || 16;
      return { lines: Math.round(e.getBoundingClientRect().height / lh), text: e.textContent.trim() };
    });
    rec("stretch: the guidance fits ≤ 3 lines, en dash", Boolean(guideFit) && guideFit.lines <= 3 && guideFit.text.includes(" – "), guideFit);
    await stretchShot("selected");
    // Drag the far end a third of the way back towards the near one.
    const hb = async (end) => { const b = await page.locator(`[data-stretch-handle="${end}"]`).boundingBox(); return b && { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const a = await hb("from"), b = await hb("to");
    if (a && b) {
      const q = { x: b.x + (a.x - b.x) / 3, y: b.y + (a.y - b.y) / 3 };
      if (phone) {
        const cdp = await page.context().newCDPSession(page);
        const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        await tp("touchStart", b.x, b.y);
        for (let k = 1; k <= 10; k++) { await tp("touchMove", b.x + (q.x - b.x) * k / 10, b.y + (q.y - b.y) * k / 10); await page.waitForTimeout(30); }
        await tp("touchEnd");
      } else {
        await page.mouse.move(b.x, b.y); await page.mouse.down();
        for (let k = 1; k <= 10; k++) { await page.mouse.move(b.x + (q.x - b.x) * k / 10, b.y + (q.y - b.y) * k / 10); await page.waitForTimeout(30); }
        await page.mouse.up();
      }
      await page.waitForTimeout(400);
    }
    const title1 = await titleText();
    rec("stretch: dragging an end shortens the stretch, the sheet stays", kmOf(title1) < kmOf(title0) && (await page.locator('[data-point-sheet="menu"]').count()) === 1, { title0, title1, a, b });
    await stretchShot("adjusted");
    // Backlog 51: an end dragged far, twice, keeps following (MapLibre's marker
    // drag left it dead once let go over anything above the canvas), and the
    // map still pans afterwards with the page where it was.
    const dragPx = async (p, q) => {
      if (phone) {
        const cdp = await page.context().newCDPSession(page);
        const tp = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        await tp("touchStart", p.x, p.y);
        for (let k = 1; k <= 12; k++) { await tp("touchMove", p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
        await tp("touchEnd"); await cdp.detach().catch(() => {});
      } else {
        await page.mouse.move(p.x, p.y); await page.mouse.down();
        for (let k = 1; k <= 12; k++) { await page.mouse.move(p.x + (q.x - p.x) * k / 12, p.y + (q.y - p.y) * k / 12); await page.waitForTimeout(30); }
        await page.mouse.up();
      }
      await page.waitForTimeout(400);
    };
    const scroll0 = await page.evaluate(() => window.scrollY);
    const kms = [kmOf(await titleText())];
    for (let k = 0; k < 2; k++) {
      const f = await hb("from"), e = await hb("to");
      if (!f || !e) break;
      await dragPx(e, { x: e.x + (e.x - f.x) * 1.2, y: e.y + (e.y - f.y) * 1.2 });
      kms.push(kmOf(await titleText()));
    }
    rec("stretch: the far end dragged far twice — it follows both times, the stretch grows", kms.length === 3 && kms[1] > kms[0] && kms[2] > kms[1] && (await handles.count()) === 2, { kms });
    {
      const f = await hb("from"), e = await hb("to");
      const km0 = kmOf(await titleText());
      if (f && e) await dragPx(f, { x: f.x + (f.x - e.x) * 0.5, y: f.y + (f.y - e.y) * 0.5 });
      rec("stretch: …and then the near end follows too", kmOf(await titleText()) > km0, { km0, km1: kmOf(await titleText()) });
    }
    await stretchShot("dragged-far");
    const panOnce = async () => {
      const box = await page.evaluate(() => { const r = window.__map.getContainer().getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      const p = { x: box.x + box.w * 0.45, y: box.y + box.h * 0.22 };
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className?.toString() ?? "", p);
      const c0 = await page.evaluate(() => window.__map.getCenter().toArray());
      await dragPx(p, { x: p.x + 90, y: p.y + 70 }); await settled();
      const c1 = await page.evaluate(() => window.__map.getCenter().toArray());
      return { moved: Math.abs(c1[0] - c0[0]) + Math.abs(c1[1] - c0[1]) > 1e-5, hit, c0, c1, scrollY: await page.evaluate(() => window.scrollY) };
    };
    const pan1 = await panOnce();
    rec("stretch: with the selection up the map still pans, the page did not scroll", pan1.moved && pan1.scrollY === scroll0 && (await handles.count()) === 2, { ...pan1, scroll0 });
    await page.locator('[data-point-sheet="menu"] button[aria-label]').first().click().catch(() => {}); await page.waitForTimeout(400);
    rec("stretch: ✕ closes the sheet and the selection", (await page.locator('[data-point-sheet="menu"]').count()) === 0 && (await handles.count()) === 0);
    const pan2 = await panOnce();
    rec("stretch: after closing, the map pans and the page did not scroll", pan2.moved && pan2.scrollY === scroll0 && !(await page.evaluate(() => Boolean(window.__map.getLayer("stretch-sel")))), { ...pan2, scroll0 });
    // Escape clears a selection too (desktop: on a phone Escape also leaves full screen).
    if (!phone) {
      await openStretch();
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      rec("stretch: Escape clears the selection", (await handles.count()) === 0 && (await page.locator('[data-point-sheet="menu"]').count()) === 0);
    }
    const exclude = async () => { await openStretch(); await sheetRow("Izslēgt šo posmu").click(); };
    await exercise("exclude stretch", exclude, { idle });
    // Committed: the excluded stretch shows as dashes; tapping it offers „Atļaut atkal”.
    await exclude(); const sx = await L.waitChip(page);
    await stretchShot("proposal");
    const cf = await chipFit();
    rec("stretch: the proposal's notes fit ≤ 3 lines", fits(cf), cf);
    if (["proposed", "warn"].includes(sx.chip?.tone)) {
      await slot(3); await page.waitForTimeout(800);
      const exLayer = await page.evaluate(() => Boolean(window.__map.getLayer("stretch-excluded")));
      rec("stretch: ✓ keeps the exclusion — dark-red dashes in edit mode", exLayer);
      await zoomTo(await pointOn(0.55), 14); await page.waitForTimeout(400);
      await stretchShot("excluded");
      // Backlog 51: a tap on the dashes opens „Izslēgts posms”, and „Atļaut atkal” takes the exclusion off.
      const ex = await page.evaluate(() => { const src = window.__map.getSource("stretch-excluded"); const f = (d) => d?.features?.[0]?.geometry?.coordinates ?? d?.geojson?.features?.[0]?.geometry?.coordinates ?? null; return f(src?._data) ?? f(src?.serialize?.().data); });
      if (ex?.length) {
        const mid = ex[Math.floor(ex.length / 2)];
        await zoomTo(mid, 15); await tapAt(mid); await page.waitForTimeout(900);
        const exTitle = await titleText();
        const allow = page.getByText("Atļaut atkal", { exact: true }).first();
        rec("stretch: a tap on the excluded stretch opens „Izslēgts posms” with „Atļaut atkal”", exTitle === "Izslēgts posms" && (await allow.count()) === 1, { exTitle });
        await stretchShot("excluded-sheet");
        if (await allow.count()) { await allow.click(); await page.waitForTimeout(1500); }
        rec("stretch: „Atļaut atkal” takes the exclusion off", !(await page.evaluate(() => Boolean(window.__map.getLayer("stretch-excluded")))));
        await slot(2); await page.waitForTimeout(700);
        rec("stretch: ↶ brings the exclusion back", await page.evaluate(() => Boolean(window.__map.getLayer("stretch-excluded"))));
      } else rec("stretch: the excluded stretch's line is readable", false);
      await slot(2); await page.waitForTimeout(700);
      rec("stretch: ↶ takes the exclusion back", !(await page.evaluate(() => Boolean(window.__map.getLayer("stretch-excluded")))));
    } else { rec("stretch: second exclusion proposal", false, sx.chip); await slot("x"); }
    console.log(`[${tag}]   stretch ${((Date.now() - t1) / 1000).toFixed(1)} s`);
  }

  } // SECTIONS 1b-3
  // ── 1c. „+” adds pass-through points in a batch; the empty-map offer; a row waiting has a way out (rider, 2026-09-30) ──
  if (want("add")) {
  {
    const t = Date.now();
    const ADD_SHOTS = process.env.ADDPOINT_SHOTS || L.SHOTS;
    const addShot = async (n) => { if (phone) await page.screenshot({ path: `${ADD_SHOTS}/addpoint-${n}.png` }); };
    const field = () => page.evaluate(() => { const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; const i = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0]; return i ? (i.value || i.placeholder) : null; });
    const stopsLoc = () => page.locator(".maplibregl-marker:not([data-pending])").filter({ hasText: /^\d+$/ });
    const pendingDots = () => page.locator('[data-pending="pass"]');
    const words = async () => { const st = await L.state(page); return [...st.notices, (await field()) ?? ""].join(" | "); };
    const slotsNow = async () => Object.fromEntries((await L.state(page)).slots.map((x) => [x.slot, x]));
    // The guard (images/46.png): a state that is not idle has ✕ on and says what is happening.
    const guard = async (name, re) => { const sl = await slotsNow(); const w = await words(); rec(`guard: ${name} — ✕ on, the line says what to do`, sl.x?.disabled === false && re.test(w), { x: sl.x?.disabled, w }); };
    const tapGap = phone ? 420 : 150; // a phone tap settles 300 ms before it counts (TAP_SETTLE_MS)
    const h0 = L.hash(await L.line(page)); const d0 = await dotsLoc().count(); const p0 = await stopsLoc().count(); const u0 = await L.undoEnabled(page);
    const pts = [await pointOn(0.25, 350, 0), await pointOn(0.3, 350, 0), await pointOn(0.35, 350, 0)];
    await L.fit(page, pts, 80);
    // „+”: no chooser, the guidance line, ✓ off, ✕ on, the slots where they were.
    await slot(1); await page.waitForTimeout(300);
    const g1 = await words();
    const sl1 = await slotsNow();
    rec("„+”: no chooser, „Pieskaries kartei, lai pievienotu caurbraucamu punktu – ✓ apstiprina visus, ✕ atmet.”", (await page.locator("[data-add-chooser]").count()) === 0 && g1.includes("Pieskaries kartei, lai pievienotu caurbraucamu punktu – ✓ apstiprina visus, ✕ atmet."), { g1 });
    rec("„+”: slots did not move, ✓ off, ✕ on, „+” off", JSON.stringify(await rects()) === JSON.stringify(idle) && sl1["3"]?.disabled === true && sl1.x?.disabled === false && sl1["1"]?.disabled === true, sl1);
    await guard("armed", /Pieskaries kartei/);
    await addShot("armed");
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    rec("„+”: Escape ends it", !(await words()).includes("Pieskaries kartei, lai") && (await slotsNow())["1"]?.disabled === false);
    // Three quick taps: three pending dots at once, one proposal.
    await slot(1); await page.waitForTimeout(300);
    for (const ll of pts) { await tapAt(ll); await page.waitForTimeout(tapGap); }
    await page.waitForTimeout(350);
    const n3 = await pendingDots().count();
    const f3 = await field();
    rec("3 taps: 3 pending dots at once, the field „3 caurbraucami punkti – ✓ apstiprina visus, ↶ noņem pēdējo, ✕ atmet.”", n3 === 3 && f3 === "3 caurbraucami punkti – ✓ apstiprina visus, ↶ noņem pēdējo, ✕ atmet.", { n3, f3 });
    await addShot("batch");
    const sp = await L.waitChip(page, ["proposed", "warn", "refused"], 90000);
    rec("3 taps: one proposal for the batch, no stop added", (await page.locator("[data-proposal-chip]").count()) === 1 && ["proposed", "warn"].includes(sp.chip?.tone) && (await pendingDots().count()) === 3 && (await stopsLoc().count()) === p0, { chip: sp.chip });
    rec("batch: slots did not move", JSON.stringify(await rects()) === JSON.stringify(idle));
    await addShot("batch-proposal");
    if (sp.chip?.tone === "warn") await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click(); else await slot(3);
    await page.waitForTimeout(1200);
    rec("✓: the ride has 3 more pass-through points, no new stops or rows", (await dotsLoc().count()) === d0 + 3 && (await stopsLoc().count()) === p0 && (await pendingDots().count()) === 0 && L.hash(await L.line(page)) !== h0, { dots: await dotsLoc().count(), d0, stops: await stopsLoc().count(), p0 });
    await addShot("committed");
    // The sheet's switch on one of them: a stop, line unchanged; ↶ brings the dot back.
    {
      const h1 = L.hash(await L.line(page));
      await dotsLoc().nth(d0).click(); await page.waitForTimeout(400);
      const sw = page.locator("[data-kind-switch]");
      const selected = await sw.locator('[aria-checked="true"]').getAttribute("data-kind").catch(() => null);
      await addShot("switch-dot");
      await sw.locator('[data-kind="stop"]').click();
      for (let k = 0; k < 100 && (await stopsLoc().count()) !== p0 + 1; k++) await page.waitForTimeout(200);
      rec("sheet switch: „Caurbraucams” → a stop, line unchanged", selected === "pass" && (await stopsLoc().count()) === p0 + 1 && (await dotsLoc().count()) === d0 + 2 && L.hash(await L.line(page)) === h1, { selected, stops: await stopsLoc().count(), dots: await dotsLoc().count() });
      await slot(2); await page.waitForTimeout(700);
      rec("sheet switch: ↶ brings the dot back", (await dotsLoc().count()) === d0 + 3 && (await stopsLoc().count()) === p0);
    }
    await slot(2); await page.waitForTimeout(800);
    rec("↶: the whole batch goes in one step", L.hash(await L.line(page)) === h0 && (await dotsLoc().count()) === d0 && (await L.undoEnabled(page)) === u0, { dots: await dotsLoc().count() });
    // ↶ inside a batch takes the last pending dot; ✕ drops the rest. (The undo may move the camera: aim again.)
    await L.fit(page, pts, 80); await settled();
    await slot(1); await page.waitForTimeout(300);
    await tapAt(pts[0]); await page.waitForTimeout(tapGap); await tapAt(pts[2]); await page.waitForTimeout(tapGap + 300);
    await guard("batch pending", /2 caurbraucami punkti/);
    await slot(2); await page.waitForTimeout(400);
    const n1 = await pendingDots().count();
    await slot("x"); await page.waitForTimeout(600);
    rec("batch: ↶ takes the last pending dot, ✕ drops the rest, the ride as it was", n1 === 1 && (await pendingDots().count()) === 0 && L.hash(await L.line(page)) === h0 && (await dotsLoc().count()) === d0, { n1 });
    // A tap on the empty map offers „Pievienot punktu šeit”; a tap elsewhere dismisses it; the chip adds one pending dot.
    {
      const far = await pointOn(0.3, 1500, 0), far2 = await pointOn(0.3, 1500, 900);
      // Padding clear of the desktop's header bar (top) and the phone's field (bottom): a tap there is on the chrome, not the map.
      await L.fit(page, [far, far2, pts[1]], 170);
      await settled();
      await tapAt(far); await page.waitForTimeout(500);
      const chip = page.locator('[data-choice-group="offer"] [data-choice="offer"]');
      const label = ((await chip.textContent().catch(() => "")) ?? "").trim();
      rec("empty map tap: a marker and „Pievienot punktu šeit”", label === "Pievienot punktu šeit" && (await page.locator("[data-empty-offer]").count()) === 1, { label });
      await guard("offer", /Te var pievienot caurbraucamu punktu – /);
      rec("offer: slots did not move", JSON.stringify(await rects()) === JSON.stringify(idle));
      await addShot("offer");
      await tapAt(far2); await page.waitForTimeout(500);
      rec("offer: a tap elsewhere dismisses it", (await chip.count()) === 0 && (await page.locator("[data-empty-offer]").count()) === 0);
      await tapAt(far); await page.waitForTimeout(500);
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
      rec("offer: Escape dismisses it", (await chip.count()) === 0);
      await tapAt(far); await page.waitForTimeout(500);
      await chip.click(); await page.waitForTimeout(400);
      rec("offer taken: one pending dot there, armed for more", (await pendingDots().count()) === 1 && /1 caurbraucams punkts/.test((await field()) ?? ""), { f: await field() });
      await addShot("offer-taken");
      await L.waitChip(page, ["proposed", "warn", "refused"], 90000);
      await slot("x"); await page.waitForTimeout(600);
      rec("offer: ✕ leaves the ride as it was", L.hash(await L.line(page)) === h0 && (await pendingDots().count()) === 0);
    }
    // The rider's stuck state (images/46.png): the field's tap makes an empty stop row — it says so, and ✕ gets out.
    {
      await stopFromField();
      await guard("a stop row waiting (the field's tap)", /Meklē vietu vai pieskaries kartei – ✕ atceļ\./);
      await addShot("row-waiting");
      await slot("x"); await page.waitForTimeout(500);
      const fx = await field();
      rec("row waiting: ✕ removes the empty row and returns to idle", /^Meklē (vai atzīmē )?pieturu$/.test(fx ?? "") && (await stopsLoc().count()) === p0 && (await slotsNow())["1"]?.disabled === false, { fx });
      await stopFromField();
      await page.keyboard.press("Escape"); await page.waitForTimeout(400);
      rec("row waiting: Escape does the same", /^Meklē (vai atzīmē )?pieturu$/.test((await field()) ?? ""), { f: await field() });
    }
    // A stop still starts from the field and a tap: numbered, pending.
    await L.fit(page, pts, 80);
    await stopFromField();
    await tapAt(pts[1]);
    const ss = await L.waitChip(page);
    const fs = await field();
    rec("stop (field): a numbered pending stop, the field „Pietura N · starp …”", ["proposed", "warn"].includes(ss.chip?.tone) && /^Pietura \d+ · starp „/.test(fs ?? ""), { chip: ss.chip, fs });
    if (ss.chip?.tone === "warn") await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click(); else await slot(3);
    await page.waitForTimeout(900);
    rec("stop ✓: one more numbered stop, no new dot", (await stopsLoc().count()) === p0 + 1 && (await dotsLoc().count()) === d0);
    await slot(2); await page.waitForTimeout(700);
    rec("stop: ↶ takes it away", L.hash(await L.line(page)) === h0 && (await stopsLoc().count()) === p0);
    // The switch on an existing stop (Līgatne).
    {
      await L.fit(page, await L.line(page));
      await marker("Līgatne").click(); await page.waitForTimeout(400);
      const sw = page.locator("[data-kind-switch]");
      const selected = await sw.locator('[aria-checked="true"]').getAttribute("data-kind").catch(() => null);
      await sw.locator('[data-kind="pass"]').click(); await page.waitForTimeout(1200);
      rec("sheet switch on a stop: „Pietura” → a dot, line unchanged", selected === "stop" && (await stopsLoc().count()) === p0 - 1 && (await dotsLoc().count()) === d0 + 1 && L.hash(await L.line(page)) === h0, { selected, stops: await stopsLoc().count(), dots: await dotsLoc().count() });
      await slot(2); await page.waitForTimeout(700);
      rec("…↶ brings the stop back", (await stopsLoc().count()) === p0 && (await dotsLoc().count()) === d0);
    }
    console.log(`[${tag}]   add-point ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  }
  if (want("1b-3")) { // SECTIONS 1b-3
  // ── 2. The rider's ride-0928 (four pass-through points): move one ──
  t = Date.now();
  await L.openRide(page, "ride-0928");
  console.log(`[${tag}]   openRide ride-0928 ${((Date.now() - t) / 1000).toFixed(1)} s`);
  rec("ride-0928 opens with its four pass-through points", (await dotsLoc().count()) === 4, { dots: await dotsLoc().count() });
  await exercise("move pass-through point", async () => { await L.fit(page, await L.line(page)); await moveMarker(dotsLoc().nth(1), -50, -50); });

  // ── 2b. The rider's kapselu-upmali GPX (2026-09-29): „Izņemt” on „Pietura 1 · Viduči” ──
  // Refused in production as a line that could not be joined; a removal only
  // merges the two legs round the point, so it is a proposal whenever roads join them.
  t = Date.now();
  await L.openRide(page, "kapselu-upmali");
  console.log(`[${tag}]   openRide kapselu-upmali ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const VIDUCI = [24.896296, 56.896211];
    const remove = async (loc, zoom = 12) => {
      await zoomTo(VIDUCI, zoom);
      await loc.click(); await page.waitForTimeout(400);
      await sheetRow("Izņemt").click();
    };
    await exercise("remove stop", () => remove(marker("Viduči, Suntažu pagasts")), { tones: ["proposed"] });
    await shot("remove-stop");
    // The production failure's shape: the ride's own profile cannot join the
    // cuts (forced 422 on rung 0) — the removal climbs the ladder, never refused.
    const force = async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (!body.relax) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "unreachable" }) });
      return route.fallback();
    };
    await page.route("**/api/reroute-leg", force);
    const h0 = L.hash(await L.line(page));
    await remove(marker("Viduči, Suntažu pagasts"));
    const s = await L.waitChip(page, ["proposed", "warn", "refused"], 40000);
    rec("remove stop, own profile cannot join: a proposal on a relaxed rung, not refused", ["proposed", "warn"].includes(s.chip?.tone) && CHIP_RE.test(s.chip.text), s.chip);
    await shot("remove-stop-relaxed");
    await slot("x"); await page.waitForTimeout(500);
    rec("…✕ leaves the ride", L.hash(await L.line(page)) === h0);
    await page.unroute("**/api/reroute-leg", force);
    // The pass-through point after the stop, the same way (its removal is a
    // longer way round, so it may be warned as a big detour — still a proposal).
    await exercise("remove pass-through point", () => remove(dotsLoc().nth(4), 11), { tones: ["proposed", "warn"] });
    await shot("remove-pass");
  }

  // ── 3. Antiņciems → Puķes → Rīgas apvedceļš: „Vest pa taisno” and the „Tomēr braukt” guard ──
  t = Date.now();
  await L.openRide(page, "antinciems-rigas");
  console.log(`[${tag}]   openRide antinciems-rigas ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const { grab, drop } = await grabDrop(0.214642, 452.829, -1);
    await bend(grab, drop);
    const s1 = await L.waitChip(page, ["refused", "proposed", "warn"], 40000);
    const straight = page.locator("button:visible", { hasText: "Vest pa taisno" }).first();
    const offered = (await straight.count()) > 0;
    rec("no road there: refused, „Vest pa taisno” offered", s1.chip?.tone === "refused" && offered, s1.chip);
    rec("refused: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    if (offered) {
      await straight.click();
      const s2 = await L.waitChip(page, ["proposed", "warn"], 20000);
      rec("„Vest pa taisno” → a proposal", ["proposed", "warn"].includes(s2.chip?.tone), s2.chip);
      const ok = await L.slotBtn(page, 3);
      if (!(await ok.isDisabled())) await ok.click(); else await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
      await page.waitForTimeout(800);
      const drawn = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn).reduce((s, f) => s + (f.properties.distanceMeters || 0), 0); });
      rec("✓ keeps a drawn (straight) stretch in the ride", L.hash(await L.line(page)) !== h0 && drawn > 0, { drawn });
      await slot(2); await page.waitForTimeout(700);
      rec("↶ takes the straight stretch back", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else { await slot("x"); await page.waitForTimeout(500); await shot("fail-straight"); }
  }
  {
    // The guard: the strict profile cannot reach it (forced 422), the relaxed one can → warned.
    const force = async (route) => {
      const body = JSON.parse(route.request().postData() ?? "{}");
      if (!body.relax) return route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "unreachable" }) });
      return route.fallback();
    };
    await page.route("**/api/reroute-leg", force);
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const { grab, drop } = await grabDrop(0.348306, 286.026, -1);
    await bend(grab, drop);
    const s = await L.waitChip(page, ["warn", "proposed", "refused"], 40000);
    const ok = await L.slotBtn(page, 3);
    rec("guard: warned, ✓ off, „Tomēr braukt” said once", s.chip?.tone === "warn" && (await ok.isDisabled()) && s.chip.text.split("Tomēr braukt").length === 2, s.chip);
    rec("guard: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    { const f = await chipFit(); rec("guard: its notes fit, never cut mid-sentence", fits(f), f); if (tag === "375") await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chainpolish-guard.png` }); }
    await page.evaluate(() => document.querySelectorAll('[data-slot="3"]').forEach((b) => b.click()));
    await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    rec("guard: a forced click on ✓ and Enter keep nothing", L.hash(await L.line(page)) === h0);
    const acc = page.locator("button:visible", { hasText: "Tomēr braukt" }).first();
    if (await acc.count()) {
      await acc.click(); await page.waitForTimeout(900);
      rec("„Tomēr braukt” commits", L.hash(await L.line(page)) !== h0 && (await L.undoEnabled(page)) === true);
      await slot(2); await page.waitForTimeout(700);
      rec("↶ after „Tomēr braukt”", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else rec("„Tomēr braukt” offered", false);
    await page.unroute("**/api/reroute-leg", force);
  }

  } // SECTIONS 1b-3
  const ui = () => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const input = [...document.querySelectorAll("[data-map-chrome] input")].filter(vis)[0];
    const chip = document.querySelector("[data-proposal-chip]");
    return {
      field: input ? (input.value || input.placeholder) : null,
      chip: chip ? { tone: chip.dataset.proposalChip, text: chip.textContent.trim() } : null,
      groups: [...document.querySelectorAll("[data-choice-group]")].map((g) => g.dataset.choiceGroup),
      blocked: [...document.querySelectorAll('[data-blocked="true"]')].map((e) => e.textContent.trim()),
      pins: document.querySelectorAll("[data-batch]").length,
    };
  });
  const waitUi = async (pred, timeout = 60000) => { const t0 = Date.now(); let s; while (Date.now() - t0 < timeout) { s = await ui(); if (pred(s)) return s; await page.waitForTimeout(200); } return s; };
  const nearestPin = (ll) => L.px(page, ll).then((p) => page.evaluate(({ x, y }) => {
    let best = null, d = Infinity;
    for (const e of document.querySelectorAll(".maplibregl-marker")) { if (e.dataset.pending) continue; const r = e.getBoundingClientRect(); const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const dd = Math.hypot(cx - x, cy - y); if (dd < d) { d = dd; best = { x: cx, y: cy }; } }
    return best;
  }, p));

  if (want("4-10")) { // SECTIONS 4-10
  // ── 4. Chained edits (Grostonas → Sidgunda → Mālpils → Augšmala → Ērgļi) ──
  t = Date.now();
  await L.openRide(page, "grostonas-chain");
  console.log(`[${tag}]   openRide grostonas-chain ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const P = L.PLACES;
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const movePin = async (place, to) => {
      await L.fit(page, [[24.86, 56.94], [25.02, 57.03]], 30);
      const b = await nearestPin([place.lon, place.lat]);
      await tapXY(b.x, b.y); await page.waitForTimeout(500);
      await sheetRow("Pārvietot").click(); await page.waitForTimeout(400); await settled();
      await page.evaluate((c) => window.__map.jumpTo({ center: c, zoom: Math.min(window.__map.getZoom(), 14) }), to); await page.waitForTimeout(500);
      await tapAt(to);
      await page.waitForTimeout(600);
      return L.waitChip(page, ["proposed", "warn", "refused"], 60000);
    };
    const c1 = await movePin(P.sid, [24.905, 56.955]);
    const c2 = await movePin(P["māl"], [24.955, 57.002]);
    rec("chain: two moves stack — „2 izmaiņas”", c1.chip?.tone === "proposed" && c2.chip?.tone === "proposed" && /2 izmaiņas/.test(c2.chip.text), { c1: c1.chip, c2: c2.chip });
    rec("chain: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    await slot(2); await page.waitForTimeout(700);
    const u = await L.state(page);
    rec("chain: ↶ takes only the last change off", u.chip?.tone === "proposed" && !/izmaiņas/.test(u.chip.text), u.chip);
    const c3 = await movePin(P.aug, [24.975, 56.994]);
    rec("chain: a new move stacks on what is left", /2 izmaiņas/.test(c3.chip?.text ?? ""), c3.chip);
    const n0 = log.reroute;
    await slot(3); await page.waitForTimeout(900);
    rec("chain: ✓ commits all, no extra routing", L.hash(await L.line(page)) !== h0 && !(await L.state(page)).chip && log.reroute === n0);
    await slot(2); await page.waitForTimeout(800);
    rec("chain: one ↶ brings back the ride before both", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
  }

  // ── 5. A batch with one point off the road: named, ringed, „Pievienot pārējās” (Grostonas → Ērgļi) ──
  t = Date.now();
  // Reverse lookups with stable names, as the rider's batchbad script had them.
  const reverse = (route) => {
    const u = new URL(route.request().url());
    const lon = Number(u.searchParams.get("lon"));
    const name = lon > 24.68 ? "Kangaru purvs" : lon > 24.55 ? "Rīgas iela" : "Silenieki";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ places: [{ name, label: `${name}, Ropažu novads`, lat: Number(u.searchParams.get("lat")), lon }] }) });
  };
  await page.route(/\/api\/places\?(?=.*\blat=)/, reverse);
  await L.openRide(page, "grostonas-ergli");
  console.log(`[${tag}]   openRide grostonas-ergli ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const pts = [[24.4509, 56.9490], [24.5985, 56.9599], [24.7000, 56.9650]];
    await L.fit(page, pts.concat([[24.40, 56.93], [24.80, 56.93]]), 40);
    await stopFromField();
    for (const ll of pts) { await tapAt(ll); await page.waitForTimeout(700); }
    const named = await waitUi((s) => s.groups.includes("block"));
    rec("blocking point named: „Kangaru purvs”, ringed, field says „Pietura 3”", named.chip?.tone === "refused" && /Kangaru purvs/.test(named.chip.text) && named.blocked.includes("3") && /^Pietura 3/.test(named.field ?? "") && named.groups.includes("rest"), named);
    rec("blocking point: slots did not move", JSON.stringify(await rects()) === JSON.stringify(r0));
    await page.locator('[data-choice-group="rest"] [data-choice="rest"]').click();
    const rest = await waitUi((s) => s.pins === 2 && s.chip && s.chip.tone !== "routing" && s.chip.tone !== "refused");
    rec("„Pievienot pārējās”: the bad point dropped, the other two proposed", rest.pins === 2 && ["proposed", "warn"].includes(rest.chip?.tone), rest);
    const acc = page.locator("button:visible", { hasText: "Tomēr braukt" }).first();
    if (rest.chip?.tone === "warn" && (await acc.count())) await acc.click(); else await slot(3);
    await page.waitForTimeout(900);
    rec("…committed", L.hash(await L.line(page)) !== h0 && (await L.undoEnabled(page)) === true);
    await slot(2); await page.waitForTimeout(800);
    rec("…↶ undoes", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
  }
  await page.unroute(/\/api\/places\?(?=.*\blat=)/, reverse);

  // ── 6. Lauriņi → Ērgļi: a pass-through point moved onto a through road is ridden through ──
  t = Date.now();
  await L.openRide(page, "laurini-ergli");
  console.log(`[${tag}]   openRide laurini-ergli ${((Date.now() - t) / 1000).toFixed(1)} s`);
  {
    const WAS = [24.6885, 56.8108], JUNCTION = [24.7100, 56.8160], BOX = [WAS, JUNCTION, [24.66, 56.79], [24.73, 56.83]];
    await L.fit(page, BOX, 40);
    const c0 = await L.line(page);
    const d2 = (a, b) => (a[0] - b[0]) ** 2 * 0.3 + (a[1] - b[1]) ** 2;
    const onLine = c0.reduce((best, p) => (d2(p, WAS) < d2(best, WAS) ? p : best), c0[0]);
    await stopFromField();
    await tapAt(onLine); await page.waitForTimeout(700);
    await L.waitChip(page, ["proposed", "refused", "warn"], 60000);
    await page.locator('[data-choice="pass"]').click(); await page.waitForTimeout(700);
    await L.waitChip(page, ["proposed", "refused", "warn"], 60000);
    await slot(3); await page.waitForTimeout(900);
    const d0 = await dotsLoc().count();
    const h0 = L.hash(await L.line(page));
    await dotsLoc().first().click(); await page.waitForTimeout(400);
    await sheetRow("Pārvietot").click(); await page.waitForTimeout(400); await settled();
    await L.fit(page, BOX, 40);
    await tapAt(JUNCTION); await page.waitForTimeout(700);
    const s = await L.waitChip(page, ["proposed", "refused", "warn"], 120000);
    const rep = s.chip?.text.match(/atkārtoti (\d+) → (\d+) %/);
    rec("through road: a plain proposal, no dead end said", s.chip?.tone === "proposed" && !/strupceļ|atpakaļ pa to pašu ceļu/.test(s.chip.text), { chip: s.chip, dots: d0 });
    // The bug was an out-and-back: 0 → 7 % retraced. Ridden through, the share stays put.
    rec("through road: nothing ridden twice (retraced % does not grow)", rep && Number(rep[2]) <= Number(rep[1]), { retraced: rep?.slice(1) });
    await slot("x"); await page.waitForTimeout(500);
    rec("through road: ✕ leaves the ride", L.hash(await L.line(page)) === h0);
  }

  // ── 7. A sight from the map card (backlog 46): „Pievienot braucienam” adds it ──
  // /api/route-pois is stubbed with one manor ~100 m off the line, the way
  // Vatrāne sits in its park: the road the ride is on is as close as a
  // motorcycle gets, and that is said with the distance.
  {
    t = Date.now();
    const SIGHT = "Smoke muiža";
    const pois = async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      const c = body.geometry?.coordinates ?? [];
      const m = [0]; for (let i = 1; i < c.length; i++) m.push(m[i - 1] + hv(c[i - 1], c[i]));
      // 20 % in: a stretch with no road nearer the manor than the ride's own
      // (at 45 % a track reaches it, and the router rides it — nothing to say).
      const i = Math.max(1, m.findIndex((x) => x >= m.at(-1) * 0.2));
      const a = c[i - 1], b = c[i];
      const dx = (b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1;
      const off = 100;
      const lat = a[1] + (off * (dx / n)) / 111195, lon = a[0] - (off * (dy / n)) / (111195 * Math.cos((a[1] * Math.PI) / 180));
      const poi = { id: "smoke-manor", name: SIGHT, category: "manor", lat, lon, distanceMeters: off, alongKm: m[i] / 1000 };
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ onRoute: [], nearby: [poi] }) });
    };
    // Its detour, as the server answers a sight no road gets closer to: a
    // short out-and-back on the ride's own road (live, the answer to a made-up
    // place varies with the router's load — ok one run, "unreachable" the next).
    const detour = async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      if (!(body.pois ?? []).some((p) => p.id === "smoke-manor")) return route.fallback();
      const c = body.geometry?.coordinates ?? [];
      const m = [0]; for (let i = 1; i < c.length; i++) m.push(m[i - 1] + hv(c[i - 1], c[i]));
      const i = Math.max(1, m.findIndex((x) => x >= m.at(-1) * 0.2));
      const a = c[i - 1], b = c[i], len = hv(a, b);
      const seg = { type: "Feature", geometry: { type: "LineString", coordinates: [a, b, a] }, properties: { roadClass: "secondary", surface: "asphalt", distanceMeters: Math.round(2 * len) } };
      const ok = { ok: true, poiId: "smoke-manor", shape: "outAndBack", coordinates: [a, b, a], segments: { type: "FeatureCollection", features: [seg] }, distanceMeters: 2 * len, durationSeconds: Math.round(2 * len / 13), deltaMeters: 2 * len, deltaSeconds: Math.round(2 * len / 13), entryMeters: m[i - 1], exitMeters: m[i - 1] };
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ detours: [ok], partial: false, ms: 1 }) });
    };
    await page.route(/\/api\/route-pois/, pois);
    await page.route(/\/api\/detour/, detour);
    await L.openRide(page, "sigulda-cesis");
    console.log(`[${tag}]   openRide sigulda-cesis (sight) ${((Date.now() - t) / 1000).toFixed(1)} s`);
    const sightMark = () => page.locator(`.maplibregl-marker[aria-label^="${SIGHT}"]`).first();
    // A marker off screen cannot be tapped: centre the map on it first.
    const openSight = async (dispatch = false) => {
      await sightMark().waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
      const at = await sightMark().evaluate((e) => { const r = e.getBoundingClientRect(), c = window.__map.getContainer().getBoundingClientRect(); return window.__map.unproject([r.x + r.width / 2 - c.x, r.y + r.height / 2 - c.y]).toArray(); });
      await zoomTo(at, 14);
      // On the result the phone map is the inline preview; its canvas sits over the markers for Playwright's hit test.
      if (dispatch) await sightMark().dispatchEvent("click"); else await sightMark().click();
      await page.waitForTimeout(1000);
    };
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page);
    const r0 = await rects();
    await openSight();
    const add = page.locator(".maplibregl-popup [data-add]");
    const addText = (await add.textContent().catch(() => "")) ?? "";
    rec("sight card: the button says „Pievienot braucienam”", addText.trim() === "Pievienot braucienam", { addText });
    rec("sight card in edit mode: no tick-only control", (await page.locator(".maplibregl-popup [data-tick]").count()) === 0);
    await shot("sights-card-before");
    const n0 = log.reroute;
    await add.click();
    const s1 = await L.waitChip(page, ["proposed", "warn", "refused"], 60000);
    await page.waitForTimeout(300);
    await shot("sights-card-after");
    rec("sight: a proposal with numbers, not a tick", ["proposed", "warn"].includes(s1.chip?.tone) && CHIP_RE.test(s1.chip.text), s1.chip);
    rec("sight: halo over the dimmed ride", s1.proposalLayers.length > 0 && JSON.stringify(s1.routeOpacity).includes("0.3"), { layers: s1.proposalLayers });
    rec("sight: routed (not only ticked)", log.reroute > n0, { reroutes: log.reroute - n0 });
    rec("sight: slots did not move (proposal)", JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    const said = [s1.chip?.text ?? "", ...(s1.notices ?? [])].join(" ");
    rec("sight: „tuvāk ar motociklu netikt” with the distance", /Smoke muiža – tuvākais ceļš ~\d+ m no apskates vietas; tuvāk ar motociklu netikt – pietura paliek pie ceļa, tālāk kājām\./.test(said), { said });
    await shot("sights-note");
    { const f = await chipFit(); rec("sight: its note fits, never cut mid-sentence", fits(f), f); if (tag === "375") await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chainpolish-sight.png` }); }
    const n1 = log.reroute;
    await slot(3); await page.waitForTimeout(900);
    const s2 = await L.state(page);
    rec("sight: ✓ commits, no extra routing", !s2.chip && (await L.undoEnabled(page)) === true && log.reroute === n1, { chip: s2.chip, extra: log.reroute - n1 });
    rec("sight: the stop is in the ride", (await page.locator(`.maplibregl-marker[aria-label*="${SIGHT}"]`).count()) > 0);
    rec("sight: slots did not move (committed)", JSON.stringify(await rects()) === JSON.stringify(r0), { idle: r0, now: await rects() });
    await slot(2); await page.waitForTimeout(800);
    rec("sight: ↶ undoes", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);

    // On the result: „Atzīmēt” ticks, and the tick is counted on the map with its own „Pievienot”.
    if (phone) { await page.getByRole("button", { name: "Aizvērt pilnekrāna karti" }).first().click(); await page.waitForTimeout(500); }
    await page.getByRole("button", { name: "Pabeigt labošanu" }).first().click(); await page.waitForTimeout(1200);
    await openSight(true);
    const tick = page.locator(".maplibregl-popup [data-tick]");
    const cardOk = ((await page.locator(".maplibregl-popup [data-add]").textContent({ timeout: 5000 }).catch(() => "")) ?? "").trim() === "Pievienot braucienam" && ((await tick.textContent({ timeout: 5000 }).catch(() => "")) ?? "").trim() === "Atzīmēt";
    rec("result card: „Pievienot braucienam” and „Atzīmēt”", cardOk, { popup: await page.locator(".maplibregl-popup").first().innerText({ timeout: 2000 }).catch(() => null) });
    if (!cardOk) await shot("fail-result-card");
    await tick.click(); await page.waitForTimeout(800);
    const bar = page.locator("[data-sight-ticked]");
    const barText = ((await bar.textContent().catch(() => "")) ?? "").trim();
    rec("ticked: counted on the map „1 atzīmēta · Pievienot”", /^1 atzīmēta\s*Pievienot$/.test(barText), { barText });
    await shot("sights-ticked");
    // The card's own „Pievienot braucienam” on the result: the detour splice, and what it did said on the map.
    const barAdd = page.locator("[data-sight-ticked-add]");
    for (let k = 0; k < 100 && (await barAdd.isDisabled().catch(() => true)); k++) await page.waitForTimeout(200);
    rec("ticked: the bar's „Pievienot” is live once the detour is routed", !(await barAdd.isDisabled().catch(() => true)));
    // Escape drops the ticks; the card's own „Pievienot braucienam” then adds it.
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    rec("ticked: Escape drops the tick and the bar", (await page.locator("[data-sight-ticked]").count()) === 0);
    await openSight(true);
    await page.locator(".maplibregl-popup [data-add]").click();
    await page.locator("[data-sight-note]").waitFor({ timeout: 30000 }).catch(() => {});
    const note = ((await page.locator("[data-sight-note]").textContent().catch(() => "")) ?? "").trim();
    rec("result: added, and said on the map", /^Smoke muiža (– tuvākais ceļš ~\d+ m no apskates vietas; tuvāk ar motociklu netikt – pietura paliek pie ceļa, tālāk kājām\.|pievienota braucienam, [+−]\d+,\d km – ar „Labot” to var pārvietot vai izņemt\.)/.test(note), { note });
    rec("result: the tick is gone with it", (await page.locator("[data-sight-ticked]").count()) === 0);
    await shot("sights-result-note");
    await page.unroute(/\/api\/route-pois/, pois);
    await page.unroute(/\/api\/detour/, detour);
    console.log(`[${tag}]   sight from the map ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  // ── 8. Three forest points in a row: „Vest pa taisno caur visiem” (Grostonas → Ērgļi, Kangaru purvs) ──
  t = Date.now();
  await page.route(/\/api\/places\?(?=.*\blat=)/, reverse);
  await L.openRide(page, "grostonas-ergli");
  {
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    const CHAIN = [[24.6930, 56.9655], [24.6975, 56.9672], [24.7010, 56.9660]];
    await L.fit(page, CHAIN.concat([[24.66, 56.94], [24.74, 56.99]]), 40);
    await stopFromField();
    for (const ll of CHAIN) { await tapAt(ll); await page.waitForTimeout(700); }
    const offered = await waitUi((s) => s.groups.includes("chain"), 90000);
    const chip = page.locator('[data-choice-group="chain"] [data-choice="chain"]');
    rec("chain: three off-road points in a row → one „Vest pa taisno caur visiem”", offered.groups.includes("chain") && /3 punkti bez ceļa, taisni ~\d+(,\d)? km/.test(offered.chip?.text ?? "") && ((await chip.textContent().catch(() => "")) ?? "").trim() === "Vest pa taisno caur visiem", offered);
    rec("chain: slots did not move (offer)", JSON.stringify(await rects()) === JSON.stringify(r0));
    if (tag === "375") await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chain-straight-offer.png` });
    if (offered.groups.includes("chain")) {
      await chip.click();
      const s2 = await L.waitChip(page, ["proposed", "warn"], 60000);
      const st = await L.state(page);
      const f2 = await chipFit();
      rec("chain: the chip → a proposal with numbers and halo", ["proposed", "warn"].includes(s2.chip?.tone) && CHIP_RE.test(f2.numbers?.text ?? "") && st.proposalLayers.length > 0, { chip: s2.chip, numbers: f2.numbers });
      rec("chain: one line what and how much – what to do; the way by the pins' numbers; the honesty line in the title", /^Taisni caur 3 punktiem – \d+(,\d)? km bez ceļa(, pāri mežam vai ūdenim)? – (✓ apstiprina, ✕ atmet\.|spied „Tomēr braukt” vai ✕ atmet\.)$/.test(f2.text?.text ?? "") && /^No ceļa gala līdz pieturai \d+, tad \d+ → \d+ → \d+, pēc tam atpakaļ uz maršrutu\./.test(f2.notes?.text ?? "") && /Mopik nav pārbaudījis, vai tur var izbraukt un vai tas ir atļauts/.test(f2.title), f2);
      rec("chain: no point named by its coordinates", !/\d+[.,]\d{4}/.test(s2.chip?.text ?? ""), s2.chip);
      rec("chain: the note fits (≤ 3 lines, the lead ≤ 2), never cut mid-sentence", fits(f2) && (f2.text?.lines ?? 9) <= 2, f2);
      if (tag === "375") { await L.fit(page, CHAIN, 90); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chainpolish-proposal.png` }); }
      const n0 = log.reroute;
      const ok = await L.slotBtn(page, 3);
      if (!(await ok.isDisabled())) await ok.click(); else await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
      await page.waitForTimeout(900);
      const drawn = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn); });
      const through = CHAIN.every((p) => drawn.some((f) => f.geometry.coordinates.some((q) => hv(p, q) < 40)));
      rec("chain: ✓ keeps the drawn chain through all three, no extra routing", L.hash(await L.line(page)) !== h0 && through && log.reroute === n0, { drawnFeatures: drawn.length, through, extra: log.reroute - n0 });
      rec("chain: slots did not move (committed)", JSON.stringify(await rects()) === JSON.stringify(r0));
      if (tag === "375") { await L.fit(page, CHAIN, 90); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chain-straight-committed.png` }); }
      // ── chain-polish ── „Izņemt” on the middle point: the chain re-forms through the other two, nothing routed; ✓, then ↶ brings the three back.
      {
        const hc = L.hash(await L.line(page)); const n1 = log.reroute;
        await L.fit(page, CHAIN, 90); await page.waitForTimeout(400);
        const pin = await nearestPin(CHAIN[1]);
        await tapXY(pin.x, pin.y); await page.waitForTimeout(500);
        await sheetRow("Izņemt").click();
        const s3 = await L.waitChip(page, ["proposed", "warn", "refused"], 30000);
        rec("chain: „Izņemt” on a chain point → a proposal with numbers, not refused, nothing routed", ["proposed", "warn"].includes(s3.chip?.tone) && CHIP_RE.test((await chipFit()).numbers?.text ?? "") && /^Taisni caur 2 punktiem/.test(s3.chip.text) && log.reroute === n1, { chip: s3.chip, extra: log.reroute - n1 });
        { const f = await chipFit(); rec("chain: the re-formed chain's note fits, never cut mid-sentence", fits(f), f); }
        rec("chain: slots did not move (point removed)", JSON.stringify(await rects()) === JSON.stringify(r0));
        if (tag === "375") await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chainpolish-remove-proposal.png` });
        const ok2 = await L.slotBtn(page, 3);
        if (!(await ok2.isDisabled())) await ok2.click(); else await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
        await page.waitForTimeout(900);
        const d2 = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn); });
        // The taps land within a few metres of CHAIN; the middle point is ~150 m off the line from the first to the last.
        const gap = (p) => Math.min(...d2.flatMap((f) => f.geometry.coordinates.map((q) => hv(p, q))));
        const gaps = CHAIN.map((p) => Math.round(gap(p)));
        rec("chain: ✓ keeps the chain through the other two, not the one taken out", L.hash(await L.line(page)) !== hc && gaps[0] < 40 && gaps[2] < 40 && gaps[1] > 80 && !(await L.state(page)).chip, { drawn: d2.length, gaps });
        if (tag === "375") { await L.fit(page, CHAIN, 90); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chainpolish-remove-committed.png` }); }
        await slot(2); await page.waitForTimeout(800);
        rec("chain: ↶ brings the three back in one step", L.hash(await L.line(page)) === hc);
      }
      await slot(2); await page.waitForTimeout(800);
      rec("chain: ↶ takes the chain back", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else { await shot("fail-chain"); await slot("x"); await page.waitForTimeout(500); }
    console.log(`[${tag}]   straight chain ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  await page.unroute(/\/api\/places\?(?=.*\blat=)/, reverse);

  // ── 9. The connection drops while a ride is generated (2026-09-29, the rider's iPhone: „TypeError: Load failed") ──
  t = Date.now();
  {
    const f = L.fixture("sigulda-cesis");
    const GENFAIL = process.env.GENFAIL_SHOTS || L.SHOTS;
    const e0 = log.errors.length;
    const bubble = () => page.getByText("Savienojums pārtrūka, kamēr meklēju maršrutu – mēģini vēlreiz.");
    const loaderUp = () => page.locator('section:has([role="log"])').getByRole("button", { name: "Atcelt", exact: true }).first().isVisible().catch(() => false);
    const goRide = () => page.goto(`${L.BASE}/?lang=lv&p=${encodeURIComponent(f.planCode)}&go=1`);
    const failing = (n) => { let calls = 0; const h = (route) => (++calls <= n ? route.abort("failed") : route.fulfill({ status: 200, contentType: "application/json", body: f.response })); h.calls = () => calls; return h; };

    // a. One drop: the quiet retry brings the ride, the rider never sees an error.
    let h = failing(1);
    await page.route("**/api/generate-route", h);
    await goRide();
    await page.getByRole("button", { name: "Labot maršrutu kartē" }).waitFor({ timeout: 30000 });
    rec("genfail: one drop → one quiet retry → the ride, no error shown", h.calls() === 2 && !(await bubble().isVisible().catch(() => false)) && !(await page.getByText(/TypeError|Load failed|Failed to fetch/).count()), { calls: h.calls() });
    await page.unroute("**/api/generate-route", h);

    // b. Two drops: the plain sentence, no raw error, no loader, and the button.
    h = failing(2);
    await page.route("**/api/generate-route", h);
    await goRide();
    await bubble().waitFor({ timeout: 30000 }).catch(async () => { await shot("fail-genfail"); console.log(`[${tag}]   genfail log: ${JSON.stringify(await page.locator('[role="log"]').allInnerTexts())} calls ${h.calls()} url ${page.url()}`); });
    const retryBtn = page.getByRole("button", { name: "Mēģināt vēlreiz" });
    rec("genfail: two drops → the friendly message, no raw error, no loader, a retry button", h.calls() === 2 && !(await page.getByText(/TypeError|Load failed|Failed to fetch|Neizdevās ģenerēt/).count()) && !(await loaderUp()) && (await retryBtn.isVisible()), { calls: h.calls(), loader: await loaderUp() });
    if (tag === "375") await page.screenshot({ path: `${GENFAIL}/genfail-message.png` });
    await retryBtn.click();
    await page.waitForTimeout(150);
    const bubbleGoneWhileLoading = !(await bubble().isVisible().catch(() => false));
    await page.getByRole("button", { name: "Labot maršrutu kartē" }).waitFor({ timeout: 30000 });
    rec("genfail: „Mēģināt vēlreiz” drops the error bubble and brings the ride", bubbleGoneWhileLoading && h.calls() === 3 && !(await bubble().isVisible().catch(() => false)), { calls: h.calls(), bubbleGoneWhileLoading });
    if (tag === "375") await page.screenshot({ path: `${GENFAIL}/genfail-retry-ok.png` });
    await page.unroute("**/api/generate-route", h);

    // c. Atcelt during the quiet retry's wait: back to the form, nothing sent again.
    h = failing(99);
    await page.route("**/api/generate-route", h);
    await goRide();
    for (let k = 0; k < 100 && h.calls() < 1; k++) await page.waitForTimeout(50);
    await page.locator('section:has([role="log"])').getByRole("button", { name: "Atcelt", exact: true }).first().click();
    await page.waitForTimeout(2500);
    rec("genfail: Atcelt during the wait → the form, no retry, no error", h.calls() === 1 && !(await loaderUp()) && !(await bubble().isVisible().catch(() => false)) && (await page.getByRole("button", { name: "Izveidot maršrutu" }).first().isVisible().catch(() => false)), { calls: h.calls() });
    if (tag === "375") await page.screenshot({ path: `${GENFAIL}/genfail-cancelled.png` });
    await page.unroute("**/api/generate-route", h);

    // The aborted loads are what Chromium logs for route.abort — asked for above.
    const added = log.errors.splice(e0);
    // So are the base map's tile loads the reloads cut off mid-flight (MapLibre logs each as „AJAXError: Failed to fetch (0)”).
    log.errors.push(...added.filter((e) => !/net::ERR_FAILED|net::ERR_NETWORK_IO_SUSPENDED|AJAXError: Failed to fetch \(0\): https:\/\/tile\.openstreetmap\.org\//.test(e)));
    console.log(`[${tag}]   generation connection drop ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  // ── 10. „Saglabātie” (backlog 44/47): the card opens the ride; „Labot” is edit
  // mode on the saved line; „Pabeigt labošanu” saves in place (own) or as a
  // copy (legacy / someone else's). Seeded rows come from the app's own
  // encoder with the router's labels as names — the shape backlog 47 broke on.
  {
    t = Date.now();
    const { execFileSync } = require("child_process");
    const seed = (name, origin) => JSON.parse(execFileSync("npx", ["tsx", `${__dirname}/encode-saved.ts`, name, origin], { env: { ...process.env, LABEL_SUFFIX: ", Latvija" } }).toString());
    const own = seed("sigulda-cesis", "own"), legacy = { ...seed("antinciems-rigas", "legacy"), savedAt: own.savedAt - 1000 };
    const savedShot = (n) => tag === "375" && page.screenshot({ path: `${process.env.SAVED_SHOTS || L.SHOTS}/saved-${n}.png` });
    const readSaved = () => page.evaluate(() => JSON.parse(localStorage.getItem("mopik.saved.v1") || "[]"));
    await page.goto(`${L.BASE}/saglabatie?lang=lv`);
    await page.evaluate((rows) => localStorage.setItem("mopik.saved.v1", JSON.stringify(rows)), [own, legacy]);
    await page.reload(); await page.waitForSelector("[data-saved-card]");
    await savedShot("list");
    // A tap on the card's numbers — no control there — opens the ride.
    const card = page.locator("[data-saved-card]").first();
    await card.locator(".grid-cols-3").first().click();
    await page.waitForURL(/\/r\//, { timeout: 15000 }).catch(() => {});
    rec("saved: a tap on the card opens the ride", /\/r\//.test(page.url()), { url: page.url() });
    await page.goto(`${L.BASE}/saglabatie?lang=lv`); await page.waitForSelector("[data-saved-card]");
    // The delete icon keeps its own tap: the pill, not a navigation.
    await card.locator("[data-confirm-pill]").click(); await page.waitForTimeout(300);
    rec("saved: delete keeps its own tap", /\/saglabatie/.test(page.url()) && (await page.getByText("Izdzēst?").count()) > 0, { url: page.url() });
    await page.keyboard.press("Escape");

    const labot = async (row) => {
      const g0 = log.generate.length;
      await page.getByRole("link", { name: `Labot ${row.name}` }).first().click();
      await page.waitForSelector('[data-slot="3"]', { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1200);
      const pts = (await L.line(page).catch(() => [])).length;
      rec(`saved „Labot” (${row.origin ?? "legacy"}): edit mode on the saved line, nothing generated`, pts > 10 && log.generate.length === g0 && (await page.locator(".maplibregl-marker").count()) >= 2, { pts, generated: log.generate.length - g0 });
    };
    const addDot = async () => {
      const ll = await pointOn(0.4); await zoomTo(ll, 13);
      await tapAt(ll); await page.waitForTimeout(500);
      await page.getByText("Pievienot punktu šeit", { exact: true }).click(); await page.waitForTimeout(700);
      return (await L.undoEnabled(page)) === true;
    };
    const finish = async () => {
      if (phone) { await page.getByRole("button", { name: "Aizvērt pilnekrāna karti" }).first().click(); await page.waitForTimeout(500); }
      await page.getByRole("button", { name: "Pabeigt labošanu" }).first().click(); await page.waitForTimeout(1000);
      return ((await page.locator("[data-saved-edit-said]").textContent().catch(() => "")) ?? "").trim();
    };

    // His own ride: saved in place.
    await labot(own);
    await L.fit(page, await L.line(page)); await savedShot("edit");
    rec("saved own: an edit („Pievienot punktu šeit”)", await addDot());
    const saidOwn = await finish();
    await savedShot("done");
    const afterOwn = await readSaved();
    rec("saved own: „Pabeigt labošanu” saves in place and says so", saidOwn === "Saglabāts – labotais brauciens aizstāj saglabāto." && afterOwn.length === 2 && afterOwn[0].id !== own.id && afterOwn[0].name === own.name && afterOwn[0].origin === "own" && afterOwn[0].savedAt === own.savedAt && !afterOwn.some((r) => r.id === own.id), { saidOwn, rows: afterOwn.map((r) => [r.id, r.name, r.origin]) });

    // A ride with no origin (saved before backlog 44): a copy, the original untouched.
    await page.goto(`${L.BASE}/saglabatie?lang=lv`); await page.waitForSelector("[data-saved-card]");
    await labot(legacy);
    const notes = (await L.state(page)).notices.join(" ") + " " + ((await page.locator("[data-saved-edit-note]").textContent().catch(() => "")) ?? "");
    rec("saved legacy: „Šis brauciens nav tavs – labojumi tiks saglabāti kā kopija.”", notes.includes("Šis brauciens nav tavs – labojumi tiks saglabāti kā kopija."), { notes });
    await savedShot("copy-note");
    rec("saved legacy: an edit", await addDot());
    const saidCopy = await finish();
    await savedShot("copy-done");
    const afterCopy = await readSaved();
    const copy = afterCopy.find((r) => r.name === `${legacy.name} (kopija)`);
    rec("saved legacy: saved as „<name> (kopija)”, the original byte for byte", saidCopy === `Saglabāts kā jauns brauciens – „${legacy.name} (kopija)”.` && afterCopy.length === 3 && Boolean(copy) && copy.origin === "own" && JSON.stringify(afterCopy.find((r) => r.id === legacy.id)) === JSON.stringify(legacy), { saidCopy, rows: afterCopy.map((r) => [r.id, r.name, r.origin]) });
    console.log(`[${tag}]   saved rides ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  } // SECTIONS 4-10
  if (want("reach")) { // SECTIONS reach
  // ── 11. Backlog 50/52 (reach-all): a far finish in a town, a finish in a forest, an alternating batch ──
  t = Date.now();
  {
    const RS = process.env.REACH_SHOTS || L.SHOTS;
    const reachShot = (n) => tag === "375" && page.screenshot({ path: `${RS}/reach-${n}.png` });
    const choices = () => page.evaluate(() => [...document.querySelectorAll("[data-choice-group]")].map((g) => ({ group: g.dataset.choiceGroup, chips: [...g.querySelectorAll("[data-choice]")].map((c) => c.textContent.trim()) })));
    // The finish pin: its label marker sits at the place's coordinate.
    const finishLL = () => page.evaluate(() => {
      const c = window.__map.getContainer().getBoundingClientRect();
      // The edit map's own (another map's pin may still be in the DOM, hidden).
      const e = [...document.querySelectorAll(".maplibregl-marker")].find((m) => /^Finišs: /.test(m.getAttribute("aria-label") ?? "") && window.__map.getContainer().contains(m));
      const r = e.getBoundingClientRect();
      const ll = window.__map.unproject([r.x - c.x, r.y - c.y]); return [ll.lng, ll.lat];
    });
    const moveFinish = async (to) => {
      const at = await finishLL(); await zoomTo(at, 14); await settled();
      // The pin's head is above its coordinate; a sight's glyph may sit on it (the earlier sections leave layers on): a few spots.
      // The pin itself: MapLibre's marker at the finish's coordinate that is not its label.
      // (MapLibre keeps no public marker list: found in the DOM — the pin whose tip is nearest the finish's 0×0 label anchor.)
      const pin = await page.evaluate(() => {
        const inMap = [...document.querySelectorAll(".maplibregl-marker")].filter((e) => window.__map.getContainer().contains(e));
        const lab = inMap.find((e) => /^Finišs: /.test(e.getAttribute("aria-label") ?? ""));
        if (!lab) return null; const l = lab.getBoundingClientRect();
        let best = null, d = Infinity;
        for (const e of inMap) { if (e === lab || e.dataset.pending) continue; const r = e.getBoundingClientRect(); if (!r.width) continue; const dd = Math.hypot(r.x + r.width / 2 - l.x, r.bottom - l.y); if (dd < d) { d = dd; best = { x: r.x + r.width / 2, y: r.y + r.height / 3 }; } }
        return best && d < 40 ? best : null;
      });
      const c0 = await L.px(page, at);
      const spots = [...(pin ? [[pin.x, pin.y]] : []), [c0.x, c0.y - 8], [c0.x, c0.y - 20], [c0.x, c0.y - 2]];
      for (const [x, y] of spots) {
        await tapXY(x, y); await page.waitForTimeout(700);
        if (await sheetRow("Pārvietot").isVisible().catch(() => false)) break;
      }
      if (!(await sheetRow("Pārvietot").isVisible().catch(() => false))) await shot("reach-no-sheet");
      await sheetRow("Pārvietot").click(); await page.waitForTimeout(500); await settled();
      await zoomTo(to, 13);
      await tapAt(to);
    };
    const commit = async (chip) => {
      const acc = page.locator("button:visible", { hasText: "Tomēr braukt" }).first();
      if (chip?.tone === "warn" && (await acc.count())) await acc.click(); else await slot(3);
      await page.waitForTimeout(900);
    };
    // A clean page: the sections before leave preferences (layers, the add kind, saved rides) that change what a tap on a pin does.
    await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
    await L.openRide(page, "grostonas-ergli");
    const h0 = L.hash(await L.line(page)); const u0 = await L.undoEnabled(page); const r0 = await rects();
    // (a) A new finish in Madona, ~60 km east, on roads: a proposal (warned for the detour), ✓, ↶.
    const MADONA = [26.2195, 56.8545];
    await moveFinish(MADONA);
    const a = await L.waitChip(page, ["proposed", "warn", "refused"], 90000);
    rec("reach: a far finish in a town → a proposal with numbers, never „neizdevās savienot”", ["proposed", "warn"].includes(a.chip?.tone) && CHIP_RE.test(a.chip.text) && !/neizdevās savienot/.test(a.chip.text), a.chip);
    rec("reach: slots did not move (far finish)", JSON.stringify(await rects()) === JSON.stringify(r0));
    await reachShot("finish-town");
    await commit(a.chip);
    const endA = (await L.line(page)).at(-1);
    rec("reach: ✓ commits the far finish, the ride ends in Madona", L.hash(await L.line(page)) !== h0 && hv(endA, MADONA) < 300 && (await L.undoEnabled(page)) === true, { end: endA, m: Math.round(hv(endA, MADONA)) });
    await slot(2); await page.waitForTimeout(900);
    rec("reach: ↶ brings the old finish back", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    // (b) A finish in the forest (Kangaru purvs, ~590 m from a road): named, „Vest pa taisno” as a chip → proposal → ✓ ends there → ↶.
    const FOREST = [24.7000, 56.9650];
    await moveFinish(FOREST);
    const b = await L.waitChip(page, ["refused", "proposed", "warn"], 120000);
    await page.waitForTimeout(600);
    const bc = await choices();
    const straightChip = page.locator('[data-choice-group="block"] [data-choice="straight"]');
    rec("reach: a finish in a forest → named, „Vest pa taisno” offered as a chip", b.chip?.tone === "refused" && /^Finišs/.test(b.chip.text) && /Vest pa taisno/.test(b.chip.text) && (await straightChip.count()) === 1 && !/\d+[.,]\d{4}/.test(b.chip.text), { chip: b.chip, choices: bc });
    await reachShot("finish-forest-offer");
    if (await straightChip.count()) {
      await straightChip.click();
      const b2 = await L.waitChip(page, ["proposed", "warn", "refused"], 60000);
      rec("reach: „Vest pa taisno” for the finish → a proposal with numbers", ["proposed", "warn"].includes(b2.chip?.tone) && /\d+(,\d)? → \d+(,\d)? km/.test(b2.chip.text), b2.chip);
      await reachShot("finish-forest-proposal");
      await commit(b2.chip);
      const endB = (await L.line(page)).at(-1);
      rec("reach: ✓ keeps the straight way to the finish, the ride ends at it", L.hash(await L.line(page)) !== h0 && hv(endB, FOREST) < 30, { m: Math.round(hv(endB, FOREST)) });
      await slot(2); await page.waitForTimeout(900);
      rec("reach: ↶ undoes the straight finish", L.hash(await L.line(page)) === h0);
    }
    // (c) An alternating batch: on a road, off, on, off — each off-road point its own „Vest pa taisno”, and „Vest pa taisno visiem”.
    // Two on the ride itself, two in the forest (~500 and ~670 m from a road, `/api/routable-point`), in the ride's order.
    const ALT = [await pointOn(0.55), [24.8541, 56.9445], await pointOn(0.75), [25.1438, 56.8895]];
    await L.fit(page, ALT, 40);
    await stopFromField();
    for (const ll of ALT) { await tapAt(ll); await page.waitForTimeout(700); }
    const c = await waitUi((s) => s.groups.includes("block") && s.groups.includes("block:2"), 120000);
    await page.waitForTimeout(400);
    const cc = await choices();
    const per = cc.filter((g) => /^block/.test(g.group));
    // Every blocker its own „Pārvietot”/„Izņemt”; the two in the forest „Vest pa taisno” too (a point on the ride may still block, as „neizdevās savienot”, with no straight chip — the words then do not offer it).
    rec("reach: alternating batch → each blocker its own chips, the off-road ones with „Vest pa taisno”", per.length >= 2 && per.every((g) => g.chips.includes("Pārvietot") && g.chips.includes("Izņemt")) && per.filter((g) => g.chips.includes("Vest pa taisno")).length >= 2 && /Pietura \d/.test(c.chip?.text ?? "") && /„Vest pa taisno visiem”/.test(c.chip?.text ?? ""), { chip: c.chip, choices: cc });
    rec("reach: …and „Vest pa taisno visiem”, „Pievienot pārējās”, no coordinates", cc.some((g) => g.chips.includes("Vest pa taisno visiem")) && cc.some((g) => g.chips.includes("Pievienot pārējās")) && !/\d+[.,]\d{4}/.test(c.chip?.text ?? ""), { chip: c.chip, choices: cc });
    rec("reach: slots did not move (batch)", JSON.stringify(await rects()) === JSON.stringify(r0));
    await reachShot("batch-offer");
    const all = page.locator('[data-choice-group="chain"] [data-choice="chain"]');
    if (await all.count()) {
      await all.click();
      const c2 = await waitUi((s) => s.chip && (["proposed", "warn"].includes(s.chip.tone) || (s.chip.tone === "refused" && /^Pietura \d/.test(s.chip.text))), 120000);
      rec("reach: „Vest pa taisno visiem” → one proposal, or the rest's own blocker named (never the generic line)", ["proposed", "warn"].includes(c2.chip?.tone) || (c2.chip?.tone === "refused" && /^Pietura \d/.test(c2.chip.text) && !/vienā līnijā/.test(c2.chip.text)), c2.chip);
      await reachShot("batch-proposal");
      if (["proposed", "warn"].includes(c2.chip?.tone)) {
        await commit(c2.chip);
        rec("reach: …✓ commits", L.hash(await L.line(page)) !== h0 && !(await L.state(page)).chip);
        await slot(2); await page.waitForTimeout(900);
        rec("reach: …↶ undoes", L.hash(await L.line(page)) === h0);
      } else { await slot("x"); await page.waitForTimeout(600); }
    }
    console.log(`[${tag}]   reach-all ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }

  } // SECTIONS reach
  await shot("end");
  // A 422 is how /api/reroute-leg says "no road reaches it" — the refused and
  // guard cases above ask for exactly that, and Chromium logs every non-2xx load.
  const errors = log.errors.filter((e) => !/status of 422 \(Unprocessable Entity\)/.test(e));
  rec("no console errors", errors.length === 0, errors.slice(0, 5));
  const fail = results.filter((r) => !r.ok).map((r) => r.name);
  console.log(`[${tag}] ${L.cacheSummary()}${L.cacheStats.misses.length ? " — misses: " + [...new Set(L.cacheStats.misses)].join(", ") : ""}`);
  console.log(`[${tag}] ${results.length - fail.length}/${results.length} pass in ${((Date.now() - T0) / 1000).toFixed(1)} s${fail.length ? " — FAIL: " + fail.join("; ") : ""}`);
  if (L.cacheStats.missBodies.length) require("fs").writeFileSync(`${__dirname}/out/misses-${tag}.json`, JSON.stringify(L.cacheStats.missBodies, null, 1));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
})().catch((e) => { console.error(`[${tag}]`, e); process.exit(2); });
