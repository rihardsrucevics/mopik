import type { Metadata } from "next";
import { headers } from "next/headers";
import { HomePage } from "@/components/home-page";
import { localeFromCountry, isUiLocale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/messages";
import { DEFAULT_METADATA_LOCALE } from "@/lib/i18n/metadata-locale";
import { SITE_URL } from "@/lib/site";

/**
 * A server shell around the composer, which is a client component and so
 * cannot carry `generateMetadata` itself.
 *
 * It exists for one reason: `?lang=` has to reach the share card. The country
 * header tells us where the *unfurling server* sits, which is arbitrary —
 * Facebook's crawler is not in the rider's country, so a link sent from Tallinn
 * unfurled through a datacentre elsewhere would come back in the wrong
 * language. An explicit `?lang=` in the URL is the only signal that travels
 * with the link itself, and it is what the language picker now writes.
 */
export async function generateMetadata({ searchParams }: PageProps<"/">): Promise<Metadata> {
  const { lang } = await searchParams;
  const requested = Array.isArray(lang) ? lang[0] : lang;
  // Precedence: what the link says > where the request came from > English.
  // The query wins because it was chosen deliberately by whoever shared it;
  // the country is only ever a guess, and for a crawler it is a guess about a
  // datacentre. Validated rather than trusted — `?lang=` is user input.
  const locale = (isUiLocale(requested) ? requested : null)
    ?? localeFromCountry((await headers()).get("x-vercel-ip-country"))
    ?? DEFAULT_METADATA_LOCALE;
  const title = t(locale, "metaTitle");
  const description = t(locale, "metaDescription");
  /**
   * The language has to be *in the shared URL*, not just in this response.
   *
   * iOS Safari's share sheet copies the canonical link, not the address bar:
   * the rider opened `?lang=et`, pressed Share, and got a bare mopik.eu that
   * unfurled in whatever language the crawler's datacentre implied. So the
   * canonical carries the language whenever one was asked for — and only
   * then, so a plain visit still canonicalises to the clean root and the four
   * languages do not compete as duplicates in search.
   */
  const query = isUiLocale(requested) ? `?lang=${locale}` : "";
  const canonical = `${SITE_URL}${query}`;
  // Next merges metadata *shallowly*, so this object replaces the layout's
  // `openGraph` outright — every field the card needs has to be here, not
  // just the ones that change. Dropping `url` and `siteName` is exactly the
  // bug this comment exists to prevent.
  return {
    title,
    description,
    alternates: { canonical },
    openGraph: {
      type: "website",
      siteName: "Mopik",
      url: canonical,
      locale,
      title,
      description,
      images: [{ url: `/card${query}`, width: 1200, height: 630, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [{ url: `/card${query}`, alt: title }],
    },
  };
}

export default function Page() {
  return <HomePage />;
}
