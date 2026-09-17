"use client";

import { seedCountryLocale } from "@/lib/i18n/use-locale";
import type { UiLocale } from "@/lib/i18n/locale";

/**
 * Hands the server's IP-country guess to the client locale store.
 *
 * `app/layout.tsx` reads `x-vercel-ip-country` on the server and renders the
 * language it implies into `<html data-ip-locale>`. That attribute is what the
 * client reads back during hydration — but the *server's* own render of every
 * `useLocale()` consumer happens in the same pass, with no document to read,
 * so it needs the value handed to it directly.
 *
 * It arrives as a prop rather than through a module-level variable on purpose:
 * module state is shared by every request a Node instance serves at once, so a
 * Latvian rider and an Estonian one arriving together would overwrite each
 * other's language. A prop belongs to one render.
 *
 * Seeding happens during render rather than in an effect because the value
 * must already be in place the first time a consumer reads the store — an
 * effect runs after that first read, which is the setState-in-effect the store
 * exists to avoid.
 */
export function LocaleBoundary({ locale }: { locale: UiLocale | null }) {
  seedCountryLocale(locale);
  return null;
}
