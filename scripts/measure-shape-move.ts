/**
 * A pass-through point moved on a rider's own GPX, routed the way the edit
 * page routes it (planEdit → routeThroughPlaces, own profile, then keepSpurs).
 *
 * `set -a; . ./.env.local; set +a; npx tsx scripts/measure-shape-move.ts <ride.gpx> <fromLat> <fromLon> <toLat> <toLon>`
 */
import { readFileSync } from "node:fs";
import type { Point } from "../lib/geo/geometry";
import { cumulative, lineMeters, pointAtDistance } from "../lib/routing/detour";
import { nearestAlong, planEdit, shapeFlags, outAndBacks, widenRun, anchorsAlong, anchorsOf, WIDEN_STEPS_M, type RidePlaces } from "../lib/routing/reroute-leg";
import { routeThroughPlaces } from "../lib/routing/through-stops";
import { composeRidePlan } from "../lib/chat/compose-plan";
import { DEFAULT_PROFILE } from "../lib/chat/ride-profile";
import { planToIntent } from "../lib/chat/ride-plan";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";

async function main() {
  const [file, fLat, fLon, tLat, tLon] = process.argv.slice(2);
  const gpx = readFileSync(file, "utf8");
  const line: Point[] = [...gpx.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
  const wpts = [...gpx.matchAll(/<wpt lat="([\d.]+)" lon="([\d.]+)">\s*<name>([^<]*)/g)].map((m) => ({ lat: Number(m[1]), lon: Number(m[2]), name: m[3] }));
  const cum = cumulative(line);
  const on = pointAtDistance(line, cum, nearestAlong([Number(fLon), Number(fLat)], line, cum).alongMeters).point;
  const place = (w: { lat: number; lon: number; name: string }) => ({ name: w.name, label: w.name, lat: w.lat, lon: w.lon });
  const before: RidePlaces = { start: place(wpts[0]), finish: place(wpts[1]), roundTrip: false, vias: [{ name: "", label: "", lat: on[1], lon: on[0], shape: true }] };
  const after: RidePlaces = { ...before, vias: [{ ...before.vias[0], lat: Number(tLat), lon: Number(tLon) }] };
  const planned = planEdit({ line, cum, before, after });
  if (!planned || "error" in planned) { console.log("no plan", planned); return; }
  console.log("kind", planned.kind, "runs", planned.runs.map((r) => ({ from: Math.round(r.fromMeters), to: Math.round(r.toMeters), pts: r.points.map(([x, y]) => `${y.toFixed(5)},${x.toFixed(5)}`) })));
  const plan = composeRidePlan({ places: ["Lauriņi", "Ērgļi"], tripType: "one_way", durationMode: "flexible", hours: 4, profile: DEFAULT_PROFILE });
  const profileOptions = buildMotoProfileOptions(planToIntent(plan));
  const widen = Number(process.env.WIDEN ?? 0);
  if (widen) { // manual widening, to measure by hand
    const r0 = planned.runs[0];
    const from = Math.max(0, r0.fromMeters - widen), to = Math.min(cum[cum.length - 1], r0.toMeters + widen);
    planned.runs[0] = { fromMeters: from, toMeters: to, points: [pointAtDistance(line, cum, from).point as Point, ...r0.points.slice(1, -1), pointAtDistance(line, cum, to).point as Point] };
  }
  for (const keepShapeSpurs of [false, true]) {
    const t = Date.now();
    const r = await routeThroughPlaces({ points: planned.runs[0].points, shapes: shapeFlags(planned.runs[0], planned.places), profileOptions, deadlineAt: Date.now() + 4500, keepShapeSpurs });
    const c = r.path.coordinates as Point[];
    const drop: Point = [Number(tLon), Number(tLat)];
    console.log(`keepSpurs=${keepShapeSpurs}: ${(r.path.distanceMeters / 1000).toFixed(2)} km (window ${((planned.runs[0].toMeters - planned.runs[0].fromMeters) / 1000).toFixed(2)} km), deadEnd ${r.deadEndMeters} unchecked ${r.deadEndUnchecked ?? false} proved ${r.deadEndProved ?? false} atShape ${r.deadEndAtShape ?? false}, drop→line ${Math.round(nearestAlong(drop, c, cumulative(c)).meters)} m, spurs ${JSON.stringify(outAndBacks(c).map((o) => Math.round(o.meters)))}, ${Date.now() - t} ms`);
  }
  // What the page does next (release B): wider stretches, ridden through.
  const keptAlong = anchorsAlong(anchorsOf(before, line[line.length - 1]), line, cum);
  for (const by of WIDEN_STEPS_M) {
    const run = widenRun({ run: planned.runs[0], line, cum, keptAlong, by });
    if (!run) { console.log(`widen ${by}: cannot`); continue; }
    const r = await routeThroughPlaces({ points: run.points, shapes: shapeFlags(run, planned.places), profileOptions, deadlineAt: Date.now() + 4500 });
    const c = r.path.coordinates as Point[];
    const old = run.toMeters - run.fromMeters;
    console.log(`widen ${by}: stretch ${(old / 1000).toFixed(1)} → ${(r.path.distanceMeters / 1000).toFixed(1)} km, ride ${((cum[cum.length - 1] - old + r.path.distanceMeters) / 1000).toFixed(1)} km, deadEnd ${r.deadEndMeters} proved ${r.deadEndProved ?? false}, drop→line ${Math.round(nearestAlong([Number(tLon), Number(tLat)], c, cumulative(c)).meters)} m`);
  }
  void lineMeters;
}
void main();
