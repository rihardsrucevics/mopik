/**
 * Backlog item 11d — does the SEARCH ever put a candidate on the coast road?
 *
 *   npx tsx scripts/measure-seaward.ts [outDir]
 *
 * Item 11c measured that the sea term ranks correctly and then found it had
 * nothing to rank: an A-to-B generation returned 2 candidates, both on the same
 * inland line. `scripts/measure-sea-pick.ts` asks that question through the dev
 * server; this one asks it **in process**, which matters for two reasons.
 *
 *  1. The dev server is shared with other work in this project and HMR has
 *     served stale code through a whole measurement round before (CLAUDE.md:
 *     "Editing an API route needs a dev-server restart"). Routing and
 *     classifying here means the numbers come from the checked-out source.
 *  2. The interesting cost is per candidate, and an offshore via point costs
 *     minutes rather than seconds — a number the dev server hides inside one
 *     request's wall clock.
 *
 * What it prints, per ride: how many candidates the search builds, how many
 * route at all, what each costs, and the coastal kilometres of the best of
 * them — before and after item 11d, from the same process.
 *
 * BRouter at `BROUTER_BASE_URL` is one vCPU, so every leg runs strictly
 * sequentially and slow candidates are given a deadline rather than allowed to
 * hold the run (measured: one via point in the Baltic took over 30 minutes
 * before it was killed, against 1.5 s for the direct line).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { fetchRoutePath } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { classifyRoute } from "../lib/routing/classify";
import { dropOffshoreVias, seawardVias, type ViaProbe } from "../lib/routing/seaward";
import { snapDistanceM } from "../lib/routing/fetch-route-probe";
import { loopRank } from "../lib/routing/score";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema, type RoutePath } from "../lib/types";

const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));
const OPTIONS = buildMotoProfileOptions(INTENT);

/**
 * How long one candidate may hold the run.
 *
 * This is the measurement's own guard, not the app's. `TIME_BUDGET_MS` in the
 * API is 50 s for the whole generation, so a candidate that has not answered in
 * 90 s would have been abandoned there long ago; letting it run here only
 * distorts the totals. The number is reported when it strikes, because "this
 * candidate is unroutable" is itself a finding — it is what the offshore via
 * points do.
 */
const CANDIDATE_DEADLINE_MS = 90_000;

type Place = { name: string; lat: number; lon: number };
const at = (name: string, lat: number, lon: number): Place => ({ name, lat, lon });

const LIEPAJA = at("Liepāja", 56.5047, 21.0107);
const VENTSPILS = at("Ventspils", 57.3894, 21.5606);
const KOLKA = at("Kolka", 57.7481, 22.5936);
const RIGA = at("Rīga", 56.9496, 24.1052);
const AINAZI = at("Ainaži", 57.8686, 24.3594);
const PARNU = at("Pärnu", 58.3859, 24.4971);
const HAAPSALU = at("Haapsalu", 58.9431, 23.5417);
const PAVILOSTA = at("Pāvilosta", 56.8878, 21.1855);
const SIGULDA = at("Sigulda", 57.1530, 24.8530);
const CESIS = at("Cēsis", 57.3120, 25.2717);
const MADONA = at("Madona", 56.8531, 26.2181);

type Ride = { name: string; from: Place; to: Place | null; targetKm: number };

/**
 * The brief's list. Four coastal A-to-B rides (Liepāja → Ventspils is the
 * headline), one coastal round trip, and the two inland controls that must not
 * move.
 */
const RIDES: Ride[] = [
  { name: "liepaja-ventspils", from: LIEPAJA, to: VENTSPILS, targetKm: 180 },
  { name: "ventspils-kolka", from: VENTSPILS, to: KOLKA, targetKm: 140 },
  { name: "riga-ainazi", from: RIGA, to: AINAZI, targetKm: 240 },
  { name: "parnu-haapsalu", from: PARNU, to: HAAPSALU, targetKm: 170 },
  { name: "pavilosta-loop", from: PAVILOSTA, to: null, targetKm: 120 },
  { name: "inland-sigulda-loop", from: SIGULDA, to: null, targetKm: 120 },
  { name: "inland-cesis-madona", from: CESIS, to: MADONA, targetKm: 160 },
];

