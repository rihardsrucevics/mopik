import { NextRequest, NextResponse } from "next/server";
import { poisForRoute } from "@/lib/poi/route-pois";

/**
 * Suggestions along a ride that has already been routed.
 *
 * A route of its own rather than more of `generate-route`'s response: the
 * details panel loads these lazily, when the rider opens Detaļas, so most
 * generations never pay for them. It takes the geometry the client already
 * has rather than a share code — no lookup, no re-route, and the whole call
 * is a spatial query over the pre-baked dataset.
 *
 * Outside the dataset (LV/LT/EE today — backlog item 8) both lists come back
 * empty. That is not an error: the ride is real, it simply has no named
 * places to suggest, and the panel shows nothing at all.
 */

export const runtime = "nodejs";

/** A long ride is a few thousand vertices; this is well clear of that. */
const MAX_POINTS = 60_000;

type Body = {
  geometry?: { coordinates?: unknown };
  locale?: string;
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ onRoute: [], nearby: [] });
  }

  const raw = body.geometry?.coordinates;
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > MAX_POINTS) {
    return NextResponse.json({ onRoute: [], nearby: [] });
  }

  // Trust nothing from the wire: a malformed vertex would otherwise reach the
  // distance maths as a NaN and quietly poison every comparison.
  const coordinates: [number, number][] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    coordinates.push([lon, lat]);
  }
  if (coordinates.length < 2) return NextResponse.json({ onRoute: [], nearby: [] });

  // The dataset names places in Latvian and English only, so the UI's four
  // locales fold to those two — a Lithuanian rider gets the English name of a
  // Latvian hillfort rather than nothing.
  const locale = body.locale === "lv" ? "lv" : "en";

  const started = performance.now();
  const { onRoute, nearby } = poisForRoute({ coordinates }, { locale });
  const ms = Math.round((performance.now() - started) * 10) / 10;

  return NextResponse.json({ onRoute, nearby, ms });
}
