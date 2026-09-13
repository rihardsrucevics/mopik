/**
 * TET GPX files → one GeoJSON per consumer.
 *
 * The Trans Euro Trail is distributed as one GPX per country from
 * transeurotrail.org. The source files live in `data/tet-gpx/` — outside
 * `public/`, which is served verbatim, and outside git: 117 MB against a
 * 6.6 MB repository, and they are re-downloadable from the source. This turns
 * them into the files the app reads:
 *
 *   public/tet.geojson          — the router's reference layer, all countries
 *   public/tet/<CC>.geojson     — one file per country for the map overlay
 *
 * Split per country because of the scale, which is easy to get wrong: the TET
 * in Europe is 118,246 km against Latvia's 2,517 — 47x. One combined overlay
 * is 4.3 MB even simplified to 60 m, and simplifying it down to a phone-sized
 * file costs the shape: at 120 m the line is 1.1 points/km against the 7.1 the
 * working Latvian layer has. Per country it is ~341 KB on average, the same
 * scale that already works, and the map fetches only what is on screen.
 *
 * Run: npx tsx scripts/build-tet.ts
 */
import fs from "fs";
import path from "path";
import { simplifyIndices } from "../lib/share/route-code";
import { haversineMeters } from "../lib/geo/geometry";

type Pt = [number, number];

/** Metres of detour a point may cut before it is dropped. */
const ROUTER_TOLERANCE_M = 12;
/** The overlay only has to look right at map zooms, not carry a route. */
const MAP_TOLERANCE_M = 25;
/** A track this short is a stub or an import artefact, not a section to ride. */
const MIN_SECTION_KM = 1;

/**
 * The TET ships one file per country named by its vehicle code, which is not
 * always the ISO code a reader expects (`D` is Germany, `E` Spain, `S` Sweden).
 * The GPX `<name>` carries the readable form, so this only has to cover the
 * country code itself.
 */
const COUNTRY_BY_FILE: Record<string, string> = {
  AL: "AL", AND: "AD", B: "BE", BG: "BG", BIH: "BA", BY: "BY", CH: "CH",
  D: "DE", DK: "DK", E: "ES", EST: "EE", F: "FR", FIN: "FI", GB: "GB",
  GE: "GE", GR: "GR", H: "HU", HR: "HR", I: "IT", L: "LU", LT: "LT",
  "LV-2": "LV", LV: "LV", MD: "MD", MNE: "ME", N: "NO", NL: "NL", NMK: "MK",
  P: "PT", PL: "PL", RKS: "XK", S: "SE", SLO: "SI", SRB: "RS", TR: "TR",
};

type Track = { name: string; country: string; points: Pt[] };

/**
 * Minimal GPX reading: every `<trkpt lat lon>` in order, split per `<trk>`.
 * A full XML parser would be a dependency for two regular expressions, and
 * these files are machine-generated with a stable shape.
 */
function readGpx(file: string, country: string): Track[] {
  const xml = fs.readFileSync(file, "utf-8");
  const tracks: Track[] = [];
  for (const block of xml.split(/<trk>/).slice(1)) {
    const name = /<name>([\s\S]*?)<\/name>/.exec(block)?.[1]?.trim() ?? "";
    const points: Pt[] = [];
    // Attribute order varies between exports, so read them by name.
    const re = /<trkpt\b([^>]*)>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      const lat = Number(/lat="([-\d.]+)"/.exec(m[1])?.[1]);
      const lon = Number(/lon="([-\d.]+)"/.exec(m[1])?.[1]);
      if (Number.isFinite(lat) && Number.isFinite(lon)) points.push([lon, lat]);
    }
    if (points.length > 1) tracks.push({ name: decodeEntities(name), country, points });
  }
  return tracks;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function lengthKm(points: Pt[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += haversineMeters(points[i - 1], points[i]);
  return m / 1000;
}

function simplify(points: Pt[], toleranceM: number): Pt[] {
  const keep = simplifyIndices(points, toleranceM);
  return keep.map((i) => points[i]);
}

function round(points: Pt[]): Pt[] {
  // 5 decimals is ~1 m — finer than the 35 m matching tolerance and it halves
  // the file next to raw doubles.
  return points.map(([lon, lat]) => [Number(lon.toFixed(5)), Number(lat.toFixed(5))] as Pt);
}

function build() {
  const dir = path.join(process.cwd(), "data", "tet-gpx");
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".gpx"));

  const tracks: Track[] = [];
  const skipped: string[] = [];
  for (const file of files.sort()) {
    const stem = file.replace(/\.gpx$/i, "");
    const country = COUNTRY_BY_FILE[stem];
    if (!country) { skipped.push(`${file} (unknown country code)`); continue; }
    const found = readGpx(path.join(dir, file), country);
    const usable = found.filter((t) => lengthKm(t.points) >= MIN_SECTION_KM);
    if (!usable.length) { skipped.push(`${file} (no section over ${MIN_SECTION_KM} km)`); continue; }
    tracks.push(...usable);
  }

  // Latvia ships twice (`LV.gpx` and the newer `LV-2.gpx`); keep whichever
  // sections are actually present rather than guessing, but never both copies
  // of the same section name.
  const seen = new Set<string>();
  const unique = tracks.filter((t) => {
    const key = `${t.country}|${t.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const featuresAt = (toleranceM: number, only?: string) =>
    unique
      .filter((t) => !only || t.country === only)
      .map((t) => ({
        type: "Feature" as const,
        properties: { name: t.name, country: t.country, lengthKm: Number(lengthKm(t.points).toFixed(1)) },
        geometry: { type: "LineString" as const, coordinates: round(simplify(t.points, toleranceM)) },
      }));

  const writeFc = (file: string, features: ReturnType<typeof featuresAt>) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ type: "FeatureCollection", features }));
    return fs.statSync(file).size;
  };

  const rawPoints = unique.reduce((n, t) => n + t.points.length, 0);
  const countries = [...new Set(unique.map((t) => t.country))].sort();
  console.log(`Read ${unique.length} sections in ${countries.length} countries: ${countries.join(" ")}`);
  console.log(`Raw points: ${rawPoints.toLocaleString()}`);
  if (skipped.length) console.log(`Skipped: ${skipped.join(", ")}`);

  // One file for the router: it runs on the server, where size is cheap and
  // fidelity is what the 35 m coverage match needs.
  const routerFeatures = featuresAt(ROUTER_TOLERANCE_M);
  const routerBytes = writeFc(path.join(process.cwd(), "public", "tet.geojson"), routerFeatures);
  const routerPoints = routerFeatures.reduce((n, f) => n + f.geometry.coordinates.length, 0);
  console.log(`tet.geojson: ${routerFeatures.length} sections, ${routerPoints.toLocaleString()} points, ${(routerBytes / 1024 / 1024).toFixed(2)} MB`);

  // One per country for the map, so a phone downloads the country it is
  // looking at rather than the continent.
  const dirOut = path.join(process.cwd(), "public", "tet");
  fs.rmSync(dirOut, { recursive: true, force: true });
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
  // The bboxes let the map ask "which countries are on screen" without
  // downloading anything first.
  fs.writeFileSync(path.join(dirOut, "index.json"), JSON.stringify(index));
  console.log(`public/tet/: ${countries.length} countries, ${(total / 1024 / 1024).toFixed(2)} MB total, ${(total / countries.length / 1024).toFixed(0)} KB average`);
}

build();
