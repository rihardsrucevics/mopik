/**
 * Probe what BRouter actually reports per way, with the app's own profile.
 *
 *   npx tsx scripts/probe-brouter.ts [offRoad=0.8]
 *
 * Routes one rural leg east of Sigulda and prints the WayTags header, a few
 * raw rows, and a histogram of tag keys — so we know which OSM keys
 * (tracktype, smoothness, estimated_*_class …) are available for the cost
 * script and for reporting, rather than assuming.
 */
import { uploadProfile } from "../lib/routing/brouter";

const offRoad = Number(process.argv[2] ?? 0.8);

async function main() {
  const profileId = await uploadProfile({ offRoad, difficulty: "adventure", avoidMainRoads: false, avoidMotorways: true, noSand: false, avoidTowns: false, trails: "none" });
  // Sigulda -> towards Līgatne/Nītaure, forest country with plenty of tracks.
  const lonlats = "24.8530,57.1530|25.0500,57.0800";
  const url =
    `https://brouter.de/brouter?lonlats=${encodeURIComponent(lonlats)}` +
    `&profile=${profileId}&alternativeidx=0&format=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const data = (await res.json()) as {
    features: { properties: { "track-length": string; "total-time": string; messages: string[][] } }[];
  };
  const p = data.features[0].properties;
  console.log(`length ${p["track-length"]} m, time ${p["total-time"]} s`);
  const [header, ...rows] = p.messages;
  console.log("header:", header.join(" | "));
  const iTags = header.indexOf("WayTags");
  const keys = new Map<string, number>();
  for (const row of rows) {
    for (const pair of String(row[iTags]).split(/\s+/)) {
      const k = pair.split("=")[0];
      if (k) keys.set(k, (keys.get(k) ?? 0) + 1);
    }
  }
  console.log(`rows: ${rows.length}`);
  console.log("tag keys:", [...keys.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  "));
  console.log("sample rows with highway=track:");
  for (const row of rows.filter((r) => /highway=track/.test(String(r[iTags]))).slice(0, 8)) {
    console.log("  ", row[iTags]);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
