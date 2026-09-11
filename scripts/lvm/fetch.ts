/**
 * Fetch LVM GEO forest roads + OSM highways for two study areas.
 *
 * LVM GEO exposes NO public WFS: the gateway in front of their GeoServer
 * whitelists only GetMap / GetCapabilities / GetLegendGraphic (GetFeatureInfo
 * and DescribeFeatureType both answer 400 "Invalid value for parameter").
 * GetMap however supports FORMAT=application/json;type=geojson, which returns
 * real vector features. Geometry is generalised per output resolution, so we
 * tile each bbox and request a fine ground resolution (~0.3 m/px), at which
 * vertex counts converge. Features are deduplicated by their stable `id`
 * (e.g. "road.391").
 *
 * Run: npx tsx scripts/lvm/fetch.ts
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "data", "lvm");
mkdirSync(OUT, { recursive: true });

export const LVM_WMS_VECTOR =
  "https://geoserver.lvmgeo.lv/wmsvector62531a9bfcfa4015856924e94076a179";

export type Bbox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

/** ~10 km x 10 km around each centre. */
export const AREAS: Record<string, { centre: [number, number]; bbox: Bbox }> = {
  baldone: {
    centre: [56.74, 24.39],
    bbox: { minLon: 24.3084, minLat: 56.695, maxLon: 24.4716, maxLat: 56.785 },
  },
  turaida: {
    centre: [57.18, 24.85],
    bbox: { minLon: 24.7673, minLat: 57.135, maxLon: 24.9327, maxLat: 57.225 },
  },
};

const UA = "Mopik-LVM-research/1.0 (route quality research; contact via repo)";

type Feature = {
  type: "Feature";
  id?: string;
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown>;
};

async function getJson(url: string, tries = 4): Promise<any> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/**
 * Tile the bbox so each request covers a small area at high pixel count,
 * giving ~0.3-0.5 m/px where LVM stops generalising.
 */
export async function fetchLvmRoads(bbox: Bbox, layer = "road"): Promise<Feature[]> {
  const TILES = 6; // 6x6 tiles over ~10 km => ~1.7 km per tile
  const WH = 4096;
  const byId = new Map<string, Feature>();
  const dLon = (bbox.maxLon - bbox.minLon) / TILES;
  const dLat = (bbox.maxLat - bbox.minLat) / TILES;

  for (let i = 0; i < TILES; i++) {
    for (let j = 0; j < TILES; j++) {
      const b = [
        bbox.minLon + i * dLon,
        bbox.minLat + j * dLat,
        bbox.minLon + (i + 1) * dLon,
        bbox.minLat + (j + 1) * dLat,
      ];
      const url =
        `${LVM_WMS_VECTOR}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}` +
        `&STYLES=&CRS=CRS:84&FORMAT=${encodeURIComponent("application/json;type=geojson")}` +
        `&BBOX=${b.join(",")}&WIDTH=${WH}&HEIGHT=${WH}`;
      const fc = await getJson(url);
      for (const f of fc.features ?? []) {
        const id = String(f.id ?? `${layer}.${JSON.stringify(f.properties)}`);
        // keep the richest copy (tiles clip geometry at their edge)
        const prev = byId.get(id);
        if (!prev) byId.set(id, f);
        else byId.set(id, mergeParts(prev, f));
      }
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  return [...byId.values()];
}

/** Tiles clip lines; keep all parts from every tile so nothing is lost. */
function mergeParts(a: Feature, b: Feature): Feature {
  const parts = (f: Feature): number[][][] =>
    f.geometry.type === "LineString"
      ? [f.geometry.coordinates as number[][]]
      : (f.geometry.coordinates as number[][][]);
  const all = [...parts(a), ...parts(b)];
  const seen = new Set<string>();
  const uniq = all.filter((p) => {
    const k = JSON.stringify(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    ...a,
    geometry: { type: "MultiLineString", coordinates: uniq },
  };
}

async function fetchOsm(bbox: Bbox): Promise<any> {
  const q = `[out:json][timeout:180];way["highway"](${bbox.minLat},${bbox.minLon},${bbox.maxLat},${bbox.maxLon});out geom;`;
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  return res.json();
}

async function main() {
  for (const [name, area] of Object.entries(AREAS)) {
    const lvmPath = join(OUT, `lvm-roads-${name}.geojson`);
    if (!existsSync(lvmPath)) {
      console.log(`fetching LVM roads for ${name}...`);
      const feats = await fetchLvmRoads(area.bbox);
      writeFileSync(
        lvmPath,
        JSON.stringify({ type: "FeatureCollection", features: feats }),
      );
      console.log(`  ${feats.length} LVM road features -> ${lvmPath}`);
    } else {
      const n = JSON.parse(readFileSync(lvmPath, "utf8")).features.length;
      console.log(`LVM ${name}: cached (${n} features)`);
    }

    const osmPath = join(OUT, `osm-highways-${name}.json`);
    if (!existsSync(osmPath)) {
      console.log(`fetching OSM highways for ${name}... (polite: one request)`);
      const osm = await fetchOsm(area.bbox);
      writeFileSync(osmPath, JSON.stringify(osm));
      console.log(`  ${osm.elements.length} OSM ways -> ${osmPath}`);
      await new Promise((r) => setTimeout(r, 8000));
    } else {
      const n = JSON.parse(readFileSync(osmPath, "utf8")).elements.length;
      console.log(`OSM ${name}: cached (${n} ways)`);
    }
  }
}

if (process.argv[1]?.includes("fetch.ts")) main().catch((e) => {
  console.error(e);
  process.exit(1);
});
