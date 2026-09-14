"use client";

import { useCallback, useRef, useState, useEffect } from "react";
import { RouteMap } from "@/components/route-map";
import { RoutePrompt } from "@/components/route-prompt";
import { ResultPanel } from "@/components/result-panel";
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
import { GenerateRouteResponse } from "@/lib/types";
import { POI_KIND } from "@/lib/poi/kinds";

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

export default function Home() {
  const [entryMode, setEntryMode] = useState<"form" | "chat">("form");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [plan, setPlan] = useState<RidePlan | null>(null);
  const [result, setResult] = useState<GenerateRouteResponse | null>(null);
  const [phase, setPhase] = useState<"idle" | "thinking" | "routing">("idle");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<Retry | null>(null);
  const [showTet, setShowTet] = useState(false);
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
  // Places confirmed in the form but not yet routed: the map shows them so a
  // wrong "Valmiera" is caught before a generation is spent on it.
  const [previewPlaces, setPreviewPlaces] = useState<ResolvedPlace[]>([]);
  // Whether the last of them is a finish or a stop. The composer reports it
  // with the places because the list alone cannot say: a 🅿️ means "a stop of
  // this ride", and on a one-way ride the last place is the destination and
  // gets the destination's own pin. Without this, Berlin → Warszawa drew a
  // 🅿️ on Warszawa.
  const [previewRoundTrip, setPreviewRoundTrip] = useState(false);
  /**
   * The suggestion the rider pressed "Kartē" on, if any.
   *
   * Lives here rather than in the result panel because the map does — the same
   * reason `variantOffset` moved up. `token` rises on every press so pressing
   * the same row twice flies back to it after a pan; comparing the place
   * itself would make the second press do nothing.
   */
  const [focusPoi, setFocusPoi] = useState<{ lat: number; lon: number; label: string; kind?: string; token: number } | null>(null);
  const focusTokenRef = useRef(0);
  const clearFocusPoi = useCallback(() => setFocusPoi(null), []);
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
        if (carried.length) { setPlaces(carried); setPreviewPlaces(carried); }
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
        const { message, quickReplies: replies } = describeUnplannable(unplannable, true);
        setMessages([...conversation, { role: "assistant", content: message }]);
        setQuickReplies(replies);
        setChatting(true);
        setRetry(null);
        return;
      }
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
  function showPoi(poi: { name: string; lat: number; lon: number; category: string }) {
    focusTokenRef.current += 1;
    const entry = POI_KIND[poi.category as keyof typeof POI_KIND];
    track("suggestion_shown", { kind: poi.category });
    setFocusPoi({
      lat: poi.lat,
      lon: poi.lon,
      label: poi.name,
      kind: entry ? ui[entry.key as keyof typeof ui] ?? poi.category : poi.category,
      token: focusTokenRef.current,
    });
    if (desktop) return;
    requestAnimationFrame(() => {
      document.querySelector("[data-map-slot]")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function addStop(place: { name: string; lat: number; lon: number }) {
    if (busyRef.current || !plan) return;
    if (plan.viaPlaces.some((v) => v === place.name)) return;
    // The plan carries at most six stops (`RidePlanSchema`); past that the
    // press does nothing rather than producing a plan the schema refuses.
    if (plan.viaPlaces.length >= 6) return;
    track("suggestion_added", { via_count: plan.viaPlaces.length + 1 });
    const next: RidePlan = { ...plan, viaPlaces: [...plan.viaPlaces, place.name] };
    const picked: ResolvedPlace[] = [
      ...places.filter((p) => p.name !== place.name),
      { name: place.name, label: place.name, lat: place.lat, lon: place.lon },
    ];
    void startFromForm(next, picked);
  }

  /**
   * The Pievienot inside the card the map opens on a focused suggestion.
   *
   * The card is markup MapLibre parses from a string, so it carries no closure
   * of its own and calls this instead. The ring and the card go first: the ride
   * is about to be re-planned, and a "look at this" marker left standing over
   * the new route would claim the place was still only a suggestion.
   */
  function addFocusedPoi() {
    if (!focusPoi) return;
    setFocusPoi(null);
    addStop({ name: focusPoi.label, lat: focusPoi.lat, lon: focusPoi.lon });
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
   * Filled by the result panel when it loads its suggestions — the same
   * request, so a stop's marker costs nothing extra — and read by the map to
   * put a kind ("pilskalns") in a stop's card instead of only its name. A stop
   * the dataset does not know keeps the plain "Pieturvieta" card, which is
   * also what every ride outside the Baltics gets.
   */
  const [stopInfo, setStopInfo] = useState<{
    /** the ride these kinds describe, so a stale set is never applied to a new one */
    forResult: GenerateRouteResponse | null;
    kinds: Record<string, { kind: string }>;
  }>({ forResult: null, kinds: {} });

  /**
   * Keep what the lookup learned about places this ride passes, keyed by name.
   *
   * Only the stops are of interest here — the map labels those — but the whole
   * list is cheap to index and a stop added from Ieteikumi arrives in the
   * nearby list under exactly the name it will carry into the plan.
   */
  function notePois(pois: { onRoute: { name: string; category: string }[]; nearby: { name: string; category: string }[] }) {
    const kinds: Record<string, { kind: string }> = {};
    for (const p of [...pois.onRoute, ...pois.nearby]) {
      const entry = POI_KIND[p.category as keyof typeof POI_KIND];
      if (entry) kinds[p.name] = { kind: ui[entry.key as keyof typeof ui] ?? p.category };
    }
    setStopInfo({ forResult: result, kinds });
  }

  // What the API actually routed through, in riding order. These are the
  // coordinates worth keeping in a share code — they made this route, rather
  // than being a fresh guess at what the names mean.
  const routedPlaces: ResolvedPlace[] | null = result
    ? [result.start, ...(result.via ?? []), ...(result.destination ? [result.destination] : [])]
        .map((p) => ({ name: p.label, label: p.label, lat: p.lat, lon: p.lon }))
    : null;
  // One map, two homes. On a desktop it is the sticky right column; on a phone
  // it belongs inside the ride block, under the places it confirms — above the
  // whole page it outranked even ui.savedRides and read as a separate thing.
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const mapVisible = Boolean(result) || previewPlaces.length > 0;
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
        segments={route?.segments ?? null}
        start={result?.start ?? previewPlaces[0] ?? null}
        // A 🅿️ is a stop, so the finish must never be one. While a ride is
        // only being composed the map has to make the same distinction the
        // result does: on a one-way ride with two or more confirmed places the
        // last is the destination and takes the red pin, and everything
        // between it and the start is a stop. A round trip has no destination
        // at all — it returns to the start — so every place after the first is
        // a stop, which is what the old `slice(1)` assumed for both shapes.
        destination={result?.destination ?? (!previewRoundTrip && previewPlaces.length > 1 ? previewPlaces[previewPlaces.length - 1] : null)}
        via={result
          ? (result.via ?? []).map((v) => ({ ...v, ...((stopInfo.forResult === result ? stopKind(stopInfo.kinds, v.label) : undefined) ?? {}) }))
          : previewRoundTrip ? previewPlaces.slice(1) : previewPlaces.slice(1, -1)}
        focus={focusPoi}
        onFocusCleared={clearFocusPoi}
        onFocusAdd={addFocusedPoi}
        showTet={showTet} onToggleTet={setShowTet} />
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
            ? <RideComposer key={plan ? planSummary(plan, locale) : "new"} initialPlan={plan} initialPlaces={places} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={() => setEntryMode("chat")} onPlacesChange={(p, tripType) => { setPreviewPlaces(p); setPreviewRoundTrip(tripType === "round_trip"); }} map={mapInComposer && mapVisible ? mapPanel : undefined} />
            : result && result.routes.length > 0 && !chatting
              ? <ResultPanel routes={result.routes} selected={selected} onSelect={setSelected} plan={plan} avoidTowns={result.intent.avoidTowns ?? false} lucky={lucky} remoteLoop={result.remoteLoop} longerSuggestion={result.longerSuggestion} tolerancePercent={result.intent.distanceTolerancePercent} busy={phase !== "idle"} onSend={send} onBackToForm={() => setEntryMode("form")} map={mapInResult && mapVisible ? mapPanel : undefined} resolvedPlaces={routedPlaces} alternatives={result.alternatives} sparsePlaceData={result.sparsePlaceData} assembledFromSegments={result.assembledFromSegments} offset={variantOffset} onOffsetChange={setVariantOffset} onAddStop={addStop} onShowPoi={showPoi} onPoisLoaded={notePois} />
              : <RoutePrompt messages={messages} plan={plan} hasRoute={Boolean(route)} phase={phase} quickReplies={quickReplies} lucky={lucky && !route} onSend={send} onBackToForm={() => setEntryMode("form")} originCode={origin?.code ?? null} onAction={(action) => { if (action === "retry") { retryLast(); return; } setChatting(false); setQuickReplies([]); }} onCancel={cancel} />}
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
