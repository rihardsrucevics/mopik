/**
 * `data/poi-<CC>.geojson` → `public/poi/<CC>.geojson` + `public/poi/index.json`.
 *
 * The build script (`scripts/build_poi_dataset.py --pbf`) writes one file per
 * country into `data/`, which is not served and not in the function bundle.
 * This copies whichever countries exist right now into `public/poi/`, minified,
 * and writes the index the loader reads to decide what to load.
 *
 * Idempotent and incremental on purpose: the Europe build runs for hours and
 * drops a country at a time (LV/LT/EE done, PL downloading, DE/CH/AT/IT/SI to
 * come). Re-running this after each one publishes what has landed and leaves
 * the rest alone — there is no "all countries" precondition anywhere.
 *
 *   npx tsx scripts/publish-poi.ts
 *
 * ## Why the index carries cells and not just a bounding box
 *
 * A bounding box per country does not work here, and the reason is measured
 * rather than theoretical. A `route=ferry` way's centroid sits in open water,
 * often at the far terminal (§5 of docs/poi-europe-plan.md), so Latvia's file
 * contains points at lon 10.86 — the Baltic Sea off Germany — and Estonia's
 * reaches lat 54.63. Estonia's full bbox therefore spans 19–28.4°E / 54.6–60.2°N,
 * which covers the whole Baltics: *every* ride would load Estonia. Trimming the
 * box to a percentile instead loses ~2 % of the points, and those are real
 * border villages, not only sea ferries.
 *
 * So the index carries the set of **0.25° cells that actually contain a point**.
 * It is exact — no point is ever missed and no file is ever opened for a ride
 * it cannot serve — and it is small: 6 KB for the three Baltic countries,
 * about 89 KB extrapolated to all of Europe. It is also the tiling the plan's
 * §3 asks for, arriving early and for free: when the unit of loading has to
 * become a tile rather than a country, the index already says which tiles
 * exist and only the loader's `fileFor` step changes.
 *
 * Two cell sets, because loading and coverage are different questions:
 * `cells` is every occupied cell (load by this and no point is ever missed),
 * `placeCells` excludes cells that hold nothing but a sea centroid (answer
 * "is this covered?" by this, or the ferry trail across the Baltic makes
 * northern Germany look like it has place data). See CENTROID_CATEGORIES.
 *
 * `bbox` stays in the index as the points' envelope, for anything that wants
 * one cheaply (a map fitting its view, a human reading the table).
 */
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const IN_DIR = path.join(ROOT, "data");
const OUT_DIR = path.join(ROOT, "public", "poi");

/**
 * Cell size of the coverage index, in degrees.
 *
 * 0.25° is ~28 km tall and ~15 km wide at Baltic latitudes. Measured against
 * the three published countries, with a 25 km search circle — the size
 * `loop.ts` actually uses:
 *
 *   | cell  | index (Europe) | Sigulda loads | Bauska loads |
 *   |-------|---------------:|---------------|--------------|
 *   | 1°    |          11 KB | LV, LT, EE    | LV, LT, EE   |
 *   | 0.5°  |          29 KB | LV, EE        | LV, LT, EE   |
 *   | 0.25° |          89 KB | **LV**        | **LV, LT**   |
 *   | 0.1°  |         466 KB | LV            | LV, LT       |
 *
 * At 1° a Latvian ride near Sigulda parsed all three files, because Estonian
 * ferry centroids in the Gulf of Riga land in the same coarse cells — the very
 * over-loading the per-country split exists to prevent. 0.25° is the first
 * size that gets Sigulda down to Latvia alone, and Bauska correctly keeps both
 * (it is 12 km from the border). 0.1° buys nothing for 5× the index.
 *
 * Must stay in step with `INDEX_CELL_DEGREES` in `lib/geo/poi.ts`; the loader
 * checks `version`, not the number, so change both together and bump it.
 */
const INDEX_CELL_DEGREES = 0.25;

/**
 * Categories whose geometry is a centroid rather than a place, so a cell
 * containing only these is not somewhere the dataset covers.
 *
 * Only `ferry`, and for the reason §5 of the plan documents: a `route=ferry`
 * way spans open water and `out center` puts its point in the middle of the
 * sea, or at the far terminal in another country. Latvia's file has one on the
 * Karlshamn–Klaipėda line, which is in Sweden.
 *
 * These points are real and must stay loadable — a rider heading for a ferry
 * wants it as a stop. They simply must not be what makes `hasPlaceData()` say
 * a region is covered: the ferry cells alone trail from Klaipėda across the
 * Baltic into Germany, and with the loader's 1.5° slack that made the whole
 * southern Baltic read as covered. A German ride would then have been denied
 * the `sparsePlaceData` notice it has earned.
 */
const CENTROID_CATEGORIES = new Set(["ferry"]);

