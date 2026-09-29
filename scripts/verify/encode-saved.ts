// argv: <fixture> [origin] → stdout: a saved-ride entry (`mopik.saved.v1` row)
// built from the fixture's first ride with the app's own encoder, the way the
// result panel's „Saglabāt” writes one. `origin` is "own", "shared" or
// "legacy" (no origin field — a ride saved before backlog 44).
import fs from "fs";
import path from "path";
import { encodeRouteShare, shareStartLabel } from "../../lib/share/route-code";
import { rideId } from "../../lib/share/saved-rides";

const [name, origin = "own"] = process.argv.slice(2);
const f = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", `${name}.json`), "utf8"));
const response = typeof f.response === "string" ? JSON.parse(f.response) : f.response;
const route = response.routes[0];
const plan = f.request.plan;
// As the result panel saves an unedited ride: the routed places under the
// router's own labels (home-page `routedPlaces`), not the plan's names.
const places = [response.start, ...(response.via ?? []), ...(response.destination ? [response.destination] : [])]
  .map((p: { lat: number; lon: number; label: string }) => ({ name: p.label + (process.env.LABEL_SUFFIX ?? ""), label: p.label + (process.env.LABEL_SUFFIX ?? ""), lat: p.lat, lon: p.lon }));
const code = encodeRouteShare(route, shareStartLabel(plan, places), plan, places);
const entry = {
  id: rideId(code), code, name: route.name,
  km: Math.round(route.distanceMeters / 1000), minutes: Math.round(route.durationSeconds / 60),
  unpavedPercent: route.surfaces.gravelPercent + route.surfaces.dirtPercent, variant: route.variant,
  savedAt: Date.now() - 60_000,
  ...(origin === "own" ? { origin: "own" } : origin === "shared" ? { origin: "shared", from: "shared" } : {}),
};
process.stdout.write(JSON.stringify(entry));
