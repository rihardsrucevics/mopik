import type { UiLocale } from "@/lib/i18n/locale";

/**
 * The language a share card falls back to when the code carries none.
 *
 * Latvian, not English, and not `DEFAULT_LOCALE` — those answer different
 * questions. This one is a statement about the links that already exist:
 * every share code made before `l` was added was made by a rider using the
 * app in Latvian, so Latvian is what those links actually were. Guessing
 * English would translate a Latvian ride into a language its sender never
 * chose.
 *
 * It lives here, in one place, because the shared page and the share image
 * must agree: a card whose title is Latvian and whose picture is English is
 * worse than either on its own.
 */
export const DEFAULT_SHARE_LOCALE: UiLocale = "lv";
