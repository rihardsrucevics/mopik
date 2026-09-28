import type { Metadata } from "next";
import { UI_LOCALES, type UiLocale } from "@/lib/i18n/locale";
import { SITE_URL } from "@/lib/site";
import { FEATURE_ORDER, PRODUCT_COPY } from "@/lib/product/copy";
import { OG_LOCALES, productAlternates, productUrl } from "@/lib/product/routes";

/**
 * The product page's metadata, per language.
 *
 * Next merges metadata *shallowly* (see `app/page.tsx`), so `openGraph` and
 * `twitter` here replace the layout's outright and must carry every field.
 * The card image is the site's own `/card?lang=` route — the same machinery
 * the home page uses, drawn in the page's language.
 *
 * `title.absolute` skips the layout's "%s · Mopik" template: the title already
 * starts with the name, and "Mopik … · Mopik" wastes the characters a search
 * result shows.
 */
export function productMetadata(locale: UiLocale): Metadata {
  const copy = PRODUCT_COPY[locale];
  const { title, description } = copy.meta;
  const url = productUrl(locale);
  const image = `/card?lang=${locale}`;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages: productAlternates() },
    openGraph: {
      type: "website",
      siteName: "Mopik",
      url,
      locale: OG_LOCALES[locale],
      alternateLocale: UI_LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALES[l]),
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: image, alt: title }],
    },
    robots: { index: true, follow: true },
  };
}

/**
 * JSON-LD: the app itself (`WebApplication`) and the page's FAQ (`FAQPage`).
 *
 * Only facts the page states: free, no account, four languages, a browser app.
 * No rating, no review count, no user numbers — Mopik has none to report, and
 * inventing them is exactly what the rider's "no guessing" rule forbids.
 */
export function productJsonLd(locale: UiLocale): object[] {
  const copy = PRODUCT_COPY[locale];
  const url = productUrl(locale);
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Mopik",
      url: SITE_URL,
      description: copy.meta.description,
      applicationCategory: "TravelApplication",
      operatingSystem: "Web",
      browserRequirements: "Requires JavaScript",
      inLanguage: [...UI_LOCALES],
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "EUR" },
      featureList: FEATURE_ORDER.map((id) => copy.features[id].title),
      screenshot: `${SITE_URL}/product/hero-ride.webp`,
      mainEntityOfPage: url,
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      inLanguage: locale,
      url,
      mainEntity: copy.faq.items.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ];
}

/** JSON for a `<script type="application/ld+json">`, safe to inline: no `</script>` can close it early. */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
