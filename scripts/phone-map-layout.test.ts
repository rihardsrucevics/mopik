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

test("the bar is at the bottom at every width: field, then fixed slots (desktop row / phone column)", () => {
  assert.match(routeMap, /<DesktopBar controls=\{controls\} \/>/);
  assert.match(routeMap, /<PhoneColumn controls=\{controls\} \/>/);
  assert.match(routeMap, /ref=\{headerRef\} data-map-chrome className=\{controls \? "absolute bottom-3 left-3 right-3 z-20 flex flex-col-reverse/);
  assert.match(routeMap, /placement="above"/);
  const bar = routeMap.slice(routeMap.indexOf("function DesktopBar"), routeMap.indexOf("function PhoneColumn"));
  // Left to right after the field: ✓, ↶, +/✕.
  const i3 = bar.indexOf('data-slot="3"'), i2 = bar.indexOf('data-slot="2"'), i1 = bar.indexOf('data-slot="1"');
  assert.ok(i3 > 0 && i3 < i2 && i2 < i1, "✓ ↶ +/✕ in that order");
  assert.match(bar, /\{pending \? \(\s*<button[^>]*onClick=\{pending\.onCancel\} data-slot="1"/);
  assert.match(bar, /size-10/);
});

test("ONE row of switches at the top-left at every width: TET, sights (a result), legend, then ⓘ", () => {
  assert.match(routeMap, /data-map-chrome className="absolute left-3 top-3 z-10/);
  const row = routeMap.slice(routeMap.indexOf("<div data-map-toggles"));
  const tet = row.indexOf('label="TET"'), sights = row.indexOf("label={m.resSightsLayer}"), legend = row.indexOf("label={m.mapLegend}"), info = row.indexOf("m.mapCreditToggle");
  assert.ok(tet > 0 && tet < sights && sights < legend && legend < info);
  // No second row of switches: nothing wraps the row.
  assert.doesNotMatch(row.slice(0, row.indexOf("</div>")), /flex-wrap/);
  // The legend is a switch like the others, not a dark chip.
  assert.doesNotMatch(routeMap, /bg-stone-800 text-white/);
});

test("the legend: off on a phone, on on the desktop, one remembered choice, a box under the row", () => {
  const prefs = src("lib/map/layer-prefs.ts");
  assert.match(prefs, /legend: "mopik\.map\.legend\.v1"/);
  assert.match(prefs, /return \[stored \?\? desktop,/);
  assert.match(routeMap, /useMapLegend\(\)/);
  assert.match(routeMap, /\{legendOpen && \(\s*<div className="max-w-full max-md:hidden max-md:\[\[data-map-expanded\]_&\]:block">/);
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

// ── P1-D: preview before commit (docs/DESIGN-route-editing.md B4) ──

const confirmSlot = routeMap.slice(routeMap.indexOf("function ConfirmSlot"), routeMap.indexOf("// ── /P1-D: imports ──"));
/** Class strings in a slice of JSX, so `aria-hidden` never counts as `hidden`. */
const classNames = (jsx: string): string => [...jsx.matchAll(/className=\{?[`"]([^`"]*)[`"]/g)].map((x) => x[1]).join(" ");

test("a busy ✓ keeps slot 3: a spinner in the same button, still pressable, never `hidden`", () => {
  assert.ok(confirmSlot.length > 0, "ConfirmSlot exists");
  const bar = routeMap.slice(routeMap.indexOf("function DesktopBar"), routeMap.indexOf("function PhoneColumn"));
  const col = routeMap.slice(routeMap.indexOf("function PhoneColumn"), routeMap.indexOf("export function RouteMap("));
  // Both bars draw the one ✓ in slot 3, whatever its state — not only when
  // Confirm can act, and not swapped for another element while busy.
  assert.match(bar, /\{pending && !pending\.offRoad && <ConfirmSlot pending=\{pending\} round=\{round\} data-slot="3" \/>\}/);
  assert.match(col, /\{pending && !pending\.offRoad && <ConfirmSlot pending=\{pending\} round=\{round\} phone data-slot="3" \/>\}/);
  // One <button>, one data-slot, the icon swapped inside it.
  assert.equal(confirmSlot.match(/<button /g)?.length, 1);
  assert.match(confirmSlot, /<button [^>]*data-slot=\{slot\}/);
  assert.match(confirmSlot, /busy\s*\? <LoaderCircle [^>]*animate-spin/);
  // Busy is still pressable: only a missing onConfirm or a refusal disables.
  assert.match(confirmSlot, /const onConfirm = refused \? null : pending\.onConfirm;/);
  assert.match(confirmSlot, /disabled=\{!onConfirm\}/);
  assert.match(confirmSlot, /busy \? m\.previewConfirmQueued/);
  assert.match(confirmSlot, /refused \? m\.previewConfirmRefused/);
  // Never hidden; `invisible` only on the phone, the column's own rule.
  // (The desktop row's own `max-md:hidden` is the row itself, not a slot.)
  const fences = [bar, col].map((x) => x.slice(x.indexOf("── P1-D:"), x.indexOf("── /P1-D:"))).join("\n");
  for (const jsx of [confirmSlot, fences]) assert.doesNotMatch(classNames(jsx) + " " + jsx.replace(/aria-hidden/g, ""), /(^|[\s:"`])hidden(\s|$|["`])/);
  assert.match(confirmSlot, /\$\{phone && idle \? "invisible" : ""\}/);
});

test("the proposal chip renders in the notice slot, above the bar and clear of the right column", () => {
  const open = routeMap.indexOf("{/* ── P1-D: notice ── */}"), close = routeMap.indexOf("{/* ── /P1-D: notice ── */}");
  const slot = routeMap.slice(open, close);
  // Inside the bottom chrome (the reversed column over the bar), after the bar.
  const chrome = routeMap.indexOf("ref={headerRef} data-map-chrome");
  assert.ok(chrome > 0 && routeMap.indexOf("<PhoneColumn controls={controls} />") < open && chrome < open);
  // The chip takes the notice's place rather than stacking beside it.
  assert.match(slot, /\{controls && proposal \? \(\s*<div role="status" data-proposal-chip=/);
  assert.match(slot, /\) : controls\?\.notice && \(/);
  assert.match(slot, /title=\{proposal\.title\} aria-label=\{proposal\.title\}/);
  assert.match(slot, /\{proposal\.text\}/);
  assert.match(slot, /self-start/);
  assert.match(slot, /max-md:mr-16/);
  // Routing: a quiet spinner. Refused: the warning's amber, not a badge.
  assert.match(slot, /proposal\.tone === "routing" && <LoaderCircle/);
  assert.match(slot, /proposal\.tone === "refused" \? "border-amber-300 bg-amber-50\/95 text-amber-900"/);
});

test("the proposal's yellow halo covers exactly the changed metres", async () => {
  const { haloLines } = await import("../components/map/proposal-layer");
  const { cumulative } = await import("../lib/routing/detour");
  // Two features along a meridian, ~1.11 km per 0.01°.
  const seg = (coords: number[][]) => ({ type: "Feature" as const, properties: {} as never, geometry: { type: "LineString" as const, coordinates: coords } });
  const line = { type: "FeatureCollection" as const, features: [seg([[24, 56], [24, 56.01], [24, 56.02]]), seg([[24, 56.02], [24, 56.03]])] };
  const halo = haloLines(line, [[500, 2500], [9e9, 1e10], [100, 100]]);
  // Past the end clamps to the end and is then empty; zero length is dropped.
  assert.equal(halo.features.length, 1);
  const got = cumulative(halo.features[0].geometry.coordinates as [number, number][]);
  assert.ok(Math.abs(got[got.length - 1] - 2000) < 1, `2000 m, got ${got[got.length - 1]}`);
  assert.equal(halo.features[0].geometry.coordinates.length, 4, "from, two vertices inside, to");
});
