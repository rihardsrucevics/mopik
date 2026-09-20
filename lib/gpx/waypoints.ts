import { t } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";
import type { MessageKey } from "@/lib/i18n/messages";
import { POI_KIND, stopNumbers, type PoiCategory } from "@/lib/poi/kinds";
import type { GpxWaypoint } from "@/lib/gpx/generate-gpx";

/**
 * The planned places of a ride, as GPX waypoints.
 *
 * ## Why this file exists at all
 *
 * A rider loads a Mopik GPX into OsmAnd or a Garmin and sees a line. The
 * stops he chose, the sights he ticked and which end is which are all on the
 * *screen he just left*: `<trkpt>`s carry no names, so the device has nothing
 * to draw a pin from. GPX 1.1 has `<wpt>` for exactly this, and this module
 * is the one place that decides what goes in one.
 *
 * Pure, and separate from the panel that calls it, because the rules below
 * are the sort that break quietly — a sight taking a stop's number, a round
 * trip growing a finish it does not have — and a test is the only way anyone
 * finds out before the rider does.
 *
 * ## The rules
 *
 * - **A round trip has no finish.** It returns to its start, so the start pin
 *   *is* the finish; a red flag on the same coordinate would be a second
 *   answer to the same question, and the app already settled this for the map
 *   (`lib/map/place-roles.ts`). Only a one-way ride gets a Finišs.
 * - **Sights are not stops, so they take no number.** The same rule the map
 *   draws by, and the same function — `stopNumbers` — rather than a second
 *   copy of the counting: let a ticked waterfall consume a number and every
 *   stop after it is labelled one higher than its row in the form.
 * - **The words are the rider's, the symbols are the device's.** Starts /
 *   Finišs / "ūdenskritums" come from `t(locale, …)` so the file speaks the
 *   language the ride was planned in; `sym` is Garmin's own vocabulary and is
 *   therefore English and untranslated, which is what a device expects.
 */

/**
 * A place in the ride, in riding order, as this module needs it.
 *
 * Structurally a `ResolvedPlace` (and a `SelectedPoi`, and a share code's
 * decoded place), deliberately re-declared as the minimum rather than
 * imported: the callers are three different pages holding three different
 * shapes, and the honest dependency here is "something with a coordinate and
 * a name".
 */
export type RideWaypointPlace = {
  name: string;
  label?: string;
  lat: number;
  lon: number;
  /** The POI category when this came from a suggestion; absent = typed by the rider. */
  kind?: string;
};

/**
 * The Garmin symbol for each POI kind.
 *
 * These names come from Garmin's waypoint symbol table — the de-facto
 * vocabulary every other consumer (OsmAnd, Locus, BaseCamp, QMapShack) reads
 * too — so they are matched to the *nearest real symbol*, not invented. Where
 * the table has nothing close the kind falls through to `Waypoint`, the plain
 * pin, which is better than a symbol that means something else: a device that
 * does not recognise a name draws its default anyway, but a rider who sees a
 * museum pin on a ford has been told something untrue.
 */
const KIND_SYM: Record<PoiCategory, string> = {
  viewpoint: "Scenic Area",
  hillfort: "Summit",
  waterfall: "Waterfall",
  cave: "Cave",
  cliff: "Summit",
  manor: "Museum",
  lighthouse: "Lighthouse",
  tower: "Tall Tower",
  mill: "Building",
  ferry: "Anchor",
  ford: "Ford",
  reserve: "Park",
  village: "Residence",
};

/** The flags. Green starts, red finishes, blue is every stop between. */
const START_SYM = "Flag, Green";
const FINISH_SYM = "Flag, Red";
const STOP_SYM = "Flag, Blue";
const FALLBACK_SYM = "Waypoint";

/**
 * The region a label carries, when it carries one.
 *
 * `lib/chat/photon.ts` builds a label as "<name> · <street> · <where>", so
 * everything after the first separator is where the place is — "Allažu
 * pagasts" for a Sigulda-area stop. It goes in `desc` rather than in `name`
 * because a device draws the name beside the pin and a rider reading a map at
 * a junction wants "1 · Tūjas", not a line of administrative geography; the
 * description is one tap away for when two places share a name.
 *
 * Returns null where the label is only the name, which is most of them.
 */
