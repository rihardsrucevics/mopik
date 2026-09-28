import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mapFieldMode } from "../lib/map/map-field";
import { t, type MessageKey } from "../lib/i18n/messages";

/**
 * Backlog 40: the map's field is never a box that ignores a tap.
 *
 * `npx tsx --test scripts/map-field.test.ts`
 */

const idle = { activeRow: null, batchActive: false, mapBusy: false, canAddStop: true };

test("no row active: a tap on the field starts a new stop", () => {
  assert.equal(mapFieldMode(idle), "new-stop");
});

test("a row active: the field searches for that row, in a move or a grab too", () => {
  assert.equal(mapFieldMode({ ...idle, activeRow: 2 }), "row");
  assert.equal(mapFieldMode({ ...idle, activeRow: 0, mapBusy: true }), "row");
  assert.equal(mapFieldMode({ ...idle, activeRow: 1, canAddStop: false }), "row");
});

test("when nothing can act the field is off — the cap, an edit being routed, a batch, a move", () => {
  assert.equal(mapFieldMode({ ...idle, canAddStop: false }), "off");
  assert.equal(mapFieldMode({ ...idle, batchActive: true }), "off");
  assert.equal(mapFieldMode({ ...idle, activeRow: 1, batchActive: true }), "off");
  assert.equal(mapFieldMode({ ...idle, mapBusy: true }), "off");
});

test("the composer wires the field to „+”'s own handler, not a parallel one", () => {
  const src = readFileSync(join(__dirname, "../components/ride-composer.tsx"), "utf8");
  assert.match(src, /onFocus: fieldMode === "new-stop" \? onAddStop : null/);
  assert.match(src, /disabled: fieldMode === "off"/);
  assert.match(src, /^\s+onAddStop,$/m);
  const map = readFileSync(join(__dirname, "../components/route-map.tsx"), "utf8");
  assert.match(map, /onFocus=\{controls\.search\.onFocus \?\? undefined\}/);
});

test("the placeholder says what a tap does, in all four languages; Latvian never says „piesit”", () => {
  const keys: MessageKey[] = ["mapNoActiveRow", "mapFieldRerouting"];
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    for (const k of keys) assert.ok(t(locale, k).trim().length > 0, `${locale}.${k}`);
  }
  assert.equal(t("lv", "mapNoActiveRow"), "Meklē vai atzīmē pieturu");
  assert.equal(t("en", "mapNoActiveRow"), "Search or mark a stop");
  const lv = readFileSync(join(__dirname, "../lib/i18n/messages.ts"), "utf8");
  assert.doesNotMatch(lv.replace(/\/\*[\s\S]*?\*\//g, ""), /piesit/i);
});
