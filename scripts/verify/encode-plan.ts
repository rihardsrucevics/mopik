// stdin: {"plan": RidePlan, "places": ResolvedPlace[]} → stdout: the `?p=` plan code.
// Used by record-fixtures.cjs so a fixture's code comes from the app's own encoder.
import { encodePlanShare } from "../../lib/share/route-code";

let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  const { plan, places } = JSON.parse(raw);
  process.stdout.write(encodePlanShare(plan, places));
});
