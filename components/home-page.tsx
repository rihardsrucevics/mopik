"use client";

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import { RouteMap, type MapControls } from "@/components/route-map";
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
  anchorsAlong,
  coordinatesOf,
  legForPoint,
  nearestAlong,
  tapCut,
  recomputeOverlap,
  spliceLeg,
  type EditedRide,
  type LegAnchor,
} from "@/lib/routing/reroute-leg";
import { cumulative } from "@/lib/routing/detour";
import type { Point } from "@/lib/geo/geometry";
import type { PlaceRoles } from "@/lib/map/place-roles";

type Retry = { stage: "chat"; messages: ChatMessage[]; plan: RidePlan | null } | { stage: "route"; messages: ChatMessage[]; plan: RidePlan };

/**
 * Fast incremental re-routing — **off, and deliberately so.**
 *
 * The idea: a ride is a sequence of legs the router already agreed to, so
 * moving one stop invalidates two of them rather than all thirty. Dragging a
 * numbered pin on the result map, or tapping the line to add a via, would
 * re-route only the legs either side and splice the answer in — one to three
 * seconds against a full search's twenty to thirty.
 *
 * ## Why it is off
 *
 * It was never verified. The pure module and its test are sound and the API
 * route answers, but the UI half was written and left mid-flight: no path
 * through it has been ridden end to end, the failure and undo behaviour is
 * unproven on a phone, and a correction that silently makes a ride worse is
 * exactly the kind of thing the rider finds on the road rather than here.
 * Half-working does not reach a rider, so the entry points are shut rather
 * than shipped and watched.
 *
 * ## What is still here, and still sound
 *
 * - `lib/routing/reroute-leg.ts` and `scripts/reroute-leg.test.ts` — pure,
 *   tested, imported for `recomputeOverlap` / `spliceLeg` / `insertVias`,
 *   which the **shipped** sights feature uses. Do not delete them: taking
 *   this flag out is not the same as taking that module out.
 * - `app/api/reroute-leg/route.ts` — compiles and answers, and nothing in the
 *   UI calls it while this is false. Inert, not dead.
 * - `editRoute`, `undoEdit`, the `edited` / `editNote` state and the panel's
 *   "Labots ar roku" kicker. The state is **shared with the sights feature**,
 *   which ships: committing ticked sights produces an edited ride the same
 *   way, so none of it may be removed with this flag.
 *
 * ## To resume
 *
 * Flip this to `true`. That restores both entry points — the draggable result
 * pins and tap-to-add-via — because `onEditRoute` is the single prop they
 * both hang from. Then verify on a phone: drag a stop, tap the line, undo
 * each, and a leg the router refuses. Nothing else needs changing.
 */
const FAST_REROUTE = false;

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
 * The POI category a via was picked with, if it came from a suggestion.
 *
 * Matched the way `stopKind` matches, because the router's `label` for a via
 * is the geocoder's full string ("Gūtmaņa ala, Siguldas novads") while the
 * picked place carries the bare name the rider ticked. Only places that were
 * ticked carry a `kind` at all, so a typed stop never matches and keeps 🅿️.
 */
