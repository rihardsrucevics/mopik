"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Map as MapIcon, Sparkles, TriangleAlert } from "lucide-react";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { RoutePlaces, addStop, addedStopIndex, defaultActiveRow, rowLabel, MAX_ROWS } from "@/components/route-places";
import { useLocale } from "@/lib/i18n/use-locale";
import { t, messages, type MessageKey } from "@/lib/i18n/messages";
import { track } from "@/lib/analytics";
import { rememberPlace } from "@/lib/chat/recent-places";
import { pickedPlace } from "@/lib/chat/pick-name";
import { fi } from "@/lib/i18n/format";
import type { ResolvedPlace } from "@/lib/chat/places";
import { placeRoles, type PlaceRoles } from "@/lib/map/place-roles";
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

export function RideComposer({ initialPlan, initialPlaces, profile, onProfileChange, busy, onGenerate, onUseChat, onPlacesChange, map, mapShown: mapOnPage = false, onPickModeChange, pickPoint, geolocated, onMapControlsChange }: {
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
   * The picked places **with the role of the row each came from**, so the map
   * can draw the right pin on each before a ride exists.
   *
   * It used to be a flat list of whatever had been confirmed, plus the trip
   * type, and the map worked the roles out by position — `[0]` is the start,
   * the last is the finish. That is right only when the form is filled from
   * the top down, and the rider does not fill it that way. Reported from
   * production: start row empty, four stops added from the map, finish row
   * empty — and the map drew a green start pin on the first stop and a red
   * finish pin on the last, so a ride he had only marked stops for claimed to
   * begin and end at them.
   *
   * This component is the one place that knows a row's role without guessing:
   * row 0 is the start, the last row of a one-way ride is the finish, the rest
   * are stops, and any of them may be empty. So the role travels with the
   * place. See `lib/map/place-roles.ts` for the mapping and its tests.
   */
  onPlacesChange?: (roles: PlaceRoles) => void;
  /**
   * The map, on phones only. It belongs to the places it confirms, so it sits
   * under them inside this block rather than above the whole page — where it
   * pushed even the saved-rides entry down and read as something separate
   * from the ride being described. The desktop keeps its own sticky column.
   */
  map?: ReactNode;
  /**
   * Is the planning map on screen at all?
   *
   * The form cannot work this out: on a phone the map is the `map` node behind
   * this component's own toggle, and on the desktop it is in a column the page
   * owns and this component never sees. Both are cases where exactly one row
   * must be active, and asking the form to infer it from `map` being undefined
   * is how the rule would end up right on one of them and wrong on the other.
   */
  mapShown?: boolean;
  /**
   * A row is active and the map is answering it, or the form has left the map
   * alone entirely.
   *
   * Pick mode belongs to the page, not to this form, because the page owns the
   * one MapLibre instance and everything it is told to draw. This says which
   * row the next tap belongs to (or that none does), and the page answers by
   * handing the map an `onPickPoint` and a draggable marker.
   */
  onPickModeChange?: (picking: boolean, open?: {
    /** Where to centre the map when the row becomes active; null keeps the bounds. */
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
   * Everything the map's own header bar shows while the rider is planning:
   * the one hint line, the button that makes a new stop, and the place field
   * that fills the active row by name instead of by tap.
   *
   * Built here rather than in the page because everything it depends on is the
   * form's — which row is active, what that row is called in the rider's
   * language, and how many rows the ride already has. The page owns the map
   * and only has to relay it, so the words and the behaviour are switched on
   * by one value and cannot disagree.
   *
   * `null` while the form is not planning on this map at all, which is what
   * unmounting reports: a map with no active row would otherwise keep a header
   * describing a form that has gone.
   */
  onMapControlsChange?: (controls: {
    /** "Atzīmē kartē → „Līdz”" — what the next tap does, always present. */
    hint: string;
    /** Make a new stop row and hand it to the map. Null at the cap. */
    onAddStop: (() => void) | null;
    /** Why the button is dead, shown as its tooltip at the cap. */
    addStopLabel: string;
    addStopFullLabel: string;
    /** The active row's own text and its place, for the header's search field. */
    search: {
      value: string;
      confirmed: ResolvedPlace | null;
      onChange: (value: string) => void;
      onPick: (place: ResolvedPlace | null) => void;
      /** Bias the search around a place the ride already has. */
      near: { lat: number; lon: number } | null;
      placeholder: string;
    };
  } | null) => void;
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
  /**
   * Is a planning map actually in front of the rider?
   *
   * Two ways it can be, and the rule ("exactly one active row while the map is
   * open") has to hold for both. On a phone the map node is handed to this
   * component and sits behind `mapOpen`; on the desktop there is no node here
   * at all and the page keeps the map in its own column, which `mapOnPage`
   * reports. `map` being undefined is therefore not "no map" — it is "the map
   * is somewhere this component cannot see".
   */
  /**
   * The one row the map is answering.
   *
   * ## Why there is exactly one of these
   *
   * The map used to carry two modes that looked identical. A row's pin button
   * put it in "pick a place for row X"; with no row waiting, a tap on the same
   * map created a new stop instead. Both drew a marker, both offered Confirm,
   * and which one the rider was in was invisible — so a tap meant two
   * different things depending on state nothing on screen reported. He saw
   * pins land in the wrong roles and called it a mess.
   *
   * So: while the planning map is open exactly one row is active, the map's
   * single hint line names it, and **a tap always means "this point → the
   * active row"**. A new stop is now an explicit button in the map's header
   * rather than a meaning a tap silently takes on. Confirming keeps the same
   * row active, so a second tap *moves* the place it just confirmed instead of
   * creating another one.
   *
   * A row index rather than a flag, because every row can be answered this way
   * — the start, the finish and any stop. The rider asked for exactly that: a
   * forest crossroads has no name to type, and "Līdz" is as often such a place
   * as "No" is.
   *
   * **Never null.** It is seeded with `defaultActiveRow` — the first empty
   * row, start first — and only ever moves because of something the rider did:
   * a pin button, "+ Pietura", a pick, or opening the map again. Deriving it
   * live from "the first empty row" was tried and moved under him: typing the
   * first letter of a name made that row non-empty, the rule handed the map to
   * the next one, and the field he was typing into emptied itself one
   * keystroke in. `activeRow` above only clamps it to a row that still exists,
   * for the case where the rider removes the row the map was answering.
   */
  const [chosenRow, setChosenRow] = useState(() => defaultActiveRow(placesFromPlan(initialPlan)));
  const mapShown = map ? mapOpen : mapOnPage;
  /**
   * The one row the map is answering, or none because the map is closed.
   *
   * **While the planning map is open, exactly one row is active.** That is the
   * whole invariant, and it holds here by construction: `chosenRow` is never
   * null, so the only thing that can make this null is the map not being on
   * screen at all.
   *
   * The clamp is for the one case the rider can cause and nothing else
   * handles: removing the row the map was answering. The index would then
   * point past the end, and the hint would name a row that is gone while the
   * next tap landed in whatever inherited the index.
   */
  const activeRow = !mapShown ? null : Math.min(chosenRow, Math.max(places.length - 1, 0));
  const [locating, setLocating] = useState(false);
  /**
   * Whether the active row was created by "+ Pietura" and has never been
   * confirmed.
   *
   * A stop made from the map does not exist until the button makes it, so
   * Cancel has to undo the insertion as well as the pick — otherwise the rider
   * who changes his mind is left with a blank "Caur (1)" he never asked for
   * and now has to find the ✕ for. A row the pin button handed over is never
   * removed on cancel: it was already part of the ride. Confirming clears this
   * for the same reason — once the row holds a place, Cancel on the *next*
   * tap must leave that place standing.
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
  const activeRowRef = useRef(activeRow);
  useEffect(() => { activeRowRef.current = activeRow; }, [activeRow]);

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
    const row = activeRowRef.current;
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
  //
  // Deliberately the first *confirmed* place rather than the start's row: a
  // rider who has pinned only a stop should still have his other rows biased
  // to that region. Biasing a search and drawing a pin are different
  // questions, and conflating them is what the bug above was.
  const anchor = confirmed[0] ?? null;

  /**
   * A pin the profile cannot reach, caught while the map is still open.
   *
   * Null except in the moment between a Confirm that found bad ground and the
   * rider's answer to it. It holds the place he tried to confirm and the road
   * the router did find, because "move it" has to commit a *different* point
   * from the one he tapped and the two must not be confused with each other.
   */
  const [offRoad, setOffRoad] = useState<
    { place: ResolvedPlace; row: number; snappedTo: { lat: number; lon: number } | null; distanceM: number } | null
  >(null);
  /** The probe is in flight: Confirm says so rather than appearing to do nothing. */
  const [checking, setChecking] = useState(false);

  /**
   * Drop the pick under the active row. Whatever the rows hold stands.
   *
   * It does *not* end pick mode, and it does not let go of the row. The map is
   * still open, so a row is still active — that is the invariant — and the
   * rider is most likely to try again on the very row he just cancelled.
   */
  const endPicking = () => {
    setPreview(null);
    setRowIsNew(false);
  };

  /**
   * "Atcelt": undo the pick, and the row itself if "+ Pietura" made it.
   *
   * A row made by "+ Pietura" and never confirmed is a ghost — the rider asked
   * for a stop, changed his mind, and must not be left with a blank "Caur (1)"
   * to find the ✕ for. Every other row was already part of the ride and stays,
   * and stays active: cancelling a pick is "not that spot", not "not that row".
   */
  const cancelPicking = () => {
    const row = activeRow;
    endPicking();
    setOffRoad(null);
    if (rowIsNew && row !== null) {
      // Through `reorder`, not `setPlaces`, so the other rows' coordinates are
      // re-keyed to their new indices — the row being dropped is blank and
      // carries none.
      reorder(places.filter((_, i) => i !== row));
      // The row the map was answering has gone, so the map goes back to the
      // question it would have asked had that row never existed.
      setChosenRow(defaultActiveRow(places.filter((_, i) => i !== row)));
    }
    // The violet marker goes with the pick it belonged to.
    onPickModeChange?.(true, { at: null, marker: null });
  };

  /**
   * Make this row the one the map is answering.
   *
   * On a phone the map is behind the "Rādīt kartē" toggle, which the rider may
   * not have opened yet — so activating a row opens the map itself, under the
   * row that asked.
   *
   * `isNew` says the row was just inserted by "+ Pietura" and so belongs to
   * Cancel; a row handed over by its own pin button never is.
   */
  const activateRow = (index: number, isNew = false) => {
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
    setChosenRow(index);
    setRowIsNew(isNew);
    setMapOpen(true);
    setError(null);
    setOffRoad(null);
    onPickModeChange?.(true, { at, marker: own ? { lat: own.lat, lon: own.lon } : null });
  };

  /**
   * A row's pin button.
   *
   * It activates the row, and that is all it does now. It used to toggle —
   * pressing the active row's pin put the map away again — which was the
   * escape hatch back to the old idle mode, where a tap meant something else.
   * With one row always active there is no such mode to return to, and a
   * second press on the pin of the row you are already answering is most
   * likely a rider making sure, not asking for the map to stop listening.
   */
  const startPicking = (index: number) => {
    // A row the rider hands over by its pin is a row the ride already has, so
    // Cancel must leave it standing — even if "+ Pietura" made it a moment ago
    // and he has since gone back to it deliberately.
    activateRow(index, false);
  };

  /**
   * "+ Pietura" on the map: insert a stop row and make it the active one.
   *
   * The explicit control that replaced "a tap on the idle map creates a stop".
   * The gesture is gone; the capability is not, and it is now something the
   * rider can see and aim at instead of a meaning a tap quietly took on.
   *
   * The row is inserted by `addStop`, the same function the form's own button
   * calls, so a stop lands in the same place whichever way it was asked for —
   * before the finish one way, at the head of the stops on a round trip.
   *
   * Nothing is committed by the press: the new row is blank and active, the
   * next tap previews a place in it, and Cancel takes the row away again.
   */
  const addStopFromMap = () => {
    // The rows as this render sees them, never `placesRef`. The ref is synced
    // by an effect and is therefore one commit behind whatever the last press
    // did — and the press before this one is very often the Confirm that
    // filled a row. Measured: pressing "+ Pietura" twice in a row read the
    // pre-Confirm list the second time and inserted the stop one row too high,
    // which silently emptied the stop the rider had just confirmed. The
    // handler is rebuilt every render, so `places` here is always current.
    const current = places;
    // The cap the form's own button obeys. The map's button is disabled at the
    // cap, so this is the second lock rather than the first.
    if (current.length >= MAX_ROWS) return;
    const oneWay = tripType === "one_way";
    const next = addStop(current, oneWay);
    const row = addedStopIndex(current, oneWay);
    reorder(next);
    track("stop_added_from_map", { count: next.length });
    // No `at` beyond what `activateRow` works out: a blank row has no place of
    // its own, so the map stays where the rider left it and his next tap lands
    // on the ground he is already looking at.
    setPreview(null);
    setChosenRow(row);
    setRowIsNew(true);
    setMapOpen(true);
    setError(null);
    setOffRoad(null);
    onPickModeChange?.(true, { at: null, marker: null });
  };

  /**
   * Put the previewed place in its row. The commit itself.
   *
   * **The row stays active.** This is the rule that makes one mode possible:
   * after Confirm the hint still names the same row, so the next tap *moves*
   * the place just confirmed — new preview, new Confirm — instead of meaning
   * something else. Leaving the map here is what created the invisible second
   * mode in the first place, where a tap on a map that looked exactly the same
   * created a row nobody had asked for.
   *
   * The preview is cleared because it has become the row's real answer, and
   * `rowIsNew` with it: a confirmed stop is part of the ride, so Cancel on a
   * later tap must leave it standing rather than deleting it.
   */
  const commitPick = (row: number, place: ResolvedPlace) => {
    setPlaces((prev) => prev.map((p, i) => (i === row ? place.name : p)));
    setPick(row, place);
    // The same shelf a dropdown pick goes on, for the same reason the
    // crosshair's place goes there: a spot found once should be offered by
    // name the next time, from the sofa, with no map open.
    rememberPlace(place);
    track("place_picked_on_map", { row, start: row === 0 });
    setOffRoad(null);
    setPreview(null);
    setRowIsNew(false);
    // **Pinned, not left to the default.** This row was empty a moment ago, so
    // the default rule ("the first empty row") would hand the map to the next
    // one the instant the name landed — and the rider's second tap, aimed at
    // correcting the pin he is looking at, would drop a place into a row he
    // had not asked about. Confirming is what makes a row *chosen*.
    setChosenRow(row);
    // The violet "being decided" marker goes, and the row's own role pin —
    // green start, red finish, numbered stop — appears under it. The row stays
    // active, so this re-opens the same pick mode with nothing to drag rather
    // than closing it: `at: null` keeps the map exactly where the rider is
    // looking, which is at the pin that just landed.
    onPickModeChange?.(true, { at: null, marker: null });
  };

  /**
   * "Apstiprināt": ask whether the ride can actually reach this pin, then
   * commit it.
   *
   * The check is the whole point of doing this here rather than at generation
   * time. Measured on Pilskalni 2 (2026-09-19): a farmstead whose only
   * approach is an `access=private` service road produced
   * "Neizdevās atrast maršrutu…" after 15 s, naming nothing — BRouter had
   * answered 200 for every candidate and quietly ended each line 471 m short.
   * One short probe here turns that into a choice made while the map is open
   * and the finger is still on the spot.
   *
   * **A pin we could not check is let through.** `probe-failed` means the
   * router did not answer, not that the ground is bad, and refusing a pick on
   * a failed request would make a network hiccup look like a verdict about a
   * place. The generation remains the backstop, and it now names the stop.
   */
  const confirmPick = () => {
    const row = activeRow;
    if (row === null || !preview || checking) return;
    const place = preview;
    // An answer already on screen is the rider's to act on; pressing Confirm
    // again asks the same question and would get the same answer.
    if (offRoad) return;
    setChecking(true);
    void (async () => {
      try {
        // The plan is built **with this pick already in its row**, not from
        // the form as it stands. The row being picked is still empty until
        // the commit, and a one-way ride whose finish is blank is an
        // incomplete plan: `planToIntent` refuses it ("Where should this
        // one-way ride finish?"), the route answers 500, and the pick then
        // falls through the `!response.ok` branch unchecked — which is
        // exactly the silent pass this whole check exists to prevent.
        //
        // Measured on Pilskalni 2: the API returns the right verdict for the
        // coordinate (471 m, `canMove`) while the composer was sending it a
        // plan it could not parse at all.
        //
        // Only the profile is read from this plan — `buildMotoProfileOptions`
        // over `planToIntent` — so filling the row with the place's own name
        // asks exactly the question the rider is about to ask for real.
        //
        // `destinationAny` then covers the rest: a rider who is picking his
        // START has a finish row that is still empty, and that is an
        // incomplete one-way plan for the same reason. It says "anywhere",
        // which is true of a ride still being composed and is the one answer
        // that cannot add a constraint the rider did not give. The finish, if
        // he names one later, is checked by its own press.
        const plan = composeRidePlan({
          places: places.map((p, i) => (i === row ? place.name : p)),
          tripType,
          durationMode,
          hours: hours.trim() ? Number(hours.replace(",", ".")) : preset ?? 4,
          profile: effectiveProfile,
        });
        const probePlan: RidePlan =
          plan.returnToStart || plan.destinationPlace?.trim()
            ? plan
            : { ...plan, destinationAny: true };
        const response = await fetch("/api/routable-point", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: place.lat,
            lon: place.lon,
            plan: probePlan,
            // Somewhere the ride already is, so the probe rides a real leg
            // towards the pin rather than a synthetic one beside it. The
            // row's own place is not it: that is the point being replaced.
            ...(confirmed.find((p) => p.lat !== place.lat || p.lon !== place.lon)
              ? (() => {
                  const other = confirmed.find((p) => p.lat !== place.lat || p.lon !== place.lon)!;
                  return { from: { lat: other.lat, lon: other.lon } };
                })()
              : {}),
          }),
        });
        if (!response.ok) { commitPick(row, place); return; }
        const data = (await response.json()) as {
          ok: boolean;
          snappedTo?: { lat: number; lon: number };
          distanceM?: number;
          reason?: string;
          canMove?: boolean;
        };
        // Only "too far from a road" is a verdict about the place. Everything
        // else — a refused probe, a router that did not answer — is a verdict
        // about the request, and the pick goes through.
        if (data.ok || data.reason !== "too-far-from-road") { commitPick(row, place); return; }
        track("pick_off_road", { row, distance_m: Math.round(data.distanceM ?? 0), can_move: Boolean(data.canMove) });
        setOffRoad({
          place,
          row,
          // Offered only when the server says the road is near enough to still
          // be the same place — `canMove`, so this and the refusal's own chip
          // cannot drift apart.
          snappedTo: data.canMove && data.snappedTo ? data.snappedTo : null,
          distanceM: Math.round(data.distanceM ?? 0),
        });
      } catch {
        // The same rule as a failed probe: a pick is not lost to a network
        // error.
        commitPick(row, place);
      } finally {
        setChecking(false);
      }
    })();
  };

  /** "Pārvietot uz tuvāko ceļu": commit the road the router found, not the tap. */
  const acceptOffRoadMove = () => {
    if (!offRoad?.snappedTo) return;
    const { place, row, snappedTo } = offRoad;
    track("pick_off_road_moved", { row, distance_m: offRoad.distanceM });
    // The name the rider picked, on the coordinates the ride can reach. The
    // place is the same place — that is what `canMove` asserts — so renaming
    // it here would tell him he had picked something else.
    commitPick(row, { ...place, lat: snappedTo.lat, lon: snappedTo.lon });
  };

  /**
   * Tell the page whether a row is active at all.
   *
   * The handlers — a pin press, "+ Pietura", a pick in the map's field — say
   * *where* to open and what to put under the marker, which only they know.
   * This says the simpler thing they cannot: that the map has become (or
   * stopped being) a surface whose taps answer a row, which happens on its own
   * whenever the map opens or closes and the default rule takes over.
   *
   * Keyed on "is there a row" rather than on which one, because the page's
   * answer to both is the same: wire `onPickPoint`, or do not. Re-running it
   * on every change of row would re-seed the marker the handlers just placed.
   */
  const picking = activeRow !== null;
  useEffect(() => {
    if (!picking) { onPickModeChange?.(false); return; }
    // No `at`, no `marker`: the map stays where the rider left it and the
    // violet pin is only ever placed by something he did.
    onPickModeChange?.(true, { at: null, marker: null });
    // The parent's callback is an inline arrow, rebuilt every render; listing
    // it would re-open pick mode on every keystroke in the form and throw away
    // the marker under the rider's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);

  /**
   * Hand the map's own header bar everything it shows.
   *
   * The form builds it because the form is what knows it: which row is active,
   * what that row is called in the rider's language, how many rows the ride
   * has and which places it may bias a search around. The page owns the map
   * and relays this — so the hint, the button and the field are switched on by
   * one value and cannot disagree with what a tap actually does.
   *
   * Deliberately not conditioned on the map being on screen in any particular
   * place. The header is drawn *by* the map, so a map that is not mounted
   * shows nothing either way, and the two places a map can be mounted — the
   * phone's toggle and the desktop's own column — are the page's business.
   */
  const activeLabel = activeRow === null ? "" : rowLabel(locale, activeRow, tripType === "one_way", places.length);
  const atCap = places.length >= MAX_ROWS;
  /**
   * Every row's text, as one string, so the header is rebuilt whenever any of
   * them changes.
   *
   * `places.length` and the active row's own value are not enough, and the gap
   * between them cost a stop. Confirming a preview leaves the active row's
   * *displayed* value identical — the preview's name becomes the row's name —
   * so nothing in a narrower dependency list changes, the effect does not
   * re-run, and the map keeps the "+ Pietura" handler built for the rows as
   * they were before the Confirm. Pressing it then inserted against a stale
   * list and wiped the stop the rider had just confirmed. Measured: three
   * presses left rows 0 and 1 empty and two named places gone.
   */
  const rowsKey = places.join(String.fromCharCode(0));
  const activeValue = activeRow === null ? "" : (preview ? preview.name : places[activeRow] ?? "");
  const activeConfirmed = activeRow === null ? null : (preview ?? picked[activeRow] ?? null);
  useEffect(() => {
    if (activeRow === null) { onMapControlsChange?.(null); return; }
    onMapControlsChange?.({
      hint: fi(t(locale, "mapActiveRowHint"), { label: activeLabel }),
      // Null at the cap rather than a handler that returns: the button is then
      // disabled and says why, and a control that does nothing is never shipped.
      onAddStop: atCap ? null : addStopFromMap,
      addStopLabel: t(locale, "mapAddStop"),
      addStopFullLabel: t(locale, "mapAddStopFull"),
      search: {
        value: activeValue,
        confirmed: activeConfirmed,
        // Typing in the map's field is typing in the row, exactly as in the
        // form: the same `onChange`, so a name typed here is geocoded at
        // generation time even if the rider never picks from the list. A
        // preview under the marker is replaced the moment he types, because he
        // has stopped answering with the map and started answering with words.
        onChange: (value: string) => {
          setPreview(null);
          setPlaces((prev) => prev.map((p, i) => (i === activeRow ? value : p)));
          setPick(activeRow, null);
          // Typing is choosing the row, too. Without this the first letter
          // fills the row, the default rule ("the first empty row") sees it is
          // no longer empty and hands the map to the next one — and the field
          // the rider is typing into empties itself under his thumb, one
          // keystroke in. Measured on "Rigas": row 0 held it, the field went
          // blank and the hint had moved to „Līdz”.
          setChosenRow(activeRow);
        },
        // A pick from the dropdown is the row's answer at once — the same
        // `onPick` path the form's field takes, tick and recent places
        // included. There is nothing to Confirm: the rider chose a named place
        // from a list, which is not the "did I hit the right yard" question
        // that tapping a map asks.
        onPick: (place: ResolvedPlace | null) => {
          if (!place) { setPick(activeRow, null); return; }
          track("place_picked", { row: activeRow, start: activeRow === 0 });
          setPreview(null);
          setPlaces((prev) => prev.map((p, i) => (i === activeRow ? place.name : p)));
          setPick(activeRow, place);
          setRowIsNew(false);
          setOffRoad(null);
          // The same pinning a Confirm does, and for the same reason: filling
          // this row must not hand the map to the next empty one behind the
          // rider's back while he is still looking at what he just chose.
          setChosenRow(activeRow);
          // Take the map to it, and clear the violet marker: the row now holds
          // a place chosen by name, and a draggable pin left on the last tap
          // would be a second, older answer to the same row.
          onPickModeChange?.(true, { at: { lat: place.lat, lon: place.lon }, marker: null });
        },
        near: anchor,
        placeholder: t(locale, "mapSearchPlaceholder"),
      },
    });
    // The parent's callback is an inline arrow and is rebuilt every render;
    // listing it would re-report the same controls on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow, activeLabel, atCap, activeValue, activeConfirmed, anchor, locale, tripType, rowsKey]);
  // Nothing is offered once the form is gone. Without this the page would keep
  // drawing a map header for a form the rider has left.
  useEffect(() => () => onMapControlsChange?.(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);

  // Escape is Atcelt, the same key that dismisses everything else on the map.
  // A rider on a laptop who activated a row by mistake should not have to find
  // the pin again — and nothing has been committed to the row, so escaping
  // costs him nothing.
  //
  // `rowIsNew` and `preview` are in the deps because the listener closes over
  // them and they are exactly what Cancel branches on. Measured: pressing
  // "+ Pietura" on a two-row form makes the new stop row 1, which is also the
  // row "Līdz" had been — `activeRow` did not change, the listener was not
  // rebuilt, and Escape ran an older closure that still believed the row was
  // one the ride already had. It left the ghost row it exists to remove.
  useEffect(() => {
    if (activeRow === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancelPicking(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `cancelPicking` itself is rebuilt every render; listing it would
    // re-attach the listener on every keystroke in the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRow, rowIsNew, preview, rowsKey]);

  // The rows as roles, which is what the map is actually asking about. Keyed
  // on the role of each row and not merely on the coordinates, so moving a
  // place from the finish row to a stop row re-draws its pin.
  const roles = placeRoles({ picked, rowCount: places.length, tripType });
  const rolesKey = [
    roles.start ? `s:${roles.start.lat},${roles.start.lon}` : "s:-",
    ...roles.vias.map((v, i) => `v${i}:${v.lat},${v.lon}`),
    roles.finish ? `f:${roles.finish.lat},${roles.finish.lon}` : "f:-",
  ].join("|");
  useEffect(() => {
    onPlacesChange?.(roles);
    // `roles` is rebuilt each render; the key is what actually changes. It
    // carries the trip type implicitly — switching Turp un atpakaļ ↔ Vienā
    // virzienā moves the last place between "finish" and "stop", which changes
    // the key even though no place was re-picked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesKey]);

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
   * The two ways out of a pick, rendered under the active row.
   *
   * The hint that used to head this slot has gone to the map, where the rider
   * is actually looking: the map now carries one hint line, always present,
   * always naming the row the next tap answers. A second copy of it against
   * the row was the other half of the "two modes that look identical" problem
   * — two instructions over one map, each true only some of the time.
   *
   * The map itself is no longer moved in here either. It stays in the one
   * place it is mounted (the toggle below on a phone, the page's own column on
   * the desktop) for as long as the rider is planning, because there is no
   * longer a mode it leaves: a row is always active while the map is open, so
   * shuttling the node between two slots would remount MapLibre on every pin
   * press. The ringed row and the map's own hint say which field is being
   * answered, which is what the moving map was for.
   *
   * It appears only when there is something to act on: a previewed point, a
   * row "+ Pietura" made and has not been answered yet, or a verdict about bad
   * ground. A confirmed row stays active so that the next tap MOVES its place
   * — but until that tap there is nothing to confirm and nothing to cancel,
   * and a pair of buttons that do nothing is exactly what the rider said not
   * to ship. The next tap brings them back with a preview under them.
   */
  const pickSlot = activeRow === null || !(preview || rowIsNew || offRoad) ? null : (
    <div className="mt-2 space-y-2">
      {/* The verdict on the tapped point, under the map and above the buttons.
          Here rather than in a dialog because the rider is still looking at
          the spot: the map stays on screen, the pin stays where he put it, and
          the answer sits between what he did and what he can do about it.
          `role="alert"` — it arrives after a press and replaces what Confirm
          was about to do, which is exactly what a screen reader must be told
          without being asked. */}
      {offRoad && (
        <div className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5" role="alert">
          <div className="flex gap-2 text-xs font-medium text-amber-900">
            <TriangleAlert className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{fi(t(locale, "pickOffRoadTitle"), { m: offRoad.distanceM })}</span>
          </div>
          {/* Move is offered only when the server said the road is near enough
              to still be the same place (`canMove`, which is what `snappedTo`
              being non-null here means). Cancel is always offered, and is the
              only way out when it is not: a chip that cannot act must not be
              drawn — the rider's rule. */}
          <div className="flex items-center gap-2">
            {offRoad.snappedTo && (
              <button type="button" onClick={acceptOffRoadMove}
                className="h-9 flex-1 rounded-full bg-[#f56300] px-3 text-xs font-semibold text-white transition hover:bg-[#d85600]">
                {t(locale, "pickOffRoadMove")}
              </button>
            )}
            <button type="button" onClick={() => setOffRoad(null)}
              className={`h-9 rounded-full border border-amber-300 px-3 text-xs font-medium text-amber-900 transition hover:bg-amber-100 ${offRoad.snappedTo ? "shrink-0" : "flex-1"}`}>
              {t(locale, "pickOffRoadCancel")}
            </button>
          </div>
        </div>
      )}
      {/* The two ways out, under the map rather than over it: a primary button
          on the map itself would be a thing to tap in the middle of a surface
          whose whole job this minute is to receive taps. Confirm is dead until
          there is a point to confirm — a rider who presses it before tapping
          should be told by its state, not by nothing happening. While the
          probe is in flight it is disabled and says so, because a press that
          takes a second and shows nothing reads as a button that does not
          work. */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={confirmPick} disabled={!preview || checking || Boolean(offRoad)}
          className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-40">
          <Check className="size-4" />{checking ? t(locale, "pickOnMapChecking") : t(locale, "pickOnMapConfirm")}
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
          onPickOnMap={onPickModeChange ? startPicking : undefined} activeRow={mapShown ? activeRow : null} pickSlot={mapShown ? pickSlot : null} preview={preview} />

        {/* The map is worth a look when a place needs confirming, not on every
            visit — it is the tallest thing on the page and most rides are
            planned without ever glancing at it. So it opens on request.

            The toggle itself is now always here. It used to appear only once
            a place was confirmed, which was backwards the moment the map
            became a way of *adding* places: the rider with an empty form is
            exactly the one who wants to open the map and point at something,
            and he was the one it was hidden from. (Pick mode had already been
            excused from the rule for the same reason; this generalises it.)

            The map stays here while a row is active, rather than moving up
            into that row's slot as it used to. There is no idle map to go back
            to any more — one row is active for as long as the map is open — so
            a map that moved would remount MapLibre on every pin press. What
            the moving map was for, saying which field is being answered, the
            ringed row and the map's own hint line now do. */}
        {map && (
          <div className="md:hidden">
            {/* Opening the map asks "which row is unanswered?" again — the
                rider may have filled several in the form since he last looked
                at it, and the row that was active then is not the question he
                has now. Closing it changes nothing: the choice is harmless
                while nothing is listening to it. */}
            <button type="button" onClick={() => setMapOpen((v) => { if (!v) { track("form_map_opened"); setChosenRow(defaultActiveRow(places)); } return !v; })} aria-expanded={mapOpen}
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
