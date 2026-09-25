"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { RouteMap, type MapControls } from "@/components/route-map";
import { mapWiring } from "@/lib/map/map-wiring";
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
import { messages as uiMessages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import { RideComposer } from "@/components/ride-composer";
import { ChatMessage, ChatQuickReply, ChatResponse, RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { describeInfeasible, describeUnplannable, minutesLabel } from "@/lib/chat/feasibility";
import { seedPlanFromProfile } from "@/lib/chat/ride-profile";
import { planForFullSearch } from "@/lib/chat/compose-plan";
import type { ResolvedPlace } from "@/lib/chat/places";
import { useRideProfile } from "@/lib/chat/use-ride-profile";
import { DESKTOP_QUERY, useMediaQuery } from "@/lib/use-media-query";
import { GenerateRouteResponse, type DirectLegOffer, type UnreachableStop } from "@/lib/types";
import { POI_KIND, type RoutePoi } from "@/lib/poi/kinds";
import { describeDetourForFocus } from "@/lib/routing/use-detours";
import { type DetourResult } from "@/lib/routing/detour";
import { useRoutePois } from "@/lib/poi/use-route-pois";
import { useMapLayer } from "@/lib/map/layer-prefs";
import type { SplicedRoute } from "@/lib/routing/detour";
import {
  NO_EDITS,
  applyRuns,
  applyShapeEdit,
  asGeneratedRoute,
  isShape,
  mergeShapes,
  nearestAlong,
  shapesOf,
  stopsOf,
  coordinatesOf,
  insertStopsByAlong,
  joinsFor,
  placesFromRide,
  placesFromRows,
  planEdit,
  planWithPlaces,
  pushEdit,
  recomputeOverlap,
  resolvedOf,
  rowsOf,
  snapToLine,
  spanRun,
  lineBreaks,
  spliceIsSound,
  summariseSegments,
  undoEdit,
  type EditHistory,
  type EditedRide,
  type RidePlace,
  type RoutedRun,
  type RidePlaces,
  type ShapeEdit,
} from "@/lib/routing/reroute-leg";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import type { Point } from "@/lib/geo/geometry";
import type { PlaceRoles } from "@/lib/map/place-roles";
import type { RideEdit } from "@/components/ride-composer";
import { MOVE_OFFER_MAX_M } from "@/lib/routing/routable-point";
import { MAX_SHAPE_POINTS, MAX_STOPS } from "@/lib/chat/ride-limits";
import { LoaderCircle } from "lucide-react";

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
  /** A stretch is being re-routed: the editor holds still until it lands. */
  const [rerouting, setRerouting] = useState(false);
  /** What went wrong with the last edit, shown once and cleared by the next one. */
  const [editNote, setEditNote] = useState<string | null>(null);
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
  /**
   * The routed detours the result panel prefetched  /**
   * The routed detours the result panel prefetched, so a marker's card can
   * state the same cost the list's row does. Empty until the prefetch answers,
   * and on the shared page's terms: it is only ever read through
   * `describeDetourForFocus`, which returns null for a place it has no entry
   * for.
   */
  const [detoursForMap, setDetoursForMap] = useState<Record<string, DetourResult>>({});
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
    // The result panel unmounts in this same commit and never gets to report
    // its ticked sights gone: the spliced preview is dropped here, or the edit
    // map kept drawing the pre-edit line with a sight's detour spliced in
    // while every edit changed a line nobody could see (2026-09-25).
    setSplicedFor({ result, spliced: null });
    setFocusPoi(null);
    setEditNote(null);
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
    track("route_edit_finished", { edited: Boolean(edited) });
    setEditMode(false);
    setEditNote(null);
  }

  /**
   * A change the rider committed in the editor, re-routed and spliced.
   *
   * `planEdit` decides which stretch of the drawn line the change invalidates
   * — the legs around the changed place, and nothing else — and only those
   * points go to `/api/reroute-leg`. The answer is spliced into the line with
   * `applyRuns`, and every figure (km, time, surfaces, retraced share) is
   * recomputed from the spliced line, never inherited.
   *
   * A failure puts nothing on the map, says so, and puts the rows back: the
   * ride the rider had is still the ride he has. A correction that cannot be
   * routed must never cost him the route he already liked.
   */
  async function commitEdit(rows: { names: string[]; picked: Record<number, ResolvedPlace | null> }) {
    if (!plan || !result || !route || !ridePlaces || rerouting) return;
    const before = ridePlaces;
    const fromRows = placesFromRows({
      picked: rows.picked,
      rowCount: rows.names.length,
      roundTrip: before.roundTrip,
      finishOptional: !before.finish,
    });
    if ("error" in fromRows) {
      track("route_edit_failed", { reason: "no-place" });
      setEditNote(ui.editNeedsPlace);
      reseed();
      return;
    }
    // The rows are the stops; the shaping points go back where they were.
    await reroutePlaces(before, mergeShapes(before, fromRows));
  }

  /**
   * A shaping point added, moved, taken out or made a stop, on the map
   * (2026-09-25). The first three re-route exactly as a stop would — the
   * same `planEdit` windows, loops and continuous-line check, through the
   * same `reroutePlaces`. Making one a stop changes no line: the dot already
   * is where the ride goes, so the ride is kept and only its places change —
   * still one step of the undo.
   */
  async function commitShape(op: ShapeEdit) {
    if (!plan || !result || !route || !ridePlaces || rerouting) return;
    const before = ridePlaces;
    const next = applyShapeEdit(before, op);
    if ("error" in next) {
      track("route_edit_failed", { reason: next.error });
      setEditNote(next.error === "stop-cap" ? fi(ui.mapAddStopFull, { n: MAX_STOPS }) : next.error === "shape-cap" ? fi(ui.shapeCapNote, { n: MAX_SHAPE_POINTS }) : ui.resEditFailed);
      return;
    }
    track("shape_point_edited", { kind: op.kind });
    if (op.kind !== "promote") { await reroutePlaces(before, next, { shape: true }); return; }
    const baseLine = edited?.coordinates ?? (route.geometry.coordinates as Point[]);
    // Onto the line, if the dot was a little off it (a plan's shaping point
    // is where the rider put it, the line where the router went): a stop is
    // held to the line it is on, and this one is on it by construction.
    const cum = cumulative(baseLine);
    const promoted: RidePlaces = {
      ...next,
      vias: next.vias.map((v) => {
        if (isShape(v) || before.vias.some((b) => !isShape(b) && b.lat === v.lat && b.lon === v.lon)) return v;
        const near = nearestAlong([v.lon, v.lat], baseLine, cum);
        if (near.meters <= 1) return v;
        const [lon, lat] = pointAtDistance(baseLine, cum, near.alongMeters).point;
        return { ...v, lat, lon };
      }),
    };
    const keep: EditedRide = edited
      ? { ...edited, places: promoted, kind: "edit", how: "promote" }
      : {
          coordinates: baseLine,
          segments: route.segments,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          overlap: route.overlap,
          summary: summariseSegments(route.segments, route.quality.gateCount !== undefined),
          places: promoted,
          kind: "edit",
          how: "promote",
        };
    setEditsFor((prev) => {
      const mine = prev.routeId === route.id;
      return { routeId: route.id, history: pushEdit(mine ? prev.history : NO_EDITS, keep), original: mine && prev.original ? prev.original : { plan, places } };
    });
    setPlan(planWithPlaces(plan, promoted));
    setPlaces(resolvedOf(promoted));
    setEditNote(null);
    reseed();
  }

  /**
   * Re-route the stretches a change of places invalidates and splice them in
   * — the one path every edit takes, a stop's or a shaping point's. `shape`
   * only changes the words of the notes ("maršruta punkts", not "pietura").
   */
  async function reroutePlaces(before: RidePlaces, after: RidePlaces, opts: { shape?: boolean } = {}) {
    if (!plan || !result || !route) return;
    const baseSegments = edited?.segments ?? route.segments;
    const line = coordinatesOf(baseSegments);
    if (line.length < 2) return;
    const planned = planEdit({ line, cum: cumulative(line), before, after });
    if (!planned) return;
    if ("error" in planned) {
      track("route_edit_failed", { reason: "degenerate" });
      setEditNote(ui.editNoRide);
      reseed();
      return;
    }
    const nextPlan = planWithPlaces(plan, planned.places);
    setRerouting(true);
    setEditNote(null);
    const startedAt = startClock();
    try {
      type Routed = { runs: (RoutedRun & { deadEndMeters?: number; deadEndUnchecked?: boolean })[] };
      const request = async (runs: typeof planned.runs, loops: boolean[]): Promise<Routed | { status: number }> => {
        const response = await fetch("/api/reroute-leg", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plan: nextPlan, runs: runs.map((run) => run.points.map(([lon, lat]) => ({ lat, lon }))), loops }),
        });
        return response.ok ? ((await response.json()) as Routed) : { status: response.status };
      };
      const splice = (runs: typeof planned.runs, routed: Routed) => applyRuns({
        segments: baseSegments,
        distanceMeters: edited?.distanceMeters ?? route.distanceMeters,
        durationSeconds: edited?.durationSeconds ?? route.durationSeconds,
        runs,
        routed: routed.runs,
      });
      // A stop added or moved is ridden through, not out to and back: the
      // server routes its two halves and looks for a loop when they share
      // the road (`routeThroughStop`).
      let runs = planned.runs;
      let data = await request(runs, runs.map((run) => (planned.kind === "add-stop" || planned.kind === "add-stops" || planned.kind === "move-stop") && run.points.length === 3));
      if ("status" in data) {
        track("route_edit_failed", { reason: String(data.status) });
        setEditNote(ui.resEditFailed);
        reseed();
        return;
      }
      let spliced = splice(runs, data);
      // The invariant (rider, 2026-09-25): the edited ride is ONE continuous
      // line through every place in order. A stretch the router began or
      // ended somewhere other than the cut — a nudged or snapped endpoint —
      // left a gap and a stray stub on the map. Such a splice is never
      // shown: the whole span between the nearest unchanged places is routed
      // again as one stretch, and if that breaks too the edit is refused and
      // the ride keeps the line it had.
      const sound = (candidate: typeof spliced) => spliceIsSound({ segments: candidate.segments, original: baseSegments, places: planned.places, toleranceMeters: MOVE_OFFER_MAX_M });
      let verdict = sound(spliced);
      if (!verdict.ok) {
        console.warn("mopik: edited line broke", { kind: planned.kind, breaks: verdict.breaks, missesPlaces: verdict.missesPlaces, runs: runs.map((r, i) => ({ i, from: Math.round(r.fromMeters), to: Math.round(r.toMeters) })) });
        track("route_edit_failed", { reason: "broken-line" });
        const span = spanRun({ line, cum: cumulative(line), before, after: planned.places, runs });
        const again = await request([span], [false]);
        if (!("status" in again)) {
          const whole = splice([span], again);
          const second = sound(whole);
          if (second.ok) { runs = [span]; data = again; spliced = whole; verdict = second; }
          else console.warn("mopik: edited line broke again on the whole span", { breaks: second.breaks, missesPlaces: second.missesPlaces });
        }
      }
      if (!verdict.ok) {
        setEditNote(ui.editBrokenLine);
        reseed();
        return;
      }
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
      if ("error" in snapped) {
        track("route_edit_failed", { reason: "too-far" });
        setEditNote(fi(ui.pickOffRoadTitle, { m: snapped.meters }));
        reseed();
        return;
      }
      // Where a grabbed line point was taken only mattered to this edit's
      // plan; the shaping point it became is an ordinary one from here on.
      const settled = { ...snapped.places, vias: snapped.places.vias.map((v) => { const { grabbedAt: _g, ...rest } = v; void _g; return rest; }) };
      const next: EditedRide = {
        ...spliced,
        overlap: recomputeOverlap(spliced.coordinates),
        summary: summariseSegments(spliced.segments, route.quality.gateCount !== undefined),
        places: settled,
        kind: "edit",
        how: planned.kind,
      };
      const repeatedBefore = (edited?.overlap ?? route.overlap).repeatedPercent;
      const kmBefore = (edited?.distanceMeters ?? route.distanceMeters) / 1000;
      setEditsFor((prev) => {
        const mine = prev.routeId === route.id;
        return {
          routeId: route.id,
          history: pushEdit(mine ? prev.history : NO_EDITS, next),
          original: mine && prev.original ? prev.original : { plan, places },
        };
      });
      // The plan and the places follow the line, so Saglabāt, Dalīties, the
      // GPX and "Meklēt labāku apli" all carry the ride that is drawn.
      setPlan(planWithPlaces(plan, settled));
      setPlaces(resolvedOf(settled));
      // A new stop was put where the line meets it, which may not be the row
      // "+ Pietura" made; the rows follow, and the map keeps answering it.
      // Counted among the stops: the rows have none for shaping points.
      const addedStops = planned.places.vias.filter((v) => !isShape(v));
      const addedAt = planned.kind === "add-stop"
        ? addedStops.findIndex((v) => !before.vias.some((b) => b.lat === v.lat && b.lon === v.lon))
        : -1;
      // Said out loud rather than swallowed: the ride goes somewhere slightly
      // different from where the finger landed, and a substitution is never
      // silent.
      // And a stop at the end of a single road — no loop within the bound —
      // is ridden out and back, which the retraced figure will show; the
      // note says why, so the number is not a mystery.
      // A dead end only when the loop search finished and found no other way
      // within its bound; when it ran out of time the note says what the
      // line does and no more (`deadEndUnchecked`, `/api/reroute-leg`).
      const deadEndRun = data.runs.reduce<(typeof data.runs)[number] | null>((worst, r) => ((r.deadEndMeters ?? 0) > (worst?.deadEndMeters ?? 0) ? r : worst), null);
      const deadEnd = deadEndRun?.deadEndMeters ?? 0;
      const deadEndKm = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(deadEnd / 1000);
      const notes = [
        snapped.movedMeters > 0 ? fi(ui.resEditMoved, { m: snapped.movedMeters }) : "",
        deadEnd > 0 ? fi(deadEndRun?.deadEndUnchecked
          ? (opts.shape ? ui.editSameWayBackShape : ui.editSameWayBack)
          : (opts.shape ? ui.editDeadEndShape : ui.editDeadEnd), { km: deadEndKm }) : "",
      ].filter(Boolean);
      if (notes.length) setEditNote(notes.join(" "));
      reseed(addedAt >= 0 ? addedAt + 1 : undefined);
      // Timed to the frame the new line is painted in, which is the wait the
      // rider actually sees.
      requestAnimationFrame(() => {
        track("route_edited", {
          how: planned.kind,
          ms: elapsedMsSince(startedAt),
          runs: runs.length,
          km_delta: Math.round((next.distanceMeters / 1000 - kmBefore) * 10) / 10,
          repeated_before: repeatedBefore,
          repeated_after: next.overlap.repeatedPercent,
        });
      });
    } catch {
      track("route_edit_failed", { reason: "network" });
      setEditNote(ui.resEditFailed);
      reseed();
    } finally {
      setRerouting(false);
    }
  }

  /**
   * One step back: the ride exactly as it was on screen before the last edit.
   *
   * Undoing the first edit returns to the ride the API searched for, and the
   * plan and places go back with it — or a shared ride would carry a stop the
   * line no longer goes through.
   */
  function undoLastEdit() {
    if (!route || !history.canUndo) return;
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

    if (!route || !ridePlaces) return;

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
    track("sights_committed", {
      pois: spliced.applied.length,
      delta_km: Math.round((spliced.addedMeters / 1000) * 10) / 10,
      ms: elapsedMsSince(startedAt),
    });
  }

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
    if (!result) return preview.vias;
    // A shaping point is not a pin: on the result the line already shows the
    // bend, and in edit mode the map draws it as a dot of its own.
    const list = wiring.editing ? preview.vias : (ridePlaces?.vias ?? []).filter((v) => !isShape(v));
    return list.map((v) => ({
      lat: v.lat,
      lon: v.lon,
      label: v.label,
      ...(stopKind(stopKinds, v.label) ?? {}),
      // The POI category behind this stop, when it came from a suggestion: the
      // marker then carries the sight's own glyph instead of the number that
      // means "a stop you typed".
      ...(v.kind ? { category: v.kind } : {}),
    }));
  }, [result, wiring.editing, preview.vias, ridePlaces, stopKinds]);
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
    const ride = shownRoute?.segments ?? null;
    if (!spliced || wiring.editing || !ride) return ride;
    const breaks = lineBreaks(spliced.segments, ride);
    if (breaks.length) {
      console.warn("mopik: spliced sights broke the line; drawing the ride without them", { breaks });
      return ride;
    }
    return spliced.segments;
  }, [spliced, shownRoute, wiring.editing]);
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
        onFocusToggle={toggleFocusedPoi}
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
        controls={wiring.header ? mapControls : null} />
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
      {rerouting && (
        <p role="status" className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <LoaderCircle className="size-3 animate-spin" />{ui.resEditRouting}
        </p>
      )}
      {editNote && !rerouting && <p role="status" className="text-[11px] leading-snug text-[#bd4b00]">{editNote}</p>}
    </div>
  );
  const editor: RideEdit | null = wiring.editing && ridePlaces
    ? {
        seed: { ...rowsOf(ridePlaces), roundTrip: ridePlaces.roundTrip, token: seed.token, active: seed.active },
        onCommit: (rows) => { void commitEdit(rows); },
        shapePoints: shapesOf(ridePlaces).map((v) => ({ lat: v.lat, lon: v.lon })),
        onShape: (op) => { void commitShape(op); },
        onDone: finishEdit,
        onCancel: cancelEdit,
        status: editStatus,
        rerouting,
        // One undo, one place: the map header's ↶ and Ctrl/Cmd+Z (2026-09-25),
        // where the editor used to carry a button of its own.
        canUndo: history.canUndo && !rerouting,
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
              ? <ResultPanel routes={result.routes} selected={selected} onSelect={setSelected} plan={plan} avoidTowns={result.intent.avoidTowns ?? false} lucky={lucky} remoteLoop={result.remoteLoop} longerSuggestion={result.longerSuggestion} tolerancePercent={result.intent.distanceTolerancePercent} busy={phase !== "idle"} onSend={send} onBackToForm={() => setEntryMode("form")} map={mapInResult && mapVisible ? mapPanel : undefined} resolvedPlaces={routedPlaces} alternatives={result.alternatives} sparsePlaceData={result.sparsePlaceData} assembledFromSegments={result.assembledFromSegments} directLeg={showingDirect} offset={variantOffset} onOffsetChange={setVariantOffset} onShowPoi={showPoi} pois={routePois} poisLoading={poisLoading} poisFailed={poisFailed} onDetoursChange={setDetoursForMap} selectedPois={selectedPois} onToggleSelectPoi={toggleSelectPoi} onClearSelectedPois={clearSelectedPois} onCommitSelection={commitSelection} onSearchBetterLoop={searchBetterLoop} shapesDropped={Boolean(plan?.shapePoints?.length)} onSplicedChange={handleSplicedChange} override={edited ? shownRoute : null} edited={edited} rerouting={rerouting} editNote={editNote} onEdit={canEdit ? enterEdit : undefined} />
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
