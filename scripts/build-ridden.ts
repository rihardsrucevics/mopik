/**
 * Roads the rider has ridden → one GeoJSON per consumer.
 *
 * Backlog item 6, first concrete step. The rider handed over GPX of roads he
 * has ridden and said every road in them is rideable; this turns that claim
 * into a reference layer the planner can read. It is deliberately **global**,
 * shaped exactly like TET (`scripts/build-tet.ts`), not per-rider history: one
 * rider's knowledge that a forest track is passable is worth the same to
 * everyone planning through it.
 *
 * Sources live in `data/ridden-gpx/`, outside `public/` and outside git — the
 * same rule TET's sources follow, for the same reason: they are the rider's
 * own files, and the built output is what the app reads. Outputs:
 *
 *   public/ridden.geojson         — the router's reference layer, 12 m
 *   public/ridden/<CC>.geojson    — per country, 25 m, with index.json
 *
 * ## Two kinds of source file, and only one of them is geometry
 *
 * A recorded `<trk>` is a line the rider's GPS actually drew, so it is used
 * as-is. A planned `<rte>` is not: `riga-papisilla-2025-08-28.gpx` is 122
 * rtept over 188 km — points ~1.5 km apart, with nothing between them. Drawing
 * that line would claim as "ridden" a great deal of ground nobody rode,
 * including whatever lies under the straight chords across it.
 *
 * So a route is **snapped**: every consecutive pair of rtept is routed through
 * BRouter and the returned geometry is what gets stored. Measured fidelity
 * (`rtept → snapped line`, which is the question "did the snap stay on the
 * roads the rider picked"):
 *
 *   riga-papisilla  117 rtept  median 1 m, p90 4 m, max 10 m,  0 beyond 50 m
 *   sigulda-riga     57 rtept  median 1 m, p90 8 m, max 93 m,  1 beyond 50 m
 *
 * ## Why `trekking` and not `car-fast`
 *
 * Measured on sigulda-riga, both profiles, same rtepts. `trekking` returned
 * 105.3 km against an 85.6 km straight chain and kept the 11.6 km of
 * `highway=track` the rider rode. `car-fast` returned 131.6 km, ten legs
 * detouring over 2x, and **0 km of track** — it refuses the unpaved ways that
 * are the whole reason an adventure rider's line is interesting. Snapping with
 * a car profile would have quietly deleted the most valuable part of the data.
 *
 * `trekking`'s own cost is that it is a bicycle profile: it will take a
 * cycleway or footway where a motorcycle may not. Those are dropped below
 * rather than stored, because this layer's claim is "a motorcycle rode here".
 *
 * Run: npx tsx scripts/build-ridden.ts   (needs BROUTER_BASE_URL/BROUTER_TOKEN)
 */
import fs from "fs";
import path from "path";
import { simplifyIndices } from "../lib/share/route-code";
import { haversineMeters, type Point } from "../lib/geo/geometry";

/** Metres of detour a point may cut before it is dropped. Mirrors TET. */
const ROUTER_TOLERANCE_M = 12;
/** The overlay only has to look right at map zooms, not carry a route. */
const MAP_TOLERANCE_M = 25;

/** The stock BRouter profile used to snap planned routes — see the header. */
const SNAP_PROFILE = "trekking";

/**
 * A snapped leg this much longer than the rider's own straight line, and this
 * much longer in absolute terms, is not the road he took.
 *
 * Both bounds are needed. A ratio alone condemns every short leg — a 400 m gap
 * around a roundabout legitimately routes 800 m — and an absolute alone
 * condemns nothing on a 10 km leg. Measured on the two routes, the legs this
 * rejects are exactly the artefacts: papisilla leg 58 routed 17.27 km for a
 * 1.42 km gap (x12.1), and sigulda legs 30 and 37 came back with
 * `reversedirection=yes` on their first half — BRouter riding out and back
 * along one way because the two rtepts straddle a divided road or sit on a
 * dead-end spur. Nothing legitimate was lost at these numbers.
 */
const MAX_LEG_RATIO = 2.5;
const MAX_LEG_EXCESS_M = 1500;

/**
 * Ways a motorcycle may not ride, dropped from a snapped line.
 *
 * `trekking` is a bicycle profile and will happily route a cycleway. Storing
 * one as "ridden" would be a lie of exactly the kind this layer exists to
 * prevent — and worse than a plain omission, because the verified-access rule
 * in `lib/routing/classify.ts` reads this layer as evidence.
 */
