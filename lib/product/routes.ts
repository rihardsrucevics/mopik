import { UI_LOCALES, type UiLocale } from "@/lib/i18n/locale";
import { SITE_URL } from "@/lib/site";

/**
 * The product page's address, one per language.
 *
 * The rest of the site is one URL per page with `?lang=` on top, because the
 * composer is an app: its state lives in React and a reload must not throw it
 * away. This page is the opposite — static text written for search — and a
 * search engine indexes a *URL*, so four languages on one address with a
 * query flag compete with each other as near-duplicates. Four real paths, each
 * in its own language, are what `hreflang` was made for.
 *
 * `?lang=` still works on all four: it redirects to the page in that language
 * (see `app/<slug>/page.tsx`), so a link written the site's usual way lands
 * where it should.
 */
export const PRODUCT_SLUGS: Record<UiLocale, string> = {
  lv: "funkcijas",
  lt: "funkcijos",
  et: "funktsioonid",
  en: "features",
};

/** The language search engines get when none of the four matches the reader. */
export const PRODUCT_DEFAULT_LOCALE: UiLocale = "en";

export function productPath(locale: UiLocale): string {
  return `/${PRODUCT_SLUGS[locale]}`;
}

export function productUrl(locale: UiLocale): string {
  return `${SITE_URL}${productPath(locale)}`;
}

/** Language → path, for the site header's picker on this page. */
export const PRODUCT_PATHS: Record<UiLocale, string> = Object.fromEntries(
  UI_LOCALES.map((l) => [l, productPath(l)]),
) as Record<UiLocale, string>;

/** `hreflang` → absolute URL, all four plus `x-default`. */
export function productAlternates(): Record<string, string> {
  const languages: Record<string, string> = {};
  for (const locale of UI_LOCALES) languages[locale] = productUrl(locale);
  languages["x-default"] = productUrl(PRODUCT_DEFAULT_LOCALE);
  return languages;
}

/** Open Graph wants language_TERRITORY; these are the home markets' pairs. */
export const OG_LOCALES: Record<UiLocale, string> = {
  lv: "lv_LV",
  lt: "lt_LT",
  et: "et_EE",
  en: "en_GB",
};
