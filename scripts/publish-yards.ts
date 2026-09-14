/**
 * `data/yards-<CC>.geojson` → `public/yards/<CC>.geojson` + `public/yards/index.json`.
 *
 * The build script (`scripts/build_yard_dataset.py`) writes one file per country
 * into `data/`, which is not served and not in the function bundle. This copies
 * whichever countries exist right now into `public/yards/`, minified, and writes
 * the index `lib/geo/yards.ts` reads to decide what to load.
 *
 *   npx tsx scripts/publish-yards.ts
 *
 * Idempotent and incremental, for the same reason `publish-poi.ts` is: the
 * Europe pass runs for hours and drops a country at a time, so re-running after
 * each one publishes what has landed and leaves the rest alone. There is no
 * "all countries" precondition anywhere.
 *
 * ## The index carries cells, mirroring the POI index
 *
 * Same shape as `public/poi/index.json` on purpose — a per-country bounding box
 * is a poor loading key (`publish-poi.ts` has the measurements; a Latvian ride
 * near Sigulda parsed all three Baltic files at 1° cells). The set of occupied
 * 0.25° cells is exact in both directions: no point is missed, and no file is
 * opened for a ride it cannot serve.
 *
 * Yards need no `placeCells` counterpart. The POI index splits those because a
 * `route=ferry` centroid sits in open water and made the southern Baltic look
 * covered; a yard point is a building, a gate or a yard ring, always on land and
 * always beside a real track, so every occupied cell is a covered cell.
 *
 * ## The files are packed arrays, not GeoJSON
 *
 * Measured on Latvia: 248,488 buildings and 13,529 gates are 42.9 MB as minified
 * GeoJSON features and **5.4 MB** as `[lon, lat, nearHighway]` triples. The
 * per-feature `type`/`geometry`/`properties` scaffolding is eight times the
 * payload, and `lib/geo/yards.ts` parses this on a cold serverless invocation.
 * So this script copies the build's own packed form through unchanged rather
 * than re-wrapping it.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const IN_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "public", "yards");

/**
 * Cell size of the coverage index, in degrees.
 *
 * 0.25°, matching `publish-poi.ts` and its measurements — ~28 km by ~15 km at
 * Baltic latitudes. Must stay in step with `INDEX_CELL_DEGREES` in
 * `lib/geo/yards.ts`; the loader checks `version`, not the number, so change
 * both together and bump it.
 */
const INDEX_CELL_DEGREES = 0.25;

export type YardCountryIndexEntry = {
  cc: string;
  count: number;
  buildings: number;
  gates: number;
  yards: number;
  /** envelope of every point, for anything that wants a box cheaply */
  bbox: [number, number, number, number];
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

export type YardIndex = {
  /** bumped when the file layout or the cell size changes */
  version: 1;
  source: "geofabrik";
  cellDegrees: number;
  /** the radius the dataset was built at, so a mismatch is visible */
  nearMeters: number;
  countries: YardCountryIndexEntry[];
};

type YardFile = {
  country?: string;
  nearMeters?: number;
  /** [lon, lat, 0 = near a track | 1 = near a service way] */
  buildings?: [number, number, number][];
  gates?: [number, number, number][];
  yards?: { landuse: string; buildings: number; ring: [number, number][] }[];
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function publish(inDir = IN_DIR, outDir = OUT_DIR): YardIndex {
  const files = fs.existsSync(inDir)
    ? fs
        .readdirSync(inDir)
        .filter((f) => /^yards-[A-Z]{2}\.geojson$/.test(f))
        .sort()
    : [];

  if (!files.length) {
    throw new Error(
      `No data/yards-<CC>.geojson files in ${inDir} — run scripts/build_yard_dataset.py first.`
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  const countries: YardCountryIndexEntry[] = [];
  const rows: string[][] = [];
  let nearMeters = 25;

  for (const file of files) {
    const cc = file.slice(6, 8);
    const src = path.join(inDir, file);
    const raw = fs.readFileSync(src, "utf-8");
    const fc = JSON.parse(raw) as YardFile;
    if (typeof fc.nearMeters === "number") nearMeters = fc.nearMeters;

    const cellSet = new Set<string>();
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;

    const see = (lon: number, lat: number) => {
      cellSet.add(
        `${Math.floor(lon / INDEX_CELL_DEGREES)},${Math.floor(lat / INDEX_CELL_DEGREES)}`
      );
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    };

    const buildings = fc.buildings?.length ?? 0;
    const gates = fc.gates?.length ?? 0;
    const yards = fc.yards?.length ?? 0;
    for (const [lon, lat] of fc.buildings ?? []) see(lon, lat);
    for (const [lon, lat] of fc.gates ?? []) see(lon, lat);
    // Every cell a ring touches, not only its centroid's — a yard straddling a
    // cell boundary must be loadable from either side.
    for (const y of fc.yards ?? []) for (const [lon, lat] of y.ring ?? []) see(lon, lat);

    const cells = [...cellSet].sort();
    const count = buildings + gates + yards;
    const bbox: [number, number, number, number] = [
      round6(minLon),
      round6(minLat),
      round6(maxLon),
      round6(maxLat),
    ];

    // The build already writes the packed form with no whitespace; this is a
    // re-serialisation rather than a transform, so the published bytes stay the
    // authority on what the loader sees.
    const out = path.join(outDir, `${cc}.geojson`);
    const minified = JSON.stringify(fc);
    fs.writeFileSync(out, minified);
    const bytes = Buffer.byteLength(minified);

    countries.push({
      cc,
      count,
      buildings,
      gates,
      yards,
      bbox,
      cells,
      builtAt: fs.statSync(src).mtime.toISOString(),
      bytes,
    });

    rows.push([
      cc,
      String(count),
      String(buildings),
      String(gates),
      String(yards),
      `${(bytes / 1024 / 1024).toFixed(2)} MB`,
      String(cells.length),
      `${bbox[0].toFixed(2)},${bbox[1].toFixed(2)} → ${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}`,
    ]);
  }

  const index: YardIndex = {
    version: 1,
    source: "geofabrik",
    cellDegrees: INDEX_CELL_DEGREES,
    nearMeters,
    countries,
  };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));

  const header = ["cc", "features", "buildings", "gates", "yards", "published", "cells", "bbox"];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));

  const total = countries.reduce((n, c) => n + c.count, 0);
  const totalBytes = countries.reduce((n, c) => n + c.bytes, 0);
  const indexBytes = fs.statSync(path.join(outDir, "index.json")).size;
  console.log(
    `\n${countries.length} countries, ${total.toLocaleString()} yard points, ` +
      `${(totalBytes / 1024 / 1024).toFixed(2)} MB in public/yards/, ` +
      `index.json ${(indexBytes / 1024).toFixed(1)} KB, radius ${nearMeters} m`
  );

  return index;
}

// `tsx scripts/publish-yards.ts` runs it; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]).includes("publish-yards")) {
  publish();
}
