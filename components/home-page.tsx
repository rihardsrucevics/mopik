"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { RouteMap, type MapControls } from "@/components/route-map";
import { mapWiring } from "@/lib/map/map-wiring";
import { editNotice } from "@/lib/map/batch-commit";
import { RoutePrompt } from "@/components/route-prompt";
import { ResultPanel } from "@/components/result-panel";
import type { DetourFocusNote, SelectedPoi } from "@/components/suggestions-card";
import { InstallPrompt } from "@/components/install-prompt";
import { MapPanel } from "@/components/map-panel";
import { track } from "@/lib/analytics";
import { decodePlanPlaces, decodePlanShare } from "@/lib/share/route-code";
import { isCodeSaved, removeRide, rideId } from "@/lib/share/saved-rides";
import { IntroSplash } from "@/components/intro-splash";
import { SiteHeader } from "@/components/site-header";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages as uiMessages, type MessageKey } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { RideComposer } from "@/components/ride-composer";
import { ChatMessage, ChatQuickReply, ChatResponse, RidePlan, planSummary, planToIntent } from "@/lib/chat/ride-plan";
import { describeInfeasible, describeUnplannable, minutesLabel } from "@/lib/chat/feasibility";
import { seedPlanFromProfile } from "@/lib/chat/ride-profile";
import { planForFullSearch } from "@/lib/chat/compose-plan";
import type { ResolvedPlace } from "@/lib/chat/places";
import { useRideProfile } from "@/lib/chat/use-ride-profile";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { GenerateRouteResponse, type DirectLegOffer, type UnreachableStop } from "@/lib/types";
import { POI_KIND, type RoutePoi } from "@/lib/poi/kinds";
import { describeDetourForFocus } from "@/lib/routing/use-detours";
import { spliceDetours, type DetourResult } from "@/lib/routing/detour";
import { useRoutePois } from "@/lib/poi/use-route-pois";
import { useMapLayer } from "@/lib/map/layer-prefs";
import type { SplicedRoute } from "@/lib/routing/detour";
import {
  NO_EDITS,
  anchorsOf,
  applyRuns,
  applyShapeEdit,
  asGeneratedRoute,
  isShape,
  mergeShapes,
  mergeAddedInOrder,
  nearestAlong,
  shapesOf,
  stopsOf,
  coordinatesOf,
  insertStopsByAlong,
  joinsFor,
  placesFromRide,
  placesFromRows,
  planEdit,
  shapeFlags,
  planWithPlaces,
  pushEdit,
  recomputeOverlap,
  resolvedOf,
  rowsOf,
  snapToLine,
  spanRun,
  spanEnds,
  lineBreaks,
  spliceIsSound,
  throughBlockedPlaces,
  summariseSegments,
  undoEdit,
  widenRun,
  anchorsAlong,
  LOOP_EXTRA_FLOOR_M,
  WIDEN_MIN_SPUR_M,
  WIDEN_STEPS_M,
  type EditRun,
  type EditHistory,
  type EditKind,
  type EditPlan,
  type EditedRide,
  type RidePlace,
  type RoutedRun,
  type RidePlaces,
  type ShapeEdit,
} from "@/lib/routing/reroute-leg";
import { cumulative, lineMeters, pointAtDistance } from "@/lib/routing/detour";
import {
  IDLE_PROPOSAL,
  editDelta,
  mayCommit,
  proposalReducer,
  type EditProposal,
  type ProposalAction,
  type ProposalState,
  type ProposedChange,
  type ProposalView,
  type Segments,
} from "@/lib/map/edit-proposal";
import { markOutsideProfile, farthestFrom, detourRisk, reachOf, deadEndNoteKey } from "@/lib/map/edit-reach";
import { NO_CHAIN, chainCount, chainTopOf, inheritWarning, popChain, shownProposal, stackOnto, type EditChain } from "@/lib/map/edit-chain";
import { blockingFrom, singleCause, type Blocking, type BlockingPoint, type PointProbe } from "@/lib/map/blocking";
import { drawnIntervals, straightRun } from "@/lib/map/straight";
import { drawnMeters } from "@/lib/routing/drawn";
import { profileAt, type RelaxDrop } from "@/lib/routing/relax";
import { buildMotoProfileOptions } from "@/lib/routing/moto-profile";
import { bendMissed, changeKey, changedAlong, isKindSwitch, NOTE_JOINER, proposalView, proposeDelay, staleWhileRouting, newStretches, wideNeedsAsking, renamePlaces, renamesBetween, sameGeometry, type Renames } from "@/lib/map/proposal-view";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import type { PlaceRoles } from "@/lib/map/place-roles";
import type { RideEdit } from "@/components/ride-composer";
import { MOVE_OFFER_MAX_M } from "@/lib/routing/routable-point";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { LoaderCircle } from "lucide-react";
// „Labot” opens the phone map full screen first: inline it is a preview.
import { openMapFullscreen } from "@/lib/map/fullscreen";
import { passOnLine } from "@/lib/map/line-sheet";
import { joinGuide, proposalGuide, blockedGuide, blockedLine, guideAction, sightAddedLine, sightReachLine, sightRefusedLine, tickedCount, tickedGuide } from "@/lib/map/edit-guidance";
import { metersToLine, rowsWithSight, sightReach } from "@/lib/map/sight-add";

/** A proposal ready to land, with what `live.landed` records for its commit. */
type Landing = { proposal: EditProposal; addedAt: number; runs: number };
/** What a proposal's points are probed with when it is refused or warned (release B item 1). */
type BlockCtx = { token: number; before: RidePlaces; planned: EditPlan; line: Point[]; baseSegments: Segments; nextPlan: RidePlan; asked: Point[]; baseMeters: number };
/** What `/api/reroute-leg` answers per run. */
type RoutedRuns = { runs: (RoutedRun & { deadEndMeters?: number; deadEndUnchecked?: boolean; deadEndAtShape?: boolean; deadEndProved?: boolean })[] };

/** The words for what a relaxed profile rung drops (`relaxedProfiles`), in the warning's list. */
const RELAX_WORDS: Record<RelaxDrop, "relaxMainRoads" | "relaxMotorways" | "relaxSand" | "relaxTowns" | "relaxRough" | "relaxAccess" | "relaxCar"> = {
  mainRoads: "relaxMainRoads", motorways: "relaxMotorways", sand: "relaxSand", towns: "relaxTowns", rough: "relaxRough", access: "relaxAccess", car: "relaxCar",
};

type Retry = { stage: "chat"; messages: ChatMessage[]; plan: RidePlan | null } | { stage: "route"; messages: ChatMessage[]; plan: RidePlan };

/**
 * A message a rider can forward. Browser DOM errors (Safari: "The string did
 * not match the expected pattern") carry no context on their own, so the
 * error name and the first stack frame are appended for anything that is not
 * one of our own messages.
 */
/**
 * The API answers JSON; the platform does not. A killed function (Vercel's
 * 60 s cap) or a gateway error comes back as an HTML page, which `.json()`
 * turns into a cryptic SyntaxError. Read the text, then decide.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the API's shapes are checked where they are used
async function readJson(response: Response, ui: ReturnType<typeof uiMessages>): Promise<any> {
  const text = await response.text();
  try { return JSON.parse(text); }
  catch {
    const timedOut = response.status === 504 || /timeout|timed out/i.test(text);
    throw new Error(timedOut || response.status >= 500
      ? ui.chatServerTimeout
      : fi(ui.chatErrUnexpected, { status: response.status }));
  }
}

/**
 * One step easier than `plan`, or null when it is as easy as it goes: known
 * roads only (`accessPolicy: verified`, which alone routed the ride that
 * prompted this), one grade easier, one step fewer trails.
 */
function easierPlan(plan: RidePlan): RidePlan | null {
  const difficulty = plan.difficulty === "hard" ? "adventure" : plan.difficulty === "adventure" ? "easy" : plan.difficulty;
  const trailPreference = plan.trailPreference === "lots" ? "some" : plan.trailPreference === "some" ? "none" : plan.trailPreference;
  if (plan.accessPolicy === "verified" && difficulty === plan.difficulty && trailPreference === plan.trailPreference) return null;
  return { ...plan, accessPolicy: "verified", difficulty, trailPreference };
}

function describeError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const ours = /[āčēģīķļņšūž]|Neizdev|Tell us|couldn't|route/i.test(e.message) && e.name === "Error";
  if (ours) return e.message;
  const frame = e.stack?.split("\n").find((l) => /@|at /.test(l))?.trim().slice(0, 80);
  console.error("Mopik: request failed", e);
  return `${fallback} (${e.name}: ${e.message}${frame ? ` — ${frame}` : ""})`;
}
/**
 * The POI kind for a stop, matched on the place's own name.
 *
 * A via's `label` is the disambiguating one the picker showed — "Turaida ·
 * Krimuldas pagasts" — while the dataset names the place "Turaida". Comparing
 * the whole string therefore never matched, and every stop's card said only
 * "Pieturvieta". The leading segment is the name in both.
 */
function stopKind(
  kinds: Record<string, { kind: string }>,
  label: string
): { kind: string } | undefined {
  return kinds[label] ?? kinds[label.split("·")[0].trim()] ?? kinds[label.split(",")[0].trim()];
}

/**
 * A monotonic stopwatch for the analytics, outside the component.
 *
 * `performance.now()` inside an `async function` declared in the component
 * body reads as a render-phase call to `react-hooks/purity`, which cannot see
 * that the body runs after an await. The call is genuinely not a render — it
 * happens when the rider confirms an edit — so the honest fix is to move it out of
 * the component rather than to silence the rule at the call site, where the
 * suppression would also cover whatever was written there later.
 *
 * It measures how long an edit took from Confirm to the new line on screen,
 * which is the number this whole feature exists to change: "far too long" was
 * the complaint, and an event that carries the milliseconds is how it stays
 * answered.
 */
function elapsedMsSince(start: number): number {
  return Math.round(performance.now() - start);
}
function startClock(): number {
  return performance.now();
}

/**
 * The live proposal's own facts, beside the reducer's state: which change it
 * is (`changeKey`, so ✓ can tell it is the same one), the line and ride it
 * was cut from, and — once landed — what the commit needs.
 */
type LiveProposal = {
  token: number;
  key: string;
  base: Segments;
  routeId: string;
  landed: { addedAt: number; runs: number; startedAt: number } | null;
  /** The change as last sent, and the names it has had since it was routed (a pin named after it was dropped). */
  change: ProposedChange;
  renames: Renames;
};
/** A ✓ pressed before its proposal landed: answered when it lands or is refused. */
type CommitWaiter = { token: number; resolve: (ok: boolean) => void; keepOnFailure: boolean; pressedAt: number };

/**
 * Is this picked place the one the refusal is about?
 *
 * **Coordinates first, the name only as a fallback.** The verdict carries the
 * `lat`/`lon` it actually tried to route to, and that is the one key that
 * cannot be ambiguous: a ride may hold the same name twice (a stop and the
 * finish both "Sigulda"), and removing the wrong one would take out a place
 * the rider can reach and leave the one he cannot.
 *
 * ~11 m of tolerance — a shade under 1e-4 degrees. The coordinate makes a
 * round trip through JSON and back, and a ride's places are never that close
 * together, so this is loose enough to survive the encoding and far too tight
 * to catch a neighbouring stop.
 *
 * The name is tried only when no coordinate matches, for the place the rider
 * typed rather than picked: those reach `places` without having been geocoded
 * on this client, so there may be no coordinate to compare.
 */
function matchesStop(place: ResolvedPlace, name: string, stop: UnreachableStop): boolean {
  const near = Math.abs(place.lat - stop.lat) < 1e-4 && Math.abs(place.lon - stop.lon) < 1e-4;
  if (near) return true;
  const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  const key = fold(name);
  return fold(place.name) === key || fold(place.label) === key;
}