const NOT_RIDEABLE = new Set(["cycleway", "footway", "steps", "bridleway", "pedestrian", "corridor"]);

/** ISO country by the bbox a section falls in. Only what the sources cover. */
const COUNTRY_BOXES: { code: string; bbox: [number, number, number, number] }[] = [
  { code: "EE", bbox: [21.5, 57.5, 28.3, 59.8] },
  { code: "LV", bbox: [20.9, 55.6, 28.3, 58.1] },
  { code: "LT", bbox: [20.9, 53.8, 26.9, 56.5] },
];

type Source = {
  file: string;
  /** What the rider calls this ride; becomes the section name. */
  name: string;
};

type Section = { name: string; country: string; points: Point[] };

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Every `<trkpt>`/`<rtept>` in order. Same minimal reading as build-tet.ts. */
function readPoints(xml: string, tag: "trkpt" | "rtept"): Point[] {
  const pts: Point[] = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const lat = Number(/lat="([-\d.]+)"/.exec(m[1])?.[1]);
    const lon = Number(/lon="([-\d.]+)"/.exec(m[1])?.[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) pts.push([lon, lat]);
  }
  // Garmin exports repeat a point where two route legs meet, and BRouter
  // refuses a zero-length leg outright.
  return pts.filter((p, i) => i === 0 || haversineMeters(pts[i - 1], p) > 1);
}

function lengthKm(points: Point[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return m / 1000;
}

function countryOf(points: Point[]): string {
  // The midpoint decides, so a ride that crosses a border is filed where most
  // of it lies rather than by whichever end happens to come first.
  const mid = points[Math.floor(points.length / 2)];
  const hit = COUNTRY_BOXES.find(
    (c) => mid[0] >= c.bbox[0] && mid[0] <= c.bbox[2] && mid[1] >= c.bbox[1] && mid[1] <= c.bbox[3]
  );
  return hit?.code ?? "XX";
}

type Leg = { coordinates: Point[]; ways: { km: number; tags: Record<string, string> }[] };

function baseUrl(): string {
  const url = (process.env.BROUTER_BASE_URL ?? "").trim();
  if (!url) throw new Error("BROUTER_BASE_URL is not set — snapping a planned route needs the router");
  return url.replace(/\/$/, "");
}

function authHeaders(): Record<string, string> {
  const token = (process.env.BROUTER_TOKEN ?? "").trim();
  return token ? { "X-Mopik-Token": token } : {};
}

/** One rtept→rtept leg through BRouter, with its per-way tags. */
async function routeLeg(a: Point, b: Point): Promise<Leg | null> {
  const lonlats = `${a[0].toFixed(6)},${a[1].toFixed(6)}|${b[0].toFixed(6)},${b[1].toFixed(6)}`;
  const url = `${baseUrl()}/brouter?lonlats=${lonlats}&profile=${SNAP_PROFILE}&alternativeidx=0&format=geojson`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: authHeaders() });
      const text = await res.text();
      // BRouter answers errors as plain text and throttling as HTML; both
      // would otherwise die in JSON.parse with a useless message.
      if (!res.ok || !text.trimStart().startsWith("{")) {
        if (attempt === 2) {
          console.warn(`    leg refused (${res.status}): ${text.trim().slice(0, 120)}`);
          return null;
        }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      const feature = JSON.parse(text).features?.[0];
      if (!feature) return null;
      const coordinates: Point[] = feature.geometry.coordinates.map((c: number[]) => [c[0], c[1]]);
      // `messages` is a table whose first row is its own header; the columns
      // move between BRouter versions, so they are read by name.
      const messages: string[][] = feature.properties?.messages ?? [];
      const header = messages[0] ?? [];
      const iDistance = header.indexOf("Distance");
      const iTags = header.indexOf("WayTags");
      const ways = messages.slice(1).map((row) => {
        const tags: Record<string, string> = {};
        for (const pair of (iTags >= 0 ? row[iTags] ?? "" : "").split(/\s+/)) {
          const [k, v] = pair.split("=");
          if (k && v) tags[k] = v;
        }
        return { km: (iDistance >= 0 ? Number(row[iDistance]) : 0) / 1000, tags };
      });
      return { coordinates, ways };
    } catch (error) {
      if (attempt === 2) {
        console.warn("    leg error:", error);
        return null;
      }
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    }
  }
  return null;
}

