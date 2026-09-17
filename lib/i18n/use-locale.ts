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
 *   1. `?lang=` in the URL — someone deliberately shared *this* language;
 *   2. the rider's own stored choice — an explicit answer he gave here;
 *   3. the IP country, which `app/layout.tsx` reads from Vercel's
 *      `x-vercel-ip-country` on the server and writes onto `<html>`;
 *   4. the browser's language list;
 *   5. the default.
 *
 * The query sits above the stored choice on purpose. A rider who has set
 * Latvian and opens a friend's `?lang=et` link is looking at something that
 * was sent to him in Estonian; showing it in Latvian instead would ignore
 * the one thing the sender actually chose. It is per-URL and not saved, so
 * his own Latvian is back the moment he opens Mopik normally.
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

/**
 * `?lang=` on the current URL, when it names a language this build has.
 *
 * Client-only: the server render must not use it, or the hydration render
 * (which reads `getServerSnapshot`) would disagree with it and tear. The
 * effect in `LocaleBoundary` applies it right after hydration instead.
 */
function localeFromQuery(): UiLocale | null {
  if (typeof window === "undefined") return null;
  const asked = new URLSearchParams(window.location.search).get("lang");
  return isUiLocale(asked) ? asked : null;
}

function snapshot(): UiLocale {
  if (!current) {
    current =
      localeFromQuery() ??
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

/**
 * Apply the client-only signals once, after hydration.
 *
 * The hydration render can only use what the server knew — the IP country —
 * so a rider who had chosen a language would otherwise be stuck with whatever
 * his IP implied. This resolves the full precedence and notifies the store,
 * which is what moves every consumer onto the rider's own choice.
 *
 * It is called from an effect in `components/locale-boundary.tsx` rather than
 * left to React. React re-reads `getSnapshot` after hydration *only* once the
 * tree stops hydrating; measured here, `getServerSnapshot` was called on every
 * pass and `getSnapshot` never, so the stored choice never arrived. Driving it
 * explicitly is the difference between the rider's language being honoured and
 * being silently ignored.
 *
 * This is not the setState-in-effect the store was built to avoid: nothing
 * calls a component's setState here. The store settles itself and tells its
 * subscribers, exactly as it does when the rider uses the picker.
 */
let settled = false;

export function applyClientLocale(): void {
  if (settled) return;
  settled = true;
  const rendered = serverSnapshot();
  const real = snapshot();
  if (real === rendered) return;
  if (typeof document !== "undefined") document.documentElement.lang = real;
  for (const listener of listeners) listener();
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
