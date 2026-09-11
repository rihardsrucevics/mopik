import fs from "fs";
import path from "path";
import { haversineMeters } from "./geometry";

/**
 * Places worth riding to, used to anchor generated loops.
 *
 * Routing to real OSM objects rather than to points on a circle is what keeps
 * via points on actual roads — a computed circle point lands in a lake or a
 * bog often enough to matter. Built offline by
 * scripts/build-poi-dataset.mjs; see that file for why it isn't a live query.
 */

export type PoiCategory =
  | "ferry"
  | "ford"
  | "tower"
  | "hillfort"
  | "lighthouse"
  | "waterfall"
  | "manor"
  | "viewpoint"
  | "mill"
  | "reserve"
  | "village";

export type Poi = {
  id: string;
  lon: number;
  lat: number;
  category: PoiCategory;
  /** how much of a detour this is worth, 1 (filler) to 10 (water crossing) */
  score: number;
  country: string;
  nameLv?: string;
  nameEn?: string;
  /** Latvian accusative, for "Caur {X}" route names */
  nameLvAcc?: string;
};

type PoiProperties = Omit<Poi, "lon" | "lat">;

/** Coarse spatial index: a few thousand points don't warrant an R-tree. */
const CELL_DEGREES = 0.1;

let cache: { all: Poi[]; cells: Map<string, Poi[]> } | null = null;

const cellKey = (lon: number, lat: number) =>
  `${Math.floor(lon / CELL_DEGREES)}:${Math.floor(lat / CELL_DEGREES)}`;

function load(): { all: Poi[]; cells: Map<string, Poi[]> } {
  if (cache) return cache;

  const file = path.join(process.cwd(), "public", "poi-baltics.geojson");
  if (!fs.existsSync(file)) {
    console.warn(
      "poi-baltics.geojson missing — run `python3 scripts/build_poi_dataset.py`. " +
        "Loops will fall back to isochrone/geometric anchors without named stops."
    );
    cache = { all: [], cells: new Map() };
    return cache;
  }

  const fc = JSON.parse(fs.readFileSync(file, "utf-8")) as GeoJSON.FeatureCollection<
    GeoJSON.Point,
    PoiProperties
  >;

  const all: Poi[] = fc.features.map((f) => ({
    ...f.properties,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
  }));

  const cells = new Map<string, Poi[]>();
  for (const poi of all) {
    const key = cellKey(poi.lon, poi.lat);
    const bucket = cells.get(key);
    if (bucket) bucket.push(poi);
    else cells.set(key, [poi]);
  }

  cache = { all, cells };
  return cache;
}

export function loadPois(): Poi[] {
  return load().all;
}

/** POIs within `radiusMeters` of a point, nearest first. */
export function poisNear(
  point: { lat: number; lon: number },
  radiusMeters: number
): Poi[] {
  const { cells } = load();

  // Cell span needed to cover the radius at this latitude.
  const latSpan = radiusMeters / 111_320;
  const lonSpan = radiusMeters / (111_320 * Math.cos((point.lat * Math.PI) / 180) || 1);
  const cellsLat = Math.ceil(latSpan / CELL_DEGREES);
  const cellsLon = Math.ceil(lonSpan / CELL_DEGREES);

  const baseLon = Math.floor(point.lon / CELL_DEGREES);
  const baseLat = Math.floor(point.lat / CELL_DEGREES);

  const found: { poi: Poi; distance: number }[] = [];
  for (let dx = -cellsLon; dx <= cellsLon; dx++) {
    for (let dy = -cellsLat; dy <= cellsLat; dy++) {
      const bucket = cells.get(`${baseLon + dx}:${baseLat + dy}`);
      if (!bucket) continue;
      for (const poi of bucket) {
        const distance = haversineMeters([poi.lon, poi.lat], [point.lon, point.lat]);
        if (distance <= radiusMeters) found.push({ poi, distance });
      }
    }
  }

  return found.sort((a, b) => a.distance - b.distance).map((f) => f.poi);
}

export function poiName(poi: Poi, locale: "lv" | "en"): string | undefined {
  return locale === "lv" ? (poi.nameLv ?? poi.nameEn) : (poi.nameEn ?? poi.nameLv);
}
