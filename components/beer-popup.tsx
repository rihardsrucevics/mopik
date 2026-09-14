"use client";

import { useEffect } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import Image from "next/image";
import { AUTHOR_INSTAGRAM_URL, InstagramLink } from "@/components/instagram-link";
import { X } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * After a GPX download: a full-screen, dark thank-you in the colour of the
 * Revolut QR card. One button to the 5 EUR link, the QR for riders on a
 * desktop, and every way to skip it (×, outside click, Escape).
 */
export const BEER_LINK = "https://revolut.me/rucijs";

export function BeerPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [locale] = useLocale();
  const m = messages(locale);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    track("beer_popup");
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);
  if (!open) return null;
  const onBeer = () => track("beer_click", { link: BEER_LINK });

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="beer-title" onClick={onClose}
      className="mopik-fade-in fixed inset-0 z-50 flex items-center justify-center bg-[#201f25]/95 p-5 text-stone-100 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#201f25] p-7 text-center shadow-2xl">
        <button type="button" onClick={onClose} aria-label={m.close} className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full text-stone-400 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        {/* The two-finger wave riders give each other. It thanks without
            selling anything, which a beer glass on a screen shown to someone
            about to ride does not. */}
        <div className="mx-auto flex size-16 items-center justify-center text-5xl" aria-hidden="true">✌️</div>
        <h2 id="beer-title" className="mt-3 text-2xl font-bold tracking-tight">{m.beerRideWell}</h2>
        <a href={BEER_LINK} target="_blank" rel="noopener noreferrer" onClick={onBeer}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#ff7a1f]">
          {m.beerBuy}
        </a>
        {/* Two ways to say thanks, offered as equals: pay, or follow. Neither
            is the small print of the other. Closing is the ✕ or a tap outside;
            a "maybe later" button only added a third way out. */}
        <div className="mt-2.5">
          <InstagramLink from="beer" label="Piesekot @mopik.eu"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-stone-600 text-sm font-semibold text-stone-100 transition hover:border-stone-400 hover:bg-white/5" />
          <p className="mx-auto mt-2 max-w-[15rem] text-[11px] leading-snug text-stone-500">{m.beerTagline}</p>
        </div>
        {/* Desktop: the phone scans this. Below both buttons — between them it
            split the pair and made the second read as an afterthought. */}
        <div className="mt-5 hidden flex-col items-center gap-2 md:flex">
          <Image src="/revolut-qr-dark.svg" alt={m.beerQrAlt} width={132} height={132} unoptimized className="rounded-xl" />
          <span className="text-[11px] text-stone-500">{m.beerScan}</span>
        </div>
        {/* Who is behind it, quietly, at the very bottom — the author's own
            account, not Mopik's, so the two links mean different things. */}
        <p className="mt-6">
          {/* No mark here: the pill above already carries it, and a second one
              on an 11 px credit line reads as a badge rather than a byline. */}
          <a href={AUTHOR_INSTAGRAM_URL} target="_blank" rel="noopener noreferrer"
            onClick={() => track("instagram_opened", { from: "beer-author" })}
            className="text-[11px] text-stone-600 transition hover:text-stone-400">
            {m.beerAuthor}
          </a>
        </p>
      </div>
    </div>
  );
}