export function HomePage() {
  const [entryMode, setEntryMode] = useState<"form" | "chat">("form");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<RidePlan | null>(null);
  const [result, setResult] = useState<GenerateRouteResponse | null>(null);
  /**
   * The direct road the API offered when it refused a segment (backlog item
   * 7b), waiting for the rider to ask for it by name.
   *
   * Held rather than shown: the offer is a tap, never a substitution. It is
   * also held rather than re-fetched, because the client would have to ask
   * with the ride's own profile and that profile is measured never to answer
   * these legs at all (Berlin → Warszawa: null after 91 s).
   */
  const [directOffer, setDirectOffer] = useState<DirectLegOffer | null>(null);
  /** True while the panel is showing that road rather than a planned ride. */
  const [showingDirect, setShowingDirect] = useState(false);
  /**
   * The `intent` and `start` the refusal carried, so the offer can be shown
   * as a real result. A ref rather than state: nothing renders from it until
   * the rider taps, and `showDirectLeg` reads it outside a render.
   */
  const unplannableContextRef = useRef<GenerateRouteResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "thinking" | "routing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Retry | null>(null);
  // Both map layers are remembered on the device now. TET was a plain
  // `useState(false)` and forgot the rider's answer on every visit; the rider
  // asked for the new sights switch to persist "like the TET toggle does", so
  // the honest reading was to give them one store — see `lib/map/layer-prefs`.
  const [showTet, setShowTet] = useMapLayer("tet");
  const [showSights, setShowSights] = useMapLayer("sights");
  const [quickReplies, setQuickReplies] = useState<ChatQuickReply[]>([]);
  // Which of the three versions (direct / balanced / complex) is on the map.
  const [selected, setSelected] = useState(0);
  // After a correction is typed the left column becomes the chat until new
  // routes arrive; otherwise it shows the result. Never both at once.
  const [chatting, setChatting] = useState(false);
  // Start only, round trip, no stops, flexible time: the rider wants to be
  // surprised. The loader and the result say so, and the deepest version leads.
  const [lucky, setLucky] = useState(false);
  // Phone only: the map over the whole screen, on request.
  // Places picked in the form, with coordinates; sent with every generation
  // so chat corrections keep pointing at the same towns.
  const [places, setPlaces] = useState<ResolvedPlace[]>([]);
  /**
   * Places confirmed in the form but not yet routed, **as roles**: the map
   * shows them so a wrong "Valmiera" is caught before a generation is spent on
   * it, and each one wears the pin of the row it came from.
   *
   * Roles rather than a flat list, because the flat list could not say which
   * pin belonged to which place and the map guessed by position. With an empty
   * start row that guess promoted the first stop to the start and the last to
   * the finish — the rider's own production screenshot, four stops drawn as a
   * complete ride he had not asked for. The composer knows every row's role
   * whether or not it is filled; now it says so. See `lib/map/place-roles.ts`.
   */
  const [preview, setPreview] = useState<PlaceRoles>({ start: null, vias: [], finish: null });
  /** Every confirmed place, for the questions that are about the set and not the roles. */
  const previewPlaces = useMemo(
    () => [preview.start, ...preview.vias, preview.finish].filter((p): p is ResolvedPlace => Boolean(p)),
    [preview],
  );
  /**
   * A row in the form is waiting for a point on the map.
   *
   * Here rather than in the composer for the reason `focusPoi` is: the page
   * owns the one MapLibre instance and everything it is handed. The composer
   * says when a row is waiting; this decides what the map does about it.
   */
  const [picking, setPicking] = useState(false);
  /**
   * The point the rider tapped, or dragged the marker to, with a token that
   * rises on every gesture. The token is what makes tapping the same spot
   * twice two answers — coordinates alone would make the second tap a no-op,
   * which is wrong after the marker has been dragged away and back.
   */
  const [pickPoint, setPickPoint] = useState<{ lat: number; lon: number; token: number } | null>(null);
  /**
   * The last gesture token handed out. A counter of its own rather than "the
   * previous point's plus one": a seeded marker carries token 0, and counting
   * on from it handed the next tap a token an earlier tap had already had —
   * the form then took that gesture for one it had already named.
   */
  const gestureRef = useRef(0);
  const takePoint = useCallback((p: { lat: number; lon: number }) => {
    gestureRef.current += 1;
    const token = gestureRef.current;
    setPickPoint({ ...p, token });
  }, []);
  /** Where to take the map when pick mode opens, with its own re-fly token. */
  const [pickCenter, setPickCenter] = useState<{ lat: number; lon: number; token: number; fit?: { lat: number; lon: number }[] } | null>(null);
  /**
   * The planning map's own header bar, as the form reports it.
   *
   * The form builds it — it knows which row is active, what that row is called
   * in the rider's language, how many rows the ride has — and the page relays
   * it to the map. One value carries the hint, the "+ Pietura" button and the
   * search field, so what the header says and what a tap does are switched on
   * together and cannot disagree. That disagreement is the whole bug this
   * replaced: a tap meant "fill row X" or "make a new stop" depending on state
   * nothing on screen reported.
   */
  const [mapControls, setMapControls] = useState<MapControls | null>(null);
  /**
   * Pick mode opening or closing, as the composer reports it.
   *
   * Opening a row that already has a place seeds the draggable marker there,
   * so "mana lokācija → pavilkt → Apstiprināt" has something to drag from the
   * first frame. Opening an empty row seeds nothing: a marker the rider did
   * not put anywhere is a place he did not choose.
   */
  const changePickMode = useCallback((on: boolean, open?: { at: { lat: number; lon: number } | null; marker: { lat: number; lon: number } | null; lookup?: boolean; fit?: { lat: number; lon: number }[] }) => {
    setPicking(on);
    if (!on) { setPickPoint(null); setPickCenter(null); return; }
    // Token 0 on the seed: the form already knows this place by name (it is
    // the row's own), so the marker appears without spending a reverse lookup
    // re-deriving a name it would then have to reconcile with the one shown.
    // A drag or a tap raises the token and the lookup runs then — and so does
    // a ride pin dragged in edit mode (`lookup`), which is a gesture too.
    const marker = open?.marker ?? null;
    if (marker && open?.lookup) gestureRef.current += 1;
    setPickPoint(marker ? { ...marker, token: open?.lookup ? gestureRef.current : 0 } : null);
    setPickCenter(open?.at ? { ...open.at, token: Date.now(), ...(open.fit ? { fit: open.fit } : {}) } : null);
  }, []);
  /**
   * The suggestion the rider pressed "Kartē" on, if any.
   *
   * Lives here rather than in the result panel because the map does — the same
   * reason `variantOffset` moved up. `token` rises on every press so pressing
   * the same row twice flies back to it after a pan; comparing the place
   * itself would make the second press do nothing.
   */
  const [focusPoi, setFocusPoi] = useState<{
    lat: number; lon: number; label: string; kind?: string; token: number;
    /** The dataset row behind the ring, so the card's tick selects the same
     *  place the list's tick does — by id, not by name. */
    poi?: SelectedPoi;
    /** Whether that place is currently ticked, so the card can say so. */
    picked?: boolean;
    /** What the list's row says this place costs, so the card says the same. */
    detour?: DetourFocusNote | null;
    /** „Pievienot braucienam” pressed, its detour still routing (backlog 46). */
    adding?: boolean;
  } | null>(null);
  const focusTokenRef = useRef(0);
  const clearFocusPoi = useCallback(() => setFocusPoi(null), []);
  /**
   * The sights the rider has ticked but not yet asked for.
   *
   * Here rather than in the result panel for two reasons the rider can see.
   * The map draws a marker for each, so the map's owner must own the list.
   * And `startFromForm` calls `setResult(null)`, which unmounts the panel for
   * the length of a generation — a selection kept inside it would be thrown
   * away by the very press meant to act on it.
   *
   * Cleared when the ride it was ticked against is replaced (see
   * `regenerateWithSelection`): the new ride has its own suggestions, and
   * marks left over from the previous one would point at places the new
   * route may not go near.
   */
  const [selectedPois, setSelectedPois] = useState<SelectedPoi[]>([]);
  /**
   * The ride with the ticked sights' detours spliced into it, or null while
   * nothing is ticked.
   *
   * Here for the same reason the ticks themselves are: the map draws it, so
   * the map's owner holds it. The result panel computes it — it is the thing
   * that knows which suggestions loaded and which are ticked — and reports it
   * up through `onSplicedChange`.
   */
  /**
   * A splice belongs to the ride it was computed against, so it is *stored*
   * with that ride and read only when the two still match.
   *
   * Not cleared in an effect on `result`. That was the obvious shape and it is
   * the one React warns about — a setState in an effect body costs a second
   * render pass, and for one frame after a new ride arrived the map would
   * still be drawing the old ride's spliced line. Carrying the owner alongside
   * makes the staleness unrepresentable instead of merely short-lived: a
   * splice from a replaced ride simply is not read.
   */
  const [splicedFor, setSplicedFor] = useState<{
    result: GenerateRouteResponse | null;
    spliced: SplicedRoute | null;
  }>({ result: null, spliced: null });
  const spliced = splicedFor.result === result ? splicedFor.spliced : null;
  const handleSplicedChange = useCallback(
    (next: SplicedRoute | null) => setSplicedFor({ result, spliced: next }),
    [result],
  );
  /**
   * The ride as the rider has changed it — ticked sights kept without a
   * search, places moved, added or taken out in edit mode — with one step of
   * undo (`lib/routing/reroute-leg.ts`, `EditHistory`).
   *
   * Carried with the ride it belongs to, exactly as `splicedFor` is and for
   * the same reason: a new generation, or another version picked, must not
   * leave an old edit drawn over it, and answering that in an effect costs a
   * render during which the map shows the wrong line. `original` is the plan
   * and the picked places as they were before the first edit, so undoing back
   * to the API's own ride puts those back too.
   *
   * Nothing is re-scored or re-ranked. An edited ride is the rider's line and
   * the panel says so out loud ("Labots ar roku") with its retraced share
   * recomputed. "Never substitute silently" runs in both directions — Mopik
   * does not pass an edit off as its own search, and does not quietly undo one.
   */
  const [editsFor, setEditsFor] = useState<{
    routeId: string | null;
    history: EditHistory;
    original: { plan: RidePlan; places: ResolvedPlace[] } | null;
  }>({ routeId: null, history: NO_EDITS, original: null });
  /**
   * "Labot" was pressed: the left column is the form's rows editing the ride,
   * and the map is wired the way planning wires it (`mapWiring`'s `editing`).
   */
  const [editMode, setEditMode] = useState(false);
  /**
   * Preview before commit (docs/DESIGN-route-editing.md B4): the pending
   * change's proposal, through `proposalReducer`. Held in a ref as well as
   * in state so the async routing reads the state it just dispatched
   * (`dispatchProposal` returns it) — ✓ pressed while routing is carried as
   * `confirmNow` on the landed state and committed right there.
   */
  const proposalRef = useRef<ProposalState>(IDLE_PROPOSAL);
  const [proposal, setProposal] = useState<ProposalState>(IDLE_PROPOSAL);
  const dispatchProposal = (action: ProposalAction): ProposalState => {
    const next = proposalReducer(proposalRef.current, action);
    if (next !== proposalRef.current) { proposalRef.current = next; setProposal(next); }
    return next;
  };
  /** The last token issued; an answer under any other is stale and dropped. */
  /** „Pārrēķināt posmu” on offer: the refused change it would re-route as a whole span (`askWide`). */
  /** „Tomēr braukt” pressed: the token of the warned proposal it may commit (`mayCommit`). */
  const overrideArmed = useRef<number | null>(null);
  /** „Vest pa taisno” on offer: the refused change no road reaches (`askStraight`). */
  const [straightAsk, setStraightAsk] = useState<{ token: number; change: ProposedChange; level: number } | null>(null);
  const [wideAsk, setWideAsk] = useState<{ token: number; change: ProposedChange } | null>(null);
  /**
   * Release B item 1: which point stops the proposal — named in the
   * guidance line, ringed on the map, fixed per point (lib/map/blocking.ts).
   * `blockCtx` is what the probes need, kept from the proposal's routing.
   */
  const [blocking, setBlocking] = useState<Blocking | null>(null);
  const blockCtx = useRef<BlockCtx | null>(null);
  /**
   * Release B item 4: several edits chained before one ✓ (rider,
   * 2026-09-28, images/29–30). Each landed proposal the rider builds on is
   * stacked here — not in the ride, not in the undo — and the next edit is
   * routed on top of it, so the preview carries every pending change and its
   * chip the total against the committed ride. ✓ commits the top (which
   * holds them all) as ONE undo step; ↶ takes the last pending change off;
   * ✕ drops them all (lib/map/edit-chain.ts).
   */
  const [chainState, setChainState] = useState<EditChain>(NO_CHAIN);
  const chainRef = useRef<EditChain>(NO_CHAIN);
  const setChain = (next: EditChain) => { chainRef.current = next; setChainState(next); };
  const proposalSeq = useRef(0);
  const live = useRef<LiveProposal | null>(null);
  const proposalAbort = useRef<AbortController | null>(null);
  const proposeTimer = useRef<{ timer: ReturnType<typeof setTimeout>; run: () => void } | null>(null);
  const lastProposeAt = useRef<number | null>(null);
  const commitWaiter = useRef<CommitWaiter | null>(null);
  /** ✓ was pressed and its change is still routing: the editor holds still until it lands. */
  const [committing, setCommitting] = useState(false);
  // Nothing routes for a page that is gone.
  useEffect(() => () => {
    if (proposeTimer.current) clearTimeout(proposeTimer.current.timer);
    proposalAbort.current?.abort();
  }, []);
  /** What went wrong with the last edit, shown once and cleared by the next one. */
  const [editNote, setEditNote] = useState<string | null>(null);
  // ── sights-add ── (backlog 46)
  /** What adding a sight on a plain result did, said on the map („Vatrāne – tuvākais ceļš ~100 m…”). */
  const [sightNote, setSightNote] = useState<string | null>(null);
  /** A sight added in edit mode: its proposal's token, and how far the ride was from it before. */
  const sightAsk = useRef<{ token: number; name: string; lat: number; lon: number; lineMeters: number } | null>(null);
  /** A sight added on a result before its detour was routed: added the moment it is. */
  const [sightWaiting, setSightWaiting] = useState<SelectedPoi | null>(null);
  // The detour arrived for a sight waiting on it: added now, as pressed.
  // Through a ref, as `renameRef` is: the function is this render's.
  const addSightRef = useRef<(poi: SelectedPoi) => void>(() => {});
  // ── /sights-add ──
  /**
   * Re-reads the editor's rows from the ride — after an undo, after an edit
   * the router refused (the ride keeps its places), and after a new stop was
   * put where the line meets it. `active` is the row the map should answer
   * next, when the rows moved under it.
   */
  const [seed, setSeed] = useState<{ token: number; active?: number }>({ token: 0 });
  const reseed = (active?: number) => setSeed((prev) => ({ token: prev.token + 1, active }));
  /**
   * The ride as it stood when "Labot" was pressed — its edits, plan and
   * places — so "Atcelt labošanu" can put all of it back at once. Separate
   * from the one-step undo: that walks back the last change, this abandons
   * the whole session, however many changes it made.
   */
  const [editEntry, setEditEntry] = useState<{
    editsFor: typeof editsFor;
    plan: RidePlan | null;
    places: ResolvedPlace[];
  } | null>(null);
  // Which ride each category is currently showing. The card's ⟳ control moves
  // this, and the map reads it too — the state used to live inside the result
  // panel, so cycling a card changed its numbers and left the map on the old
  // line. One source, one truth.
  const [variantOffset, setVariantOffset] = useState<Record<string, number>>({});
  // Memoised because the edited ride and the map's pins are derived from it,
  // and a ride object rebuilt every render would rebuild all of them too.
  const route = useMemo(() => {
    const card = result?.routes[Math.min(selected, (result?.routes.length ?? 1) - 1)] ?? null;
    if (!card) return null;
    const family = [
      ...(result?.routes ?? []).filter((r) => r.variant === card.variant),
      ...(result?.alternatives ?? []).filter((r) => r.variant === card.variant),
    ];
    return family[(variantOffset[card.variant] ?? 0) % Math.max(1, family.length)] ?? card;
  }, [result, selected, variantOffset]);
  /** The edits made to the ride on screen — none when the ride is another one. */
  const history = route && editsFor.routeId === route.id ? editsFor.history : NO_EDITS;
  const edited = history.current;
  /** The chain on this ride, if any (another ride's is not this one's). */
  const chainOn = route && chainState.routeId === route.id ? chainState : NO_CHAIN;
  const chainTop = chainTopOf(chainOn);
  /**
   * The ride on screen, edited or not, in the one shape every consumer reads.
   *
   * The panel's numbers, the share code, a save, the GPX and the map all take
   * this, so an edit reaches every one of them by construction rather than by
   * each remembering to look for it — the old shape threaded `edited` through
   * the panel field by field, and the share code and the save were the two
   * that forgot.
   */
  const shownRoute = useMemo(() => (route && edited ? asGeneratedRoute(route, edited) : route), [route, edited]);
  /**
   * The ride's places by role — the edit's when there is one, the API's
   * otherwise, with the plan's own names. What the editor's rows are seeded
   * from, what an edit is diffed against, and what the map's pins show.
   */
  const ridePlaces = useMemo(() => {
    if (edited) return edited.places;
    if (!result || !plan) return null;
    return placesFromRide({ plan, start: result.start, via: result.via ?? [], destination: result.destination ?? null, picked: places });
  }, [edited, result, plan, places]);
  /**
   * Whether this ride can be edited on its map. Not the direct road offered
   * after a refusal (a car route, not a ride to correct), and not a remote
   * loop, whose transit → loop → transit split is the search's own structure
   * and would stop describing the ride after the first moved stop.
   */
  const canEdit = Boolean(result && shownRoute && ridePlaces && plan && !showingDirect && !result.remoteLoop);
  /** What the editor works on: the chain's top while edits are chained, else the ride. */
  const workingPlaces = chainTop?.ride.places ?? ridePlaces;
  /**
   * The routed detours the result panel prefetched  /**
   * The routed detours the result panel prefetched, so a marker's card can
   * state the same cost the list's row does. Empty until the prefetch answers,
   * and on the shared page's terms: it is only ever read through
   * `describeDetourForFocus`, which returns null for a place it has no entry
   * for.
   */
  const [detoursForMap, setDetoursForMap] = useState<Record<string, DetourResult>>({});
  // ── sights-add ── the waiting sight is added once its detour is here.
  useEffect(() => {
    if (sightWaiting && !editMode && detoursForMap[sightWaiting.id]) addSightRef.current(sightWaiting);
  }, [sightWaiting, editMode, detoursForMap]);
  const toggleSelectPoi = useCallback((poi: SelectedPoi) => {
    setSelectedPois((current) =>
      current.some((p) => p.id === poi.id) ? current.filter((p) => p.id !== poi.id) : [...current, poi],
    );
  }, []);
  const clearSelectedPois = useCallback(() => setSelectedPois([]), []);
  /**
   * Escape drops the ticks, the way it closes everything else on the page.
   *
   * Bound once and guarded on the list being non-empty, so the key keeps its
   * ordinary meaning (blurring a field, closing the map's card) whenever
   * there is no selection to clear.
   */
  useEffect(() => {
    if (selectedPois.length === 0) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelectedPois([]); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedPois.length]);
  /**
   * Adding the place the map card is currently showing.
   *
   * The card is drawn by MapLibre from a string, so it cannot carry a closure
   * of its own; it calls this, which reads the focused place from state. The
   * ring and the card go away first — the ride is about to be re-planned, and
   * a "look at this" marker left over the new route would claim the place was
   * still only a suggestion.
   */
  // Declared further down, after `plan` and `startFromForm` exist; `addStop` is
  // an ordinary function of this render, so `addFocusedPoi` can close over it
  // directly. It does not need to be stable: the map holds it in a ref of its
  // own and re-reads it per click, so a new function each render costs nothing
  // and never rebuilds the card the rider is looking at.

  /**
   * The ride the rider arrived from, when they came from one: ui.saveEditForm
   * on a saved ride, or the "Ko mainīt?" box on a shared one. It is the way back to that
   * route until a new one is generated, and it decides what happens to the
   * original afterwards — kept alongside the new ride, or replaced by it.
   */
  const [origin, setOrigin] = useState<{ code: string; saved: boolean } | null>(null);
  // `generate` reads this after an await, by which time its closure's copy of
  // `origin` may be a render behind. The ref is the current answer.
  const originRef = useRef<{ code: string; saved: boolean } | null>(null);
  /**
   * The correction typed in the "Ko mainīt?" box on a shared ride's own page,
   * carried here in `?ask=`. A ref, not state: it is read once, by the render
   * that first has the plan, and setting it must not cost a render of its own.
   */
  const askRef = useRef<string | null>(null);
  /**
   * `?go=1`: the plan that arrived in `?p=` is to be generated at once, with
   * no stop in the form.
   *
   * This is what "Pievienot" on a shared or saved ride's Ieteikumi sends. The
   * rider has already pressed the button that means "plan it again through
   * here" — landing him in a pre-filled form to press Generate a second time
   * would be asking the same question twice. A ref for the same reason
   * `askRef` is one: it is read once, by the render that first has the plan,
   * and setting it must not cost a render.
   */
  const goRef = useRef(false);
  // A ride generated from an origin: the rider is asked whether it replaces
  // the one they were editing or is kept as a second ride.
  const [keepChoice, setKeepChoice] = useState<{ code: string; saved: boolean } | null>(null);
  // ui.saveEditForm from a shared route: the plan arrives in ?p= and pre-fills
  // the form; the URL is cleaned so a reload does not re-apply it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("p");
    if (!p) return;
    const shared = decodePlanShare(p);
    const mode = params.get("mode") === "chat" ? "chat" : "form";
    // `from` is the share code of the ride being edited: every path into the
    // planner from an existing ride carries it, so the new ride knows what it
    // was made from.
    const from = params.get("from");
    // What the rider typed in the shared page's "Ko mainīt?" box, if anything.
    const ask = params.get("ask")?.trim() || null;
    // No cleanup on purpose: development StrictMode runs the effect twice and
    // a cancelled timer meant the plan never arrived. The URL is cleaned only
    // once the plan is applied.
    setTimeout(() => {
      if (shared) {
        setPlan(shared);
        setEntryMode(mode);
        // Coordinates that travelled with the plan: the ride reopens on the
        // exact places it was built from, rather than on whatever the names
        // geocode to today. Older links carry none and fall back to names.
        const carried = decodePlanPlaces(p);
        if (carried.length) {
          setPlaces(carried);
          // The plan's own shape decides the roles, not the list's order: a
          // round trip has no finish, and a one-way ride's finish is its last
          // place. The composer will report the same thing the moment it
          // mounts; this is so the map is right on the first frame.
          setPreview(
            shared.returnToStart === true
              ? { start: carried[0] ?? null, vias: carried.slice(1), finish: null }
              : { start: carried[0] ?? null, vias: carried.slice(1, -1), finish: carried.length > 1 ? carried[carried.length - 1] : null },
          );
        }
        if (from) { const o = { code: from, saved: isCodeSaved(from) }; originRef.current = o; setOrigin(o); }
        // The correction typed on the shared ride's own page. `send` reads the
        // plan from state, which is a render away, so the decoded plan goes
        // with it as an argument — the same reason `generate` takes its places
        // rather than reading them (the Valmiera-in-Rīga bug).
        if (ask && mode === "chat") askRef.current = ask;
        // A plan that arrives ready to ride. Never together with `ask`: one
        // says "generate this", the other "ask the chat about this", and the
        // generate-at-once path wins only because nothing sends both.
        if (!ask && params.get("go") === "1") goRef.current = true;
      }
      window.history.replaceState(null, "", window.location.pathname);
    }, 0);
  }, []);
  // The rider's standing profile (how rough, why, where): remembered on the
  // device, applied to the form and used to seed a fresh chat so it only has
  // to ask where and how long.
  const [profile, changeProfile] = useRideProfile();
  const [locale] = useLocale();
  const ui = uiMessages(locale);
  const busyRef = useRef(false);
  /**
   * The generation in flight, so the rider can call it off. A long ride
   * legitimately takes most of a minute on our own router (Rīga → Tallinn
   * measured at 52.8 s), which is long enough to notice the wrong place was
   * typed — and without this the only way out was to wait for the answer.
   */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * True while the generation in flight is the FIRST one, started by the form
   * rather than by a typed correction — i.e. there is no route to go back to
   * and the whole conversation consists of the one bubble the form wrote.
   * Cancelling that means the rider changed their mind about the ride they
   * just described, so the way out is the form they filled in, not a chat
   * holding a single message of their own and nothing else.
   *
   * A ref rather than state: `generate` reads it after an await, where a
   * closure's copy would be a render behind, and nothing renders from it.
   */
  const firstFromFormRef = useRef(false);
  const cancel = () => {
    const fromForm = firstFromFormRef.current;
    track("generation_cancelled", { case: fromForm ? "first_from_form" : "later" });
    abortRef.current?.abort();
    abortRef.current = null;
    // Back to the form, with everything the rider typed still in it:
    // `startFromForm` put the plan and the picked places in state, and the
    // composer seeds itself from `initialPlan` / `initialPlaces` exactly as it
    // does for ui.saveEditForm. The attempt's transcript goes with it — an
    // abandoned generation should leave no half conversation behind.
    if (fromForm) {
      firstFromFormRef.current = false;
      setMessages([]);
      setEntryMode("form");
    }
    setChatting(false);
    setQuickReplies([]);
  };

  /**
   * The rider tapped "Rādi taisnāko ceļu" — show the road the API offered.
   *
   * Everything needed is already in hand: the refusal carried the routed and
   * classified road plus the intent and the start. Nothing is re-requested,
   * and deliberately so — the client would have to ask with the ride's own
   * profile, which is measured never to answer these legs (Berlin → Warszawa:
   * null after 91 s against 5.7 s on `car-fast`). A "show me" that hung for
   * a minute and then failed would be worse than the dead button it replaces.
   *
   * The panel is told this is the direct leg (`showingDirect`) so it can say
   * so: a car route must never sit where an adventure route normally does
   * without a word. CLAUDE.md, "never substitute silently".
   */
  const showDirectLeg = () => {
    const offer = directOffer;
    const base = unplannableContextRef.current;
    if (!offer || !base) return;
    track("direct_leg_shown", { km: offer.distanceKm, minutes: offer.durationMinutes });
    setResult({ ...base, routes: [offer.route] });
    setSelected(0);
    setShowingDirect(true);
    setLucky(false);
    setChatting(false);
    setQuickReplies([]);
  };

  /**
   * The two chips under "this stop cannot be reached": take it out, or move it
   * to the road the router found.
   *
   * Both edit the ride and re-plan straight away. They are `action` chips
   * rather than sentences sent to the model for the reason `direct-leg` is:
   * the fact is already known — the API measured it and named the place — and
   * asking the model to re-derive "take out Tūjas" from Latvian prose is a
   * round trip that can only lose information the verdict already has.
   *
   * ## The plan and the picked places are edited together
   *
   * A ride is carried in two halves: `plan` holds the names the rider typed
   * and `places` the coordinates they resolved to, and `generate` sends both.
   * Editing one and not the other is how a stop comes back from the dead — the
   * name is gone from the plan but its coordinate is still in `places`, and
   * the next generation routes through it anyway. So each handler builds the
   * next plan AND the next places, and hands both to `generate` explicitly
   * rather than letting it default to the `places` state that has not
   * re-rendered yet.
   *
   * `stop.role` decides which field is edited, never the index alone: a ride
   * may name the same place as a stop and as its finish, and `index` counts
   * through the whole ride (0 = start, then vias, then the finish) while
   * `viaPlaces` counts only the middle.
   */
  function reviseUnreachableStop(stop: UnreachableStop, how: "remove" | "move") {
    const current = plan;
    if (!current) return;
    // The via's own position in `viaPlaces`: the ride's index minus the start.
    const viaIndex = stop.index - 1;
    if (stop.role === "via" && (viaIndex < 0 || viaIndex >= current.viaPlaces.length)) return;
    if (how === "move" && !stop.snappedTo) return;

    // Which name this chip is about, so the matching entry in `places` can be
    // found. For a via it is the plan's own string; for the two ends it is the
    // field's, and `stop.name` is what the verdict called it either way.
    const name =
      stop.role === "via" ? current.viaPlaces[viaIndex]
      : stop.role === "start" ? current.startPlace ?? stop.name
      : current.destinationPlace ?? stop.name;

    let nextPlan: RidePlan;
    let nextPlaces: ResolvedPlace[];

    if (how === "remove") {
      // Only a stop can be dropped: a ride with no start has nowhere to begin,
      // and the chips never offer it — `describeUnreachableStop` builds
      // "remove" for any role, but the API only ever reports an unreachable
      // start or finish alongside a `canMove` the rider can take instead.
      nextPlan =
        stop.role === "via"
          ? { ...current, viaPlaces: current.viaPlaces.filter((_, i) => i !== viaIndex) }
          : stop.role === "destination"
            // A finish the ride cannot reach, taken out, leaves a ride that
            // ends wherever it gets to — which is exactly `destinationAny`,
            // the "man vienalga" the composer already builds.
            ? { ...current, destinationPlace: null, destinationAny: true }
            : current;
      if (nextPlan === current && stop.role === "start") return;
      // The coordinate goes with the name, or the next generation routes
      // through a place the plan no longer mentions.
      nextPlaces = places.filter((p) => !matchesStop(p, name, stop));
    } else {
      const moved = stop.snappedTo!;
      // The name the rider picked, on the coordinates the ride can reach. The
      // place is the same place — that is what `canMove` asserts — so the plan
      // is untouched and only the coordinate moves. Renaming it here would
      // tell the rider he had asked for somewhere else.
      nextPlan = current;
      const existing = places.find((p) => matchesStop(p, name, stop));
      const replacement: ResolvedPlace = existing
        ? { ...existing, lat: moved.lat, lon: moved.lon }
        : { name, label: name, lat: moved.lat, lon: moved.lon };
      nextPlaces = existing
        ? places.map((p) => (p === existing ? replacement : p))
        : [...places, replacement];
    }

    track("quick_reply_used", { label: how === "move" ? "move-stop" : "remove-stop", action: how });
    setPlan(nextPlan);
    setPlaces(nextPlaces);
    setQuickReplies([]);
    setDirectOffer(null);
    unplannableContextRef.current = null;
    const said =
      how === "move"
        ? fi(ui.chatStopMoved, { place: stop.name })
        : fi(ui.chatStopRemoved, { place: stop.name });
    const conversation: ChatMessage[] = [...messages, { role: "assistant", content: said }];
    setMessages(conversation);
    setChatting(true);
    // Straight back to the search with the corrected ride. The rider asked for
    // a fix, not for a form to fill in again.
    void generate(nextPlan, conversation, nextPlaces);
  }

  async function generate(current: RidePlan, conversation: ChatMessage[], pickedPlaces: ResolvedPlace[] = places) {
    setPhase("routing");
    const sourcePrompt = conversation.filter(m => m.role === "user").map(m => m.content).join("\n");
    try {
      const isLucky = current.returnToStart === true && current.viaPlaces.length === 0 && !current.focusArea && current.budget.mode === "flexible";
      setLucky(isLucky);
      const controller = new AbortController();
      abortRef.current = controller;
      const response = await fetch("/api/generate-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: current, prompt: sourcePrompt, places: pickedPlaces, lucky: isLucky }), signal: controller.signal });
      const data = await readJson(response, ui);
      // Every candidate failed and no single place is to blame: say what was
      // tried, in the rider's language, and offer the ways out that change
      // the question — without the stops, on an easier profile — beside the
      // plain retry. Measured on Ķekava → … → Mežavairogi (2026-09-25): the
      // rider got a sentence about the duration of a flexible ride and one
      // chip that asked the same question again.
      const noRoute = (data as { noRoute?: { tried: number; stops: number; flexible: boolean } }).noRoute;
      if (!response.ok && noRoute) {
        track("route_no_route", { tried: noRoute.tried, stops: noRoute.stops });
        setLucky(false);
        const text = [fi(ui.chatNoRoute, { n: noRoute.tried }), noRoute.flexible ? "" : ui.chatNoRouteTime].filter(Boolean).join(" ");
        setMessages([...conversation, { role: "assistant", content: text }]);
        setQuickReplies([
          ...(noRoute.stops > 0 ? [{ label: ui.chatDropStops, message: "", action: "drop-stops" as const }] : []),
          ...(easierPlan(current) ? [{ label: ui.chatEasierProfile, message: "", action: "easier-profile" as const }] : []),
          { label: ui.chatRetry, message: "", action: "retry" as const },
        ]);
        setChatting(true);
        setRetry({ stage: "route", plan: current, messages: conversation });
        return;
      }
      if (!response.ok) throw new Error(data.error || ui.chatErrGenerate);
      // The ride is beyond what one search can cover, and the API said so
      // after ~10 s instead of letting the rider wait ~50 s for a 422. It is
      // a reply, not a failure: no retry chip, because trying again would
      // give exactly the same answer.
      const unplannable = (data as GenerateRouteResponse).unplannable;
      if (unplannable) {
        track("route_unplannable", { leg_km: unplannable.legKm, reason: unplannable.reason });
        setLucky(false);
        // The interface's own language. `lv` stays `true` because the older
        // wording in `describeUnplannable` only speaks that pair; the
        // unreachable-stop sentence beside it speaks all four and reads the
        // locale, so the rider meets that one in the language he is using.
        const { message, quickReplies: replies } = describeUnplannable(unplannable, true, locale);
        setMessages([...conversation, { role: "assistant", content: message }]);
        setQuickReplies(replies);
        // Held for the "Rādi taisnāko ceļu" chip. The road is already routed
        // and travels in the verdict — asking the API again would use the
        // ride's own profile, which is measured never to answer these legs.
        setDirectOffer(unplannable.directLeg ?? null);
        unplannableContextRef.current = data as GenerateRouteResponse;
        setResult(null);
        setShowingDirect(false);
        setChatting(true);
        setRetry(null);
        return;
      }
      setDirectOffer(null);
      setShowingDirect(false);
      const route = (data as GenerateRouteResponse).routes[0];
      if (!route) throw new Error(ui.chatErrNoMatch);
      const verdict = (data as GenerateRouteResponse).infeasible;
      const first = (data as GenerateRouteResponse).routes[0];
      track("route_generated", {
        versions: (data as GenerateRouteResponse).routes.length, km: Math.round(first.distanceMeters / 1000), minutes: Math.round(first.durationSeconds / 60),
        repeated: first.overlap.repeatedPercent, unpaved: first.surfaces.gravelPercent + first.surfaces.dirtPercent,
        budget_mode: current.budget.mode, budget_value: current.budget.value ?? undefined, budget_constraint: current.budget.constraint,
        round_trip: current.returnToStart ?? undefined, via_count: current.viaPlaces.length, focus_area: Boolean(current.focusArea), lucky: isLucky,
        difficulty: current.difficulty, style: current.rideStyle, gravel: current.gravelPreference ?? undefined, trails: current.trailPreference,
        remote_loop: Boolean((data as GenerateRouteResponse).remoteLoop), infeasible: Boolean(verdict), source: conversation.length <= 1 ? "form" : "chat",
      });
      if (verdict) {
        track("route_infeasible", { requested_minutes: verdict.requestedMinutes, minimum_minutes: verdict.minimumMinutes, direct_km: verdict.directKm });
        // The request cannot be ridden on these roads in this time. The
        // nearest ride is on the map; the chat says what does not fit, what
        // the minimum is, and offers the ways out as taps — never an error.
        setResult(data);
        setSelected(0);
        setLucky(false);
        const { message, quickReplies: replies } = describeInfeasible(current, verdict, true);
        setMessages([...conversation, { role: "assistant", content: message }]);
        setQuickReplies([...replies, { label: `Rādīt tuvāko (${minutesLabel(verdict.minimumMinutes)})`, message: "", action: "show-routes" }]);
        setChatting(true);
        setRetry(null);
        return;
      }
      setResult(data);
      setVariantOffset({});
      // The lucky ride leads with the most interesting version.
      const complexIndex = (data as GenerateRouteResponse).routes.findIndex((r) => r.variant === "complex");
      setSelected(isLucky && complexIndex >= 0 ? complexIndex : 0);
      // Riding the same road twice is the one thing every rider minds. When
      // even the best version retraces a lot, the chat says so and offers
      // the levers — the route stays on the map for those who accept it.
      const OVERLAP_CHAT_PERCENT = 20;
      const bestRepeat = Math.min(...(data as GenerateRouteResponse).routes.map((r) => r.overlap.repeatedPercent));
      if (bestRepeat > OVERLAP_CHAT_PERCENT) {
        track("overlap_chat_shown", { best_repeated: bestRepeat, km: Math.round(route.distanceMeters / 1000) });
        setLucky(false);
        const km = Math.round(route.overlap.repeatedKm);
        setMessages([...conversation, { role: "assistant", content: `Šeit neizdevās atrast trasi bez atkārtošanās: labākā versija ${bestRepeat} % ceļa (${km} km) brauc pa jau nobrauktiem ceļiem. Trase ir kartē, bet es to labāk pārtaisītu. Ko darām?` }]);
        setQuickReplies([
          { label: ui.chatLessOverlap, message: ui.chatLessOverlapMsg },
          { label: ui.chatBigRoadsOk, message: ui.chatBigRoadsMsg },
          ...(current.returnToStart && (current.viaPlaces.length > 0) ? [{ label: `Vienā virzienā līdz ${current.viaPlaces[current.viaPlaces.length - 1]}`, message: `Vienvirziena brauciens līdz ${current.viaPlaces[current.viaPlaces.length - 1]}.` }] : []),
          { label: ui.chatShowAnyway, message: "", action: "show-routes" as const },
        ]);
        setChatting(true);
        setRetry(null);
        return;
      }
      setChatting(false);
      setQuickReplies([]);
      // Editing an existing ride produced a new one. Ask what becomes of the
      // original rather than guessing: silently replacing loses a ride the
      // rider may still want, silently keeping both fills the list with
      // near-duplicates.
      if (originRef.current) { setKeepChoice(originRef.current); originRef.current = null; setOrigin(null); }
      const versions = (data as GenerateRouteResponse).routes.length;
      // The numbers are in the result card; the message only says what to do next.
      const notes = [
        isLucky ? ui.chatLucky : "",
        versions > 1 ? fi(ui.chatReadyN, { n: versions }) : ui.chatReady,
        data.remoteLoop ? fi(ui.chatRemoteLoop, {
          place: (data as GenerateRouteResponse).remoteLoop!.focus.label.split(",")[0],
          out: (data as GenerateRouteResponse).remoteLoop!.transitOutMinutes,
          back: (data as GenerateRouteResponse).remoteLoop!.transitBackMinutes,
        }) : "",
        data.distanceWarning ? ui.chatLongerThanAsked : "",
        // The probe measured a slow leg and the search was cut to fit the
        // budget. Say how many versions were actually tried rather than
        // letting the rider wonder why fewer cards came back.
        data.reducedSearch
          ? fi(ui.chatFewerVersions, { tried: data.reducedSearch.tried, planned: data.reducedSearch.planned })
          : "",
        ui.chatSayWhatToChange,
      ];
      setMessages([...conversation, { role: "assistant", content: notes.filter(Boolean).join(" ") }]);
      setRetry(null);
    } catch (e) {
      // The rider called it off. That is an answer, not an error: no message,
      // no retry. `cancel` has already decided where they land — the form when
      // this was the first generation, the chat and its previous route
      // otherwise — so nothing here may write to the conversation.
      if (e instanceof DOMException && e.name === "AbortError") {
        firstFromFormRef.current = false;
        setChatting(false);
        setQuickReplies([]);
        return;
      }
      // A failure belongs in the conversation, like every other reply. It used
      // to sit in a box under the whole panel, off-screen on a laptop, so the
      // chat stayed silent and the rider saw nothing happen after ~50 s.
      setMessages([...conversation, { role: "assistant", content: describeError(e, ui.chatErrGenerate) }]);
      setQuickReplies([{ label: ui.chatRetry, message: "", action: "retry" }]);
      setChatting(true);
      setRetry({ stage: "route", plan: current, messages: conversation });
    } finally {
      // Whatever the outcome — routes, a failure the chat now owns, or the
      // abort handled above — this attempt is over and the next cancel must
      // not inherit its answer.
      firstFromFormRef.current = false;
      abortRef.current = null;
    }
  }

  async function converse(conversation: ChatMessage[], previousPlan: RidePlan | null) {
    setPhase("thinking");
    try {
      const response = await fetch("/api/route-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversation, plan: previousPlan }) });
      const data = await readJson(response, ui);
      if (!response.ok) throw new Error(data.error || ui.chatErrAnswer);
      const answer = data as ChatResponse;
      const updated: ChatMessage[] = [...conversation, { role: "assistant", content: answer.message }];
      setMessages(updated); setPlan(answer.plan); setResult(null); setRetry(null);
      setQuickReplies(answer.quickReplies ?? []);
      if (answer.ready) await generate(answer.plan, updated);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      setMessages([...conversation, { role: "assistant", content: describeError(e, ui.chatErrAnswer) }]);
      setQuickReplies([{ label: ui.chatRetry, message: "", action: "retry" }]);
      setChatting(true);
      setRetry({ stage: "chat", messages: conversation, plan: previousPlan });
    } finally {
      abortRef.current = null;
    }
  }

  async function send(text: string) {
    if (busyRef.current) return;
    if (messages.length >= 37) { setError(ui.chatTooLong); return; }
    busyRef.current = true; setError(null); setRetry(null);
    // The rider is talking now: whatever this turn generates, cancelling it
    // belongs in the chat, with this message still in it.
    firstFromFormRef.current = false;
    setQuickReplies([]); setChatting(true);
    track("chat_message_sent", { length: text.length, has_route: Boolean(route), turn: messages.filter((m) => m.role === "user").length + 1 });
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    try { await converse(next, plan ?? seedPlanFromProfile(profile)); } finally { setPhase("idle"); busyRef.current = false; }
  }
  async function startFromForm(current: RidePlan, picked: ResolvedPlace[]) {
    if (busyRef.current) return;
    busyRef.current = true; setError(null); setRetry(null); setQuickReplies([]); setPlan(current); setPlaces(picked); setEntryMode("chat"); setEditMode(false);
    // Back to the top. "Create route" sits near the bottom of a tall composer,
    // so `scrollY` is large when it is pressed — and this swap removes the
    // composer, shrinks the map 42dvh → 26dvh and leaves a chat panel only as
    // tall as its one bubble. The document can lose more than a viewport in a
    // single frame, and the browser clamps the kept `scrollY` to the new
    // bottom: the rider landed on the footer and had to scroll up to see the
    // map. After paint, so the clamp has already happened.
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
    // Only the first attempt, with no route yet, sends a cancel back to the
    // form. A re-generation from the result panel leaves a route on screen to
    // return to, so it cancels the way a chat correction does.
    firstFromFormRef.current = !result;
    setResult(null);
    track("form_generate", { budget_mode: current.budget.mode, budget_value: current.budget.value ?? undefined, round_trip: current.returnToStart ?? undefined, via_count: current.viaPlaces.length, difficulty: current.difficulty, style: current.rideStyle, gravel: current.gravelPreference ?? undefined, picked_places: picked.length });
    // Short: the profile is in the panel header and the plan object travels
    // with every chat turn, so the message only needs the places and budget.
    const places = [current.startPlace, ...current.viaPlaces, current.returnToStart ? current.startPlace : current.destinationPlace].filter(Boolean).join(" → ");
    const budget = current.budget.mode === "duration" ? `~${current.budget.value} h` : current.budget.mode === "distance" ? `~${current.budget.value} km` : ui.budgetFlexible;
    const conversation: ChatMessage[] = [{ role: "user", content: `${places}, ${budget}.` }];
    setMessages(conversation);
    try { await generate(current, conversation, picked); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  /**
   * A suggested place becomes a stop, and the ride is planned again through it.
   *
   * This is the "+ Pievienot" in Detaļas. Deliberately no new path: it builds
   * the plan the form would have built with that stop typed into it and hands
   * it to `startFromForm`, so the summary, the form the rider can go back to,
   * the analytics and the cancel behaviour are all the ones that already
   * exist. The coordinates travel as a picked place for the same reason the
   * form's do — "Pilskalns" is the name of dozens of hillforts, and the one
   * meant is the one on the map, not whatever a geocoder decides.
   *
   * Appended rather than inserted: this stop is somewhere the ride already
   * passes near, so it belongs in the order the router finds, and on a one-way
   * ride the destination stays the destination because `startFromForm` reads
   * it from `destinationPlace`, not from the end of the via list.
   */
  /**
   * "Kartē" on a suggestion: put the ring on it and make sure the map is
   * where the rider can see it.
   *
   * On a desktop the map is the sticky right column and is always on screen,
   * so the flight is the whole answer. On a phone it lives *inside* the result
   * panel, above the suggestions — which means it may well be scrolled off the
   * top when the rider reaches the Ieteikumi card, and a map flying somewhere
   * nobody is looking at is not an answer at all. `scrollIntoView` on the
   * panel's own map slot is enough; the map is already mounted and visible, so
   * there is no sheet to open and nothing to wait for.
   *
   * The scroll is deferred one frame: the marker and the `easeTo` are set by
   * the render this press causes, and scrolling before that render leaves the
   * map moving under a rider who is already looking at it.
   */
  function showPoi(
    poi: { id: string; name: string; lat: number; lon: number; category: string },
    // What the row said about the detour, so the card on the map says exactly
    // the same — the same "+17,0 km", the same "garš apbrauciens", and the
    // same offer to tick it.
    detour?: DetourFocusNote | null,
  ) {
    focusTokenRef.current += 1;
    setSightNote(null);
    const entry = POI_KIND[poi.category as keyof typeof POI_KIND];
    track("suggestion_shown", { kind: poi.category });
    setFocusPoi({
      lat: poi.lat,
      lon: poi.lon,
      label: poi.name,
      kind: entry ? ui[entry.key as keyof typeof ui] ?? poi.category : poi.category,
      token: focusTokenRef.current,
      poi: { id: poi.id, name: poi.name, lat: poi.lat, lon: poi.lon, category: poi.category },
      picked: selectedPois.some((p) => p.id === poi.id),
      detour: detour ?? null,
    });
    if (desktop) return;
    // The card's „Pievienot” is on the map, and the inline map is a preview.
    openMapFullscreen();
    requestAnimationFrame(() => {
      document.querySelector("[data-map-slot]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  /**
   * A click on a sight's mark on the map: the same card a row's "Kartē" opens.
   *
   * The rider asked for exactly one card for a place, reachable from either
   * side, and for a nearby mark's card to carry its tick. Both come out of
   * reusing `showPoi`: `focus.poi` is what `toggleFocusedPoi` selects on, so
   * the card's control is the row's control.
   *
   * The detour note is derived here rather than left off. The card and the row
   * are two views of one offer and must not disagree — a rider who reads
   * "+17,0 km · garš apbrauciens" in the list and finds a bare Pievienot on the
   * map has been told less on the map than in the list, and the number is the
   * whole basis of the decision. `detoursForMap` is the panel's own prefetch,
   * reported upwards, passed through the same function the row uses; a place
   * whose detour has not been routed yet (or an on-route place, which has no
   * detour to route) gets null and the card says what it always said.
   */
  function showPoiFromMap(poi: RoutePoi) {
    showPoi(poi, describeDetourForFocus({
      detour: detoursForMap[poi.id],
      offRouteMeters: poi.distanceMeters,
      m: ui,
    }));
  }

  /**
   * "Labot": the same page, the result panel swapped for the form's rows.
   *
   * Ticked-but-not-kept sights are dropped on the way in: they are previews
   * spliced into the line as it is now, and the edit is about to change that
   * line under them. The map shows the ride's own pins from the first frame
   * (`setPreview`) rather than whatever the planning form last reported.
   */
  function enterEdit() {
    if (!ridePlaces || !shownRoute) return;
    setSelectedPois([]);
    setSightNote(null);
    setSightWaiting(null);
    // The result panel unmounts in this same commit and never gets to report
    // its ticked sights gone: the spliced preview is dropped here, or the edit
    // map kept drawing the pre-edit line with a sight's detour spliced in
    // while every edit changed a line nobody could see (2026-09-25).
    setSplicedFor({ result, spliced: null });
    setFocusPoi(null);
    setEditNote(null);
    discardProposal();
    setChain(NO_CHAIN);
    // Stops only: a shaping point is a dot of the editor's own, not a pin.
    setPreview({ start: ridePlaces.start, vias: stopsOf(ridePlaces), finish: ridePlaces.finish });
    setEditEntry({ editsFor, plan, places });
    reseed();
    setEditMode(true);
    track("route_edit_opened", { km: Math.round(shownRoute.distanceMeters / 1000), stops: stopsOf(ridePlaces).length, shapes: shapesOf(ridePlaces).length });
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /**
   * "Atcelt labošanu": every change made since "Labot" is dropped — line,
   * places, numbers and the kicker go back to what they were — and the panel
   * returns. A rider who has made a mess of it should not have to press Undo
   * once per change to find the ride he started from.
   */
  function cancelEdit() {
    discardProposal();
    setChain(NO_CHAIN);
    if (editEntry) {
      track("route_edit_cancelled", { edited: editEntry.editsFor.history.current !== edited });
      setEditsFor(editEntry.editsFor);
      setPlan(editEntry.plan);
      setPlaces(editEntry.places);
    }
    setEditEntry(null);
    setEditMode(false);
    setEditNote(null);
  }

  /** "Pabeigt labošanu": back to the result panel, which now reads the edited ride. */
  function finishEdit() {
    // A preview not confirmed is not kept: ✓ is how an edit enters the ride.
    discardProposal();
    setChain(NO_CHAIN);
    track("route_edit_finished", { edited: Boolean(edited) });
    setEditMode(false);
    setEditNote(null);
  }

  // ── Preview before commit (docs/DESIGN-route-editing.md B4, Phase 1) ──
  //
  // Every line-changing edit — a moved pin, a new stop, a batch, a bent line,
  // a moved or removed point — is routed first and shown as a proposal;
  // nothing enters the ride or the undo until ✓, and ✕ leaves both exactly
  // as they were. `proposePlaces` routes and sets no ride state;
  // `commitProposal` is the one place a routed edit enters the ride.

  /** The places a pending change would leave, or why it cannot be made (said, never swallowed). */
  function placesForChange(change: ProposedChange, before: RidePlaces, line: Point[]): { after: RidePlaces; keepOrder?: boolean } | { how: EditKind; note: string; reason: string } {
    if (change.kind === "rows") {
      const { rows } = change;
      const fromRows = placesFromRows({
        picked: rows.picked,
        rowCount: rows.names.length,
        roundTrip: before.roundTrip,
        finishOptional: !before.finish,
      });
      if ("error" in fromRows) {
        const had = rowsOf(before).names.length;
        const how: EditKind = rows.names.length > had ? "add-stop" : rows.names.length < had ? "remove-stop" : "move-stop";
        return { how, note: ui.editNeedsPlace, reason: "no-place" };
      }
      // New stops stay in the leg the rows put them in (Phase 1: the
      // composer places each in its nearest leg, or the one the rider
      // chose); otherwise the shaping points go back where they were.
      const inOrder = mergeAddedInOrder(before, fromRows, line);
      if (inOrder) return { after: inOrder, keepOrder: true };
      return { after: mergeShapes(before, fromRows) };
    }
    const { op } = change;
    const next = applyShapeEdit(before, op);
    if ("error" in next) {
      const how: EditKind = op.kind === "add" ? "add-stop" : op.kind === "remove" ? "remove-stop" : "move-stop";
      const note = next.error === "stop-cap" ? fi(ui.mapAddStopFull, { n: MAX_STOPS }) : next.error === "shape-cap" ? fi(ui.shapeCapNote, { n: MAX_SHAPE_POINTS }) : ui.resEditFailed;
      return { how, note, reason: next.error };
    }
    return { after: next };
  }

  /** The line a new proposal is cut from right now: the chain's top, else the committed ride (read from the ref: async-safe). */
  function baseNow(): { segments: Segments; top: EditProposal | null } {
    const top = route ? chainTopOf(chainRef.current.routeId === route.id ? chainRef.current : NO_CHAIN) : null;
    return { segments: top?.ride.segments ?? edited?.segments ?? route!.segments, top };
  }

  /** Stops whatever the live proposal is doing in the background — the debounce and the request. */
  function stopProposalWork() {
    if (proposeTimer.current) clearTimeout(proposeTimer.current.timer);
    proposeTimer.current = null;
    proposalAbort.current?.abort();
    proposalAbort.current = null;
  }

  /** A ✓ waiting on the proposal is answered: whether its change landed on the line. */
  function settleWaiter(token: number, ok: boolean) {
    const waiter = commitWaiter.current;
    if (!waiter || waiter.token !== token) return null;
    commitWaiter.current = null;
    setCommitting(false);
    waiter.resolve(ok);
    return waiter;
  }

  /**
   * Route a pending change and hand the answer to the reducer as a proposal —
   * no ride state is touched. `delay` is the drag debounce; `confirm` is a ✓
   * already pressed for this change (the proposal commits the moment it lands).
   */
  function proposePlaces(change: ProposedChange, opts: { delay?: number; confirm?: Omit<CommitWaiter, "token">; wide?: boolean; straight?: number; then?: { lat: number; lon: number } } = {}) {
    stopProposalWork();
    const token = ++proposalSeq.current;
    overrideArmed.current = null;
    setBlocking(null);
    setWideAsk(null);
    setStraightAsk(null);
    if (!plan || !result || !route || !ridePlaces) {
      live.current = null;
      opts.confirm?.resolve(false);
      return;
    }
    // Chained (release B item 4): cut from the top of the chain.
    const { top } = baseNow();
    const before = top?.ride.places ?? ridePlaces;
    const baseSegments = top?.ride.segments ?? edited?.segments ?? route.segments;
    const stacked = top ? { baseRide: { distanceMeters: top.ride.distanceMeters, durationSeconds: top.ride.durationSeconds }, origin: ridePlaces } : {};
    live.current = { token, key: changeKey(change), base: baseSegments, routeId: route.id, landed: null, change, renames: {} };
    if (opts.confirm) { commitWaiter.current = { ...opts.confirm, token }; setCommitting(true); }
    // A new proposal: whatever the last one said goes with it.
    setEditNote(null);
    const refuseNow = (how: EditKind, note: string, reason: string) => {
      dispatchProposal({ type: "route", token, how });
      refuseProposal(token, how, note, reason);
    };
    const line = coordinatesOf(baseSegments);
    const target = placesForChange(change, before, line);
    if ("note" in target) { refuseNow(target.how, target.note, target.reason); return; }
    if (line.length < 2) { refuseNow("move-stop", ui.resEditFailed, "degenerate"); return; }
    // Drawn straight stretches are fixed: no window re-routes them (design C).
    const planned = planEdit({ line, cum: cumulative(line), before, after: target.after, keepOrder: target.keepOrder, fixed: drawnIntervals(baseSegments) });
    if (!planned) {
      // Nothing about the line changes: nothing to preview, nothing to commit.
      live.current = null;
      dispatchProposal({ type: "discard" });
      const waiter = settleWaiter(token, true);
      if (waiter && !waiter.keepOnFailure) reseed();
      return;
    }
    if ("error" in planned) { refuseNow("move-stop", ui.editNoRide, "degenerate"); return; }
    dispatchProposal({ type: "route", token, how: planned.kind });
    if (opts.confirm) dispatchProposal({ type: "confirm" });
    const run = () => {
      proposeTimer.current = null;
      void routeProposal({ token, before, planned, baseSegments, line, shape: change.kind === "shape", change, wide: opts.wide === true, ...(opts.straight !== undefined ? { straight: true, relax: opts.straight } : {}), ...(opts.then ? { then: opts.then } : {}), ...stacked });
    };
    if (opts.delay) proposeTimer.current = { timer: setTimeout(run, opts.delay), run };
    else run();
  }

  /** The request itself, and the proposal its answer becomes. Stale answers (an older token) are dropped. */
  async function routeProposal(p: { token: number; before: RidePlaces; planned: EditPlan; baseSegments: Segments; line: Point[]; shape: boolean; change: ProposedChange; wide: boolean; relax?: number; bestOff?: number; fallback?: Landing; keepSpurs?: boolean; straight?: boolean; widened?: boolean; prefetched?: RoutedRuns;
    /**
     * Stacked on another landing, not the committed ride (release B): the
     * ride this stretch is cut from (`baseRide`: its length and time), and
     * the committed places the proposal is before (`origin`). Its delta and
     * its halo are against the committed ride.
     */
    baseRide?: { distanceMeters: number; durationSeconds: number }; origin?: RidePlaces;
    /** „Vest pa taisno” for one point of a batch: this landing is the rest; the point is then reached straight on top of it. */
    then?: { lat: number; lon: number };
  }): Promise<void> {
    if (!plan || !route) return;
    const { token, before, planned, baseSegments, line } = p;
    // The profile rung this attempt routes on: 0 is the rider's own; past
    // it, `relaxedProfiles` — only after his reached no road through the
    // point (rider, 2026-09-28, `lib/map/edit-reach.ts`).
    const level = p.relax ?? 0;
    const current = () => proposalSeq.current === token;
    const abort = new AbortController();
    proposalAbort.current = abort;
    const nextPlan = planWithPlaces(plan, planned.places);
    const startedAt = startClock();
    const refuse = (note: string, reason: string, meters?: number) => { refuseProposal(token, planned.kind, note, reason, meters); };
    const ownProfile = buildMotoProfileOptions(planToIntent(nextPlan));
    // Where the edit asks the ride to go: the places it adds or moves, or
    // the bend's drop — and how far that is from the ride it has.
    const known = [before.start, ...before.vias, ...(before.finish ? [before.finish] : [])];
    const asked: Point[] = p.change.kind === "shape" && (p.change.op.kind === "add" || p.change.op.kind === "move")
      ? [[p.change.op.lon, p.change.op.lat]]
      : [planned.places.start, ...planned.places.vias, ...(planned.places.finish ? [planned.places.finish] : [])]
        .filter((q) => !known.some((k) => k.lat === q.lat && k.lon === q.lon)).map((q): Point => [q.lon, q.lat]);
    const reachM = reachOf(asked, line);
    const baseMeters = p.baseRide?.distanceMeters ?? edited?.distanceMeters ?? route.distanceMeters;
    const baseSeconds = p.baseRide?.durationSeconds ?? edited?.durationSeconds ?? route.durationSeconds;
    // What the probes need if this is refused or warned: the first attempt's view (release B item 1).
    if (blockCtx.current?.token !== token && !p.then) blockCtx.current = { token, before, planned, line, baseSegments, nextPlan, asked, baseMeters };
    /** The detour this proposal adds, when it is one worth his say-so (the warned landing names it). */
    let riskPlus: number | null = null;
    /**
     * No road of this profile reaches the point, `offM` from it: the next
     * rung is tried; past the last, it is said plainly (rules 1 and 3) —
     * with the nearest any attempt came.
     */
    const unreached = async (offM: number): Promise<void> => {
      const bestOff = Math.min(p.bestOff ?? Infinity, offM);
      // The straight line itself would not join: said as it is.
      if (p.straight) return refuse(ui.editBrokenLine, "broken-line");
      if (profileAt(ownProfile, level + 1)) return routeProposal({ ...p, relax: level + 1, bestOff, keepSpurs: false });
      // A lower rung reached the point only by a dead end: that is still a
      // road that reaches it (rule 1), offered with the dead end said.
      if (p.fallback) return land(p.fallback);
      // No road at all, even on car-fast (rule 3, as the rider changed it):
      // said, and „Vest pa taisno” offered — as far as a road goes, then
      // straight (`lib/map/straight.ts`). One new point only: a batch or a
      // move is said as it is.
      const addsOne = asked.length === 1 && (planned.kind === "add-stop");
      if (addsOne) return askStraight(token, planned.kind, fi(ui.editNoRoadStraight, { m: Math.round(bestOff) }), p.change, level, bestOff);
      return refuse(fi(ui.editNoRoad, { m: Math.round(bestOff) }), "no-road", bestOff);
    };
    /** A proposal into the reducer — or ✓ already pressed, committed (never one that needs „Tomēr braukt”). */
    const land = (l: Landing) => {
      // A change stacked on a warned one still needs „Tomēr braukt” (`mayCommit`, release B item 4).
      const proposal = inheritWarning(l.proposal, chainRef.current);
      if (!current()) return;
      // „Vest pa taisno” for one point of a batch: the rest landed — now
      // that point, straight, on top of it; one proposal for ✓.
      if (p.then) { void straightOnTop(p, l.proposal.ride); return; }
      // A warned proposal names the point that warns it (release B item 1).
      if (proposal.accept === "profile" || proposal.accept === "detour") noteBlocking(token, { accept: proposal.accept, plus: riskPlus });
      if (live.current?.token === token) live.current.landed = { addedAt: l.addedAt, runs: l.runs, startedAt };
      const next = dispatchProposal({ type: "landed", proposal });
      track("route_edit_proposed", {
        how: planned.kind,
        ms: elapsedMsSince(startedAt),
        km_delta: Math.round((proposal.delta.kmAfter - proposal.delta.kmBefore) * 10) / 10,
        repeated_before: proposal.delta.repeatedBefore,
        repeated_after: proposal.delta.repeatedAfter,
      });
      // ✓ pressed while it routed: committed the moment it lands — unless
      // it turned out to need „Tomēr braukt”: that ✓ was pressed before the
      // warning existed, so it is answered no and the warning is shown.
      if (next.phase === "proposed" && next.proposal === proposal && next.confirmNow) {
        if (proposal.accept) settleWaiter(token, false);
        else commitProposal(proposal, true);
      }
      // ── sights-add ── a sight from the map card: stacked, so ✓ ↶ ✕ act on it.
      if (sightAsk.current?.token === token && next.phase === "proposed" && next.proposal === proposal) landSight(proposal);
    };
    try {
      type Routed = RoutedRuns;
      // Every place in every stretch is ridden through, not out to and back
      // (rider, 2026-09-25): the server routes a stretch leg by leg and looks
      // for a way through each place whose way in and way out share road
      // (`routeThroughPlaces`) — a lone stop, a batch, the whole-span
      // fallback alike. Shaping points are flagged: a spur to one is cut.
      const request = async (runs: typeof planned.runs, keepSpurs = p.keepSpurs): Promise<Routed | { status: number }> => {
        const response = await fetch("/api/reroute-leg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: abort.signal,
          body: JSON.stringify({
            plan: nextPlan,
            runs: runs.map((run) => run.points.map(([lon, lat]) => ({ lat, lon }))),
            loops: runs.map((run) => run.points.length >= 3),
            shapes: runs.map((run) => shapeFlags(run, planned.places)),
            ...(level ? { relax: level } : {}),
            ...(keepSpurs ? { keepSpurs: true } : {}),
          }),
        });
        if (!response.ok) return { status: response.status };
        const routed = (await response.json()) as Routed;
        // A relaxed rung: its new metres are outside the profile, ⚠️ on the map.
        return !level ? routed : { runs: routed.runs.map((r) => ({ ...r, segments: markOutsideProfile(r.segments, line).segments })) };
      };
      // The kept ride's places: a join never slides past one (`retraceAtJoins`).
      const keep = anchorsOf(before, line[line.length - 1]);
      const splice = (runs: typeof planned.runs, routed: Routed) => applyRuns({
        segments: baseSegments,
        distanceMeters: baseMeters,
        durationSeconds: baseSeconds,
        runs,
        routed: routed.runs,
        keep,
      });
      // „Pārrēķināt posmu” (the rider asked for it): the whole span at once.
      let runs = p.wide ? [spanRun({ line, cum: cumulative(line), before, after: planned.places, runs: planned.runs })] : planned.runs;
      let data: Routed | { status: number };
      // „Vest pa taisno”: as far as a road goes toward the point (the router
      // ends a leg to a pin in a field at the nearest road it can reach),
      // then straight to it and back along the same line.
      let straight: { meters: number } | null = null;
      if (p.straight && asked.length === 1) {
        const lc = cumulative(line);
        const near = nearestAlong(asked[0], line, lc);
        const join = pointAtDistance(line, lc, near.alongMeters).point as Point;
        const toward = await request([{ fromMeters: near.alongMeters, toMeters: near.alongMeters, points: [join, asked[0]] }]).catch((): { status: number } => ({ status: 0 }));
        if (!current()) return;
        const s = straightRun({ line, point: asked[0], road: "status" in toward ? null : toward.runs[0] });
        runs = [s.run];
        data = { runs: [s.routed] };
        straight = { meters: s.straightMeters };
      } else if (runs.every((r) => r.drop)) {
        // A straight point taken out: its stretch simply goes, nothing routed.
        data = { runs: runs.map(() => ({ segments: { type: "FeatureCollection" as const, features: [] }, distanceMeters: 0, durationSeconds: 0 })) };
      } else {
        data = p.prefetched ?? await request(runs);
      }
      if (!current()) return;
      // 422: the router reached no road through the point on this profile.
      if ("status" in data) return data.status === 422 ? unreached(reachM) : refuse(ui.resEditFailed, String(data.status));
      let spliced = splice(runs, data);
      // A stretch cut at a neighbouring place that came back leaving it the
      // way the kept ride came in: routed again THROUGH that place, so the
      // place is not left at the tip of a spur (`throughBlockedPlaces`).
      const through = straight ? null : throughBlockedPlaces({ line, cum: cumulative(line), before, runs, blocked: spliced.blocked });
      if (through) {
        const again = await request(through);
        if (!current()) return;
        if (!("status" in again)) {
          const wider = splice(through, again);
          if (wider.blocked.every((b) => !b.head && !b.tail) && lineBreaks(wider.segments, baseSegments).length === 0) {
            runs = through; data = again; spliced = wider;
          }
        }
      }
      // The invariant (rider, 2026-09-25): the edited ride is ONE continuous
      // line through every place in order. A stretch the router began or
      // ended somewhere other than the cut — a nudged or snapped endpoint —
      // left a gap and a stray stub on the map. Such a splice is never
      // shown: the whole span between the nearest unchanged places is routed
      // again as one stretch, and if that breaks too the edit is refused and
      // the ride keeps the line it had.
      const sound = (candidate: typeof spliced) => spliceIsSound({ segments: candidate.segments, original: baseSegments, places: planned.places, before, toleranceMeters: MOVE_OFFER_MAX_M });
      let verdict = sound(spliced);
      // Not on a relaxed rung: a whole span re-routed on a profile that is
      // not his would reshape the ride far from the point he asked for.
      if (!verdict.ok && !p.wide && !level) {
        console.warn("mopik: edited line broke", { kind: planned.kind, breaks: verdict.breaks, missesPlaces: verdict.missesPlaces, offRoadMeters: verdict.offRoadMeters, runs: runs.map((r, i) => ({ i, from: Math.round(r.fromMeters), to: Math.round(r.toMeters) })) });
        track("route_edit_failed", { reason: "broken-line" });
        const span = spanRun({ line, cum: cumulative(line), before, after: planned.places, runs });
        const again = await request([span]);
        if (!current()) return;
        if (!("status" in again)) {
          const whole = splice([span], again);
          const second = sound(whole);
          // A whole-span line that reshapes the ride is the rider's to ask
          // for, never proposed on its own (rider, 2026-09-28: 67 → 35 km).
          const kmBefore = baseMeters;
          if (second.ok && wideNeedsAsking(kmBefore, whole.distanceMeters)) {
            const ends = spanEnds({ line, cum: cumulative(line), before, span });
            const name = (v: RidePlace | null, fallback: string) => (v ? v.name || (isShape(v) ? ui.shapePointName : fallback) : fallback);
            const km = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
            return askWide(token, planned.kind, fi(ui.editWideAsk, { a: name(ends.from, ui.mapStart), b: name(ends.to, ui.mapFinish), km1: km.format(kmBefore / 1000), km2: km.format(whole.distanceMeters / 1000) }), p.change);
          }
          if (second.ok) { runs = [span]; data = again; spliced = whole; verdict = second; }
          else {
            console.warn("mopik: edited line broke again on the whole span", { breaks: second.breaks, missesPlaces: second.missesPlaces, offRoadMeters: second.offRoadMeters });
            // Whole on the second try but for the edit's own place: that is the reason.
            if (second.offRoadMeters) verdict = { ...verdict, offRoadMeters: Math.min(verdict.offRoadMeters ?? Infinity, second.offRoadMeters) };
          }
        }
      }
      // The line is whole and rides every kept place; only the place the
      // edit added or moved is out of reach — said as that, with how far.
      if (!verdict.ok && verdict.offRoadMeters) return unreached(verdict.offRoadMeters);
      // On a relaxed rung a line that will not join is one more way that
      // did not reach the point; on his own profile it is said as it is.
      if (!verdict.ok) return level ? unreached(reachM) : refuse(ui.editBrokenLine, "broken-line");
      // Where the line actually reaches each changed place. A point in a
      // field is answered by the router with a line that turns back at the
      // nearest track, silently; the place follows the line and the rider is
      // told, or — too far to still be the same place — the edit is refused.
      // A stop the edit added or moved remembers where its stretch joined
      // the kept ride, so taking it out again re-routes exactly that stretch.
      // A batch (`add-stops`) has a stretch per group of stops: each new stop
      // remembers the one that went through it.
      const runThrough = (v: { lat: number; lon: number }) =>
        runs.find((run) => run.points.some(([lon, lat]) => lon === v.lon && lat === v.lat)) ?? (planned.kind === "add-stop" || planned.kind === "move-stop" ? runs[0] : null);
      const withJoins: typeof planned.places = planned.kind === "add-stop" || planned.kind === "add-stops" || planned.kind === "move-stop"
        ? {
            ...planned.places,
            vias: planned.places.vias.map((v, i) => {
              if (before.vias.some((b) => b.lat === v.lat && b.lon === v.lon)) return v;
              const through = runThrough(v);
              if (!through) return v;
              // A moved stop keeps the stretch its earlier edit reached.
              const was = planned.kind === "move-stop" ? before.vias[i]?.joins : undefined;
              return { ...v, joins: joinsFor(spliced.coordinates, through, was) };
            }),
          }
        : planned.places;
      const snapped = snapToLine({ line: spliced.coordinates, before, after: withJoins, maxMoveMeters: MOVE_OFFER_MAX_M });
      if ("error" in snapped) return unreached(snapped.meters);
      // A bend the router could not take nearer to where it was dropped is
      // no solution (rule 5): what it re-routed on the way is noise
      // (`bendMissed`) — a more relaxed rung is tried towards the drop.
      if (p.change.kind === "shape" && (p.change.op.kind === "add" || p.change.op.kind === "move")) {
        const drop: Point = [p.change.op.lon, p.change.op.lat];
        const offAfter = nearestAlong(drop, spliced.coordinates, cumulative(spliced.coordinates)).meters;
        // Taking the bend off a spur can leave it nowhere near the drop: the
        // only road there is a dead end. That still reaches the point (rule
        // 1) — asked once more with the bend kept on it, said as a dead end.
        if (bendMissed(reachM, offAfter) && !p.keepSpurs && !p.fallback) return routeProposal({ ...p, keepSpurs: true });
        if (bendMissed(reachM, offAfter)) return unreached(offAfter);
      }
      // Where a grabbed line point was taken only mattered to this edit's
      // plan; the shaping point it became is an ordinary one from here on.
      const settled = { ...snapped.places, vias: snapped.places.vias.map((v) => {
        const { grabbedAt: _g, ...rest } = v; void _g;
        // The point reached straight carries it: taking it out takes its stretch out.
        return straight && v.lon === asked[0][0] && v.lat === asked[0][1] ? { ...rest, reach: "straight" as const } : rest;
      }) };
      const ride: EditedRide = {
        ...spliced,
        overlap: recomputeOverlap(spliced.coordinates),
        summary: summariseSegments(spliced.segments, route.quality.gateCount !== undefined),
        places: settled,
        kind: "edit",
        how: planned.kind,
      };
      // A new stop was put where the line meets it, which may not be the row
      // "+ Pietura" made; after ✓ the rows follow, and the map keeps
      // answering it. Counted among the stops: the rows have none for
      // shaping points.
      const addedStops = planned.places.vias.filter((v) => !isShape(v));
      const addedAt = planned.kind === "add-stop"
        ? addedStops.findIndex((v) => !before.vias.some((b) => b.lat === v.lat && b.lon === v.lon))
        : -1;
      // Said out loud rather than swallowed: the ride goes somewhere slightly
      // different from where the finger landed, and a substitution is never
      // silent. And a stop at the end of a single road — no loop within the
      // bound — is ridden out and back, which the retraced figure will show;
      // the note says why, so the number is not a mystery. A dead end only
      // when the loop search finished and found no other way within its
      // bound; when it ran out of time the note says what the line does and
      // no more (`deadEndUnchecked`, `/api/reroute-leg`). The notes belong
      // to this proposal and go with it — they no longer outlive the edit.
      const deadEndRun = data.runs.reduce<(typeof data.runs)[number] | null>((worst, r) => ((r.deadEndMeters ?? 0) > (worst?.deadEndMeters ?? 0) ? r : worst), null);
      const deadEnd = deadEndRun?.deadEndMeters ?? 0;
      const deadEndKm = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(deadEnd / 1000);
      // A dead end only when the router proved it (`deadEndNoteKey`).
      const deadEndNote = deadEnd > 0 && deadEndRun ? fi(ui[deadEndNoteKey(deadEndRun)], { km: deadEndKm }) : "";
      const notes = [
        snapped.movedMeters > 0 ? fi(ui.resEditMoved, { m: snapped.movedMeters }) : "",
        // Named by whose spur it is (the server says), not by the kind of
        // edit: a bend can leave a neighbouring stop on one.
        deadEndNote,
      ].filter(Boolean);
      const beforeRide = { distanceMeters: edited?.distanceMeters ?? route.distanceMeters, durationSeconds: edited?.durationSeconds ?? route.durationSeconds, overlap: edited?.overlap ?? route.overlap };
      // Rules 2 and 4: outside the profile, or a big detour — said with what
      // and how much, and only „Tomēr braukt” takes it.
      const kmFormat = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
      const outsideM = data.runs.reduce((sum, r) => sum + r.segments.features.reduce((m, f) => m + (f.properties.outsideProfile ? lineMeters(f.geometry.coordinates as Point[]) : 0), 0), 0);
      const rung = level ? profileAt(ownProfile, level) : null;
      if (rung && outsideM > 0) {
        notes.push(fi(ui.editOutsideProfile, { what: rung.drops.map((d) => ui[RELAX_WORDS[d]]).join(", "), km: kmFormat.format(outsideM / 1000) }));
      }
      const risk = detourRisk({
        metersBefore: baseMeters,
        metersAfter: spliced.distanceMeters,
        farthestM: farthestFrom(data.runs.flatMap((r) => coordinatesOf(r.segments)), line),
        reachM,
      });
      if (risk) {
        riskPlus = risk.plusMeters;
        const plus = risk.plusMeters / 1000;
        notes.push(fi(ui.editBigDetour, { km: `${plus >= 0 ? "+" : "−"}${kmFormat.format(Math.abs(plus))}`, far: kmFormat.format(risk.farthestM / 1000) }));
      }
      if (straight) {
        const name = planned.places.vias.find((v) => v.lon === asked[0][0] && v.lat === asked[0][1]);
        const m = Math.round(straight.meters);
        notes.push(fi(ui.editStraightNote, { m: new Intl.NumberFormat(locale).format(m), name: name?.name || ui.shapePointName }));
        if (m > 1000) notes.push(fi(ui.editStraightRisk, { km: kmFormat.format(m / 1000) }));
      }
      // The rider asked for the straight line himself: it waits for „Tomēr
      // braukt” only for a big detour, not for leaving his profile.
      const accept: EditProposal["accept"] = rung && outsideM > 0 && !straight ? "profile" : risk ? "detour" : undefined;
      const proposal: EditProposal = {
        token,
        how: planned.kind,
        before: p.origin ?? before,
        ride,
        // Only what is new: where a routed stretch rides road the ride
        // already had, it is not (`newStretches`). Stacked on another
        // landing, new against the committed ride, all along.
        changed: p.baseRide
          ? newStretches(spliced.coordinates, (edited?.coordinates ?? route.geometry.coordinates) as Point[])
          : changedAlong(spliced.runs, data.runs.map((r) => lineMeters(coordinatesOf(r.segments))), data.runs.map((r) =>
            newStretches(coordinatesOf(r.segments), line))),
        delta: editDelta(beforeRide, ride),
        notes,
        ...(accept ? { accept } : {}),
        ...(level ? { relax: level } : {}),
      };
      // A place still ridden out to and back, when the router did not prove
      // the road a dead end: the stretch may only have been cut too tight for
      // any way on but the way in (rider, 2026-09-28, Lauriņi → Ērgļi: a
      // junction on a through road, ±3 km cut on the far bank, 9.8 km twice).
      // Wider stretches are tried; one that rides through the place, joins
      // soundly and is no longer than the out-and-back is proposed instead.
      if (deadEnd >= WIDEN_MIN_SPUR_M && !deadEndRun?.deadEndProved && !p.widened && !straight && !p.wide && runs.length === 1) {
        const lc = cumulative(line);
        const keptAlong = anchorsAlong(anchorsOf(before, line[line.length - 1]), line, lc);
        const fixed = drawnIntervals(baseSegments);
        const options = WIDEN_STEPS_M.map((by) => widenRun({ run: runs[0], line, cum: lc, keptAlong, fixed, by }))
          .filter((r, i, all): r is EditRun => r !== null && all.findIndex((q) => q && q.fromMeters === r.fromMeters && q.toMeters === r.toMeters) === i);
        const answers = await Promise.all(options.map((r) => request([r], false).catch((): { status: number } => ({ status: 0 }))));
        if (!current()) return;
        const drop: Point | null = p.change.kind === "shape" && (p.change.op.kind === "add" || p.change.op.kind === "move") ? [p.change.op.lon, p.change.op.lat] : null;
        let best: { runs: EditRun[]; data: Routed; meters: number } | null = null;
        options.forEach((r, i) => {
          const a = answers[i];
          if ("status" in a || a.runs.some((x) => (x.deadEndMeters ?? 0) > 0)) return;
          const s = splice([r], a);
          if (!sound(s).ok) return;
          if (drop && bendMissed(reachM, nearestAlong(drop, s.coordinates, cumulative(s.coordinates)).meters)) return;
          if (s.distanceMeters > spliced.distanceMeters + LOOP_EXTRA_FLOOR_M) return;
          if (!best || s.distanceMeters < best.meters) best = { runs: [r], data: a, meters: s.distanceMeters };
        });
        const through = best as { runs: EditRun[]; data: Routed; meters: number } | null;
        if (through) {
          track("route_edit_widened", { spur_m: Math.round(deadEnd), km_delta: Math.round((through.meters - spliced.distanceMeters) / 100) / 10 });
          return routeProposal({ ...p, planned: { ...planned, runs: through.runs }, widened: true, keepSpurs: false, prefetched: through.data });
        }
      }
      // A pass-through point left at the tip of a spur is no solution while
      // another rung may ride through it (rule 5); kept as the fallback,
      // with the dead end said and „Tomēr braukt”, if none does.
      // The first such (the least relaxed rung) is the one kept.
      if (deadEnd > 0 && deadEndRun?.deadEndAtShape) {
        const asked = { ...proposal, accept: accept ?? ("deadEnd" as const), notes: notes.map((n) => (n === deadEndNote && deadEndRun ? fi(ui[deadEndNoteKey(deadEndRun, true)], { km: deadEndKm }) : n)) };
        const fallback: Landing = { proposal: asked, addedAt, runs: runs.length };
        if (profileAt(ownProfile, level + 1)) return routeProposal({ ...p, relax: level + 1, bestOff: Math.min(p.bestOff ?? Infinity, reachM), fallback: p.fallback ?? fallback, keepSpurs: false });
        return land(p.fallback ?? fallback);
      }
      // A stop the rider placed at a real dead end (rider, 2026-09-28): the
      // out-and-back is kept and said in its note („Pietura ir strupceļā –
      // atpakaļ pa to pašu ceļu 0,2 km.”) — a plain proposal, ✓ takes it, no
      // „Tomēr braukt”. Only a pass-through point left on a spur (above), or
      // a profile / detour warning, waits for the override.
      land({ proposal, addedAt, runs: runs.length });
    } catch (e) {
      if (!current() || (e instanceof DOMException && e.name === "AbortError")) return;
      refuse(ui.resEditFailed, "network");
    } finally {
      if (proposalAbort.current === abort) proposalAbort.current = null;
    }
  }

  /**
   * The proposal could not be made. Its reason is the notice and ✓ is
   * disabled; the pending mark stays, so the rider can move it again or ✕.
   * A ✓ already waiting on it is answered `false` — and unless it keeps its
   * marks (a batch), its rows go back to the ride's and the reason stays
   * said once the mark is gone.
   */
  function refuseProposal(token: number, how: EditKind, note: string, reason: string, meters?: number) {
    if (proposalSeq.current !== token) return;
    if (refuseSight(token, note)) return;
    dispatchProposal({ type: "refused", token, reason: note });
    track("route_edit_refused", { how, reason });
    // Which point, and what to do (release B item 1): never the reason alone.
    const named = noteBlocking(token, { reason, meters });
    const waiter = settleWaiter(token, false);
    if (waiter && !waiter.keepOnFailure) {
      live.current = null;
      dispatchProposal({ type: "discard" });
      setEditNote(named ?? note);
      reseed();
    }
  }

  // ── release-b: blocking ──
  /**
   * The proposal was refused or lands warned: which of its new or moved
   * points is why (release B item 1, lib/map/blocking.ts). One point is that
   * point — named at once, and the line returned (for a note that outlives
   * the mark). Several are probed each on its own, in the background: the
   * pre-search reachability probe first (`/api/routable-point`: a road within
   * reach?), then the edit's own routing with only that point (his profile,
   * and the detour it adds). The guidance line says „Meklēju, kurš punkts
   * traucē…” meanwhile, never the bare reason.
   */
  function noteBlocking(token: number, info: { reason?: string; meters?: number | null; accept?: EditProposal["accept"]; plus?: number | null }): string | null {
    const ctx = blockCtx.current;
    if (!ctx || ctx.token !== token || !plan) return null;
    const points = askedPoints(ctx).map((q) => ({ ...q, name: renamed(q.name) }));
    if (!points.length) return null;
    const refused = !info.accept;
    const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
    if (points.length === 1) {
      const b: Blocking = { token, probing: false, points: [{ ...points[0], ...singleCause(info.reason ?? "", info.meters ?? null, info.accept, info.plus) }], total: 1, refused };
      setBlocking(b);
      return blockedLine((k) => ui[k], b, !refused, fmt);
    }
    setBlocking({ token, probing: true, points: [], total: points.length, refused });
    void (async () => {
      const verdicts = await Promise.all(points.map((q) => probePoint(ctx, q).catch((): PointProbe => ({}))));
      if (proposalSeq.current !== token) return;
      const found = blockingFrom(points, verdicts, info.accept);
      track("route_edit_blocked", { points: points.length, blocking: found.length, causes: found.map((f) => f.cause).join(",") });
      // A warned proposal no single point explains keeps its own words (its notes say what, „Tomēr braukt” what to do).
      if (!refused && !found.length) { setBlocking(null); return; }
      setBlocking({ token, probing: false, points: found.map((f) => ({ ...f, name: renamed(f.name) })), total: points.length, refused });
    })();
    return null;
  }

  /** A place's name now: a pin named after its routing started keeps the name it has since (`LiveProposal.renames`). */
  function renamed(name: string): string {
    return live.current?.renames[name]?.name ?? name;
  }

  /** The new or moved points of a proposal, with the titles the sheet gives them. */
  function askedPoints(ctx: BlockCtx): Omit<BlockingPoint, "cause" | "meters">[] {
    const places = ctx.planned.places;
    const all = [places.start, ...places.vias, ...(places.finish ? [places.finish] : [])];
    return ctx.asked.map(([lon, lat]) => {
      const at = all.find((v) => Math.abs(v.lat - lat) < 1e-9 && Math.abs(v.lon - lon) < 1e-9);
      const via = places.vias.indexOf(at as RidePlace);
      const title = !at ? ui.shapePointName
        : at === places.start ? ui.mapStart
        : at === places.finish ? ui.mapFinish
        : isShape(at) ? ui.shapePointName
        : fi(ui.pointStopTitle, { n: places.vias.slice(0, via + 1).filter((v) => !isShape(v) && !v.kind).length });
      return { lat, lon, title, name: at && !isShape(at) ? at.name : "" };
    });
  }

  /** One point of a refused or warned proposal, probed on its own. */
  async function probePoint(ctx: BlockCtx, q: { lat: number; lon: number }): Promise<PointProbe> {
    const known = [ctx.before.start, ...ctx.before.vias, ...(ctx.before.finish ? [ctx.before.finish] : [])];
    const from = known.reduce((best, k) => (haversineMeters([k.lon, k.lat], [q.lon, q.lat]) < haversineMeters([best.lon, best.lat], [q.lon, q.lat]) ? k : best), known[0]);
    // Both asked at once: a road within reach at all (the Confirm-time
    // probe, `/api/routable-point`), and the edit with this point alone.
    const reach = (async (): Promise<number | null> => {
      try {
        const response = await fetch("/api/routable-point", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: q.lat, lon: q.lon, plan: ctx.nextPlan, from: { lat: from.lat, lon: from.lon } }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { ok: boolean; reason?: string; distanceM?: number };
        return !data.ok && data.reason === "too-far-from-road" ? data.distanceM ?? 0 : null;
      } catch { return null; /* not an answer about the point */ }
    })();
    const [tooFar, routed] = await Promise.all([reach, probeAlone(ctx, q).catch((): PointProbe => ({}))]);
    return tooFar !== null ? { tooFar } : routed;
  }

  /** The edit with one point of a batch alone: does his profile reach it, and at what detour? */
  async function probeAlone(ctx: BlockCtx, q: { lat: number; lon: number }): Promise<PointProbe> {
    const others = ctx.asked.filter(([lon, lat]) => lon !== q.lon || lat !== q.lat);
    const isOther = (v: RidePlace) => others.some(([lon, lat]) => v.lon === lon && v.lat === lat);
    const places = ctx.planned.places;
    // A new finish that is not this point: this one's probe would need the old finish back — not asked.
    if (places.finish && isOther(places.finish)) return {};
    const alone: RidePlaces = { ...places, vias: places.vias.filter((v) => !isOther(v)) };
    const cum = cumulative(ctx.line);
    const planned = planEdit({ line: ctx.line, cum, before: ctx.before, after: alone, keepOrder: true, fixed: drawnIntervals(ctx.baseSegments) });
    if (!planned || "error" in planned) return {};
    const response = await fetch("/api/reroute-leg", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: planWithPlaces(ctx.nextPlan, planned.places),
        runs: planned.runs.map((run) => run.points.map(([lon, lat]) => ({ lat, lon }))),
        loops: planned.runs.map((run) => run.points.length >= 3),
        shapes: planned.runs.map((run) => shapeFlags(run, planned.places)),
      }),
    });
    if (response.status === 422) return { routed: "no-road" };
    if (!response.ok) return { routed: "failed" };
    const routed = (await response.json()) as RoutedRuns;
    const spliced = applyRuns({ segments: ctx.baseSegments, distanceMeters: ctx.baseMeters, durationSeconds: 0, runs: planned.runs, routed: routed.runs, keep: anchorsOf(ctx.before, ctx.line[ctx.line.length - 1]) });
    const verdict = spliceIsSound({ segments: spliced.segments, original: ctx.baseSegments, places: planned.places, before: ctx.before, toleranceMeters: MOVE_OFFER_MAX_M });
    if (!verdict.ok && verdict.offRoadMeters) return { tooFar: verdict.offRoadMeters };
    if (!verdict.ok) return { routed: "failed" };
    const risk = detourRisk({
      metersBefore: ctx.baseMeters,
      metersAfter: spliced.distanceMeters,
      farthestM: farthestFrom(routed.runs.flatMap((r) => coordinatesOf(r.segments)), ctx.line),
      reachM: reachOf([[q.lon, q.lat]], ctx.line),
    });
    return { routed: "ok", detourPlus: risk ? risk.plusMeters : null, plusMeters: spliced.distanceMeters - ctx.baseMeters };
  }

  /**
   * „Vest pa taisno” for one point of a batch (release B item 1): the rest
   * of the batch is routed as usual, then that point is reached straight on
   * top of it — one proposal, one ✓, one ↶ step. The live proposal keeps
   * the batch's own change, so ✓ from the composer commits this one.
   */
  function acceptStraightAt(at: { lat: number; lon: number }) {
    const mine = live.current;
    if (!mine || mine.change.kind !== "rows") return;
    const whole = mine.change;
    const row = Object.entries(whole.rows.picked).find(([, v]) => v && Math.abs(v.lat - at.lat) < 1e-9 && Math.abs(v.lon - at.lon) < 1e-9)?.[0];
    if (row === undefined) return;
    const r = Number(row);
    const names = whole.rows.names.filter((_, i) => i !== r);
    const picked: Record<number, ResolvedPlace | null> = {};
    for (const [k, v] of Object.entries(whole.rows.picked)) { const i = Number(k); if (i !== r) picked[i > r ? i - 1 : i] = v; }
    track("route_edit_straight_asked", { batch: true });
    proposePlaces({ kind: "rows", rows: { names, picked } }, { then: at });
    if (live.current) { live.current.change = whole; live.current.key = changeKey(whole); }
  }

  /** The second half of `acceptStraightAt`: the point, straight, on the landed rest. */
  async function straightOnTop(p: Parameters<typeof routeProposal>[0], rest: EditedRide) {
    const at = p.then!;
    const whole = live.current?.change;
    const q = whole?.kind === "rows" ? Object.values(whole.rows.picked).find((v) => v && Math.abs(v.lat - at.lat) < 1e-9 && Math.abs(v.lon - at.lon) < 1e-9) : null;
    if (!q) { refuseProposal(p.token, "add-stop", ui.resEditFailed, "straight-lost"); return; }
    const line = rest.coordinates;
    const before = rest.places;
    const after = insertStopsByAlong(line, before, [{ ...q }]);
    const planned = planEdit({ line, cum: cumulative(line), before, after, fixed: drawnIntervals(rest.segments) });
    if (!planned || "error" in planned) { refuseProposal(p.token, "add-stop", ui.resEditFailed, "straight-lost"); return; }
    await routeProposal({
      ...p, then: undefined, before, planned, baseSegments: rest.segments, line, straight: true, relax: p.relax ?? 0,
      baseRide: { distanceMeters: rest.distanceMeters, durationSeconds: rest.durationSeconds }, origin: p.origin ?? p.before,
    });
  }
  // ── /release-b: blocking ──

  /**
   * The splice broke and only re-routing the whole span would make the
   * change — which would reshape the ride. Said as a refusal with the
   * numbers, and „Pārrēķināt posmu” offered in the notice area
   * (`wideAsk`); only a tap on it makes the whole span the proposal. A ✓
   * already waiting on it is answered no; a batch keeps its marks, so the
   * chip stays usable — a single mark confirmed while routing is let go
   * with the reason said, as any refusal is.
   */
  /**
   * No road reaches the point on any profile: said as the guidance line, and
   * „Vest pa taisno” offered in the notice area (`straightAsk`); a tap routes
   * as far as a road goes and draws the rest straight, as a proposal (✓, one
   * ↶ step). `level` is the rung the road part is routed on.
   */
  function askStraight(token: number, how: EditKind, note: string, change: ProposedChange, level: number, meters?: number) {
    if (proposalSeq.current !== token) return;
    if (refuseSight(token, note)) return;
    dispatchProposal({ type: "refused", token, reason: note });
    track("route_edit_refused", { how, reason: "no-road" });
    const named = noteBlocking(token, { reason: "no-road", meters });
    const waiter = settleWaiter(token, false);
    if (waiter && !waiter.keepOnFailure) {
      live.current = null;
      dispatchProposal({ type: "discard" });
      setEditNote(named ?? note);
      reseed();
      return;
    }
    setStraightAsk({ token, change, level });
  }

  /** „Vest pa taisno”: the refused change, as far as a road goes and then straight — proposed. */
  function acceptStraight() {
    const ask = straightAsk;
    if (!ask || proposalRef.current.phase !== "refused") return;
    track("route_edit_straight_asked", {});
    proposePlaces(ask.change, { straight: ask.level });
  }

  function askWide(token: number, how: EditKind, note: string, change: ProposedChange) {
    if (proposalSeq.current !== token) return;
    dispatchProposal({ type: "refused", token, reason: note });
    track("route_edit_refused", { how, reason: "wide-ask" });
    // A batch: which of its points needs the whole span (a single point is the one it is — the note says what to do).
    if ((blockCtx.current?.token === token ? blockCtx.current.asked.length : 0) > 1) noteBlocking(token, { reason: "wide" });
    const waiter = settleWaiter(token, false);
    if (waiter && !waiter.keepOnFailure) {
      live.current = null;
      dispatchProposal({ type: "discard" });
      setEditNote(note);
      reseed();
      return;
    }
    setWideAsk({ token, change });
  }

  /**
   * ✓ on a landed proposal: the one place a routed edit enters the ride and
   * the undo. Nothing is routed again — what was previewed is what is kept.
   * Refused (returns false) when the ride under it changed since it was
   * routed: a proposal is only ever committed onto the line it was cut from.
   */
  function commitProposal(proposal: EditProposal, whileRouting: boolean): boolean {
    const mine = live.current;
    if (!plan || !route || !mine || mine.token !== proposal.token || !mine.landed || mine.routeId !== route.id || mine.base !== baseNow().segments) return false;
    // A warned proposal enters the ride only through „Tomēr braukt” (`mayCommit`).
    if (!mayCommit(proposal, overrideArmed.current)) return false;
    overrideArmed.current = null;
    const { addedAt, runs, startedAt } = mine.landed;
    // Named after it was routed: the stop keeps the name it has now.
    const next: EditedRide = { ...proposal.ride, places: renamePlaces(proposal.ride.places, mine.renames) };
    setEditsFor((prev) => {
      const own = prev.routeId === route.id;
      return {
        routeId: route.id,
        history: pushEdit(own ? prev.history : NO_EDITS, next),
        original: own && prev.original ? prev.original : { plan, places },
      };
    });
    // The plan and the places follow the line, so Saglabāt, Dalīties, the
    // GPX and "Meklēt labāku apli" all carry the ride that is drawn.
    setPlan(planWithPlaces(plan, next.places));
    setPlaces(resolvedOf(next.places));
    live.current = null;
    dispatchProposal({ type: "committed" });
    // Every chained change is in it: one step of the undo (release B item 4).
    if (chainRef.current.rides.length) track("route_edit_chain_confirmed", { changes: chainRef.current.rides.length + 1 });
    setChain(NO_CHAIN);
    // The proposal's notes were said on the preview; they go with it.
    setEditNote(null);
    reseed(addedAt >= 0 ? addedAt + 1 : undefined);
    const waiter = settleWaiter(proposal.token, true);
    track("route_edit_confirmed", { how: proposal.how, while_routing: whileRouting });
    if (proposal.accept) track("route_edit_override_accepted", { why: proposal.accept, relax: proposal.relax ?? 0 });
    // Timed from ✓ to the frame the new line is painted in — the wait the
    // rider actually sees (≈ 0 for a landed preview; the rest of the routing
    // when ✓ was pressed while it routed).
    const from = waiter?.pressedAt ?? startedAt;
    requestAnimationFrame(() => {
      track("route_edited", {
        how: proposal.how,
        ms: elapsedMsSince(from),
        runs,
        km_delta: Math.round((proposal.delta.kmAfter - proposal.delta.kmBefore) * 10) / 10,
        repeated_before: proposal.delta.repeatedBefore,
        repeated_after: proposal.delta.repeatedAfter,
      });
    });
    return true;
  }

  /**
   * ✕ on a proposal, or its pending mark went away: back to idle. Nothing was
   * written — the history and the line are exactly what they were — so this
   * only stops the work and forgets the answer.
   */
  function discardProposal() {
    stopProposalWork();
    overrideArmed.current = null;
    setBlocking(null);
    setWideAsk(null);
    setStraightAsk(null);
    const token = proposalSeq.current;
    proposalSeq.current += 1;
    live.current = null;
    settleWaiter(token, false);
    const state = proposalRef.current;
    if (state.phase === "idle") return;
    track("route_edit_discarded", { how: state.phase === "proposed" ? state.proposal.how : state.how, phase: state.phase });
    dispatchProposal({ type: "discard" });
  }

  // ── release-b: chain ──
  /**
   * Another edit starts while a proposal is shown (release B item 4): the
   * landed proposal is stacked — kept, not committed — and the rows follow
   * it, so the next edit is cut from it. Returns whether it stacked.
   */
  function stackProposal(extra?: { notes: string[]; dropMoved?: boolean }): boolean {
    const s = proposalRef.current;
    const mine = live.current;
    if (!route || s.phase !== "proposed" || !mine || mine.token !== s.proposal.token || !mine.landed) return false;
    // A sight's reach note says where the stop went; „Punkts pārvietots N m” would say it twice.
    const movedHead = fi(ui.resEditMoved, { m: "\u0000" }).split("\u0000")[0];
    const notes = extra ? [...s.proposal.notes.filter((n) => !(extra.dropMoved && n.startsWith(movedHead))), ...extra.notes] : s.proposal.notes;
    const kept: EditProposal = { ...s.proposal, notes, ride: { ...s.proposal.ride, places: renamePlaces(s.proposal.ride.places, mine.renames) } };
    stopProposalWork();
    live.current = null;
    proposalSeq.current += 1;
    overrideArmed.current = null;
    setWideAsk(null);
    setStraightAsk(null);
    setBlocking(null);
    setChain(stackOnto(chainRef.current, route.id, kept));
    dispatchProposal({ type: "stacked" });
    setEditNote(null);
    reseed();
    track("route_edit_stacked", { changes: chainRef.current.rides.length, how: kept.how });
    return true;
  }

  /** ↶ while edits are chained: the proposal on top goes, else the chain's own top. */
  function chainUndo() {
    if (proposalRef.current.phase !== "idle") { discardProposal(); reseed(); return; }
    if (!chainRef.current.rides.length) return;
    track("route_edit_chain_undone", { changes: chainRef.current.rides.length });
    setChain(popChain(chainRef.current));
    setEditNote(null);
    reseed();
  }

  /** ✕ while edits are chained: all of them go; the ride is what was committed. */
  function chainDiscard() {
    const n = chainCount(chainRef.current, proposalRef.current);
    discardProposal();
    if (!chainRef.current.rides.length) return;
    track("route_edit_chain_discarded", { changes: n });
    setChain(NO_CHAIN);
    setEditNote(null);
    reseed();
  }

  /** ✓ with nothing new on the chain: its top — every chained change — is ONE step of the undo. */
  function chainConfirm(): boolean {
    const top = chainTopOf(chainRef.current);
    if (!plan || !route || !top || proposalRef.current.phase !== "idle") return false;
    if (!mayCommit(top, overrideArmed.current)) return false;
    overrideArmed.current = null;
    setEditsFor((prev) => {
      const own = prev.routeId === route.id;
      return { routeId: route.id, history: pushEdit(own ? prev.history : NO_EDITS, top.ride), original: own && prev.original ? prev.original : { plan, places } };
    });
    setPlan(planWithPlaces(plan, top.ride.places));
    setPlaces(resolvedOf(top.ride.places));
    track("route_edit_chain_confirmed", { changes: chainRef.current.rides.length });
    if (top.accept) track("route_edit_override_accepted", { why: top.accept, relax: top.relax ?? 0 });
    setChain(NO_CHAIN);
    setEditNote(null);
    reseed();
    return true;
  }

  /**
   * A change of places on the same line (a kind switch, a point dropped on
   * the line) while edits are chained: stacked like the rest, so ✓ still
   * commits one step and ↶ takes it off again.
   */
  function stackPlaces(next: RidePlaces): boolean {
    const top = chainTopOf(chainRef.current);
    if (!route || !top) return false;
    const token = ++proposalSeq.current;
    setChain(stackOnto(chainRef.current, route.id, { ...top, token, ride: { ...top.ride, places: next }, notes: [] }));
    setEditNote(null);
    reseed();
    return true;
  }
  // ── /release-b: chain ──

  /**
   * The composer's pending mark changed (`RideEdit.onPropose`): route it in
   * the background. The same change again routes nothing; a stream of
   * changes (a pin being dragged) routes the first at once and then waits
   * for 250 ms of quiet.
   */
  /** „Pārrēķināt posmu”: the refused change, re-routed as the whole span and proposed. */
  function acceptWide() {
    const ask = wideAsk;
    if (!ask || proposalRef.current.phase !== "refused") return;
    track("route_edit_wide_accepted", {});
    proposePlaces(ask.change, { wide: true });
  }

  function proposeChange(change: ProposedChange | null) {
    if (!change) { discardProposal(); return; }
    // A kind switch changes no line: it is committed at once, never previewed.
    if (isKindSwitch(change) || commitWaiter.current || !route) return;
    const mine = live.current;
    if (mine && mine.key === changeKey(change) && mine.base === baseNow().segments && proposalRef.current.phase !== "idle") return;
    // ── edit-routing ── The dropped pin's name arrived: the same line, so
    // the routing already under way (or landed) stands — the name goes into
    // the places it commits, and ✓ recognises the renamed change as its own.
    if (mine && mine.base === baseNow().segments && proposalRef.current.phase !== "idle" && sameGeometry(mine.change, change)) {
      mine.renames = renamesBetween(mine.change, change, mine.renames);
      mine.change = change;
      mine.key = changeKey(change);
      // A blocking point named under its spot takes its name too (release B item 1).
      const names = mine.renames;
      setBlocking((b) => (!b || b.token !== mine.token ? b : { ...b, points: b.points.map((q) => (names[q.name] ? { ...q, name: names[q.name].name } : q)) }));
      return;
    }
    // ── /edit-routing ──
    const now = performance.now();
    const delay = proposeDelay(lastProposeAt.current, now);
    lastProposeAt.current = now;
    proposePlaces(change, { delay });
  }

  /**
   * ✓ — `onCommit` / `onShape` with a change. The change already landed:
   * commit that proposal, route nothing. The change still routing: confirm
   * when it lands. Anything else (no preview was asked for, or a different
   * change): route it now and commit it the moment it lands. Resolves to
   * whether it landed on the line.
   */
  function confirmChange(change: ProposedChange, opts: { keepOnFailure?: boolean } = {}): Promise<boolean> {
    // Never a silent no-op (2026-09-25): a change committed while another
    // is still being committed says so.
    if (!plan || !result || !route || !ridePlaces) return Promise.resolve(false);
    if (commitWaiter.current) { setEditNote(ui.resEditRouting); return Promise.resolve(false); }
    const key = changeKey(change);
    const state = proposalRef.current;
    const mine = live.current;
    const sameBase = Boolean(mine && mine.key === key && mine.routeId === route.id && mine.base === baseNow().segments);
    if (sameBase && state.phase === "proposed" && state.proposal.token === mine?.token) {
      return Promise.resolve(commitProposal(state.proposal, false));
    }
    // Already refused, and the reason is on screen: asking again changes nothing.
    if (sameBase && state.phase === "refused" && state.token === mine?.token) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const waiter = { resolve, keepOnFailure: Boolean(opts.keepOnFailure), pressedAt: startClock() };
      if (sameBase && state.phase === "routing" && state.token === mine?.token) {
        commitWaiter.current = { ...waiter, token: state.token };
        setCommitting(true);
        dispatchProposal({ type: "confirm" });
        // Still in the drag debounce: no reason to wait any longer.
        const pending = proposeTimer.current;
        if (pending) { clearTimeout(pending.timer); pending.run(); }
        return;
      }
      proposePlaces(change, { confirm: waiter });
    });
  }

  /** A change the rider confirmed in the editor's rows (`RideEdit.onCommit`). */
  function commitEdit(rows: { names: string[]; picked: Record<number, ResolvedPlace | null> }, opts: { keepOnFailure?: boolean } = {}): Promise<boolean> {
    return confirmChange({ kind: "rows", rows }, opts);
  }

  /**
   * A point on the map added, moved, taken out or switched (`RideEdit.onShape`).
   * The first three change the line and go through the proposal, exactly as a
   * stop would; a kind switch does not and is committed at once.
   */
  function commitShape(op: ShapeEdit) {
    if (op.kind === "promote" || op.kind === "demote") { switchKind(op); return; }
    track("shape_point_edited", { kind: op.kind });
    void confirmChange({ kind: "shape", op });
  }

  /**
   * „Padarīt par pieturu” / „Padarīt caurbraucamu”: the point stays where it
   * is and so does the line — the dot already is where the ride goes — so
   * the ride is kept and only its places change, committed at once as one
   * step of the undo.
   */
  function switchKind(op: Extract<ShapeEdit, { kind: "promote" | "demote" }>) {
    if (!plan || !result || !route || !ridePlaces || commitWaiter.current) return;
    // A proposal on top of a chain is stacked first; the switch goes on top.
    if (chainRef.current.rides.length) stackProposal();
    const topNow = chainTopOf(chainRef.current);
    const before = topNow?.ride.places ?? ridePlaces;
    const next = applyShapeEdit(before, op);
    if ("error" in next) {
      track("route_edit_failed", { reason: next.error });
      setEditNote(next.error === "stop-cap" ? fi(ui.mapAddStopFull, { n: MAX_STOPS }) : next.error === "shape-cap" ? fi(ui.shapeCapNote, { n: MAX_SHAPE_POINTS }) : ui.resEditFailed);
      return;
    }
    // Whatever was previewed was cut from the places this changes.
    discardProposal();
    if (op.kind === "promote") track("shape_point_edited", { kind: op.kind });
    const baseLine = topNow?.ride.coordinates ?? edited?.coordinates ?? (route.geometry.coordinates as Point[]);
    // A promoted dot goes onto the line, if it was a little off it (a plan's
    // shaping point is where the rider put it, the line where the router
    // went): a stop is held to the line it is on, and this one is on it by
    // construction. A demoted stop stays exactly where it was.
    const cum = cumulative(baseLine);
    const switched: RidePlaces = op.kind === "demote" ? next : {
      ...next,
      vias: next.vias.map((v) => {
        if (isShape(v) || before.vias.some((b) => !isShape(b) && b.lat === v.lat && b.lon === v.lon)) return v;
        const near = nearestAlong([v.lon, v.lat], baseLine, cum);
        if (near.meters <= 1) return v;
        const [lon, lat] = pointAtDistance(baseLine, cum, near.alongMeters).point;
        return { ...v, lat, lon };
      }),
    };
    // `EditedRide.how` has no "demote" (yet): both switches are the undo's
    // "promote", a change of a point's kind; `point_kind_switched` says which.
    // Chained (release B item 4): one more change on the chain.
    if (!stackPlaces(switched)) commitPlacesOnLine(switched, "promote");
    track("point_kind_switched", { to: op.kind === "promote" ? "stop" : "pass", mode: "edit" });
  }

  /**
   * New places on the SAME line — a kind switch, a pass-through point dropped
   * on the line — committed at once as one step of the undo: the ride keeps
   * its line and numbers, only its places change.
   */
  function commitPlacesOnLine(next: RidePlaces, how: EditedRide["how"]) {
    if (!plan || !route) return;
    const baseLine = edited?.coordinates ?? (route.geometry.coordinates as Point[]);
    const keep: EditedRide = edited
      ? { ...edited, places: next, kind: "edit", how }
      : {
          coordinates: baseLine,
          segments: route.segments,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          overlap: route.overlap,
          summary: summariseSegments(route.segments, route.quality.gateCount !== undefined),
          places: next,
          kind: "edit",
          how,
        };
    setEditsFor((prev) => {
      const mine = prev.routeId === route.id;
      return { routeId: route.id, history: pushEdit(mine ? prev.history : NO_EDITS, keep), original: mine && prev.original ? prev.original : { plan, places } };
    });
    setPlan(planWithPlaces(plan, next));
    setPlaces(resolvedOf(next));
    setEditNote(null);
    reseed();
  }

  // ── edit-routing ──
  /**
   * A place committed under its spot — ✓ pressed while the pin was still
   * being named (rider, 2026-09-28: the routing never waits for the name) —
   * gets its name: in the proposal still routing, for when it commits; in the
   * ride it already went into, in place, without a step of the undo.
   */
  function renamePlace(from: ResolvedPlace, to: ResolvedPlace) {
    const mine = live.current;
    if (mine && mine.change.kind === "rows") mine.renames = renamesBetween({ kind: "rows", rows: { names: [from.name], picked: { 0: from } } }, { kind: "rows", rows: { names: [to.name], picked: { 0: to } } }, mine.renames);
    const current = edited;
    if (!current || !route || !plan) return;
    const all = [current.places.start, ...current.places.vias, current.places.finish];
    if (!all.some((v) => v && v.name === from.name)) return;
    const renamed = renamePlaces(current.places, { [from.name]: { name: to.name, label: to.label } });
    setEditsFor((prev) => (prev.routeId !== route.id || prev.history.current !== current ? prev
      : { ...prev, history: { ...prev.history, current: { ...current, places: renamed } } }));
    setPlan(planWithPlaces(plan, renamed));
    setPlaces(resolvedOf(renamed));
  }
  const renameRef = useRef(renamePlace);
  useEffect(() => { renameRef.current = renamePlace; });
  // ── /edit-routing ──

  // ── line-sheet ──
  /**
   * „Pievienot punktu šeit” on the line's sheet (lib/map/line-sheet.ts): a
   * pass-through point exactly on the line at the tapped spot, in the leg it
   * is in. The line already rides through it, so nothing is routed — one
   * commit, one step of the undo, the line identical.
   */
  function dropPassHere(spot: { lat: number; lon: number; alongMeters: number }) {
    if (!plan || !result || !route || !ridePlaces || commitWaiter.current) return;
    if (chainRef.current.rides.length) stackProposal();
    const topNow = chainTopOf(chainRef.current);
    const baseLine = topNow?.ride.coordinates ?? edited?.coordinates ?? (route.geometry.coordinates as Point[]);
    const next = passOnLine(topNow?.ride.places ?? ridePlaces, baseLine, spot);
    if ("error" in next) {
      track("route_edit_failed", { reason: next.error });
      setEditNote(next.error === "shape-cap" ? fi(ui.shapeCapNote, { n: MAX_SHAPE_POINTS }) : ui.resEditFailed);
      return;
    }
    // Whatever was previewed was cut from the places this changes.
    if (stackPlaces(next.places)) { track("line_point_added", { chained: true }); return; }
    discardProposal();
    commitPlacesOnLine(next.places, "add-stop");
    track("line_point_added", {});
  }
  // ── /line-sheet ──

  /**
   * One step back: the ride exactly as it was on screen before the last edit.
   *
   * Undoing the first edit returns to the ride the API searched for, and the
   * plan and places go back with it — or a shared ride would carry a stop the
   * line no longer goes through.
   */
  function undoLastEdit() {
    // Chained edits first: ↶ takes the last pending change off (release B item 4).
    if (chainRef.current.rides.length && route && chainRef.current.routeId === route.id) { chainUndo(); return; }
    if (!route || !history.canUndo || commitWaiter.current) return;
    // A preview was cut from the line the undo is about to replace.
    discardProposal();
    track("route_edit_undone", { how: history.current?.how ?? "" });
    const nextHistory = undoEdit(history);
    setEditsFor({ routeId: route.id, history: nextHistory, original: editsFor.original });
    const restored = nextHistory.current;
    if (restored && plan) {
      setPlan(planWithPlaces(plan, restored.places));
      setPlaces(resolvedOf(restored.places));
    } else if (editsFor.original) {
      setPlan(editsFor.original.plan);
      setPlaces(editsFor.original.places);
    }
    setEditNote(null);
    reseed();
  }

  /**
   * "Meklēt labāku apli ar šīm pieturām": the full search, asked for by name.
   *
   * With the places the ride has now — the edited ones, when it was edited —
   * plus any sights ticked and not yet kept. It can find a genuinely cleaner
   * loop through the same places, and it must stay available rather than be
   * silently traded away for speed; but it is the rider's tap, never what an
   * edit quietly does. It goes through `startFromForm`, so the summary, the
   * form to go back to, the analytics and cancelling are the ones that already
   * exist, and the coordinates travel as picked places so "Pilskalns" is the
   * hillfort on this map. The new ride replaces the edited one, and the kicker
   * that said "Labots ar roku" goes with it.
   */
  function searchBetterLoop() {
    if (busyRef.current || !plan) return;
    // Design F2: never on a ride with drawn stretches — the search would drop
    // them (the panel's button is off and says so; this is the belt).
    if (drawnMeters((edited?.segments ?? route?.segments)?.features ?? []) > 0) return;
    // Already-present names are dropped rather than duplicated: the rider may
    // have ticked something a previous pass put in the ride.
    const fresh = selectedPois.filter((p) => !plan.viaPlaces.includes(p.name));
    if (fresh.length === 0 && !edited) { setSelectedPois([]); return; }
    // The plan carries at most `MAX_STOPS` stops (`RidePlanSchema`); the card
    // disables its own button past that, and this is the belt to that brace.
    if (plan.viaPlaces.length + fresh.length > MAX_STOPS) return;
    if (fresh.length > 0) track("suggestion_added", { via_count: plan.viaPlaces.length + fresh.length, batch: fresh.length });
    track("search_better_loop", { pois: fresh.length, after_edit: Boolean(edited) });
    // The full search keeps the stops and drops the shaping points (rider,
    // 2026-09-25): they bent the line this ride has, and the search looks for
    // a different one — the panel says so beside the button.
    const next: RidePlan = { ...planForFullSearch(plan), viaPlaces: [...plan.viaPlaces, ...fresh.map((p) => p.name)] };
    const names = new Set(fresh.map((p) => p.name));
    const picked: ResolvedPlace[] = [
      ...places.filter((p) => !names.has(p.name)),
      ...fresh.map((p) => ({ name: p.name, label: p.name, lat: p.lat, lon: p.lon, kind: p.category, poiId: p.id })),
    ];
    // The ticks belong to the ride that is being replaced: the new one comes
    // with its own suggestions, and these places are about to be vias rather
    // than offers.
    setSelectedPois([]);
    setFocusPoi(null);
    setEditMode(false);
    void startFromForm(next, picked);
  }

  /**
   * "Pievienot izvēlētos": the ticked sights become part of the ride, with no
   * search at all.
   *
   * This is the rider's complaint answered. Ticking a sight already splices a
   * real routed detour into the drawn line in milliseconds — but *keeping* it
   * went through the full 36-candidate search and cost him 20-30 s, so the
   * fast path existed and was thrown away by the very press meant to act on
   * it. Now the press keeps the line that is already on the screen: the
   * geometry is the spliced one, the numbers are recomputed from it, and the
   * sights are written into the plan as vias so sharing, saving, the GPX and
   * any later search all carry them.
   *
   * Costs nothing when the detours are prefetched, which is the common case —
   * the rider has been reading the list while they routed.
   *
   * **The search is not lost, it is moved.** "Meklēt labāku apli ar šīm
   * pieturām" sits beside this and runs exactly what this used to run: it can
   * find a cleaner loop through the same places, and that must stay available
   * rather than being silently traded away for speed. Which one the rider gets
   * is his tap, never our choice.
   */
  function commitSelection() {
    if (busyRef.current || !plan || selectedPois.length === 0) return;
    const fresh = selectedPois.filter((p) => !plan.viaPlaces.includes(p.name));
    if (fresh.length === 0) { setSelectedPois([]); return; }
    if (plan.viaPlaces.length + fresh.length > MAX_STOPS) return;
    // Nothing spliced means nothing was routed to splice — every ticked place
    // is still pending or unreachable. Falling through to the search would be
    // the slow path arriving unannounced, so the press simply waits.
    if (!spliced || spliced.applied.length === 0) return;
    commitSights(fresh, spliced);
  }

  /** The sights in `fresh` that `spliced` carries, into the ride — the list's „Pievienot” and the map card's alike. */
  function commitSights(fresh: SelectedPoi[], spliced: SplicedRoute): boolean {
    if (!plan || !route || !ridePlaces) return false;

    const startedAt = startClock();
    const coordinates = spliced.coordinates as Point[];
    const appliedIds = new Set(spliced.applied.map((d) => d.poiId));
    const addedInOrder = spliced.applied
      .map((d) => fresh.find((p) => p.id === d.poiId))
      .filter((p): p is SelectedPoi => Boolean(p));
    // The sights become stops, each where the spliced line reaches it: they
    // are somewhere the ride already passes near, so they belong in the order
    // the line meets them rather than at a position the rider never chose —
    // and a later edit or search plans through them in that order.
    const added: RidePlace[] = addedInOrder.map((p) => ({ name: p.name, label: p.name, lat: p.lat, lon: p.lon, kind: p.category, poiId: p.id }));
    const nextPlaces = insertStopsByAlong(coordinates, ridePlaces, added);
    // Reclassified from the spliced line, the way an edit is: the km, time,
    // surfaces and retraced share all describe the ride that is drawn.
    const edit: EditedRide = {
      coordinates,
      segments: spliced.segments,
      distanceMeters: spliced.distanceMeters,
      durationSeconds: spliced.durationSeconds,
      overlap: recomputeOverlap(coordinates),
      summary: summariseSegments(spliced.segments, route.quality.gateCount !== undefined),
      places: nextPlaces,
      // Still a hand-edited ride if it was one before the sights went in:
      // keeping Mopik's suggestions does not undo the rider's own correction,
      // and the kicker that says so must not disappear with the commit.
      kind: edited?.kind === "edit" ? "edit" : "commit",
      how: "sights",
    };
    setEditsFor((prev) => {
      const mine = prev.routeId === route.id;
      return {
        routeId: route.id,
        history: pushEdit(mine ? prev.history : NO_EDITS, edit),
        original: mine && prev.original ? prev.original : { plan, places },
      };
    });
    // Written into the plan too, so the ride the rider can share, save, export
    // or hand back to the search carries these places rather than only the
    // picture doing.
    setPlan(planWithPlaces(plan, nextPlaces));
    setPlaces(resolvedOf(nextPlaces));
    // A tick whose detour overlapped another's could not be spliced, so it is
    // not in the ride and its tick stays — the card already says why, and
    // dropping it here would quietly lose a place the rider asked for.
    setSelectedPois(selectedPois.filter((p) => !appliedIds.has(p.id)));
    setFocusPoi(null);
    setEditNote(null);
    setSightNote(null);
    track("sights_committed", {
      pois: spliced.applied.length,
      delta_km: Math.round((spliced.addedMeters / 1000) * 10) / 10,
      ms: elapsedMsSince(startedAt),
    });
    return true;
  }

  // ── sights-add ── „Pievienot braucienam” on the map card (backlog 46).
  //
  // It adds the sight to the ride, through the list's own path: on a result
  // the detour splice (`commitSights`), in edit mode a proposal with its
  // preview, chip and ✓ ↶ ✕ like every other edit. When the ride cannot
  // come closer to the sight than it already was, that is said, with the
  // distance — never a line that barely moves and nothing said.

  const sightFmt = (n: number) => new Intl.NumberFormat(locale).format(n);
  function dismissSightNote() { setSightNote(null); }
  const tl = (k: MessageKey) => ui[k];

  function addFocusedToRide() {
    const poi = focusPoi?.poi;
    if (!poi) return;
    if (editMode) addSightInEdit(poi);
    else addSightOnResult(poi);
  }

  function addSightOnResult(poi: SelectedPoi) {
    if (busyRef.current || !plan || !shownRoute) return;
    if (plan.viaPlaces.includes(poi.name)) { setFocusPoi(null); return; }
    const detour = detoursForMap[poi.id];
    // Not routed yet: the card says „Pievienoju…”, and it is added when it is.
    if (!detour) {
      setSightWaiting(poi);
      setFocusPoi((c) => (c ? { ...c, adding: true } : c));
      return;
    }
    setSightWaiting(null);
    if (!detour.ok) { setFocusPoi(null); setSightNote(sightRefusedLine(tl, poi.name, ui.resDetourUnreachable)); return; }
    const one = spliceDetours({ segments: shownRoute.segments, distanceMeters: shownRoute.distanceMeters, durationSeconds: shownRoute.durationSeconds, detours: [detour] });
    if (!one.applied.length) { setFocusPoi(null); setSightNote(sightRefusedLine(tl, poi.name, ui.resEditFailed)); return; }
    const lineMeters = metersToLine(poi, shownRoute.geometry.coordinates as Point[]);
    if (!commitSights([poi], one)) return;
    const reach = sightReach({ lineMeters, reachedMeters: metersToLine(poi, one.coordinates) });
    const km = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(one.addedMeters / 1000);
    setSightNote(sightReachLine(tl, poi.name, reach, sightFmt) ?? sightAddedLine(tl, poi.name, `${one.addedMeters >= 0 ? "+" : "−"}${km.replace("-", "")}`));
    track("sight_added_from_map", { mode: "result", reach: reach?.kind ?? "reached" });
  }

  useEffect(() => { addSightRef.current = addSightOnResult; });

  function addSightInEdit(poi: SelectedPoi) {
    if (!plan || !route || !ridePlaces || commitWaiter.current) return;
    // A change of the composer's own is pending: it is his to ✓ or ✕ first.
    if (proposalRef.current.phase !== "idle") { setEditNote(ui.sightFinishFirst); return; }
    const top = chainTopOf(chainRef.current.routeId === route.id ? chainRef.current : NO_CHAIN);
    const before = top?.ride.places ?? ridePlaces;
    const line = (top?.ride.coordinates ?? edited?.coordinates ?? route.geometry.coordinates) as Point[];
    const sight: ResolvedPlace = { name: poi.name, label: poi.name, lat: poi.lat, lon: poi.lon, kind: poi.category, poiId: poi.id };
    const rows = rowsWithSight(before, sight, line);
    setFocusPoi(null);
    if (!rows) { setEditNote(sightRefusedLine(tl, poi.name, ui.resEditFailed)); return; }
    const lineMeters = metersToLine(poi, line);
    proposePlaces({ kind: "rows", rows });
    track("sight_added_from_map", { mode: "edit" });
    // Nothing about the line changes: the stop is on the road the ride has.
    if (!live.current) {
      setEditNote(sightReachLine(tl, poi.name, sightReach({ lineMeters, reachedMeters: lineMeters }), sightFmt) ?? sightAddedLine(tl, poi.name, "+0"));
      return;
    }
    sightAsk.current = { token: live.current.token, name: poi.name, lat: poi.lat, lon: poi.lon, lineMeters };
  }

  /** The sight's proposal landed: its reach said, and stacked so the bar's ✓ ↶ ✕ act on it. */
  function landSight(proposal: EditProposal) {
    const ask = sightAsk.current;
    sightAsk.current = null;
    if (!ask) return;
    const reach = sightReach({ lineMeters: ask.lineMeters, reachedMeters: metersToLine(ask, proposal.ride.coordinates as Point[]) });
    const line = sightReachLine(tl, ask.name, reach, sightFmt);
    stackProposal({ notes: line ? [line] : [], dropMoved: Boolean(line) });
  }

  /** The sight's proposal was refused: said with its name and what to do; no chip left without a bar. */
  function refuseSight(token: number, note: string): boolean {
    const ask = sightAsk.current;
    if (!ask || ask.token !== token) return false;
    sightAsk.current = null;
    live.current = null;
    dispatchProposal({ type: "discard" });
    setEditNote(sightRefusedLine(tl, ask.name, note));
    track("route_edit_refused", { how: "add-stop", reason: "sight" });
    return true;
  }
  // ── /sights-add ──

  /**
   * The tick inside the card the map opens on a focused suggestion.
   *
   * The card is markup MapLibre parses from a string, so it carries no closure
   * of its own and calls this instead. It ticks rather than re-plans, because
   * the map card and the list row are two views of the same offer and must
   * mean the same thing — the rider who rings a place on the map and ticks it
   * there should find it ticked in the list, and pay for the ride once.
   *
   * The ring stays: the place is now marked, and the marker is the answer to
   * "did that work?". The card's own label is re-rendered through `picked`.
   */
  function toggleFocusedPoi() {
    if (!focusPoi?.poi) return;
    toggleSelectPoi(focusPoi.poi);
    setFocusPoi((current) => (current ? { ...current, picked: !current.picked } : current));
  }

  /**
   * A way out of a ride no candidate could route: the same ride without its
   * stops, or on an easier profile (`easierPlan`). The plan on screen follows,
   * so the summary says what is being searched now.
   */
  async function retryChanged(how: "drop-stops" | "easier-profile") {
    if (!retry || retry.stage !== "route" || busyRef.current) return;
    const base = retry.plan;
    const next = how === "drop-stops" ? { ...base, viaPlaces: [] } : easierPlan(base);
    if (!next) return;
    track("route_no_route_retry", { how });
    const stops = new Set(base.viaPlaces);
    const nextPlaces = how === "drop-stops" ? places.filter((p) => !stops.has(p.name)) : places;
    busyRef.current = true; setError(null); setQuickReplies([]);
    setPlan(next); setPlaces(nextPlaces);
    try { await generate(next, retry.messages, nextPlaces); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  async function retryLast() {
    if (!retry || busyRef.current) return;
    busyRef.current = true; setError(null);
    try { if (retry.stage === "chat") await converse(retry.messages, retry.plan); else await generate(retry.plan, retry.messages); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  /**
   * The sights near the ride on screen, asked for as soon as there is one.
   *
   * The rider asked for the places already on his route to be marked on the
   * map "as soon as the list has loaded", without him opening the card. That
   * makes the map a consumer of this list, so the page has to own it: the
   * result panel used to fetch it lazily when its own card was opened, which
   * a map drawn before any card is touched could never wait for. The card now
   * reads the same state through props, so the two cannot disagree, and the
   * endpoint answers a pre-baked dataset in single-digit milliseconds.
   */
  const { pois: routePois, loading: poisLoading, failed: poisFailed } = useRoutePois({
    rideId: shownRoute?.id ?? null,
    coordinates: shownRoute?.geometry?.coordinates ?? null,
    locale,
  });

  /**
   * The waiting `?ask=` correction, sent on the render that first has the plan
   * it corrects — `send` reads the plan from state, so it cannot run in the
   * effect that sets it. The ref is cleared first, so a re-run sends nothing.
   * The timeout keeps the work out of the effect body itself.
   */
  useEffect(() => {
    if (!askRef.current || !plan) return;
    const ask = askRef.current;
    askRef.current = null;
    const id = setTimeout(() => { void send(ask); }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` is re-created every render; the ref guard is what makes this run once
  }, [plan]);
  /**
   * A plan that arrived with `?go=1`: generate it now, through the path the
   * form uses.
   *
   * Same shape as the `?ask=` effect above and for the same reasons —
   * `startFromForm` reads nothing from state that this render has not got, but
   * the *places* it must be given are the ones the URL carried, and those
   * arrive in state a render after the plan. So the run waits for `plan`,
   * takes `places` as they are by then, and the ref guard makes it happen once
   * however many times StrictMode re-runs it.
   *
   * Deliberately `startFromForm` rather than a path of its own: the rider who
   * pressed Pievienot on a saved ride should land in exactly the ride a rider
   * who typed the same stops into the form would get — same summary bubble,
   * same cancel-back-to-the-form behaviour, same `form_generate` event.
   */
  useEffect(() => {
    if (!goRef.current || !plan) return;
    goRef.current = false;
    const current = plan;
    const picked = places;
    const id = setTimeout(() => { void startFromForm(current, picked); }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `startFromForm` is re-created every render; the ref guard is what makes this run once
  }, [plan]);
  /**
   * What the POI dataset knows about the ride's stops, by name.
   *
   * Derived from the page's own POI lookup — the same request the card and the
   * map's marks read, so a stop's marker costs nothing extra — and read to put
   * a kind ("pilskalns") in a stop's card instead of only its name. A stop the
   * dataset does not know keeps the plain "Pieturvieta" card, which is also
   * what every ride outside the Baltics gets.
   *
   * Derived rather than held in state, which is what it used to be. The panel
   * reported this list asynchronously and the set therefore had to carry the
   * ride it described, so a set arriving after a new ride was not applied to
   * it. The page now owns the lookup and `useRoutePois` nulls the list the
   * moment the ride changes, so "which ride is this about" is no longer a
   * question that can be answered wrongly — and the setState-in-an-effect that
   * used to answer it is gone with it.
   */
  const stopKinds = useMemo(() => {
    const kinds: Record<string, { kind: string }> = {};
    for (const p of [...(routePois?.onRoute ?? []), ...(routePois?.nearby ?? [])]) {
      const entry = POI_KIND[p.category as keyof typeof POI_KIND];
      if (entry) kinds[p.name] = { kind: ui[entry.key as keyof typeof ui] ?? p.category };
    }
    return kinds;
  }, [routePois, ui]);

  // What the API actually routed through, in riding order. These are the
  // coordinates worth keeping in a share code — they made this route, rather
  // than being a fresh guess at what the names mean.
  const routedPlaces: ResolvedPlace[] | null = edited
    ? resolvedOf(edited.places)
    : result
    ? [result.start, ...(result.via ?? []), ...(result.destination ? [result.destination] : [])]
        .map((p) => {
          // The POI kind is carried over from the picked place, so a ride
          // saved or shared reopens with its sights still drawn as sights.
          // Without this the share code's `pl` rows all come back four
          // elements long — the coordinates survive the trip and the kind
          // does not, and a reopened ride shows 🅿️ on a waterfall.
          const picked = places.find((q) => q.kind && (q.name === p.label || q.label === p.label));
          return {
            name: p.label, label: p.label, lat: p.lat, lon: p.lon,
            ...(picked ? { kind: picked.kind, poiId: picked.poiId } : {}),
          };
        })
    : null;
  // One map, two homes. On a desktop it is the sticky right column; on a phone
  // it belongs inside the ride block, under the places it confirms — above the
  // whole page it outranked even ui.savedRides and read as a separate thing.
  const desktop = useMediaQuery(DESKTOP_QUERY);
  /**
   * The form is the view: the rider is composing a ride, not reading one.
   *
   * What separates the map that accepts a tap as a new stop from the map that
   * does not. The result map is a separate job the rider has not asked for
   * yet, and a stop added to a ride that has already been generated would have
   * nowhere to go.
   *
   * `wiring` is what the map is handed because of it. The pick flow hangs from
   * the view, not from `picking` alone: that flag is the composer's report and
   * outlived the composer — it stayed up under the generated ride, and every
   * tap on the result map dropped a violet marker with nothing to answer to.
   * See `lib/map/map-wiring.ts`.
   */
  const wiring = mapWiring({ entryMode, hasResult: Boolean(result), rowActive: picking, editing: editMode });
  const planning = wiring.planning;
  /**
   * The stops the map pins, memoised. A fresh array every render was a new
   * `via` prop every render, and the map rebuilds every pin (and used to
   * re-frame the ride) whenever it changes — invisible on a result nobody
   * touches, and a map jumping under the thumb in an editor that re-renders
   * on every keystroke.
   *
   * In edit mode they are the editor's rows as they stand, so a confirmed
   * place's pin moves the moment Confirm is pressed and the line follows it a
   * second or two later; outside it they are the ride's own.
   */
  const mapVia = useMemo(() => {
    if (!result) return preview.viaNumbers ? preview.vias.map((v, i) => (preview.viaNumbers?.[i] != null ? { ...v, number: preview.viaNumbers[i] } : v)) : preview.vias;
    // A shaping point is not a pin: on the result the line already shows the
    // bend, and in edit mode the map draws it as a dot of its own.
    const list = wiring.editing ? preview.vias : (ridePlaces?.vias ?? []).filter((v) => !isShape(v));
    // The composer's numbers while a new point waits among the stops.
    const numbers = !result || wiring.editing ? preview.viaNumbers : undefined;
    return list.map((v, i) => ({
      lat: v.lat,
      lon: v.lon,
      label: v.label,
      ...(numbers?.[i] != null ? { number: numbers[i] } : {}),
      ...(stopKind(stopKinds, v.label) ?? {}),
      // The POI category behind this stop, when it came from a suggestion: the
      // marker then carries the sight's own glyph instead of the number that
      // means "a stop you typed".
      ...(v.kind ? { category: v.kind } : {}),
    }));
  }, [result, wiring.editing, preview.vias, preview.viaNumbers, ridePlaces, stopKinds]);
  const mapStart = result ? (wiring.editing ? preview.start : ridePlaces?.start ?? result.start) : preview.start;
  const mapFinish = result ? (wiring.editing ? preview.finish : ridePlaces ? ridePlaces.finish : result.destination ?? null) : preview.finish;
  // While planning the map is always available, whether or not anything is
  // confirmed yet — it is now a way of *adding* places, so the rider with an
  // empty form is precisely the one it has to be openable for. (`picking` was
  // excused from the old rule for the same reason; this generalises it.) With
  // a result on screen the old rule stands: the map shows the ride.
  const mapVisible = Boolean(result) || previewPlaces.length > 0 || picking || planning;
  /**
   * The line the map draws: the ride, or the ride with ticked sights spliced
   * in — never in edit mode (the edit draws the ride it is changing), and
   * never a splice that is not one continuous line. A broken one is logged
   * with where it broke and the plain ride is drawn instead: a gap on the map
   * reads as a broken ride, and must never be shown (2026-09-25).
   */
  const mapSegments = useMemo(() => {
    // Chained edits (release B item 4): the map's ride is the chain's top, so
    // what is drawn, grabbed and tapped is the ride the next edit changes.
    const ride = (wiring.editing && chainTop ? chainTop.ride.segments : shownRoute?.segments) ?? null;
    if (!spliced || wiring.editing || !ride) return ride;
    const breaks = lineBreaks(spliced.segments, ride);
    if (breaks.length) {
      console.warn("mopik: spliced sights broke the line; drawing the ride without them", { breaks });
      return ride;
    }
    return spliced.segments;
  }, [spliced, shownRoute, wiring.editing, chainTop]);
  /**
   * The map's header, with what an edit is doing said on the map itself
   * (2026-09-25). On a phone the editor is full screen, and the panel that
   * says „Pārrēķinu posmu…” or why a change was refused is behind it: a
   * confirmed batch then looked like two pins left off the line with nothing
   * happening, and a refusal said nothing at all.
   */
  /**
   * The preview, as the map draws it: the chip (or „Pārrēķinu…”, or why it
   * cannot be made) in the notice slot, and the proposed line over the
   * dimmed ride. Only while editing.
   */
  const wideNow = Boolean(wideAsk && proposal.phase === "refused" && proposal.token === wideAsk.token);
  const straightNow = Boolean(straightAsk && proposal.phase === "refused" && proposal.token === straightAsk.token);
  // Release B item 1: the proposal's blocking points, when they are this proposal's.
  const proposalToken = proposal.phase === "refused" ? proposal.token : proposal.phase === "proposed" ? proposal.proposal.token : null;
  const blockNow = blocking && blocking.token === proposalToken ? blocking : null;
  // Release B item 4: with nothing new pending, the chain's top is what is shown.
  const shown = useMemo(() => shownProposal(chainOn, proposal), [chainOn, proposal]);
  const pendingChanges = chainCount(chainOn, proposal);
  const proposalNow = useMemo(() => {
    if (!wiring.editing) return null;
    const chained = (v: ProposalView | null): ProposalView | null =>
      // „2 izmaiņas – ✓ apstiprina visas, ↶ atsauc pēdējo, ✕ atmet visas.”
      v && pendingChanges >= 2 && !v.tone && !v.warn ? { ...v, guide: guideAction((k) => ui[k], { kind: "chain", count: pendingChanges }) } : v;
    const view = proposalView(shown, {
      routing: ui.previewRouting, delta: ui.previewDelta, deltaTitle: ui.previewDeltaTitle,
      // ── edit-guidance ── what to do, after what is happening.
      guide: proposalGuide((k) => ui[k]),
      wide: wideNow,
      straight: straightNow,
    }, locale);
    if (!view || !blockNow) return chained(view);
    // Which point, and what to do with it — in the guidance line itself.
    const fmt = (n: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(n);
    const warned = proposal.phase === "proposed";
    const g = blockedGuide((k) => ui[k], blockNow, warned, fmt);
    if (view.tone === "refused") return { ...view, text: g.what, guide: g.action, title: blockedLine((k) => ui[k], blockNow, false, fmt) };
    // Warned: „Tomēr braukt” already works; the point is named once it is found.
    if (warned && !blockNow.probing) return { ...view, guide: blockedLine((k) => ui[k], blockNow, true, fmt) };
    return chained(view);
  }, [wiring.editing, proposal, shown, pendingChanges, ui, wideNow, straightNow, locale, blockNow]);
  // The last proposal that landed stays on the map while the next change
  // routes — its line, halo and numbers, with the spinner — so there is
  // never an empty gap between two proposals (`staleWhileRouting`). Kept in
  // state, adjusted during render as a prop-derived value is; gone at once
  // with the proposal (✕, the mark gone) or a refusal.
  const [landedView, setLandedView] = useState<ProposalView | null>(null);
  const wideOffered = wideAsk && proposal.phase === "refused" && proposal.token === wideAsk.token ? wideAsk : null;
  const straightOffered = straightAsk && proposal.phase === "refused" && proposal.token === straightAsk.token ? straightAsk : null;
  if (proposalNow && !proposalNow.tone && proposalNow !== landedView) setLandedView(proposalNow);
  if ((!proposalNow || proposalNow.tone === "refused") && landedView) setLandedView(null);
  const proposalShown = staleWhileRouting(landedView, proposalNow);
  // The proposal owns the notice while there is one (the map puts its view
  // there); otherwise the last refusal of a ✓ whose mark is gone, then the
  // composer's own. ✓ spins in its slot while the proposal routes.
  const editMapControls: MapControls | null = mapControls && wiring.editing
    ? {
        ...mapControls,
        notice: editNotice({ rerouting: false, note: proposalShown ? null : editNote, routingText: ui.resEditRouting, base: mapControls.notice }),
        pending: mapControls.pending ? { ...mapControls.pending, confirmBusy: proposal.phase === "routing" } : null,
      }
    : mapControls;
  const mapPanel = (
    <MapPanel
      // Phone heights. The map yields to words whenever there are words to
      // read — while the chat is speaking *and* while a route is being
      // generated. The old condition was `result && chatting`, so during the
      // first generation there was no result yet, the map kept 42dvh, and the
      // loader's "Atcelt" and the chat below it were pushed off the screen:
      // the rider was left watching an animation with no way out of it.
      className={`overflow-hidden rounded-2xl border border-stone-200 md:h-[calc(100vh-7rem)] ${(chatting || phase !== "idle") ? "h-[26dvh]" : "h-[42dvh]"}`}
      expandedClassName="md:relative md:inset-auto md:z-auto md:h-[calc(100vh-7rem)] md:overflow-hidden md:rounded-2xl md:border md:border-stone-200">
      <RouteMap
        // Which line is drawn, in the order the rider last acted.
        //
        // A ticked-but-not-kept sight is a preview and wins while it is on
        // screen: the rider is looking at what the tick did. Below it, the
        // ride as it stands — edited or not, `shownRoute` is the one line.
        segments={mapSegments}
        // The start row's own place, never "the first place that happens to be
        // confirmed". An empty start row draws no start pin — which is the
        // whole of the bug this replaced: four stops added from the map became
        // a green start, two numbers and a red finish.
        start={mapStart ?? null}
        // A numbered pin is a stop, so the finish must never be one — and the
        // finish is the finish *row*, not the last confirmed place.
        // `placeRoles` already returns null for a round trip (it returns to
        // its start and has no destination) and for an empty finish row.
        destination={mapFinish ?? null}
        via={mapVia}
        focus={focusPoi}
        onFocusCleared={clearFocusPoi}
        // Backlog 46: the card's „Pievienot braucienam” adds; „Atzīmēt” (a
        // result only) ticks for several at once, and the ticks are counted
        // on the map with their own „Pievienot”.
        onFocusToggle={wiring.editing ? undefined : toggleFocusedPoi}
        onFocusAdd={addFocusedToRide}
        ticked={!wiring.editing && selectedPois.length > 0 ? {
          count: tickedCount((k) => ui[k], selectedPois.length),
          guide: tickedGuide((k) => ui[k], selectedPois.length),
          addLabel: ui.resAddStop,
          ready: Boolean(spliced && spliced.applied.length > 0),
        } : null}
        onTickedAdd={commitSelection}
        sightNote={!wiring.editing && sightNote ? { text: sightNote, dismissLabel: ui.sightNoteClose } : null}
        onSightNoteDismiss={dismissSightNote}
        selectedPois={selectedPois}
        // The sights the ride passes and the ones it runs near. The map draws
        // the first group as soon as this arrives — the rider does not have to
        // open anything — and both groups follow the "Apskates vietas" switch.
        routePois={routePois}
        onShowPoi={showPoiFromMap}
        showTet={showTet} onToggleTet={setShowTet}
        showSights={showSights} onToggleSights={setShowSights}
        // Pick mode, and the marker it leaves behind. Both are handed over
        // only while planning or editing with a row actually waiting
        // (`wiring.pick`):
        // with no `onPickPoint` the map answers a click the way it always has
        // — segment card, sight card, or clearing the highlight — and the
        // pending marker is not a pin left lying on a finished
        // ride. Gated on the view and not on `picking` alone because that
        // flag was left up under the result, which is exactly how a rider
        // found a violet pin on his generated ride. The geolocate control
        // hangs from `onPickPoint` inside the map, so it goes with it.
        onPickPoint={wiring.pick ? takePoint : undefined}
        pickedPoint={wiring.pick ? pickPoint : null}
        onPickedPointMove={wiring.pick ? takePoint : undefined}
        pickCenter={wiring.pick ? pickCenter : null}
        // The header: the field bound to the active row and "+". Only while the
        // rows are the view — planning, or editing a ride — because a plain
        // result map has no active row and nothing to add a stop to.
        controls={wiring.header ? editMapControls : null}
        proposal={proposalShown} />
    </MapPanel>
  );
  // Where the map lives depends only on the viewport and the view — never on
  // whether it currently has anything to show. Folding `mapVisible` in here
  // meant the placement flipped at the same moment the map appeared, and the
  // map could be left in the hidden desktop cell: zero-sized, taking its
  // full-screen button down to 0 x 0 px with it.
  // The editor is the composer, so it hosts the map exactly as planning does.
  const mapInComposer = !desktop && (entryMode === "form" || wiring.editing);
  // The result panel hosts it too: under the ride heading, above the versions.
  const mapInResult = !desktop && entryMode === "chat" && Boolean(result) && !chatting && !wiring.editing;
  /**
   * What the editor shows above its rows: the ride as the last Confirm left
   * it. The step back is the map header's ↶ (and Ctrl/Cmd+Z) since
   * 2026-09-25 — one undo, one place — and the full search is on the result.
   *
   * The numbers are the recomputed ones, and the retraced share is among them
   * because it is the one figure an edit can quietly make worse. The kicker
   * appears once the ride has actually been corrected, never before: an
   * editor opened and left alone has not changed what Mopik planned.
   */
  const editSummary = shownRoute
    ? `${Math.round(shownRoute.distanceMeters / 1000)} km · ${minutesLabel(shownRoute.durationSeconds / 60)} · ${shownRoute.overlap.repeatedPercent} % ${ui.resRepeated.toLowerCase()}`
    : "";
  const editStatus = shownRoute && (
    <div className="space-y-1.5 rounded-lg border border-stone-200 bg-white px-3 py-2">
      {edited?.kind === "edit" && (
        <div className="text-[10px] font-semibold uppercase tracking-wider text-[#bd4b00]" title={ui.resEditedHint}>
          {fi(ui.resEditedKicker, { pct: edited.overlap.repeatedPercent })}
        </div>
      )}
      <p data-edit-summary className="text-xs font-medium tabular-nums text-stone-800">{editSummary}</p>
      {edited && edited.summary.drawnKm > 0 && (
        <p data-drawn-line className="text-[11px] leading-snug text-stone-600">{fi(ui.panelDrawn, { km: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(edited.summary.drawnKm) })}</p>
      )}
      {/* The preview, said here as well as on the map: routing, refused, or its chip and notes. */}
      {proposalShown?.tone === "routing" && (
        <p role="status" className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <LoaderCircle className="size-3 animate-spin" />{proposalShown.text}
        </p>
      )}
      {proposalShown && proposalShown.tone !== "routing" && (
        <p data-edit-proposal role="status" title={proposalShown.title} className={`text-[11px] leading-snug tabular-nums ${proposalShown.tone === "refused" ? "text-[#bd4b00]" : "text-stone-700"}`}>{/* ── edit-guidance ── the same „what – what to do” as the map's chip, then the notes. */}{proposalShown.guide ? joinGuide(proposalShown.text, proposalShown.guide) : proposalShown.text}{proposalShown.notes ? `${proposalShown.guide ? " " : NOTE_JOINER}${proposalShown.notes}` : ""}</p>
      )}
      {editNote && !proposalShown && <p role="status" className="text-[11px] leading-snug text-[#bd4b00]">{editNote}</p>}
    </div>
  );
  const editor: RideEdit | null = wiring.editing && workingPlaces
    ? {
        // Chained edits (release B item 4): the rows, dots and line are the chain's top.
        seed: { ...rowsOf(workingPlaces), roundTrip: workingPlaces.roundTrip, token: seed.token, active: seed.active },
        onCommit: (rows, opts) => commitEdit(rows, opts),
        shapePoints: shapesOf(workingPlaces).map((v) => ({ lat: v.lat, lon: v.lon })),
        // Where a new point goes, and whether a moved one lands on the line
        // elsewhere (Phase 1, lib/map/insert-leg.ts): the ride as drawn.
        places: workingPlaces,
        line: route ? ((chainTop?.ride.coordinates ?? edited?.coordinates ?? route.geometry.coordinates) as Point[]) : undefined,
        onShape: (op) => { commitShape(op); },
        onPropose: proposeChange,
        proposal: shown,
        // Another edit started while this proposal is shown: it is chained, not dropped.
        onStack: proposal.phase === "proposed" ? stackProposal : undefined,
        chain: chainOn.rides.length ? { count: pendingChanges, onConfirm: () => { chainConfirm(); }, onDiscard: chainDiscard, onUndo: chainUndo } : undefined,
        // „Pārrēķināt posmu”, on offer while its refusal is shown (`askWide`).
        onWide: wideOffered ? acceptWide : undefined,
        onPassHere: dropPassHere,
        onRename: (from, to) => renameRef.current(from, to),
        // „Vest pa taisno”, on offer while its guidance line is shown (`askStraight`).
        onStraight: straightOffered ? acceptStraight : undefined,
        // Release B item 1: which points stop the proposal, and „Vest pa taisno” for one of a batch.
        blocking: blockNow,
        onStraightAt: blockNow && !blockNow.probing && blockNow.total > 1 ? acceptStraightAt : undefined,
        // „Tomēr braukt”: arms the shown warned proposal; the chip then confirms it like ✓.
        onOverride: (commitNow) => {
          const s = proposalRef.current;
          // Nothing new on a warned chain: the override is for its top.
          const top = chainTopOf(chainRef.current);
          if (s.phase === "idle" && top?.accept) { overrideArmed.current = top.token; if (commitNow) chainConfirm(); return; }
          overrideArmed.current = s.phase === "proposed" && s.proposal.accept ? s.proposal.token : null;
          if (commitNow && s.phase === "proposed" && overrideArmed.current !== null) commitProposal(s.proposal, false);
        },
        onDone: finishEdit,
        onCancel: cancelEdit,
        status: editStatus,
        rerouting: committing,
        // One undo, one place: the map header's ↶ and Ctrl/Cmd+Z (2026-09-25),
        // where the editor used to carry a button of its own.
        canUndo: (history.canUndo || chainOn.rides.length > 0) && !committing,
        onUndo: undoLastEdit,
      }
    : null;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      <IntroSplash />
      {/* The plus only appears once there is something to clear — on a fresh
          page it would do nothing. */}
      <SiteHeader
        showNewRide={messages.length > 0 || Boolean(plan)}
        newRideDisabled={phase !== "idle"}
        onNewRide={() => { firstFromFormRef.current = false; setEditMode(false); setEntryMode("form"); setMessages([]); setPlan(null); setPlaces([]); setResult(null); setChatting(false); setError(null); setRetry(null); setQuickReplies([]); }} />
      <div className="grid items-start gap-5 md:grid-cols-[minmax(340px,460px)_1fr]">
        <div className="min-w-0 space-y-4">
          <InstallPrompt show={Boolean(result) && !chatting} />
          {entryMode === "form"
            ? <RideComposer key={plan ? planSummary(plan, locale) : "new"} initialPlan={plan} initialPlaces={places} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={() => setEntryMode("chat")} onPlacesChange={setPreview} map={mapInComposer && mapVisible ? mapPanel : undefined}
                // Only while planning: the form reopened over a result shows the
                // generated ride on its map, which answers no row — a pin button
                // there would open a pick flow whose taps go nowhere.
                onPickModeChange={planning ? changePickMode : undefined} pickPoint={pickPoint}
                onMapControlsChange={setMapControls} mapShown={mapVisible && planning} />
            : editor && result && route
              // "Labot": the same rows planning uses, editing the ride on its
              // own map. Keyed on the ride, so opening the editor on another
              // version starts from that version's places.
              ? <RideComposer key={`edit-${route.id}`} initialPlan={plan} initialPlaces={places} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={finishEdit} onPlacesChange={setPreview} map={mapInComposer && mapVisible ? mapPanel : undefined}
                  onPickModeChange={changePickMode} pickPoint={pickPoint}
                  onMapControlsChange={setMapControls} mapShown={mapVisible} edit={editor} />
            : result && result.routes.length > 0 && !chatting
              ? <ResultPanel routes={result.routes} selected={selected} onSelect={setSelected} plan={plan} avoidTowns={result.intent.avoidTowns ?? false} lucky={lucky} remoteLoop={result.remoteLoop} longerSuggestion={result.longerSuggestion} tolerancePercent={result.intent.distanceTolerancePercent} busy={phase !== "idle"} onSend={send} onBackToForm={() => setEntryMode("form")} map={mapInResult && mapVisible ? mapPanel : undefined} resolvedPlaces={routedPlaces} alternatives={result.alternatives} sparsePlaceData={result.sparsePlaceData} assembledFromSegments={result.assembledFromSegments} directLeg={showingDirect} offset={variantOffset} onOffsetChange={setVariantOffset} onShowPoi={showPoi} pois={routePois} poisLoading={poisLoading} poisFailed={poisFailed} onDetoursChange={setDetoursForMap} selectedPois={selectedPois} onToggleSelectPoi={toggleSelectPoi} onClearSelectedPois={clearSelectedPois} onCommitSelection={commitSelection} onSearchBetterLoop={searchBetterLoop} shapesDropped={Boolean(plan?.shapePoints?.length)} onSplicedChange={handleSplicedChange} override={edited ? shownRoute : null} edited={edited} rerouting={committing} editNote={editNote} onEdit={canEdit ? () => { openMapFullscreen(); enterEdit(); } : undefined} />
              : <RoutePrompt messages={messages} plan={plan} hasRoute={Boolean(route)} phase={phase} quickReplies={quickReplies} lucky={lucky && !route} onSend={send} onBackToForm={() => setEntryMode("form")} originCode={origin?.code ?? null} onAction={(reply) => { if (reply.action === "retry") { retryLast(); return; } if (reply.action === "drop-stops" || reply.action === "easier-profile") { void retryChanged(reply.action); return; } if (reply.action === "direct-leg") { showDirectLeg(); return; } if (reply.action === "remove-stop" || reply.action === "move-stop") { if (reply.stop) reviseUnreachableStop(reply.stop, reply.action === "move-stop" ? "move" : "remove"); return; } setChatting(false); setQuickReplies([]); }} onCancel={cancel} />}
          {/* A ride that came from editing another one. Asked once, here,
              because only the rider knows whether the original is still
              wanted — and the answer is one tap either way. */}
          {keepChoice && (
            <div className="rounded-xl border border-stone-200 bg-[#faf9f6] p-4 text-sm">
              <p className="text-stone-700">{ui.saveRemadeQuestion}</p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" onClick={() => { track("edited_ride_kept", { was_saved: keepChoice.saved }); setKeepChoice(null); }}
                  className="rounded-full border border-stone-900 px-3.5 py-1.5 text-xs font-semibold text-stone-900 transition hover:bg-stone-900 hover:text-white">
                  {ui.saveKeepOld}
                </button>
                <button type="button" onClick={() => { if (keepChoice.saved) removeRide(rideId(keepChoice.code)); track("edited_ride_replaced", { was_saved: keepChoice.saved }); setKeepChoice(null); }}
                  className="rounded-full border border-stone-200 px-3.5 py-1.5 text-xs font-medium text-stone-600 transition hover:bg-white">
                  {keepChoice.saved ? ui.saveReplace : ui.saveKeepBoth}
                </button>
              </div>
              {!keepChoice.saved && <p className="mt-2 text-[11px] text-stone-500">{ui.saveOldNotKept}</p>}
            </div>
          )}
          {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>{error}</p>{retry && <button onClick={retryLast} disabled={phase !== "idle"} className="mt-2 underline underline-offset-4 disabled:opacity-40">{ui.chatRetry}</button>}</div>}
        </div>
        {/* Sticky on the desktop. On the phone the map appears once there is
            something to show — inside the ride block while the form is open,
            above the result otherwise. Phone heights: 42dvh with the result
            panel, 26dvh while the chat has something to say (the words matter
            more than the picture then), the whole screen when asked. */}
        <div className={`order-first min-w-0 md:order-none md:sticky md:top-5 ${mapVisible && !mapInComposer && !mapInResult ? "" : "hidden md:block"}`}>
          {!mapInComposer && !mapInResult && mapPanel}
        </div>
      </div>
    </main>
  );
}
