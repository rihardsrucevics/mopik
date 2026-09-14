/**
 * Backlog item 11c — does the sea term change which candidate is CHOSEN?
 *
 *   npx tsx scripts/measure-sea-pick.ts
 *
 * `scripts/measure-coast.ts` routes single legs, which answers what the *cost
 * profile* does beside the sea. It cannot answer item 11c, because the sea term
 * is a **ranking** term: a single leg has no candidates to choose between, so
 * the term provably cannot move it. This script asks the other half of the
 * question by running full generations through the dev server's
 * `/api/generate-route` with `debug: true`, and reading `debugCandidates`,
 * which carries `coast` (km within 1 km of a coastline on a real road) since
 * this item.
 *
 * Two things are read out of each generation, and they are different questions:
 *
 *  1. **Does the pool ever reach the coast?** `max(coast)` over all candidates.
 *     If nothing routed touches the shore road, no scoring term can pick it —
 *     the lever would then be the *search* (a coastal anchor bias in loop and
 *     waypoint generation), not the score. This is the honest-reporting case
 *     the brief asks for.
 *  2. **Given a pool that does, is a coastal candidate shown?** `coast` on the
 *     candidates with `shown: true` against the pool's best.
 *
 * The dev server is a 1 vCPU box, so legs run strictly sequentially.
 */

const API = process.env.API ?? "http://localhost:3000/api/generate-route";

type DebugCandidate = {
  variant: string;
  km: number;
  min: number;
  repeated: number;
  unpaved: number;
  nature: number;
  coast: number;
  excessDrift: number;
  acceptable: boolean;
  shown: boolean;
};

/**
 * Coastal requests, phrased as the composer builds them: a start, a
 * destination, and the default Adventure preset. Liepāja → Ventspils is the
 * headline — item 11b measured that ride sitting 5–10 km inland for its whole
 * middle although the coastal P111 runs the full length.
 */
/**
 * The Adventure preset exactly as the composer builds it — hard / riding /
 * forest — so this measures what a rider actually gets, the same way
 * `scripts/measure-coast.ts` reads it from `ride-profile.ts` rather than
 * restating it.
 */
const PRESET = {
  viaPlaces: [] as string[],
  directionPlace: null,
  focusArea: null,
  budgetScope: "total" as const,
  surroundings: "some" as const,
  difficulty: "hard" as const,
  rideStyle: "balanced" as const,
  gravelPreference: 100,
  trailPreference: "lots" as const,
  accessPolicy: "allow_unverified" as const,
  preferForest: true,
  maxRepeatedPercent: null,
  prioritizeLowOverlap: false,
  noSand: false,
  avoidTowns: false,
  avoidMainRoads: true,
  includeTet: false,
  includeSightseeing: false,
};

const place = (name: string, lat: number, lon: number) => ({ name, label: name, lat, lon });

function ride(
  start: [string, number, number],
  destination: [string, number, number] | null,
  hours: number
) {
  const places = destination ? [start, destination] : [start];
  return {
    plan: {
      ...PRESET,
      startPlace: start[0],
      destinationPlace: destination ? destination[0] : null,
      returnToStart: !destination,
      budget: { mode: "duration" as const, value: hours, constraint: "target" as const, minimumValue: null },
    },
    places: places.map(([name, lat, lon]) => place(name, lat, lon)),
  };
}

const LIEPAJA: [string, number, number] = ["Liepāja", 56.5047, 21.0107];
const VENTSPILS: [string, number, number] = ["Ventspils", 57.3894, 21.5606];
const KOLKA: [string, number, number] = ["Kolka", 57.7481, 22.5936];
const SIGULDA: [string, number, number] = ["Sigulda", 57.1530, 24.8530];

const CASES: { name: string; body: Record<string, unknown> }[] = [
  // The headline. Item 11b: the whole middle sits 5–10 km inland although the
  // coastal P111 runs the full length.
  { name: "liepaja-ventspils", body: ride(LIEPAJA, VENTSPILS, 4) },
  { name: "ventspils-kolka", body: ride(VENTSPILS, KOLKA, 3) },
  { name: "liepaja-loop", body: ride(LIEPAJA, null, 3) },
  // The control: inland, no published coastline cell, so `hasSeaData` is false
  // and every candidate must report coast 0.
  { name: "inland-sigulda-loop", body: ride(SIGULDA, null, 3) },
];

async function main() {
  console.log(`via ${API}\n`);
  console.log("case                   cand  poolMaxCoast  shownCoast  shownKm  shownRep%");

  for (const testCase of CASES) {
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...testCase.body, debug: true }),
      });
      const text = await response.text();
      if (!response.ok) {
        console.log(`${testCase.name.padEnd(22)} FAILED ${response.status} ${text.slice(0, 120)}`);
        continue;
      }
      const data = JSON.parse(text) as { debugCandidates?: DebugCandidate[] };
      const candidates = data.debugCandidates ?? [];
      if (!candidates.length) {
        console.log(`${testCase.name.padEnd(22)} no debugCandidates`);
        continue;
      }
      const shown = candidates.filter((c) => c.shown);
      const poolMax = Math.max(...candidates.map((c) => c.coast ?? 0));
      const shownMax = shown.length ? Math.max(...shown.map((c) => c.coast ?? 0)) : 0;
      const best = shown.find((c) => (c.coast ?? 0) === shownMax);
      console.log(
        `${testCase.name.padEnd(22)} ${String(candidates.length).padStart(4)} ` +
          `${poolMax.toFixed(1).padStart(13)} ${shownMax.toFixed(1).padStart(11)} ` +
          `${(best?.km ?? 0).toFixed(1).padStart(8)} ${String(best?.repeated ?? 0).padStart(10)}`
      );
      // The whole pool, coastiest first: this is what says whether the term had
      // anything to pick from.
      const sorted = [...candidates].sort((a, b) => (b.coast ?? 0) - (a.coast ?? 0)).slice(0, 6);
      for (const c of sorted) {
        console.log(
          `    ${c.variant.padEnd(24)} coast ${(c.coast ?? 0).toFixed(1).padStart(6)} km ` +
            `${c.km.toFixed(1).padStart(6)} rep ${String(c.repeated).padStart(3)} ` +
            `nature ${String(c.nature).padStart(3)} ${c.acceptable ? "ok " : "   "}${c.shown ? "SHOWN" : ""}`
        );
      }
    } catch (err) {
      console.log(`${testCase.name.padEnd(22)} ERROR ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
