/**
 * The interface language.
 *
 * Latvian for Latvians, Lithuanian for Lithuanians, Estonian for Estonians,
 * English for everyone else — the rider's own wording. Latvian stays the
 * default because it is the home market and the language every string was
 * written in; a rider whose browser says otherwise is switched on first load.
 *
 * Kept apart from `Locale` in `name-route.ts`, which is a different thing: it
 * picks the language a *route name* is generated in from the prompt text, and
 * only has lv/en because that is what the POI dataset carries. The two meet in
 * `app/page.tsx`, where the UI language is sent with a generation so a route
 * asked for in Estonian is not named in English by accident.
 */
export const UI_LOCALES = ["lv", "lt", "et", "en"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_LOCALE: UiLocale = "lv";

/** Shown in the picker, in each language's own words. */
export const LOCALE_LABELS: Record<UiLocale, string> = {
  lv: "Latviski",
  lt: "Lietuviškai",
  et: "Eesti",
  en: "English",
};

/** Two letters for the header, where the full name does not fit. */
export const LOCALE_SHORT: Record<UiLocale, string> = {
  lv: "LV",
  lt: "LT",
  et: "ET",
  en: "EN",
};

export function isUiLocale(value: unknown): value is UiLocale {
  return typeof value === "string" && (UI_LOCALES as readonly string[]).includes(value);
}

/**
 * The language to start in, from the browser's own preference list.
 *
 * `navigator.languages` is ordered by preference, so the first entry Mopik
 * speaks wins — a rider whose list is `lt, ru, en` gets Lithuanian rather
 * than English. Anything we do not speak falls through to English, not to
 * Latvian: someone browsing in German is better served by English than by a
 * language they cannot read at all.
 */
export function localeFromBrowser(languages: readonly string[]): UiLocale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split("-")[0];
    if (isUiLocale(base)) return base;
  }
  return "en";
}

const STORAGE_KEY = "mopik.locale.v1";

export function loadStoredLocale(): UiLocale | null {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return isUiLocale(raw) ? raw : null;
  } catch {
    // Private windows and blocked site data throw rather than return null.
    return null;
  }
}

export function saveStoredLocale(locale: UiLocale): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // A language that does not persist is still better than a crash.
  }
}
