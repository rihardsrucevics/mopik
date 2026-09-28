/**
 * The product page: one path per language, each with its own metadata and the
 * same four `hreflang` alternates, and a footer link to it in every language.
 *
 * The language switch is the site's own globe picker (the rider's rule), and
 * on this page choosing a language goes to that language's path.
 *
 * `npx tsx --test scripts/product-page.test.ts`
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { UI_LOCALES } from "@/lib/i18n/locale";
import { seedCountryLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";
import { SITE_URL } from "@/lib/site";
import { PRODUCT_COPY, FEATURE_ORDER } from "@/lib/product/copy";
import { productJsonLd, productMetadata } from "@/lib/product/metadata";
import { PRODUCT_PATHS, PRODUCT_SLUGS, productPath, productUrl } from "@/lib/product/routes";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { pickerTarget } from "@/components/language-picker";
import { ProductPage, featureShots } from "@/components/product/product-page";
import { LOCALE_SHOT_SIZES, SHARED_SHOTS } from "@/lib/product/shots";
import sitemap from "@/app/sitemap";

const ROOT = path.resolve(__dirname, "..");

test("every language has its own path, and a page file behind it", () => {
  const slugs = UI_LOCALES.map((l) => PRODUCT_SLUGS[l]);
  assert.equal(new Set(slugs).size, UI_LOCALES.length, "four distinct slugs");
  assert.equal(productPath("lv"), "/funkcijas");
  for (const locale of UI_LOCALES) {
    const file = path.join(ROOT, "app", PRODUCT_SLUGS[locale], "page.tsx");
    assert.ok(fs.existsSync(file), `${file} exists`);
    assert.match(fs.readFileSync(file, "utf8"), new RegExp(`productMetadata\\("${locale}"\\)`), `${file} is the ${locale} page`);
  }
});

for (const locale of UI_LOCALES) {
  test(`metadata in ${locale}: title, description, canonical, hreflang, OG, Twitter`, () => {
    const m = productMetadata(locale);
    const copy = PRODUCT_COPY[locale];
    assert.deepEqual(m.title, { absolute: copy.meta.title });
    assert.equal(m.description, copy.meta.description);
    assert.ok(copy.meta.description.length >= 120 && copy.meta.description.length <= 300, "description fits a result snippet");

    assert.equal(m.alternates?.canonical, productUrl(locale));
    const languages = m.alternates?.languages as Record<string, string>;
    for (const other of UI_LOCALES) assert.equal(languages[other], `${SITE_URL}${productPath(other)}`);
    assert.equal(languages["x-default"], productUrl("en"));

    const og = m.openGraph as Record<string, unknown>;
    assert.equal(og.url, productUrl(locale));
    assert.equal(og.title, copy.meta.title);
    assert.equal(og.siteName, "Mopik");
    assert.match(String(og.locale), new RegExp(`^${locale}_`));
    assert.deepEqual((og.images as { url: string }[]).map((i) => i.url), [`/card?lang=${locale}`]);
    const tw = m.twitter as Record<string, unknown>;
    assert.equal(tw.card, "summary_large_image");
    assert.equal(tw.title, copy.meta.title);
  });

  test(`JSON-LD in ${locale}: WebApplication and FAQPage from the page's own copy`, () => {
    const [app, faq] = productJsonLd(locale) as Record<string, unknown>[];
    assert.equal(app["@type"], "WebApplication");
    assert.equal((app.featureList as string[]).length, FEATURE_ORDER.length);
    assert.equal(faq["@type"], "FAQPage");
    assert.equal((faq.mainEntity as unknown[]).length, PRODUCT_COPY[locale].faq.items.length);
    // Nothing Mopik cannot back up: no ratings, no review counts.
    assert.ok(!("aggregateRating" in app));
  });

  test(`the footer links to the ${locale} product page`, () => {
    seedCountryLocale(locale);
    const html = renderToStaticMarkup(createElement(SiteFooter));
    const href = `href="${productPath(locale)}"`;
    assert.ok(html.includes(href), `footer has ${href}`);
    assert.ok(html.includes(t(locale, "footerProduct")), "the link text is in the footer's language");
  });
}

test("the picker goes to the chosen language's path here, and nowhere elsewhere", () => {
  for (const locale of UI_LOCALES) assert.equal(pickerTarget(locale, PRODUCT_PATHS), productPath(locale));
  // Every other page passes no paths: the picker keeps writing `?lang=` in place.
  for (const locale of UI_LOCALES) assert.equal(pickerTarget(locale), null);
});

for (const locale of UI_LOCALES) {
  test(`the ${locale} page uses the site header with its globe picker, not text links`, () => {
    seedCountryLocale(locale);
    const html = renderToStaticMarkup(createElement(ProductPage, { locale }));
    assert.ok(html.includes('aria-haspopup="listbox"'), "the site's language picker is in the header");
    assert.ok(html.includes(t(locale, "savedRides")) || html.includes("href=\"/saglabatie\""), "the saved-rides icon is there too");
    assert.ok(!/<a [^>]*hreflang/i.test(html), "no visible language text links (hreflang stays in <head>)");
    assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1, "one <h1>: the hero, not the wordmark");
  });
}

/** Every picture a rendered page asks for, as public paths (next/image wraps them in /_next/image?url=). */
function imagePaths(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/(?:src|srcSet)="([^"]+)"/g)) {
    for (const part of m[1].split(",")) {
      const u = part.trim().split(" ")[0].replace(/&amp;/g, "&");
      if (u.startsWith("/_next/image")) out.add(decodeURIComponent(new URL(u, "http://x").searchParams.get("url") ?? ""));
      else if (u.startsWith("/product/")) out.add(u);
    }
  }
  return [...out];
}