export function splitPlace(place: RideWaypointPlace): { name: string; region: string | null } {
  // `name` and `label` are both split, because **`name` is not always just the
  // name**: `routedPlaces` in components/home-page.tsx builds each place with
  // `name: p.label`, so a stop the rider picked from the list arrives here as
  // the whole "Līgatne · Līgatnes pagasts". Measured, not theorised — the
  // first ride exported through this code came out reading
  // "1 · Līgatne · Līgatnes pagasts", with the region in the pin's name *and*
  // in its description. Splitting whichever string is longer, rather than
  // trusting `name`, is what makes the two fields disjoint however the caller
  // filled them in.
  const label = place.label?.trim() ?? "";
  const raw = place.name.trim();
  const source = label.length > raw.length ? label : raw || label;
  const parts = source.split("·").map((s) => s.trim()).filter(Boolean);
  const name = parts[0] ?? "";
  const rest = parts.slice(1).join(" · ");
  return { name, region: rest && rest !== name ? rest : null };
}

/** The region alone — the part of a label that is not the place's own name. */
export function placeRegion(place: RideWaypointPlace): string | null {
  return splitPlace(place).region;
}

/**
 * Strip the glyphs a name may have picked up on its way through the UI.
 *
 * The suggestion rows render a kind's emoji beside the name rather than
 * inside it, so this is a guard and not a fix for a known bug — but a name
 * that reached a `<wpt>` with a 💦 in it would show up as a mojibake box on
 * exactly the devices this feature exists for, and there is no way to see it
 * from inside the app. Also collapses the whitespace that stripping leaves.
 */
function plainName(name: string): string {
  return name
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type RideWaypointInput = {
  /** Start, stops and (on a one-way ride) the finish — in riding order. */
  places: readonly RideWaypointPlace[];
  /** A round trip ends where it started and grows no finish waypoint. */
  returnToStart: boolean;
  locale: UiLocale;
};

/**
 * Turn a ride into the waypoints its GPX should carry.
 *
 * `places` is the ride in riding order, exactly as the panel holds it: the
 * start first, the stops and ticked sights in the middle, and on a one-way
 * ride the finish last. Empty or coordinate-less entries are dropped rather
 * than exported as a pin at (0, 0) in the Gulf of Guinea.
 */
export function rideWaypoints({ places, returnToStart, locale }: RideWaypointInput): GpxWaypoint[] {
  const usable = places.filter(
    (p) => Number.isFinite(p.lat) && Number.isFinite(p.lon) && plainName(splitPlace(p).name).length > 0,
  );
  if (usable.length === 0) return [];

  // A one-way ride's last place is its finish; a round trip has none, so every
  // place after the start is a stop. `returnToStart` decides it, never the
  // count — the map learned the same lesson in `place-roles.ts`.
  const hasFinish = !returnToStart && usable.length >= 2;
  const finishIndex = hasFinish ? usable.length - 1 : -1;
  const middle = usable.slice(1, hasFinish ? usable.length - 1 : usable.length);
  // The same numbering the map draws, from the same function: a sight is not a
  // stop and must not consume a digit.
  const numbers = stopNumbers(middle.map((p) => ({ label: splitPlace(p).name, category: p.kind })));

  const out: GpxWaypoint[] = [];
  const push = (place: RideWaypointPlace, name: string, sym: string, type: string) => {
    const region = splitPlace(place).region;
    out.push({
      lat: place.lat,
      lon: place.lon,
      name,
      ...(region ? { desc: region } : {}),
      sym,
      type,
    });
  };

  usable.forEach((place, i) => {
    const name = plainName(splitPlace(place).name);
    if (i === 0) {
      push(place, `${t(locale, "mapStart")} · ${name}`, START_SYM, "start");
      return;
    }
    if (i === finishIndex) {
      push(place, `${t(locale, "mapFinish")} · ${name}`, FINISH_SYM, "finish");
      return;
    }
    const entry = place.kind ? POI_KIND[place.kind as PoiCategory] : undefined;
    const n = numbers[i - 1];
    if (entry && n === null) {
      // A sight leads with what it is — "Ūdenskritums · Dauguļu ūdenskritums"
      // — because that word is the reason the rider ticked it, and on a device
      // list of thirty pins the kind is what he scans for.
      const kind = t(locale, entry.key as MessageKey);
      const word = kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : "";
      push(place, word ? `${word} · ${name}` : name, KIND_SYM[place.kind as PoiCategory] ?? FALLBACK_SYM, "sight");
      return;
    }
    // A stop the rider typed, or a via whose category this build does not
    // know: it is in the ride and it is not a sight we recognise, so it is a
    // stop and wears the next number. Same reading as `stopNumbers`.
    push(place, `${n ?? ""} · ${name}`.replace(/^ · /, ""), STOP_SYM, "stop");
  });

  return out;
}
