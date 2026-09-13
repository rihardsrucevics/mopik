/**
 * One filename shape for every GPX Mopik produces, so a rider's downloads
 * folder sorts by date and still says where the ride went:
 *
 *   Mopik 2026-09-13 Riga-Baldone-Riga 97km.gpx
 *
 * Latvian letters are folded rather than dropped (Ķekava → Kekava): Garmin
 * and older car head units still choke on non-ASCII filenames, and a rider
 * copying files over USB should not meet a mangled name.
 */
const FOLD: Record<string, string> = {
  ā: "a", č: "c", ē: "e", ģ: "g", ī: "i", ķ: "k", ļ: "l", ņ: "n", š: "s", ū: "u", ž: "z",
  Ā: "A", Č: "C", Ē: "E", Ģ: "G", Ī: "I", Ķ: "K", Ļ: "L", Ņ: "N", Š: "S", Ū: "U", Ž: "Z",
};

export function asciiFold(text: string): string {
  return text.replace(/[āčēģīķļņšūžĀČĒĢĪĶĻŅŠŪŽ]/g, (c) => FOLD[c] ?? c);
}

export type GpxNameParts = {
  /** Places in riding order, e.g. ["Rīga", "Baldone", "Rīga"]. */
  places?: (string | null | undefined)[];
  /** Fallback when there are no places — the route's own name. */
  name?: string;
  km?: number;
  /** Defaults to today; a saved ride passes the day it was saved. */
  date?: Date;
};

export function gpxFilename({ places, name, km, date = new Date() }: GpxNameParts): string {
  const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
  const stops = (places ?? []).map((p) => (p ?? "").trim()).filter(Boolean);
  // "Rīga → Baldone → Rīga" is a loop: say it once, as "Riga loks".
  const route = stops.length >= 2 && stops[0] === stops[stops.length - 1]
    ? [...new Set(stops.slice(0, -1))].join("-") + (stops.length > 2 ? "-loks" : " loks")
    : stops.length ? [...stops].join("-") : (name ?? "marsruts");
  const clean = asciiFold(route).replace(/[^\w\s-]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  return ["Mopik", day, clean, km ? `${Math.round(km)}km` : ""].filter(Boolean).join(" ") + ".gpx";
}
