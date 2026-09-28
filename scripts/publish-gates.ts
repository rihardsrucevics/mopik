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
 * ## It never throws away what is already published
 *
 * `data/` is untracked and per checkout, so a stale copy of it can sit in any
 * checkout. Two things protect `public/gates/` from one (release check,
 * 2026-09-28: the main checkout's `data/gates-{LV,LT,EE}.json` predate the
 * node ids and `access=*` that `scripts/enrich-gates-osm.ts` added to the
 * published files, and a plain copy would have wiped them):
 *
 * - **An older build never replaces a newer one.** A source whose `builtAt`
 *   is before the published file's is skipped with a warning and the
 *   published file is kept as it is (and indexed as it is).
 * - **Ids and access are carried over.** A source row with no node id takes
 *   the id and `access=*` of the published row at the very same coordinates
 *   with the same `barrier=*` — the row the enrichment matched, so a fact
 *   carried and not a guess. Rows that match nothing, or match twice, stay
 *   without them, exactly as the enrichment leaves them.
 *
 * `--force` publishes the sources as they are, for a deliberate rollback.
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
  accessKinds?: string[];
  /** [lon, lat, barrierIndex, highwayIndex, nodeId?, accessIndex?] — see `lib/geo/gates.ts` */
  gates?: GateRow[];
};
type GateRow = [number, number, number, number, number?, number?];

export type PublishOptions = { force?: boolean; log?: (line: string) => void };

/**
 * What the published file at `out` says about the source `fc`: whether it is
 * a newer build (keep it), and the source with node ids and access carried
 * over from it where the source has none (see the header).
 */
export function mergePublished(fc: GateFile, published: GateFile | null): { file: GateFile; keepPublished: boolean; carried: number } {
  if (!published) return { file: fc, keepPublished: false, carried: 0 };
  const srcAt = fc.builtAt ? Date.parse(fc.builtAt) : NaN;
  const pubAt = published.builtAt ? Date.parse(published.builtAt) : NaN;
  if (Number.isFinite(srcAt) && Number.isFinite(pubAt) && srcAt < pubAt) return { file: published, keepPublished: true, carried: 0 };

  const pubBarriers = published.barrierKinds ?? [];
  const pubAccess = published.accessKinds ?? [];
  const byPlace = new Map<string, { id: number; access: string | null }[]>();
  for (const row of published.gates ?? []) {
    const id = row[4];
    if (typeof id !== "number" || !(id > 0)) continue;
    const key = `${row[0]},${row[1]},${pubBarriers[row[2]] ?? row[2]}`;
    const access = typeof row[5] === "number" && row[5] >= 0 ? pubAccess[row[5]] ?? null : null;
    const list = byPlace.get(key);
    if (list) list.push({ id, access });
    else byPlace.set(key, [{ id, access }]);
  }
  if (!byPlace.size) return { file: fc, keepPublished: false, carried: 0 };

  const barriers = fc.barrierKinds ?? [];
  const accessKinds = [...(fc.accessKinds ?? [])];
  const accessIndex = (value: string | null): number => {
    if (!value) return -1;
    let i = accessKinds.indexOf(value);
    if (i < 0) { accessKinds.push(value); i = accessKinds.length - 1; }
    return i;
  };
  let carried = 0;
  const gates = (fc.gates ?? []).map((row): GateRow => {
    if (typeof row[4] === "number" && row[4] > 0) return row;
    const hits = byPlace.get(`${row[0]},${row[1]},${barriers[row[2]] ?? row[2]}`);
    if (!hits || hits.length !== 1) return row;
    carried++;
    return [row[0], row[1], row[2], row[3], hits[0].id, accessIndex(hits[0].access)];
  });
  if (!carried) return { file: fc, keepPublished: false, carried: 0 };
  return { file: { ...fc, accessKinds, gates }, keepPublished: false, carried };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function publish(inDir = IN_DIR, outDir = OUT_DIR, options: PublishOptions = {}): GateIndex {
  const say = options.log ?? ((line: string) => console.log(line));
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
    const out = path.join(outDir, `${cc}.json`);
    const source = JSON.parse(fs.readFileSync(src, "utf-8")) as GateFile;
    const published = !options.force && fs.existsSync(out) ? (JSON.parse(fs.readFileSync(out, "utf-8")) as GateFile) : null;
    const merged = mergePublished(source, published);
    const fc = merged.file;
    if (merged.keepPublished) {
      say(`${cc}: kept public/gates/${cc}.json (built ${published?.builtAt}) — data/${file} is an older build (${source.builtAt}); --force to publish it anyway`);
    } else if (merged.carried) {
      say(`${cc}: ${merged.carried} node ids and access values carried over from the published file (data/${file} has none for them)`);
    }

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
    const minified = JSON.stringify(fc);
    if (!merged.keepPublished) fs.writeFileSync(out, minified);
    const bytes = Buffer.byteLength(minified);

    countries.push({
      cc,
      count: gates.length,
      byBarrier,
      byHighway,
      bbox,
      cells,
      builtAt: fc.builtAt ?? fs.statSync(merged.keepPublished ? out : src).mtime.toISOString(),
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
  say(line(header));
  say(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) say(line(r));

  const total = countries.reduce((n, c) => n + c.count, 0);
  const totalBytes = countries.reduce((n, c) => n + c.bytes, 0);
  const indexBytes = fs.statSync(path.join(outDir, "index.json")).size;
  say(
    `\n${countries.length} countries, ${total.toLocaleString()} gates, ` +
      `${(totalBytes / 1024).toFixed(0)} KB in public/gates/, ` +
      `index.json ${(indexBytes / 1024).toFixed(1)} KB`
  );

  return index;
}

// `tsx scripts/publish-gates.ts` runs it; `import` from a test does not.
if (require.main === module) {
  publish(IN_DIR, OUT_DIR, { force: process.argv.includes("--force") });
}