export type PoiCountryIndexEntry = {
  cc: string;
  count: number;
  /** envelope of every point, for anything that wants a box cheaply */
  bbox: [number, number, number, number];
  /** every occupied cell as "lonIndex,latIndex" — what to load */
  cells: string[];
  /** cells holding something other than a sea centroid — what counts as covered */
  placeCells: string[];
  builtAt: string;
  bytes: number;
};

export type PoiIndex = {
  /** bumped when the file layout or the cell size changes */
  version: 3;
  source: "geofabrik";
  cellDegrees: number;
  countries: PoiCountryIndexEntry[];
};

type Feature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, unknown>;
};

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

export function publish(inDir = IN_DIR, outDir = OUT_DIR): PoiIndex {
  const files = fs.existsSync(inDir)
    ? fs
        .readdirSync(inDir)
        .filter((f) => /^poi-[A-Z]{2}\.geojson$/.test(f))
        .sort()
    : [];

  if (!files.length) {
    throw new Error(
      `No data/poi-<CC>.geojson files in ${inDir} — run scripts/build_poi_dataset.py --pbf first.`
    );
  }

  fs.mkdirSync(outDir, { recursive: true });

  const countries: PoiCountryIndexEntry[] = [];
  const rows: string[][] = [];

  for (const file of files) {
    const cc = file.slice(4, 6);
    const src = path.join(inDir, file);
    const raw = fs.readFileSync(src, "utf-8");
    const fc = JSON.parse(raw) as { features: Feature[] };
    const features = fc.features ?? [];

    // Every point in a Geofabrik file is by construction inside the country
    // polygon (that is the whole reason for the rebuild), so the `country`
    // property is stamped from the filename rather than trusted from the data.
    // A mismatch would mean the wrong file was copied, not a border question.
    const mislabelled = features.filter((f) => f.properties.country !== cc).length;

    const cellSet = new Set<string>();
    const placeCellSet = new Set<string>();
    let minLon = Infinity;
    let minLat = Infinity;
    let maxLon = -Infinity;
    let maxLat = -Infinity;
    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates;
      const cell = `${Math.floor(lon / INDEX_CELL_DEGREES)},${Math.floor(lat / INDEX_CELL_DEGREES)}`;
      cellSet.add(cell);
      if (!CENTROID_CATEGORIES.has(String(f.properties.category))) placeCellSet.add(cell);
      if (lon < minLon) minLon = lon;
      if (lat < minLat) minLat = lat;
      if (lon > maxLon) maxLon = lon;
      if (lat > maxLat) maxLat = lat;
    }
    const cells = [...cellSet].sort();
    const placeCells = [...placeCellSet].sort();

    const bbox: [number, number, number, number] = [
      round6(minLon),
      round6(minLat),
      round6(maxLon),
      round6(maxLat),
    ];

    // Minified: the source files are pretty-printed by the Python writer, and
    // whitespace is ~20 % of the bytes that go into the function bundle.
    const out = path.join(outDir, `${cc}.geojson`);
    const minified = JSON.stringify(fc);
    fs.writeFileSync(out, minified);
    const bytes = Buffer.byteLength(minified);

    countries.push({
      cc,
      count: features.length,
      bbox,
      cells,
      placeCells,
      builtAt: fs.statSync(src).mtime.toISOString(),
      bytes,
    });

    rows.push([
      cc,
      String(features.length),
      `${(raw.length / 1024 / 1024).toFixed(2)} MB`,
      `${(bytes / 1024 / 1024).toFixed(2)} MB`,
      `${placeCells.length}/${cells.length}`,
      `${bbox[0].toFixed(2)},${bbox[1].toFixed(2)} → ${bbox[2].toFixed(2)},${bbox[3].toFixed(2)}`,
      mislabelled ? `${mislabelled} mislabelled!` : "ok",
    ]);
  }

  const index: PoiIndex = {
    version: 3,
    source: "geofabrik",
    cellDegrees: INDEX_CELL_DEGREES,
    countries,
  };
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index));

  const header = ["cc", "points", "source", "published", "cells", "bbox", "labels"];
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length))
  );
  const line = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join("  ").trimEnd();
  console.log(line(header));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const r of rows) console.log(line(r));

  const total = countries.reduce((n, c) => n + c.count, 0);
  const totalBytes = countries.reduce((n, c) => n + c.bytes, 0);
  const indexBytes = fs.statSync(path.join(outDir, "index.json")).size;
  console.log(
    `\n${countries.length} countries, ${total.toLocaleString()} POIs, ` +
      `${(totalBytes / 1024 / 1024).toFixed(2)} MB in public/poi/, ` +
      `index.json ${(indexBytes / 1024).toFixed(1)} KB`
  );

  return index;
}

// `tsx scripts/publish-poi.ts` runs it; `import` from a test does not.
if (process.argv[1] && path.resolve(process.argv[1]).includes("publish-poi")) {
  publish();
}
