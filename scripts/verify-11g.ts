/**
 * Item 11g / backlog 20 verification, in process.
 *
 *   npx tsx scripts/verify-11g.ts
 *
 * Three questions, each measured rather than reasoned about:
 *  1. the generated via that cost 209 s — does it now fail fast and cheap?
 *  2. a rider-named via the profile cannot reach (Satezeles pilskalns,
 *     backlog item 20) — does it now route, and how far was it moved?
 *  3. the three suggestions that always worked — unchanged?
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const eq = line.indexOf("=");
  if (eq > 0 && !line.startsWith("#")) process.env[line.slice(0, eq).trim()] ||= line.slice(eq + 1).trim();
}
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema } from "../lib/types";
import type { Point } from "../lib/geo/geometry";

const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));
const OPTIONS = buildMotoProfileOptions(INTENT);

const LIEPAJA: Point = [21.0107, 56.5047];
const VENTSPILS: Point = [21.5606, 57.3894];
const BAD_VIA: Point = [21.421589, 56.921915];
const SIGULDA: Point = [24.853, 57.153];

/** The POIs from backlog item 20: one that 422'd, three that always routed. */
const POIS: { name: string; point: Point }[] = [
  { name: "Satezeles pilskalns", point: [24.8707, 57.17161] },
  { name: "Ķeizarskats", point: [24.8477, 57.1723] },
  { name: "Lojas pilskalns", point: [24.8895, 57.1544] },
  { name: "Gūtmaņa ala", point: [24.8489, 57.1776] },
];

async function timed(label: string, points: Point[], generatedViaIndices?: number[]) {
  const t0 = Date.now();
  try {
    const path = await fetchRoutePath({ points, profileOptions: OPTIONS, generatedViaIndices });
    const s = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `  ${label.padEnd(44)} OK   ${(path.distanceMeters / 1000).toFixed(1)} km in ${s} s` +
        (path.endpointMovedMeters ? `  (a point was moved ${path.endpointMovedMeters} m)` : "")
    );
  } catch (err) {
    console.log(`  ${label.padEnd(44)} FAIL ${((Date.now() - t0) / 1000).toFixed(1)} s: ${(err as Error).message.slice(0, 60)}`);
  }
}

async function main() {
  console.log(`via ${process.env.BROUTER_BASE_URL}\n`);

  console.log("1. Item 11g — the generated via that cost 209 s across six candidates");
  await timed("as a GENERATED via (the fix)", [LIEPAJA, BAD_VIA, VENTSPILS], [1]);
  await timed("as a RIDER-NAMED via (the nudge ring)", [LIEPAJA, BAD_VIA, VENTSPILS]);

  console.log("\n2 + 3. Backlog item 20 — a suggestion added as a via on a Sigulda round trip");
  for (const { name, point } of POIS) {
    await timed(name, [SIGULDA, point, SIGULDA]);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
