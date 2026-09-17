"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe } from "lucide-react";
import { track } from "@/lib/analytics";
import { LOCALE_LABELS, LOCALE_SHORT, UI_LOCALES, type UiLocale } from "@/lib/i18n/locale";
import { useLocale } from "@/lib/i18n/use-locale";

/**
 * The language picker: a globe with two letters, opening a short list.
 *
 * Four languages is too many for a row of chips in a header and too few for a
 * native `<select>`, which on iOS opens a full-height wheel for what is one
 * tap. Each language is named in itself — a rider looking for Lithuanian
 * finds "Lietuviškai", not "Lithuanian".
 */
export function LanguagePicker() {
  const [locale, setLocale] = useLocale();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const choose = (next: UiLocale) => {
    if (next !== locale) track("locale_changed", { locale: next });
    setLocale(next);
    /**
     * Put the choice in the address bar, so sharing a language is just
     * copying the URL.
     *
     * Without this there was no way to send someone Mopik in Estonian: the
     * card an unfurler builds follows *its own* server's country, and a
     * crawler sits wherever the messenger's datacentre is. `?lang=` is the
     * only signal that travels with the link.
     *
     * `replaceState`, not a navigation: the composer holds the ride being
     * planned in React state, and re-running the route would throw it away
     * just because the rider changed the language.
     */
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("lang", next);
      window.history.replaceState(null, "", url);
    }
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={LOCALE_LABELS[locale]}
        className="inline-flex h-9 items-center gap-1 rounded-full px-2 text-xs font-medium text-stone-600 transition hover:bg-stone-100 hover:text-stone-900"
      >
        <Globe className="size-4" strokeWidth={1.75} />
        {LOCALE_SHORT[locale]}
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 top-11 z-50 min-w-[160px] overflow-hidden rounded-xl border border-stone-200 bg-white py-1 shadow-lg"
        >
          {UI_LOCALES.map((code) => (
            <button
              key={code}
              type="button"
              role="option"
              aria-selected={code === locale}
              onClick={() => choose(code)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition hover:bg-stone-50 ${
                code === locale ? "font-semibold text-stone-900" : "text-stone-600"
              }`}
            >
              {LOCALE_LABELS[code]}
              {code === locale && <Check className="size-3.5 text-[#f56300]" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
