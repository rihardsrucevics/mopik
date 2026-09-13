/**
 * Does `avoidMainRoads` mean the same thing outside Latvia?
 *
 * The profile prices `trunk` at 12 and `primary` at 20 when the rider asks to
 * avoid main roads, because **Latvia's A-roads are `trunk`** — legal, often the
 * only bridge across a river, and forbidding them once cost a rider's last
 * 5 km home a 44 km detour. In Germany, Poland or France `trunk` is a
 * limited-access dual carriageway: exactly what "avoid main roads" means.
 *
 * This routes the same legs with the flag on and off and reports how much
 * trunk each result actually rides, so the decision is a number rather than an
 * argument about OSM semantics.
 *
 * Run: BROUTER_BASE_URL=https://brouter.de npx tsx scripts/measure-trunk.ts
 */
import { fetchRoutePath } from "../lib/routing/brouter";
import type { MotoProfileOptions } from "../lib/routing/moto-profile";
import type { Point } from "../lib/geo/geometry";

type Leg = { name: string; from: Point; to: Point };

/** Legs long enough that a main road is a real temptation. */
const LEGS: Leg[] = [
  { name: "DE München → Ingolstadt", from: [11.5754, 48.1371], to: [11.4261, 48.7665] },
  { name: "DE Hamburg → Lüneburg", from: [9.9937, 53.5511], to: [10.4141, 53.2465] },
  { name: "PL Warszawa → Radom", from: [21.0122, 52.2297], to: [21.1471, 51.4027] },
  { name: "FR Lyon → Grenoble", from: [4.8357, 45.7640], to: [5.7245, 45.1885] },
  { name: "LV Rīga → Sigulda", from: [24.1052, 56.9496], to: [24.8560, 57.1539] },
  { name: "LV Rīga → Jūrmala", from: [24.1052, 56.9496], to: [23.7703, 56.9680] },
];

const base: MotoProfileOptions = {
  // Asphalt-only: the case where nothing pushes the router onto small roads,
  // so if `trunk` is ever going to be chosen it is here.
  offRoad: 0,
  difficulty: "easy",
  avoidMainRoads: false,
  avoidMotorways: true,
  noSand: false,
  avoidTowns: false,
  trails: "none",
};

/** Kilometres of each highway class in a routed result. */
function classKm(path: Awaited<ReturnType<typeof fetchRoutePath>>): Record<string, number> {
  const km: Record<string, number> = {};
  for (const edge of path.edges) {
    const cls = String(edge.tags?.highway ?? "unknown");
    km[cls] = (km[cls] ?? 0) + (edge.lengthKm ?? 0);
  }
  return km;
}

const show = (km: Record<string, number>, cls: string) => (km[cls] ?? 0).toFixed(1);

async function main() {
  console.log(`BRouter: ${process.env.BROUTER_BASE_URL ?? "https://brouter.de (default)"}\n`);
  console.log("leg                         flag  total   trunk  motorway  primary  secondary");
  console.log("-".repeat(84));

  for (const leg of LEGS) {
    for (const avoid of [false, true]) {
      try {
        const path = await fetchRoutePath({
          points: [leg.from, leg.to],
          profileOptions: { ...base, avoidMainRoads: avoid },
        });
        const km = classKm(path);
        const total = (path.distanceMeters / 1000).toFixed(1);
        console.log(
          `${leg.name.padEnd(27)} ${(avoid ? "ON " : "OFF").padEnd(5)} ${total.padStart(5)}  ${show(km, "trunk").padStart(6)}  ${show(km, "motorway").padStart(8)}  ${show(km, "primary").padStart(7)}  ${show(km, "secondary").padStart(9)}`,
        );
      } catch (err) {
        console.log(`${leg.name.padEnd(27)} ${(avoid ? "ON " : "OFF").padEnd(5)} failed: ${String(err).slice(0, 40)}`);
      }
      // The public instance throttles bursts; leave room between requests.
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

main();
