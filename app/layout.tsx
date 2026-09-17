import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { LocaleBoundary } from "@/components/locale-boundary";
import { SiteFooter } from "@/components/site-footer";
import { DEFAULT_LOCALE, localeFromCountry } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/messages";
import { DEFAULT_METADATA_LOCALE } from "@/lib/i18n/metadata-locale";
import "./globals.css";

const SITE_URL = "https://www.mopik.eu";
const GA_ID = "G-M01X58GWMC";
/**
 * The site-wide defaults. The home page overrides the title and description
 * per request in `app/page.tsx`, which can also read `?lang=` — a layout gets
 * no `searchParams`, and the query is the only language signal that travels
 * with a shared link.
 *
 * A *shared route's* card is a third case again, handled in
 * `lib/share/card-locale.ts`: it follows the rider who made the ride.
 */
export async function generateMetadata(): Promise<Metadata> {
  const ipLocale = localeFromCountry((await headers()).get("x-vercel-ip-country"));
  const locale = ipLocale ?? DEFAULT_METADATA_LOCALE;
  const title = t(locale, "metaTitle");
  const description = t(locale, "metaDescription");
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: title, template: "%s · Mopik" },
    description,
    applicationName: "Mopik",
    // Europe first, but the Baltics stay: routing works Europe-wide, while the
    // profile is calibrated on Latvian roads and place names are a Baltic
    // dataset — dropping them would cost the searches that actually convert.
    keywords: ["adventure motorcycle", "enduro routes", "gravel roads", "forest roads", "GPX", "Europe", "Baltics", "Latvia", "motorcycle"],
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      url: SITE_URL,
      siteName: "Mopik",
      locale,
      title,
      description,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    robots: { index: true, follow: true },
  };
}

export const viewport: Viewport = {
  themeColor: "#faf9f6",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  /**
   * Where the rider is, decided on the server so the page arrives already in
   * the right language rather than flipping to it after hydration. Vercel's
   * edge sets `x-vercel-ip-country`; locally it is absent and this is `null`,
   * which the client reads as "no IP signal" and falls back to the browser's
   * own language list. Reading a header makes this route dynamic, which is
   * what we want — a cached page cannot be per-country.
   */
  const country = (await headers()).get("x-vercel-ip-country");
  const ipLocale = localeFromCountry(country);

  return (
    <html
      lang={ipLocale ?? DEFAULT_LOCALE}
      data-ip-locale={ipLocale ?? undefined}
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">
        {/* Seeds the locale store with the IP country before anything reads
            it, so the server render and the hydration render agree. */}
        <LocaleBoundary locale={ipLocale} />
        {/* `flex-1` on the page keeps the footer at the bottom of a short
            page without pinning it over the content of a long one. */}
        <div className="flex-1">{children}</div>
        <SiteFooter />
        <AnalyticsProvider />
        {/* Google Analytics (gtag.js), loaded after hydration so it never delays the page. */}
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
        {/* eslint-disable-next-line react/jsx-no-literals -- a script body, not user-visible text */}
        <Script id="ga-init" strategy="afterInteractive">{`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}');
        `}</Script>
      </body>
    </html>
  );
}
