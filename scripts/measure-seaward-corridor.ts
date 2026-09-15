/**
 * Item 11f — the coastal candidate, before and after.
 *
 *   npx tsx scripts/measure-seaward-corridor.ts
 *
 * Routes today's one-via `sea-*` candidates and item 11f's two-via
 * `seaCorridor-*` ones on the same legs, with the same profile, in the same
 * process, and prints repeated %, coastal km and rank for each — plus the
 * inland winner they have to beat, since the rider's rule is that the coastal
 * candidate's repeats must be comparable to it.
 */
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { classifyRoute } from "../lib/routing/classify";
import { seawardCorridors, seawardVias } from "../lib/routing/seaward";
import { loopRank } from "../lib/routing/score";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema } from "../lib/types";

const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));
const OPTIONS = buildMotoProfileOptions(INTENT);

type Leg = { name: string; a: [number, number]; b: [number, number] };
const LEGS: Leg[] = [
  { name: "Liepāja → Ventspils", a: [21.0107, 56.5047], b: [21.5606, 57.3894] },
  { name: "Ventspils → Kolka", a: [21.5606, 57.3894], b: [22.5936, 57.7481] },
  { name: "Rīga → Ainaži", a: [24.1052, 56.9496], b: [24.3594, 57.8686] },
  { name: "Jūrmala → Kolka", a: [23.7794, 56.9681], b: [22.5936, 57.7481] },
];

type Row = { variant: string; km: number; rep: number; coastKm: number; rank: number };

async function measure(variant: string, points: [number, number][]): Promise<Row | null> {
  try {
    const path = await fetchRoutePath({ points, profileOptions: OPTIONS });
    const c = classifyRoute(path);
    const km = path.distanceMeters / 1000;
    const rank = loopRank(INTENT, {
      repeatedPercent: c.overlap.repeatedPercent,
      unpavedPercent: c.surfaces.gravelPercent + c.surfaces.dirtPercent,
      trackPercent: c.roadMix.trackPercent,
      trailPercent: c.roadMix.trailPercent,
      streetPercent: (c.quality.streetKm / Math.max(1, km)) * 100,
      excessDriftPercent: 0,
      natureScore: c.quality.natureScore,
      coastPercent: (c.quality.coastKm / Math.max(1, km)) * 100,
      coastNearPercent: (c.quality.coastNearKm / Math.max(1, km)) * 100,
    });
    const row = {
      variant,
      km: Math.round(km * 10) / 10,
      rep: c.overlap.repeatedPercent,
      coastKm: c.quality.coastKm,
      rank: Math.round(rank * 100) / 100,
    };
    console.log(
      `  ${variant.padEnd(24)} ${row.km.toFixed(1).padStart(6)} km  rep ${String(row.rep).padStart(3)}%  ` +
        `coast<1km ${row.coastKm.toFixed(1).padStart(5)}  rank ${row.rank.toFixed(2).padStart(7)}`
    );
    return row;
  } catch (err) {
    console.log(`  ${variant.padEnd(24)} FAILED  ${String((err as Error).message).slice(0, 45)}`);
    return null;
  }
}

async function main() {
  for (const leg of LEGS) {
    console.log(`\n=== ${leg.name} ===`);
    const rows: Row[] = [];
    const push = (r: Row | null) => { if (r) rows.push(r); };

    push(await measure("via-0-1 (inland direct)", [leg.a, leg.b]));

    const vias = seawardVias(leg.a, leg.b);
    for (const v of vias) push(await measure(`sea-${v.fraction} (BEFORE)`, [leg.a, v.point, leg.b]));

    const corridors = seawardCorridors(leg.a, leg.b);
    for (const c of corridors) {
      push(
        await measure(
          `seaCorridor-${c.fractions[0]}-${c.fractions[1]} (AFTER)`,
          [leg.a, c.points[0], c.points[1], leg.b]
        )
      );
    }

    const best = rows.slice().sort((x, y) => x.rank - y.rank)[0];
    const bestCoastal = rows
      .filter((r) => r.variant.startsWith("sea"))
      .slice()
      .sort((x, y) => x.rank - y.rank)[0];
    const inland = rows.find((r) => r.variant.startsWith("via-0-1"));
    console.log(
      `  → winner: ${best?.variant ?? "none"} (rank ${best?.rank}, rep ${best?.rep}%)\n` +
        `  → best coastal: ${bestCoastal?.variant ?? "none"} rep ${bestCoastal?.rep ?? "-"}% ` +
        `vs inland ${inland?.rep ?? "-"}%`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