/**
 * A monotonic stopwatch for the analytics, outside the component.
 *
 * `performance.now()` inside an `async function` declared in the component
 * body reads as a render-phase call to `react-hooks/purity`, which cannot see
 * that the body runs after an await. The call is genuinely not a render — it
 * happens when the rider drags a pin — so the honest fix is to move it out of
 * the component rather than to silence the rule at the call site, where the
 * suppression would also cover whatever was written there later.
 *
 * It measures how long a leg re-route took, which is the number this whole
 * feature exists to change: "far too long" was the complaint, and an event
 * that carries the milliseconds is how it stays answered.
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

function pickedCategory(places: ResolvedPlace[], label: string): string | undefined {
  const heads = [label, label.split("·")[0].trim(), label.split(",")[0].trim()];
  return places.find((p) => p.kind && heads.some((h) => h === p.name || h === p.label))?.kind;
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
  const takePoint = useCallback((p: { lat: number; lon: number }) => {
    setPickPoint((prev) => ({ ...p, token: (prev?.token ?? 0) + 1 }));
  }, []);
  /** Where to take the map when pick mode opens, with its own re-fly token. */
  const [pickCenter, setPickCenter] = useState<{ lat: number; lon: number; token: number } | null>(null);
  /** A fix the map's geolocate button obtained, handed back to the form. */
  const [geolocated, setGeolocated] = useState<{ lat: number; lon: number } | null>(null);
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
  const changePickMode = useCallback((on: boolean, open?: { at: { lat: number; lon: number } | null; marker: { lat: number; lon: number } | null }) => {
    setPicking(on);
    if (!on) { setPickPoint(null); setPickCenter(null); return; }
    // Token 0 on the seed: the form already knows this place by name (it is
    // the row's own), so the marker appears without spending a reverse lookup
    // re-deriving a name it would then have to reconcile with the one shown.
    // A drag or a tap raises the token and the lookup runs then.
    setPickPoint(open?.marker ? { ...open.marker, token: 0 } : null);
    setPickCenter(open?.at ? { ...open.at, token: Date.now() } : null);
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
   * The ride as the rider has edited it: sights committed without a search, a
   * via dragged, a stop tapped onto the line.
   *
   * Carried with the ride it belongs to, exactly as `splicedFor` is and for
   * the same reason — a new generation must not leave an old edit drawn over
   * it, and answering that in an effect costs a render during which the map
   * shows the wrong line. `previous` is the undo: one step, holding the whole
   * edited ride as it was before the last change, so reverting is an
   * assignment rather than a recomputation that could drift.
   *
   * Note what is NOT here: nothing is re-scored or re-ranked. An edited ride
   * is the rider's line and the panel says so out loud ("labots ar roku") with
   * its retraced share recomputed. CLAUDE.md's "never substitute silently"
   * runs in both directions — Mopik does not pass an edit off as its own
   * search, and does not quietly undo one either.
   */
  const [editedFor, setEditedFor] = useState<{
    result: GenerateRouteResponse | null;
    /** null once the rider has undone back to the ride the API returned */
    edited: EditedRide | null;
  }>({ result: null, edited: null });
  const edited = editedFor.result === result ? editedFor.edited : null;
  /** One step back. Null when there is nothing to undo. */
  const [undoFor, setUndoFor] = useState<{
    result: GenerateRouteResponse | null;
    previous: EditedRide | null;
    /** what the undone edit was, so the event can say which kind riders reject */
    how: "commit" | "drag" | "tap" | null;
  }>({ result: null, previous: null, how: null });
  const canUndo = undoFor.result === result && undoFor.how !== null;
  /** A leg is being re-routed: the panel says so and the map does not accept a second edit. */
  const [editing, setEditing] = useState(false);
  /** What went wrong with the last edit, shown once and cleared by the next one. */
  const [editNote, setEditNote] = useState<string | null>(null);
  /**
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
    busyRef.current = true; setError(null); setRetry(null); setQuickReplies([]); setPlan(current); setPlaces(picked); setEntryMode("chat");
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
   * Every ticked sight becomes a via, and the ride is planned again through
   * all of them at once.
   *
   * This is the rider's own correction to the first version: adding one place
   * re-planned the whole ride, so three places cost three generations and he
   * could never see what the three of them did together. Now the ticks are
   * free and this is the one press that costs a ride.
   *
   * Deliberately no new path: it builds the plan the form would have built
   * with those stops typed into it and hands it to `startFromForm`, so the
   * summary, the form the rider can go back to, the analytics and the cancel
   * behaviour are all the ones that already exist. The coordinates travel as
   * picked places for the same reason the form's do — "Pilskalns" is the name
   * of dozens of hillforts, and the one meant is the one on the map, not
   * whatever a geocoder decides — and now carry the POI kind too, so the new
   * ride's map draws each sight with its own glyph instead of a 🅿️.
   *
   * Appended rather than inserted: these places are somewhere the ride already
   * passes near, so they belong in the order the router finds, and on a
   * one-way ride the destination stays the destination because
   * `startFromForm` reads it from `destinationPlace`.
   */
  /**
   * The ride's places right now, in riding order, including the start and the
   * finish — from the edit if there is one, from the API otherwise.
   *
   * One function because three things need the same answer and must not
   * disagree: the map's pins, the anchors an edit routes between, and the plan
   * an edit writes back. Reading it from the edit first is what makes a second
   * edit build on the first rather than on the ride the API returned.
   */
  function currentVias(): EditedRide["vias"] {
    if (edited) return edited.vias;
    return (result?.via ?? []).map((v) => ({
      lat: v.lat,
      lon: v.lon,
      label: v.label,
      ...(pickedCategory(places, v.label) ? { category: pickedCategory(places, v.label) } : {}),
    }));
  }

  /** Vias with new ones appended, capped at the plan's own six. */
  function insertVias(base: EditedRide["vias"], added: EditedRide["vias"]): EditedRide["vias"] {
    return [...base, ...added].slice(0, 6);
  }

  /**
   * Keep one step back before changing the ride.
   *
   * One step rather than a stack, because the rider asked for exactly that —
   * "a bad edit is one tap away from reverting" — and a stack would raise the
   * question of what "undo" means after a share, a save or a new generation.
   * The previous *whole ride* is kept rather than an inverse operation: an
   * inverse would have to recompute the geometry it is restoring, and a
   * recomputation can drift from what was on screen. A copy cannot.
   */
  function rememberForUndo(previous: EditedRide | null, how: "commit" | "drag" | "tap") {
    setUndoFor({ result, previous, how });
  }

  /**
   * Put the ride back as it was before the last edit.
   *
   * `previous` null means the last edit was the first one, so undoing it
   * returns to the ride the API actually searched for — which is exactly the
   * right thing for `edited` to become, because null is what every consumer
   * already reads as "the API's own line".
   */
  function undoEdit() {
    if (!canUndo) return;
    track("route_edit_undone", { how: undoFor.how ?? "" });
    setEditedFor({ result, edited: undoFor.previous });
    // The plan's vias follow the geometry back, or a shared ride would carry a
    // stop the line no longer goes through.
    if (plan) {
      const restored = undoFor.previous?.vias ?? (result?.via ?? []).map((v) => ({ label: v.label }));
      setPlan({ ...plan, viaPlaces: restored.map((v) => v.label) });
    }
    setUndoFor({ result: null, previous: null, how: null });
    setEditNote(null);
  }

  /**
   * A correction made on the result map: a stop dragged, or a point tapped
   * onto the line.
   *
   * Re-routes **only the two legs either side** of the change — previous place
   * → the new point → next place — and splices the answer into the drawn line.
   * That is the whole idea: a ride is a sequence of legs the router already
   * agreed to, and moving one stop invalidates two of them, not the other
   * thirty. Two short legs is one to three seconds against a search's 20-30.
   *
   * Which two legs is decided from the *drawn* line rather than from the plan,
   * because the drawn line is what the rider is pointing at: after a commit or
   * an earlier edit the geometry and the plan's place list are both current,
   * and the anchors are placed along the geometry so a tap lands in the leg
   * whose stretch of line it fell on.
   *
   * A failure puts nothing on the map and says so. The ride the rider had is
   * still the ride he has — a correction that cannot be routed must never cost
   * him the route he already liked.
   */
  async function editRoute(params: {
    how: "drag" | "tap";
    /** Where the rider put the point. */
    at: { lat: number; lon: number };
    /**
     * Which via he moved, by index into the current list, or null when this is
     * a new point tapped onto the line.
     */
    viaIndex: number | null;
    /** What to call a newly tapped place. */
    label?: string;
  }) {
    if (!plan || !result || editing) return;
    const baseSegments = edited?.segments ?? route?.segments ?? null;
    const baseDistance = edited?.distanceMeters ?? route?.distanceMeters ?? null;
    const baseDuration = edited?.durationSeconds ?? route?.durationSeconds ?? null;
    if (!baseSegments || baseDistance === null || baseDuration === null) return;

    const line = coordinatesOf(baseSegments);
    if (line.length < 2) return;
    const cum = cumulative(line);
    const vias = currentVias();
    const roundTrip = plan.returnToStart === true;

    // The ride's fixed points, in riding order. The start and the finish carry
    // `viaIndex: null`, which is what makes them un-draggable by construction:
    // an edit routes from the anchor before to the anchor after, and an end
    // has no anchor on one side.
    const anchors: LegAnchor[] = [
      { lat: result.start.lat, lon: result.start.lon, label: result.start.label, viaIndex: null },
      ...vias.map((v, i) => ({ lat: v.lat, lon: v.lon, label: v.label, viaIndex: i })),
      ...(roundTrip
        ? [{ lat: result.start.lat, lon: result.start.lon, label: result.start.label, viaIndex: null }]
        : result.destination
          ? [{ lat: result.destination.lat, lon: result.destination.lon, label: result.destination.label, viaIndex: null }]
          : []),
    ];
    if (anchors.length < 2) return;
    const along = anchorsAlong({ line, cum, anchors, roundTrip });

    /**
     * What the edit replaces, and where the two new legs join the kept ride.
     *
     * The two gestures answer this differently, and conflating them cost a
     * measured 126 km ride (see `TAP_WINDOW_M`). A **drag** moves a stop, so
     * what it invalidates is exactly that stop's two legs: previous place →
     * the new spot → next place. A **tap** adds a point to a stretch of line
     * the rider is looking at, so it replaces a bounded window around that
     * point and keeps the ride either side of it.
     */
    let cut: { fromMeters: number; toMeters: number };
    let from: { lat: number; lon: number };
    let to: { lat: number; lon: number };
    let nextVias: EditedRide["vias"];
    if (params.viaIndex !== null) {
      // A dragged stop: its own anchor is the one being moved, so the legs are
      // the ones on either side of it.
      const anchorIndex = along.findIndex((a) => a.viaIndex === params.viaIndex);
      if (anchorIndex <= 0 || anchorIndex >= along.length - 1) return;
      const before = along[anchorIndex - 1];
      const after = along[anchorIndex + 1];
      cut = { fromMeters: before.alongMeters, toMeters: after.alongMeters };
      from = { lat: before.lat, lon: before.lon };
      to = { lat: after.lat, lon: after.lon };
      nextVias = vias.map((v, i) => (i === params.viaIndex ? { ...v, lat: params.at.lat, lon: params.at.lon } : v));
    } else {
      // A tap on the line: a window around the tap, bounded by the stops
      // either side of it so a neighbour's own leg is never swallowed.
      if (vias.length >= 6) { setEditNote(ui.mapAddStopFull); return; }
      const alongMeters = nearestAlong([params.at.lon, params.at.lat], line, cum).alongMeters;
      const leg = legForPoint({ anchors: along, alongMeters });
      const window = tapCut({ line, cum, anchors: along, alongMeters });
      if (!leg || !window) return;
      cut = window.cut;
      from = { lat: window.from[1], lon: window.from[0] };
      to = { lat: window.to[1], lon: window.to[0] };
      // Inserted at the position the line meets it, which is the only order
      // that describes the ride the rider is looking at. A leg that starts at
      // the ride's own start has no via before it, so the new one is first.
      const previousVia = along[leg.beforeIndex].viaIndex;
      const insertAt = previousVia === null ? 0 : previousVia + 1;
      nextVias = [
        ...vias.slice(0, insertAt),
        { lat: params.at.lat, lon: params.at.lon, label: params.label ?? ui.mapStop },
        ...vias.slice(insertAt),
      ];
    }
    setEditing(true);
    setEditNote(null);
    const startedAt = startClock();
    try {
      const response = await fetch("/api/reroute-leg", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan,
          from: { lat: from.lat, lon: from.lon },
          through: params.at,
          to: { lat: to.lat, lon: to.lon },
        }),
      });
      if (!response.ok) {
        track("route_edit_failed", { reason: String(response.status) });
        setEditNote(ui.resEditFailed);
        return;
      }
      const data = (await response.json()) as {
        segments: GeoJSON.FeatureCollection<GeoJSON.LineString, import("@/lib/types").RouteSegmentProperties>;
        distanceMeters: number;
        durationSeconds: number;
        endpointMovedMeters?: number;
      };
      const next = spliceLeg({
        segments: baseSegments,
        distanceMeters: baseDistance,
        durationSeconds: baseDuration,
        cut,
        replacement: {
          segments: data.segments,
          distanceMeters: data.distanceMeters,
          durationSeconds: data.durationSeconds,
        },
      });
      const before = edited?.overlap.repeatedPercent ?? route?.overlap.repeatedPercent ?? 0;
      rememberForUndo(edited, params.how);
      setEditedFor({
        result,
        edited: {
          coordinates: next.coordinates,
          segments: next.segments,
          distanceMeters: next.distanceMeters,
          durationSeconds: next.durationSeconds,
          overlap: next.overlap,
          vias: nextVias,
          kind: "edit",
        },
      });
      setPlan({ ...plan, viaPlaces: nextVias.map((v) => v.label) });
      // The router moved the point to reach routable ground. Said out loud
      // rather than swallowed: the ride now goes somewhere slightly different
      // from where the finger landed, and CLAUDE.md's rule is that a
      // substitution is never silent.
      const moved = Math.round(data.endpointMovedMeters ?? 0);
      if (moved > 25) setEditNote(fi(ui.resEditMoved, { m: moved }));
      track("route_edited", {
        how: params.how,
        ms: elapsedMsSince(startedAt),
        repeated_before: before,
        repeated_after: next.overlap.repeatedPercent,
      });
    } catch {
      track("route_edit_failed", { reason: "network" });
      setEditNote(ui.resEditFailed);
    } finally {
      setEditing(false);
    }
  }

  function searchBetterLoop() {
    if (busyRef.current || !plan || selectedPois.length === 0) return;
    // Already-present names are dropped rather than duplicated: the rider may
    // have ticked something a previous pass put in the ride.
    const fresh = selectedPois.filter((p) => !plan.viaPlaces.includes(p.name));
    if (fresh.length === 0) { setSelectedPois([]); return; }
    // The plan carries at most six stops (`RidePlanSchema`); the card disables
    // its own button past that, and this is the belt to that brace.
    if (plan.viaPlaces.length + fresh.length > 6) return;
    track("suggestion_added", { via_count: plan.viaPlaces.length + fresh.length, batch: fresh.length });
    track("search_better_loop", { pois: fresh.length });
    const next: RidePlan = { ...plan, viaPlaces: [...plan.viaPlaces, ...fresh.map((p) => p.name)] };
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
    if (plan.viaPlaces.length + fresh.length > 6) return;
    // Nothing spliced means nothing was routed to splice — every ticked place
    // is still pending or unreachable. Falling through to the search would be
    // the slow path arriving unannounced, so the press simply waits.
    if (!spliced || spliced.applied.length === 0) return;

    const startedAt = performance.now();
    const overlap = recomputeOverlap(spliced.coordinates as Point[]);
    // The ride's places as this commit leaves them: the ones it already had,
    // plus the ticked sights in the order the spliced line meets them. Order
    // matters — these become the plan's vias, and a later full search plans
    // through them in the order given.
    const appliedIds = new Set(spliced.applied.map((d) => d.poiId));
    const addedInOrder = spliced.applied
      .map((d) => fresh.find((p) => p.id === d.poiId))
      .filter((p): p is SelectedPoi => Boolean(p));
    const base = currentVias();
    const edit: EditedRide = {
      coordinates: spliced.coordinates as Point[],
      segments: spliced.segments,
      distanceMeters: spliced.distanceMeters,
      durationSeconds: spliced.durationSeconds,
      overlap,
      // Inserted at the end of the vias, before the finish, the way a stop
      // added from a suggestion always has been: these places are somewhere
      // the ride already passes near, so they belong in the order the routed
      // line meets them rather than at a position the rider never chose.
      vias: insertVias(base, addedInOrder.map((p) => ({ lat: p.lat, lon: p.lon, label: p.name, category: p.category }))),
      kind: "commit",
    };
    rememberForUndo(edited, "commit");
    setEditedFor({ result, edited: edit });
    // Written into the plan too, so the ride the rider can share, save, export
    // or hand back to the search carries these places rather than only the
    // picture doing.
    setPlan({ ...plan, viaPlaces: [...plan.viaPlaces, ...addedInOrder.map((p) => p.name)] });
    const names = new Set(addedInOrder.map((p) => p.name));
    setPlaces([
      ...places.filter((p) => !names.has(p.name)),
      ...addedInOrder.map((p) => ({ name: p.name, label: p.name, lat: p.lat, lon: p.lon, kind: p.category, poiId: p.id })),
    ]);
    // A tick whose detour overlapped another's could not be spliced, so it is
    // not in the ride and its tick stays — the card already says why, and
    // dropping it here would quietly lose a place the rider asked for.
    setSelectedPois(selectedPois.filter((p) => !appliedIds.has(p.id)));
    setFocusPoi(null);
    setEditNote(null);
    track("sights_committed", {
      pois: spliced.applied.length,
      delta_km: Math.round((spliced.addedMeters / 1000) * 10) / 10,
      ms: Math.round(performance.now() - startedAt),
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

  async function retryLast() {
    if (!retry || busyRef.current) return;
    busyRef.current = true; setError(null);
    try { if (retry.stage === "chat") await converse(retry.messages, retry.plan); else await generate(retry.plan, retry.messages); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  // Which ride each category is currently showing. The card's ⟳ control moves
  // this, and the map reads it too — the state used to live inside the result
  // panel, so cycling a card changed its numbers and left the map on the old
  // line. One source, one truth.
  const [variantOffset, setVariantOffset] = useState<Record<string, number>>({});
  const card = result?.routes[Math.min(selected, (result?.routes.length ?? 1) - 1)] ?? null;
  const familyOf = (variant: string) => [
    ...(result?.routes ?? []).filter((r) => r.variant === variant),
    ...(result?.alternatives ?? []).filter((r) => r.variant === variant),
  ];
  const route = (() => {
    if (!card) return null;
    const family = familyOf(card.variant);
    return family[(variantOffset[card.variant] ?? 0) % Math.max(1, family.length)] ?? card;
  })();
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
    rideId: route?.id ?? null,
    coordinates: route?.geometry?.coordinates ?? null,
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
  const routedPlaces: ResolvedPlace[] | null = result
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
   */
  const planning = entryMode === "form" && !result;
  // While planning the map is always available, whether or not anything is
  // confirmed yet — it is now a way of *adding* places, so the rider with an
  // empty form is precisely the one it has to be openable for. (`picking` was
  // excused from the old rule for the same reason; this generalises it.) With
  // a result on screen the old rule stands: the map shows the ride.
  const mapVisible = Boolean(result) || previewPlaces.length > 0 || picking || planning;
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
        // screen: the rider is looking at what the tick did. Below it, an
        // edited ride — sights he kept, a stop he dragged — is the ride
        // itself. The API's own line is what remains when neither applies,
        // which is also what undoing back to the start restores.
        segments={spliced?.segments ?? edited?.segments ?? route?.segments ?? null}
        // The start row's own place, never "the first place that happens to be
        // confirmed". An empty start row draws no start pin — which is the
        // whole of the bug this replaced: four stops added from the map became
        // a green start, two numbers and a red finish.
        start={result?.start ?? preview.start ?? null}
        // A 🅿️ is a stop, so the finish must never be one — and the finish is
        // the finish *row*, not the last confirmed place. `placeRoles` already
        // returns null for a round trip (it returns to its start and has no
        // destination) and for an empty finish row, so both of the cases the
        // old positional rule got wrong are answered before they reach here.
        destination={result?.destination ?? preview.finish ?? null}
        // The ride's stops as they stand — from the edit when there is one, so
        // a dragged pin stays where it was dropped and a tapped-in stop gets a
        // pin of its own, rather than both snapping back to what the API
        // returned on the next render.
        via={result
          ? (edited ? edited.vias : (result.via ?? [])).map((v) => ({
              ...v,
              ...(stopKind(stopKinds, v.label) ?? {}),
              // The POI category behind this via, when it came from a
              // suggestion: the marker then carries the sight's own glyph
              // instead of the 🅿️ that means "a stop you typed". Read from
              // the picked places rather than from `stopKinds`, because that
              // map is keyed by name and holds every place *near* the ride —
              // a village the route merely passes would otherwise steal a
              // typed stop's pill.
              ...(pickedCategory(places, v.label) ? { category: pickedCategory(places, v.label) } : {}),
            }))
          : preview.vias}
        // Correcting the ride on the result map: drag a numbered stop, or tap
        // the line to add one. Offered only with a ride on screen and only
        // while no leg is already being re-routed — a second edit on top of an
        // in-flight one would splice into a line that is about to be replaced.
        // `picking` takes precedence for the same reason it does elsewhere: a
        // map answering "where does this row go" must not also be answering
        // "change the ride".
        // `FAST_REROUTE` first: this prop is the single thing both entry
        // points hang from — the map makes its stop pins draggable only when
        // it is given, and only then does a tap on the line add a via — so
        // withholding it shuts both at once and leaves nothing half-wired for
        // a rider to find. See the flag for why, and for what to do to
        // resume.
        onEditRoute={FAST_REROUTE && result && !picking && !editing ? editRoute : undefined}
        editingRoute={editing}
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
        // only while a row is actually waiting: with no `onPickPoint` the map
        // answers a click the way it always has, and the violet marker is not
        // a fourth kind of pin left lying on a finished ride.
        onPickPoint={picking ? takePoint : undefined}
        pickedPoint={picking ? pickPoint : null}
        onPickedPointMove={takePoint}
        pickCenter={picking ? pickCenter : null}
        // The planning header: the hint naming the active row, "+ Pietura",
        // and the place field bound to that row. Only while the form is the
        // view — a result map has no active row and nothing to add a stop to,
        // and a header over a finished ride would be describing a form the
        // rider has left.
        controls={planning ? mapControls : null}
        onGeolocated={setGeolocated} />
    </MapPanel>
  );
  // Where the map lives depends only on the viewport and the view — never on
  // whether it currently has anything to show. Folding `mapVisible` in here
  // meant the placement flipped at the same moment the map appeared, and the
  // map could be left in the hidden desktop cell: zero-sized, taking its
  // full-screen button down to 0 x 0 px with it.
  const mapInComposer = !desktop && entryMode === "form";
  // The result panel hosts it too: under the ride heading, above the versions.
  const mapInResult = !desktop && entryMode === "chat" && Boolean(result) && !chatting;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      <IntroSplash />
      {/* The plus only appears once there is something to clear — on a fresh
          page it would do nothing. */}
      <SiteHeader
        showNewRide={messages.length > 0 || Boolean(plan)}
        newRideDisabled={phase !== "idle"}
        onNewRide={() => { firstFromFormRef.current = false; setEntryMode("form"); setMessages([]); setPlan(null); setPlaces([]); setResult(null); setChatting(false); setError(null); setRetry(null); setQuickReplies([]); }} />
      <div className="grid items-start gap-5 md:grid-cols-[minmax(340px,460px)_1fr]">
        <div className="min-w-0 space-y-4">
          <InstallPrompt show={Boolean(result) && !chatting} />
          {entryMode === "form"
            ? <RideComposer key={plan ? planSummary(plan, locale) : "new"} initialPlan={plan} initialPlaces={places} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={() => setEntryMode("chat")} onPlacesChange={setPreview} map={mapInComposer && mapVisible ? mapPanel : undefined}
                onPickModeChange={changePickMode} pickPoint={pickPoint} geolocated={geolocated}
                onMapControlsChange={setMapControls} mapShown={mapVisible && planning} />
            : result && result.routes.length > 0 && !chatting
              ? <ResultPanel routes={result.routes} selected={selected} onSelect={setSelected} plan={plan} avoidTowns={result.intent.avoidTowns ?? false} lucky={lucky} remoteLoop={result.remoteLoop} longerSuggestion={result.longerSuggestion} tolerancePercent={result.intent.distanceTolerancePercent} busy={phase !== "idle"} onSend={send} onBackToForm={() => setEntryMode("form")} map={mapInResult && mapVisible ? mapPanel : undefined} resolvedPlaces={routedPlaces} alternatives={result.alternatives} sparsePlaceData={result.sparsePlaceData} assembledFromSegments={result.assembledFromSegments} directLeg={showingDirect} offset={variantOffset} onOffsetChange={setVariantOffset} onShowPoi={showPoi} pois={routePois} poisLoading={poisLoading} poisFailed={poisFailed} onDetoursChange={setDetoursForMap} selectedPois={selectedPois} onToggleSelectPoi={toggleSelectPoi} onClearSelectedPois={clearSelectedPois} onCommitSelection={commitSelection} onSearchBetterLoop={searchBetterLoop} onSplicedChange={handleSplicedChange} edited={edited} canUndo={canUndo} onUndoEdit={undoEdit} editing={editing} editNote={editNote} />
              : <RoutePrompt messages={messages} plan={plan} hasRoute={Boolean(route)} phase={phase} quickReplies={quickReplies} lucky={lucky && !route} onSend={send} onBackToForm={() => setEntryMode("form")} originCode={origin?.code ?? null} onAction={(reply) => { if (reply.action === "retry") { retryLast(); return; } if (reply.action === "direct-leg") { showDirectLeg(); return; } if (reply.action === "remove-stop" || reply.action === "move-stop") { if (reply.stop) reviseUnreachableStop(reply.stop, reply.action === "move-stop" ? "move" : "remove"); return; } setChatting(false); setQuickReplies([]); }} onCancel={cancel} />}
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