type SnapReport = {
  km: number;
  legs: number;
  dropped: number;
  failed: number;
  /**
   * rtept → snapped line distances, the fidelity check the brief asked for.
   *
   * Only the rtepts whose own leg was kept. An rtept either side of a dropped
   * leg is metres from nothing by construction — measuring it would report the
   * size of the gap, which `dropped` already says, and drown the number that
   * matters: whether the geometry we *did* store sits on the roads he picked.
   */
  offsets: number[];
  tagKm: Map<string, number>;
  unrideableKm: number;
};

/**
 * Snap a planned route onto real roads.
 *
 * Returns one or more sections: a dropped leg **splits** the line rather than
 * being bridged, because a straight chord across a rejected leg is precisely
 * the invented geometry this whole function exists to avoid.
 */
async function snapRoute(rtepts: Point[]): Promise<{ sections: Point[][]; report: SnapReport }> {
  const sections: Point[][] = [];
  let current: Point[] = [];
  const report: SnapReport = {
    km: 0, legs: 0, dropped: 0, failed: 0, offsets: [], tagKm: new Map(), unrideableKm: 0,
  };

  // Which rtepts ended up on stored geometry; see `offsets`.
  const kept = new Set<number>();

  for (let i = 1; i < rtepts.length; i++) {
    const leg = await routeLeg(rtepts[i - 1], rtepts[i]);
    report.legs++;
    if (!leg || leg.coordinates.length < 2) {
      report.failed++;
      if (current.length > 1) sections.push(current);
      current = [];
      continue;
    }

    const straight = haversineMeters(rtepts[i - 1], rtepts[i]);
    const routed = lengthKm(leg.coordinates) * 1000;
    if (routed > straight * MAX_LEG_RATIO && routed - straight > MAX_LEG_EXCESS_M) {
      report.dropped++;
      console.log(
        `    dropped leg ${i}: straight ${(straight / 1000).toFixed(2)} km, routed ${(routed / 1000).toFixed(2)} km (x${(routed / straight).toFixed(1)})`
      );
      if (current.length > 1) sections.push(current);
      current = [];
      continue;
    }

    // A leg that rides ground a motorcycle may not is not stored. It also ends
    // the section: what lies on the far side of a cycleway link may be real,
    // but the link itself must not be drawn.
    const unrideable = leg.ways
      .filter((w) => NOT_RIDEABLE.has(w.tags.highway ?? ""))
      .reduce((sum, w) => sum + w.km, 0);
    for (const way of leg.ways) {
      const hw = way.tags.highway ?? "(none)";
      report.tagKm.set(hw, (report.tagKm.get(hw) ?? 0) + way.km);
    }
    if (unrideable > 0.05) {
      report.unrideableKm += unrideable;
      if (current.length > 1) sections.push(current);
      current = [];
      continue;
    }

    report.km += routed / 1000;
    kept.add(i - 1);
    kept.add(i);
    const coords = current.length && haversineMeters(current[current.length - 1], leg.coordinates[0]) < 5
      ? leg.coordinates.slice(1)
      : leg.coordinates;
    current.push(...coords);
  }
  if (current.length > 1) sections.push(current);

  const stored = sections.flat();
  for (const i of [...kept].sort((a, b) => a - b)) {
    let best = Infinity;
    for (const q of stored) best = Math.min(best, haversineMeters(rtepts[i], q));
    if (Number.isFinite(best)) report.offsets.push(best);
  }
  return { sections, report };
}

function simplify(points: Point[], toleranceM: number): Point[] {
  return simplifyIndices(points, toleranceM).map((i) => points[i]);
}

function round(points: Point[]): Point[] {
  // 5 decimals is ~1 m — finer than the matching tolerance, half the bytes.
  return points.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))] as Point);
}

