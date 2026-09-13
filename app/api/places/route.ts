import { NextRequest, NextResponse } from "next/server";
import { reverseGeocode, searchPlaces } from "@/lib/chat/photon";

/**
 * Place suggestions for the ride form.
 *
 * Why a picker at all: free-text geocoding of "Valmiera" or "Baldone" has to
 * guess between the city, a hamlet of the same name and a Belarusian village
 * with a similar one. Letting the rider pick from a short, labelled list —
 * settlements only, Baltic countries only — removes the guess, and the
 * coordinates travel with the plan so the API never geocodes the name again.
 * The lookup itself lives in `lib/chat/photon.ts`, shared with the chat.
 */
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
  return NextResponse.json({ places: await searchPlaces(q) });
}
