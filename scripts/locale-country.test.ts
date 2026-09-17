import test from "node:test";
import assert from "node:assert/strict";
import { localeFromCountry, localeFromBrowser, isUiLocale } from "../lib/i18n/locale";

/**
 * The rider's ask, in his words: a Latvian IP must load in Latvian, an
 * Estonian one in Estonian, a Lithuanian one in Lithuanian, everywhere else
 * English.
 *
 * `localeFromCountry` is the pure half of that — it maps Vercel's
 * `x-vercel-ip-country` to a UI language. The header itself is not tested
 * here: it is Vercel's edge, not ours, and a test that mocks it would only
 * assert that the mock works.
 *
 * The distinction that matters is `null` vs `"en"`. No header at all (local
 * development, any host that is not Vercel) is `null`, which means "no IP
 * signal, go and ask the browser". A header naming a country we do not speak
 * is a real answer, and that answer is English.
 */

test("the three home countries each get their own language", () => {
  assert.equal(localeFromCountry("LV"), "lv");
  assert.equal(localeFromCountry("EE"), "et");
  assert.equal(localeFromCountry("LT"), "lt");
});

test("Estonia is 'et', not 'ee' — the country code and the language differ", () => {
  // The one mapping that is not a lowercased country code, and so the one
  // most likely to be broken by a well-meaning simplification.
  assert.equal(localeFromCountry("EE"), "et");
  assert.ok(isUiLocale("et"));
  assert.ok(!isUiLocale("ee"));
});

test("everywhere else is English, including countries whose language we do not speak", () => {
  for (const code of ["DE", "FI", "SE", "RU", "PL", "GB", "US", "FR", "NO"]) {
    assert.equal(localeFromCountry(code), "en", `${code} should fall through to English`);
  }
});

test("a missing header is null, not a language — the browser decides next", () => {
  // This is the local-development and non-Vercel case. Returning "en" here
  // would silently override the browser list, which is a better signal than
  // nothing at all.
  assert.equal(localeFromCountry(null), null);
  assert.equal(localeFromCountry(undefined), null);
  assert.equal(localeFromCountry(""), null);
});

test("a malformed code is null rather than a wrong guess", () => {
  for (const bad of ["L", "LVA", "latvia", "12345", " "]) {
    assert.equal(localeFromCountry(bad), null, `${JSON.stringify(bad)} should not resolve`);
  }
});

test("case and stray whitespace do not change the answer", () => {
  // Vercel sends upper case, but a proxy in front of it may not.
  assert.equal(localeFromCountry("lv"), "lv");
  assert.equal(localeFromCountry("Lv"), "lv");
  assert.equal(localeFromCountry(" LV "), "lv");
  assert.equal(localeFromCountry("ee"), "et");
});

/**
 * The precedence the rider asked for is: stored choice > IP country > browser
 * languages > default. The store wires those together; here we pin the two
 * pure functions' relationship at the one point they disagree, so that a
 * future change cannot quietly reorder them.
 */
test("IP country outranks the browser list, and they can disagree", () => {
  // The case the rider asked for: a Latvian rider whose phone is set to
  // English. The browser list says English; the IP says Latvia, and because
  // the country is consulted first he gets Latvian.
  assert.equal(localeFromCountry("LV"), "lv");
  assert.equal(localeFromBrowser(["en-GB", "en"]), "en");

  // The cost of that ordering, stated plainly so it is a decision and not a
  // surprise: a Latvian speaker browsing from Germany gets English, because
  // the country answers "en" before the browser list is ever read. Only a
  // country with no header at all (null) defers to the browser.
  assert.equal(localeFromCountry("DE"), "en");
  assert.equal(localeFromBrowser(["lv-LV", "lv", "en"]), "lv");
  assert.equal(localeFromCountry(null), null, "only a missing header defers to the browser");
});
