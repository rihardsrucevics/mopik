/**
 * Stops added to or moved on a generated ride, ridden through or not: the
 * edit's stretches routed as the page routes them (`planEdit` →
 * `routeThroughPlaces` → `applyRuns` → `snapToLine`), with the ride's
 * retraced km and the out-and-back each stop is reached by.
 *
 * `BROUTER_BASE_URL=http://localhost:17777 npx tsx scripts/measure-edit-through.ts <ride.gpx>`
 *
 * The GPX must carry the ride's `<wpt>`s: start, two stops, finish (Mopik's
 * own export does). Measured on the rider's 2026-09-25 ride (109 km, stop 2
 * the tip of a 650 m out-and-back), before this change → after:
 *   A stop added on stop 2's spur   stop 2 650 m → 10 m, retraced 7.4 → 7.2 km
 *   stop 1 moved 50 m               stop 1 900 m → 20 m
 *   a batch of three by the spur    160 m / 160 m → ≤ 40 m
 */
import { readFileSync } from "node:fs";
import { cumulative, pointAtDistance } from "../lib/routing/detour";
import * as NEW from "../lib/routing/reroute-leg";
import { routeThroughPlaces } from "../lib/routing/through-stops";
import { fetchRoutePath } from "../lib/routing/brouter";
import { classifyRoute } from "../lib/routing/classify";
import { composeRidePlan } from "../lib/chat/compose-plan";
import { DEFAULT_PROFILE } from "../lib/chat/ride-profile";
import { planToIntent } from "../lib/chat/ride-plan";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { haversineMeters } from "../lib/geo/geometry";
type Point = [number, number];
type RoutePath = Awaited<ReturnType<typeof fetchRoutePath>>;

const gpx = readFileSync(process.argv[2], "utf8");
const line0: Point[] = [...gpx.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
const wpts = [...gpx.matchAll(/<wpt lat="([\d.]+)" lon="([\d.]+)">\s*<name>([^<]*)/g)].map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), name: m[3] }));
const place = (w: { lat: number; lon: number; name: string }) => ({ name: w.name, label: w.name, lat: w.lat, lon: w.lon });
const places0 = { start: place(wpts[0]), vias: [place(wpts[1]), place(wpts[2])], finish: place(wpts[3]), roundTrip: false };
const seg = (coords: Point[]) => ({ type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: { roadClass: "road" as const, surface: "unknown" as const, distanceMeters: 0 }, geometry: { type: "LineString" as const, coordinates: coords } }] });

const plan = composeRidePlan({ places: ["Taaza Cinnamon", "Cinītes 2", "Vecās piķa bedres ceļš", "Gaujaslīču iela 22"], tripType: "one_way", durationMode: "flexible", hours: 4, profile: DEFAULT_PROFILE });
const profileOptions = buildMotoProfileOptions(planToIntent(plan));

function stats(label: string, coords: Point[], places: typeof places0, ms: number) {
  const cum = cumulative(coords);
  const o = NEW.recomputeOverlap(coords);
  const anchors = NEW.anchorsOf(places, coords.at(-1)!);
  const along = NEW.anchorsAlong(anchors, coords, cum);
  const spurs = places.vias.map((v, i) => `${v.name.slice(0, 14)}:${NEW.spurLength(coords, cum, along[i + 1], 10)}m`);
  console.log(`${label.padEnd(34)} ${(cum.at(-1)! / 1000).toFixed(2)} km  retraced ${o.repeatedKm} km (${o.repeatedPercent} %)  spurs ${spurs.join("  ")}  ${ms} ms`);
}

async function edit(label: string, before: typeof places0, after: typeof places0, line: Point[]) {
  const results: Record<string, { coords: Point[]; places: typeof places0 }> = {};
  for (const which of ["new"] as const) {
    const M = NEW;
    const planned = M.planEdit({ line, cum: cumulative(line), before, after });
    if (!planned || "error" in planned) { console.log(label, which, "no plan", planned); continue; }
    const t0 = Date.now();
    const routed = await Promise.all(planned.runs.map(async (run) => {
      const loop = run.points.length >= 3;
      const path = (loop ? (await routeThroughPlaces({ points: run.points, shapes: NEW.shapeFlags(run, planned.places), profileOptions, deadlineAt: Date.now() + 4500 })).path
          : await fetchRoutePath({ points: run.points, profileOptions, generatedViaIndices: [], pinnedEnds: true }));
      const c = classifyRoute(path);
      return { segments: c.segments, distanceMeters: path.distanceMeters, durationSeconds: c.durationSeconds };
    }));
    const ms = Date.now() - t0;
    const spliced = M.applyRuns({ segments: seg(line), distanceMeters: 0, durationSeconds: 0, runs: planned.runs, routed: routed as never });
    const snapped = M.snapToLine({ line: spliced.coordinates, before, after: planned.places, maxMoveMeters: 300 });
    const pl = "error" in snapped ? planned.places : snapped.places;
    console.log(`  ${which}: runs ${planned.runs.map((r) => `${(r.fromMeters / 1000).toFixed(2)}–${(r.toMeters / 1000).toFixed(2)} (${r.points.length} pts)`).join(", ")}`);
    stats(`  ${label} [${which}]`, spliced.coordinates, pl as typeof places0, ms);
    results[which] = { coords: spliced.coordinates, places: pl as typeof places0 };
  }
  return results;
}

async function main() {
  stats("generated (GPX)", line0, places0, 0);
  const cum = cumulative(line0);
  const along = NEW.anchorsAlong(NEW.anchorsOf(places0, line0.at(-1)!), line0, cum);
  // A: a stop on stop 2's spur, 300 m before its tip (the rider's 4/5 pair).
  const onSpur = pointAtDistance(line0, cum, along[2] - 300).point;
  const stopA = { name: "Uz atzara", label: "Uz atzara", lat: onSpur[1], lon: onSpur[0] };
  const A = { ...places0, vias: [places0.vias[0], stopA, places0.vias[1]] };
  await edit("A: stop on stop 2's spur", places0, A, line0);
  // B: a stop 1.2 km before the spur's junction, beside the line (40 m off).
  const nearJ = pointAtDistance(line0, cum, along[2] - 600 - 1200).point;
  const stopB = { name: "Pirms atzara", label: "Pirms atzara", lat: nearJ[1] + 0.00035, lon: nearJ[0] };
  await edit("B: stop before the spur", places0, { ...places0, vias: [places0.vias[0], stopB, places0.vias[1]] }, line0);
  // C: stop 2 moved 60 m (the rider trying to move it).
  const moved = { ...places0.vias[1], lat: places0.vias[1].lat + 0.0005 };
  await edit("C: stop 2 moved 55 m", places0, { ...places0, vias: [places0.vias[0], moved] }, line0);
  // D: stop 1 moved 50 m.
  const moved1 = { ...places0.vias[0], lon: places0.vias[0].lon + 0.0008 };
  await edit("D: stop 1 moved 50 m", places0, { ...places0, vias: [moved1, places0.vias[1]] }, line0);
  // E: a batch — two stops on the spur and one before it.
  const onSpur2 = pointAtDistance(line0, cum, along[2] - 150).point;
  const E = { ...places0, vias: [places0.vias[0], stopB, stopA, { name: "Atzars 2", label: "Atzars 2", lat: onSpur2[1], lon: onSpur2[0] }, places0.vias[1]] };
  await edit("E: batch of three", places0, E, line0);
}
main().catch((e) => { console.error(e); process.exit(1); });
