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
};

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** The picked place for a typed name, if the rider picked one. */
export function findResolvedPlace(places: ResolvedPlace[] | undefined, name: string): ResolvedPlace | undefined {
  const key = fold(name);
  return places?.find((p) => fold(p.name) === key || fold(p.label) === key);
}
