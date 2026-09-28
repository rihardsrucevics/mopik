import type { MetadataRoute } from "next";
import { UI_LOCALES } from "@/lib/i18n/locale";
import { productAlternates, productUrl } from "@/lib/product/routes";
import { SITE_URL } from "@/lib/site";

/**
 * The pages worth indexing: the planner and the product page in its four
 * languages, each listing its siblings as `hreflang` alternates.
 *
 * Not here on purpose: `/saglabatie` (a device-local list, `noindex`) and
 * `/r/<code>` (one rider's ride, `noindex` — there are as many as riders
 * share, and none of them is a page someone searches for).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const languages = productAlternates();
  return [
    { url: SITE_URL, changeFrequency: "weekly", priority: 1 },
    ...UI_LOCALES.map((locale) => ({
      url: productUrl(locale),
      changeFrequency: "monthly" as const,
      priority: 0.8,
      alternates: { languages },
    })),
  ];
}
