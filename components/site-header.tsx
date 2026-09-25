"use client";

import Link from "next/link";
import { Bookmark, Plus } from "lucide-react";
import { SavedRidesLink } from "@/components/saved-rides-link";
import { LanguagePicker } from "@/components/language-picker";
import { BrandLogo } from "@/components/brand-logo";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";

/**
 * The one header, on all three pages.
 *
 * There used to be three of them: the main page's icon row, the saved list's
 * text links ("← Atpakaļ", "+ Jauns brauciens") and the shared route's single
 * "Uztaisīt savu". Switching pages changed the furniture, which is the thing
 * the rider noticed. The wordmark, the spacing, the border and the controls
 * are now written once here.
 *
 * The right-hand controls are always the same three slots in the same order —
 * new ride, saved rides, language — so nothing moves horizontally between
 * pages. What changes is only what each slot does:
 *
 * - `onNewRide` makes the plus a button (the main page clears its own state
 *   in place); without it the plus is a link to `/`, which is what "new ride"
 *   means from any other page. `newRideLabel` lets the shared route say
 *   "Uztaisīt savu" through the same control, since that page's call to
 *   action was exactly that.
 * - `savedActive` marks the bookmark as the current page. It stays rendered
 *   rather than being omitted: dropping it would shift the language picker
 *   left on one page out of three, which is the shifting we are removing —
 *   and a filled bookmark is also how the rider sees where they are. It
 *   becomes a `<span>` with `aria-current`, so a screen reader is not offered
 *   a link to the page it is already on.
 */
export function SiteHeader({
  onNewRide,
  newRideDisabled = false,
  newRideLabel,
  showNewRide = true,
  savedActive = false,
}: {
  /** Clear the current plan in place. Omitted: the plus links to `/`. */
  onNewRide?: () => void;
  newRideDisabled?: boolean;
  /** Overrides the plus's label — the shared route says "make your own". */
  newRideLabel?: string;
  showNewRide?: boolean;
  savedActive?: boolean;
}) {
  const [locale] = useLocale();
  const label = newRideLabel ?? t(locale, "newRide");
  // One class string for all three slots, so the hit areas and the hover
  // never drift apart between pages.
  const control =
    "inline-flex size-9 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-900";

  return (
    <header className="mb-5 flex items-center justify-between border-b border-stone-200 pb-4">
      <div className="flex items-center gap-3">
        <h1 className="flex text-2xl font-bold tracking-tight">
          {/* A plain `<a>`, not `<Link>`: a full reload on purpose, so the
              wordmark always lands on a clean, empty plan. The wordmark itself
              is decorative; the link's label is the accessible name. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/" aria-label={t(locale, "backToHome")} className="flex">
            <BrandLogo variant="wordmark" className="h-7 w-auto text-[#242426]" />
          </a>
        </h1>
        <p className="hidden text-xs text-stone-500 sm:block">{t(locale, "tagline")}</p>
      </div>
      <div className="flex items-center gap-4">
        {/* Icons only. Three words in a row (Saglabātie · Sazinies · Jauns
            brauciens) took most of a phone header for things a rider needs
            rarely; a plus is the same meaning in a fraction of the width, and
            the name still reaches a screen reader. */}
        {showNewRide &&
          (onNewRide ? (
            <button
              type="button"
              onClick={onNewRide}
              disabled={newRideDisabled}
              aria-label={label}
              title={label}
              className={`${control} disabled:opacity-40`}>
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
          ) : (
            <Link href="/" aria-label={label} title={label} className={control}>
              <Plus className="size-5" strokeWidth={1.75} />
            </Link>
          ))}
        {/* Saved rides stay in the header: a rider reaches for them mid-plan,
            unlike "Sazinies", which moved to the footer with everything else
            that is read once. The word went with it — the bookmark says the
            same thing in a fraction of the width, which is what the language
            picker needed. */}
        {savedActive ? (
          <span
            aria-current="page"
            title={t(locale, "savedRidesLong")}
            className="inline-flex size-9 items-center justify-center rounded-full bg-[#fff3ea] text-[#bd4b00]">
            <Bookmark className="size-5 fill-current" strokeWidth={1.75} />
          </span>
        ) : (
          <SavedRidesLink label={t(locale, "savedRides")} unseenLabel={t(locale, "savedRidesUnseen")} />
        )}
        <LanguagePicker />
      </div>
    </header>
  );
}
