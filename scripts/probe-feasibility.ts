/**
 * Time the feasibility probe on the legs that decide backlog item 7.
 *
 *   npx tsx scripts/probe-feasibility.ts            # the four standard legs
 *   npx tsx scripts/probe-feasibility.ts --budget=10000
 *   ONLY=roma npx tsx scripts/probe-feasibility.ts
 *
 * Prints, per leg: what the probe cost, whether it passed, and — when it
 * passed — how many candidates that measurement says the generation can
 * afford. Reads `BROUTER_BASE_URL` / `BROUTER_TOKEN` from `.env.local`.
 */
import { readFileSync } from "node:fs";
import { probeLeg, affordableCandidates, PROBE_BUDGET_MS, GENERATION_OVERHEAD_MS } from "../lib/routing/fetch-route-probe";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { RouteIntentSchema } from "../lib/types";
import type { Point } from "../lib/geo/geometry";

// tsx does not read .env.local on its own, and without the token every
// request to our own instance is a 401 that looks like a routing failure.
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

/** The legs from the backlog's own measurements, so the numbers are comparable. */
const LEGS: { key: string; name: string; from: Point; to: Point }[] = [
  { key: "tallinn", name: "Rīga → Tallinn", from: [24.1052, 56.9496], to: [24.7536, 59.437] },
  { key: "warszawa", name: "Berlin → Warszawa", from: [13.405, 52.52], to: [21.0122, 52.2297] },
  { key: "budapest", name: "Como → Budapest", from: [9.0852, 45.8081], to: [19.0402, 47.4979] },
  { key: "roma", name: "Rīga → Roma", from: [24.1052, 56.9496], to: [12.4964, 41.9028] },
];

/** The budget the API works to, mirrored from the generate route. */
const TIME_BUDGET_MS = 50_000;
/** What a typical generation builds, so the cap is realistic. */
const CANDIDATE_CAP = 36;

async function main() {
  const budgetArg = process.argv.find((a) => a.startsWith("--budget="));
  const budgetMs = budgetArg ? Number(budgetArg.split("=")[1]) : PROBE_BUDGET_MS;
  const only = process.env.ONLY?.split(",").map((s) => s.trim()).filter(Boolean);

  // The rider's hard-forest settings: the profile that costs the most to
  // search, so the probe is measured at its worst rather than its best.
  const intent = RouteIntentSchema.parse({
    difficulty: "hard",
    gravelPreference: 100,
    trailPreference: "lots",
    preferForest: true,
  });
  const profileOptions = buildMotoProfileOptions(intent);

  console.log(`probe budget ${budgetMs} ms · router ${process.env.BROUTER_BASE_URL || "brouter.de"}`);
  console.log("");
  console.log("leg                  probe      outcome      candidates affordable");
  console.log("-------------------- ---------- ------------ ---------------------");

  for (const leg of LEGS) {
    if (only && !only.includes(leg.key)) continue;
    const points: Point[] = [leg.from, leg.to];
    const out = await probeLeg({ points, profileOptions, budgetMs });
    const secs = `${out.seconds.toFixed(1)} s`;
    if (out.ok) {
      const n = affordableCandidates({
        budgetMs: TIME_BUDGET_MS,
        spentMs: out.seconds * 1000,
        legMs: out.seconds * 1000,
        overheadMs: GENERATION_OVERHEAD_MS,
        cap: CANDIDATE_CAP,
      });
      const km = Math.round(out.path.distanceMeters / 1000);
      console.log(`${leg.name.padEnd(20)} ${secs.padEnd(10)} ${`ok, ${km} km`.padEnd(12)} ${n}`);
    } else {
      console.log(`${leg.name.padEnd(20)} ${secs.padEnd(10)} ${out.reason.padEnd(12)} — ${out.detail ?? "over budget"}`);
    }
    // The router is a single vCPU: back-to-back probes would measure each
    // other's load rather than the leg (measured: 14.7 s → 35-40 s under
    // overlap).
    await new Promise((r) => setTimeout(r, 8000));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
