"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
  isUiLocale,
  loadStoredLocale,
  localeFromBrowser,
  saveStoredLocale,
  type UiLocale,
} from "@/lib/i18n/locale";

/**
 * The interface language as an external store, the same shape as
 * `use-ride-profile`: read from the device on first client render, written
 * back on every change. `useSyncExternalStore` gives the server the default
 * and lets React swap in the real value on the client without a hydration
 * mismatch or a setState-in-effect.
 *
 * Precedence, best signal first:
 *
 *   1. the rider's own stored choice — always wins, it is an explicit answer;
 *   2. the IP country, which `app/layout.tsx` reads from Vercel's
 *      `x-vercel-ip-country` on the server and writes onto `<html>`;
 *   3. the browser's language list;
 *   4. the default.
 *
 * The IP sits *above* the browser because a Latvian rider whose phone is set
 * to English should still get Latvian — which is exactly the rider's ask —
 * while a visitor from Germany with a Latvian browser keeps Latvian through
 * (3) rather than being forced to English.
 */
let current: UiLocale | null = null;
const listeners = new Set<() => void>();

/**
 * What the server put in the HTML. Present before React hydrates, which is
 * what lets the hydration render agree with the server render — see
 * `serverSnapshot` below.
 */
function localeFromDocument(): UiLocale | null {
  if (typeof document === "undefined") return null;
  const attr = document.documentElement.dataset.ipLocale;
  return isUiLocale(attr) ? attr : null;
}

function snapshot(): UiLocale {
  if (!current) {
    current =
      loadStoredLocale() ??
      localeFromDocument() ??
      (typeof navigator !== "undefined"
        ? localeFromBrowser(navigator.languages ?? [navigator.language])
        : DEFAULT_LOCALE);
  }
  return current;
}

/**
 * The value for the server render *and* for the client's hydration render —
 * React uses `getServerSnapshot` for both, which is the whole trick here.
 *
 * It must be a pure function of something both sides can see, and the only
 * such thing is the country locale: the server knows it from the header, and
 * the client reads it straight back off `<html data-ip-locale>`, which is in
 * the HTML before any script runs. So both renders produce identical markup.
 *
 * On the server the value arrives as a prop rather than through module state —
 * a module-level variable is shared by every concurrent request on the same
 * Node instance, which would leak one rider's country into another's page.
 * `LocaleFromCountry` in `components/locale-boundary.tsx` passes it down.
 *
 * The stored choice and the browser list are deliberately *not* consulted
 * here: the server cannot know them, so reading them during hydration is
 * exactly what would tear. They are applied a moment later, when React
 * subscribes and calls `snapshot()`.
 */
function serverSnapshot(): UiLocale {
  return localeFromDocument() ?? countryLocale ?? DEFAULT_LOCALE;
}

/**
 * The country locale for the render in progress.
 *
 * On the client this module is per-tab, so a plain variable is exactly right.
 * On the server it is only ever read synchronously within the same render pass
 * that `LocaleBoundary` seeds — React renders a request's tree without
 * interleaving another request's components into it — and the value is
 * re-seeded at the top of every render, so nothing survives to leak into the
 * next one. The client never depends on it: `localeFromDocument()` is checked
 * first there and always answers.
 */
let countryLocale: UiLocale | null = null;

/** Called during render by `components/locale-boundary.tsx`. */
export function seedCountryLocale(locale: UiLocale | null): void {
  countryLocale = locale;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setLocale(next: UiLocale): void {
  current = next;
  saveStoredLocale(next);
  // The document language matters to screen readers and to the browser's own
  // spell-checking, and it is wrong the moment the rider switches.
  if (typeof document !== "undefined") document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function useLocale(): [UiLocale, (next: UiLocale) => void] {
  // Server and hydration renders both get the country locale, so the markup
  // matches; `snapshot` then layers the rider's stored choice on top.
  const locale = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return [locale, setLocale];
}
