/**
 * Add each gate's OSM node id and `access=*` to a published gate file.
 *
 *   npx tsx scripts/enrich-gates-osm.ts <gates-CC.json> <overpass.json>
 *
 * The gate card (tap a gate on the map) shows which node it is — a „Skatīt
 * OSM” link — and what OSM says about access across it. The Geofabrik build
 * (`scripts/build_gates_dataset.py`) now writes both itself; this carries them
 * into a file built before it did, without re-reading a country's `.pbf`.
 *
 * `<overpass.json>` is the answer to, for country CC:
 *
 *   [out:json][timeout:180];
 *   area["ISO3166-1"="CC"][admin_level=2]->.a;
 *   node(area.a)[barrier~"^(gate|lift_gate|swing_gate|chain|bollard|cattle_grid)$"];
 *   out;
 *
 * **Matched, never guessed.** A row gets an id only when exactly one OSM node
 * with the SAME `barrier=*` value stands within `MATCH_M` of it — the file's
 * coordinates are the node's own, rounded to 5 decimals (~1 m). A node that
 * has moved or been retagged since the build, or two candidates at one spot,
 * leave the row as it was: the gate still counts and shows, with no link and
 * no access line. The file is rewritten in place.
 */
import fs from "fs";

const MATCH_M = 1.5;

type Row = [number, number, number, number, number?, number?];
type GateFile = { barrierKinds?: string[]; accessKinds?: string[]; gates?: Row[] } & Record<string, unknown>;
type OsmNode = { type: string; id: number; lat: number; lon: number; tags?: Record<string, string> };

export function enrich(file: GateFile, nodes: OsmNode[]): { file: GateFile; matched: number; ambiguous: number } {
  const barrierKinds = file.barrierKinds ?? [];
  const grid = new Map<string, OsmNode[]>();
  const key = (lon: number, lat: number) => `${Math.floor(lon * 1000)}:${Math.floor(lat * 1000)}`;
  for (const n of nodes) {
    if (n.type !== "node" || !n.tags?.barrier) continue;
    const k = key(n.lon, n.lat);
    const bucket = grid.get(k);
    if (bucket) bucket.push(n);
    else grid.set(k, [n]);
  }

  const accessKinds: string[] = [...(file.accessKinds ?? [])];
  const accessIndex = (value: string | undefined): number => {
    if (!value) return -1;
    let i = accessKinds.indexOf(value);
    if (i < 0) { accessKinds.push(value); i = accessKinds.length - 1; }
    return i;
  };

  let matched = 0;
  let ambiguous = 0;
  const gates = (file.gates ?? []).map((row): Row => {
    const [lon, lat, b, h] = row;
    const barrier = barrierKinds[b];
    const kx = 111320 * Math.cos((lat * Math.PI) / 180);
    const hits: OsmNode[] = [];
    const cx = Math.floor(lon * 1000), cy = Math.floor(lat * 1000);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (const n of grid.get(`${x}:${y}`) ?? []) {
          if (n.tags?.barrier !== barrier) continue;
          if (Math.hypot((n.lon - lon) * kx, (n.lat - lat) * 110540) <= MATCH_M) hits.push(n);
        }
      }
    }
    if (hits.length !== 1) {
      if (hits.length > 1) ambiguous++;
      return [lon, lat, b, h];
    }
    matched++;
    return [lon, lat, b, h, hits[0].id, accessIndex(hits[0].tags?.access)];
  });

  return { file: { ...file, accessKinds, gates }, matched, ambiguous };
}

if (require.main === module) {
  const [gatesPath, osmPath] = process.argv.slice(2);
  if (!gatesPath || !osmPath) {
    console.error("usage: npx tsx scripts/enrich-gates-osm.ts <gates-CC.json> <overpass.json>");
    process.exit(1);
  }
  const file = JSON.parse(fs.readFileSync(gatesPath, "utf-8")) as GateFile;
  const osm = JSON.parse(fs.readFileSync(osmPath, "utf-8")) as { elements?: OsmNode[] };
  const out = enrich(file, osm.elements ?? []);
  fs.writeFileSync(gatesPath, JSON.stringify(out.file));
  const total = out.file.gates?.length ?? 0;
  console.log(
    `${gatesPath}: ${out.matched}/${total} gates matched to one OSM node ` +
      `(${out.ambiguous} ambiguous, ${total - out.matched - out.ambiguous} not found); ` +
      `access values: ${(out.file.accessKinds ?? []).join(", ") || "none"}`
  );
}
