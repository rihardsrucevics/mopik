import { haversineMeters } from "@/lib/geo/geometry";
import { poiName, type Poi } from "@/lib/geo/poi";
import type { LoopStop } from "./loop";

/**
 * Naming loops after the places they actually visit.
 *
 * "Caur Turaidu un Gaujas pārbrauktuvi" tells a rider what the ride is;
 * "Sigulda Adventure Loop B" tells them nothing they can't see from the
 * distance and the map.
 */

export type Locale = "lv" | "en";

/**
 * Latvian keywords and diacritics, used to pick the naming language.
 *
 * There is no i18n framework here and the app is used in both languages, so
 * the prompt itself is the only signal available.
 */
const LATVIAN_HINTS =
  /[āčēģīķļņšūž]|\b(grants|brauciens|punktot|raustīt|takas|takām|cilpa|apļ|stund|km garš|uz\s+\w+\s+pusi)\b/i;

export function detectLocale(prompt: string): Locale {
  return LATVIAN_HINTS.test(prompt) ? "lv" : "en";
}

/** The two most notable named stops, spread as far apart as possible. */
function headlineStops(stops: LoopStop[], locale: Locale): Poi[] {
  const named = stops
    .map((s) => s.poi)
    .filter((p): p is Poi => !!p && !!poiName(p, locale));

  if (named.length <= 2) return named;

  const byScore = [...named].sort((a, b) => b.score - a.score);
  const first = byScore[0];

  // Pick the second from the highest-scoring remainder, preferring one far
  // from the first so the name spans the loop rather than describing a corner.
  let second = byScore[1];
  let bestValue = -Infinity;
  for (const candidate of byScore.slice(1)) {
    const spread = haversineMeters(
      [first.lon, first.lat],
      [candidate.lon, candidate.lat]
    );
    const value = candidate.score + spread / 20000;
    if (value > bestValue) {
      bestValue = value;
      second = candidate;
    }
  }
  return [first, second];
}

/**
 * Latvian "caur" takes the accusative (Turaida -> Caur Turaidu). The dataset
 * precomputes `nameLvAcc` where the stem is unambiguous; where it doesn't,
 * fall back to a phrasing that needs no case.
 */
function latvianName(pois: Poi[]): string | undefined {
  const forms = pois.map((p) => ({
    accusative: p.nameLvAcc,
    plain: poiName(p, "lv"),
  }));

  if (forms.length === 2) {
    const [a, b] = forms;
    if (a.accusative && b.accusative) {
      return `Caur ${a.accusative} un ${b.accusative}`;
    }
    if (a.plain && b.plain) return `${a.plain} un ${b.plain} loks`;
  }
  if (forms.length === 1) {
    const [a] = forms;
    if (a.accusative) return `Caur ${a.accusative}`;
    if (a.plain) return `${a.plain} loks`;
  }
  return undefined;
}

function englishName(pois: Poi[]): string | undefined {
  const names = pois.map((p) => poiName(p, "en")).filter((n): n is string => !!n);
  if (names.length === 2) return `${names[0]} and ${names[1]} Loop`;
  if (names.length === 1) return `${names[0]} Loop`;
  return undefined;
}

export function nameLoop(params: {
  startLabel: string;
  difficulty: string;
  stops: LoopStop[] | undefined;
  locale: Locale;
  /** distinguishes otherwise identical fallback names */
  variant: string;
}): string {
  const pois = headlineStops(params.stops ?? [], params.locale);
  const fromPois =
    params.locale === "lv" ? latvianName(pois) : englishName(pois);
  if (fromPois) return fromPois;

  // No named stops (sparse region, or POI data unavailable): fall back to
  // start and difficulty, translated rather than mixed with English.
  if (params.locale === "lv") {
    const lv: Record<string, string> = {
      easy: "viegls",
      adventure: "adventure",
      hard: "grūts",
    };
    return `${params.startLabel} ${lv[params.difficulty] ?? params.difficulty} loks ${params.variant}`;
  }
  const difficulty =
    params.difficulty.charAt(0).toUpperCase() + params.difficulty.slice(1);
  return `${params.startLabel} ${difficulty} Loop ${params.variant}`;
}

/** Stop list for the summary panel, e.g. "Turaida · Gaujas pārbrauktuve". */
export function stopLabels(
  stops: LoopStop[] | undefined,
  locale: Locale
): { name: string; category: string }[] {
  return (stops ?? []).flatMap((s) => {
    if (!s.poi) return [];
    const name = poiName(s.poi, locale);
    return name ? [{ name, category: s.poi.category }] : [];
  });
}