/** The offsets `buildCandidates` builds, self-hosted. Shared with item 11e's
 * substitution rule, which must pick offsets this list does NOT contain. */
const VIA_SCALES = [0, 0.35, 0.7, 1, 1.4, 1.8, 2.2, 2.8];

/** The corridor offset the API computes for this ride, shared by the builder
 * and by item 11e's mirrored substitutes so both use the same number. */
function reachOf(ride: Ride): number {
  const a = ride.from;
  const b = ride.to!;
  const directKm = Math.hypot((b.lat - a.lat) * 111, (b.lon - a.lon) * 61);
  const spareMeters = Math.max(0, ride.targetKm - directKm) * 1000;
  const legMeters = directKm * 1000;
  return Math.min(20000, Math.max(3000, spareMeters / (2 * 5), legMeters * 0.12));
}

/** `perpendicularVia` from the API route, copied so this measures what ships. */
function perpendicularVia(a: Place, b: Place, t: number, meters: number): [number, number] {
  const midLat = a.lat + (b.lat - a.lat) * t;
  const midLon = a.lon + (b.lon - a.lon) * t;
  const latScale = 111320;
  const lonScale = 111320 * Math.cos((midLat * Math.PI) / 180);
  const dx = (b.lon - a.lon) * lonScale;
  const dy = (b.lat - a.lat) * latScale;
  const len = Math.hypot(dx, dy) || 1;
  return [midLon + (-dy / len) * meters / lonScale, midLat + (dx / len) * meters / latScale];
}

type Outcome = {
  variant: string;
  ok: boolean;
  seconds: number;
  km: number;
  coastKm: number;
  coastNearKm: number;
  coast300Km: number;
  /**
   * Kilometres on `highway=path` within 1 km of the sea — the shoreline
   * footpath item 11a spent a day removing, and the number the brief requires
   * to stay at ~0.
   *
   * Not `quality.coastKm`'s complement and deliberately not a beach-polygon
   * test: the `natural=beach` extract is a 37 MB scratchpad artefact that is
   * not committed (item 11's tooling note), so the reproducible proxy is the
   * class that carried it. Item 11c measured the two together — Liepāja →
   * Ventspils, 19.4 km within 1 km of the sea of which 3.8 km was shore path —
   * so a rise here is the regression this guards against.
   */
  shorePathKm: number;
  repeatedPercent: number;
  minutes: number;
  rank: number;
  detail?: string;
};

/**
 * Kilometres within 300 m of the coastline, on a real road.
 *
 * `classify.ts` publishes the 1 km and 3 km bands because those are what
 * `score.ts` spends; the brief asks for 300 m as well, so it is measured here
 * against the same committed dataset and the same midpoint rule rather than
 * added to the runtime metric for one table.
 */
