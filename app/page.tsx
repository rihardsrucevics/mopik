"use client";

import { useRef, useState } from "react";
import { RouteMap } from "@/components/route-map";
import { RoutePrompt } from "@/components/route-prompt";
import { ResultPanel } from "@/components/result-panel";
import { IntroSplash } from "@/components/intro-splash";
import { RideComposer } from "@/components/ride-composer";
import { ChatMessage, ChatQuickReply, ChatResponse, RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { seedPlanFromProfile } from "@/lib/chat/ride-profile";
import type { ResolvedPlace } from "@/lib/chat/places";
import { useRideProfile } from "@/lib/chat/use-ride-profile";
import { GenerateRouteResponse } from "@/lib/types";

type Retry = { stage: "chat"; messages: ChatMessage[]; plan: RidePlan | null } | { stage: "route"; messages: ChatMessage[]; plan: RidePlan };

/**
 * A message a rider can forward. Browser DOM errors (Safari: "The string did
 * not match the expected pattern") carry no context on their own, so the
 * error name and the first stack frame are appended for anything that is not
 * one of our own messages.
 */
function describeError(e: unknown, fallback: string): string {
  if (!(e instanceof Error)) return fallback;
  const ours = /[āčēģīķļņšūž]|Neizdev|Tell us|couldn't|route/i.test(e.message) && e.name === "Error";
  if (ours) return e.message;
  const frame = e.stack?.split("\n").find((l) => /@|at /.test(l))?.trim().slice(0, 80);
  console.error("Mopik: request failed", e);
  return `${fallback} (${e.name}: ${e.message}${frame ? ` — ${frame}` : ""})`;
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
  // Places picked in the form, with coordinates; sent with every generation
  // so chat corrections keep pointing at the same towns.
  const [places, setPlaces] = useState<ResolvedPlace[]>([]);
  // The rider's standing profile (how rough, why, where): remembered on the
  // device, applied to the form and used to seed a fresh chat so it only has
  // to ask where and how long.
  const [profile, changeProfile] = useRideProfile();
  const busyRef = useRef(false);

  async function generate(current: RidePlan, conversation: ChatMessage[]) {
    setPhase("routing");
    const sourcePrompt = conversation.filter(m => m.role === "user").map(m => m.content).join("\n");
    try {
      const isLucky = current.returnToStart === true && current.viaPlaces.length === 0 && !current.focusArea && current.budget.mode === "flexible";
      setLucky(isLucky);
      const response = await fetch("/api/generate-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: current, prompt: sourcePrompt, places, lucky: isLucky }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neizdevās ģenerēt maršrutu.");
      const route = (data as GenerateRouteResponse).routes[0];
      if (!route) throw new Error("Neizdevās atrast prasībām atbilstošu maršrutu.");
      setResult(data);
      // The lucky ride leads with the most interesting version.
      const complexIndex = (data as GenerateRouteResponse).routes.findIndex((r) => r.variant === "complex");
      setSelected(isLucky && complexIndex >= 0 ? complexIndex : 0);
      setChatting(false);
      setQuickReplies([]);
      const versions = (data as GenerateRouteResponse).routes.length;
      // The numbers are in the result card; the message only says what to do next.
      const notes = [
        isLucky ? "Bez galamērķa un laika limita? Laimīgais! Atradu tev kaut ko foršu." : "",
        versions > 1 ? `Gatavs — ${versions} versijas zemāk, pārslēdz un skaties kartē.` : "Gatavs — maršruts kartē.",
        data.remoteLoop ? `Pārbrauciens līdz ${(data as GenerateRouteResponse).remoteLoop!.focus.label.split(",")[0]} ~${(data as GenerateRouteResponse).remoteLoop!.transitOutMinutes} min, atpakaļ ~${(data as GenerateRouteResponse).remoteLoop!.transitBackMinutes} min; pa vidu aplis.` : "",
        data.distanceWarning ? "Maršruts iznāca garāks par vēlamo." : "",
        "Saki, ko mainīt: īsāku, vairāk pa mežu, caur kādu vietu…",
      ];
      setMessages([...conversation, { role: "assistant", content: notes.filter(Boolean).join(" ") }]);
      setRetry(null);
    } catch (e) {
      setError(describeError(e, "Neizdevās ģenerēt maršrutu."));
      setRetry({ stage: "route", plan: current, messages: conversation });
    }
  }

  async function converse(conversation: ChatMessage[], previousPlan: RidePlan | null) {
    setPhase("thinking");
    try {
      const response = await fetch("/api/route-chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: conversation, plan: previousPlan }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neizdevās saņemt atbildi.");
      const answer = data as ChatResponse;
      const updated: ChatMessage[] = [...conversation, { role: "assistant", content: answer.message }];
      setMessages(updated); setPlan(answer.plan); setResult(null); setRetry(null);
      setQuickReplies(answer.quickReplies ?? []);
      if (answer.ready) await generate(answer.plan, updated);
    } catch (e) {
      setError(describeError(e, "Neizdevās saņemt atbildi."));
      setRetry({ stage: "chat", messages: conversation, plan: previousPlan });
    }
  }

  async function send(text: string) {
    if (busyRef.current) return;
    if (messages.length >= 37) { setError("Saruna sasniegusi šīs versijas garuma robežu. Sāc jaunu braucienu."); return; }
    busyRef.current = true; setError(null); setRetry(null);
    setQuickReplies([]); setChatting(true);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    try { await converse(next, plan ?? seedPlanFromProfile(profile)); } finally { setPhase("idle"); busyRef.current = false; }
  }
  async function startFromForm(current: RidePlan, picked: ResolvedPlace[]) {
    if (busyRef.current) return;
    busyRef.current = true; setError(null); setRetry(null); setQuickReplies([]); setResult(null); setPlan(current); setPlaces(picked); setEntryMode("chat");
    // Short: the profile is in the panel header and the plan object travels
    // with every chat turn, so the message only needs the places and budget.
    const places = [current.startPlace, ...current.viaPlaces, current.returnToStart ? current.startPlace : current.destinationPlace].filter(Boolean).join(" → ");
    const budget = current.budget.mode === "duration" ? `~${current.budget.value} h` : current.budget.mode === "distance" ? `~${current.budget.value} km` : "brīvs ilgums";
    const conversation: ChatMessage[] = [{ role: "user", content: `${places}, ${budget}.` }];
    setMessages(conversation);
    try { await generate(current, conversation); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  async function retryLast() {
    if (!retry || busyRef.current) return;
    busyRef.current = true; setError(null);
    try { if (retry.stage === "chat") await converse(retry.messages, retry.plan); else await generate(retry.plan, retry.messages); }
    finally { setPhase("idle"); busyRef.current = false; }
  }
  const route = result?.routes[Math.min(selected, (result?.routes.length ?? 1) - 1)] ?? null;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      <IntroSplash />
      <header className="mb-5 flex items-center justify-between border-b border-stone-200 pb-4">
        <div className="flex items-baseline gap-3">{/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload on purpose: a fresh plan */}
            <h1 className="text-2xl font-bold tracking-tight"><a href="/" aria-label="Mopik — uz sākumu">Mopik<span className="text-[#f56300]">.</span></a></h1><p className="hidden text-xs text-stone-500 sm:block">Mazāk plānošanas. Vairāk braukšanas.</p></div>
        {(messages.length > 0 || plan) && <button disabled={phase !== "idle"} onClick={() => { setEntryMode("form"); setMessages([]); setPlan(null); setPlaces([]); setResult(null); setChatting(false); setError(null); setRetry(null); setQuickReplies([]); }} className="text-xs text-stone-500 underline underline-offset-4 disabled:opacity-40">Jauns brauciens</button>}
      </header>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(340px,460px)_1fr]">
        <div className="min-w-0 space-y-4">
          {entryMode === "form"
            ? <RideComposer key={plan ? planSummary(plan, false) : "new"} initialPlan={plan} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={() => setEntryMode("chat")} />
            : result && result.routes.length > 0 && !chatting
              ? <ResultPanel routes={result.routes} selected={selected} onSelect={setSelected} plan={plan} avoidTowns={result.intent.avoidTowns ?? false} lucky={lucky} remoteLoop={result.remoteLoop} longerSuggestion={result.longerSuggestion} tolerancePercent={result.intent.distanceTolerancePercent} busy={phase !== "idle"} onSend={send} onBackToForm={() => setEntryMode("form")} />
              : <RoutePrompt messages={messages} plan={plan} hasRoute={Boolean(route)} phase={phase} quickReplies={quickReplies} lucky={lucky && !route} onSend={send} onBackToForm={() => setEntryMode("form")} />}
          {error && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>{error}</p>{retry && <button onClick={retryLast} disabled={phase !== "idle"} className="mt-2 underline underline-offset-4 disabled:opacity-40">Mēģināt vēlreiz</button>}</div>}
        </div>
        {/* Sticky on the desktop; on the phone the map only appears once
            there is a route to show, above the result. Nothing overlays it. */}
        <div className={`order-first min-w-0 md:order-none md:sticky md:top-5 ${result ? "" : "hidden md:block"}`}>
          <div className="relative h-[42dvh] overflow-hidden rounded-2xl border border-stone-200 md:h-[calc(100vh-7rem)]">
            <RouteMap segments={route?.segments ?? null} start={result?.start ?? null} destination={result?.destination ?? null} via={result?.via} showTet={showTet} onToggleTet={setShowTet} />
          </div>
        </div>
      </div>
    </main>
  );
}
