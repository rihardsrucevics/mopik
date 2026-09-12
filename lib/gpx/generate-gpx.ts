function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build a GPX 1.1 file with the route as a single <trk>.
 * Coordinates are GeoJSON order: [lon, lat].
 */
export function generateGpx(name: string, coordinates: [number, number][], description?: string): string {
  const trkpts = coordinates
    .map(([lon, lat]) => `      <trkpt lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}" />`)
    .join("\n");
  // A file found on a phone six months later should still say what it was
  // for: the plan, the numbers and the surface, in the rider's own terms.
  const desc = description ? `    <desc>${escapeXml(description)}</desc>\n` : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Mopik"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
${desc}    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(name)}</name>
${desc}
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>
`;
}
