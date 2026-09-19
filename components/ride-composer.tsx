"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Map as MapIcon, MapPinPlus, Sparkles } from "lucide-react";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { RoutePlaces, addStop, addedStopIndex, rowLabel, MAX_ROWS } from "@/components/route-places";
import { useLocale } from "@/lib/i18n/use-locale";
import { t, messages, type MessageKey } from "@/lib/i18n/messages";
import { track } from "@/lib/analytics";
import { rememberPlace } from "@/lib/chat/recent-places";
import { pickedPlace } from "@/lib/chat/pick-name";
import { fi } from "@/lib/i18n/format";
import type { ResolvedPlace } from "@/lib/chat/places";
import {
  PROFILE_PRESETS,
  normalizeProfile,
  presetIdFor,
  profileFromPlan,
  type RideProfile,
} from "@/lib/chat/ride-profile";

type Choice<T extends string> = { value: T; label: string; detail?: string };

function ChoiceRow<T extends string>({ label, value, choices, onChange }: { label: string; value: T; choices: Choice<T>[]; onChange: (value: T) => void }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{label}</legend>
      <div className="grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-stone-100 p-1">
        {choices.map((choice) => (
          <button key={choice.value} type="button" aria-pressed={value === choice.value} onClick={() => onChange(choice.value)}
            className={`min-w-0 rounded-lg px-2 py-2 text-center transition ${value === choice.value ? "bg-white text-stone-950 shadow-sm ring-1 ring-stone-200" : "text-stone-500 hover:text-stone-800"}`}>
            <span className="block whitespace-nowrap text-xs font-semibold">{choice.label}</span>
            {choice.detail && <span className="mt-0.5 block text-[9px] leading-tight opacity-70">{choice.detail}</span>}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * The profile as one line. For most riders it never changes, so it takes one
 * row: the summary, the presets, and "Mainīt" to open the three choices.
 */
function ProfileLine({ profile, onChange }: { profile: RideProfile; onChange: (profile: RideProfile) => void }) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [open, setOpen] = useState(false);
  const p = normalizeProfile(profile);
  const activePreset = presetIdFor(p);

  return (
    <div className="rounded-xl border border-stone-200 bg-[#faf9f6]">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-400">{m.profileTitle}</div>
          <div className="truncate text-sm font-semibold text-stone-900">{[p.surface === "asphalt" ? null : m[({rest:"diffRest",adventure:"diffAdventure",hard:"diffHard"} as const)[p.difficulty]], m[p.style === "tourism" ? "styleTourism" : "styleRiding"], m[({asphalt:"surfAsphalt",gravel:"surfGravel",forest:"surfForest"} as const)[p.surface]]].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#bd4b00]">
          {open ? m.close : m.change}{open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      </div>

      {open && (
        <div className="space-y-4 border-t border-stone-200 px-3 py-3">
          <div className="flex flex-wrap gap-1.5">
            {PROFILE_PRESETS.map((preset) => (
              <button key={preset.id} type="button" aria-pressed={activePreset === preset.id} onClick={() => onChange(preset.profile)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${activePreset === preset.id ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:text-stone-900"}`}>
                {m[preset.label as MessageKey]}
              </button>
            ))}
          </div>

          <ChoiceRow label={m.profileStyle} value={p.style} onChange={(style) => onChange({ ...p, style })}
            choices={[{ value: "tourism" as const, label: m.styleTourism, detail: m.styleTourismHint }, { value: "riding" as const, label: m.styleRiding, detail: m.styleRidingHint }]} />
          <ChoiceRow label={m.profileSurface} value={p.surface} onChange={(surface) => onChange(normalizeProfile({ ...p, surface }))}
            choices={[{ value: "asphalt" as const, label: m.surfAsphalt }, { value: "gravel" as const, label: m.surfGravel }, { value: "forest" as const, label: m.surfForest }]} />
          {p.surface === "asphalt" ? (
            <p className="text-[11px] leading-relaxed text-stone-500">
              {m.asphaltNote}
            </p>
          ) : (
            <ChoiceRow label={m.profileDifficulty} value={p.difficulty} onChange={(difficulty) => onChange({ ...p, difficulty })}
              choices={[{ value: "rest" as const, label: m.diffRest, detail: m.diffRestHint }, { value: "adventure" as const, label: m.diffAdventure, detail: m.diffAdventureHint }, { value: "hard" as const, label: m.diffHard, detail: m.diffHardHint }]} />
          )}
          {p.surface === "forest" && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
              {m.forestWarning}
            </p>
          )}
          <p className="text-[11px] leading-relaxed text-stone-500">{m.profileRemembered}</p>
        </div>
      )}
    </div>
  );
}

export function RideComposer({ initialPlan, initialPlaces, profile, onProfileChange, busy, onGenerate, onUseChat, onPlacesChange, map, onPickModeChange, pickPoint, geolocated, onAddStopOfferChange, addStopPoint }: {
  initialPlan: RidePlan | null;
  /**
   * Coordinates the plan arrived with, matched to its rows by name. A ride
   * reopened for editing then keeps the exact place it was built from instead
   * of being geocoded again — the "Valmiera in Rīga" failure.
   */
  initialPlaces?: ResolvedPlace[] | null;
  /** the rider's standing profile, remembered on the device */
  profile: RideProfile;
  onProfileChange: (profile: RideProfile) => void;
  busy: boolean;
  onGenerate: (plan: RidePlan, places: ResolvedPlace[]) => void;
  onUseChat: () => void;
  /**
   * Picked places, in riding order, so the map can confirm them before a ride
   * exists — with the trip type, which is what says whether the last of them
   * is a finish or a stop.
   *
   * The map draws a stop as a 🅿️ pill and the start and finish as their own
   * pins, and the list alone cannot tell the two apart: on a one-way ride the
   * last confirmed place is the destination, on a round trip there is no
   * destination and every place after the start is a stop. Passing the places
   * without the shape is what put a 🅿️ on Warszawa.
   */
  onPlacesChange?: (places: ResolvedPlace[], tripType: "round_trip" | "one_way") => void;
  /**
   * The map, on phones only. It belongs to the places it confirms, so it sits
   * under them inside this block rather than above the whole page — where it
   * pushed even the saved-rides entry down and read as something separate
   * from the ride being described. The desktop keeps its own sticky column.
   */
  map?: ReactNode;
  /**
   * Pick mode belongs to the page, not to this form, because the page owns the
   * one MapLibre instance and everything it is told to draw. This says a row
   * is waiting for a point (or that none is), and the page answers by handing
   * the map an `onPickPoint` and a draggable marker.
   */
  onPickModeChange?: (picking: boolean, open?: {
    /** Where to centre the map when pick mode opens; null keeps the bounds. */
    at: { lat: number; lon: number } | null;
    /** Where to put the draggable marker at once, when the row already has a place. */
    marker: { lat: number; lon: number } | null;
  }) => void;
  /**
   * The point the rider last tapped or dragged to, with a token that changes
   * on every gesture. The token is what makes a second tap on the *same* spot
   * a new answer rather than a no-op — a rider who dragged the marker away and
   * tapped back where he started means that spot, and comparing coordinates
   * would leave the row on the place he had dragged to.
   */
  pickPoint?: { lat: number; lon: number; token: number } | null;
  /**
   * A position the map's own geolocate button obtained. Remembered here for
   * the same reason the crosshair's is: the next row's pick mode can then open
   * on the rider without a second permission prompt.
   */
  geolocated?: { lat: number; lon: number } | null;
  /**
   * The offer the map should be making while nobody is picking: a tap on empty
   * map adds a stop, or — at the cap — says why it will not.
   *
   * Built here rather than in the page because everything it depends on is the
   * form's: how many rows the ride has, and the locale the form is speaking.
   * The page owns the map and only has to relay it. `null` withdraws the offer
   * entirely, which is what pick mode does — the hint would then be a second
   * instruction over a map that is already following the first one.
   */
  onAddStopOfferChange?: (offer: { text: string; muted: boolean } | null) => void;
  /**
   * A point tapped on the map with no row waiting: a new stop, made here.
   *
   * Separate from `pickPoint` because the row does not exist yet — this is the
   * gesture that creates it. The token carries the same meaning it does there:
   * tapping the same spot twice is two answers, not one.
   */
  addStopPoint?: { lat: number; lon: number; token: number } | null;
}) {
  const [locale] = useLocale();
  const [places, setPlaces] = useState<string[]>(placesFromPlan(initialPlan));
  // One way is the default: it is the ride that needs both rows, so the form
  // reads "No … Līdz …" on open. A plan being edited keeps the shape it had —
  // `returnToStart` is explicit on every stored plan, so only a genuinely
  // absent plan falls through to the default.
  const [tripType, setTripType] = useState<"round_trip" | "one_way">(initialPlan?.returnToStart === true ? "round_trip" : "one_way");
  const [durationMode, setDurationMode] = useState<"flexible" | "hours">(initialPlan?.budget.mode === "duration" ? "hours" : "flexible");
  // The chips and the field are two ways to say the same thing, never mirrored
  // into each other: a rider who wants 2.5 h should type it, not first delete a
  // number Mopik put there. `preset` holds the chosen chip, `hours` the typed
  // value; the last one touched wins.
  const initialHours = initialPlan?.budget.mode === "duration" ? initialPlan.budget.value ?? null : null;
  const PRESETS = [2, 4, 6, 8];
  const [preset, setPreset] = useState<number | null>(initialHours && PRESETS.includes(initialHours) ? initialHours : initialHours ? null : 4);
  const [hours, setHours] = useState(initialHours && !PRESETS.includes(initialHours) ? String(initialHours) : "");
  const [error, setError] = useState<string | null>(null);
  // Phone only: the map is opened on request, and stays open once it is.
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  /**
   * The row waiting for a point on the map, or none.
   *
   * A row index rather than a flag, because every row can be picked this way —
   * the start, the finish and any stop. The rider asked for exactly that: a
   * forest crossroads has no name to type, and "Līdz" is as often such a place
   * as "No" is.
   */
  const [pickingRow, setPickingRow] = useState<number | null>(null);
  /**
   * Whether the row being picked was created by the tap that started the pick.
   *
   * A stop added from the map does not exist until the tap makes it, so Cancel
   * has to undo the tap as well as the pick — otherwise the rider who changes
   * his mind is left with a blank "Caur (1)" he never asked for and now has to
   * find the ✕ for. The pin button's rows are never removed on cancel: those
   * were already part of the ride.
   */
  const [rowIsNew, setRowIsNew] = useState(false);

  /**
   * Name a point, wherever it came from.
   *
   * The crosshair and a tap on the map are the same problem — coordinates with
   * no name — and they were the same fifteen lines twice over. The lookup is
   * best-effort on purpose: a point it cannot name still plans a ride, and the
   * coordinate pair in the field is a truthful answer rather than a failure.
   */
  const nameForPoint = useCallback(async (lat: number, lon: number): Promise<ResolvedPlace | null> => {
    try {
      const res = await fetch(`/api/places?lat=${lat}&lon=${lon}`);
      if (!res.ok) return null;
      return ((await res.json()) as { places: ResolvedPlace[] }).places?.[0] ?? null;
    } catch {
      // Offline, or the lookup is down. The point itself is still good.
      return null;
    }
  }, []);

  /**
   * "Mana vieta": the device's coordinates, named. Offered rather than applied
   * on load — the permission prompt at first sight of a form is a good way to
   * lose a rider, and an IP guess is often the wrong town. The point itself is
   * kept; the reverse lookup only supplies a name the rider recognises, and a
   * failed lookup still fills the field with the coordinates.
   */
  const useMyLocation = () => {
    if (!navigator.geolocation || locating) return;
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const { latitude: lat, longitude: lon } = coords;
        // Remembered so pick mode can open on the rider without asking again.
        setLastFix({ lat, lon });
        const found = await nameForPoint(lat, lon);
        const place: ResolvedPlace = found ?? { name: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, label: t(locale, "myLocation"), lat, lon };
        setPlaces((prev) => prev.map((p, i) => (i === 0 ? place.name : p)));
        setPick(0, place);
        // The same shelf a dropdown pick goes on. A place found by GPS was the
        // one kind of place the app forgot: `PlaceInput.pick` calls
        // `rememberPlace`, and this path never goes through it, so "Sigulda"
        // resolved by the crosshair was gone by the next visit.
        //
        // Stored as the *named* place, never as "my location": a recent entry
        // has to work later, from the sofa, with no GPS. When the reverse
        // lookup found nothing the fallback name is the coordinate pair, and
        // `rememberPlace` refuses that on its own — so this call is safe in
        // both branches above, and runs only after the lookup has settled.
        rememberPlace(place);
        setLocating(false);
        track("form_location_used");
      },
      () => { setLocating(false); setError(t(locale, "errLocation")); },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };
  // Picked places by row index. Typing again clears the pick, so a changed
  // name is geocoded rather than silently kept at the old coordinates.
  const [picked, setPicked] = useState<Record<number, ResolvedPlace | null>>(() => {
    if (!initialPlaces?.length) return {};
    // Matched by name rather than by position: the plan's rows and the routed
    // places can differ in length (a round trip repeats its start).
    const byName = new Map(initialPlaces.map((p) => [p.name.trim().toLowerCase(), p]));
    const seeded: Record<number, ResolvedPlace | null> = {};
    placesFromPlan(initialPlan).forEach((name, i) => {
      const found = byName.get(name.trim().toLowerCase());
      if (found) seeded[i] = found;
    });
    return seeded;
  });
  const setPick = (index: number, place: ResolvedPlace | null) => setPicked((prev) => ({ ...prev, [index]: place }));
  // Reordering moves the rows; the coordinates must follow their row, so the
  // picks are re-keyed by matching name rather than by the old index.
  const reorder = (next: string[]) => {
    const byName = new Map<string, ResolvedPlace>();
    for (const [i, p] of Object.entries(picked)) {
      const name = places[Number(i)]?.trim().toLowerCase();
      if (p && name) byName.set(name, p);
    }
    setPlaces(next);
    // An emptied row keeps no coordinates: matching is by name, and "" must
    // never inherit the pick of some other blank row.
    setPicked(Object.fromEntries(next.map((name, i) => {
      const key = name.trim().toLowerCase();
      return [i, key ? byName.get(key) ?? null : null];
    })));
  };

  /**
   * The last position the device gave us in this session.
   *
   * Kept so pick mode can centre on the rider without asking again: the
   * permission prompt is the expensive part, and a rider who has already
   * answered it once should not be asked a second time to see the same map.
   * Never *requested* from here — only remembered when the crosshair or the
   * map's own geolocate button has already obtained it.
   */
  const [lastFix, setLastFix] = useState<{ lat: number; lon: number } | null>(null);
  // The map's geolocate button is the other way a fix arrives. Same shelf.
  useEffect(() => { if (geolocated) setLastFix(geolocated); }, [geolocated]);

  /**
   * The rows' own text, read from inside the point handler.
   *
   * The handler runs from a token the *page* changes, so it cannot close over
   * the form's state and still see it: without this it would compare a new
   * pick against whatever the rows held when the row entered pick mode, and a
   * name typed in between would not count as a collision.
   */
  const placesRef = useRef(places);
  useEffect(() => { placesRef.current = places; }, [places]);
  const pickingRowRef = useRef(pickingRow);
  useEffect(() => { pickingRowRef.current = pickingRow; }, [pickingRow]);

  /**
   * The place under the marker, named but not yet the row's answer.
   *
   * Picking is two steps on purpose. A tap lands within ~30 m of where it was
   * aimed and the rider corrects it by dragging, so the name changes two or
   * three times before it is the right one — committing on every one of those
   * would mean the form kept answering a question that was still being asked.
   * The row shows this as a preview; "Apstiprināt" is what makes it the ride's.
   */
  const [preview, setPreview] = useState<ResolvedPlace | null>(null);

  /**
   * A point arrived from the map — a tap in pick mode, or a drag of the marker
   * that tap left behind.
   *
   * The name is the reverse lookup's, made distinguishable where the ride
   * already uses it (`pickedPlace`): two taps in one parish both come back
   * "Ķekava", and the API resolves a row to its coordinates *by name*, so
   * without this the second row would silently be planned through the first
   * one's point. The row being picked into is excluded from the comparison —
   * re-picking a row must not make it collide with its own old name.
   */
  const token = pickPoint?.token ?? null;
  useEffect(() => {
    const row = pickingRowRef.current;
    // Token 0 is the seed the page puts under a row that already has a place:
    // its name is known and shown, and re-deriving one would only risk showing
    // the rider a different word for the spot he has not yet moved.
    if (!pickPoint || pickPoint.token === 0 || row === null) return;
    const { lat, lon } = pickPoint;
    let cancelled = false;
    void (async () => {
      const found = await nameForPoint(lat, lon);
      if (cancelled) return;
      const taken = placesRef.current.filter((_, i) => i !== row);
      setPreview(pickedPlace(found, lat, lon, taken, t(locale, "pickedOnMap")));
    })();
    // A drag landing while the previous lookup is still in flight must not let
    // the older answer overwrite the newer one.
    return () => { cancelled = true; };
    // Keyed on the token: the same coordinates tapped twice are two answers,
    // and `pickPoint` itself is rebuilt by the page on every gesture anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  /**
   * A tap on the open map with no row waiting: a stop, made on the spot.
   *
   * This is the gesture the rider asked for. Adding a stop used to be "press
   * Pievienot pieturvietu, then find the new row's pin, then tap the map" —
   * three targets for one intention, two of them in a form he had scrolled
   * away from to look at the map. Now the map itself is the first step.
   *
   * The row is inserted by `addStop`, the same function the form's own button
   * calls, so a stop lands in the same place whichever way it was asked for —
   * before the finish one way, at the head of the stops on a round trip.
   *
   * It then enters pick mode exactly as the pin would have: the new row is the
   * picked row, the marker is at the tap, and Apstiprināt / Atcelt are the two
   * ways out. Nothing is committed by the tap alone — a tap is easy to make by
   * accident on a surface that also pans, and Cancel takes the row away again.
   *
   * The name is derived here rather than left to the effect above, which reads
   * `pickingRowRef`: that ref is only updated by an effect of its own, so at
   * this moment it still says "no row" and the lookup's answer would be thrown
   * away. The row index is known here anyway.
   */
  const addToken = addStopPoint?.token ?? null;
  useEffect(() => {
    // Only when nothing else is going on. A tap arriving while a row is
    // already being picked belongs to that row, and the map never sends one:
    // the page wires this door shut in pick mode. Guarded anyway, because a
    // token in flight across the frame that opens pick mode would otherwise
    // add a stop the rider did not ask for.
    if (!addStopPoint || pickingRow !== null) return;
    const { lat, lon } = addStopPoint;
    const oneWay = tripType === "one_way";
    const current = placesRef.current;
    // The cap the form's own button obeys. The map's hint has already said so
    // — this is the second lock, for the tap that was in flight when the last
    // row was added.
    if (current.length >= MAX_ROWS) return;
    const next = addStop(current, oneWay);
    const row = addedStopIndex(current, oneWay);
    reorder(next);
    setPickingRow(row);
    setRowIsNew(true);
    setMapOpen(true);
    setError(null);
    // No `at`: the rider tapped what he can already see, and flying the map to
    // re-centre on his own finger would move the ground out from under the
    // marker he is about to drag. The marker goes exactly where he tapped.
    onPickModeChange?.(true, { at: null, marker: { lat, lon } });
    track("stop_added_from_map", { count: next.length });

    let cancelled = false;
    void (async () => {
      const found = await nameForPoint(lat, lon);
      if (cancelled) return;
      // Every other row's text is what the new name must not collide with —
      // the new row's own is blank, so it cannot be its own collision.
      const taken = next.filter((_, i) => i !== row);
      setPreview(pickedPlace(found, lat, lon, taken, t(locale, "pickedOnMap")));
    })();
    return () => { cancelled = true; };
    // Keyed on the token, like every other gesture from the map: two taps on
    // the same spot are two stops, and comparing coordinates would swallow
    // the second one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addToken]);

  /** Leave pick mode and give the map back, keeping whatever the rows now hold. */
  const endPicking = () => {
    setPickingRow(null);
    setPreview(null);
    setRowIsNew(false);
    onPickModeChange?.(false);
  };

  const cancelPicking = () => {
    const row = pickingRow;
    endPicking();
    // Take the ghost row away with the pick that created it. Through
    // `reorder`, not `setPlaces`, so the other rows' coordinates are re-keyed
    // to their new indices — the row being dropped is blank and carries none.
    if (rowIsNew && row !== null) reorder(places.filter((_, i) => i !== row));
  };

  /**
   * Hand a row to the map.
   *
   * On a phone the map is behind the "Rādīt kartē" toggle, which the rider may
   * not have opened yet — so entering pick mode opens the map itself, under
   * the row that asked.
   */
  const startPicking = (index: number) => {
    // A second press on the same row's pin puts it away again, so the pin is
    // its own way out as well as the way in.
    if (pickingRow === index) { cancelPicking(); return; }

    /**
     * Where to open the map, best first.
     *
     * 1. This row's own place. "Mana lokācija → pavilkt → Apstiprināt" is the
     *    start row's whole flow: the crosshair puts the rider's town in the
     *    field, and the pin then only has to be nudged onto the right yard.
     *    The marker is seeded there too, so there is something to drag at once.
     * 2. Any other place already confirmed in the ride — a finish picked near
     *    a start is far likelier than a finish on another continent.
     * 3. The last fix this session already obtained. Reused, never re-asked:
     *    the prompt is offered, never assumed.
     * 4. Nothing, and the map keeps the bounds it has.
     */
    const own = picked[index] ?? null;
    const at = own ?? confirmed[0] ?? lastFix ?? null;
    // Only the row's own place seeds a marker. Another row's place, or the
    // rider's own position, says where to *look* — putting a draggable pin on
    // it would be Mopik answering a question it was not asked, and one tap on
    // Apstiprināt away from planting the finish on top of the start.
    setPreview(own);
    setPickingRow(index);
    // The pin hands over a row the ride already has, so Cancel must leave it
    // standing. Only the map's own tap creates a row, and only that tap sets
    // this.
    setRowIsNew(false);
    setMapOpen(true);
    setError(null);
    onPickModeChange?.(true, { at, marker: own ? { lat: own.lat, lon: own.lon } : null });
  };

  /** "Apstiprināt": the previewed place becomes the row's, and picking ends. */
  const confirmPick = () => {
    const row = pickingRow;
    if (row === null || !preview) return;
    setPlaces((prev) => prev.map((p, i) => (i === row ? preview.name : p)));
    setPick(row, preview);
    // The same shelf a dropdown pick goes on, for the same reason the
    // crosshair's place goes there: a spot found once should be offered by
    // name the next time, from the sofa, with no map open.
    rememberPlace(preview);
    track("place_picked_on_map", { row, start: row === 0 });
    // `endPicking`, never `cancelPicking`: a stop added from the map is a new
    // row, and Cancel's job is to take such a row away again — running that
    // here would delete the very stop this press just committed.
    endPicking();
  };

  /**
   * Tell the page what the map should be offering.
   *
   * The offer stands whenever the planning map is open and idle: no row is
   * waiting, so a tap means nothing yet and can be given a meaning. In pick
   * mode it is withdrawn — the pick slot's own hint is already telling the
   * rider what the map is for, and two instructions over one map is one too
   * many. At the cap the offer becomes an explanation instead of an
   * invitation, because a tap that silently does nothing is worse than a
   * greyed sentence saying why.
   *
   * Deliberately not conditioned on the map being on screen. The hint is drawn
   * *by* the map, so a map that is not mounted shows nothing either way, and
   * the two places a map can be mounted — the phone's toggle and the desktop's
   * own column — are the page's business, not the form's. Asking the form to
   * track both is how the offer would end up right in one of them and wrong in
   * the other.
   */
  const offerText = places.length >= MAX_ROWS ? t(locale, "tapMapStopsFull") : t(locale, "tapMapToAddStop");
  const offerMuted = places.length >= MAX_ROWS;
  const offering = pickingRow === null;
  useEffect(() => {
    onAddStopOfferChange?.(offering ? { text: offerText, muted: offerMuted } : null);
    // The parent's callback is an inline arrow and is rebuilt every render;
    // listing it would re-report the same offer on every keystroke in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offering, offerText, offerMuted]);
  // Nothing is offered once the form is gone. Without this the page would keep
  // wiring the map's add-stop door after the rider left for the result.
  useEffect(() => () => onAddStopOfferChange?.(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  // Escape leaves pick mode, the same key that dismisses everything else on
  // the map. A rider on a laptop who pressed the pin by mistake should not
  // have to find the pin again to get an ordinary map back — and nothing has
  // been committed to the row, so escaping costs him nothing.
  useEffect(() => {
    if (pickingRow === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelPicking(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `cancelPicking` is rebuilt every render; listing it would re-attach the
    // listener on every keystroke in the form. Whether a row is being picked
    // is the only thing this effect is about.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingRow]);

  // Report picked places upward in riding order, so the map can draw a pin per
  // confirmed place and the rider sees that "Brīvības iela 105" is the one
  // they meant before spending a generation on it. In an effect, not inside
  // the state updater: calling a parent's setState while rendering is exactly
  // what React warns about.
  const confirmed = places.map((_, i) => picked[i]).filter((p): p is ResolvedPlace => Boolean(p));
  // The first pinned place biases every other row's search: choosing Sigulda
  // as the start should offer Latvian places below it, not a same-named
  // village on another continent. Until something is pinned the server falls
  // back to the rider's own region.
  const anchor = confirmed[0] ?? null;
  const confirmedKey = confirmed.map((p) => `${p.lat},${p.lon}`).join("|");
  useEffect(() => {
    onPlacesChange?.(confirmed, tripType);
    // `confirmed` is rebuilt each render; the key is what actually changes.
    // `tripType` is in the list too: switching Turp un atpakaļ ↔ Vienā virzienā
    // moves the same last place between "finish" and "stop", so the map has to
    // re-draw its marker without a place being re-picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmedKey, tripType]);

  // A plan the chat has modified carries its own profile; otherwise the
  // rider's remembered one applies.
  //
  // Once a ride has been generated, `initialPlan` is set for the rest of the
  // session, so reading the profile from it alone made every profile button
  // dead on the way back from a result: the click updated the remembered
  // profile, the plan re-rendered over it, and nothing moved. The plan only
  // seeds the choice; a click made here wins until the plan itself changes.
  const [profileOverride, setProfileOverride] = useState<RideProfile | null>(null);
  const effectiveProfile = profileOverride ?? (initialPlan ? profileFromPlan(initialPlan) : profile);
  const changeProfile = (next: RideProfile) => {
    setProfileOverride(next);
    onProfileChange(next);
  };

  const submit = () => {
    const filled = places.map((p) => p.trim()).filter(Boolean);
    // Name the field that is missing. "Norādi vismaz vienu vietu" was shown to
    // a rider who had filled in "Līdz" and left "No" empty — technically about
    // the count, but read as a lie about the field he had just typed into.
    if (!places[0]?.trim()) { setError(t(locale, "errNoStart")); return; }
    // An empty "Līdz" is a real answer — "man vienalga", the same ride the
    // lucky mode already handles — so only a one-way request with nothing but
    // a start is refused: there is no direction to send it in.
    if (tripType === "one_way" && filled.length < 2) { setError(t(locale, "errNoDestination")); return; }
    const value = hours.trim() ? Number(hours.replace(",", ".")) : preset ?? NaN;
    if (durationMode === "hours" && (!Number.isFinite(value) || value < 0.5 || value > 16)) { setError(t(locale, "errHours")); return; }
    const plan = composeRidePlan({ places, tripType, durationMode, hours: value, profile: effectiveProfile });
    setError(null);
    onGenerate(plan, Object.values(picked).filter((p): p is ResolvedPlace => p !== null));
  };

  /**
   * Everything the rider needs while a row is waiting for a point, rendered
   * under that row: what to do, the map, and the two ways out.
   *
   * On a phone the map itself is in here — the same node the page hands down,
   * moved into this slot rather than mounted a second time. On the desktop the
   * map keeps its own column and `map` is undefined, so this is the hint and
   * the buttons alone, sitting against the ringed row they belong to.
   */
  const pickSlot = pickingRow === null ? null : (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 rounded-xl bg-[#fff3ea] px-3 py-2 text-xs font-medium text-[#bd4b00]" role="status">
        <MapPinPlus className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">{fi(t(locale, "pickOnMapHint"), { label: rowLabel(locale, pickingRow, tripType === "one_way", places.length) })}</span>
      </div>
      {map && <div>{map}</div>}
      {/* The two ways out, under the map rather than over it: a primary button
          on the map itself would be a thing to tap in the middle of a surface
          whose whole job this minute is to receive taps. Confirm is dead until
          there is a point to confirm — a rider who presses it before tapping
          should be told by its state, not by nothing happening. */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={confirmPick} disabled={!preview}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-40">
          <Check className="size-4" />{t(locale, "pickOnMapConfirm")}
        </button>
        <button type="button" onClick={cancelPicking}
          className="h-10 shrink-0 rounded-full border border-stone-200 px-4 text-sm font-medium text-stone-600 transition hover:bg-stone-50">
          {t(locale, "pickOnMapCancel")}
        </button>
      </div>
    </div>
  );

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label={t(locale, "a11yRideInput")}>
      <div className="border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{t(locale, "composerEyebrow")}</div>
        <h2 className="text-lg font-semibold tracking-tight">{t(locale, "composerTitle")}</h2>
        <p className="mt-1 hidden text-xs text-stone-500 md:block">{t(locale, "composerHint")}</p>
      </div>

      {/* Scrolls inside the fixed-height column when the profile panel is
          open; overflow-hidden on the section otherwise trapped the content. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-5">
        {/* Trip type first: it decides what the last row means — a waypoint on
            the way home, or the finish. Asking for places before knowing the
            shape of the ride is asking the rider to guess. */}
        <ChoiceRow label={t(locale, "tripType")} value={tripType} onChange={(v) => { track("trip_type_changed", { to: v }); setTripType(v); }} choices={[{ value: "one_way", label: t(locale, "oneWay") }, { value: "round_trip", label: t(locale, "roundTrip") }]} />

        <RoutePlaces places={places} picked={picked} oneWay={tripType === "one_way"} busy={busy} onChange={reorder} onPick={setPick} onUseLocation={useMyLocation} locating={locating} near={anchor}
          onPickOnMap={onPickModeChange ? startPicking : undefined} pickingRow={pickingRow} pickSlot={pickSlot} preview={preview} />

        {/* The map is worth a look when a place needs confirming, not on every
            visit — it is the tallest thing on the page and most rides are
            planned without ever glancing at it. So it opens on request.

            The toggle itself is now always here. It used to appear only once
            a place was confirmed, which was backwards the moment the map
            became a way of *adding* places: the rider with an empty form is
            exactly the one who wants to open the map and point at something,
            and he was the one it was hidden from. (Pick mode had already been
            excused from the rule for the same reason; this generalises it.)

            While a row is being picked the map has moved up into that row's
            own slot, so this whole block steps aside rather than offering to
            hide the very thing the rider was asked to tap. */}
        {map && pickingRow === null && (
          <div className="md:hidden">
            <button type="button" onClick={() => setMapOpen((v) => { if (!v) track("form_map_opened"); return !v; })} aria-expanded={mapOpen}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-[#bd4b00]">
              <MapIcon className="size-3.5" />
              {mapOpen ? t(locale, "hideMap") : t(locale, "showOnMap")}
              {mapOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
            </button>
            {/* Mounted only while open: MapLibre in a hidden container comes
                up sized zero and stays that way until something resizes it. */}
            {mapOpen && <div className="mt-2">{map}</div>}
          </div>
        )}

        <ChoiceRow label={t(locale, "duration")} value={durationMode} onChange={setDurationMode} choices={[{ value: "flexible", label: t(locale, "flexible") }, { value: "hours", label: t(locale, "exact") }]} />
        {durationMode === "hours" && (
          <div className="flex items-stretch gap-1.5" role="group" aria-label={t(locale, "a11yHours")}>
            {/* The usual days as one tap each; the field is for everything else. */}
            {PRESETS.map((h) => {
              const active = !hours.trim() && preset === h;
              return (
                <button key={h} type="button" onClick={() => { setPreset(h); setHours(""); }} aria-pressed={active}
                  className={`h-10 min-w-0 flex-1 rounded-xl border text-sm font-semibold tabular-nums transition ${active ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700 hover:border-stone-300"}`}>
                  {h} h
                </button>
              );
            })}
            <label className="flex h-10 w-[5.5rem] shrink-0 items-center gap-1 rounded-xl border border-stone-200 px-2.5 focus-within:border-[#f56300]">
              {/* type=text + inputMode=decimal: iOS opens the number pad, and "2,5" stays typeable. */}
              <input type="text" inputMode="decimal" pattern="[0-9]*[.,]?[0-9]*" placeholder={t(locale, "hoursOther")} aria-label={t(locale, "a11yHoursOther")} value={hours} onChange={(e) => { setHours(e.target.value); if (e.target.value.trim()) setPreset(null); }} className="min-w-0 flex-1 bg-transparent text-right text-base font-semibold outline-none md:text-sm" />
              <span className="text-xs text-stone-400">h</span>
            </label>
          </div>
        )}

        <ProfileLine profile={effectiveProfile} onChange={changeProfile} />

        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

        {/* Pushed to the bottom on the desktop so the column is used and the
            action is where a form's action belongs. */}
        <div className="md:mt-auto" />
        <button type="button" onClick={submit} disabled={busy} className="flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-50"><Sparkles className="size-4" />{t(locale, "generate")}</button>
        <button type="button" onClick={onUseChat} disabled={busy} className="w-full text-center text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800">{t(locale, "orUseChat")}</button>
      </div>
    </section>
  );
}
