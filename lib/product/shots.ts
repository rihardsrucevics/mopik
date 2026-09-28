import type { UiLocale } from "@/lib/i18n/locale";

/**
 * The product page's app screenshots, one set per language.
 *
 * Every picture with interface text in it was captured four times — the same
 * ride (Sigulda → Līgatne → Cēsis, one way, the default Adventure profile)
 * and the same state, with the app in lv, lt, et and en — by
 * `scratchpad/pw/product-shots.cjs` against this branch's code, then cropped
 * and encoded by `crop-locale.py`. The file is `public/product/<name>.<locale>.webp`;
 * the sizes below are the files' own, since a longer translation makes a
 * panel taller.
 *
 * The two pictures with no words in them — the Instagram map band and the
 * surface-coloured line — are one file for all four languages (`SHARED_SHOTS`).
 */
export const LOCALE_SHOT_SIZES = {
  "trip-type": { lv: [640, 532], lt: [640, 532], et: [640, 532], en: [640, 532] },
  "profile": { lv: [640, 964], lt: [640, 1020], et: [640, 964], en: [640, 964] },
  "chat": { lv: [640, 638], lt: [640, 686], et: [640, 638], en: [640, 686] },
  "sights": { lv: [640, 756], lt: [640, 756], et: [640, 756], en: [640, 756] },
  "languages": { lv: [531, 624], lt: [531, 624], et: [531, 624], en: [531, 624] },
  "tet-card": { lv: [600, 823], lt: [600, 823], et: [600, 823], en: [600, 823] },
  "gate-card": { lv: [600, 600], lt: [600, 600], et: [600, 600], en: [600, 600] },
  "edit-sheet": { lv: [600, 854], lt: [600, 854], et: [600, 854], en: [600, 854] },
  "edit-preview": { lv: [600, 977], lt: [600, 977], et: [600, 977], en: [600, 977] },
  "duration": { lv: [640, 336], lt: [640, 336], et: [640, 336], en: [640, 336] },
  "share-page": { lv: [600, 934], lt: [600, 934], et: [600, 934], en: [600, 934] },
  "share-card": { lv: [800, 420], lt: [800, 420], et: [800, 420], en: [800, 420] },
} as const satisfies Record<string, Record<UiLocale, readonly [number, number]>>;

export type LocaleShotName = keyof typeof LOCALE_SHOT_SIZES;

export const SHARED_SHOTS = {
  "hero-ride": [1600, 336],
  "surface-map": [640, 655],
} as const;

export type SharedShotName = keyof typeof SHARED_SHOTS;

export function localeShotSrc(name: LocaleShotName, locale: UiLocale): string {
  return `/product/${name}.${locale}.webp`;
}

export function sharedShotSrc(name: SharedShotName): string {
  return `/product/${name}.webp`;
}
