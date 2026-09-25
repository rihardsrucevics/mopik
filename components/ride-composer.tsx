"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Map as MapIcon, Sparkles } from "lucide-react";
import type { MapControls } from "@/components/route-map";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { planLine } from "@/lib/map/plan-line";
import { emptyUndo, popRedo, popUndo, pushUndo, type UndoStack } from "@/lib/map/undo-stack";
import { RoutePlaces, addStop, addedStopIndex, defaultActiveRow, followRow, rowAfterConfirm, rowLabel, MAX_ROWS } from "@/components/route-places";
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

/**
 * The picks re-keyed to a new row list, by name.
 *
 * Reordering or removing moves the rows; the coordinates must follow their
 * row, so each pick travels with the name it was made for. An emptied row
 * keeps none: matching is by name, and "" must never inherit the pick of some
 * other blank row. A function of its own because the edit needs the answer in
 * the same press that changes the rows, before the state has re-rendered.
 */
function rekeyPicked(
  places: string[],
  picked: Record<number, ResolvedPlace | null>,
  next: string[],
): Record<number, ResolvedPlace | null> {
  const byName = new Map<string, ResolvedPlace>();
  for (const [i, p] of Object.entries(picked)) {
    const name = places[Number(i)]?.trim().toLowerCase();
    if (p && name) byName.set(name, p);
  }
  return Object.fromEntries(next.map((name, i) => {
    const key = name.trim().toLowerCase();
    return [i, key ? byName.get(key) ?? null : null];
  }));
}

/**
 * The form as the editor of a ride that has already been generated.
 *
 * "Labot" on the result swaps the panel for these same rows — the rider asked
 * to correct a ride on the map rather than through the chat, and the rows,
 * the active-row rules and the map's header are exactly the tools planning
 * already gave him. What differs is only what a change *does*: here each
 * committed change re-routes the ride at once, so the page hears about every
 * one (`onCommit`) instead of waiting for Generate.
 */
export type RideEdit = {
  /**
   * The ride's places as rows, read when the editor opens and again whenever
   * `token` changes — after an undo, or when a change could not be routed and
   * the ride kept the places it had. Rows that disagreed with the ride on the
   * map would be the one thing an editor must never show.
   */
  seed: { names: string[]; picked: Record<number, ResolvedPlace>; roundTrip: boolean; token: number; active?: number };
  /** A change the rider committed: a Confirm, a pick from a list, ✕ on a stop, an arrow. */
  onCommit: (rows: { names: string[]; picked: Record<number, ResolvedPlace | null> }) => void;
  /** "Pabeigt labošanu": back to the result panel, keeping the edits. */
  onDone: () => void;
  /** "Atcelt labošanu": back to the result panel with every edit of this session dropped. */
  onCancel: () => void;
  /** The edited ride's numbers, Undo and the full search — the page's to draw. */
  status: ReactNode;
  /** A stretch is being re-routed; nothing new is committed until it lands. */
  rerouting: boolean;
  /** One step back in the edit history — the map header's ↶ and Ctrl/Cmd+Z. */
  canUndo: boolean;
  onUndo: () => void;
};

