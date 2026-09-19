/**
 * Coordinates typed into a place field.
 *
 * A rider who has a point and not a name — a spot dropped in Google Maps, a
 * waypoint read off a GPS, a corner of a forest somebody described over the
 * phone — has nothing to type into a field that only searches for names. So
 * the field accepts the numbers themselves, and this is the parser behind it.
 *
 * Everything here is deliberately conservative: a string that *might* be two
 * coordinates and might be something else returns null, because a field that
 * silently rides off to the wrong hemisphere is worse than one that simply
 * keeps searching for a name.
 */

export type Coords = { lat: number; lon: number };

/**
 * Degree, minute and second marks as they actually arrive.
 *
 * Latvian keyboards, iOS "smart" quotes and copied web pages all disagree:
 * the same sexagesimal pair can come as `56°57'00"N`, `56°57′00″N` or with
 * the typographic ’ and ”. All of them mean the same thing, so they are
 * folded to the plain ASCII marks before anything tries to read the numbers.
 */
function normaliseMarks(input: string): string {
  return input
    .replace(/[′’´`]/g, "'")
    .replace(/[″”“»«]/g, '"')
    .replace(/[º˚○]/g, "°")
    // A non-breaking space arrives with anything pasted from a web page and
    // is not \s in every engine's mood; make it an ordinary space.
    .replace(/[   ]/g, " ")
    .replace(/[‐-―−]/g, "-")
    .trim();
}

/** In range for a latitude / longitude, and a real number. */
function inRange({ lat, lon }: Coords): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

/**
 * Settle a pair whose order we are not sure of.
 *
 * Mopik is Europe-wide and both readings are plausible almost everywhere here
 * — 56, 24 is Rīga and 24, 56 is a point in the Arabian desert, and no amount
 * of cleverness tells us which the rider meant. So the first number is the
 * latitude, always, the way every maps app writes it; the order is only
 * swapped when that reading is impossible and the swapped one is not. The
 * rider sees the resolved place before riding it, which is the real check.
 */
function order(first: number, second: number): Coords | null {
  const asWritten = { lat: first, lon: second };
  if (inRange(asWritten)) return asWritten;
  const swapped = { lat: second, lon: first };
  return inRange(swapped) ? swapped : null;
}

/** A sign from an N/S/E/W letter, folded over whatever sign the number carried. */
function hemisphere(value: number, letter: string | undefined): number {
  if (!letter) return value;
  const negative = letter === "S" || letter === "W";
  return negative ? -Math.abs(value) : Math.abs(value);
}

/**
 * Is this a latitude letter, a longitude letter, or neither?
 *
 * When the rider wrote the letters we obey them rather than the position, so
 * `24.10E 56.95N` resolves the way it reads.
 */
function axis(letter: string | undefined): "lat" | "lon" | null {
  if (letter === "N" || letter === "S") return "lat";
  if (letter === "E" || letter === "W") return "lon";
  return null;
}

/** One DMS component: `56°57'00"N`, `56° 57' 0.5" N`, `56°57'N`. */
const DMS = /(\d{1,3})\s*°\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*'\s*(?:(\d{1,2}(?:[.,]\d+)?)\s*"\s*)?)?([NSEW])?/i;
const DMS_PAIR = new RegExp(`^${DMS.source}\\s*[,;]?\\s*${DMS.source}$`, "i");

function dmsValue(deg: string, min: string | undefined, sec: string | undefined): number {
  const d = Number(deg);
  const m = min ? Number(min.replace(",", ".")) : 0;
  const s = sec ? Number(sec.replace(",", ".")) : 0;
  // Minutes and seconds are sixtieths; anything at or past 60 is not a
  // sexagesimal reading at all and would quietly land a degree away.
  if (m >= 60 || s >= 60) return NaN;
  return d + m / 60 + s / 3600;
}

function parseDms(input: string): Coords | null {
  const match = DMS_PAIR.exec(input);
  if (!match) return null;
  const [, d1, m1, s1, l1, d2, m2, s2, l2] = match;
  // A bare `56° 24°` is a decimal pair wearing degree signs; it is handled by
  // the decimal path, and only a real minutes-or-letters reading belongs here.
  if (!m1 && !l1 && !m2 && !l2) return null;
  const first = hemisphere(dmsValue(d1, m1, s1), l1?.toUpperCase());
  const second = hemisphere(dmsValue(d2, m2, s2), l2?.toUpperCase());
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;
  const a1 = axis(l1?.toUpperCase());
  const a2 = axis(l2?.toUpperCase());
  // Letters, when both are present and disagree with the writing order, are
  // the rider's own statement of which number is which.
  if (a1 && a2 && a1 !== a2) {
    const pair = a1 === "lat" ? { lat: first, lon: second } : { lat: second, lon: first };
    return inRange(pair) ? pair : null;
  }
  return order(first, second);
}

/**
 * Split a decimal pair into its two numbers.
 *
 * The hard case is Latvian, where the decimal separator *is* the comma:
 * `56,95 24,10` has to read as two numbers and `56.95, 24.10` as the same
 * two. What cannot be read is `56,95,24,10` — that is either two Latvian
 * decimals or four integers, and both are defensible, so it is refused
 * rather than guessed. The rule that separates them is simply how many commas
 * there are once the whitespace and semicolons have had their say.
 */
function splitDecimalPair(input: string): [string, string] | null {
  // A separator that is unambiguous on its own: a semicolon, or whitespace
  // with no comma acting as a separator.
  const bySemicolon = input.split(";");
  if (bySemicolon.length === 2) return [bySemicolon[0], bySemicolon[1]];
  if (bySemicolon.length > 2) return null;

  const commas = (input.match(/,/g) ?? []).length;
  const hasSpace = /\s/.test(input.trim());

  if (commas === 0) {
    const parts = input.trim().split(/\s+/);
    return parts.length === 2 ? [parts[0], parts[1]] : null;
  }

  if (commas === 1) {
    // One comma and a space could be either `56.95, 24.10` (comma separates)
    // or `56,95 24,10` (comma is a decimal point and space separates) — but
    // the second case has one comma per number, so a single comma with a
    // space around it can only be the separator. `56,95 24` is the odd one
    // out and reads as a separator too, which is what "56,95" alone means in
    // a search field anyway.
    const parts = input.split(",");
    if (parts.length !== 2) return null;
    const [left, right] = parts;
    if (hasSpace && /\s/.test(right.trim() === "" ? right : right.replace(/^\s+/, ""))) {
      // Space *inside* the right-hand side: `56,95 24,10` would have two
      // commas, so this is `56, 95 24` — three numbers, not two.
      return null;
    }
    if (/\s/.test(left.trim())) return null;
    return [left, right];
  }

  if (commas === 2) {
    // Two commas with whitespace between the halves is the Latvian decimal
    // form: `56,95 24,10`. Without whitespace it is `56,95,24` or similar —
    // ambiguous, refused.
    if (!hasSpace) return null;
    const parts = input.trim().split(/\s+/);
    if (parts.length !== 2) return null;
    if ((parts[0].match(/,/g) ?? []).length !== 1) return null;
    if ((parts[1].match(/,/g) ?? []).length !== 1) return null;
    return [parts[0], parts[1]];
  }

  // Three or more commas: `56,95,24,10` and friends. Two readings, no way to
  // choose. Refused on purpose — see the doc comment above.
  return null;
}

/** `56.95`, `56,95`, `-56.95`, `56.95N`, `N56.95`. */
const DECIMAL = /^([NSEW])?\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*([NSEW])?$/i;

function parseDecimalPart(part: string): { value: number; axis: "lat" | "lon" | null } | null {
  const match = DECIMAL.exec(part.trim().replace(/°/g, ""));
  if (!match) return null;
  const [, before, number, after] = match;
  if (before && after) return null;
  const letter = (before ?? after)?.toUpperCase();
  const raw = Number(number.replace(",", "."));
  if (!Number.isFinite(raw)) return null;
  return { value: hemisphere(raw, letter), axis: axis(letter) };
}

function parseDecimal(input: string): Coords | null {
  const split = splitDecimalPair(input);
  if (!split) return null;
  const first = parseDecimalPart(split[0]);
  const second = parseDecimalPart(split[1]);
  if (!first || !second) return null;
  if (first.axis && second.axis && first.axis !== second.axis) {
    const pair = first.axis === "lat"
      ? { lat: first.value, lon: second.value }
      : { lat: second.value, lon: first.value };
    return inRange(pair) ? pair : null;
  }
  return order(first.value, second.value);
}

/**
 * The `@lat,lon,zoom` fragment out of a Google Maps URL.
 *
 * Riders share places as links, and the whole link pasted into a place field
 * is a wall of text with the one useful thing in the middle of it. Pulling
 * the `@` fragment out means a paste works without the rider editing it
 * first. Only the `@` form is read: a `?q=` or a short `maps.app.goo.gl` link
 * needs a network round trip to resolve, which a field that answers as you
 * type cannot afford.
 */
const AT_FRAGMENT = /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Coordinates out of whatever the rider typed, or null when the text is not
 * a coordinate pair — in which case the field goes on searching for a name.
 */
export function parseCoords(input: string): Coords | null {
  if (typeof input !== "string") return null;
  const text = normaliseMarks(input);
  if (!text) return null;

  const at = AT_FRAGMENT.exec(text);
  if (at) {
    // A Google URL writes latitude first, always, so the order is known here
    // and needs none of the guessing the typed forms do.
    const pair = { lat: Number(at[1]), lon: Number(at[2]) };
    return inRange(pair) ? pair : null;
  }

  // Nothing but digits, signs, separators and the marks a coordinate wears.
  // A street address ("Brīvības 24, Rīga") has letters in it and must fall
  // through to the name search untouched.
  if (!/^[0-9NSEWnsew\s.,;:+°'"-]+$/.test(text)) return null;

  return parseDms(text) ?? parseDecimal(text);
}

/**
 * The pair as the field shows it: four decimals, ~11 m, which is finer than
 * a rider can point at on a phone map and short enough to read back.
 */
export function formatCoords({ lat, lon }: Coords): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}
