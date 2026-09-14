/**
 * `data/gates-<CC>.json` → `public/gates/<CC>.json` + `public/gates/index.json`.
 *
 * The build script (`scripts/build_gates_dataset.py`) writes one file per country
 * into `data/`, which is not served and not in the function bundle. This copies
 * whichever countries exist right now into `public/gates/`, minified, and writes
 * the index `lib/geo/gates.ts` reads to decide what to load.
 *
 *   npx tsx scripts/publish-gates.ts
 *
 * Idempotent and incremental, for the same reason `publish-poi.ts` is: a
 * Europe-wide pass runs for hours and drops a country at a time, so re-running
 * after each one publishes what has landed and leaves the rest alone. There is
 * no "all countries" precondition anywhere.
 *
 * ## The index carries cells, mirroring the POI index
 *
 * Same shape as `public/poi/index.json` on purpose — a per-country bounding box
 * is a poor loading key (`publish-poi.ts` has the measurements; a Latvian ride
 * near Sigulda parsed all three Baltic files at 1° cells). The set of occupied
 * 0.25° cells is exact in both directions: no gate is missed, and no file is
 * opened for a ride it cannot serve.
 *
 * ## The files are packed arrays, not GeoJSON
 *
 * `[lon, lat, barrierIndex, highwayIndex]`, with the two vocabularies named once
 * at the top of the file. GeoJSON's per-feature `type`/`geometry`/`properties`
 * scaffolding is several times the payload, and `lib/geo/gates.ts` parses this on
 * a cold serverless invocation. So this script copies the build's own packed form
 * through unchanged rather than re-wrapping it, and the extension is `.json`
 * because the content is not GeoJSON and should not claim to be — the predecessor
 * `public/yards/*.geojson` files did, and they were not.
 *
 * ## Backlog item 12, and what this replaced
 *
 * This is the gates-only build. Its predecessor (`publish-yards.ts`) shipped
 * 9.4 MB of building centroids and farmyard polygons so the runtime could
 * *infer* private property; the rider rejected inference outright — see
 * `lib/geo/gates.ts` for his words and the numbers behind them. What ships now
 * is one explicit OSM fact per row and nothing derived from it.
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const IN_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "public", "gates");

/**
 * Cell size of the coverage index, in degrees.
 *
 * 0.25°, matching `publish-poi.ts` and its measurements — ~28 km by ~15 km at
 * Baltic latitudes. Must stay in step with `INDEX_CELL_DEGREES` in
 * `lib/geo/gates.ts`; the loader checks `version`, not the number, so change
 * both together and bump it.
 */
const INDEX_CELL_DEGREES = 0.25;

export type GateCountryIndexEntry = {
  cc: string;
  count: number;
  /** how many of each barrier value — the build's shape, visible without the file */
  byBarrier: Record<string, number>;
  byHighway: Record<string, number>;
  /** envelope of every gate, for anything that wants a box cheaply */
  bbox: [number, number, number, number];
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  builtAt: string;
  bytes: number;
};

export type GateIndex = {
  /** bumped when the file layout or the cell size changes */
  version: 1;
  source: "geofabrik";
  cellDegrees: number;
  countries: GateCountryIndexEntry[];
};

type GateFile = {
  country?: string;
  builtAt?: string;
  barrierKinds?: string[];
  highwayKinds?: string[];
  /** [lon, lat, barrierIndex, highwayIndex] */
  gates?: [number, number, number, number][];
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function publish(inDir = IN_DIR, outDir = OUT_DIR): GateIndex {
  const files = fs.existsSync(inDir)
    ? fs
        .readdirSync(inDir)
        .filter((f) => /^gates-[A-Z]{2}\.json$/.test(f))
        .sort()
    : [];

  if (!files.length) {
    throw new Error(
      `No data/gates-<CC>.json files in ${inDir} — run scripts/build_gates_dataset.py first.`
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  const countries: GateCountryIndexEntry[] = [];
  const rows: string[][] = [];

  for (const file of files) {
    const cc = file.slice(6, 8);
    const src = path.join(inDir, file);
    const fc = JSON.parse(fs.readFileSync(src, "utf-8")) as GateFile;

    const barrierKinds = fc.barrierKinds ?? [];
    const highwayKinds = fc.highwayKinds ?? [];
    const gates = fc.gates ?? [];

    const cellSet = new Set<string>();
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    const byBarrier: Record<string, number> = {};
    const byHighway: Record<string, number> = {};

    for (const [lon, lat, b, h] of gates) {
      cellSet.add(
        `${Math.floor(lon / INDEX_CELL_DEGREES)},${Math.floor(lat / INDEX_CELL_DEGREES)}`
      );
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
      const bName = barrierKinds[b] ?? String(b);
      const hName = highwayKinds[h] ?? String(h);
      byBarrier[bName] = (byBarrier[bName] ?? 0) + 1;
      byHighway[hName] = (byHighway[hName] ?? 0) + 1;
    }

    const cells = [...cellSet].sort();
    const bbox: [number, number, number, number] = gates.length
      ? [round6(minLon), round6(minLat), round6(maxLon), round6(maxLat)]
      : [0, 0, 0, 0];

    // The build already writes the packed form with no whitespace; this is a
    // re-serialisation rather than a transform, so the published bytes stay the
    // authority on what the loader sees.
    const out = path.join(outDir, `${cc}.json`);
    const minified = JSON.stringify(fc);
    fs.writeFileSync(out, minified);
    const bytes = Buffer.byteLength(minified);

    countries.push({
      cc,
      count: gates.length,
      byBarrier,
      byHighway,
      bbox,
      cells,
      builtAt: fc.builtAt ?? fs.statSync(src).mtime.toISOString(),
      bytes,
    });

    rows.push([
      cc,
      String(gates.length),
      `${(bytes / 1024).toFixed(0)} KB`,
      String(cells.length),
      Object.entries(byBarrier)
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${k} ${n}`)
        .join(", "),
      `${bbox[0].toFixed(2)},${bbox[1].toFixed(2)} → ${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}`,
    ]);
  }

  const index: GateIndex = {
    version: 1,
    source: "geofabrik",
    cellDegrees: INDEX_CELL_DEGREES,
    countries,
  };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));

  const header = ["cc", "gates", "published", "cells", "barriers", "bbox"];
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
    `\n${countries.length} countries, ${total.toLocaleString()} gates, ` +
      `${(totalBytes / 1024).toFixed(0)} KB in public/gates/, ` +
      `index.json ${(indexBytes / 1024).toFixed(1)} KB`
  );

  return index;
}

// `tsx scripts/publish-gates.ts` runs it; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]).includes("publish-gates")) {
  publish();
}
