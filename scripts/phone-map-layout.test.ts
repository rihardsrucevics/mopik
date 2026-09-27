import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t, type MessageKey } from "../lib/i18n/messages";

/**
 * The phone's full-screen map keeps stable slots (rider, 2026-09-27: "one
 * moment there's an X in the left corner, the next there isn't").
 *
 * `npx tsx --test scripts/phone-map-layout.test.ts`
 *
 * Layout is CSS; what can be held here is the structure the layout rests on.
 */

const src = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
const routeMap = src("components/route-map.tsx");
const panel = src("components/map-panel.tsx");

test("the collapse button is drawn in every full-screen state, pending included", () => {
  assert.doesNotMatch(panel, /group-has-\[\[data-map-pending\]\]\/panel:hidden/);
  assert.match(panel, /className="absolute bottom-3 left-3 flex size-14/);
});

test("the right column: ✕ or „+” in one bottom slot, ↶ above, ✓ on top — slots keep their place", () => {
  const col = routeMap.slice(routeMap.indexOf("function PhoneColumn"), routeMap.indexOf("export function RouteMap("));
  assert.match(col, /flex-col-reverse/);
  // DOM order is bottom-up: slot 1, slot 2, slot 3.
  const i1 = col.indexOf('data-slot="1"'), i2 = col.indexOf('data-slot="2"'), i3 = col.indexOf('data-slot="3"');
  assert.ok(i1 > 0 && i1 < i2 && i2 < i3, "slots in bottom-up order");
  // ✕ and „+” are the two faces of slot 1, never both.
  assert.match(col, /\{pending \? \(\s*<button[^>]*onClick=\{pending\.onCancel\} data-slot="1"/);
  // A slot with nothing to do stays in place, invisible — never removed.
  assert.match(col, /disabled:invisible/);
  assert.doesNotMatch(col, /disabled:hidden/);
});

test("the phone row holds only the field; the desktop draws its own controls", () => {
  assert.match(routeMap, /<div className="contents max-md:hidden">/);
  assert.match(routeMap, /<PhoneColumn controls=\{controls\} \/>/);
});

test("TET, its ⓘ and the legend switch are at the top-left on a phone, in every map state", () => {
  assert.match(routeMap, /data-map-chrome className="absolute left-3 z-10 flex items-center gap-1\.5 max-md:top-3/);
  // The sights switch (a result) goes under them, not over them.
  assert.match(routeMap, /"right-14 max-md:top-\[3\.25rem\]"/);
});

test("the phone legend is off until asked for, remembered per device, and sits at the top", () => {
  const prefs = src("lib/map/layer-prefs.ts");
  assert.match(prefs, /legend: false/);
  assert.match(prefs, /legend: "mopik\.map\.legend\.v1"/);
  assert.match(routeMap, /useMapLayer\("legend"\)/);
  assert.match(routeMap, /\$\{legendOpen \? "\[\[data-map-expanded\]_&\]:flex" : ""\} md:bottom-3/);
});

test("the preview chip says what waits for ✓", async () => {
  const { setMapPendingCount } = await import("../lib/map/fullscreen");
  setMapPendingCount(2);
  setMapPendingCount(-1);
  assert.match(panel, /useMapPendingCount\(\)/);
  assert.match(routeMap, /setMapPendingCount\(pendingCount\)/);
  assert.equal(t("lv", "mapPreviewPendingMany").replace("{n}", "2"), "2 neapstiprinātas");
});

test("every new string exists in lv, lt, et and en", () => {
  const keys: MessageKey[] = ["mapPreviewPendingOne", "mapPreviewPendingMany", "mapLegend", "mapLegendShow", "mapLegendHide"];
  for (const locale of ["lv", "lt", "et", "en"] as const) {
    for (const k of keys) assert.ok(t(locale, k).trim(), `${locale}.${k}`);
  }
  assert.equal(t("lv", "mapLegend"), "Leģenda");
});