async function coastBands(path: RoutePath): Promise<{ km300: number; shorePathKm: number }> {
  const { bboxOf, hasSeaData, seaLookup } = await import("../lib/geo/sea");
  const coords = path.coordinates;
  const none = { km300: 0, shorePathKm: 0 };
  if (coords.length < 2) return none;
  const bbox = bboxOf(coords);
  if (!hasSeaData(bbox)) return none;
  const lookup = seaLookup(bbox);
  if (!lookup.size) return none;

  // Same exclusion as `measureCoast`: a beach or dune footpath beside the water
  // must never count as riding the coast road. Here the excluded classes are
  // also counted separately, because that is the regression to watch.
  const excluded = new Set(["path", "footway", "cycleway", "bridleway", "steps"]);
  const onRoad = new Array<boolean>(coords.length - 1).fill(false);
  const onPath = new Array<boolean>(coords.length - 1).fill(false);
  for (const edge of path.edges) {
    const hw = (edge.tags?.highway ?? edge.use ?? "").toLowerCase();
    const end = Math.min(edge.endShapeIndex, coords.length - 1);
    for (let i = Math.max(0, edge.beginShapeIndex); i < end; i++) {
      if (excluded.has(hw)) onPath[i] = true;
      else onRoad[i] = true;
    }
  }

  const { haversineMeters } = await import("../lib/geo/geometry");
  let meters300 = 0;
  let shorePath = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    if (!onRoad[i] && !onPath[i]) continue;
    const a = coords[i];
    const b = coords[i + 1];
    const m = haversineMeters(a, b);
    if (m <= 0) continue;
    const d = lookup.distanceM((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    if (onRoad[i] && d < 300) meters300 += m;
    if (onPath[i] && d < 1000) shorePath += m;
  }
  return {
    km300: Math.round(meters300 / 100) / 10,
    shorePathKm: Math.round(shorePath) / 1000,
  };
}

/**
 * Route one candidate under a deadline and classify it.
 *
 * Item 11g: every intermediate point in this harness is one the *builder*
 * invented — these rides are plain A-to-B with computed vias, and the only
 * rider-named places are the two ends. Declaring them as generated is
 * therefore exact, and it is what makes the measurement compare the shipped
 * behaviour rather than the endpoint-nudge path no candidate should take.
 */
async function runCandidate(variant: string, points: [number, number][]): Promise<Outcome> {
  const generatedViaIndices = points.map((_, i) => i).filter((i) => i > 0 && i < points.length - 1);
  const t0 = Date.now();
  const empty = {
    variant, km: 0, coastKm: 0, coastNearKm: 0, coast300Km: 0, shorePathKm: 0,
    repeatedPercent: 0, minutes: 0, rank: 0,
  };
  try {
    const path = await Promise.race([
      fetchRoutePath({ points, profileOptions: OPTIONS, generatedViaIndices }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`deadline ${CANDIDATE_DEADLINE_MS / 1000}s`)), CANDIDATE_DEADLINE_MS)
      ),
    ]);
    const c = classifyRoute(path);
    const bands = await coastBands(path);
    const km = path.distanceMeters / 1000;
    const rank = loopRank(INTENT, {
      repeatedPercent: c.overlap.repeatedPercent,
      unpavedPercent: c.surfaces.gravelPercent + c.surfaces.dirtPercent,
      trackPercent: c.roadMix.trackPercent,
      trailPercent: c.roadMix.trailPercent,
      streetPercent: c.quality.streetKm / Math.max(1, km) * 100,
      excessDriftPercent: 0,
      natureScore: c.quality.natureScore,
      coastPercent: (c.quality.coastKm / Math.max(1, km)) * 100,
      coastNearPercent: (c.quality.coastNearKm / Math.max(1, km)) * 100,
    });
    return {
      ...empty,
      ok: true,
      seconds: (Date.now() - t0) / 1000,
      km: Math.round(km * 10) / 10,
      coastKm: c.quality.coastKm,
      coastNearKm: c.quality.coastNearKm,
      coast300Km: bands.km300,
      shorePathKm: bands.shorePathKm,
      repeatedPercent: c.overlap.repeatedPercent,
      minutes: Math.round(c.durationSeconds / 60),
      rank: Math.round(rank * 100) / 100,
    };
  } catch (err) {
    return {
      ...empty,
      ok: false,
      seconds: (Date.now() - t0) / 1000,
      detail: String((err as Error).message).slice(0, 80),
    };
  }
}

/**
 * The A-to-B candidate set the API builds, as variants and point lists.
 * Mirrors `buildCandidates`' via/zig block; the `around-*` shapes need an
 * intermediate place and none of these rides has one.
 */
type Built = { variant: string; points: [number, number][]; via: [number, number] | null };

function viaCandidates(ride: Ride): Built[] {
  const a = ride.from;
  const b = ride.to!;
  const reach = reachOf(ride);

  const out: Built[] = [];
  for (const scale of VIA_SCALES) {
    for (const side of scale === 0 ? [1] : [1, -1]) {
      const points: [number, number][] = [[a.lon, a.lat]];
      const via = scale ? perpendicularVia(a, b, 0.5, reach * scale * side) : null;
      if (via) points.push(via);
      points.push([b.lon, b.lat]);
      out.push({ variant: `via-${scale}-${side}`, points, via });
    }
  }
  for (const [scale] of [[1.2], [0.7]] as const) {
    const points: [number, number][] = [[a.lon, a.lat]];
    for (const [fraction, amplitude] of [[0.2, 1], [0.5, 0.35], [0.8, 1]] as const) {
      points.push(perpendicularVia(a, b, fraction, reach * scale * amplitude));
    }
    points.push([b.lon, b.lat]);
    out.push({ variant: `zig-${scale}`, points, via: null });
  }
  return out;
}