export function RideComposer({ initialPlan, initialPlaces, profile, onProfileChange, busy: busyProp, onGenerate, onUseChat, onPlacesChange, map, mapShown: mapOnPage = false, onPickModeChange, pickPoint, onMapControlsChange, edit }: {
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
    /** The marker is a new gesture (a dragged pin) and its spot needs naming. */
    lookup?: boolean;
    /** The ride's places, to frame together when `at` is far from the view. */
    fit?: { lat: number; lon: number }[];
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
  onMapControlsChange?: (controls: MapControls | null) => void;
  /** Present when the form is editing a generated ride; see `RideEdit`. */
  edit?: RideEdit;
}) {
  const [locale] = useLocale();
  // While a stretch is being re-routed the rows hold still: a second change
  // committed on top of one in flight would be routed against a line that is
  // about to be replaced.
  const busy = busyProp || Boolean(edit?.rerouting);
  const [places, setPlaces] = useState<string[]>(() => (edit ? edit.seed.names : placesFromPlan(initialPlan)));
  // One way is the default: it is the ride that needs both rows, so the form
  // reads "No … Līdz …" on open. A plan being edited keeps the shape it had —
  // `returnToStart` is explicit on every stored plan, so only a genuinely
  // absent plan falls through to the default.
  const [tripType, setTripType] = useState<"round_trip" | "one_way">(
    (edit ? edit.seed.roundTrip : initialPlan?.returnToStart === true) ? "round_trip" : "one_way",
  );
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
  // Open from the start when editing: the map is what the editor is for.
  const [mapOpen, setMapOpen] = useState(Boolean(edit));
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
   * **Null when every row is filled** (since 2026-09-25). The old invariant —
   * "while the map is open exactly one row is active" — kept a finished row
   * listening, and the rider's next mark, meant for the stop he had just
   * added, moved his finish instead. A filled row now answers the map only
   * when he activates it: its pin button, its field, or dragging its pin.
   * With none active a mark does nothing and the header says so.
   *
   * It is seeded with `defaultActiveRow` — the first empty row, start first —
   * and otherwise moves only because of something the rider did: a pin
   * button, a field, "+", a Confirm (`rowAfterConfirm`), or opening the map
   * again. Deriving it live from "the first empty row" was tried and moved
   * under him: typing the first letter of a name made that row non-empty, the
   * rule handed the map to the next one, and the field he was typing into
   * emptied itself one keystroke in. `activeRow` below only clamps it to a
   * row that still exists, for the case where the rider removes the row the
   * map was answering.
   *
   * Editing a finished ride opens with none: every row is filled, and which
   * place he came to correct is his to say.
   */
  const [chosenRow, setChosenRow] = useState<number | null>(() =>
    defaultActiveRow(edit ? edit.seed.names : placesFromPlan(initialPlan)));
  const mapShown = map ? mapOpen : mapOnPage;
  /**
   * Whether the map is on screen and answering the form at all — the header
   * is drawn whenever this is true, with a row active or not.
   */
  const mapLive = mapShown && Boolean(onPickModeChange);
  /**
   * The one row the map is answering: none when the map is closed, or when
   * the rider has confirmed his way through every row (`chosenRow` null).
   *
   * The clamp is for the one case the rider can cause and nothing else
   * handles: removing the row the map was answering. The index would then
   * point past the end, and the hint would name a row that is gone while the
   * next tap landed in whatever inherited the index.
   *
   * Also null when the page offers no pick flow at all (`onPickModeChange`
   * absent): the form reopened over a generated ride shows that ride on its
   * map, which answers no row. An active ring, a hint or a Confirm there would
   * promise a tap that goes nowhere.
   */
  const activeRow = !mapLive || chosenRow === null ? null : Math.min(chosenRow, Math.max(places.length - 1, 0));
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
   * Editing: a point of the drawn line grabbed to be moved (rider's sketch,
   * 2026-09-25). It has become a new, blank stop row (`row`, "new" like any
   * "+" row) whose mark is where the point goes; `at` is where on the line it
   * was taken, which the edit uses to put the stop into the ride there.
   */
  const [grab, setGrab] = useState<{ row: number; at: { lat: number; lon: number } } | null>(null);
  /**
   * Batch adding (rider, 2026-09-25): with an empty stop row active, every
   * mark on the map adds another pending stop instead of replacing the last,
   * and one „Apstiprināt visas” takes them all. Each is a row at once (its
   * name fills in as the reverse lookup answers), in click order from the
   * empty row on — before the finish on a one-way ride — and the map does not
   * move while the batch grows. Planning checks each with the routable-point
   * probe in the background; editing, the one re-route the batch makes is the
   * check, as it is for a single mark.
   */
  type BatchItem = {
    id: number; row: number; lat: number; lon: number;
    place: ResolvedPlace | null;
    check: "checking" | "ok" | "off-road";
    snappedTo?: { lat: number; lon: number } | null;
    distanceM?: number;
  };
  const [batch, setBatch] = useState<BatchItem[]>([]);
  /** The pending stop the rider pressed: the next mark or drag moves it. */
  const [batchSel, setBatchSel] = useState<number | null>(null);
  const batchIdRef = useRef(0);
  const batchRef = useRef(batch);
  useEffect(() => { batchRef.current = batch; }, [batch]);
  // The profile the probes and the plan use: a plan the chat has modified
  // carries its own, otherwise the rider's remembered one (see `changeProfile`).
  const [profileOverride, setProfileOverride] = useState<RideProfile | null>(null);
  const effectiveProfile = profileOverride ?? (initialPlan ? profileFromPlan(initialPlan) : profile);

  /** Planning's undo stack (edit mode's is the page's ride history). */
  type Snapshot = { names: string[]; picked: Record<number, ResolvedPlace | null> };
  const [undo, setUndo] = useState<UndoStack<Snapshot>>(emptyUndo);
  /** Asks the map to show every pin once, after a batch is confirmed. */
  const [fitAsk, setFitAsk] = useState(0);

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
    if (edit) return { ...edit.seed.picked };
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
    setPlaces(next);
    setPicked(rekeyPicked(places, picked, next));
  };

  /**
   * Tell the page the rows changed in a way the ride must follow.
   *
   * Only while editing, and only for the changes that are changes to the ride
   * — a place committed, a stop removed or moved. The rows are handed over as
   * this press leaves them, computed here rather than read back from state
   * that has not re-rendered yet.
   */
  const commitRows = (names: string[], nextPicked: Record<number, ResolvedPlace | null>) => {
    edit?.onCommit({ names, picked: nextPicked });
  };

  /**
   * Planning: record the rows as they are, before a committed change replaces
   * them — a Confirm, a batch, a field's pick, a row removed or moved. Edit
   * mode keeps its own history on the page, with the line.
   */
  const remember = (before: Snapshot = { names: places, picked }) => { if (!edit) setUndo((u) => pushUndo(u, before)); };
  /** Put a snapshot back: the rows, their places, and nothing pending. */
  const restore = (snap: Snapshot) => {
    setPlaces(snap.names);
    setPicked(snap.picked);
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setGrab(null);
    setBatch([]);
    setBatchSel(null);
    setRowIsNew(false);
    setChosenRow(defaultActiveRow(snap.names));
  };
  /** The map header's ↶ outside a batch, and Ctrl/Cmd+Z. */
  const undoStep = () => {
    if (edit) { if (edit.canUndo && !edit.rerouting) { track("route_edit_undone", { how: "header" }); edit.onUndo(); } return; }
    const back = popUndo(undo, { names: places, picked });
    if (!back) return;
    track("plan_undone", {});
    setUndo(back.stack);
    restore(back.value);
  };
  /** Shift+Ctrl/Cmd+Z, planning only: edit mode's history is one-way. */
  const redoStep = () => {
    if (edit) return;
    const forward = popRedo(undo, { names: places, picked });
    if (!forward) return;
    setUndo(forward.stack);
    restore(forward.value);
  };

  /**
   * The active row when it is a ghost: made by "+" (the map's or the form's)
   * or by a Confirm that opened the next stop row (`rowAfterConfirm`), never
   * confirmed, and still empty. The form must never keep one — the rider
   * asked for a place, not for a blank row to find the ✕ of.
   */
  const ghostRow = rowIsNew && activeRow !== null && !places[activeRow]?.trim() ? activeRow : null;
  /**
   * Let go of the ghost row, if there is one, before the map answers
   * `target` instead: it is removed silently, and the index `target` has
   * once it is gone comes back. Everything that hands the map to another row
   * goes through this — a pin button, a field, a dragged pin, a search pick.
   */
  const leaveGhost = (target: number | null): number | null => {
    if (ghostRow === null || ghostRow === target) return target;
    reorder(places.filter((_, i) => i !== ghostRow));
    setRowIsNew(false);
    setGrab(null);
    return target === null ? null : followRow(target, { kind: "remove", at: ghostRow });
  };
  /**
   * Open the pick flow for a row a handler has just made active, with the
   * marker and the view that handler knows. Flagged, because the effect that
   * notices "a row is active" (see `picking`) would otherwise run right after
   * and re-open it with nothing — throwing away the dragged pin's drop point
   * or the row's own place the handler had just put under the marker.
   */
  const pickOpenedRef = useRef(false);
  const openPick = (open: { at: { lat: number; lon: number } | null; marker: { lat: number; lon: number } | null; lookup?: boolean; fit?: { lat: number; lon: number }[] }) => {
    pickOpenedRef.current = true;
    onPickModeChange?.(true, open);
  };


  // No "last fix" is kept any more: it only ever said where to point the map
  // for an empty row, and an empty row no longer moves the map (2026-09-25).

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
   * What the rider is typing into the map's search field, for the row it was
   * typed for — kept apart from the row itself.
   *
   * The field used to *be* the row: every keystroke rewrote the row's text and
   * dropped its place, so a search started and abandoned had already cost the
   * row its coordinates, and a pick then committed with nothing to confirm.
   * The rider typed an address for „Caur (1)”, saw "✓ Nākotnes iela 2", and
   * could not tell whether the ride now went there. Now the field is a search:
   * the text is its own, and only a pick does anything — the same preview,
   * marker and Confirm a mark on the map gets.
   */
  const [mapQuery, setMapQuery] = useState<{ row: number; text: string } | null>(null);

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
  /** Set while the map's marks go to the batch (see `batchMode`). */
  const batchPointRef = useRef<((lat: number, lon: number) => void) | null>(null);
  /**
   * The gesture whose lookup has answered. While it trails `token`, a point
   * is under the marker and its name is still on the way — the map's bar is
   * already up (a mark is pending from the moment the marker lands) with
   * Confirm disabled, because the rider has marked something and must be able
   * to take it back without waiting seconds for a reverse lookup.
   */
  const [namedToken, setNamedToken] = useState<number | null>(null);
  useEffect(() => {
    const row = activeRowRef.current;
    // Token 0 is the seed the page puts under a row that already has a place:
    // its name is known and shown, and re-deriving one would only risk showing
    // the rider a different word for the spot he has not yet moved.
    if (!pickPoint || pickPoint.token === 0 || row === null) return;
    const { lat, lon, token: asked } = pickPoint;
    // Batch adding: the mark is another pending stop (or moves the selected
    // one), named in the background — not the single preview below.
    if (batchPointRef.current) {
      batchPointRef.current(lat, lon);
      setNamedToken(asked);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const found = await nameForPoint(lat, lon);
        if (cancelled) return;
        const taken = placesRef.current.filter((_, i) => i !== row);
        setPreview(pickedPlace(found, lat, lon, taken, t(locale, "pickedOnMap")));
      } finally {
        // Even when the lookup failed: the bar must not wait on it forever.
        if (!cancelled) setNamedToken(asked);
      }
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
    setGrab(null);
    setOffRoad(null);
    setMapQuery(null);
    if (edit) {
      // Editing, the rows must say what the ride is. Whatever was typed or
      // picked and not confirmed — a "+" row, a name in a field — goes, and
      // the rows are the ride's places again.
      setPlaces(edit.seed.names);
      setPicked({ ...edit.seed.picked });
      // A new row has gone with the rest; any other row stays active.
      setChosenRow((r) => (r === null || rowIsNew ? null : Math.min(r, edit.seed.names.length - 1)));
      openPick({ at: null, marker: null });
      return;
    }
    // Only while it is still blank: a name typed into it made it a row of
    // the ride, and Escape must not throw that away.
    if (rowIsNew && row !== null && !places[row]?.trim()) {
      // Through `reorder`, not `setPlaces`, so the other rows' coordinates are
      // re-keyed to their new indices — the row being dropped is blank and
      // carries none.
      reorder(places.filter((_, i) => i !== row));
      // The row the map was answering has gone, so the map goes back to the
      // question it would have asked had that row never existed.
      setChosenRow(defaultActiveRow(places.filter((_, i) => i !== row)));
    }
    // The pending marker goes with the pick it belonged to.
    openPick({ at: null, marker: null });
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
    // Only the row's own place moves the map (rider, 2026-09-25: activating a
    // filled row shows where it is; an empty row leaves the map alone).
    const at = own;
    const target = leaveGhost(index);
    // Only the row's own place seeds a marker. Another row's place, or the
    // rider's own position, says where to *look* — putting a draggable pin on
    // it would be Mopik answering a question it was not asked, and one tap on
    // Apstiprināt away from planting the finish on top of the start.
    setPreview(own);
    setMapQuery(null);
    setChosenRow(target);
    setRowIsNew(isNew);
    setMapOpen(true);
    setError(null);
    setOffRoad(null);
    openPick({ at, marker: own ? { lat: own.lat, lon: own.lon } : null });
  };

  /**
   * Tapping into a row's field while the map is open points the map at that
   * row, as its pin button does — the rider tapped into „Līdz” and expected
   * the next mark to go there. Lighter than the button: the map is not flown
   * anywhere (he is about to type) and no marker is seeded, so nothing waits
   * for a Confirm he did not ask for. A mark pending on another row is let go.
   */
  const focusRow = (index: number, opts: { refocus?: boolean } = {}) => {
    if (!mapLive || index === activeRow) return;
    let target: number | null = index;
    if (edit && (preview || offRoad)) {
      // Editing, Cancel puts the rows back to the ride's — a "+" row above
      // this one goes with it.
      cancelPicking();
      if (rowIsNew && activeRow !== null && activeRow < index) target = index - 1;
    } else {
      target = leaveGhost(index);
    }
    setPreview(null);
    setMapQuery(null);
    setRowIsNew(false);
    setOffRoad(null);
    setChosenRow(target);
    // The row's own place, if it has one, is shown — the map eases to it only
    // when it is not already in view (see the map's `pickCenter`). No marker:
    // he is about to type, not to drag.
    const own = picked[index] ?? null;
    openPick({ at: own ? { lat: own.lat, lon: own.lon } : null, marker: null });
    // A ghost above this row has gone, so the field under the rider's finger
    // now holds the row below it: keep the focus on the row he tapped.
    if (opts.refocus !== false && target !== index) requestAnimationFrame(() => (document.querySelector(`[data-place-row="${target}"] input`) as HTMLInputElement | null)?.focus());
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
    // An unused new stop row is already waiting (a Confirm opened it, or "+"
    // was pressed twice): that row is the answer, not a second blank one.
    if (ghostRow !== null) {
      setPreview(null);
      setMapQuery(null);
      openPick({ at: null, marker: null });
      return;
    }
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
    setMapQuery(null);
    setChosenRow(row);
    setRowIsNew(true);
    setMapOpen(true);
    setError(null);
    setOffRoad(null);
    openPick({ at: null, marker: null });
  };

  /**
   * A place found by name, shown the way a mark on the map is: under the
   * pending marker, previewed in its row, waiting for Confirm.
   *
   * A search pick used to commit at once — "there is nothing to Confirm, the
   * rider chose a named place from a list". In edit mode that meant the ride
   * re-routed with nothing on the map saying so, and a place picked from a
   * list is exactly as likely to be the wrong "Nākotnes iela 2" as a tap is to
   * be the wrong yard. One way to commit, whichever way the place was found.
   * The marker can be dragged to correct it, like any other mark.
   */
  const previewPlace = (row: number, place: ResolvedPlace) => {
    if (busy) return;
    setMapQuery(null);
    // Another row's list: a ghost row the map was answering goes first. The
    // active row's own "new" flag stays — a place previewed in it is still
    // not confirmed, and Cancel must still be able to take the row away.
    const target = row === activeRow ? row : leaveGhost(row);
    if (row !== activeRow) setRowIsNew(false);
    setChosenRow(target);
    setOffRoad(null);
    setError(null);
    setMapOpen(true);
    setPreview(place);
    // Token 0: the name is the list's own, so no reverse lookup re-derives it.
    openPick({ at: { lat: place.lat, lon: place.lon }, marker: { lat: place.lat, lon: place.lon } });
  };

  /**
   * Put the previewed place in its row. The commit itself.
   *
   * **Confirming ends the editing of that pin** (rider, 2026-09-25). What the
   * map answers next is `rowAfterConfirm`'s: after the start, the finish if
   * it is empty; after a stop, a new empty stop row right after it — so stop
   * after stop is mark, Confirm, mark, Confirm — and after the finish, or
   * once every row is filled, no row at all. The 2026-09-24 rule ("stay on
   * this row when all are filled") kept a finished pin listening, and the
   * mark meant for a stop he had just added moved his finish. A pin is
   * edited again only when he activates it.
   *
   * The preview is cleared because it has become the row's real answer. The
   * row a stop's Confirm opens is "new" (`rowIsNew`): Cancel takes it away,
   * and it is dropped silently if he goes elsewhere without using it.
   */
  const commitPick = (row: number, place: ResolvedPlace) => {
    // Chosen explicitly, from the rows as this press leaves them — the state
    // has not re-rendered yet, and deriving "first empty" live is what once
    // moved the active row under the rider's thumb while he typed.
    const filled = places.map((p, i) => (i === row ? place.name : p));
    // A grabbed line point carries where it was grabbed, and — being a move
    // of the line rather than the next stop of a list — opens no new row.
    const grabbed = grab && grab.row === row ? grab : null;
    const committed: ResolvedPlace = grabbed ? { ...place, grabbedAt: [grabbed.at.lon, grabbed.at.lat] } as ResolvedPlace : place;
    const nextPicked = { ...picked, [row]: committed };
    const after = grabbed ? { rows: filled, active: null, inserted: null } : rowAfterConfirm(filled, row, tripType === "one_way");
    setGrab(null);
    remember();
    setPlaces(after.rows);
    setPicked(nextPicked);
    commitRows(filled, nextPicked);
    setMapQuery(null);
    // The same shelf a dropdown pick goes on, for the same reason the
    // crosshair's place goes there: a spot found once should be offered by
    // name the next time, from the sofa, with no map open.
    rememberPlace(place);
    track("place_picked_on_map", { row, start: row === 0 });
    setOffRoad(null);
    setPreview(null);
    setRowIsNew(false);
    setChosenRow(after.active);
    // The pending "being decided" marker goes, and the row's own role pin —
    // green start, red finish, numbered stop — appears under it. With a next
    // row the pick flow stays open with nothing to drag (`at: null` keeps the
    // map where the rider is looking); with none, the `picking` effect closes
    // it and a mark does nothing until he activates a row.
    if (after.active !== null) openPick({ at: null, marker: null });
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
    // Editing a generated ride, the re-route IS the check: it routes to the
    // point with the same endpoint rescue the probe uses and says how far it
    // had to move it, so probing first would only put a second round trip in
    // front of the line the rider is waiting for.
    if (edit) { commitPick(row, place); return; }
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

  /**
   * A ride pin dragged on the edit map: that pin's row becomes the active one
   * and the spot it was dropped on becomes its mark — named, previewed and
   * waiting for Confirm, exactly as a tap with that row active would be. A
   * drag is a quicker way to say "this place, over there", not a commit of
   * its own: a pin let go a few metres off is corrected by dragging again,
   * and Cancel or Escape takes it back.
   *
   * The map knows a pin by its role and its number; the row is worked out
   * here, where the rows are. A stop's number counts the filled stop rows in
   * order, which is how `placeRoles` numbered them for the map.
   */
  /**
   * A point of the drawn line grabbed on the map (edit mode). The rows go back
   * to the ride's — whatever was pending is let go, and the active row with
   * it: the line click wins — and a blank stop row is put in where the point
   * lies along the line (`slot` stops before it), active and "new", so Cancel
   * or Escape takes it away again. The next mark is where the point goes.
   */
  const grabLine = ({ lat, lon, slot }: { lat: number; lon: number; slot: number }) => {
    if (!edit || busy || edit.rerouting) return;
    const names = edit.seed.names;
    const oneWay = tripType === "one_way";
    const last = names.length - 1;
    if (names.length >= MAX_ROWS) return;
    // The row of the slot-th stop, or — past the last stop — before the
    // finish (one way) or at the end (round trip).
    let seen = 0;
    let at = oneWay ? last : names.length;
    for (let i = 1; i <= (oneWay ? last - 1 : last); i++) {
      if (!edit.seed.picked[i]) continue;
      if (seen === slot) { at = i; break; }
      seen++;
    }
    track("route_line_grabbed", { slot });
    setPlaces([...names.slice(0, at), "", ...names.slice(at)]);
    setPicked(Object.fromEntries(Object.entries(edit.seed.picked).map(([k, v]) => [Number(k) >= at ? Number(k) + 1 : Number(k), v])));
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setChosenRow(at);
    setRowIsNew(true);
    setGrab({ row: at, at: { lat, lon } });
    openPick({ at: null, marker: null });
  };
  /** Whether a row is a stop — neither the start nor a one-way ride's finish. */
  const isStopRow = (i: number) => i > 0 && !(tripType === "one_way" && i === places.length - 1);
  /**
   * The routable-point probe for one place in one row, on the ride's profile
   * — the check `confirmPick` makes, for a pending stop of a batch. Resolves
   * to the verdict or null when the check could not be made (a pin we could
   * not check is let through, as at Confirm).
   */
  const probeRow = async (row: number, place: ResolvedPlace): Promise<{ ok: boolean; snappedTo?: { lat: number; lon: number } | null; distanceM?: number } | null> => {
    try {
      const plan = composeRidePlan({
        places: places.map((p, i) => (i === row ? place.name : p === "…" ? "" : p)),
        tripType, durationMode,
        hours: hours.trim() ? Number(hours.replace(",", ".")) : preset ?? 4,
        profile: effectiveProfile,
      });
      const probePlan: RidePlan = plan.returnToStart || plan.destinationPlace?.trim() ? plan : { ...plan, destinationAny: true };
      const other = confirmed.find((p) => p.lat !== place.lat || p.lon !== place.lon);
      const response = await fetch("/api/routable-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: place.lat, lon: place.lon, plan: probePlan, ...(other ? { from: { lat: other.lat, lon: other.lon } } : {}) }),
      });
      if (!response.ok) return null;
      const data = (await response.json()) as { ok: boolean; snappedTo?: { lat: number; lon: number }; distanceM?: number; reason?: string; canMove?: boolean };
      if (data.ok || data.reason !== "too-far-from-road") return { ok: true };
      return { ok: false, snappedTo: data.canMove && data.snappedTo ? data.snappedTo : null, distanceM: Math.round(data.distanceM ?? 0) };
    } catch {
      return null;
    }
  };
  /** Name a pending stop, then (planning) check it — both in the background. */
  const settleBatchItem = (id: number, lat: number, lon: number) => {
    void (async () => {
      const found = await nameForPoint(lat, lon);
      const item = batchRef.current.find((b) => b.id === id);
      if (!item || item.lat !== lat || item.lon !== lon) return; // moved or dropped since
      const taken = placesRef.current.filter((_, i) => i !== item.row);
      const place = pickedPlace(found, lat, lon, taken, t(locale, "pickedOnMap"));
      setBatch((items) => items.map((b) => (b.id === id ? { ...b, place } : b)));
      setPlaces((rows) => rows.map((p, i) => (i === item.row ? place.name : p)));
      if (edit) { setBatch((items) => items.map((b) => (b.id === id ? { ...b, check: "ok" } : b))); return; }
      const verdict = await probeRow(item.row, place);
      const still = batchRef.current.find((b) => b.id === id);
      if (!still || still.lat !== lat || still.lon !== lon) return;
      setBatch((items) => items.map((b) => (b.id === id
        ? { ...b, check: !verdict || verdict.ok ? "ok" : "off-road", snappedTo: verdict?.snappedTo ?? null, distanceM: verdict?.distanceM }
        : b)));
    })();
  };
  /** Rows after `at` move down one, and their places with them. */
  const shiftPicked = (from: Record<number, ResolvedPlace | null>, at: number, by: 1 | -1) =>
    Object.fromEntries(Object.entries(from).flatMap(([k, v]) => {
      const i = Number(k);
      if (by === -1 && i === at) return [];
      return [[i >= at + (by === -1 ? 1 : 0) ? i + by : i, v]];
    })) as Record<number, ResolvedPlace | null>;
  /**
   * A mark on the map while an empty stop row is active or a batch is open:
   * the selected pending stop moves there, or another pending stop is added
   * after the last — never a camera move (the map's `batchMode`).
   */
  const addToBatch = (lat: number, lon: number) => {
    if (batchSel !== null) { moveBatchItem(batchSel, lat, lon); setBatchSel(null); return; }
    const id = ++batchIdRef.current;
    if (batch.length === 0) {
      if (activeRow === null) return;
      const row = activeRow;
      batchRef.current = [{ id, row, lat, lon, place: null, check: "checking" }];
      setBatch(batchRef.current);
      setPlaces((rows) => rows.map((p, i) => (i === row ? "…" : p)));
      track("batch_stop_marked", { n: 1 });
      settleBatchItem(id, lat, lon);
      return;
    }
    if (places.length >= MAX_ROWS) return;
    const at = batch[batch.length - 1].row + 1;
    setPlaces([...places.slice(0, at), "…", ...places.slice(at)]);
    setPicked(shiftPicked(picked, at, 1));
    batchRef.current = [...batch, { id, row: at, lat, lon, place: null, check: "checking" }];
    setBatch(batchRef.current);
    setChosenRow(at);
    track("batch_stop_marked", { n: batch.length + 1 });
    settleBatchItem(id, lat, lon);
  };
  const moveBatchItem = (id: number, lat: number, lon: number) => {
    const item = batch.find((b) => b.id === id);
    if (!item) return;
    batchRef.current = batch.map((b) => (b.id === id ? { ...b, lat, lon, place: null, check: "checking" as const, snappedTo: null } : b));
    setBatch(batchRef.current);
    setPlaces((rows) => rows.map((p, i) => (i === item.row ? "…" : p)));
    settleBatchItem(id, lat, lon);
  };
  /** One pending stop out of the batch — its ✕, or ↶ for the last one. */
  const dropBatchItem = (id: number) => {
    const item = batch.find((b) => b.id === id);
    if (!item) return;
    setBatchSel(null);
    if (batch.length === 1) {
      // The empty row the batch started in stays, empty and active.
      batchRef.current = [];
      setBatch([]);
      setPlaces((rows) => rows.map((p, i) => (i === item.row ? "" : p)));
      return;
    }
    setPlaces(places.filter((_, i) => i !== item.row));
    setPicked(shiftPicked(picked, item.row, -1));
    batchRef.current = batch.filter((b) => b.id !== id).map((b) => (b.row > item.row ? { ...b, row: b.row - 1 } : b));
    setBatch(batchRef.current);
    setChosenRow(batchRef.current[batchRef.current.length - 1].row);
  };
  /** ✕ on the header while a batch is open: every pending stop goes. */
  const discardBatch = () => {
    track("batch_discarded", { n: batch.length });
    const rows = batch.map((b) => b.row);
    const first = rows[0];
    batchRef.current = [];
    setBatch([]);
    setBatchSel(null);
    if (edit) { cancelPicking(); return; }
    const kept = places.filter((_, i) => !rows.includes(i) || i === first).map((p, i) => (i === first ? "" : p));
    let nextPicked = picked;
    for (const r of [...rows].reverse()) if (r !== first) nextPicked = shiftPicked(nextPicked, r, -1);
    if (rowIsNew) {
      // A "+" row the batch started in goes with it, as Cancel takes it.
      setPlaces(kept.filter((_, i) => i !== first));
      setPicked(shiftPicked(nextPicked, first, -1));
      setRowIsNew(false);
      setChosenRow(defaultActiveRow(kept.filter((_, i) => i !== first)));
    } else {
      setPlaces(kept);
      setPicked(nextPicked);
    }
  };
  /** „Apstiprināt visas”: every pending stop becomes its row's place at once. */
  const confirmBatch = () => {
    if (!batch.length || batch.some((b) => !b.place || b.check !== "ok")) return;
    const names = places.map((p, i) => batch.find((b) => b.row === i)?.place?.name ?? p);
    const nextPicked = { ...picked };
    for (const b of batch) nextPicked[b.row] = b.place;
    // The step back is to before the batch: its rows gone again, the empty
    // row it started in empty again — one undo takes the whole batch.
    const rowsOf = batch.map((b) => b.row);
    let beforePicked = picked;
    for (const r of [...rowsOf].reverse()) if (r !== rowsOf[0]) beforePicked = shiftPicked(beforePicked, r, -1);
    remember({
      names: places.filter((_, i) => !rowsOf.includes(i) || i === rowsOf[0]).map((p, i) => (i === rowsOf[0] ? "" : p)),
      picked: beforePicked,
    });
    setPlaces(names);
    setPicked(nextPicked);
    for (const b of batch) rememberPlace(b.place!);
    track("batch_confirmed", { n: batch.length });
    batchRef.current = [];
    setBatch([]);
    setBatchSel(null);
    setRowIsNew(false);
    setChosenRow(defaultActiveRow(names));
    // Editing, the whole batch is one change: one request re-routes every
    // stretch it touches (`add-stops`). Planning, the map shows every pin once.
    commitRows(names, nextPicked);
    if (!edit) setFitAsk((n) => n + 1);
  };
  /** The row a map pin belongs to — see `dragPin` for how stops are counted. */
  const rowOfPin = (role: "start" | "via" | "finish", index: number): number => {
    const oneWay = tripType === "one_way";
    const last = places.length - 1;
    if (role === "start") return 0;
    if (role === "finish") return oneWay ? last : -1;
    let seen = -1;
    for (let i = 1; i <= (oneWay ? last - 1 : last); i++) {
      if (picked[i]) seen++;
      if (seen === index) return i;
    }
    return -1;
  };
  /**
   * A ride pin pressed on the map: its row becomes the active one, exactly as
   * if its field had been focused (`focusRow`) — the ring, the header, the
   * raised pin. A mark pending on another row is let go first, as focusing
   * another field lets it go: the press is the rider changing his mind about
   * which place he is correcting. The pin itself does not move; a mark or a
   * drag does that next.
   */
  const pressPin = (role: "start" | "via" | "finish", index: number) => {
    if (busy) return;
    const row = rowOfPin(role, index);
    if (row < 0) return;
    track("map_pin_pressed", { role });
    focusRow(row, { refocus: false });
  };
  const dragPin = (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => {
    if (busy) return;
    const row = rowOfPin(role, index);
    if (row < 0) return;
    track("route_edit_pin_dragged", { role });
    const target = leaveGhost(row);
    setPreview(null);
    setMapQuery(null);
    setChosenRow(target);
    setRowIsNew(false);
    setOffRoad(null);
    setError(null);
    // A fresh gesture, so the lookup names the spot — unlike the seed a pin
    // press leaves, whose name the row already knows.
    openPick({ at: null, marker: at, lookup: true });
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
   * The rows again from the ride, when the page says the ride has changed
   * under them: an undo, or an edit the router refused, which leaves the ride
   * with the places it had. The row the map answers stays where the rider
   * left it, clamped to the rows that exist.
   */
  // Adjusted during render rather than in an effect — React's own pattern for
  // state that resets when a prop changes: an effect would paint one frame of
  // the old rows over the new ride first.
  const [seenSeed, setSeenSeed] = useState(edit?.seed.token);
  if (edit && edit.seed.token !== seenSeed) {
    setSeenSeed(edit.seed.token);
    setPreview(null);
    setOffRoad(null);
    setGrab(null);
    const names = edit.seed.names;
    setPlaces(names);
    setPicked({ ...edit.seed.picked });
    setRowIsNew(false);
    setBatch([]);
    setBatchSel(null);
    // No row stays none; a row the rows moved under follows its place.
    setChosenRow((row) => (row === null ? null : Math.min(edit.seed.active ?? row, names.length - 1)));
  }

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
    // A handler that made the row active has already opened the flow with the
    // marker it knows (`openPick`); opening it again here would drop that.
    if (pickOpenedRef.current) return;
    // No `at`, no `marker`: the map stays where the rider left it and the
    // pending marker is only ever placed by something he did.
    onPickModeChange?.(true, { at: null, marker: null });
    // The parent's callback is an inline arrow, rebuilt every render; listing
    // it would re-open pick mode on every keystroke in the form and throw away
    // the marker under the rider's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking]);
  // The flag is for the one commit its handler caused; every commit clears it
  // after the effect above has read it.
  useEffect(() => { pickOpenedRef.current = false; });

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
  /** The active row's own confirmed place — its pin is the one the map raises. */
  const activeOwn = activeRow === null ? null : picked[activeRow] ?? null;
  /**
   * The dashed line joining the pins in riding order, planning only — a
   * generated ride draws the real line, and edit mode has it (`planLine`).
   */
  const planRows = places.map((_, i) => (picked[i] ? [picked[i]!.lon, picked[i]!.lat] as [number, number] : null));
  const basePath = edit ? null : planLine({
    rows: planRows,
    roundTrip: tripType === "round_trip",
    pending: activeRow !== null && preview && !batch.length ? { row: activeRow, point: [preview.lon, preview.lat] } : null,
  });
  // A batch's pending stops slot in as one lighter chain: from the place
  // before the first to the place after the last, through each in turn.
  const planPath = !basePath || !batch.length ? basePath : (() => {
    const first = batch[0].row, last = batch[batch.length - 1].row;
    const prev = [...planRows.slice(0, first)].reverse().find(Boolean) ?? null;
    let next = planRows.slice(last + 1).find(Boolean) ?? null;
    if (!next && tripType === "round_trip") next = planRows[0];
    const chain = [...(prev ? [prev] : []), ...batch.map((b) => [b.lon, b.lat] as [number, number]), ...(next ? [next] : [])];
    return { ...basePath, pending: chain.length >= 2 ? chain : null };
  })();
  const planKey = planPath ? JSON.stringify(planPath) : "";
  /**
   * The pending mark's handlers, always the latest render's.
   *
   * The map holds on to the controls object until the effect below re-runs,
   * and `confirmPick` reads half the form — the rows, the trip type, the
   * duration, the profile — to build the plan it probes with. Handing the map
   * the handlers themselves would freeze whichever of those it saw last time
   * the effect ran; this is the stale-closure bug "+ Pietura" already had once
   * (see `rowsKey`). So the map is given stable wrappers that call through;
   * the ref is synced further down, after `effectiveProfile` exists, because
   * `confirmPick` reads it.
   */
  const pendingHandlers = useRef<{
    confirm: () => void; cancel: () => void; move: () => void; dismiss: () => void;
    pinDrag: (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => void;
    type: (value: string) => void;
    pickFound: (place: ResolvedPlace) => void;
    addStop: () => void;
    pinPress: (role: "start" | "via" | "finish", index: number) => void;
    lineGrab: (grab: { lat: number; lon: number; slot: number }) => void;
    confirmBatch: () => void; discardBatch: () => void; undoBatch: () => void;
    selectBatch: (id: number) => void; moveBatch: (id: number, at: { lat: number; lon: number }) => void; dropBatch: (id: number) => void;
    moveSelectedToRoad: () => void; dropSelected: () => void;
    undo: () => void;
  } | null>(null);
  /**
   * What the map's header shows in place of "+" — Confirm and Cancel — or
   * null when no mark is pending.
   *
   * **Pending = a point is under the pending marker and not yet committed**, or
   * the router has just said that point is off the road. A confirmed row stays
   * active so the next tap moves its place, but until that tap there is
   * nothing to confirm or cancel, and a pair of buttons that do nothing is
   * exactly what the rider said not to ship. The next tap brings them back.
   *
   * It starts the moment the marker lands, before the reverse lookup has
   * named the point (`naming`): Cancel is live at once, Confirm follows the
   * name.
   *
   * A row "+ Pietura" has just made, with no tap yet, is not pending either:
   * Escape still takes it away again, and the first tap brings the bar with
   * its Cancel.
   */
  const naming = activeRow !== null && token !== null && token !== 0 && namedToken !== token;
  /**
   * Batch adding is on while an empty stop row is active (and no single mark,
   * search pick or grabbed line point is pending), or once a batch has
   * started. Then a mark adds a pending stop (`addToBatch`) and the map keeps
   * its camera still.
   */
  const batchActive = batch.length > 0;
  const batchReady = !batchActive && !grab && !preview && !offRoad && activeRow !== null && isStopRow(activeRow) && !places[activeRow]?.trim();
  const batchMode = batchActive || batchReady;
  // Synced after each commit; the mark that the next render brings reads it.
  useEffect(() => { batchPointRef.current = batchMode ? addToBatch : null; });
  const selectedItem = batchSel === null ? null : batch.find((b) => b.id === batchSel) ?? null;
  const batchKey = batch.map((b) => `${b.id}:${b.row}:${b.lat},${b.lon}:${b.place?.name ?? ""}:${b.check}`).join("|") + `|${batchSel ?? ""}|${batchReady ? 1 : 0}`;
  const pendingKey = activeRow === null || !(preview || offRoad || naming)
    ? ""
    : [preview?.lat, preview?.lon, checking, naming, offRoad?.distanceM ?? "", offRoad?.snappedTo ? 1 : 0, edit?.rerouting ? 1 : 0].join("|");
  useEffect(() => {
    if (!mapLive) { onMapControlsChange?.(null); return; }
    // The batch's own pending state: Confirm all, ↶ the last, ✕ all — and,
    // for a selected pending stop the probe found off the road, the verdict.
    const stopsBefore = batchActive ? places.slice(1, batch[0].row).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length : 0;
    const batchPending = !batchActive ? null : {
      confirmLabel: t(locale, "batchConfirmAll"),
      onConfirm: batch.some((b) => !b.place || b.check !== "ok") || edit?.rerouting ? null : () => pendingHandlers.current?.confirmBatch(),
      cancelLabel: t(locale, "batchDiscard"),
      onCancel: () => pendingHandlers.current?.discardBatch(),
      undo: { label: t(locale, "batchUndoLast"), onUndo: () => pendingHandlers.current?.undoBatch() },
      offRoad: selectedItem && selectedItem.check === "off-road" ? {
        title: fi(t(locale, "pickOffRoadTitle"), { m: selectedItem.distanceM ?? 0 }),
        moveLabel: t(locale, "pickOffRoadMove"),
        onMove: selectedItem.snappedTo ? () => pendingHandlers.current?.moveSelectedToRoad() : null,
        dismissLabel: t(locale, "batchDropOne"),
        onDismiss: () => pendingHandlers.current?.dropSelected(),
      } : null,
    };
    const batchCount = batch.length === 1 ? t(locale, "batchCountOne") : fi(t(locale, "batchCountMany"), { n: batch.length });
    const pending = batchPending ?? (!pendingKey ? null : {
      confirmLabel: checking ? t(locale, "pickOnMapChecking") : t(locale, "pickOnMapConfirm"),
      // Null while the probe is in flight: the button is then disabled and
      // says so, because a press that takes a second and shows nothing reads
      // as a button that does not work.
      // …and while the tapped point is still being named: there is nothing
      // yet for Confirm to commit.
      onConfirm: checking || naming || !preview || edit?.rerouting ? null : () => pendingHandlers.current?.confirm(),
      cancelLabel: t(locale, "pickOnMapCancel"),
      onCancel: () => pendingHandlers.current?.cancel(),
      offRoad: !offRoad ? null : {
        title: fi(t(locale, "pickOffRoadTitle"), { m: offRoad.distanceM }),
        moveLabel: t(locale, "pickOffRoadMove"),
        // Move is offered only when the server said the road is near enough
        // to still be the same place (`canMove`, which is what `snappedTo`
        // being non-null means). A chip that cannot act must not be drawn.
        onMove: offRoad.snappedTo ? () => pendingHandlers.current?.move() : null,
        dismissLabel: t(locale, "pickOffRoadCancel"),
        onDismiss: () => pendingHandlers.current?.dismiss(),
      },
    });
    onMapControlsChange?.({
      pending,
      // With no row active the header says what to do instead — pick a row or
      // add a stop — and the field is off: a name found there would have no
      // row to go to.
      hint: batchActive ? batchCount : grab ? t(locale, "mapGrabHint") : activeRow === null ? t(locale, "mapNoActiveRow") : fi(t(locale, "mapActiveRowHint"), { label: activeLabel }),
      rowLabel: activeRow === null || batchActive ? undefined : activeLabel,
      // The pin the active row's mark will become, and a stop's number: one
      // more than the filled, numbered stops above it — the order the map
      // numbers stops in (sights carry a glyph, not a number).
      pendingPin: activeRow === null || batchActive ? undefined : activeRow === 0
        ? { role: "start" as const, number: null }
        : tripType === "one_way" && activeRow === places.length - 1
          ? { role: "finish" as const, number: null }
          : { role: "via" as const, number: 1 + places.slice(1, activeRow).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length },
      // Null at the cap rather than a handler that returns: the button is then
      // disabled and says why, and a control that does nothing is never shipped.
      // Through the ref like the other handlers: whether a blank new row is
      // already waiting (`ghostRow`) can change without the rows changing.
      onAddStop: atCap ? null : () => pendingHandlers.current?.addStop(),
      addStopLabel: t(locale, "mapAddStop"),
      addStopFullLabel: t(locale, "mapAddStopFull"),
      search: {
        value: batchActive ? "" : mapQuery && mapQuery.row === activeRow ? mapQuery.text : activeValue,
        confirmed: batchActive ? null : activeConfirmed,
        // Typing searches; it does not touch the row. See `mapQuery`. A mark
        // or a preview already under the marker goes: the rider has stopped
        // answering with the map and started answering with words.
        onChange: (value: string) => pendingHandlers.current?.type(value),
        // A pick is a mark by name: marker, preview, Confirm — `previewPlace`.
        onPick: (place: ResolvedPlace | null) => { if (place) pendingHandlers.current?.pickFound(place); },
        near: anchor,
        // The hint line's words live here now (backlog 30): the field's tag
        // names the row, and the placeholder says a mark on the map fills it
        // as well as a name typed here.
        // A batch has no field to type into — its count is the field's words
        // (and the cap, once it is reached).
        placeholder: batchActive ? (atCap ? t(locale, "mapAddStopFull") : batchCount) : grab ? t(locale, "mapGrabHint") : activeRow === null ? t(locale, "mapNoActiveRow") : t(locale, "mapSearchHint"),
        disabled: activeRow === null || batchActive,
      },
      // The ride's own pins answer the form in planning as in edit mode
      // (rider, 2026-09-25): a press makes that pin's row active, a drag makes
      // the drop point its mark.
      onPinDrag: (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => pendingHandlers.current?.pinDrag(role, index, at),
      onPinPress: (role: "start" | "via" | "finish", index: number) => pendingHandlers.current?.pinPress(role, index),
      activePlace: activeOwn ? { lat: activeOwn.lat, lon: activeOwn.lon } : null,
      planLine: planPath,
      // Batch adding: the pending stops, drawn by the map as dashed numbered
      // pins it can select and drag; the camera stays still while it is on.
      batchMode,
      batch: batch.map((b, k) => ({ id: b.id, lat: b.lat, lon: b.lon, number: stopsBefore + k + 1, selected: b.id === batchSel, failing: b.check === "off-road" })),
      onBatchSelect: (id: number) => pendingHandlers.current?.selectBatch(id),
      onBatchMove: (id: number, at: { lat: number; lon: number }) => pendingHandlers.current?.moveBatch(id, at),
      onBatchDrop: (id: number) => pendingHandlers.current?.dropBatch(id),
      fitToken: fitAsk,
      // ↶ outside a batch: planning's own stack, or the edit history.
      undo: { label: t(locale, "mapUndo"), onUndo: (edit ? edit.canUndo : undo.past.length > 0) ? () => pendingHandlers.current?.undo() : null },
      // Edit mode: the drawn line can be grabbed and moved.
      // Not while a batch is open: its marks may land on the line too, and
      // they are stops of the batch, not points of the line to move.
      ...(edit ? { onLineGrab: batchActive ? undefined : (g: { lat: number; lon: number; slot: number }) => pendingHandlers.current?.lineGrab(g), grab: grab?.at ?? null } : {}),
    });
    // The parent's callback is an inline arrow and is rebuilt every render;
    // listing it would re-report the same controls on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLive, activeRow, activeLabel, atCap, activeValue, activeConfirmed, anchor, locale, tripType, rowsKey, pendingKey, mapQuery, activeOwn?.lat, activeOwn?.lon, planKey, grab?.at.lat, grab?.at.lon, batchKey, fitAsk, undo.past.length, edit?.canUndo]);
  // Nothing is offered once the form is gone. Without this the page would keep
  // drawing a map header for a form the rider has left.
  useEffect(() => () => onMapControlsChange?.(null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []);
  // And no row is waiting once the form is gone. Generating unmounts the form,
  // and without this the page's "a row is waiting" flag stayed up under the
  // result — every tap on the finished ride then dropped the pick marker (violet, then),
  // with no row, hint or Confirm for it to answer to. The page also gates the
  // pick flow on the view (`lib/map/map-wiring.ts`); this keeps the flag
  // itself honest for anything else that reads it.
  useEffect(() => () => onPickModeChange?.(false),
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
  //
  // The listener now calls through a ref rebuilt every render, so it can
  // never run an older closure again — and it carries two more keys:
  // - Escape in a batch deselects a pending stop first, then drops the batch.
  // - Ctrl/Cmd+Z undoes the last committed change (Shift: redo, planning
  //   only), but never while the focus is in a field, where typing keeps the
  //   browser's own undo (rider, 2026-09-25).
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = Boolean(target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable));
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !typing && mapLive) {
      e.preventDefault();
      if (e.shiftKey) redoStep(); else undoStep();
      return;
    }
    if (e.key !== "Escape") return;
    if (batchSel !== null) { setBatchSel(null); return; }
    if (batch.length) { discardBatch(); return; }
    if (activeRow !== null) cancelPicking();
  };
  useEffect(() => { keyRef.current = onKeyDown; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  // (`profileOverride` and `effectiveProfile` are declared further up, before
  // the batch's probe that reads them.)
  const changeProfile = (next: RideProfile) => {
    setProfileOverride(next);
    onProfileChange(next);
  };
  // The map's pending-bar handlers, current as of this render (see
  // `pendingHandlers`). After `effectiveProfile`, which `confirmPick` reads.
  useEffect(() => {
    pendingHandlers.current = {
      confirm: confirmPick, cancel: cancelPicking, move: acceptOffRoadMove, dismiss: () => setOffRoad(null), pinDrag: dragPin, addStop: addStopFromMap, pinPress: pressPin, lineGrab: grabLine,
      confirmBatch, discardBatch,
      undoBatch: () => { const last = batch[batch.length - 1]; if (last) dropBatchItem(last.id); },
      selectBatch: (id: number) => setBatchSel((sel) => (sel === id ? null : id)),
      moveBatch: (id: number, at: { lat: number; lon: number }) => { moveBatchItem(id, at.lat, at.lon); setBatchSel(null); },
      dropBatch: dropBatchItem,
      moveSelectedToRoad: () => { if (selectedItem?.snappedTo) { moveBatchItem(selectedItem.id, selectedItem.snappedTo.lat, selectedItem.snappedTo.lon); setBatchSel(null); } },
      dropSelected: () => { if (selectedItem) dropBatchItem(selectedItem.id); },
      undo: undoStep,
      type: (value: string) => {
        if (activeRow === null) return;
        setMapQuery({ row: activeRow, text: value });
        if (preview || pickPoint) { setPreview(null); onPickModeChange?.(true, { at: null, marker: null }); }
      },
      pickFound: (place: ResolvedPlace) => {
        if (activeRow === null) return;
        track("place_picked", { row: activeRow, start: activeRow === 0 });
        previewPlace(activeRow, place);
      },
    };
  });

  const submit = () => {
    // A blank new stop row the rider never used is not part of the ride: it
    // is dropped here rather than trusted to be skipped downstream.
    // Pending stops of a batch never confirmed are not part of it either.
    const pendingRows = new Set(batch.map((b) => b.row));
    const rows = ghostRow === null && !pendingRows.size ? places : places.filter((_, i) => i !== ghostRow && !pendingRows.has(i));
    const filled = rows.map((p) => p.trim()).filter(Boolean);
    // Name the field that is missing. "Norādi vismaz vienu vietu" was shown to
    // a rider who had filled in "Līdz" and left "No" empty — technically about
    // the count, but read as a lie about the field he had just typed into.
    if (!rows[0]?.trim()) { setError(t(locale, "errNoStart")); return; }
    // An empty "Līdz" is a real answer — "man vienalga", the same ride the
    // lucky mode already handles — so only a one-way request with nothing but
    // a start is refused: there is no direction to send it in.
    if (tripType === "one_way" && filled.length < 2) { setError(t(locale, "errNoDestination")); return; }
    const value = hours.trim() ? Number(hours.replace(",", ".")) : preset ?? NaN;
    if (durationMode === "hours" && (!Number.isFinite(value) || value < 0.5 || value > 16)) { setError(t(locale, "errHours")); return; }
    const plan = composeRidePlan({ places: rows, tripType, durationMode, hours: value, profile: effectiveProfile });
    setError(null);
    if (rows !== places) leaveGhost(null);
    onGenerate(plan, Object.values(picked).filter((p): p is ResolvedPlace => p !== null));
  };

  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100vh-7rem)]" aria-label={t(locale, "a11yRideInput")}>
      <div className="border-b border-stone-200 bg-[#faf9f6] px-4 py-3">
        <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{t(locale, edit ? "editEyebrow" : "composerEyebrow")}</div>
        <h2 className="text-lg font-semibold tracking-tight">{t(locale, edit ? "editTitle" : "composerTitle")}</h2>
        <p className={`mt-1 text-xs text-stone-500 ${edit ? "" : "hidden md:block"}`}>{t(locale, edit ? "editHint" : "composerHint")}</p>
        {/* The ride as it now stands, and the way back one step. Here, in the
            header, because on a phone the rows and the map fill the screen
            below it and the numbers the last Confirm changed must be in view
            without scrolling. */}
        {edit && <div className="mt-2">{edit.status}</div>}
      </div>

      {/* Scrolls inside the fixed-height column when the profile panel is
          open; overflow-hidden on the section otherwise trapped the content. */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-5">
        {/* Trip type first: it decides what the last row means — a waypoint on
            the way home, or the finish. Asking for places before knowing the
            shape of the ride is asking the rider to guess. */}
        {/* Not while editing: a one-way ride turned into a loop is a different
            ride, and that is a search, not a correction. */}
        {!edit && <ChoiceRow label={t(locale, "tripType")} value={tripType} onChange={(v) => { track("trip_type_changed", { to: v }); setTripType(v); }} choices={[{ value: "one_way", label: t(locale, "oneWay") }, { value: "round_trip", label: t(locale, "roundTrip") }]} />}

        <RoutePlaces places={places} picked={picked} oneWay={tripType === "one_way"} busy={busy} onChange={reorder}
          onPick={(i, place) => {
            // Editing, a place picked in a row's own list is a mark by name:
            // previewed on the map, committed (and re-routed) on Confirm.
            if (edit && place) { previewPlace(i, place); return; }
            if (place) remember();
            setPick(i, place);
            // Planning, it commits at once — and the map shows it (rider,
            // 2026-09-25: "Sigulda" picked in „Līdz” left the map on Rīga).
            // The row becomes the active one, so its pin is the raised one,
            // and the map re-frames the places it has, the new one included.
            if (place && mapLive) {
              const target = leaveGhost(i);
              setRowIsNew(false);
              setPreview(null);
              setChosenRow(target);
              // Shown the way a map-search pick is: eased to when near, the
              // whole ride framed when it is far (`fit`) — an explicit pick,
              // so even a view the rider panned himself gives way to it.
              const others = places.map((_, j) => (j === i ? null : picked[j])).filter((p): p is ResolvedPlace => Boolean(p));
              openPick({ at: { lat: place.lat, lon: place.lon }, marker: null, fit: [...others, place].map((p) => ({ lat: p.lat, lon: p.lon })) });
            }
          }}
          onUseLocation={edit ? undefined : useMyLocation} locating={locating} near={anchor}
          onPickOnMap={onPickModeChange ? startPicking : undefined} activeRow={mapShown ? activeRow : null} preview={preview}
          onFocusRow={focusRow}
          // A row moved, removed or inserted: the picks follow their names
          // (`reorder`) and the active row follows its place (`followRow`) —
          // the ring, the filled pin and the map's hint all read `activeRow`,
          // so moving the one index moves all three together. Editing, the
          // change is also a change to the ride.
          onStructure={(next, change) => {
            const nextPicked = rekeyPicked(places, picked, next);
            // A row removed or moved is a change to the ride; a blank row
            // inserted is not, until something is put in it.
            if (change.kind !== "insert") remember();
            reorder(next);
            // A row the form's own "+" inserted is the new active row — the
            // same as the map's "+" (`addStopFromMap` covers the case where
            // the map is on screen; this is the closed phone map). Any other
            // change: the active row follows its place, and none stays none.
            setRowIsNew(false);
            setChosenRow((row) => (change.kind === "insert" ? change.at : row === null ? null : followRow(row, change) ?? defaultActiveRow(next)));
            if (edit) commitRows(next, nextPicked);
          }}
          fixedEnds={Boolean(edit)}
          // Every way of adding a stop activates the new row (rider,
          // 2026-09-25): with the map on screen the form's link is the map's
          // "+", exactly.
          onAddStop={edit || mapLive ? addStopFromMap : undefined} />

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
        {/* Editing, the map is the tool rather than a thing to glance at, so it
            is simply there — no toggle to find first. */}
        {map && edit && <div className="md:hidden">{map}</div>}
        {map && !edit && (
          <div className="md:hidden">
            {/* Opening the map asks "which row is unanswered?" again — the
                rider may have filled several in the form since he last looked
                at it, and the row that was active then is not the question he
                has now. Closing it changes nothing: the choice is harmless
                while nothing is listening to it. */}
            <button type="button" onClick={() => {
                if (mapOpen) { leaveGhost(null); setMapOpen(false); return; }
                track("form_map_opened");
                setChosenRow(defaultActiveRow(places));
                setMapOpen(true);
              }} aria-expanded={mapOpen}
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

        {!edit && <ChoiceRow label={t(locale, "duration")} value={durationMode} onChange={setDurationMode} choices={[{ value: "flexible", label: t(locale, "flexible") }, { value: "hours", label: t(locale, "exact") }]} />}
        {!edit && durationMode === "hours" && (
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

        {/* The profile is the ride's own while editing: every re-routed stretch
            is routed on it, and changing it would be asking for a new search. */}
        {!edit && <ProfileLine profile={effectiveProfile} onChange={changeProfile} />}

        {error && <p role="alert" className="text-xs text-red-700">{error}</p>}

        {/* Pushed to the bottom on the desktop so the column is used and the
            action is where a form's action belongs. */}
        <div className="md:mt-auto" />
        {edit ? (
          // One row: keeping the edits is the primary act, dropping them all
          // the outlined one beside it. Each as wide as its words (Estonian's
          // "Lõpeta muutmine | Tühista muutmine" is the longest pair), a
          // point smaller below 400 px so the pair shares the row at 375; on a
          // narrower screen the second wraps under the first rather than
          // being cut to an ellipsis.
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={edit.onDone} disabled={edit.rerouting} className="flex h-12 flex-auto items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-stone-900 px-3 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:opacity-50 max-[399px]:text-[13px]">
              <Check className="size-4 shrink-0" />{t(locale, "editDone")}
            </button>
            <button type="button" onClick={edit.onCancel} disabled={edit.rerouting} className="flex h-12 flex-auto items-center justify-center whitespace-nowrap rounded-full border border-stone-300 px-3 text-sm font-medium text-stone-700 transition hover:bg-stone-50 disabled:opacity-50 max-[399px]:text-[13px]">
              {t(locale, "editCancel")}
            </button>
          </div>
        ) : (
          <>
            <button type="button" onClick={submit} disabled={busy} className="flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-[#f56300] text-sm font-semibold text-white transition hover:bg-[#d85600] disabled:opacity-50"><Sparkles className="size-4" />{t(locale, "generate")}</button>
            <button type="button" onClick={onUseChat} disabled={busy} className="w-full text-center text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 hover:text-stone-800">{t(locale, "orUseChat")}</button>
          </>
        )}
      </div>
    </section>
  );
}
