"use client";

import { InstagramLink } from "@/components/instagram-link";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";

/**
 * The footer.
 *
 * It exists mostly to empty the header. "Sazinies" was competing there with
 * the one thing a rider comes for — planning a ride — and the header had no
 * room left for the language picker. Everything that is read once and then
 * never again lives down here instead.
 *
 * Deliberately quiet: small type, muted colour, a hairline above it. A footer
 * that draws the eye is a footer taking attention from the map.
 */
export function SiteFooter() {
  const [locale] = useLocale();
  const year = new Date().getFullYear();

  return (
    <footer className="mx-auto w-full max-w-[1600px] px-4 pb-8 pt-10 md:px-7">
      <div className="flex flex-col gap-4 border-t border-stone-200 pt-5 text-xs text-stone-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="font-semibold tracking-tight text-stone-900">
            Mopik<span className="text-[#f56300]">.</span>
          </p>
          <p>{t(locale, "tagline")}</p>
        </div>

        {/* Saved rides are not here: the header carries them with an unread
            count, and a second link to the same page in a quieter place only
            asks the rider which one to trust. Feedback is a DM, not a form —
            see `instagram-link.tsx`. */}
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label={t(locale, "footerNav")}>
          <InstagramLink from="footer" label={t(locale, "contact")} />
        </nav>
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-stone-400">
        {t(locale, "footerOsm")}{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-stone-600"
        >
          OpenStreetMap
        </a>
        {t(locale, "footerOsmTail")}{" "}
        {t(locale, "footerDisclaimer")} © {year} Mopik
      </p>
    </footer>
  );
}