for (const locale of UI_LOCALES) {
  test(`the ${locale} page shows its own screenshots, and every file exists`, () => {
    seedCountryLocale(locale);
    const paths = imagePaths(renderToStaticMarkup(createElement(ProductPage, { locale })));
    const localeShots = Object.keys(LOCALE_SHOT_SIZES);
    assert.ok(paths.length >= localeShots.length + Object.keys(SHARED_SHOTS).length, `found ${paths.length} images`);
    for (const p of paths) {
      assert.ok(fs.existsSync(path.join(ROOT, "public", p)), `${p} exists`);
      const m = p.match(/\/product\/([a-z-]+)\.([a-z]{2})\.webp$/);
      if (m) assert.equal(m[2], locale, `${p} is the ${locale} capture`);
      else assert.ok(Object.keys(SHARED_SHOTS).some((n) => p === `/product/${n}.webp`), `${p} is one of the wordless shared pictures`);
    }
    // Every per-locale capture is on the page, none silently missing.
    for (const name of localeShots) assert.ok(paths.includes(`/product/${name}.${locale}.webp`), `${name}.${locale} is used`);
  });
}

test("the manifest's sizes are the files' own", () => {
  // webp: 'RIFF' .... 'WEBP' 'VP8 ' / 'VP8L' / 'VP8X' — read the canvas size.
  const size = (file: string): [number, number] => {
    const b = fs.readFileSync(file);
    const kind = b.toString("ascii", 12, 16);
    if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const v = b.readUInt32LE(21); return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1]; }
    return [(b.readUIntLE(24, 3)) + 1, (b.readUIntLE(27, 3)) + 1];
  };
  for (const [name, per] of Object.entries(LOCALE_SHOT_SIZES))
    for (const [locale, wh] of Object.entries(per))
      assert.deepEqual(size(path.join(ROOT, "public/product", `${name}.${locale}.webp`)), [...wh], `${name}.${locale}`);
  for (const [name, wh] of Object.entries(SHARED_SHOTS)) assert.deepEqual(size(path.join(ROOT, "public/product", `${name}.webp`)), [...wh], name);
  assert.equal(featureShots("edit", "et")[0].src, "/product/edit-sheet.et.webp");
});

test("elsewhere the site header keeps the wordmark as its <h1>", () => {
  const html = renderToStaticMarkup(createElement(SiteHeader));
  assert.equal((html.match(/<h1[\s>]/g) ?? []).length, 1);
});

test("the sitemap lists all four product pages with their alternates", () => {
  const entries = sitemap();
  for (const locale of UI_LOCALES) {
    const entry = entries.find((e) => e.url === productUrl(locale));
    assert.ok(entry, `${locale} in the sitemap`);
    assert.equal(entry.alternates?.languages?.[locale as "lv"], productUrl(locale));
  }
});

test("the copy keeps the rider's rules", () => {
  const all = JSON.stringify(PRODUCT_COPY);
  assert.ok(!/piesit/i.test(all), "Latvian never says „piesit”");
  assert.ok(!/\b(alus|aliņ\w*|beer|cigaret\w*|tabak\w*|tobacco|alcohol|alkohol\w*)\b/i.test(all), "nothing about alcohol or tobacco");
  // The rider's typography for this page: en dash with spaces („ – ”), never an em dash.
  assert.ok(!all.includes("—"), "the product copy has no em dash");
  for (const locale of UI_LOCALES) {
    const m = productMetadata(locale);
    assert.ok(!JSON.stringify([m.title, m.description, productJsonLd(locale)]).includes("—"), `${locale} metadata and JSON-LD have no em dash`);
  }
  const lv = JSON.stringify(PRODUCT_COPY.lv);
  // No straight or English quotes inside the Latvian text (JSON escapes a straight one as \").
  assert.ok(!/“|\\"/.test(lv), "Latvian quotes are „ ”");
  // Honest limits are said, in every language.
  for (const locale of UI_LOCALES) assert.ok(PRODUCT_COPY[locale].honesty.items.length >= 3);
});
