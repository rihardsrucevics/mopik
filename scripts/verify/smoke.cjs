// Smoke suite: the core edit flow on fixture rides and the router cache.
//   node scripts/verify/smoke.cjs phone|desk
// Normally run through smoke.sh, which runs both viewports in parallel.
if (!process.env.DPR) process.env.DPR = "1"; // see README: layout is in CSS px, DPR 1 is 4× fewer pixels
const L = require("./lib.cjs");
const phone = process.argv[2] === "phone";
const tag = phone ? "375" : "1280";
const T0 = Date.now();
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
  const rects = async () => Object.fromEntries((await L.state(page)).slots.map((s) => [s.slot, s.rect]));
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
  await exercise("add stop", async () => { const ll = await pointOn(0.3, 400, 0); await zoomTo(ll); await slot(1); await page.waitForTimeout(300); await tapAt(ll); }, { tones: ["proposed"], idle });
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
    await slot(1); await page.waitForTimeout(300);
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
    await slot(1); await page.waitForTimeout(300);
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
    await slot(1); await page.waitForTimeout(300);
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
      rec("chain: the chip → a proposal with numbers and halo", ["proposed", "warn"].includes(s2.chip?.tone) && CHIP_RE.test(s2.chip.text) && st.proposalLayers.length > 0, s2.chip);
      const notes = [((await page.locator("[data-proposal-chip]").first().evaluate((e) => (e.closest("[data-map-notice]") ?? e.parentElement ?? e).innerText).catch(() => "")) ?? ""), JSON.stringify(st.notices ?? [])].join(" ");
      rec("chain: its note and the honesty line", /Taisni caur 3 punktiem – \d+(,\d)? km bez ceļa/.test(notes) && /Mopik nav pārbaudījis, vai tur var izbraukt un vai tas ir atļauts/.test(notes), { notes });
      if (tag === "375") { await L.fit(page, CHAIN, 90); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chain-straight-proposal.png` }); }
      const n0 = log.reroute;
      const ok = await L.slotBtn(page, 3);
      if (!(await ok.isDisabled())) await ok.click(); else await page.locator("button:visible", { hasText: "Tomēr braukt" }).first().click();
      await page.waitForTimeout(900);
      const drawn = await page.evaluate(() => { const m = window.__map; const src = m.getSource(m.getLayer("route-road").source); const d = src._data?.geojson ?? src.serialize().data; return (d.features ?? []).filter((f) => f.properties?.drawn); });
      const through = CHAIN.every((p) => drawn.some((f) => f.geometry.coordinates.some((q) => hv(p, q) < 40)));
      rec("chain: ✓ keeps the drawn chain through all three, no extra routing", L.hash(await L.line(page)) !== h0 && through && log.reroute === n0, { drawnFeatures: drawn.length, through, extra: log.reroute - n0 });
      rec("chain: slots did not move (committed)", JSON.stringify(await rects()) === JSON.stringify(r0));
      if (tag === "375") { await L.fit(page, CHAIN, 90); await page.waitForTimeout(400); await page.screenshot({ path: `${process.env.CHAIN_SHOTS || L.SHOTS}/chain-straight-committed.png` }); }
      await slot(2); await page.waitForTimeout(800);
      rec("chain: ↶ takes the chain back", L.hash(await L.line(page)) === h0 && (await L.undoEnabled(page)) === u0);
    } else { await shot("fail-chain"); await slot("x"); await page.waitForTimeout(500); }
    console.log(`[${tag}]   straight chain ${((Date.now() - t) / 1000).toFixed(1)} s`);
  }
  await page.unroute(/\/api\/places\?(?=.*\blat=)/, reverse);

  // ── 8. „Saglabātie” (backlog 44/47): the card opens the ride; „Labot” is edit
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
