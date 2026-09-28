import { redirect } from "next/navigation";
import { ProductPage } from "@/components/product/product-page";
import { isUiLocale, type UiLocale } from "@/lib/i18n/locale";
import { productPath } from "@/lib/product/routes";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * One of the four `app/<slug>/page.tsx` files, all alike.
 *
 * `?lang=` is how the rest of the site names a language, so a link written
 * that way — `/funkcijas?lang=en` — is sent to the page that *is* in English
 * rather than showing Latvian under an English query. The language of this
 * page is its path; the query is only ever a request to move.
 */
export async function ProductRoute({ locale, searchParams }: { locale: UiLocale; searchParams: SearchParams }) {
  const { lang } = await searchParams;
  const asked = Array.isArray(lang) ? lang[0] : lang;
  if (isUiLocale(asked) && asked !== locale) redirect(productPath(asked));
  return <ProductPage locale={locale} />;
}
