import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";

const SITE_URL = "https://www.mopik.eu";
const GA_ID = "G-M01X58GWMC";
const TITLE = "Mopik — adventure moto maršruti Latvijā";
const DESCRIPTION =
  "Mazāk plānošanas. Vairāk braukšanas. Mopik uzzīmē adventure un enduro maršrutus pa grants un meža ceļiem — no ieceres līdz GPX dažās sekundēs.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s · Mopik" },
  description: DESCRIPTION,
  applicationName: "Mopik",
  keywords: ["adventure moto", "enduro maršruti", "grants ceļi", "meža ceļi", "GPX", "Latvija", "Baltija", "motocikls"],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Mopik",
    locale: "lv_LV",
    title: TITLE,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#faf9f6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="lv" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        {/* Google Analytics (gtag.js), loaded after hydration so it never delays the page. */}
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`} strategy="afterInteractive" />
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
