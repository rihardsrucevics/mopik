import type { UiLocale } from "@/lib/i18n/locale";

/**
 * What the metadata says when nothing else answers.
 *
 * English, because a crawler with no country header is usually a datacentre
 * somewhere neutral, and English is the one language every audience can read.
 * This is a different question from `DEFAULT_LOCALE`, which is about what the
 * *interface* shows a rider, and from `DEFAULT_SHARE_LOCALE`, which is about
 * what old share links actually were.
 */
export const DEFAULT_METADATA_LOCALE: UiLocale = "en";
