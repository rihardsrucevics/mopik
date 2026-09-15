/**
 * Item 11g diagnosis: why BRouter refuses `A → via` while `via → B` and
 * `A → B` both route, for a via that snaps onto a road 0–13 m away.
 *
 *   npx tsx scripts/probe-approach.ts
 *
 * Prints BRouter's exact status and body for each direction, the snap point
 * of a short probe in each of four bearings, and the OSM way under the snap
 * (Overpass, with a User-Agent — Node `fetch` to the mirror gets an instant
 * 429 without one).
 */
import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const eq = line.indexOf("=");
  if (eq > 0 && !line.startsWith("#")) process.env[line.slice(0, eq).trim()] ||= line.slice(eq + 1).trim();
}
import { uploadProfile } from "../lib/routing/brouter";
import { buildMotoProfileOptions } from "../lib/routing/moto-profile";
import { DEFAULT_PROFILE, profileToPlanFields } from "../lib/chat/ride-profile";
import { RouteIntentSchema } from "../lib/types";
import { haversineMeters, type Point } from "../lib/geo/geometry";

const INTENT = RouteIntentSchema.parse(profileToPlanFields(DEFAULT_PROFILE));
const OPTIONS = buildMotoProfileOptions(INTENT);

const base = process.env.BROUTER_BASE_URL!.replace(/\/$/, "");
const token = process.env.BROUTER_TOKEN;

async function raw(points: Point[], profileId: string) {
  const lonlats = points.map(([lon, lat]) => `${lon},${lat}`).join("|");
  const url = `${base}/brouter?lonlats=${encodeURIComponent(lonlats)}&profile=${encodeURIComponent(profileId)}&alternativeidx=0&format=geojson`;
  const t0 = Date.now();
  const res = await fetch(url, { headers: token ? { "X-Mopik-Token": token } : {} });
  const body = await res.text();
  const ms = Date.now() - t0;
  if (!res.ok) return { ok: false as const, status: res.status, body: body.slice(0, 300), ms };
  const data = JSON.parse(body);
  const f = data.features?.[0];
  const coords: Point[] = (f?.geometry?.coordinates ?? []).map((c: number[]) => [c[0], c[1]]);
  return { ok: true as const, status: res.status, km: Number(f?.properties?.["track-length"]) / 1000, coords, ms,
           messages: f?.properties?.messages as string[][] | undefined };
}

function offset([lon, lat]: Point, bearingDeg: number, meters: number): Point {
  const rad = (bearingDeg * Math.PI) / 180;
  return [lon + (meters * Math.sin(rad)) / (111320 * Math.cos((lat * Math.PI) / 180)),
          lat + (meters * Math.cos(rad)) / 111320];
}

async function overpassWays(point: Point) {
  const [lon, lat] = point;
  const q = `[out:json][timeout:25];way(around:25,${lat},${lon})[highway];out tags geom 40;`;
  const res = await fetch("https://overpass.private.coffee/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Mopik/1.0 (route quality diagnosis)" },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) return `overpass ${res.status}`;
  const data = (await res.json()) as { elements: { id: number; tags: Record<string,string>; geometry?: {lat:number;lon:number}[] }[] };
  return data.elements.map((w) => {
    const d = w.geometry ? Math.min(...w.geometry.map((g) => haversineMeters(point, [g.lon, g.lat]))) : NaN;
    return `  way ${w.id}  ${Math.round(d)} m  ` + Object.entries(w.tags).map(([k, v]) => `${k}=${v}`).join(" ");
  }).join("\n");
}

const CASES: { name: string; a: Point; b: Point; via: Point }[] = [
  // 11e §5: via-0.7--1 on Liepāja → Ventspils, snapped 13 m, A→via REFUSED.
  { name: "via-0.7--1 (Liepāja → Ventspils)", a: [21.0107, 56.5047], b: [21.5606, 57.3894], via: [21.421589, 56.921915] },
];

async function main() {
  const profileId = await uploadProfile(OPTIONS);
  console.log(`profile ${profileId} via ${base}\n`);

  // The 11f corridor entry at 0.35, which snaps 0 m and is refused.
  const { seawardCorridors } = await import("../lib/routing/seaward");
  for (const c of seawardCorridors([21.0107, 56.5047], [21.5606, 57.3894])) {
    CASES.push({ name: `seaCorridor entry ${c.fractions[0]}`, a: [21.0107, 56.5047], b: [21.5606, 57.3894], via: c.points[0] });
    break;
  }

  for (const { name, a, b, via } of CASES) {
    console.log(`\n=== ${name} — via ${via.join(",")} ===`);
    for (const [label, pts] of [["A→via", [a, via]], ["via→B", [via, b]], ["A→B", [a, b]], ["A→via→B", [a, via, b]]] as [string, Point[]][]) {
      const r = await raw(pts, profileId);
      console.log(`  ${label.padEnd(8)} ${r.ok ? `OK ${r.km!.toFixed(1)} km` : `REFUSED ${r.status}: ${r.body}`}  (${r.ms} ms)`);
    }
    // Which way does it snap onto, approached from each side?
    for (const bearing of [0, 90, 180, 270]) {
      const probe = offset(via, bearing, 200);
      const out = await raw([via, probe], profileId);
      const back = await raw([probe, via], profileId);
      const snapped = out.ok && out.coords.length ? out.coords[0] : null;
      console.log(`  probe ${String(bearing).padStart(3)}°  out ${out.ok ? "OK" : "REFUSED"}  back ${back.ok ? "OK" : "REFUSED"}` +
        (snapped ? `  snap ${Math.round(haversineMeters(via, snapped))} m` : ""));
    }
    // What the router says it rode, leaving the via (the way it snapped to).
    const leave = await raw([via, b], profileId);
    if (leave.ok && leave.messages) {
      const header = leave.messages[0];
      const iTags = header.indexOf("WayTags");
      console.log(`  first ways leaving the via: ` + leave.messages.slice(1, 4).map((r) => r[iTags]).join(" | "));
    }
    console.log(`  OSM ways within 25 m:\n${await overpassWays(via)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
