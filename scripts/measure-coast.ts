/**
 * Backlog item 11 — how close do coastal rides get to the sea, and do they
 * ride on the beach?
 *
 *   npx tsx scripts/measure-coast.ts [outDir]
 *
 * Routes the coastal legs below with the app's own Adventure profile through
 * `BROUTER_BASE_URL`, and writes one JSON per leg ({coordinates, edges}) for
 * `scratchpad/sea/coast.py` to score against OSM `natural=coastline` and
 * `natural=beach|sand|dune|shingle`.
 *
 * Routing here is deliberately a single leg per ride rather than the full
 * generation: the question is what the *cost profile* does beside the sea,
 * and a 36-candidate generation answers it with loop-shape noise on top.
 */
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema } from "../lib/types";
import { writeFileSync, mkdirSync } from "node:fs";

type Leg = { name: string; points: [number, number][] };

/** The reported case first, then one leg per stretch of Baltic coast. */
const LEGS: Leg[] = [
  { name: "riga-ainazi", points: [[24.1052, 56.9496], [24.3594, 57.8686]] },
  { name: "jurmala-kolka", points: [[23.7708, 56.9680], [22.5936, 57.7481]] },
  { name: "liepaja-ventspils", points: [[21.0107, 56.5047], [21.5606, 57.3894]] },
  { name: "parnu-haapsalu", points: [[24.4971, 58.3859], [23.5417, 58.9431]] },
  { name: "klaipeda-palanga", points: [[21.1443, 55.7033], [21.0687, 55.9175]] },
  { name: "ventspils-kolka", points: [[21.5606, 57.3894], [22.5936, 57.7481]] },
];

/** Two inland legs, to catch a fix that quietly degrades ordinary rides. */
const INLAND: Leg[] = [
  { name: "inland-sigulda-cesis", points: [[24.8530, 57.1530], [25.2717, 57.3120]] },
  { name: "inland-cesis-madona", points: [[25.2717, 57.3120], [26.2181, 56.8531]] },
];

/**
 * The default Adventure preset exactly as the composer builds it — hard /
 * riding / forest, i.e. gravel 100, trails "lots", `allow_unverified`. Read
 * from `ride-profile.ts` rather than restated, so this measures what a rider
 * actually gets.
 */
const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));

async function main() {
  const outDir = process.argv[2] ?? "/tmp/coast";
  mkdirSync(outDir, { recursive: true });
  const profileOptions = buildMotoProfileOptions(INTENT);
  console.log(`via ${process.env.BROUTER_BASE_URL}`, profileOptions);

  for (const leg of [...LEGS, ...INLAND]) {
    const t0 = Date.now();
    try {
      const path = await fetchRoutePath({ points: leg.points, profileOptions });
      writeFileSync(
        `${outDir}/${leg.name}.json`,
        JSON.stringify({ coordinates: path.coordinates, edges: path.edges })
      );
      console.log(
        `${leg.name}: ${(path.distanceMeters / 1000).toFixed(1)} km, ` +
          `${path.edges.length} edges, ${((Date.now() - t0) / 1000).toFixed(1)} s`
      );
    } catch (err) {
      console.log(`${leg.name}: FAILED ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
