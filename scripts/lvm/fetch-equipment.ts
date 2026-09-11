/**
 * Fetch LVM road equipment (gates, barriers) for the two study areas.
 *
 * The `roadequipment` layer has MaxScaleDenominator = 25100, so a whole-bbox
 * GetMap returns nothing: it must be tiled finely enough that the implied
 * scale is below 1:25 100. With WIDTH=2048 and ~0.02 deg tiles the scale is
 * ~1:6 000, well inside the limit.
 *
 * equipmentsubtype: 1=Ceļazīme, 2=LVM informatīvā zīme, 3=Barjera,
 *                   4=Vārti, 5=Signālstabiņi
 *
 * Run: npx tsx scripts/lvm/fetch-equipment.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { AREAS, LVM_WMS_VECTOR, type Bbox } from "./fetch.js";

const OUT = join(process.cwd(), "data", "lvm");
mkdirSync(OUT, { recursive: true });
const UA = "Mopik-LVM-research/1.0";

export const EQUIPMENT_TYPES: Record<number, string> = {
  1: "Celazime (road sign)",
  2: "LVM informativa zime",
  3: "Barjera (barrier)",
  4: "Varti (gate)",
  5: "Signalstabini (marker posts)",
};

async function tileFetch(bbox: Bbox, layer: string, tiles: number, wh = 2048) {
  const byId = new Map<string, any>();
  const dLon = (bbox.maxLon - bbox.minLon) / tiles;
  const dLat = (bbox.maxLat - bbox.minLat) / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const b = [
        bbox.minLon + i * dLon,
        bbox.minLat + j * dLat,
        bbox.minLon + (i + 1) * dLon,
        bbox.minLat + (j + 1) * dLat,
      ];
      const url =
        `${LVM_WMS_VECTOR}?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=${layer}` +
        `&STYLES=&CRS=CRS:84&FORMAT=${encodeURIComponent("application/json;type=geojson")}` +
        `&BBOX=${b.join(",")}&WIDTH=${wh}&HEIGHT=${wh}`;
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA } });
        if (!res.ok) continue;
        const fc = await res.json();
        for (const f of fc.features ?? []) byId.set(String(f.id), f);
      } catch {
        /* skip tile */
      }
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  return [...byId.values()];
}

async function main() {
  for (const [name, area] of Object.entries(AREAS)) {
    // 8x8 tiles over ~0.09 deg => ~0.011 deg/tile at 2048 px => ~1:3000
    const feats = await tileFetch(area.bbox, "roadequipment", 8);
    const path = join(OUT, `lvm-roadequipment-${name}.geojson`);
    writeFileSync(path, JSON.stringify({ type: "FeatureCollection", features: feats }));
    const counts: Record<string, number> = {};
    for (const f of feats) {
      const t = EQUIPMENT_TYPES[f.properties?.equipmentsubtype] ?? "unknown";
      counts[t] = (counts[t] ?? 0) + 1;
    }
    console.log(`${name}: ${feats.length} equipment points`, counts);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
