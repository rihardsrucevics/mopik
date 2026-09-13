import { NextRequest, NextResponse } from "next/server";
import { reverseGeocode, searchPlaces } from "@/lib/chat/photon";

/**
 * Place suggestions for the ride form.
 *
 * Why a picker at all: free-text geocoding of "Valmiera" or "Baldone" has to
 * guess between the city, a hamlet of the same name and a Belarusian village
 * with a similar one. Letting the rider pick from a short, labelled list
 * removes the guess, and the coordinates travel with the plan so the API never
 * geocodes the name again. The lookup itself lives in `lib/chat/photon.ts`,
 * shared with the chat.
 *
 * Search is worldwide and *biased*, not fenced. The bias point, best first:
 *   1. `?near=` — a place the rider already picked in this form. Choosing
 *      Sigulda as the start should make the other rows offer Latvian places.
 *   2. Vercel's IP geolocation headers — city-level, free, no permission
 *      prompt, and enough to put a German rider's first suggestions in Germany.
 *   3. Rīga, the app's home.
 */

/**
 * Vercel attaches these at the edge. Read as plain headers rather than through
 * `@vercel/functions` — it is two numbers and avoids a dependency. Absent in
 * local development, where the fallback is what runs.
 */
function ipLocation(req: NextRequest): { lat: number; lon: number } | null {
  const lat = Number(req.headers.get("x-vercel-ip-latitude"));
  const lon = Number(req.headers.get("x-vercel-ip-longitude"));
  return Number.isFinite(lat) && Number.isFinite(lon) && (lat || lon) ? { lat, lon } : null;
}
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  // `?lat=&lon=` — the form's "Mana atrašanās vieta": name the point the
  // browser gave, so the rider recognises it before generating on it.
  const lat = Number(params.get("lat"));
  const lon = Number(params.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon) && params.has("lat")) {
    const place = await reverseGeocode(lat, lon);
    return NextResponse.json({ places: place ? [place] : [] });
  }
  const q = (params.get("q") ?? "").trim();
  if (q.length < 2) return NextResponse.json({ places: [] });
  const near = params.get("near")?.split(",").map(Number);
  const home =
    near?.length === 2 && near.every(Number.isFinite) ? { lat: near[0], lon: near[1] } : ipLocation(req) ?? undefined;
  return NextResponse.json({ places: await searchPlaces(q, home) });
}
