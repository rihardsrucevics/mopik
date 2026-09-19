import type { ResolvedPlace } from "@/lib/chat/places";

/**
 * Naming a place the rider picked by tapping the map.
 *
 * The API matches a row to its coordinates by *name* (`findResolvedPlace`),
 * and a reverse lookup names a point after the settlement it fell in — so two
 * taps a kilometre apart in the same parish both come back "Ķekava". The API
 * would then take the first of them for both rows and plan a ride through one
 * point twice, silently and with no error anywhere. A name that is only
 * distinguishable on the map is not distinguishable to the router.
 *
 * So a picked name that collides with a name already in the ride carries a
 * short coordinate pair after it: "Ķekava · 56,9312, 24,2311". Four decimals
 * is ~11 m — finer than the ±30 m a finger lands within, and short enough to
 * still read as a place name in a form field. The suffix is added only on a
 * collision: a lone map pick keeps the plain name the rider recognises.
 *
 * A pure function, and deliberately not in a component: this is the rule that
 * keeps two rows from becoming one ride, so it is the thing that gets a test.
 */

/** The same fold `findResolvedPlace` compares with — two names collide if it does. */
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** The coordinate pair as it appears both in a suffix and as a last-resort name. */
export function coordName(lat: number, lon: number): string {
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/**
 * A distinguishing name for a place picked on the map.
 *
 * `taken` is every other row's text — the names the ride already uses. Blank
 * entries are ignored, and so is the row being picked into: re-picking the
 * same row must not make it collide with its own previous name and grow a
 * second suffix.
 */
export function pickedPlaceName(base: string, lat: number, lon: number, taken: Iterable<string>): string {
  const name = base.trim() || coordName(lat, lon);
  const others = new Set<string>();
  for (const t of taken) {
    const key = fold(t);
    if (key) others.add(key);
  }
  if (!others.has(fold(name))) return name;
  // Already suffixed by an earlier pick at these coordinates — appending a
  // second pair would say the same thing twice.
  const suffix = coordName(lat, lon);
  return name.endsWith(suffix) ? name : `${name} · ${suffix}`;
}

/**
 * The `ResolvedPlace` for a map tap: the reverse lookup's place when it found
 * one, renamed where the ride already uses that name, and the coordinates the
 * rider actually tapped rather than the ones the lookup snapped to.
 *
 * The tapped point wins on purpose. Reverse geocoding answers with the
 * settlement's own centre, which can be kilometres from the forest track the
 * rider meant; the whole point of the tap was to say *there*.
 */
export function pickedPlace(
  found: ResolvedPlace | null,
  lat: number,
  lon: number,
  taken: Iterable<string>,
  /** What to label a point the reverse lookup could not name. */
  fallbackLabel: string,
): ResolvedPlace {
  const name = pickedPlaceName(found?.name ?? "", lat, lon, taken);
  // The label carries the region the lookup found, and the field shows the
  // part of it the name does not already say — so a renamed place keeps
  // "Ķekavas novads" under it instead of losing its only piece of context.
  const label = found?.label && found.label !== found.name ? found.label : name === coordName(lat, lon) ? fallbackLabel : found?.label ?? fallbackLabel;
  return { name, label, lat, lon };
}
