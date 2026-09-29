import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rowsWithSight, roundReach, sightReach, metersToLine } from "../lib/map/sight-add";
import { sightAddedLine, sightReachLine, sightRefusedLine, tickedCount, tickedGuide } from "../lib/map/edit-guidance";
import { t, type MessageKey } from "../lib/i18n/messages";
import type { UiLocale } from "../lib/i18n/locale";
import type { RidePlaces } from "../lib/routing/reroute-leg";
import type { Point } from "../lib/geo/geometry";

/**
 * Backlog 46: „Pievienot” on the map card adds the sight to the ride; a
 * ticked-but-not-added state is counted on the map; a sight the ride cannot
 * come closer to is said with its distance.
 *
 * `npx tsx --test scripts/sight-add.test.ts`
 */

const lv = (k: MessageKey) => t("lv", k);
const fmt = (n: number) => new Intl.NumberFormat("lv").format(n);
const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");

test("Vatrāne: the road it is on is as close as a motorcycle gets", () => {
  const reach = sightReach({ lineMeters: 104, reachedMeters: 101 });
  assert.deepEqual(reach, { kind: "notCloser", meters: 100 });
  assert.equal(
    sightReachLine(lv, "Vatrāne", reach, fmt),
    "Vatrāne – tuvākais ceļš ~100 m no apskates vietas; tuvāk ar motociklu netikt – pietura paliek pie ceļa, tālāk kājām.",
  );
});

test("reached: nothing to say; closer but not there: said as that", () => {
  assert.equal(sightReach({ lineMeters: 900, reachedMeters: 12 }), null);
  assert.equal(sightReachLine(lv, "X", null, fmt), null);
  const short = sightReach({ lineMeters: 900, reachedMeters: 240 });
  assert.deepEqual(short, { kind: "short", meters: 240 });
  assert.match(sightReachLine(lv, "Pils", short, fmt)!, /^Pils – ar motociklu var piebraukt līdz ~240 m .* – pietura paliek pie ceļa, tālāk kājām\.$/);
  // Never further than the line already was.
  assert.deepEqual(sightReach({ lineMeters: 80, reachedMeters: 300 }), { kind: "notCloser", meters: 80 });
});

test("rounding reads like a rider says it", () => {
  assert.equal(roundReach(4), 10);
  assert.equal(roundReach(104), 100);
  assert.equal(roundReach(726), 750);
});

test("metersToLine is the nearest vertex", () => {
  const line: Point[] = [[24, 57], [24.001, 57]];
  assert.ok(Math.abs(metersToLine({ lat: 57, lon: 24.001 }, line)) < 1);
  assert.ok(metersToLine({ lat: 57.001, lon: 24 }, line) > 100);
});

test("the sight goes in as a new stop in the leg the line passes it nearest", () => {
  const P = (name: string, lat: number, lon: number) => ({ name, label: name, lat, lon });
  const places: RidePlaces = { start: P("A", 57, 24), vias: [P("B", 57, 24.2)], finish: P("C", 57, 24.4), roundTrip: false };
  const line: Point[] = [[24, 57], [24.1, 57], [24.2, 57], [24.3, 57], [24.4, 57]];
  const rows = rowsWithSight(places, P("S", 57.001, 24.3), line)!;
  assert.deepEqual(rows.names, ["A", "B", "S", "C"]);
  assert.equal(rows.picked[2]?.name, "S");
  assert.equal(rows.picked[3]?.name, "C");
  const early = rowsWithSight(places, P("E", 57.001, 24.1), line)!;
  assert.deepEqual(early.names, ["A", "E", "B", "C"]);
});

test("ticked count and its line", () => {
  assert.equal(tickedCount(lv, 1), "1 atzīmēta");
  assert.equal(tickedCount(lv, 2), "2 atzīmētas");
  assert.equal(tickedCount(lv, 11), "11 atzīmētas");
  assert.equal(tickedGuide(lv, 2), "2 atzīmētas – vēl nav braucienā – „Pievienot” tās ieliek.");
  assert.equal(sightAddedLine(lv, "Vatrāne", "+0,4"), "Vatrāne pievienota braucienam, +0,4 km – ar „Labot” to var pārvietot vai izņemt.");
  assert.equal(sightRefusedLine(lv, "Vatrāne", "Neizdevās savienot."), "Vatrāne – neizdevās savienot – izvēlies citu apskates vietu.");
});

test("the new copy: four languages, en dashes, no „piesit”", () => {
  const keys: MessageKey[] = ["sightAddToRide", "sightAdding", "sightTick", "sightUntick", "sightTickedOne", "sightTickedMany", "sightTickedGuide", "sightNotCloser", "sightShort", "sightReachAct", "sightAdded", "sightAddedAct", "sightRefusedAct"];
  for (const locale of ["lv", "lt", "et", "en"] as UiLocale[]) {
    for (const k of keys) {
      const v = t(locale, k);
      assert.ok(v && v.trim(), `${locale}.${k}`);
      assert.doesNotMatch(v, /—/, `${locale}.${k}: en dashes`);
    }
  }
  for (const k of keys) assert.doesNotMatch(t("lv", k), /piesit/i);
});

test("the map card adds, it does not only tick (backlog 46)", () => {
  const map = src("components/route-map.tsx");
  // The card's primary button says what it does, and a tick is its own control.
  assert.match(map, /m\.sightAddToRide/);
  assert.match(map, /data-tick=/);
  assert.match(map, /data-sight-ticked/);
  const page = src("components/home-page.tsx");
  assert.match(page, /onFocusAdd=\{addFocusedToRide\}/);
});