async function main() {
  const outDir = process.argv[2] ?? "/tmp/seaward";
  mkdirSync(outDir, { recursive: true });
  const only = process.env.ONLY?.split(",").map((s) => s.trim());
  console.log(`via ${process.env.BROUTER_BASE_URL}\n`);

  const report: Record<string, unknown> = {};

  for (const ride of RIDES) {
    if (only && !only.includes(ride.name)) continue;
    const t0 = Date.now();
    console.log(`\n=== ${ride.name} (${ride.from.name} → ${ride.to?.name ?? "round trip"}) ===`);

    if (!ride.to) {
      // Loops are measured by `measure-sea-pick.ts` through the API, which owns
      // the isochrone and the calibration route. Here only the seaward bearing
      // is reported, since that is the item 11d input.
      const { seawardBearing } = await import("../lib/routing/seaward");
      const bearing = seawardBearing([ride.from.lon, ride.from.lat]);
      console.log(`  loop start seaward bearing: ${bearing === null ? "none (inland)" : Math.round(bearing) + "°"}`);
      report[ride.name] = { loop: true, seawardBearing: bearing };
      continue;
    }

    const before = viaCandidates(ride);
    const seaward = seawardVias([ride.from.lon, ride.from.lat], [ride.to.lon, ride.to.lat]);
    console.log(`  built: ${before.length} inland + ${seaward.length} seaward`);
    for (const v of seaward) console.log(`    sea-${v.fraction}: ${v.coastDistanceM} m from the coastline`);

    // --- item 11e: drop the vias that are in the water -----------------------
    //
    // Mirrors what `buildCandidates` now does: probe each perpendicular via
    // against the router, drop the ones offshore, and swap in the same offset
    // mirrored to the land side. Candidates with no perpendicular via (the
    // direct line, the zig shapes) are never probed.
    const subOf = new Map<string, Built>();
    const probes: ViaProbe<string>[] = [];
    for (const c of before) {
      if (!c.via) continue;
      const m = /^via-([\d.]+)-(-?1)$/.exec(c.variant);
      if (!m) continue;
      const scale = Number(m[1]);
      const side = Number(m[2]);
      // The land-side stand-ins, at offsets the pool does NOT already hold: the
      // plain mirror of a symmetric scale list is the existing opposite-side
      // candidate, and routing it again is a duplicate, not a substitute.
      const index = VIA_SCALES.indexOf(scale);
      const next = VIA_SCALES[index + 1];
      const betweens = [
        ...(next ? [(scale + next) / 2] : [scale * 1.3]),
        (scale + (VIA_SCALES[index - 1] ?? 0)) / 2,
      ].filter((v) => v > 0 && !VIA_SCALES.includes(v));
      const substitutes: { item: string; point: [number, number] }[] = [];
      for (const v of betweens) {
        const name = `via-${Math.round(v * 100) / 100}-${-side}s`;
        if (subOf.has(name)) continue;
        const point = perpendicularVia(ride.from, ride.to!, 0.5, reachOf(ride) * v * -side);
        subOf.set(name, {
          variant: name,
          points: [[ride.from.lon, ride.from.lat], point, [ride.to.lon, ride.to.lat]],
          via: point,
        });
        substitutes.push({ item: name, point });
      }
      probes.push({ item: c.variant, point: c.via, substitutes });
    }
    const filtered = await dropOffshoreVias({
      probes,
      snap: (point) => snapDistanceM({ point, profileOptions: OPTIONS }),
    });
    const keptSet = new Set(filtered.kept);
    const after: Built[] = [];
    const placed = new Set<string>();
    for (const c of before) {
      const probe = probes.find((p) => p.item === c.variant);
      if (!probe) { after.push(c); continue; }
      if (keptSet.has(c.variant)) after.push(c);
      for (const sub of probe.substitutes) {
        if (!keptSet.has(sub.item) || placed.has(sub.item)) continue;
        const built = subOf.get(sub.item);
        if (built) { after.push(built); placed.add(sub.item); }
      }
    }
    console.log(
      `  offshore probe: ${filtered.probed} probed, ${filtered.dropped} in the water, ` +
        `${filtered.substituted} mirrored to land, ${filtered.ms} ms  →  pool ${before.length} → ${after.length}`
    );

    const outcomes: Outcome[] = [];
    for (const c of after) {
      const o = await runCandidate(c.variant, c.points);
      outcomes.push(o);
      console.log(
        `  ${o.variant.padEnd(14)} ${(o.ok ? "OK  " : "FAIL")} ${o.seconds.toFixed(1).padStart(6)}s ` +
          (o.ok
            ? `${o.km.toFixed(1).padStart(6)} km  <300m ${o.coast300Km.toFixed(1).padStart(5)}  <1km ${o.coastKm.toFixed(1).padStart(5)}  <3km ${o.coastNearKm.toFixed(1).padStart(5)}  shorePath ${o.shorePathKm.toFixed(2)}  rep ${String(o.repeatedPercent).padStart(3)}  rank ${o.rank.toFixed(1).padStart(7)}`
            : `  ${o.detail}`)
      );
    }
    for (const v of seaward) {
      const o = await runCandidate(`sea-${v.fraction}`, [
        [ride.from.lon, ride.from.lat], v.point, [ride.to.lon, ride.to.lat],
      ]);
      outcomes.push(o);
      console.log(
        `  ${o.variant.padEnd(14)} ${(o.ok ? "OK  " : "FAIL")} ${o.seconds.toFixed(1).padStart(6)}s ` +
          (o.ok
            ? `${o.km.toFixed(1).padStart(6)} km  <300m ${o.coast300Km.toFixed(1).padStart(5)}  <1km ${o.coastKm.toFixed(1).padStart(5)}  <3km ${o.coastNearKm.toFixed(1).padStart(5)}  shorePath ${o.shorePathKm.toFixed(2)}  rep ${String(o.repeatedPercent).padStart(3)}  rank ${o.rank.toFixed(1).padStart(7)}`
            : `  ${o.detail}`)
      );
    }

    const routed = outcomes.filter((o) => o.ok);
    const inlandOnly = routed.filter((o) => !o.variant.startsWith("sea-"));
    const best = (list: Outcome[]) => list.slice().sort((a, b) => a.rank - b.rank)[0];
    const bestBefore = best(inlandOnly);
    const bestAfter = best(routed);
    console.log(
      `  → best BEFORE: ${bestBefore?.variant ?? "none"} coast<1km ${bestBefore?.coastKm ?? 0} km, rank ${bestBefore?.rank ?? 0}\n` +
        `  → best AFTER:  ${bestAfter?.variant ?? "none"} coast<1km ${bestAfter?.coastKm ?? 0} km, rank ${bestAfter?.rank ?? 0}`
    );
    const failed = outcomes.filter((o) => !o.ok);
    const failSeconds = Math.round(failed.reduce((n, o) => n + o.seconds, 0) * 10) / 10;
    const okSeconds = Math.round(routed.reduce((n, o) => n + o.seconds, 0) * 10) / 10;
    console.log(
      `  routed ${routed.length}, failed ${failed.length}; ${okSeconds}s on successes, ` +
        `${failSeconds}s on failures; probe ${filtered.ms} ms`
    );
    report[ride.name] = {
      builtInland: before.length,
      poolAfterOffshoreFilter: after.length,
      offshore: filtered,
      failed: failed.length,
      failSeconds,
      okSeconds,
      builtSeaward: seaward.length,
      routedInland: inlandOnly.length,
      routedSeaward: routed.length - inlandOnly.length,
      seawardVias: seaward,
      outcomes,
      bestBefore,
      bestAfter,
      totalSeconds: Math.round((Date.now() - t0) / 100) / 10,
    };
    writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
  }

  writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
  console.log(`\nfull detail in ${outDir}/report.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
