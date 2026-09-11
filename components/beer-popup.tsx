"use client";

import { useEffect } from "react";
import Image from "next/image";
import { X } from "lucide-react";

/**
 * After a GPX download: a full-screen, dark thank-you in the colour of the
 * Revolut QR card. One button to the 5 EUR link, the QR for riders on a
 * desktop, and every way to skip it (×, outside click, Escape).
 */
export const BEER_LINK = "https://revolut.me/rucijs/5eur";

declare global {
  interface Window { gtag?: (...args: unknown[]) => void }
}

export function BeerPopup({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    try { window.gtag?.("event", "beer_popup"); } catch { /* optional */ }
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [open, onClose]);
  if (!open) return null;
  const track = () => { try { window.gtag?.("event", "beer_click", { link: BEER_LINK }); } catch { /* optional */ } };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="beer-title" onClick={onClose}
      className="mopik-fade-in fixed inset-0 z-50 flex items-center justify-center bg-[#201f25]/95 p-5 text-stone-100 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-[#201f25] p-7 text-center shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Aizvērt" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full text-stone-400 transition hover:bg-white/10 hover:text-white"><X className="size-4" /></button>
        <svg viewBox="0 0 40 40" className="mx-auto size-16" aria-hidden="true">
          <path d="M 12 10 H 27 L 26 33 Q 19.5 35.5 13 33 Z" fill="#f5b733" stroke="#78716c" strokeWidth="1.2" strokeLinejoin="round" />
          <rect x="12.6" y="10.6" width="13.8" height="5" fill="#fffaf0" />
          <circle cx="15" cy="10" r="2.6" fill="#fffaf0" /><circle cx="20" cy="8.6" r="3.2" fill="#fffaf0" /><circle cx="25" cy="10" r="2.6" fill="#fffaf0" />
          <path d="M 27 16 q 6 0 6 5.5 q 0 5.5 -5.5 6" fill="none" stroke="#78716c" strokeWidth="1.2" strokeLinecap="round" />
          <circle cx="17" cy="26" r="0.9" fill="#fff7d6" /><circle cx="21" cy="22" r="0.7" fill="#fff7d6" /><circle cx="23" cy="29" r="0.8" fill="#fff7d6" />
        </svg>
        <h2 id="beer-title" className="mt-3 text-2xl font-bold tracking-tight">GPX ir tavs. Lai labi brauc!</h2>
        <p className="mt-2 text-sm text-stone-400">Ja trase patika, uzsauc man aliņu.</p>
        <a href={BEER_LINK} target="_blank" rel="noopener noreferrer" onClick={track}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#ff7a1f]">
          5 € caur Revolut 🍺
        </a>
        {/* Desktop: the phone scans this. */}
        <div className="mt-5 hidden flex-col items-center gap-2 md:flex">
          <Image src="/revolut-qr-dark.svg" alt="QR kods: revolut.me/rucijs, 5 €" width={132} height={132} unoptimized className="rounded-xl" />
          <span className="text-[11px] text-stone-500">Noskenē ar telefonu</span>
        </div>
        <button type="button" onClick={onClose} className="mt-5 text-xs text-stone-500 underline decoration-stone-600 underline-offset-4 hover:text-stone-300">Varbūt citreiz</button>
      </div>
    </div>
  );
}
