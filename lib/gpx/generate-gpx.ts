function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * One planned place, as the file carries it.
 *
 * `sym` is a Garmin symbol name ("Flag, Green", "Museum"). It is deliberately
 * a plain string rather than a union: the names are a device vendor's list,
 * not ours, every consumer that does not know one falls back to its default
 * pin, and `lib/gpx/waypoints.ts` is the one place that decides them.
 * `type` is our own coarse kind — start / finish / stop / sight — which is
 * what a rider filtering the file in Locus or QMapShack actually sorts on.
 */
export type GpxWaypoint = {
  lat: number;
  lon: number;
  name: string;
  desc?: string;
  sym?: string;
  type?: string;
};

/**
 * One `<rtept>` of the Garmin route — see `lib/gpx/route-points.ts`. Declared
 * here, not imported, so this file stays free of the i18n and routing modules.
 */
export type GpxRoutePointOut = { lat: number; lon: number; name?: string; kind: "via" | "shape" };

/** Garmin TripExtensions v1 — https://www8.garmin.com/xmlschemas/TripExtensionsv1.xsd */
export const TRP_NS = "http://www.garmin.com/xmlschemas/TripExtensions/v1";
const TRP_XSD = "https://www8.garmin.com/xmlschemas/TripExtensionsv1.xsd";

/**
 * The ride as a Garmin route: one `<rtept>` per anchor.
 *
 * Structure checked against TripExtensionsv1.xsd (fetched 2026-09-28):
 * `ViaPoint` ("announced stops during a route") and `ShapingPoint` ("influence
 * the route path … but are not announced") are root elements meant as
 * children of the GPX `rtept`'s `<extensions>`. Neither carries a name — every
 * child of `ViaPointExtension_t` is optional and none is a name — so the name
 * is the `rtept`'s own GPX `<name>`, which comes before `<extensions>` in the
 * GPX 1.1 `wptType` sequence. No `CalculationMode` is written: Mopik's line is
 * in the `<trk>`, and the device's own default is the honest choice until a
 * leg is drawn straight (Phase 2, `Direct`).
 *
 * No `<trp:Trip>` on the `<rte>`: the XSD makes it optional
 * (`TransportationMode` minOccurs 0) and nothing we could check says a device
 * needs it; the rider picks the vehicle profile on the zūmo.
 */
function routeXml(name: string, points: GpxRoutePointOut[]): string {
  const rtepts = points
    .map((p) => {
      const n = p.name ? `      <name>${escapeXml(p.name)}</name>\n` : "";
      const ext = p.kind === "via" ? "<trp:ViaPoint/>" : "<trp:ShapingPoint/>";
      return `    <rtept lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">\n${n}      <extensions>${ext}</extensions>\n    </rtept>`;
    })
    .join("\n");
  return `  <rte>\n    <name>${escapeXml(name)}</name>\n${rtepts}\n  </rte>\n`;
}

/**
 * Build a GPX 1.1 file with the route as a single <trk>.
 * Coordinates are GeoJSON order: [lon, lat].
 *
 * `waypoints` are the planned places — the start, the stops and the ticked
 * sights. They are what makes a Mopik ride readable on the device: OsmAnd,
 * Garmin and Locus draw `<trkpt>`s as a bare line and only `<wpt>` earns a
 * pin with a name, so without them the rider sees the road and none of the
 * plan. They are emitted **before** the `<trk>` because the GPX 1.1 schema
 * fixes the order (metadata, wpt*, rte*, trk*) and a strict reader — Garmin's
 * own among them — rejects the file outright when a `<wpt>` follows a `<trk>`.
 *
 * `routePoints`, when there are at least two, become one `<rte>` between the
 * `<wpt>`s and the `<trk>` — the schema's slot for it. The `<trk>` stays the
 * authoritative line; the route is what a Garmin re-plans from.
 */
export function generateGpx(
  name: string,
  coordinates: [number, number][],
  description?: string,
  waypoints?: GpxWaypoint[],
  routePoints?: GpxRoutePointOut[],
): string {
  const trkpts = coordinates
    .map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}" />`)
    .join("\n");
  // A file found on a phone six months later should still say what it was
  // for: the plan, the numbers and the surface, in the rider's own terms.
  const desc = description ? `    <desc>${escapeXml(description)}</desc>\n` : "";
  const wpts = (waypoints ?? [])
    .map((w) => {
      const children = [
        `      <name>${escapeXml(w.name)}</name>`,
        w.desc ? `      <desc>${escapeXml(w.desc)}</desc>` : "",
        w.sym ? `      <sym>${escapeXml(w.sym)}</sym>` : "",
        w.type ? `      <type>${escapeXml(w.type)}</type>` : "",
      ].filter(Boolean).join("\n");
      return `  <wpt lat="${w.lat.toFixed(6)}" lon="${w.lon.toFixed(6)}">\n${children}\n  </wpt>`;
    })
    .join("\n");

  const rte = routePoints && routePoints.length >= 2 ? routeXml(name, routePoints) : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mopik"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:trp="${TRP_NS}"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ${TRP_NS} ${TRP_XSD}">
  <metadata>
    <name>${escapeXml(name)}</name>
${desc}    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts ? `${wpts}\n` : ""}${rte}  <trk>
    <name>${escapeXml(name)}</name>
${desc}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
