/**
 * Encoded polyline codec (Google algorithm).
 *
 * Valhalla uses precision 6, NOT the more common 5 — decoding its shapes with
 * 5 lands every point in the middle of an ocean. Precision 6 is the default
 * here for that reason.
 *
 * Valhalla encodes latitude first, then longitude; we expose `[lon, lat]` to
 * match GeoJSON and the rest of this codebase.
 *
 * `encode` exists because the route shape has to be handed back to Valhalla's
 * trace_attributes endpoint to obtain per-edge surface/road-class attributes.
 */

export function decodePolyline(encoded: string, precision = 6): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];

  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

function encodeSignedNumber(value: number): string {
  let sgnNum = value << 1;
  if (value < 0) sgnNum = ~sgnNum;

  let output = "";
  while (sgnNum >= 0x20) {
    output += String.fromCharCode((0x20 | (sgnNum & 0x1f)) + 63);
    sgnNum >>= 5;
  }
  output += String.fromCharCode(sgnNum + 63);
  return output;
}

/** `coordinates` are `[lon, lat]`; output is encoded lat-first, as Valhalla expects. */
export function encodePolyline(coordinates: [number, number][], precision = 6): string {
  const factor = 10 ** precision;
  let output = "";
  let prevLat = 0;
  let prevLon = 0;

  for (const [lon, lat] of coordinates) {
    const roundedLat = Math.round(lat * factor);
    const roundedLon = Math.round(lon * factor);
    output += encodeSignedNumber(roundedLat - prevLat);
    output += encodeSignedNumber(roundedLon - prevLon);
    prevLat = roundedLat;
    prevLon = roundedLon;
  }

  return output;
}
