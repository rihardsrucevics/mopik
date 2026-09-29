// Generate the fixture rides once, against the dev server's real router.
//   node scripts/verify/record-fixtures.cjs            all of fixtures.spec.json
//   node scripts/verify/record-fixtures.cjs ride-0928  just one
// Each takes one real generation (~20–60 s). Two run at a time, not more:
// the router is one vCPU and several agents share it.
process.env.FIXTURES = "off";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const L = require("./lib.cjs");

const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures.spec.json"), "utf8"));
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SPEC).filter((k) => !k.startsWith("_"));
const ROOT = path.resolve(__dirname, "../..");

async function record(name) {
  const spec = SPEC[name];
  if (!spec) throw new Error(`no fixture "${name}" in fixtures.spec.json`);
  const t0 = Date.now();
  const { browser, page } = await L.open({ phone: false });
  let request = null, response = null;
  await page.route("**/api/generate-route", async (route) => {
    const body = JSON.parse(route.request().postData());
    if (spec.shapePoints) body.plan.shapePoints = spec.shapePoints;
    request = body;
    const res = await route.fetch({ postData: JSON.stringify(body), timeout: 120000 });
    response = await res.text();
    await route.fulfill({ response: res, body: response });
  });
  await L.plan(page, spec.places);
  try { await L.generate(page); }
  catch (e) {
    const shot = path.join(L.SHOTS, `record-fail-${name}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    throw new Error(`${name}: no result (${e.message.split("\n")[0]}); response ${response ? response.slice(0, 200) : "none"}; screenshot ${shot}`);
  }
  const planCode = execFileSync("npx", ["tsx", path.join(__dirname, "encode-plan.ts")], { cwd: ROOT, input: JSON.stringify({ plan: request.plan, places: request.places }) }).toString();
  const parsed = JSON.parse(response);
  const out = {
    name, description: spec.description, places: spec.places, ...(spec.shapePoints ? { shapePoints: spec.shapePoints } : {}),
    recordedAt: new Date().toISOString(),
    routes: (parsed.routes ?? []).map((r) => ({ variant: r.variant, km: Math.round(r.distanceMeters / 100) / 10, points: r.geometry?.coordinates?.length })),
    planCode, request, response,
  };
  fs.writeFileSync(path.join(__dirname, "fixtures", name + ".json"), JSON.stringify(out, null, 1) + "\n");
  console.log(`${name}: ${out.routes.map((r) => `${r.variant} ${r.km} km`).join(", ")} — ${Math.round((Date.now() - t0) / 1000)} s`);
  await browser.close();
}

(async () => {
  const queue = [...names];
  const worker = async () => { while (queue.length) await record(queue.shift()); };
  await Promise.all([worker(), worker()]);
})().catch((e) => { console.error(e); process.exit(1); });
