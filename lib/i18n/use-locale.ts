"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_LOCALE,
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
 */
let current: UiLocale | null = null;
const listeners = new Set<() => void>();

function snapshot(): UiLocale {
  if (!current) {
    // A stored choice is the rider's own and always wins; otherwise the
    // browser's preference list decides, so a Lithuanian rider is not met
    // with Latvian on their first visit.
    current =
      loadStoredLocale() ??
      (typeof navigator !== "undefined"
        ? localeFromBrowser(navigator.languages ?? [navigator.language])
        : DEFAULT_LOCALE);
  }
  return current;
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
  // The server renders the default; the client swaps in the real one.
  const locale = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_LOCALE);
  return [locale, setLocale];
}