async function build() {
  const dir = path.join(process.cwd(), "data", "ridden-gpx");
  if (!fs.existsSync(dir)) {
    throw new Error(`${dir} is missing — the rider's GPX are git-ignored, like data/tet-gpx/`);
  }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".gpx")).sort();
  const sections: Section[] = [];

  for (const file of files) {
    const xml = fs.readFileSync(path.join(dir, file), "utf-8");
    const source: Source = { file, name: file.replace(/\.gpx$/i, "") };
    const trkpts = readPoints(xml, "trkpt");

    if (trkpts.length > 1) {
      // A recording. The line is what the GPS drew, so it is the geometry.
      console.log(`${file}: recorded track, ${trkpts.length} points, ${lengthKm(trkpts).toFixed(1)} km`);
      sections.push({ name: source.name, country: countryOf(trkpts), points: trkpts });
      continue;
    }

    const rtepts = readPoints(xml, "rtept");
    if (rtepts.length < 2) {
      console.log(`${file}: no track and no route — skipped`);
      continue;
    }
    console.log(
      `${file}: planned route, ${rtepts.length} rtept, straight chain ${lengthKm(rtepts).toFixed(1)} km — snapping through ${SNAP_PROFILE}`
    );
    const { sections: snapped, report } = await snapRoute(rtepts);
    const offsets = [...report.offsets].sort((a, b) => a - b);
    const at = (q: number) => offsets[Math.floor(offsets.length * q)] ?? 0;
    console.log(
      `  snapped ${report.km.toFixed(1)} km in ${snapped.length} section(s); ` +
      `${report.dropped} legs dropped, ${report.failed} failed, ${report.unrideableKm.toFixed(1)} km unrideable removed`
    );
    console.log(
      `  rtept → snapped line: median ${at(0.5).toFixed(0)} m, p90 ${at(0.9).toFixed(0)} m, ` +
      `max ${(offsets[offsets.length - 1] ?? 0).toFixed(0)} m; ${offsets.filter((d) => d > 50).length}/${offsets.length} beyond 50 m`
    );
    const totalTagKm = [...report.tagKm.values()].reduce((a, b) => a + b, 0) || 1;
    console.log(
      "  tag mix: " +
      [...report.tagKm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([k, v]) => `${k} ${v.toFixed(1)} km (${((v / totalTagKm) * 100).toFixed(0)}%)`).join(", ")
    );
    snapped.forEach((points, i) => {
      sections.push({
        name: snapped.length > 1 ? `${source.name}-${i + 1}` : source.name,
        country: countryOf(points),
        points,
      });
    });
  }

  if (!sections.length) throw new Error("no sections built");

  const featuresAt = (toleranceM: number, only?: string) =>
    sections
      .filter((s) => !only || s.country === only)
      .map((s) => ({
        type: "Feature" as const,
        properties: {
          name: s.name,
          country: s.country,
          lengthKm: Number(lengthKm(s.points).toFixed(1)),
        },
        geometry: { type: "LineString" as const, coordinates: round(simplify(s.points, toleranceM)) },
      }));

  const writeFc = (file: string, features: ReturnType<typeof featuresAt>) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: "FeatureCollection", features }));
    return fs.statSync(file).size;
  };

  // One file for the router, at TET's own fidelity: the coverage match works
  // to 35 m, so a coarser line would start matching quietly wrong.
  const routerFeatures = featuresAt(ROUTER_TOLERANCE_M);
  const routerBytes = writeFc(path.join(process.cwd(), "public", "ridden.geojson"), routerFeatures);
  const routerPoints = routerFeatures.reduce((n, f) => n + f.geometry.coordinates.length, 0);
  console.log(
    `\nridden.geojson: ${routerFeatures.length} sections, ${routerPoints.toLocaleString()} points, ${(routerBytes / 1024).toFixed(0)} KB`
  );

  // Per country for the map, the same shape as public/tet/.
  const dirOut = path.join(process.cwd(), "public", "ridden");
  fs.rmSync(dirOut, { recursive: true, force: true });
  const countries = [...new Set(sections.map((s) => s.country))].sort();
  const index: Record<string, { sections: number; km: number; bbox: [number, number, number, number] }> = {};
  let total = 0;
  for (const country of countries) {
    const features = featuresAt(MAP_TOLERANCE_M, country);
    total += writeFc(path.join(dirOut, `${country}.geojson`), features);
    const all = features.flatMap((f) => f.geometry.coordinates);
    index[country] = {
      sections: features.length,
      km: Number(features.reduce((n, f) => n + f.properties.lengthKm, 0).toFixed(0)),
      bbox: [
        Math.min(...all.map((c) => c[0])), Math.min(...all.map((c) => c[1])),
        Math.max(...all.map((c) => c[0])), Math.max(...all.map((c) => c[1])),
      ],
    };
  }
  // The bboxes let a map ask "which countries are on screen" without
  // downloading anything first — the same contract public/tet/index.json has.
  fs.writeFileSync(path.join(dirOut, "index.json"), JSON.stringify(index));
  console.log(
    `public/ridden/: ${countries.length} countries (${countries.join(" ")}), ${(total / 1024).toFixed(0)} KB total`
  );
  for (const [code, meta] of Object.entries(index)) {
    console.log(`  ${code}: ${meta.sections} sections, ${meta.km} km`);
  }
}

build();
