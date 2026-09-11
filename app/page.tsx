"use client";

import { useRef, useState } from "react";
import { RouteMap } from "@/components/route-map";
import { RoutePrompt } from "@/components/route-prompt";
import { RouteSummary } from "@/components/route-summary";
import { RideComposer } from "@/components/ride-composer";
import { ChatMessage, ChatQuickReply, ChatResponse, RidePlan, planSummary } from "@/lib/chat/ride-plan";
import { seedPlanFromProfile } from "@/lib/chat/ride-profile";
import { useRideProfile } from "@/lib/chat/use-ride-profile";
import { GenerateRouteResponse } from "@/lib/types";

type Retry = { stage: "chat"; messages: ChatMessage[]; plan: RidePlan | null } | { stage: "route"; messages: ChatMessage[]; plan: RidePlan };
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
  // The rider's standing profile (how rough, why, where): remembered on the
  // device, applied to the form and used to seed a fresh chat so it only has
  // to ask where and how long.
  const [profile, changeProfile] = useRideProfile();
  const busyRef = useRef(false);

  async function generate(current: RidePlan, conversation: ChatMessage[]) {
    setPhase("routing");
    const sourcePrompt = conversation.filter(m => m.role === "user").map(m => m.content).join("\n");
    try {
      const response = await fetch("/api/generate-route", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ plan: current, prompt: sourcePrompt }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Neizdevās ģenerēt maršrutu.");
      const route = (data as GenerateRouteResponse).routes[0];
      if (!route) throw new Error("Neizdevās atrast prasībām atbilstošu maršrutu.");
      setResult(data);
      setQuickReplies([]);
      const minutes = Math.round(route.durationSeconds / 60);
      const notes = [`Maršruts gatavs: ${Math.round(route.distanceMeters / 1000)} km, aptuveni ${Math.floor(minutes/60)} h ${minutes%60} min.`,
        route.stops?.length ? `Pieturvietas: ${route.stops.map(s => s.name).join(" → ")}.` : "",
        route.overlap.repeatedPercent ? `${route.overlap.repeatedPercent}% brauciena atkārto jau izmantotus ceļus.` : "",
        data.distanceWarning ? "Maršruts ir garāks par vēlamo. Vari precizēt ilgumu vai prasības čatā." : "",
        "Apskati karti. Šeit vari pateikt, ko vēlies mainīt.",
      ];
      setMessages([...conversation, { role: "assistant", content: notes.filter(Boolean).join(" ") }]);
      setRetry(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Neizdevās ģenerēt maršrutu.");
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
      setError(e instanceof Error ? e.message : "Neizdevās saņemt atbildi.");
      setRetry({ stage: "chat", messages: conversation, plan: previousPlan });
    }
  }

  async function send(text: string) {
    if (busyRef.current) return;
    if (messages.length >= 37) { setError("Saruna sasniegusi šīs versijas garuma robežu. Sāc jaunu braucienu."); return; }
    busyRef.current = true; setError(null); setRetry(null);
    setQuickReplies([]);
    const next: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    try { await converse(next, plan ?? seedPlanFromProfile(profile)); } finally { setPhase("idle"); busyRef.current = false; }
  }
  async function startFromForm(current: RidePlan) {
    if (busyRef.current) return;
    busyRef.current = true; setError(null); setRetry(null); setQuickReplies([]); setResult(null); setPlan(current); setEntryMode("chat");
    const conversation: ChatMessage[] = [{ role: "user", content: `Brauciena ievade: ${planSummary(current, true)}.` }];
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
  const route = result?.routes[0] ?? null;
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1600px] px-4 py-5 md:px-7">
      <header className="mb-5 flex items-center justify-between border-b border-stone-200 pb-4">
        <div className="flex items-baseline gap-3"><h1 className="text-2xl font-bold tracking-tight">Mopik<span className="text-[#f56300]">.</span></h1><p className="hidden text-xs text-stone-500 sm:block">Mazāk plānošanas. Vairāk braukšanas.</p></div>
        {(messages.length > 0 || plan) && <button disabled={phase !== "idle"} onClick={() => { setEntryMode("form"); setMessages([]); setPlan(null); setResult(null); setError(null); setRetry(null); setQuickReplies([]); }} className="text-xs text-stone-500 underline underline-offset-4 disabled:opacity-40">Jauns brauciens</button>}
      </header>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(320px,400px)_1fr]">
        <div className="min-w-0">
          {entryMode === "form"
            ? <RideComposer key={plan ? planSummary(plan, false) : "new"} initialPlan={plan} profile={profile} onProfileChange={changeProfile} busy={phase !== "idle"} onGenerate={startFromForm} onUseChat={() => setEntryMode("chat")} />
            : <RoutePrompt messages={messages} plan={plan} hasRoute={Boolean(route)} phase={phase} quickReplies={quickReplies} onSend={send} onBackToForm={() => setEntryMode("form")} />}
          {error && <div role="alert" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p>{error}</p>{retry && <button onClick={retryLast} disabled={phase !== "idle"} className="mt-2 underline underline-offset-4 disabled:opacity-40">Mēģināt vēlreiz</button>}</div>}
        </div>
        <div className="min-w-0 space-y-4">
          <div className="h-[55vh] overflow-hidden rounded-2xl border border-stone-200 md:h-[calc(100vh-10rem)]">
            <RouteMap segments={route?.segments ?? null} start={result?.start ?? null} destination={result?.destination ?? null} via={result?.via} showTet={showTet} onToggleTet={setShowTet} />
          </div>
          {route && <RouteSummary route={route} avoidTowns={result?.intent.avoidTowns ?? false} />}
        </div>
      </div>
    </main>
  );
}
