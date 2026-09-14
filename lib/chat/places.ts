/**
 * A place the rider picked from the suggestion list: the name they typed
 * or chose, the label that disambiguates it ("Baldone, Ķekavas novads"),
 * and its coordinates. Carried alongside the plan so the API never has to
 * guess which "Valmiera" was meant.
 */
export type ResolvedPlace = {
  name: string;
  label: string;
  lat: number;
  lon: number;
  /**
   * The POI category when this place came from a suggestion rather than from
   * the form — "waterfall", "hillfort", and the rest of `PoiCategory`.
   *
   * Optional, and deliberately a plain string rather than the `PoiCategory`
   * union: this module is imported by the routing side, which has no business
   * knowing the POI table, and a code decoded from an older or newer dataset
   * may carry a category this build does not list. The map reads it to draw
   * the kind's own glyph instead of the 🅿️ every typed stop gets; absent
   * means "typed by the rider", which is what every older share code says.
   */
  kind?: string;
  /** The OSM element the suggestion came from, for the marker's card link. */
  poiId?: string;
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** The picked place for a typed name, if the rider picked one. */
export function findResolvedPlace(places: ResolvedPlace[] | undefined, name: string): ResolvedPlace | undefined {
  const key = fold(name);
  return places?.find((p) => fold(p.name) === key || fold(p.label) === key);
}
