"use client";

import Image from "next/image";

/**
 * "Uzsauc man aliņu": a small thank-you line under a finished route. The link
 * is a Revolut payment link with the amount in the path (5 EUR); the QR code
 * in `public/revolut-qr.svg` encodes the same link for riders on a desktop,
 * who scan it with the phone they will ride with anyway.
 */
export const BEER_LINK = "https://revolut.me/rucijs/5eur";

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

export function BeerBanner() {
  const track = () => { try { window.gtag?.("event", "beer_click", { link: BEER_LINK }); } catch { /* analytics is optional */ } };
  return (
    <aside aria-label="Uzsauc man aliņu" className="flex items-center gap-3 rounded-xl border border-dashed border-[#f5630055] bg-[#fff8f2] px-3 py-2.5">
      <svg viewBox="0 0 40 40" className="size-9 shrink-0" aria-hidden="true">
        <path d="M 12 10 H 27 L 26 33 Q 19.5 35.5 13 33 Z" fill="#f5b733" stroke="#a8a29e" strokeWidth="1.4" strokeLinejoin="round" />
        <rect x="12.6" y="10.6" width="13.8" height="5" fill="#fffaf0" />
        <circle cx="15" cy="10" r="2.6" fill="#fffaf0" /><circle cx="20" cy="8.6" r="3.2" fill="#fffaf0" /><circle cx="25" cy="10" r="2.6" fill="#fffaf0" />
        <path d="M 27 16 q 6 0 6 5.5 q 0 5.5 -5.5 6" fill="none" stroke="#a8a29e" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="17" cy="26" r="0.9" fill="#fff7d6" /><circle cx="21" cy="22" r="0.7" fill="#fff7d6" /><circle cx="23" cy="29" r="0.8" fill="#fff7d6" />
      </svg>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-stone-900">Patika trase? Uzsauc man aliņu.</div>
        <div className="text-[11px] text-stone-500">Mopik ir viena cilvēka vakaru projekts. Aliņš = 5 € caur Revolut.</div>
      </div>
      <a href={BEER_LINK} target="_blank" rel="noopener noreferrer" onClick={track}
        className="shrink-0 rounded-full bg-stone-900 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#f56300]">
        5 € 🍺
      </a>
      {/* Desktop: scan with the phone instead of typing the link. */}
      <a href={BEER_LINK} target="_blank" rel="noopener noreferrer" onClick={track} className="hidden shrink-0 md:block" title="Noskenē ar telefonu">
        <Image src="/revolut-qr.svg" alt="QR kods: revolut.me/rucijs, 5 €" width={56} height={56} className="rounded-md border border-stone-200" unoptimized />
      </a>
    </aside>
  );
}
