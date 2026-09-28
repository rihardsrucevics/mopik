"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronUp, Map as MapIcon, Sparkles } from "lucide-react";
import type { MapChoiceGroup, MapControls, MapPendingMark } from "@/components/route-map";
import type { MapPointSheetRow } from "@/components/map-point-sheet";
import { RidePlan } from "@/lib/chat/ride-plan";
import { composeRidePlan, placesFromPlan } from "@/lib/chat/compose-plan";
import { pendingChains, planLine } from "@/lib/map/plan-line";
import { emptyUndo, popRedo, popUndo, pushUndo, type UndoStack } from "@/lib/map/undo-stack";
import { RoutePlaces, addStop, addedStopIndex, defaultActiveRow, followRow, rowAfterConfirm, rowLabel, maxRows } from "@/components/route-places";
import { useLocale } from "@/lib/i18n/use-locale";
import { t, messages, type MessageKey } from "@/lib/i18n/messages";
import { track } from "@/lib/analytics";
import { rememberPlace } from "@/lib/chat/recent-places";
import { pickedPlace } from "@/lib/chat/pick-name";
import { fi } from "@/lib/i18n/format";
import type { ResolvedPlace } from "@/lib/chat/places";
import { placeRoles, type PlaceRoles } from "@/lib/map/place-roles";
import type { RidePlaces, ShapeEdit } from "@/lib/routing/reroute-leg";
import type { Point } from "@/lib/geo/geometry";
import { onLineElsewhere, placeNewPoint, stopNumbers, type InsertOption, type Placement } from "@/lib/map/insert-leg";
import type { ProposalState, ProposedChange } from "@/lib/map/edit-proposal";
import { fixesFor, type Blocking } from "@/lib/map/blocking";
import { stepShape, type ShapePending } from "@/lib/map/shape-pending";
import { OBJECT_COLOR, actionDetail, guidance, objectExplainer, pointLabel, type EditObject, type ObjectMark } from "@/lib/map/edit-guidance";
// ── line-sheet ──
import { editTipDue, lineSheetRows, markEditTipSeen, type LineSpot } from "@/lib/map/line-sheet";
// ── /line-sheet ──
import { stepBatch } from "@/lib/map/batch-commit";
// On a phone the inline map is a preview: a row's pin and "+ Pietura" open it
// full screen first (rider, 2026-09-25).
import { mapFieldMode } from "@/lib/map/map-field";
import { openMapFullscreen } from "@/lib/map/fullscreen";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { demoteInPlan, livePlanDots, planDotsFromPlan, planShapePoints, pointActions, promoteInPlan, selectionLive, type PlanDot, type PointSelection } from "@/lib/map/point-selection";
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
  /**
   * A change the rider committed: a Confirm, a pick from a list, ✕ on a stop,
   * an arrow. Resolves to whether it landed on the line. `keepOnFailure`: a
   * refused change leaves the rows alone instead of re-seeding them, so the
   * caller can keep its marks pending (a batch).
   */
  onCommit: (rows: { names: string[]; picked: Record<number, ResolvedPlace | null> }, opts?: { keepOnFailure?: boolean }) => Promise<boolean>;
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
  /**
   * The ride's shaping points („maršruta punkti”, 2026-09-25), in riding
   * order: small white dots on the line, with no row here. A grab of the line
   * makes one; the dots drag, and a press opens „Izņemt” / „Padarīt par
   * pieturu”. Each of those is one commit (`onShape`), re-routed by the page.
   */
  shapePoints: { lat: number; lon: number }[];
  onShape: (op: ShapeEdit) => void;
  /**
   * The ride as drawn — its places (stops and pass-through points in riding
   * order) and its line, [lon, lat] — for where a new point goes (its
   * nearest leg on the line) and whether a moved pass-through point lands on
   * the line elsewhere (Phase 1 addition, lib/map/insert-leg.ts). Absent: a
   * new point is placed by straight lines, as in planning.
   */
  places?: RidePlaces;
  line?: Point[];
  /**
   * Preview before commit (Phase 1, docs/DESIGN-route-editing.md B4). When
   * present, every pending line-changing mark is handed to the page as it
   * changes (`ProposedChange`; `null` when the mark is gone) and the page
   * routes it in the background (250 ms debounce while dragging). ✓ then
   * still goes through `onCommit` / `onShape` with the same change, and the
   * page commits the landed proposal instead of routing again. Kind switches
   * (`promote`, `demote`) change no line and are committed at once.
   * Absent: today's behaviour, every ✓ routes and commits.
   */
  onPropose?: (change: ProposedChange | null) => void;
  /** The page's proposal for the pending mark: ✓ spins (`confirmBusy`) while routing, is disabled when refused. */
  proposal?: ProposalState;
  /**
   * The change could only be made by re-routing the whole stretch between
   * two kept places, which would reshape the ride: refused with the numbers,
   * and this — „Pārrēķināt posmu”, a chip in the notice area — makes that
   * the proposal. Absent unless it is on offer.
   */
  onWide?: () => void;
  // ── line-sheet ──
  /**
   * „Pievienot punktu šeit” on the line's sheet (lib/map/line-sheet.ts): a
   * pass-through point dropped on the line at the tapped spot. The line does
   * not change, so the page commits it at once, one step of the undo.
   */
  onPassHere?: (spot: { lat: number; lon: number; alongMeters: number }) => void;
  // ── /line-sheet ──
  // ── edit-routing ──
  /**
   * A place committed under its spot while the reverse lookup was still
   * naming it (a ✓ pressed the instant a pin landed): its name, now that the
   * lookup answered. The page renames it wherever it is — the proposal still
   * routing, or the ride it went into — without a step of the undo.
   */
  onRename?: (from: ResolvedPlace, to: ResolvedPlace) => void;
  // ── /edit-routing ──
  /**
   * „Tomēr braukt” on a warned proposal: arms it (the page's `mayCommit`),
   * and the chip then confirms it the way ✓ would. Without it nothing
   * commits a warned proposal.
   */
  onOverride?: (commitNow: boolean) => void;
  /** „Vest pa taisno”: no road reaches the point — as far as a road goes, then straight (a proposal). Absent unless on offer. */
  onStraight?: () => void;
  /**
   * Release B item 1: the proposal's points that stop it (refused or
   * warned) — ringed on the map, fixed per point with the notice area's
   * chips („Pārvietot”, „Izņemt”, „Vest pa taisno”, „Pievienot pārējās”).
   * The page names them in the guidance line (lib/map/blocking.ts).
   */
  blocking?: Blocking | null;
  /** „Vest pa taisno” for one point of a batch: the rest routed, that point straight. Absent unless on offer. */
  onStraightAt?: (at: { lat: number; lon: number }) => void;
};

