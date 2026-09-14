import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { POI_KIND, type PoiCategory } from "../lib/poi/kinds";
import { t, type MessageKey } from "../lib/i18n/messages";
import type { UiLocale } from "../lib/i18n/locale";

/**
 * Every POI category has a glyph and a word, in every language.
 *
 * ## What was wrong
 *
 * A rider was shown **"Gūtmaņa ala · ūdenskritums"** — the best-known cave in
 * Latvia, labelled a waterfall. `build_poi_dataset.py` queried
 * `natural=waterfall|cliff|cave_entrance` into one bucket and called all three
 * `waterfall`, so every cave and every cliff in the dataset carried the wrong
 * word. Three categories now, and these tests are what says so.
 *
 * The check that matters most is not the split itself but the *reachability*
 * of the label: a category that reaches the dataset without a `POI_KIND` entry
 * renders as a blank badge, and one whose key is missing from a dictionary
 * renders as the raw key ("kindCave") in that language. Both are silent — the
 * page still builds — which is why they are pinned here.
 */

const LOCALES: UiLocale[] = ["lv", "lt", "et", "en"];

/** The category list, read out of the Python build script rather than retyped.
 *
 * Retyping it would pass forever while the script drifted: the bug being
 * fixed here is precisely two lists that were supposed to agree and did not.
 */
function scriptCategories(): string[] {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts", "build_poi_dataset.py"),
    "utf-8"
  );
  const table = source.slice(
    source.indexOf("CATEGORIES = ["),
    source.indexOf("\n]", source.indexOf("CATEGORIES = ["))
  );
  return [...table.matchAll(/^ {4}\("([a-z]+)", \d+,/gm)].map((m) => m[1]);
}

test("the build script's categories are exactly the ones the app can render", () => {
  const fromScript = scriptCategories().sort();
  assert.ok(fromScript.length >= 13, `parsed only ${fromScript.length} categories`);
  assert.deepEqual(fromScript, Object.keys(POI_KIND).sort());
});

test("cave, cliff and waterfall are three categories, not one", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "scripts", "build_poi_dataset.py"),
    "utf-8"
  );
  for (const category of ["cave", "cliff", "waterfall"] as const) {
    assert.ok(POI_KIND[category], `${category} has no POI_KIND entry`);
  }
  // The old one-bucket match, in either path, is the bug itself. Comments are
  // stripped first: the fix's own comment names the pattern it removed, and
  // that history is worth keeping readable.
  const code = source
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  assert.ok(
    !/waterfall\|cliff\|cave_entrance/.test(code),
    "the build script still matches all three naturals into one category"
  );
  assert.ok(
    !/"waterfall", "cliff", "cave_entrance"/.test(code),
    "the .pbf matcher still puts all three naturals in one category"
  );
  assert.notEqual(POI_KIND.cave.key, POI_KIND.waterfall.key);
  assert.notEqual(POI_KIND.cliff.key, POI_KIND.waterfall.key);
});

test("every category's word exists in all four languages", () => {
  for (const [category, { key }] of Object.entries(POI_KIND)) {
    for (const locale of LOCALES) {
      const word = t(locale, key as MessageKey);
      assert.ok(word, `${locale}.${key} missing for category ${category}`);
      // The neighbouring kind keys are lower-case nouns ("ala", "klints");
      // a capitalised one reads as a heading in the middle of a row.
      assert.equal(
        word,
        word.toLocaleLowerCase(locale === "en" ? "en" : locale),
        `${locale}.${key} is not lower-case: ${word}`
      );
    }
  }
});

test("no two categories share a glyph", () => {
  const seen = new Map<string, PoiCategory>();
  for (const [category, { icon }] of Object.entries(POI_KIND)) {
    const clash = seen.get(icon);
    assert.equal(clash, undefined, `${category} and ${clash} both use ${icon}`);
    seen.set(icon, category as PoiCategory);
  }
});
