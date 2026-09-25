/**
 * An added stop that the edit turns into an out-and-back spur — measured on a
 * rider's own GPX, and the loop search that replaces it.
 *
 * `set -a; . ./.env.local; set +a; npx tsx scripts/measure-edit-loop.ts <ride.gpx> <lat> <lon>`
 *
 * 1. Finds the stop's spur in the exported ride: the run of mirrored vertices
 *    either side of the point nearest the stop, and what the road there is.
 * 2. Rebuilds the ride as it was before the stop (the spur cut out), puts the
 *    edit's window around the stop exactly as `planEdit` would, and routes it
 *    both ways: the old single request, and the loop search
 *    `/api/reroute-leg` now runs. Prints km, retraced km/% over the whole
 *    ride, the spur and the wall-clock time of each.
 */
import { readFileSync } from "node:fs";
import { haversineMeters, type Point } from "../lib/geo/geometry";
import { cumulative, lineMeters, pointAtDistance } from "../lib/routing/detour";
import {
  EDIT_WINDOW_M,
  WINDOW_PER_METRE_MOVED,
  LOOP_SHARED_MIN_M,
  chooseLoop,
  nearestAlong,
  nogosAlong,
  recomputeOverlap,
  sharedRoad,
} from "../lib/routing/reroute-leg";
import { fetchRouteAvoiding, fetchRoutePath } from "../lib/routing/brouter";
import { composeRidePlan } from "../lib/chat/compose-plan";
import { DEFAULT_PROFILE } from "../lib/chat/ride-profile";
import { planToIntent } from "../lib/chat/ride-plan";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";

async function main() {
const [file, latS, lonS] = process.argv.slice(2);
const stop: Point = [Number(lonS), Number(latS)];
const gpx = readFileSync(file, "utf8");
const line: Point[] = [...gpx.matchAll(/<trkpt lat="([\d.]+)" lon="([\d.]+)"/g)].map((m) => [Number(m[2]), Number(m[1])]);
const km = (m: number) => (m / 1000).toFixed(2);

const cum = cumulative(line);
const near = nearestAlong(stop, line, cum);
let k = 0;
for (let i = 1; i < cum.length; i++) if (Math.abs(cum[i] - near.alongMeters) < Math.abs(cum[k] - near.alongMeters)) k = i;
let w = 0;
while (k - w - 1 >= 0 && k + w + 1 < line.length && haversineMeters(line[k - w - 1], line[k + w + 1]) < 5) w++;
const spurM = cum[k] - cum[k - w];
const o0 = recomputeOverlap(line);
console.log(`ride: ${line.length} pts, ${km(lineMeters(line))} km, retraced ${o0.repeatedKm} km = ${o0.repeatedPercent} %`);
console.log(`stop ${Math.round(near.meters)} m from the line; mirrored ${w} vertices each side = spur ${km(spurM)} km one way`);

const junction = line[k - w];
const pre: Point[] = [...line.slice(0, k - w + 1), ...line.slice(k + w + 1)];
const preCum = cumulative(pre);
const at = (m: number) => pointAtDistance(pre, preCum, m).point;
const n = nearestAlong(stop, pre, preCum);
const W = Math.max(EDIT_WINDOW_M, n.meters * WINDOW_PER_METRE_MOVED);
const from = Math.max(0, n.alongMeters - W);
const to = Math.min(preCum[preCum.length - 1], n.alongMeters + W);
const P = at(from);
const Q = at(to);
console.log(`before the stop: ${km(lineMeters(pre))} km; stop ${Math.round(n.meters)} m off it; window ${km(from)}–${km(to)} km`);
console.log(`run points: ${JSON.stringify([P, stop, Q].map(([lon, lat]) => ({ lat, lon })))}`);

const plan = composeRidePlan({ places: ["Rīga", "Vasara 46", "Annužas 1"], tripType: "one_way", durationMode: "flexible", hours: 4, profile: DEFAULT_PROFILE });
const profileOptions = buildMotoProfileOptions(planToIntent(plan));

// What the spur road is.
const spur = await fetchRoutePath({ points: [junction, stop], profileOptions, generatedViaIndices: [] });
const tags = new Map<string, number>();
for (const e of spur.edges) {
  const t = e.tags ?? {};
  const key = [t.highway, t.surface, t.tracktype, t.access, t.motor_vehicle, t.name].filter(Boolean).join(" / ");
  tags.set(key, (tags.get(key) ?? 0) + (e.lengthKm ?? 0));
}
console.log(`the spur road (junction → stop, ${km(spur.distanceMeters)} km):`);
for (const [k2, v] of tags) console.log(`   ${v.toFixed(2)} km  ${k2}`);

const splice = (run: Point[]) => [...pre.slice(0, pointAtDistance(pre, preCum, from).index), ...run, ...pre.slice(pointAtDistance(pre, preCum, to).index)];
const report = (label: string, run: Point[], ms: number) => {
  const whole = splice(run);
  const o = recomputeOverlap(whole);
  console.log(`${label}: ride ${km(lineMeters(whole))} km, retraced ${o.repeatedKm} km = ${o.repeatedPercent} %, stretch ${km(lineMeters(run))} km, ${ms} ms`);
};

// Old: one request through the stop.
let t = performance.now();
const old = await fetchRoutePath({ points: [P, stop, Q], profileOptions, generatedViaIndices: [] });
report("OLD  one request      ", old.coordinates, Math.round(performance.now() - t));

// New: both halves, measured; fenced variants when they share the road.
t = performance.now();
const [approach, departure] = await Promise.all([
  fetchRoutePath({ points: [P, stop], profileOptions, generatedViaIndices: [] }),
  fetchRoutePath({ points: [stop, Q], profileOptions, generatedViaIndices: [] }),
]);
const shared = sharedRoad(approach.coordinates, departure.coordinates);
console.log(`halves share ${km(shared.meters)} km (threshold ${LOOP_SHARED_MIN_M} m)`);
const nogos = nogosAlong(shared.points, [stop, P, Q]);
const [dep2, app2] = await Promise.all([
  fetchRouteAvoiding({ points: [stop, Q], profileOptions, nogos }).catch((e) => { console.log("  fenced departure refused:", String(e).slice(0, 100)); return null; }),
  fetchRouteAvoiding({ points: [P, stop], profileOptions, nogos }).catch((e) => { console.log("  fenced approach refused:", String(e).slice(0, 100)); return null; }),
]);
const pair = (a: typeof approach, d: typeof departure) => ({ approach: { coordinates: a.coordinates, distanceMeters: a.distanceMeters }, departure: { coordinates: d.coordinates, distanceMeters: d.distanceMeters } });
const base = pair(approach, departure);
const variants = [dep2 ? pair(approach, dep2) : null, app2 ? pair(app2, departure) : null];
variants.forEach((v, i) => v && console.log(`  variant ${i}: ${km(v.approach.distanceMeters + v.departure.distanceMeters)} km, shares ${km(sharedRoad(v.approach.coordinates, v.departure.coordinates).meters)} km (base ${km(base.approach.distanceMeters + base.departure.distanceMeters)} km), nogos ${nogos.length}`));
const choice = chooseLoop(base, variants);
const ms = Math.round(performance.now() - t);
const run = [...choice.pair.approach.coordinates, ...choice.pair.departure.coordinates.slice(1)];
report(`NEW  loop search (#${choice.index})`, run, ms);
console.log(`kept pair still shares ${km(choice.sharedMeters)} km`);
}

void main();
