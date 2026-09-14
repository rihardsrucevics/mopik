/**
 * The client-safe half of the POI module: what a place *is*, with no way of
 * finding one.
 *
 * Separate from `route-pois.ts` because that file reaches the dataset through
 * `lib/geo/poi.ts`, which reads `public/poi-baltics.geojson` with `fs`. A
 * component importing so much as a type from there pulls `fs` into the client
 * bundle and the whole app fails to compile with "Module not found: Can't
 * resolve 'fs'" — measured, not theorised. Types and lookup tables live here;
 * anything that touches the file system stays there.
 */

/** The eleven kinds `scripts/build_poi_dataset.py` produces. */
export type PoiCategory =
  | "ferry"
  | "ford"
  | "tower"
  | "hillfort"
  | "lighthouse"
  | "waterfall"
  | "manor"
  | "viewpoint"
  | "mill"
  | "reserve"
  | "village";

/** One suggested place, as the API returns it. */
export type RoutePoi = {
  id: string;
  name: string;
  category: PoiCategory;
  lat: number;
  lon: number;
  /** metres from the route line */
  distanceMeters: number;
  /** how far into the ride the nearest point of the line is */
  alongKm: number;
};

export type RoutePois = { onRoute: RoutePoi[]; nearby: RoutePoi[] };

/**
 * The dictionary key and the map's own emoji for each POI kind.
 *
 * The keys are the `kind*` set the place suggestions already use, so a rider
 * meets the same word for "pilskalns" whether they typed it into the form or
 * found it in Ieteikumi. Six of the eleven dataset categories had no key —
 * ferry, ford, tower, mill, lighthouse, reserve are things the picker never
 * offers — and those are new, in all four languages.
 */
export const POI_KIND: Record<PoiCategory, { key: string; icon: string }> = {
  viewpoint: { key: "kindViewpoint", icon: "👁️" },
  hillfort: { key: "kindHillfort", icon: "⛰️" },
  waterfall: { key: "kindWaterfall", icon: "💦" },
  manor: { key: "kindManor", icon: "🏰" },
  lighthouse: { key: "kindLighthouse", icon: "🗼" },
  tower: { key: "kindTower", icon: "🔭" },
  mill: { key: "kindMill", icon: "🌾" },
  ferry: { key: "kindFerry", icon: "⛴️" },
  ford: { key: "kindFord", icon: "🌊" },
  reserve: { key: "kindReserve", icon: "🌲" },
  village: { key: "kindVillage", icon: "🏘️" },
};
