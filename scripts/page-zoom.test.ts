import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isEditable, isPageZoomed, withMaximumScaleOne } from "../lib/map/page-zoom";

/**
 * The page must not zoom under the phone's full-screen map (rider's iPhone,
 * 2026-09-27: "I accidentally zoom the page — the whole UI — and then I can
 * barely get back").
 *
 * `npx tsx --test scripts/page-zoom.test.ts`
 */

const ROOT = join(__dirname, "..");

test("a field under 16 px on a phone is what made iOS zoom: none is left", () => {
  // Every <input>/<textarea> in the components: a font size below 16 px
  // (text-xs, text-sm, text-[Npx] under 16) must carry a breakpoint prefix
  // (`md:text-sm`), so the phone gets 16 px. The map field was bare `text-sm`.
  const dir = join(ROOT, "components");
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith(".tsx"));
  const offenders: string[] = [];
  for (const f of files) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/<(input|textarea)\b[\s\S]*?\/>/g)) {
      const tag = m[0];
      if (/type="(checkbox|radio|range|hidden|button|submit)"/.test(tag)) continue;
      for (const tok of tag.match(/(?<![\w:-])text-(xs|sm|\[(\d+(?:\.\d+)?)px\])(?![\w-])/g) ?? []) {
        const px = tok.match(/\[(\d+(?:\.\d+)?)px\]/);
        if (px && Number(px[1]) >= 16) continue;
        offenders.push(`${f}: ${tok}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("the map field is 16 px on a phone, 14 px from md up", () => {
  const src = readFileSync(join(ROOT, "components/place-input.tsx"), "utf8");
  assert.match(src, /compact \? "text-base md:text-sm"/);
});

test("full screen and the phone's point sheet take no page pinch or double-tap", () => {
  const panel = readFileSync(join(ROOT, "components/map-panel.tsx"), "utf8");
  assert.match(panel, /group\/panel fixed inset-0 z-40 flex touch-none/);
  assert.match(panel, /\[&_\[role=listbox\]\]:touch-pan-y/);
  assert.match(panel, /guardFullscreenZoom\(\)/);
  const sheet = readFileSync(join(ROOT, "components/map-point-sheet.tsx"), "utf8");
  assert.match(sheet, /fixed inset-x-0 bottom-0 z-50 touch-none/);
});

test("the site keeps user zoom: the viewport sets no maximum-scale", () => {
  const layout = readFileSync(join(ROOT, "app/layout.tsx"), "utf8");
  const viewport = layout.slice(layout.indexOf("export const viewport"));
  const block = viewport.slice(0, viewport.indexOf("};"));
  assert.doesNotMatch(block, /maximumScale|userScalable/);
});

test("zoomed is above rounding noise", () => {
  assert.equal(isPageZoomed(1), false);
  assert.equal(isPageZoomed(1.005), false);
  assert.equal(isPageZoomed(1.4), true);
  assert.equal(isPageZoomed(undefined), false);
  assert.equal(isPageZoomed(Number.NaN), false);
});

test("the reset adds maximum-scale=1 and keeps the rest in order", () => {
  assert.equal(withMaximumScaleOne("width=device-width, initial-scale=1"), "width=device-width, initial-scale=1, maximum-scale=1");
  assert.equal(withMaximumScaleOne("width=device-width,initial-scale=1,maximum-scale=5"), "width=device-width, initial-scale=1, maximum-scale=1");
  assert.equal(withMaximumScaleOne("width=device-width, user-scalable=yes"), "width=device-width, maximum-scale=1");
  assert.equal(withMaximumScaleOne(""), "maximum-scale=1");
});

test("typing in a field defers the reset; a button does not", () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as Element;
  assert.equal(isEditable(el("INPUT", { type: "text" })), true);
  assert.equal(isEditable(el("INPUT", { type: "search" })), true);
  assert.equal(isEditable(el("TEXTAREA")), true);
  assert.equal(isEditable(el("INPUT", { type: "checkbox" })), false);
  assert.equal(isEditable(el("BUTTON")), false);
  assert.equal(isEditable(el("DIV", { isContentEditable: true })), true);
  assert.equal(isEditable(null), false);
});