/** This device's storage for the one-time edit hint, or nothing (a private window, blocked site data). */
function tipStore(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

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
   * Editing: a shaping point waiting for Confirm (rider, 2026-09-25: a grab
   * of the line is „just a moved route”, not a stop — no row, no name).
   *
   * - `add`: the line was grabbed at `at`; `to` is the mark where the point
   *   goes (the next tap, or where a mouse drag of the line was let go),
   *   null until there is one.
   * - `move`: dot `index` was dragged to `to`.
   *
   * Confirm commits it (`edit.onShape`); Cancel or Escape drops it, and the
   * dot goes back where it was.
   */
  const [shapePending, setShapePending] = useState<ShapePending | null>(null);
  const grab = shapePending?.kind === "add" ? shapePending : null;
  const shapeAddRef = useRef(false);
  useEffect(() => { shapeAddRef.current = grab !== null; }, [grab]);
  /**
   * ✓ was pressed on the proposed change: the pending mark goes, but the page
   * is committing it — so the `onPropose(null)` its going would send is not
   * a discard, and is not sent (see the proposal effect).
   */
  const committedRef = useRef(false);
  /**
   * The one exit from every transient state on the map (docs/DESIGN-route-
   * editing.md B: generalised from `leaveShape` and `closePointSel`). Every
   * ✓, ✕, sheet close, Escape and row focus goes through here, so none of
   * them can leave a ring, a sheet, a pending point or a proposal behind:
   *
   * - the shaping point's pending state goes (`stepShape`, rider 2026-09-25)
   *   and so does the tapped point's selection — ring, sheet, move, removal;
   * - `commit`: this is a ✓ (or a kind switch) and the page is committing
   *   what was proposed; otherwise the proposal is dropped (`onPropose(null)`,
   *   sent by the effect once the pending mark is gone);
   * - `dropMark`: a row's pending mark goes too (`cancelPicking`) — ✕ and
   *   Escape. A pin being moved always drops its mark on a non-✓ exit, and
   *   no row stays active after it;
   * - `keepPick`: the caller is handing the map to something else (a row, a
   *   pin, a grab) and opens the pick flow itself; otherwise, with no row
   *   left active, the map stops taking marks, so the pending marker, its
   *   connector and the grab's dot go with it.
   */
  const leaveTransient = (opts: { commit?: boolean; keepPick?: boolean; dropMark?: boolean } = {}) => {
    const sel = pointSel;
    const hadGrab = shapeAddRef.current;
    const hadShape = shapePending !== null || (sel?.kind === "shape" && sel.phase === "move");
    if (opts.commit) committedRef.current = true;
    setShapePending(null);
    shapeAddRef.current = false;
    setPointSel(null);
    setLineSel(null);
    setNewPoint(null);
    setMoveRemove(null);
    const pinMove = sel?.kind === "pin" && sel.phase === "move";
    if (!opts.keepPick && !opts.commit && (opts.dropMark || pinMove)) {
      cancelPicking();
      if (pinMove) setChosenRow(null);
    }
    if ((hadGrab || hadShape) && !opts.keepPick && activeRowRef.current === null) onPickModeChange?.(false);
  };
  /**
   * The point tapped on the map — a ride pin or a shaping point — with its
   * sheet and ring (lib/map/point-selection.ts). A pin's selection is only
   * live while its row is the active one, so whatever moves the active row
   * ends it; `shapeSelRef` lets the map's next mark find a selected dot.
   */
  const [pointSelSet, setPointSel] = useState<PointSelection | null>(null);
  // ── line-sheet ──
  /**
   * Edit mode: the stretch of line the rider tapped (lib/map/line-sheet.ts).
   * `menu`: its sheet is open — „Virzīt caur citu vietu”, „Pievienot punktu
   * šeit”, Atcelt. `via`: „Virzīt caur citu vietu” was chosen — the line is
   * grabbed at the spot exactly as a hold-drag grabs it, and the hint „Norādi
   * kartē, caur kurieni braukt” stands until the next tap, which is the
   * grab's mark (the drag's release). From then on it is the drag's own
   * pending point, proposal and ✓/✕. Gone with every exit (`leaveTransient`).
   */
  type LineSel = { spot: LineSpot; km: string; heading: string; color: string; phase: "menu" | "via" };
  const [lineSel, setLineSel] = useState<LineSel | null>(null);
  /** The one-time hint on entering edit mode (once per device, lib/map/line-sheet.ts). */
  const [tipOn, setTipOn] = useState(false);
  // Shown the first time this device opens the editor's map, and marked
  // seen at once: it stays up until its ✕ or the first tap on the line or a
  // point, and never comes back.
  // Decided during render, once (React's pattern for state that follows a
  // prop, as `seenSeed` below); written back in an effect.
  const [tipChecked, setTipChecked] = useState(false);
  if (edit && mapLive && !tipChecked) {
    setTipChecked(true);
    setTipOn(editTipDue(tipStore()));
  }
  useEffect(() => { if (tipOn) markEditTipSeen(tipStore()); }, [tipOn]);
  // ── /line-sheet ──
  /**
   * Planning's pass-through points (B1): a stop made „caurbraucams” leaves
   * the form and stays on the map as a white dot; the plan carries them as
   * `shapePoints`. Seeded from the plan the form was opened with, so a ride
   * reopened here shows the dots it was bent through — they are in the plan,
   * so they are on the map. Each follows a place by name
   * (lib/map/point-selection.ts); a dot whose place has left the rows is not
   * drawn and not planned.
   */
  const [planDots, setPlanDots] = useState<PlanDot[]>(() => (edit ? [] : planDotsFromPlan(placesFromPlan(initialPlan), initialPlan?.shapePoints, initialPlan?.returnToStart !== true)));
  /** The dots that are part of the plan now, in riding order — what the planning map draws. */
  const liveDots = edit ? [] : livePlanDots(places, planDots, tripType === "one_way");
  const pointSel = selectionLive(pointSelSet, { activeRow, shapeCount: edit ? edit.shapePoints.length : liveDots.length });
  const shapeSelRef = useRef<number | null>(null);
  useEffect(() => { shapeSelRef.current = pointSel?.kind === "shape" && pointSel.phase === "move" ? pointSel.index : null; });
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
    /** Put into its nearest leg when marked, and again whenever it moves (Phase 1 addition). */
    placed?: boolean;
  };
  const [batch, setBatch] = useState<BatchItem[]>([]);
  /**
   * The newest point added from the map, and where it went (Phase 1
   * addition, rider 2026-09-28; lib/map/insert-leg.ts): into the leg it is
   * nearest to — or the one the rider chose from Mopik's two when Mopik was
   * not sure (`options`, the notice area's chips). `id` is its pending stop
   * in the batch (−1: the single mark a search pick leaves in the new row).
   * `kind` is the „Pietura ⇄ Caurbraucams” switch while it is pending: a
   * pass-through point waits as a grabbed line point, joined to the line
   * where its leg passes nearest. `chosen` / `options` name the places either
   * side as they were when it was placed. Gone with every exit
   * (`leaveTransient`) and whenever the rows are re-seeded.
   */
  type NewWhere = { key: string; a: string | null; b: string | null; extend: boolean };
  type NewPoint = { id: number; lat: number; lon: number; place: ResolvedPlace | null; kind: "stop" | "pass"; chosen: NewWhere; options: NewWhere[] | null; unsure: Placement["unsure"] };
  const [newPoint, setNewPoint] = useState<NewPoint | null>(null);
  /**
   * §3: a pass-through point moved onto the line elsewhere — whether the
   * rider picked „Izņemt punktu” for this very spot (keyed by it, so a new
   * spot starts again on „Vest caur šejieni”).
   */
  const [moveRemove, setMoveRemove] = useState<string | null>(null);
  /** The pending stop the rider pressed: the next mark or drag moves it. */
  const [batchSel, setBatchSel] = useState<number | null>(null);
  /** Editing: a confirmed batch is being routed; its stops stay pending until the line lands. */
  const [batchCommitting, setBatchCommitting] = useState(false);
  const batchIdRef = useRef(0);
  const batchRef = useRef(batch);
  useEffect(() => { batchRef.current = batch; }, [batch]);
  // The profile the probes and the plan use: a plan the chat has modified
  // carries its own, otherwise the rider's remembered one (see `changeProfile`).
  const [profileOverride, setProfileOverride] = useState<RideProfile | null>(null);
  const effectiveProfile = profileOverride ?? (initialPlan ? profileFromPlan(initialPlan) : profile);

  /** Planning's undo stack (edit mode's is the page's ride history). */
  /** `dots`: planning's pass-through points, which a kind switch moves in and out of the rows. */
  type Snapshot = { names: string[]; picked: Record<number, ResolvedPlace | null>; dots?: PlanDot[] };
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
  // One lookup per spot in flight: a ✓ pressed while a mark is being named
  // waits on the lookup already asked (`nameLater`) instead of asking again.
  const namesInFlight = useRef(new Map<string, Promise<ResolvedPlace | null>>());
  const nameForPoint = useCallback((lat: number, lon: number): Promise<ResolvedPlace | null> => {
    const key = `${lat},${lon}`;
    const known = namesInFlight.current.get(key);
    if (known) return known;
    const ask = (async () => {
      try {
        const res = await fetch(`/api/places?lat=${lat}&lon=${lon}`);
        if (!res.ok) return null;
        return ((await res.json()) as { places: ResolvedPlace[] }).places?.[0] ?? null;
      } catch {
        // Offline, or the lookup is down. The point itself is still good.
        return null;
      } finally {
        namesInFlight.current.delete(key);
      }
    })();
    namesInFlight.current.set(key, ask);
    return ask;
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
  const remember = (before: Snapshot = { names: places, picked, dots: planDots }) => { if (!edit) setUndo((u) => pushUndo(u, { dots: planDots, ...before })); };
  /** Put a snapshot back: the rows, their places, and nothing pending. */
  const restore = (snap: Snapshot) => {
    setPlaces(snap.names);
    setPicked(snap.picked);
    if (snap.dots) setPlanDots(snap.dots);
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setShapePending(null);
    setBatch([]);
    setBatchSel(null);
    setNewPoint(null);
    setRowIsNew(false);
    setChosenRow(defaultActiveRow(snap.names));
  };
  /** The map header's ↶ outside a batch, and Ctrl/Cmd+Z. */
  const undoStep = () => {
    if (edit) { if (edit.canUndo && !edit.rerouting) { track("route_edit_undone", { how: "header" }); edit.onUndo(); } return; }
    const back = popUndo(undo, { names: places, picked, dots: planDots });
    if (!back) return;
    track("plan_undone", {});
    setUndo(back.stack);
    restore(back.value);
  };
  /** Shift+Ctrl/Cmd+Z, planning only: edit mode's history is one-way. */
  const redoStep = () => {
    if (edit) return;
    const forward = popRedo(undo, { names: places, picked, dots: planDots });
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
    setShapePending(null);
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
  // The same for a promoted dot's rows, applied once its name has come back.
  const pickedRef = useRef(picked);
  useEffect(() => { pickedRef.current = picked; }, [picked]);
  const planDotsRef = useRef(planDots);
  useEffect(() => { planDotsRef.current = planDots; }, [planDots]);
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
  /** Set while a new point waits as a pass-through point: a mark is its new spot. */
  const passMarkRef = useRef<((lat: number, lon: number) => void) | null>(null);
  /**
   * The gesture whose lookup has answered. While it trails `token`, a point
   * is under the marker and its name is still on the way — the map's bar is
   * already up (a mark is pending from the moment the marker lands) with
   * Confirm disabled, because the rider has marked something and must be able
   * to take it back without waiting seconds for a reverse lookup.
   */
  const [namedToken, setNamedToken] = useState<number | null>(null);
  // A layout effect (rider, 2026-09-28): the mark becomes the pending change
  // before the frame is painted, so no frame shows a dropped point with
  // nothing said about it (see `proposeRef` below).
  useLayoutEffect(() => {
    const row = activeRowRef.current;
    // Token 0 is the seed the page puts under a row that already has a place:
    // its name is known and shown, and re-deriving one would only risk showing
    // the rider a different word for the spot he has not yet moved.
    if (!pickPoint || pickPoint.token === 0) return;
    // A grabbed line point: the mark is where it goes. Not a place, so no
    // name is looked up — Confirm is live the moment the mark lands.
    // A new point switched to „Caurbraucams” (Phase 1 addition): the mark
    // is its new spot, placed in its leg again.
    if (passMarkRef.current) {
      passMarkRef.current(pickPoint.lat, pickPoint.lon);
      setNamedToken(pickPoint.token);
      return;
    }
    if (shapeAddRef.current) {
      const at = { lat: pickPoint.lat, lon: pickPoint.lon };
      setShapePending((p) => stepShape(p, { type: "mark", at }).pending);
      setNamedToken(pickPoint.token);
      return;
    }
    // A shaping point being moved („Pārvietot”): the mark is its new spot, pending until ✓.
    const shapeSel = shapeSelRef.current;
    if (shapeSel !== null) {
      setShapePending((p) => stepShape(p, { type: "move", index: shapeSel, at: { lat: pickPoint.lat, lon: pickPoint.lon } }).pending);
      setNamedToken(pickPoint.token);
      return;
    }
    if (row === null) return;
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
    setPointSel(null);
    setNewPoint(null);
    endPicking();
    setShapePending(null);
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
    leaveTransient({ keepPick: true });
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
    // A grab of the line left waiting is let go: the map now answers this
    // row, and a waiting grab would take its next mark as a shaping point.
    leaveTransient({ keepPick: true });
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
    leaveTransient({ keepPick: true });
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
    if (current.length >= maxRows(tripType === "one_way")) return;
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
    let target = row === activeRow ? row : leaveGhost(row);
    if (row !== activeRow) setRowIsNew(false);
    // A place found for a new row goes into the leg it is nearest to
    // (Phase 1 addition), as a mark on the map does.
    if (target !== null && target === activeRow && rowIsNew && !batch.length && !places[target]?.trim()) {
      const placed = placeRowAt({ names: places, picked, items: [] }, target, place);
      if (placed) {
        setPlaces(placed.names);
        setPicked(placed.picked);
        target = placed.row;
        noteNewPoint(placed, -1, place, place);
      }
    }
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
    const nextPicked = { ...picked, [row]: place };
    const after = rowAfterConfirm(filled, row, tripType === "one_way");
    // ✓: the one exit, committing — the row flow below keeps the map.
    leaveTransient({ commit: true, keepPick: true });
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
  /**
   * The names for places committed under their spots (editing, ✓ before the
   * lookup answered): the rows here take them, and the page renames them in
   * the ride (`RideEdit.onRename`). A lookup that finds nothing leaves the
   * spot's name — the truthful answer it always was.
   */
  const nameLater = (spots: ResolvedPlace[]) => {
    const rename = edit?.onRename;
    for (const from of spots) {
      void nameForPoint(from.lat, from.lon).then((found) => {
        const taken = placesRef.current.filter((n) => n !== from.name);
        const to = pickedPlace(found, from.lat, from.lon, taken, t(locale, "pickedOnMap"));
        if (to.name === from.name && to.label === from.label) return;
        setPlaces((rows) => rows.map((n) => (n === from.name ? to.name : n)));
        setPicked((pk) => Object.fromEntries(Object.entries(pk).map(([k, v]) => [k, v && v.name === from.name && v.lat === from.lat && v.lon === from.lon ? to : v])) as typeof pk);
        rename?.(from, to);
      });
    }
  };
  const confirmPick = () => {
    const row = activeRow;
    // Editing, ✓ while the mark is still being named commits it under its
    // spot at once — the routing is under way already — and the name fills
    // in when the lookup answers (`nameLater`).
    if (edit && row !== null && naming && markPreview && !offRoad) { nameLater([markPreview]); commitPick(row, markPreview); return; }
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
   * A point of the drawn line grabbed on the map (edit mode): a shaping point
   * in the making (rider, 2026-09-25 — „just a moved route”, not a stop). No
   * row is made and none stays active: whatever was pending on the rows is let
   * go (the line click wins), the rows go back to the ride's, and the next
   * mark — or where a mouse drag of the line is let go — is where the point
   * goes, waiting for Confirm.
   */
  const grabLine = ({ lat, lon, slot }: { lat: number; lon: number; slot: number }): boolean => {
    if (!edit || busy || edit.rerouting) return false;
    if (edit.shapePoints.length >= MAX_SHAPE_POINTS) return false;
    track("route_line_grabbed", { slot });
    setPlaces(edit.seed.names);
    setPicked({ ...edit.seed.picked });
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setRowIsNew(false);
    setChosenRow(null);
    // A line drag takes the map elsewhere: whatever was transient goes first.
    leaveTransient({ keepPick: true });
    setShapePending(stepShape(shapePending, { type: "grab", at: { lat, lon } }).pending);
    shapeAddRef.current = true;
    openPick({ at: null, marker: null });
    return true;
  };
  // ── line-sheet ──
  /**
   * A tap on the drawn line (edit mode): its sheet opens, and nothing else
   * happens — a tap never grabs the line. Whatever was transient goes first,
   * as a press on a pin lets it go; the rows go back to the ride's.
   */
  const tapLine = (tap: LineSpot & { km: string; heading: string; color: string }) => {
    if (!edit || busy) return;
    track("line_tapped", {});
    setTipOn(false);
    leaveTransient({ keepPick: true });
    setPlaces(edit.seed.names);
    setPicked({ ...edit.seed.picked });
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setRowIsNew(false);
    setChosenRow(null);
    setLineSel({ spot: { lat: tap.lat, lon: tap.lon, slot: tap.slot, alongMeters: tap.alongMeters }, km: tap.km, heading: tap.heading, color: tap.color, phase: "menu" });
  };
  /**
   * „Virzīt caur citu vietu”: the hold-drag's own path (`grabLine`) at the
   * tapped spot, so the next tap is exactly where a drag would have been
   * let go — the same `ShapeEdit` add, the same proposal.
   */
  const lineVia = () => {
    const sel = lineSel;
    if (!sel || sel.phase !== "menu") return;
    if (!grabLine({ lat: sel.spot.lat, lon: sel.spot.lon, slot: sel.spot.slot })) return;
    track("line_via_asked", {});
    setLineSel({ ...sel, phase: "via" });
  };
  /** „Pievienot punktu šeit”: the page drops a pass-through point on the line and commits it at once. */
  const linePass = () => {
    const sel = lineSel;
    if (!sel || sel.phase !== "menu" || !edit?.onPassHere) return;
    leaveTransient();
    edit.onPassHere({ lat: sel.spot.lat, lon: sel.spot.lon, alongMeters: sel.spot.alongMeters });
  };
  // ── /line-sheet ──
  /**
   * A shaping point's dot dragged: it waits where it was let go for Confirm,
   * like every edit. Rows are let go as a grab lets them go.
   */
  const dragShape = (index: number, to: { lat: number; lon: number }) => {
    if (!edit || busy || edit.rerouting) return;
    track("shape_point_dragged", {});
    setPlaces(edit.seed.names);
    setPicked({ ...edit.seed.picked });
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setRowIsNew(false);
    setChosenRow(null);
    leaveTransient({ keepPick: true });
    setShapePending({ kind: "move", index, to });
  };
  /**
   * Confirm on a pending shaping point: the edit goes to the page (planning:
   * the dot moves in the plan), and the point's edit state is left
   * completely (`leaveTransient`) — the rider carries on with something
   * else, and the dot is a plain dot until he taps it.
   */
  const confirmShape = () => {
    if (!shapePending || edit?.rerouting) return;
    const step = stepShape(shapePending, { type: "confirm" });
    if (!step.commit) return;
    if (!edit) {
      const op = step.commit;
      const target = op.kind === "move" ? liveDots[op.index]?.index : undefined;
      leaveTransient({ commit: true });
      if (op.kind !== "move" || target === undefined) return;
      remember();
      setPlanDots((dots) => dots.map((d, i) => (i === target ? { ...d, lat: op.lat, lon: op.lon } : d)));
      return;
    }
    // §3: moved onto the line elsewhere and „Izņemt punktu” chosen — the
    // point goes; the line already rides there.
    if (moveOnLine) track("moved_point_on_line", { choice: removeMoved ? "remove" : "keep" });
    const op: ShapeEdit = removeMoved && shapePending.kind === "move" ? { kind: "remove", index: shapePending.index } : step.commit;
    leaveTransient({ commit: true });
    edit.onShape(op);
  };
  /**
   * The new point as a pass-through point at `lat, lon` (editing): it waits
   * as a grabbed line point, joined to the line where its leg — the one
   * `choose` names, or the nearest — passes closest. The rows are the
   * ride's; a pass-through point has none. False when there is no line to
   * put it on.
   */
  const placePass = (lat: number, lon: number, choose: string | null, from: NewPoint | null): boolean => {
    if (!edit) return false;
    const names = edit.seed.names;
    const rows = names.map((_, i) => (edit.seed.picked[i] ? { lat: edit.seed.picked[i].lat, lon: edit.seed.picked[i].lon } : null));
    const placement = placeNewPoint({ rows, point: { lat, lon }, oneWay: tripType === "one_way", line: edit.line ?? null, allowExtend: false, choose });
    const on = placement?.chosen.onLine;
    if (!placement || !on) return false;
    setShapePending({ kind: "add", at: { lat: on[1], lon: on[0] }, to: { lat, lon } });
    shapeAddRef.current = true;
    setNewPoint({
      id: from?.id ?? -1, lat, lon, kind: "pass",
      place: from && from.lat === lat && from.lon === lon ? from.place : null,
      chosen: whereOf(placement.chosen, names),
      options: placement.options?.map((o) => whereOf(o, names)) ?? null,
      unsure: placement.unsure,
    });
    return true;
  };
  /**
   * „Pietura ⇄ Caurbraucams” while the new point is pending (editing): the
   * same spot, the other kind. A stop becomes a pass-through point — its row
   * goes, the stops after it take their numbers back, the proposal routes it
   * as a pass-through point; a pass-through point becomes a stop again, in
   * the leg it was in. The new point stays pending either way; ✓ commits
   * whichever it is.
   */
  const switchNewKind = (to: "stop" | "pass") => {
    if (!edit || !newPoint || newPoint.kind === to || busy || edit.rerouting || batchCommitting) return;
    if (to === "pass") {
      const item = newPoint.id === -1 ? null : batch.find((b) => b.id === newPoint.id) ?? null;
      const at = item ? { lat: item.lat, lon: item.lon } : preview ? { lat: preview.lat, lon: preview.lon } : null;
      if (!at || (item && batch.length !== 1) || edit.shapePoints.length >= MAX_SHAPE_POINTS) return;
      const place = item ? item.place : preview;
      track("new_point_kind_toggled", { to });
      setPlaces(edit.seed.names);
      setPicked({ ...edit.seed.picked });
      batchRef.current = [];
      setBatch([]);
      setBatchSel(null);
      setPreview(null);
      setOffRoad(null);
      setMapQuery(null);
      setRowIsNew(false);
      setChosenRow(null);
      placePass(at.lat, at.lon, newPoint.chosen.extend ? null : newPoint.chosen.key, { ...newPoint, ...at, place });
      return;
    }
    if (shapePending?.kind !== "add" || !shapePending.to) return;
    if (places.length >= maxRows(tripType === "one_way")) return;
    const { lat, lon } = shapePending.to;
    const place = newPoint.place && newPoint.lat === lat && newPoint.lon === lon ? newPoint.place : null;
    const id = ++batchIdRef.current;
    const names = edit.seed.names;
    const end = names.length;
    const placed = placeRowAt({
      names: [...names, place?.name ?? "…"], picked: { ...edit.seed.picked },
      items: [{ id, row: end, lat, lon, place, check: place ? "ok" : "checking" }],
    }, end, { lat, lon }, newPoint.chosen.key);
    if (!placed) return;
    track("new_point_kind_toggled", { to });
    setShapePending(null);
    shapeAddRef.current = false;
    batchRef.current = placed.items;
    setBatch(placed.items);
    setPlaces(placed.names);
    setPicked(placed.picked);
    setChosenRow(placed.row);
    setRowIsNew(true);
    noteNewPoint(placed, id, { lat, lon }, place);
    if (!place) settleBatchItem(id, lat, lon);
  };
  /**
   * One of Mopik's two choices for where the new point goes (the notice
   * area's chips): it is put into that leg instead, and re-proposed. The
   * two choices stay on offer, so the rider can go back.
   */
  const chooseLeg = (key: string) => {
    if (!newPoint || key === newPoint.chosen.key || busy || batchCommitting) return;
    track("new_point_leg_chosen", { extend: key === "extend" });
    if (newPoint.kind === "pass") {
      if (shapePending?.kind === "add" && shapePending.to) placePass(shapePending.to.lat, shapePending.to.lon, key, newPoint);
      return;
    }
    const item = newPoint.id === -1 ? null : batch.find((b) => b.id === newPoint.id) ?? null;
    const from = item ? item.row : activeRow;
    const at = item ?? preview;
    if (from === null || !at) return;
    const placed = placeRowAt({ names: places, picked, items: batch }, from, { lat: at.lat, lon: at.lon }, key);
    if (!placed) return;
    batchRef.current = placed.items;
    setBatch(placed.items);
    setPlaces(placed.names);
    setPicked(placed.picked);
    setChosenRow(placed.row);
    noteNewPoint(placed, newPoint.id, { lat: at.lat, lon: at.lon }, newPoint.place, newPoint.options);
  };
  /** Cancel on a pending shaping point: the dot goes back, nothing changes. */
  const cancelShape = () => {
    leaveTransient();
  };
  /**
   * „Izņemt” on a selected dot. Editing with preview (`onPropose`), it is a
   * pending change like any other: the ride without the dot is routed and
   * shown, the dot stays ringed, and ✓ or ✕ decides (phase `remove`).
   * Without preview, and in planning, it goes at once.
   */
  const removeShape = (index: number) => {
    if (busy || edit?.rerouting) return;
    if (!edit) {
      const target = liveDots[index]?.index;
      leaveTransient({ commit: true });
      if (target === undefined) return;
      remember();
      setPlanDots((dots) => dots.filter((_, i) => i !== target));
      return;
    }
    if (edit.onPropose) { setPointSel({ kind: "shape", index, phase: "remove" }); return; }
    leaveTransient({ commit: true });
    edit.onShape({ kind: "remove", index });
  };
  /**
   * „Padarīt par pieturu”: the dot becomes a numbered stop with a row, named
   * like any spot marked on the map — the reverse lookup, made
   * distinguishable from the ride's other places. A kind switch changes no
   * line, so it commits at once (B3): editing, one `onShape`; planning, the
   * row comes back where the dot was (`promoteInPlan`).
   */
  const promoteShape = (index: number) => {
    if (busy || edit?.rerouting) return;
    const point = edit ? edit.shapePoints[index] : liveDots[index];
    if (!point) return;
    leaveTransient({ commit: true });
    track("point_kind_switched", { to: "stop", mode: edit ? "edit" : "plan" });
    void (async () => {
      const found = await nameForPoint(point.lat, point.lon);
      const place = pickedPlace(found, point.lat, point.lon, placesRef.current, t(locale, "pickedOnMap"));
      rememberPlace(place);
      if (edit) { edit.onShape({ kind: "promote", index, place }); return; }
      const target = liveDots[index]?.index;
      if (target === undefined) return;
      // Applied to the rows as they are when the name has come back.
      const back = promoteInPlan({ rows: placesRef.current, picked: pickedRef.current, dots: planDotsRef.current, oneWay: tripType === "one_way", index: target, place });
      if (!back) return;
      remember({ names: placesRef.current, picked: pickedRef.current, dots: planDotsRef.current });
      setPlaces(back.rows);
      setPicked(back.picked);
      setPlanDots(back.dots);
      setChosenRow(null);
    })();
  };
  /**
   * „Padarīt caurbraucamu” on a stop's sheet (B1/B3): the stop becomes a
   * pass-through point at its own spot. Editing, one `onShape({kind:
   * "demote"})`, committed at once with no preview — the line does not
   * change; `stopIndex` counts the ride's stops in riding order from 0.
   * Planning, the row leaves the form and a white dot stays on the map
   * (`demoteInPlan`); the plan then carries it as a `shapePoints` entry.
   */
  const demoteStop = (row: number) => {
    if (busy || edit?.rerouting || !isStopRow(row)) return;
    if (edit) {
      const stopIndex = Array.from({ length: Math.max(row - 1, 0) }, (_, j) => j + 1).filter((i) => edit.seed.picked[i]).length;
      if (!edit.seed.picked[row]) return;
      leaveTransient({ commit: true });
      track("point_kind_switched", { to: "pass", mode: "edit" });
      edit.onShape({ kind: "demote", stopIndex });
      return;
    }
    const next = demoteInPlan({ rows: places, picked, dots: planDots, oneWay: tripType === "one_way", row });
    if (!next) return;
    leaveTransient({ commit: true });
    track("point_kind_switched", { to: "pass", mode: "plan" });
    remember();
    setPlaces(next.rows);
    setPicked(next.picked);
    setPlanDots(next.dots);
    setPreview(null);
    setRowIsNew(false);
    setChosenRow(null);
  };
  /**
   * A shaping point's dot pressed: it is selected — ring, sheet („Pārvietot”,
   * „Padarīt par pieturu”, „Izņemt”). Whatever was pending on the rows or on
   * another dot is let go; no row stays active, so the map takes no mark
   * until „Pārvietot”. Planning's dots are pressed the same way.
   */
  const pressShape = (index: number) => {
    if (busy || edit?.rerouting) return;
    track("shape_point_pressed", {});
    setTipOn(false);
    leaveTransient({ keepPick: true });
    if (edit) {
      setPlaces(edit.seed.names);
      setPicked({ ...edit.seed.picked });
    } else {
      leaveGhost(null);
    }
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setRowIsNew(false);
    setChosenRow(null);
    setPointSel({ kind: "shape", index, phase: "menu" });
  };
  /** A stop's rows as they are without `row` — what „Izņemt” commits. */
  const rowsWithout = (row: number) => {
    const baseNames = edit ? edit.seed.names : places;
    const basePicked = edit ? { ...edit.seed.picked } : picked;
    const names = baseNames.filter((_, i) => i !== row);
    return { names, picked: rekeyPicked(baseNames, basePicked, names) };
  };
  /**
   * „Izņemt” on a selected stop's sheet: the row goes, exactly as its ✕ in
   * the list takes it (and, editing, the ride is re-routed without it). A
   * mark pending on it goes too. The selection ends and no row stays active.
   * Editing with preview, the sheet's „Izņemt” first shows the ride without
   * the stop (`askRemove`); this is its ✓.
   */
  const removeStopRow = (row: number) => {
    if (busy || edit?.rerouting || !isStopRow(row)) return;
    const { names: next, picked: nextPicked } = rowsWithout(row);
    track("map_stop_removed", {});
    leaveTransient({ commit: true, keepPick: true });
    remember();
    setPlaces(next);
    setPicked(nextPicked);
    setPreview(null);
    setOffRoad(null);
    setMapQuery(null);
    setRowIsNew(false);
    setChosenRow(null);
    if (edit) commitRows(next, nextPicked);
  };
  /**
   * The sheet's „Izņemt”: at once in planning (and without preview);
   * editing with preview, the removal is proposed and waits for ✓ / ✕ with
   * the point still ringed.
   */
  const askRemove = () => {
    const sel = pointSel;
    if (!sel || sel.phase !== "menu") return;
    if (sel.kind === "shape") { removeShape(sel.index); return; }
    if (edit?.onPropose) {
      if (busy || edit.rerouting || !isStopRow(sel.row)) return;
      setPointSel({ ...sel, phase: "remove" });
      return;
    }
    removeStopRow(sel.row);
  };
  /** ✓ on a proposed removal: the change the page has been showing. */
  const confirmRemove = () => {
    const sel = pointSel;
    if (!edit || !sel || sel.phase !== "remove" || edit.rerouting) return;
    if (sel.kind === "pin") { removeStopRow(sel.row); return; }
    leaveTransient({ commit: true });
    edit.onShape({ kind: "remove", index: sel.index });
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
   * Put row `from` — a new point at `at`, not yet in the ride — into the leg
   * it is nearest to, or the one `choose` names (Phase 1 addition,
   * lib/map/insert-leg.ts): the rows, their places and the batch's pending
   * stops as they are with the row moved there. Editing, the legs are
   * measured on the ride's line; planning, by straight lines between the
   * places. Null when there is no place yet to put it between.
   */
  const placeRowAt = (s: { names: string[]; picked: Record<number, ResolvedPlace | null>; items: BatchItem[] }, from: number, at: { lat: number; lon: number }, choose: string | null = null) => {
    const without = s.names.filter((_, i) => i !== from);
    const pk = shiftPicked(s.picked, from, -1);
    const items = s.items.filter((b) => b.row !== from).map((b) => (b.row > from ? { ...b, row: b.row - 1 } : b));
    const rows = without.map((_, i) => {
      const b = items.find((x) => x.row === i);
      return b ? { lat: b.lat, lon: b.lon } : pk[i] ? { lat: pk[i]!.lat, lon: pk[i]!.lon } : null;
    });
    const placement = placeNewPoint({
      rows, pending: without.map((_, i) => items.some((x) => x.row === i)), point: at,
      oneWay: tripType === "one_way", line: edit?.line ?? null, choose,
    });
    if (!placement) return null;
    const row = placement.chosen.index;
    const moved = s.items.find((b) => b.row === from);
    return {
      names: [...without.slice(0, row), s.names[from], ...without.slice(row)],
      picked: { ...shiftPicked(pk, row, 1), [row]: s.picked[from] ?? null },
      items: [...items.map((b) => (b.row >= row ? { ...b, row: b.row + 1 } : b)), ...(moved ? [{ ...moved, row, placed: true }] : [])],
      row, placement, without,
    };
  };
  /** The places either side of an option, named from the rows it was measured on. */
  const whereOf = (o: InsertOption, names: readonly string[]): NewWhere => ({
    key: o.key, extend: o.extend,
    a: o.before === null ? null : names[o.before]?.trim() || null,
    b: o.after === null ? null : names[o.after]?.trim() || null,
  });
  /** Remember where the newest point went, for the field, its number and the chips. */
  const noteNewPoint = (placed: NonNullable<ReturnType<typeof placeRowAt>>, id: number, at: { lat: number; lon: number }, place: ResolvedPlace | null, keepOptions?: NewWhere[] | null) => {
    const { placement, without } = placed;
    setNewPoint({
      id, lat: at.lat, lon: at.lon, place, kind: "stop",
      chosen: whereOf(placement.chosen, without),
      options: keepOptions !== undefined ? keepOptions : placement.options?.map((o) => whereOf(o, without)) ?? null,
      unsure: placement.unsure,
    });
    if (keepOptions === undefined) track("new_point_placed", { unsure: placement.unsure, mode: edit ? "edit" : "plan" });
  };
  /**
   * A mark on the map while an empty stop row is active or a batch is open:
   * the selected pending stop moves there, or another pending stop is added
   * — never a camera move (the map's `batchMode`). Each new stop goes into
   * the leg it is nearest to (Phase 1 addition, `placeRowAt`); the first one
   * only when its row is a new one („+”, or the row a Confirm opened) — a
   * row the rider chose himself stays where he has it.
   */
  const addToBatch = (lat: number, lon: number) => {
    if (batchSel !== null) { moveBatchItem(batchSel, lat, lon); setBatchSel(null); return; }
    const id = ++batchIdRef.current;
    if (batch.length === 0) {
      if (activeRow === null) return;
      const row = activeRow;
      const item: BatchItem = { id, row, lat, lon, place: null, check: "checking" };
      const base = { names: places.map((p, i) => (i === row ? "…" : p)), picked, items: [item] };
      const placed = rowIsNew ? placeRowAt(base, row, { lat, lon }) : null;
      batchRef.current = placed?.items ?? base.items;
      setBatch(batchRef.current);
      setPlaces(placed?.names ?? base.names);
      if (placed) {
        setPicked(placed.picked);
        setChosenRow(placed.row);
        noteNewPoint(placed, id, { lat, lon }, null);
      }
      track("batch_stop_marked", { n: 1 });
      settleBatchItem(id, lat, lon);
      return;
    }
    if (places.length >= maxRows(tripType === "one_way")) return;
    const end = places.length;
    const placed = placeRowAt({ names: [...places, "…"], picked, items: [...batch, { id, row: end, lat, lon, place: null, check: "checking" }] }, end, { lat, lon });
    // No place yet to measure a leg by: after the last pending stop, as before.
    const at = batch[batch.length - 1].row + 1;
    const next = placed ?? {
      names: [...places.slice(0, at), "…", ...places.slice(at)],
      picked: shiftPicked(picked, at, 1),
      items: [...batch.map((b) => (b.row >= at ? { ...b, row: b.row + 1 } : b)), { id, row: at, lat, lon, place: null, check: "checking" as const }],
      row: at,
    };
    setPlaces(next.names);
    setPicked(next.picked);
    batchRef.current = next.items;
    setBatch(batchRef.current);
    setChosenRow(next.row);
    if (placed) noteNewPoint(placed, id, { lat, lon }, null);
    track("batch_stop_marked", { n: batch.length + 1 });
    settleBatchItem(id, lat, lon);
  };
  /**
   * A pending stop moved — dragged, or the selected one sent to the next mark.
   * Moving it is the end of dealing with it (rider, 2026-09-25: after he
   * dragged „3” his next tap on the map moved „3” again instead of adding
   * „4”), so the selection goes with every move, whichever way it was made,
   * and the next mark adds the next stop.
   */
  const moveBatchItem = (id: number, lat: number, lon: number) => {
    const item = batch.find((b) => b.id === id);
    setBatchSel(null);
    if (!item) return;
    const moved = batch.map((b) => (b.id === id ? { ...b, lat, lon, place: null, check: "checking" as const, snappedTo: null } : b));
    const names = places.map((p, i) => (i === item.row ? "…" : p));
    // A new point moved goes into the leg it is nearest to now.
    const placed = item.placed ? placeRowAt({ names, picked, items: moved }, item.row, { lat, lon }) : null;
    batchRef.current = placed?.items ?? moved;
    setBatch(batchRef.current);
    setPlaces(placed?.names ?? names);
    if (placed) {
      setPicked(placed.picked);
      setChosenRow(placed.row);
      noteNewPoint(placed, id, { lat, lon }, null);
    }
    settleBatchItem(id, lat, lon);
  };
  /** One pending stop out of the batch — its ✕, or ↶ for the last one. */
  const dropBatchItem = (id: number) => {
    const item = batch.find((b) => b.id === id);
    if (!item) return;
    setBatchSel(null);
    if (newPoint?.id === id) setNewPoint(null);
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
  /**
   * „Pievienot pārējās” (release B item 1): the points that stop the batch
   * go, the rest stay pending and are proposed again — so they still land.
   */
  const dropBatchItems = (ids: number[]) => {
    const going = batch.filter((b) => ids.includes(b.id));
    if (!going.length) return;
    if (going.length >= batch.length) { discardBatch(); return; }
    setBatchSel(null);
    if (newPoint && ids.includes(newPoint.id)) setNewPoint(null);
    const rows = new Set(going.map((b) => b.row));
    const keep = (i: number) => !rows.has(i);
    setPlaces(places.filter((_, i) => keep(i)));
    const nextPicked: Record<number, ResolvedPlace | null> = {};
    for (const [k, v] of Object.entries(picked)) { const i = Number(k); if (keep(i)) nextPicked[i - [...rows].filter((r) => r < i).length] = v; }
    setPicked(nextPicked);
    batchRef.current = batch.filter((b) => !ids.includes(b.id)).map((b) => ({ ...b, row: b.row - [...rows].filter((r) => r < b.row).length }));
    setBatch(batchRef.current);
    setChosenRow(batchRef.current[batchRef.current.length - 1].row);
    track("batch_rest_kept", { dropped: going.length, kept: batchRef.current.length });
  };
  /** ✕ on the header while a batch is open: every pending stop goes. */
  const discardBatch = () => {
    track("batch_discarded", { n: batch.length });
    const rows = batch.map((b) => b.row);
    const first = rows[0];
    batchRef.current = [];
    setBatch([]);
    setBatchSel(null);
    // ✕: the one exit. Editing, the rows go back to the ride's with it.
    if (edit) { leaveTransient({ dropMark: true }); return; }
    leaveTransient({ keepPick: true });
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
    // Editing, the stops still being named go under their spots and are
    // named when the lookups answer (`nameLater`); planning waits for them.
    const itemPlace = (b: BatchItem) => (edit ? batchPlace(b) : b.place);
    if (!batch.length || batch.some((b) => !itemPlace(b) || (edit ? b.check === "off-road" : b.check !== "ok"))) return;
    const names = places.map((p, i) => { const b = batch.find((x) => x.row === i); return b ? itemPlace(b)!.name : p; });
    const nextPicked = { ...picked };
    for (const b of batch) nextPicked[b.row] = itemPlace(b);
    if (edit) nameLater(batch.filter((b) => !b.place).map((b) => batchPlace(b)!));
    if (edit) {
      // Editing (2026-09-25): the stops stay pending until the line goes
      // through them. Turning them into confirmed rows at once drew them as
      // numbered pins off the line for as long as the re-route took, with ↶
      // hidden — and when it failed, or was dropped because another was
      // still running, they stayed that way. Now ✓ waits („Pārrēķinu
      // posmu…”); the new line clears the batch (the rows are re-seeded from
      // the ride); a refusal keeps it, pending, with the reason on the map.
      const start = stepBatch({ committing: batchCommitting }, { type: "confirm", busy: edit.rerouting });
      if (!start.send) return;
      track("batch_confirmed", { n: batch.length });
      // ✓: the one exit, committing. The batch itself stays pending until
      // its line lands (below), so the map keeps its marks meanwhile.
      leaveTransient({ commit: true, keepPick: true });
      setBatchCommitting(true);
      setBatchSel(null);
      void edit.onCommit({ names, picked: nextPicked }, { keepOnFailure: true }).then((ok) => {
        const done = stepBatch(start.state, { type: ok ? "landed" : "refused" });
        setBatchCommitting(done.state.committing);
        // Refused: the batch is still pending, and its ✕ is a real discard.
        if (!done.clearBatch) { committedRef.current = false; return; }
        for (const b of batch) if (b.place) rememberPlace(b.place);
        batchRef.current = [];
        setBatch([]);
        setRowIsNew(false);
        // As planning's batch does: no row stays waiting for a mark.
        setChosenRow(defaultActiveRow(names));
      });
      return;
    }
    // The step back is to before the batch: its rows gone again, the empty
    // row it started in empty again — one undo takes the whole batch.
    const rowsOf = batch.map((b) => b.row);
    let beforePicked = picked;
    for (const r of [...rowsOf].reverse()) if (r !== rowsOf[0]) beforePicked = shiftPicked(beforePicked, r, -1);
    remember({
      names: places.filter((_, i) => !rowsOf.includes(i) || i === rowsOf[0]).map((p, i) => (i === rowsOf[0] ? "" : p)),
      picked: beforePicked,
    });
    leaveTransient({ commit: true, keepPick: true });
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
   * A ride pin pressed on the map: it is selected — ringed, its sheet open
   * („Pārvietot”, „Izņemt” for a stop) — and nothing moves until „Pārvietot”
   * makes its row the active one (`movePoint`). A mark pending on another row
   * is let go first, as focusing another field lets it go: the press is the
   * rider changing his mind about which place he is correcting. No row stays
   * active meanwhile, so a tap on the map only closes the sheet.
   */
  const pressPin = (role: "start" | "via" | "finish", index: number) => {
    if (busy) return;
    const row = rowOfPin(role, index);
    if (row < 0) return;
    track("map_pin_pressed", { role });
    setTipOn(false);
    leaveTransient({ keepPick: true });
    let target: number | null = row;
    if (edit && (preview || offRoad)) {
      cancelPicking();
      if (rowIsNew && activeRow !== null && activeRow < row) target = row - 1;
    } else {
      target = leaveGhost(row);
    }
    setPreview(null);
    setMapQuery(null);
    setRowIsNew(false);
    setOffRoad(null);
    setChosenRow(null);
    if (target !== null) setPointSel({ kind: "pin", role, row: target, phase: "menu" });
  };
  /**
   * „Pārvietot” on a point's sheet: the sheet gives way to the hint in the
   * bottom bar, and the next mark is the point's new place — a pin's through
   * its row, made the active one as a focused field makes it; a dot's as a
   * pending move (`stepShape`). ✓ or ✕ then ends it all.
   */
  const movePoint = () => {
    const sel = pointSel;
    if (!sel || sel.phase !== "menu") return;
    track("map_point_move", { kind: sel.kind });
    if (sel.kind === "pin") {
      focusRow(sel.row, { refocus: false });
      setPointSel({ ...sel, phase: "move" });
      return;
    }
    setPointSel({ ...sel, phase: "move" });
    openPick({ at: null, marker: null });
  };
  const dragPin = (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => {
    if (busy) return;
    const row = rowOfPin(role, index);
    if (row < 0) return;
    track("route_edit_pin_dragged", { role });
    leaveTransient({ keepPick: true });
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
    setShapePending(null);
    const names = edit.seed.names;
    setPlaces(names);
    setPicked({ ...edit.seed.picked });
    setRowIsNew(false);
    setBatch([]);
    setBatchSel(null);
    setNewPoint(null);
    setLineSel(null);
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
  // A grabbed line point waiting for its mark answers the map too, with no
  // row: the next tap is where it goes.
  const picking = activeRow !== null || grab !== null || (pointSel?.kind === "shape" && pointSel.phase === "move");
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
  const atCap = places.length >= maxRows(tripType === "one_way");
  /**
   * Phase 1 addition (lib/map/insert-leg.ts). The number every stop's pin
   * wears, a new point pending among them counted — so the stops after it
   * move up one while it waits, and back when it goes or turns
   * pass-through. The row of the newest point, and the field's words for
   * where it went: „Pietura 3 · starp „Līgatne” un „Cēsis””.
   */
  const pendingStopRows = new Set(batch.map((b) => b.row));
  const newRow = !newPoint || newPoint.kind === "pass" ? null
    : newPoint.id === -1 ? (preview ? activeRow : null)
    : batch.find((b) => b.id === newPoint.id)?.row ?? null;
  if (newRow !== null) pendingStopRows.add(newRow);
  const rowNumbers = stopNumbers(places.map((_, i) => (!isStopRow(i) ? "none" as const
    : pendingStopRows.has(i) ? "stop" as const
    : picked[i] ? (picked[i]!.kind ? "sight" as const : "stop" as const) : "none" as const)));
  const shortName = (name: string) => (name.length > 18 ? `${name.slice(0, 17).trimEnd()}…` : name);
  const whereWords = (w: NewWhere, chip: boolean, short = false) => {
    const n = (x: string | null) => (x && short ? shortName(x) : x ?? "");
    if (w.extend) return chip ? t(locale, "legChipFinish") : fi(t(locale, "insertWhereAfter"), { a: n(w.a) });
    // A chip names its leg by where it starts — „Pēc „Līgatne”” — short
    // enough for two side by side at 320 px; its tooltip and the field say
    // both ends.
    if (w.a && w.b) return chip && short ? fi(t(locale, "legChipAfter"), { a: n(w.a) }) : fi(t(locale, chip ? "legChipBetween" : "insertWhereBetween"), { a: n(w.a), b: n(w.b) });
    if (w.a) return fi(t(locale, chip ? "legChipAfter" : "insertWhereAfter"), { a: n(w.a) });
    return fi(t(locale, chip ? "legChipBefore" : "insertWhereBefore"), { b: n(w.b) });
  };
  const insertWords = !newPoint ? null : (() => {
    const w = newPoint.chosen;
    const what = newPoint.kind === "pass" ? t(locale, "shapePointName")
      : w.extend ? t(locale, "insertNewFinish")
      : newRow !== null && rowNumbers[newRow] ? fi(t(locale, "pointStopTitle"), { n: rowNumbers[newRow]! }) : null;
    if (!what) return null;
    return w.a || w.b ? `${what} · ${whereWords(w, false)}` : what;
  })();
  /**
   * §3: a pass-through point moved (dragged, or „Pārvietot” and a mark) to a
   * spot within `ON_LINE_M` of the line somewhere other than the stretch it
   * shapes: the line may already go there. The chips ask — „Vest caur
   * šejieni” (preselected: he moved it) or „Izņemt punktu”.
   */
  const movedShape = edit && shapePending?.kind === "move" ? shapePending : null;
  const moveKey = movedShape ? `${movedShape.index}:${movedShape.to.lat},${movedShape.to.lon}` : "";
  const moveOnLine = Boolean(movedShape && edit?.line && edit.places
    && onLineElsewhere({ line: edit.line, places: edit.places, shapeIndex: movedShape.index, to: movedShape.to }));
  const removeMoved = moveOnLine && moveRemove === moveKey;
  // ── release-b: blocking ── Which pending points stop the proposal (item 1).
  const blockingNow = edit?.blocking && !edit.blocking.probing && edit.blocking.points.length ? edit.blocking : null;
  const sameSpot = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7;
  const blockedItems = blockingNow ? batch.filter((b) => blockingNow.points.some((q) => sameSpot(q, b))) : [];
  const pendingBlocked = Boolean(blockingNow && !batch.length);
  // ── /release-b: blocking ──
  /** Whether the new point's kind can be switched now: one new point, pending, not being committed. */
  const canSwitchKind = Boolean(edit?.onPropose && newPoint && !batchCommitting && !edit.rerouting && (newPoint.kind === "pass"
    ? shapePending?.kind === "add" && Boolean(shapePending.to) && !atCap
    : (newPoint.id === -1 ? Boolean(preview) : batch.length === 1 && batch[0].id === newPoint.id) && edit.shapePoints.length < MAX_SHAPE_POINTS));
  /**
   * The notice area's chips (never in the bar or the column: their slots
   * stay put). What each does is named here (`act`) and wired to the
   * handlers in the controls effect below, as every other control is.
   */
  type ChoiceAct = { kind: "stop" | "pass" } | { leg: string } | { remove: boolean } | { wide: true } | { override: true } | { straight: true }
    | { block: "move" | "remove" | "straight" | "rest"; id?: number };
  type ChoiceSpec = Omit<MapChoiceGroup, "options"> & { options: (Omit<MapChoiceGroup["options"][number], "onSelect"> & { act: ChoiceAct })[] };
  const choices: ChoiceSpec[] = [];
  if (canSwitchKind && newPoint) choices.push({
    key: "kind", label: t(locale, "kindChoiceLabel"),
    options: (["stop", "pass"] as const).map((k) => ({
      key: k, label: t(locale, k === "stop" ? "kindStop" : "kindPass"), selected: newPoint.kind === k,
      act: { kind: k },
    })),
  });
  if (newPoint?.options && !batchCommitting) choices.push({
    key: "leg", label: t(locale, "legChoiceLabel"),
    options: newPoint.options.map((o) => ({
      key: o.key, label: whereWords(o, true, true), title: whereWords(o, true), selected: o.key === newPoint.chosen.key,
      act: { leg: o.key },
    })),
  });
  if (moveOnLine) choices.push({
    key: "move", label: t(locale, "moveChoiceLabel"),
    options: [
      { key: "keep", label: t(locale, "moveKeepHere"), title: t(locale, "moveChoiceLabel"), selected: !removeMoved, act: { remove: false } },
      { key: "remove", label: t(locale, "moveRemovePoint"), title: t(locale, "moveChoiceLabel"), selected: removeMoved, act: { remove: true } },
    ],
  });
  if (edit?.onWide) choices.push({
    key: "wide", label: t(locale, "editWideAccept"), action: true,
    options: [{ key: "wide", label: t(locale, "editWideAccept"), selected: false, act: { wide: true } }],
  });
  if (edit?.onStraight) choices.push({
    key: "straight", label: t(locale, "editStraightLabel"), action: true,
    options: [{ key: "straight", label: t(locale, "editStraightAccept"), selected: false, act: { straight: true } }],
  });
  // „Tomēr braukt”: a proposal outside the profile or with a big detour
  // (`EditProposal.accept`) is taken only by this chip — what ✓ would do,
  // one ↶ step; ✓ itself is off while it waits (`useProposalWarn`).
  if (edit?.proposal?.phase === "proposed" && edit.proposal.proposal.accept) choices.push({
    key: "override", label: t(locale, "editOverrideLabel"), action: true,
    options: [{ key: "override", label: t(locale, "editOverrideAccept"), selected: false, act: { override: true } }],
  });
  // ── release-b: blocking ── The points that stop the proposal (item 1):
  // their fixes, per point, and „Pievienot pārējās” for the rest of a batch.
  if (blockingNow && blockedItems.length) {
    const first = blockedItems[0];
    const point = blockingNow.points.find((q) => sameSpot(q, first));
    const fixes = fixesFor(blockingNow, edit?.proposal?.phase === "proposed");
    const who = point ? pointLabel(point) : "";
    choices.push({
      key: "block", label: who ? `${t(locale, "blockChipLabel")}: ${who}` : t(locale, "blockChipLabel"), action: true,
      options: [
        { key: "move", label: t(locale, "blockChipMove"), title: who ? `${t(locale, "blockChipMove")}: ${who}` : undefined, selected: false, act: { block: "move", id: first.id } },
        { key: "remove", label: t(locale, "blockChipRemove"), title: who ? `${t(locale, "blockChipRemove")}: ${who}` : undefined, selected: false, act: { block: "remove", id: first.id } },
        ...(fixes.straight && edit?.onStraightAt ? [{ key: "straight", label: t(locale, "editStraightAccept"), selected: false, act: { block: "straight" as const, id: first.id } }] : []),
      ],
    });
    if (blockedItems.length < batch.length) choices.push({
      key: "rest", label: t(locale, "blockChipRest"), action: true,
      options: [{ key: "rest", label: t(locale, "blockChipRest"), selected: false, act: { block: "rest" } }],
    });
  } else if (blockingNow && pendingBlocked) {
    // One point, not a batch: ✕ takes it out, a tap elsewhere moves it; „Vest pa taisno” is its own chip.
    choices.push({
      key: "block", label: t(locale, "blockChipLabel"), action: true,
      options: [{ key: "remove", label: t(locale, "blockChipRemove"), selected: false, act: { block: "remove" } }],
    });
  }
  // ── /release-b: blocking ──
  const choicesKey = choices.map((g) => `${g.key}:${g.options.map((o) => `${o.key}${o.selected ? "*" : ""}${o.label}`).join(",")}`).join("|");
  /** Why no stop fits, whole: the „+”'s name and tooltip, the field's at the cap. */
  const capSentence = fi(t(locale, "mapAddStopFull"), { n: MAX_STOPS });
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
   * The dots the map draws: the ride's shaping points (planning: its
   * pass-through dots), the one being moved where it was let go. None while
   * a batch is open in edit mode (its marks are stops).
   */
  const shapeDots = (edit ? edit.shapePoints : liveDots.map((d) => ({ lat: d.lat, lon: d.lon })))
    .map((p, i) => (shapePending?.kind === "move" && shapePending.index === i ? shapePending.to : p));
  const shapeKey = shapeDots.map((p) => `${p.lat},${p.lon}`).join("|");
  /**
   * The dashed line joining the pins in riding order, planning only — a
   * generated ride draws the real line, and edit mode has it (`planLine`).
   */
  const planRows = places.map((_, i) => (picked[i] ? [picked[i]!.lon, picked[i]!.lat] as [number, number] : null));
  // The pass-through dots ride in the dashed line too, each after the row it
  // follows — the plan goes through them.
  const lineRows: ([number, number] | null)[] = [];
  const lineRowOf: number[] = [];
  places.forEach((_, i) => {
    lineRowOf[i] = lineRows.length;
    lineRows.push(planRows[i]);
    liveDots.forEach((d, k) => { if (d.afterRow === i) { const at = shapeDots[k] ?? d; lineRows.push([at.lon, at.lat]); } });
  });
  const basePath = edit ? null : planLine({
    rows: lineRows,
    roundTrip: tripType === "round_trip",
    pending: activeRow !== null && preview && !batch.length ? { row: lineRowOf[activeRow], point: [preview.lon, preview.lat] } : null,
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
    lineTap: (tap: LineSpot & { km: string; heading: string; color: string }) => void; lineVia: () => void; linePass: () => void; tipClose: () => void;
    shapeDrag: (index: number, at: { lat: number; lon: number }) => void;
    confirmShape: () => void; cancelShape: () => void;
    shapeRemove: (index: number) => void; shapePromote: (index: number) => void;
    shapePress: (index: number) => void; pointRemove: () => void; confirmRemove: () => void; pointPromote: () => void; pointDemote: () => void; pointClose: () => void; pointMove: () => void;
    confirmBatch: () => void; discardBatch: () => void; undoBatch: () => void;
    selectBatch: (id: number) => void; moveBatch: (id: number, at: { lat: number; lon: number }) => void; dropBatch: (id: number) => void;
    dropBatchItems: (ids: number[]) => void; blockMove: (id: number) => void;
    moveSelectedToRoad: () => void; dropSelected: () => void;
    undo: () => void;
    switchKind: (to: "stop" | "pass") => void; chooseLeg: (key: string) => void; moveChoice: (remove: boolean) => void; wide: () => void;
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
  // ── edit-routing ──
  /**
   * Editing: the mark's place from the instant it lands (rider, 2026-09-28:
   * after he dropped a pin the ride was re-routing but nothing said so, and ✓
   * was off). While the reverse lookup is still naming it, the place is the
   * tapped spot under its coordinates („57,12345, 24,12345”) — enough to
   * route, and the routing never waits for the name. The name fills in when
   * it arrives; the page keeps the routing it already started
   * (`sameGeometry`, lib/map/proposal-view.ts). Planning keeps waiting for
   * the name: its probe is asked by name.
   */
  const provisional = (lat: number, lon: number, row: number): ResolvedPlace =>
    pickedPlace(null, lat, lon, places.filter((_, i) => i !== row), t(locale, "pickedOnMap"));
  /** A batch's pending stop as the proposal sees it: its name, or its spot while it is being named. */
  const batchPlace = (b: BatchItem): ResolvedPlace | null => b.place ?? (edit ? provisional(b.lat, b.lon, b.row) : null);
  const batchNamed = !batch.some((b) => !b.place || b.check !== "ok");
  // ── /edit-routing ──
  /**
   * Batch adding is on while an empty stop row is active (and no single mark,
   * search pick or grabbed line point is pending), or once a batch has
   * started. Then a mark adds a pending stop (`addToBatch`) and the map keeps
   * its camera still.
   */
  const batchActive = batch.length > 0;
  const batchReady = !batchActive && !grab && !preview && !offRoad && activeRow !== null && isStopRow(activeRow) && !places[activeRow]?.trim();
  const batchMode = batchActive || batchReady;
  // ── edit-routing ── Only a mark for the active row itself: a batch's
  // marks, a grab's, a moved dot's and a new pass-through point's go
  // elsewhere, and are never this row's change.
  const markPreview = edit && activeRow !== null && naming && pickPoint && !batchMode && !grab && !(pointSel?.kind === "shape" && pointSel.phase === "move") && newPoint?.kind !== "pass"
    ? provisional(pickPoint.lat, pickPoint.lon, activeRow) : preview;
  // ── /edit-routing ──
  // Synced after each commit; the mark that the next render brings reads it.
  useEffect(() => { batchPointRef.current = batchMode ? addToBatch : null; });
  useEffect(() => { passMarkRef.current = newPoint?.kind === "pass" && grab ? (lat: number, lon: number) => { placePass(lat, lon, null, newPoint); } : null; });
  const selectedItem = batchSel === null ? null : batch.find((b) => b.id === batchSel) ?? null;
  const batchKey = batch.map((b) => `${b.id}:${b.row}:${b.lat},${b.lon}:${b.place?.name ?? ""}:${b.check}`).join("|") + `|${batchSel ?? ""}|${batchReady ? 1 : 0}`;
  const pendingKey = shapePending
    ? ["shape", shapePending.kind, shapePending.to?.lat ?? "", shapePending.to?.lon ?? "", edit?.rerouting ? 1 : 0].join("|")
    : activeRow === null || !(preview || offRoad || naming)
    ? ""
    : [preview?.lat, preview?.lon, checking, naming, offRoad?.distanceM ?? "", offRoad?.snappedTo ? 1 : 0, edit?.rerouting ? 1 : 0].join("|");
  /** Where the tapped point is drawn: a pin at its row's place, a dot where it is (or is being moved to). */
  const selectedAt = !pointSel ? null : pointSel.kind === "shape" ? shapeDots[pointSel.index] ?? null : picked[pointSel.row] ? { lat: picked[pointSel.row]!.lat, lon: picked[pointSel.row]!.lon } : null;
  const pointKey = !pointSel ? "" : [pointSel.kind, pointSel.phase, pointSel.kind === "shape" ? pointSel.index : pointSel.row, selectedAt?.lat ?? "", selectedAt?.lon ?? ""].join("|");
  /**
   * Edit mode: while a point is being moved or placed, the dashed straight
   * lines from where it would go to the places before and after it in riding
   * order (rider, 2026-09-25, after OsmAnd). A place of a row joins its
   * neighbouring rows; a shaping point, which has no row, is placed along the
   * line by the map from `origin`. Gone on ✓ or ✕ with the pending state.
   */
  // ── line-sheet ── „Virzīt caur citu vietu” waits for its tap.
  const viaWaiting = lineSel?.phase === "via" && grab !== null && !grab.to;
  const lineKey = !lineSel ? "" : [lineSel.phase, lineSel.spot.lat, lineSel.spot.lon, lineSel.km, lineSel.heading, viaWaiting ? 1 : 0].join("|");
  // ── /line-sheet ──
  // Release B: one mechanism for every pending mark — chains prev → new →
  // next per affected leg (`pendingChains`), gone once the proposal has
  // landed (its line says it then) and with the pending state on ✓ / ✕.
  const proposalLanded = edit?.proposal?.phase === "proposed";
  const chainRow = (i: number) => (picked[i] ? { lat: picked[i]!.lat, lon: picked[i]!.lon } : null);
  const movePreview = !edit || proposalLanded ? null
    : batch.length ? {
        chains: pendingChains({
          rows: places.map((_, i) => { const b = batch.find((x) => x.row === i); return b ? { lat: b.lat, lon: b.lon, id: b.id } : chainRow(i); }),
          pending: places.map((_, i) => batch.some((x) => x.row === i)),
          roundTrip: tripType === "round_trip",
        }),
        candidate: null,
      }
    : shapePending?.kind === "add" ? { origin: shapePending.at, candidate: shapePending.to, ...(viaWaiting ? { follow: true } : {}) }
    : shapePending?.kind === "move" ? { origin: edit.shapePoints[shapePending.index] ?? null, candidate: shapePending.to }
    : pointSel?.kind === "shape" && pointSel.phase === "move" ? { origin: edit.shapePoints[pointSel.index] ?? null, candidate: null }
    : activeRow !== null && (preview || pointSel?.phase === "move" || rowIsNew) ? (() => {
        // The mark itself — while its name is still being looked up, its spot.
        const candidate = preview ? { lat: preview.lat, lon: preview.lon } : pickPoint && pickPoint.token !== 0 && namedToken !== pickPoint.token ? { lat: pickPoint.lat, lon: pickPoint.lon } : null;
        return {
          chains: !candidate ? [] : pendingChains({
            rows: places.map((_, i) => (i === activeRow ? { ...candidate, id: -1 } : chainRow(i))),
            pending: places.map((_, i) => i === activeRow),
            roundTrip: tripType === "round_trip",
          }),
          candidate,
        };
      })()
    : null;
  const movePreviewKey = movePreview ? JSON.stringify(movePreview) : "";
  const stopCount = places.slice(1, tripType === "one_way" ? -1 : undefined).filter((p) => p.trim()).length;
  /**
   * Preview before commit (B4): the change the pending mark would make,
   * exactly what its ✓ hands to `onCommit` / `onShape` — a pin moved or a
   * new stop (its row with the mark), a batch once every stop in it is named,
   * a shaping point moved or placed, a removal waiting for ✓. Null when
   * nothing routable is pending (a mark still being named, a grab with no
   * place yet, a mark that would change nothing). Editing with `onPropose`
   * only.
   */
  // Editing, a batch is proposed from its first mark on, its stops still
  // being named under their spots (`batchPlace`); only an off-road verdict
  // (planning's probe) holds it back.
  const proposedChange: ProposedChange | null = !edit?.onPropose ? null
    : batch.length ? (batch.some((b) => !batchPlace(b) || b.check === "off-road") ? null : (() => {
        const names = places.map((p, i) => { const b = batch.find((x) => x.row === i); return b ? batchPlace(b)!.name : p; });
        const nextPicked = { ...picked };
        for (const b of batch) nextPicked[b.row] = batchPlace(b);
        return { kind: "rows" as const, rows: { names, picked: nextPicked } };
      })())
    : shapePending?.kind === "move" && removeMoved ? { kind: "shape" as const, op: { kind: "remove" as const, index: shapePending.index } }
    : shapePending ? (() => { const op = stepShape(shapePending, { type: "confirm" }).commit; return op ? { kind: "shape" as const, op } : null; })()
    : pointSel?.phase === "remove" ? (pointSel.kind === "shape"
        ? { kind: "shape" as const, op: { kind: "remove" as const, index: pointSel.index } }
        : { kind: "rows" as const, rows: rowsWithout(pointSel.row) })
    : activeRow !== null && markPreview && !(picked[activeRow] && picked[activeRow]!.lat === markPreview.lat && picked[activeRow]!.lon === markPreview.lon && places[activeRow] === markPreview.name)
      ? { kind: "rows" as const, rows: { names: places.map((p, i) => (i === activeRow ? markPreview.name : p)), picked: { ...picked, [activeRow]: markPreview } } }
    : null;
  const proposeKey = proposedChange ? JSON.stringify(proposedChange) : "";
  /**
   * Hand every pending change to the page as it appears or changes, and
   * `null` when it goes — unless it went because ✓ committed it
   * (`committedRef`, set by `leaveTransient({ commit })`): the page is then
   * committing the landed proposal, and a null would discard it.
   */
  const proposeRef = useRef(edit?.onPropose);
  useLayoutEffect(() => { proposeRef.current = edit?.onPropose; });
  const proposedRef = useRef("");
  const proposedChangeRef = useRef(proposedChange);
  useLayoutEffect(() => { proposedChangeRef.current = proposedChange; });
  // A pin dragged again, or marked again, is named before its change exists:
  // meanwhile nothing is said — not a null that would discard the proposal
  // on screen only to route the next one a moment later (the page debounces
  // a stream of drags; a discard between each would break the stream up).
  // (With the mark's spot standing in for its name, editing, the change
  // exists from the instant the mark lands, and is sent.)
  const holdPropose = naming && activeRow !== null && !batch.length && !shapePending && !proposedChange;
  // A batch's newest stop is still being named: its change does not exist
  // yet, and the one on screen stays until it does — a null here was the
  // gap between two proposals (rider, 2026-09-28).
  const batchNaming = batch.some((b) => !b.place || b.check !== "ok");
  // Layout, not passive (rider, 2026-09-28: a dropped pin with nothing said
  // about it): the page hears of the change in the same commit that shows
  // it, and its „Pārrēķinu…” chip is painted in that frame — never a frame
  // of a pending point with neither a spinner nor a chip.
  useLayoutEffect(() => {
    const propose = proposeRef.current;
    if (!propose || holdPropose || proposeKey === proposedRef.current) return;
    if (!proposeKey && batchNaming && proposedRef.current) return;
    const had = proposedRef.current !== "";
    proposedRef.current = proposeKey;
    if (proposeKey) { committedRef.current = false; propose(proposedChangeRef.current); return; }
    if (committedRef.current) { committedRef.current = false; return; }
    if (had) propose(null);
  }, [proposeKey, holdPropose, batchNaming]);
  /**
   * The page's answer for the pending change: ✓ spins while it routes
   * (`confirmBusy`) and stays pressable — a press then confirms it when it
   * lands. The map does the rest from the page's `ProposalView`: it relabels
   * a pressed ✓ („Apstiprināšu, tiklīdz būs pārrēķināts”), switches ✓ off on
   * a refusal and says the reason, and its chip is the notice while a
   * proposal is shown — so the composer puts nothing of its own there.
   */
  const proposal = edit?.onPropose && proposedChange ? edit.proposal : undefined;
  const proposalRouting = proposal?.phase === "routing";
  const proposalKey = !proposal ? "" : proposal.phase;
  /** ✓ and ✕ for a previewed change: their words and the spinner. */
  const previewBar = (bar: MapPendingMark): MapPendingMark => (!edit?.onPropose ? bar : {
    ...bar,
    confirmLabel: bar.onConfirm ? t(locale, "previewConfirm") : bar.confirmLabel,
    confirmBusy: proposalRouting,
    cancelLabel: t(locale, "previewCancel"),
  });
  /** The tapped point's name on its sheet — also the field's words while its removal waits. */
  const pointTitle = !pointSel ? "" : pointSel.kind === "shape" ? t(locale, "shapePointName")
    : pointSel.role === "start" ? t(locale, "mapStart")
    : pointSel.role === "finish" ? t(locale, "mapFinish")
    : fi(t(locale, "pointStopTitle"), { n: places.slice(1, pointSel.row + 1).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length });
  const removeHint = pointSel?.phase === "remove" ? `${t(locale, "shapeRemove")}: ${pointTitle}` : null;
  /** How many pass-through points the ride has: „Padarīt caurbraucamu” stops at the cap, saying so. */
  const passCount = edit ? edit.shapePoints.length : liveDots.length;
  useEffect(() => {
    if (!mapLive) { onMapControlsChange?.(null); return; }
    // The batch's own pending state: Confirm all, ↶ the last, ✕ all — and,
    // for a selected pending stop the probe found off the road, the verdict.
    const stopsBefore = batchActive ? places.slice(1, batch[0].row).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length : 0;
    const batchPending = !batchActive ? null : previewBar({
      confirmLabel: batchCommitting || edit?.rerouting ? t(locale, "resEditRouting") : t(locale, "batchConfirmAll"),
      // Editing, live while its stops are still being named: they are
      // committed under their spots and named when the lookups answer.
      onConfirm: (edit ? batch.some((b) => b.check === "off-road") : !batchNamed) || edit?.rerouting || batchCommitting ? null : () => pendingHandlers.current?.confirmBatch(),
      cancelLabel: t(locale, "batchDiscard"),
      onCancel: () => pendingHandlers.current?.discardBatch(),
      undo: { label: t(locale, "batchUndoLast"), onUndo: () => pendingHandlers.current?.undoBatch() },
      count: batch.length,
      offRoad: selectedItem && selectedItem.check === "off-road" ? {
        title: fi(t(locale, "pickOffRoadTitle"), { m: selectedItem.distanceM ?? 0 }),
        moveLabel: t(locale, "pickOffRoadMove"),
        onMove: selectedItem.snappedTo ? () => pendingHandlers.current?.moveSelectedToRoad() : null,
        dismissLabel: t(locale, "batchDropOne"),
        onDismiss: () => pendingHandlers.current?.dropSelected(),
      } : null,
    });
    const batchCount = batch.length === 1 ? t(locale, "batchCountOne") : fi(t(locale, "batchCountMany"), { n: batch.length });
    // A shaping point waiting: Confirm once it has somewhere to go, Cancel
    // at once (a grab with no mark yet is still something to take back).
    const shapeBar = !shapePending ? null : previewBar({
      confirmLabel: t(locale, "pickOnMapConfirm"),
      onConfirm: edit?.rerouting || (shapePending.kind === "add" && !shapePending.to) ? null : () => pendingHandlers.current?.confirmShape(),
      cancelLabel: t(locale, "pickOnMapCancel"),
      onCancel: () => pendingHandlers.current?.cancelShape(),
      offRoad: null,
    });
    // A removal waiting for ✓ (editing with preview): the ride without the
    // point is what the map shows; ✓ takes it out, ✕ keeps it.
    const removeBar = pointSel?.phase !== "remove" ? null : previewBar({
      confirmLabel: t(locale, "previewConfirm"),
      onConfirm: edit?.rerouting ? null : () => pendingHandlers.current?.confirmRemove(),
      cancelLabel: t(locale, "previewCancel"),
      onCancel: () => pendingHandlers.current?.pointClose(),
      offRoad: null,
    });
    const single: MapPendingMark | null = !pendingKey ? null : {
      confirmLabel: checking ? t(locale, "pickOnMapChecking") : t(locale, "pickOnMapConfirm"),
      // Null while the probe is in flight: the button is then disabled and
      // says so, because a press that takes a second and shows nothing reads
      // as a button that does not work.
      // …and while the tapped point is still being named: there is nothing
      // yet for Confirm to commit.
      // Editing, live from the instant the mark lands: routing has already
      // started (a press confirms it when it lands; the name follows).
      onConfirm: checking || (naming && !edit) || !markPreview || edit?.rerouting ? null : () => pendingHandlers.current?.confirm(),
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
    };
    // Editing, a pin's mark is previewed like the rest once it is named.
    const pending = batchPending ?? shapeBar ?? removeBar ?? (single && edit && markPreview ? previewBar(single) : single);
    // Null at the cap rather than a handler that returns: the button is then
    // disabled and says why, and a control that does nothing is never shipped.
    // Through the ref like the other handlers: whether a blank new row is
    // already waiting (`ghostRow`) can change without the rows changing.
    // Not while an edit is being routed: a change committed then was
    // dropped, and its stop left as a pin off the line.
    const onAddStop = atCap || edit?.rerouting ? null : () => pendingHandlers.current?.addStop();
    // With no row active the field is where a new stop starts (backlog 40,
    // rider 2026-09-27: it looked like a search box and a tap did nothing).
    // Focusing it runs „+”'s own path — `addStopFromMap` — and the field,
    // still focused, then searches for the new row. Only in the plain idle
    // state: a batch, a move or a grab has the field say something else.
    // When „+” cannot act (the cap, an edit being routed) the field is off
    // and its words say why.
    const fieldMode = mapFieldMode({ activeRow, batchActive, mapBusy: pointSel?.phase === "move" || pointSel?.phase === "remove" || shapePending?.kind === "move" || Boolean(grab), canAddStop: Boolean(onAddStop) });
    const noRowWords = fieldMode === "new-stop" ? t(locale, "mapNoActiveRow") : atCap ? fi(t(locale, "mapStopCapShort"), { n: MAX_STOPS }) : t(locale, "mapFieldRerouting");
    // ── edit-guidance ── What the selected object is, its mark and colour
    // (as on the map), and the line that says what is happening – what to do
    // (lib/map/edit-guidance.ts).
    const tk = (k: MessageKey) => t(locale, k);
    const selObject: EditObject | null = lineSel ? "line" : !pointSel ? null : pointSel.kind === "shape" ? "pass" : pointSel.role === "via" ? "stop" : pointSel.role;
    const stopNumber = pointSel?.kind === "pin" && pointSel.role === "via" ? places.slice(1, pointSel.row + 1).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length : 0;
    const selMark: ObjectMark | undefined = !selObject ? undefined
      : selObject === "line" ? { kind: "line", color: lineSel?.color ?? OBJECT_COLOR.line }
      : selObject === "stop" ? { kind: "stop", number: stopNumber }
      : { kind: selObject };
    const selName = lineSel ? tk("lineObjectName") : pointTitle;
    const selGuide = selObject && (lineSel?.phase === "menu" || pointSel?.phase === "menu") ? guidance(tk, { kind: "selected", object: selObject, name: selName }) : null;
    const lowerFirst = (w: string) => w.charAt(0).toLocaleLowerCase(locale) + w.slice(1);
    const detailed = (row: MapPointSheetRow, action: Parameters<typeof actionDetail>[1]): MapPointSheetRow => ({ ...row, detail: actionDetail(tk, action, selObject ?? "stop") });
    // ── /edit-guidance ──
    // Release B item 1: a blocked point chosen with „Pārvietot” waits for its new place.
    const blockedSel = selectedItem && blockingNow ? blockingNow.points.find((q) => sameSpot(q, selectedItem)) : undefined;
    const blockMoveWords = blockedSel ? fi(t(locale, "blockMoveHint"), { name: pointLabel(blockedSel) }) : null;
    onMapControlsChange?.({
      pending,
      hint: batchActive ? blockMoveWords ?? insertWords ?? batchCount : removeHint ? removeHint : pointSel?.phase === "move" ? t(locale, "pointMoveHint") : shapePending?.kind === "move" ? t(locale, "shapeMoveHint") : viaWaiting ? t(locale, "lineViaHint") : grab ? insertWords ?? t(locale, "mapGrabHint") : activeRow === null ? noRowWords : fi(t(locale, "mapActiveRowHint"), { label: activeLabel }),
      rowLabel: activeRow === null || batchActive ? undefined : activeLabel,
      // The pin the active row's mark will become, and a stop's number: one
      // more than the filled, numbered stops above it — the order the map
      // numbers stops in (sights carry a glyph, not a number).
      pendingPin: grab ? { role: "shape" as const, number: null } : activeRow === null || batchActive ? undefined : activeRow === 0
        ? { role: "start" as const, number: null }
        : tripType === "one_way" && activeRow === places.length - 1
          ? { role: "finish" as const, number: null }
          : { role: "via" as const, number: (newRow === activeRow ? rowNumbers[activeRow] : null) ?? 1 + places.slice(1, activeRow).filter((_, j) => picked[j + 1] && !picked[j + 1]?.kind).length },
      onAddStop,
      pendingBlocked,
      // At the cap, why „+” is greyed out and the next mark adds nothing —
      // short, on a line of its own; the sentence is its tooltip.
      // While a proposal is shown the map's chip takes this slot (P1-D).
      notice: atCap ? { text: fi(t(locale, "mapStopCapShort"), { n: MAX_STOPS }), title: capSentence } : null,
      // Phase 1 addition: the new point's kind and leg, a moved point's keep / remove.
      choices: !choices.length ? null : choices.map((g) => ({
        ...g,
        options: g.options.map(({ act, ...o }) => ({
          ...o,
          onSelect: () => {
            const h = pendingHandlers.current;
            if ("kind" in act) h?.switchKind(act.kind);
            else if ("leg" in act) h?.chooseLeg(act.leg);
            else if ("wide" in act) h?.wide();
            else if ("straight" in act) edit?.onStraight?.();
            // With the mark still pending, confirmed as ✓ would (the composer
            // lets the mark go); once ✓ already let it go (pressed while it
            // routed), the page commits the armed proposal itself.
            else if ("override" in act) { const confirm = pending?.onConfirm; edit?.onOverride?.(!confirm); confirm?.(); }
            else if ("block" in act) {
              if (act.block === "rest") h?.dropBatchItems(blockedItems.map((b) => b.id));
              else if (act.block === "move" && act.id !== undefined) h?.blockMove(act.id);
              else if (act.block === "remove") { if (act.id !== undefined) h?.dropBatch(act.id); else pending?.onCancel?.(); }
              else if (act.block === "straight") { const b = batch.find((x) => x.id === act.id); if (b) edit?.onStraightAt?.({ lat: b.lat, lon: b.lon }); }
            }
            else h?.moveChoice(act.remove);
          },
        })),
      })),
      addStopLabel: t(locale, "mapAddStop"),
      addStopFullLabel: capSentence,
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
        // The cap is said on its own line (`notice`); the field keeps the count.
        placeholder: batchActive ? blockMoveWords ?? insertWords ?? batchCount : removeHint ? removeHint : pointSel?.phase === "move" ? t(locale, "pointMoveHint") : shapePending?.kind === "move" ? t(locale, "shapeMoveHint") : viaWaiting ? t(locale, "lineViaHint") : grab ? insertWords ?? t(locale, "mapGrabHint") : activeRow === null ? noRowWords : newRow === activeRow && insertWords ? insertWords : t(locale, "mapSearchHint"),
        // The phone's shorter words for the two that were cut off at 320 px.
        placeholderPhone: batchActive || removeHint || shapePending || grab ? undefined
          : pointSel?.phase === "move" ? t(locale, "pointMoveHintShort")
          : activeRow === null ? (fieldMode === "new-stop" ? t(locale, "mapNoActiveRowShort") : undefined)
          : newRow === activeRow && insertWords ? undefined : t(locale, "mapSearchHintShort"),
        disabled: fieldMode === "off",
        onFocus: fieldMode === "new-stop" ? onAddStop : null,
      },
      // The ride's own pins answer the form in planning as in edit mode
      // (rider, 2026-09-25): a press makes that pin's row active, a drag makes
      // the drop point its mark.
      onPinDrag: (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => pendingHandlers.current?.pinDrag(role, index, at),
      onPinPress: (role: "start" | "via" | "finish", index: number) => pendingHandlers.current?.pinPress(role, index),
      activePlace: activeOwn ? { lat: activeOwn.lat, lon: activeOwn.lon } : null,
      // The tapped point: its ring, and its sheet of what can be done to it.
      selectedPoint: selectedAt ?? (lineSel?.phase === "menu" ? { lat: lineSel.spot.lat, lon: lineSel.spot.lon } : null),
      // In the selected object's own colour (edit-guidance).
      selectedColor: selObject ? OBJECT_COLOR[selObject] : undefined,
      guide: selGuide,
      // A removal waiting for ✓ has no sheet: its ✓ / ✕ are the bottom bar's.
      // ── line-sheet ── The line's sheet, and the hint while „Virzīt caur
      // citu vietu” waits for its tap (its ✕ lets the grab go).
      pointSheet: lineSel?.phase === "menu" ? {
        mode: "menu" as const,
        kind: "line" as const,
        // „Ceļa posms · 1,2 km grants” — the road's kind in the title (edit-guidance).
        title: lineSel.heading ? fi(t(locale, "lineSheetTitleKind"), { km: lineSel.km, kind: lowerFirst(lineSel.heading) }) : fi(t(locale, "lineSheetTitle"), { km: lineSel.km }),
        mark: selMark,
        explainer: objectExplainer(tk, "line"),
        guide: selGuide ?? undefined,
        groups: [{ key: "line", rows: lineSheetRows({ shapeCount: passCount, rerouting: Boolean(edit?.rerouting) }).map(({ action, enabled, reason }): MapPointSheetRow => detailed({
          key: action,
          icon: action === "via" ? "via" as const : "addPass" as const,
          label: t(locale, action === "via" ? "lineVia" : "linePassHere"),
          onPress: !enabled ? null : action === "via" ? () => pendingHandlers.current?.lineVia() : () => pendingHandlers.current?.linePass(),
          title: reason === "cap" ? fi(t(locale, "shapeCapNote"), { n: MAX_SHAPE_POINTS }) : reason === "busy" ? t(locale, "resEditRouting") : undefined,
        }, action === "via" ? "via" : "passHere")) }],
        closeLabel: t(locale, "pointSheetClose"),
        cancelLabel: t(locale, "pickOnMapCancel"),
        onClose: () => pendingHandlers.current?.pointClose(),
      } : viaWaiting ? {
        mode: "move" as const,
        // „Virzi posmu – pieskaries vietai, caur kuru braukt.”
        hint: guidance(tk, { kind: "via" }),
        color: OBJECT_COLOR.line,
        closeLabel: t(locale, "pickOnMapCancel"),
        onClose: () => pendingHandlers.current?.pointClose(),
      // ── /line-sheet ──
      // Once the new place is marked, the proposal's chip says what is
      // happening and what to do: one guidance line, never two.
      } : !pointSel || pointSel.phase === "remove" || (pointSel.phase === "move" && proposedChange) ? null : pointSel.phase === "move" ? {
        mode: "move" as const,
        // „Pārvieto „Pietura 2” – pieskaries jaunajai vietai kartē.”
        hint: guidance(tk, { kind: "move", name: pointTitle }),
        color: selObject ? OBJECT_COLOR[selObject] : undefined,
        closeLabel: t(locale, "pickOnMapCancel"),
        onClose: () => pendingHandlers.current?.pointClose(),
      } : {
        mode: "menu" as const,
        title: pointTitle,
        name: pointSel.kind === "pin" ? places[pointSel.row] : undefined,
        mark: selMark,
        explainer: selObject ? objectExplainer(tk, selObject) : undefined,
        guide: selGuide ?? undefined,
        // Groups: move; the kind switch (stop ↔ pass-through, B3); „Izņemt”
        // last and red — never on the start or the finish, which only move.
        groups: pointActions(pointSel, edit ? "edit" : "plan").flatMap((action): { key: string; rows: MapPointSheetRow[] }[] => {
          if (action === "move") return [{ key: "move", rows: [detailed({ key: "move", icon: "move" as const, label: t(locale, "pointMove"), onPress: () => pendingHandlers.current?.pointMove() }, "move")] }];
          if (action === "demote") return [{ key: "kind", rows: [detailed({
            key: "demote", icon: "pass" as const, label: t(locale, "pointDemote"),
            // Off at the pass-through cap, and saying why.
            onPress: passCount >= MAX_SHAPE_POINTS ? null : () => pendingHandlers.current?.pointDemote(),
            title: passCount >= MAX_SHAPE_POINTS ? fi(t(locale, "shapeCapNote"), { n: MAX_SHAPE_POINTS }) : undefined,
          }, "demote")] }];
          if (action === "promote") return [{ key: "kind", rows: [detailed({
            key: "promote", icon: "stop" as const, label: t(locale, "shapePromote"),
            // Off at the stop cap, and saying why.
            onPress: stopCount >= MAX_STOPS || atCap ? null : () => pendingHandlers.current?.pointPromote(),
            title: stopCount >= MAX_STOPS || atCap ? capSentence : undefined,
          }, "promote")] }];
          return [{ key: "remove", rows: [detailed({ key: "remove", icon: "remove" as const, tone: "danger" as const, label: t(locale, "shapeRemove"), onPress: () => pendingHandlers.current?.pointRemove() }, "remove")] }];
        }),
        closeLabel: t(locale, "pointSheetClose"),
        cancelLabel: t(locale, "pickOnMapCancel"),
        onClose: () => pendingHandlers.current?.pointClose(),
      },
      movePreview,
      planLine: planPath,
      // Batch adding: the pending stops, drawn by the map as dashed numbered
      // pins it can select and drag; the camera stays still while it is on.
      batchMode,
      batch: batch.map((b, k) => ({
        id: b.id, lat: b.lat, lon: b.lon, number: rowNumbers[b.row] ?? stopsBefore + k + 1, selected: b.id === batchSel, failing: b.check === "off-road",
        ...(blockedItems.some((x) => x.id === b.id) ? { blocked: true } : {}),
        // Ridden on past a one-way finish, it is the new finish.
        ...(tripType === "one_way" && b.row === places.length - 1 ? { finish: true } : {}),
      })),
      onBatchSelect: (id: number) => pendingHandlers.current?.selectBatch(id),
      onBatchMove: (id: number, at: { lat: number; lon: number }) => pendingHandlers.current?.moveBatch(id, at),
      onBatchDrop: (id: number) => pendingHandlers.current?.dropBatch(id),
      fitToken: fitAsk,
      // ↶ outside a batch: planning's own stack, or the edit history.
      undo: { label: t(locale, "mapUndo"), onUndo: (edit ? edit.canUndo : undo.past.length > 0) ? () => pendingHandlers.current?.undo() : null },
      // Edit mode: the drawn line can be grabbed and moved.
      // Not while a batch is open: its marks may land on the line too, and
      // they are stops of the batch, not points of the line to move.
      // A grab makes a shaping point, not a stop; none past their own cap,
      // where the line is simply not grabbable (nothing offered that does
      // nothing).
      ...(edit ? {
        // Nor while a point is being moved (§3): a tap — or a hold — on the
        // line is then its new place, never a grab.
        onLineGrab: batchActive || edit.shapePoints.length >= MAX_SHAPE_POINTS || pointSel?.phase === "move" || shapePending?.kind === "move" || newPoint?.kind === "pass" ? undefined : (g: { lat: number; lon: number; slot: number }) => pendingHandlers.current?.lineGrab(g),
        grab: grab?.at ?? null,
        shapePoints: batchActive ? [] : shapeDots,
        onShapeDrag: (index: number, at: { lat: number; lon: number }) => pendingHandlers.current?.shapeDrag(index, at),
        onShapePress: (index: number) => pendingHandlers.current?.shapePress(index),
        shapeLabel: t(locale, "shapePointLabel"),
        // ── line-sheet ── A tap on the line opens its sheet (not while a
        // batch is open: its marks are stops, and the map takes them first).
        onLineTap: batchActive ? undefined : (tap: LineSpot & { segmentId: number; km: string; heading: string; color: string }) => pendingHandlers.current?.lineTap(tap),
        lineHoverTip: t(locale, "lineHoverTip"),
        tip: tipOn ? { text: t(locale, "editTip"), closeLabel: t(locale, "pointSheetClose"), onClose: () => pendingHandlers.current?.tipClose() } : null,
        // ── /line-sheet ──
      } : {
        // Planning: the pass-through dots (B1). Pressed, they open the same
        // sheet; they do not drag, and there is no line to grab yet.
        shapePoints: shapeDots,
        onShapePress: (index: number) => pendingHandlers.current?.shapePress(index),
        shapeLabel: t(locale, "shapePointLabel"),
      }),
    });
    // The parent's callback is an inline arrow and is rebuilt every render;
    // listing it would re-report the same controls on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapLive, activeRow, activeLabel, atCap, activeValue, activeConfirmed, anchor, locale, tripType, rowsKey, pendingKey, mapQuery, activeOwn?.lat, activeOwn?.lon, planKey, grab?.at.lat, grab?.at.lon, batchKey, fitAsk, undo.past.length, edit?.canUndo, edit?.rerouting, batchCommitting, shapeKey, stopCount, pointKey, movePreviewKey, proposalKey, proposeKey, passCount, pointTitle, choicesKey, insertWords, rowNumbers.join(","), lineKey, tipOn, blockedItems.map((b) => b.id).join(","), pendingBlocked]);
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
    // Escape is ✕: the one exit, whatever is open.
    if (shapePending || pointSel || lineSel) { leaveTransient(); return; }
    if (batchSel !== null) { setBatchSel(null); return; }
    if (batch.length) { discardBatch(); return; }
    if (activeRow !== null) leaveTransient({ dropMark: true });
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
  const rolesBase = placeRoles({ picked, rowCount: places.length, tripType });
  // While a new point waits among the stops, the ones after it wear their
  // numbers one up (Phase 1 addition) — the map is told each via's.
  const viaRows = places.map((_, i) => i).filter((i) => i > 0 && i < (tripType === "one_way" ? places.length - 1 : places.length) && picked[i]);
  const roles: PlaceRoles = pendingStopRows.size ? { ...rolesBase, viaNumbers: viaRows.map((i) => rowNumbers[i]) } : rolesBase;
  const rolesKey = [
    roles.viaNumbers ? `n:${roles.viaNumbers.join(",")}` : "n:-",
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
      confirm: confirmPick, cancel: () => leaveTransient({ dropMark: true }), move: acceptOffRoadMove, dismiss: () => setOffRoad(null), pinDrag: dragPin, addStop: addStopFromMap, pinPress: pressPin, lineGrab: grabLine,
      lineTap: tapLine, lineVia, linePass, tipClose: () => setTipOn(false),
      shapeDrag: dragShape, confirmShape, cancelShape, shapeRemove: removeShape, shapePromote: promoteShape,
      shapePress: pressShape, pointClose: () => leaveTransient(), pointMove: movePoint,
      pointRemove: askRemove, confirmRemove,
      pointPromote: () => { if (pointSel?.kind === "shape") promoteShape(pointSel.index); },
      pointDemote: () => { if (pointSel?.kind === "pin") demoteStop(pointSel.row); },
      confirmBatch, discardBatch,
      undoBatch: () => { const last = batch[batch.length - 1]; if (last) dropBatchItem(last.id); },
      selectBatch: (id: number) => setBatchSel((sel) => (sel === id ? null : id)),
      moveBatch: (id: number, at: { lat: number; lon: number }) => { moveBatchItem(id, at.lat, at.lon); setBatchSel(null); },
      dropBatch: dropBatchItem,
      dropBatchItems,
      blockMove: (id: number) => setBatchSel(id),
      moveSelectedToRoad: () => { if (selectedItem?.snappedTo) { moveBatchItem(selectedItem.id, selectedItem.snappedTo.lat, selectedItem.snappedTo.lon); setBatchSel(null); } },
      dropSelected: () => { if (selectedItem) dropBatchItem(selectedItem.id); },
      undo: undoStep,
      switchKind: switchNewKind,
      wide: () => edit?.onWide?.(),
      chooseLeg,
      moveChoice: (remove: boolean) => { if (remove !== removeMoved) setMoveRemove(remove ? moveKey : null); },
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
    // The pass-through points ride along (B1): the dots on the planning map —
    // stops made „caurbraucami” here, and those of a ride reopened here —
    // each after the place it follows, the way the generator reads them
    // (`interleaveShapes`). A dot whose place has left the rows is not on the
    // map and is not planned. Absent when there are none, so a plan without
    // them encodes exactly as before.
    const base = composeRidePlan({ places: rows, tripType, durationMode, hours: value, profile: effectiveProfile });
    const shapes = planShapePoints(rows, planDots, tripType === "one_way", MAX_SHAPE_POINTS);
    const plan: RidePlan = shapes.length ? { ...base, shapePoints: shapes } : base;
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
          onPickOnMap={onPickModeChange ? (i) => { openMapFullscreen(); startPicking(i); } : undefined} activeRow={mapShown ? activeRow : null} preview={preview}
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
          onAddStop={edit || mapLive ? () => { openMapFullscreen(); addStopFromMap(); } : undefined} />

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
