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
 */
export function generateGpx(
  name: string,
  coordinates: [number, number][],
  description?: string,
  waypoints?: GpxWaypoint[],
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

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mopik"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
${desc}    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts ? `${wpts}\n` : ""}  <trk>
    <name>${escapeXml(name)}</name>
${desc}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
