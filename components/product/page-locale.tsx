"use client";

import { useEffect } from "react";
import { showPageLocale } from "@/lib/i18n/use-locale";
import type { UiLocale } from "@/lib/i18n/locale";

/** Puts the shared header and footer in this page's language — see `showPageLocale`. */
export function PageLocale({ locale }: { locale: UiLocale }) {
  useEffect(() => showPageLocale(locale), [locale]);
  return null;
}
