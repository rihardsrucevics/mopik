"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowUp, LoaderCircle } from "lucide-react";
import { ChatMessage, ChatQuickReply, RidePlan, planSummary } from "@/lib/chat/ride-plan";

type Props = {
  messages: ChatMessage[];
  plan: RidePlan | null;
  hasRoute: boolean;
  phase: "idle" | "thinking" | "routing";
  quickReplies: ChatQuickReply[];
  onSend: (text: string) => void;
  onBackToForm: () => void;
};

export function RoutePrompt({ messages, plan, hasRoute, phase, quickReplies, onSend, onBackToForm }: Props) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    if (messages.length > 0 || busy) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, busy]);

  const send = (message: string) => {
    if (!message.trim() || busy) return;
    onSend(message.trim());
  };
  const submit = () => {
    if (!text.trim()) return;
    send(text);
    setText("");
  };

  return (
    <section className="flex h-[75dvh] min-h-[500px] flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] md:h-[calc(100vh-10rem)]" aria-label="Brauciena saruna">
      <div className="border-b border-stone-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{hasRoute ? "Maršruta korekcijas" : messages.length ? "Brauciena plāns" : "Brīvā saruna"}</div>
            <h2 className="text-lg font-semibold tracking-tight">{hasRoute ? "Ko vēlies mainīt?" : messages.length ? "Precizēsim ieceri." : "Apraksti ieceri saviem vārdiem."}</h2>
          </div>
          <button type="button" onClick={onBackToForm} disabled={busy} className="inline-flex shrink-0 items-center gap-1 text-xs text-stone-500 underline decoration-stone-300 underline-offset-4 disabled:opacity-40"><ArrowLeft className="size-3.5" />Ievades forma</button>
        </div>
        {plan && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-stone-500">{planSummary(plan, true)}</p>}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5" role="log" aria-label="Sarunas ziņas" aria-live="polite">
        {messages.length === 0 && (
          <div className="py-5 text-sm leading-7 text-stone-600">
            <p>Vari uzreiz pateikt visu, ko zini.</p>
            <p className="mt-3 border-l-2 border-[#f56300] pl-4 text-stone-500">Piemēram: no Ķekavas caur Baldoni un atpakaļ, ap 3 stundām, meži un tehniskāki ceļi.</p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} className={message.role === "user" ? "ml-5 rounded-2xl rounded-br-sm bg-stone-900 px-4 py-3 text-white" : "mr-2 text-stone-700"}>
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${message.role === "user" ? "text-stone-400" : "text-[#bd4b00]"}`}>{message.role === "user" ? "Tu" : "Mopik"}</div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          </div>
        ))}
        {!busy && quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Ātrās atbildes">
            {quickReplies.map((reply) => <button key={reply.label} type="button" onClick={() => send(reply.message)} className="rounded-full border border-[#f56300] bg-white px-3.5 py-2 text-xs font-medium text-[#bd4b00] transition hover:bg-[#fff4ec]">{reply.label}</button>)}
          </div>
        )}
        {busy && <div className="flex items-center gap-2 text-xs text-stone-500" role="status"><LoaderCircle className="size-3.5 animate-spin" />{phase === "thinking" ? "Atjauninu brauciena plānu…" : "Meklēju piemērotus ceļus un pārbaudu maršrutu…"}</div>}
        <div ref={endRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-t border-stone-200 bg-white p-3">
        <label htmlFor="ride-message" className="sr-only">Ziņa par braucienu</label>
        <div className="flex items-end gap-2 rounded-xl border border-stone-200 p-2 focus-within:border-[#f56300]">
          <textarea id="ride-message" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={6000} disabled={busy}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
            placeholder={hasRoute ? "Piemēram: īsāku un vairāk pa mežu…" : messages.length ? "Papildini ieceri…" : "Apraksti savu braucienu…"}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-stone-400 disabled:opacity-60" />
          <button type="submit" disabled={busy || !text.trim()} aria-label="Nosūtīt ziņu" className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35"><ArrowUp className="size-5" /></button>
        </div>
        <p className="mt-2 px-1 text-[10px] text-stone-400">Enter — nosūtīt · Shift + Enter — jauna rinda</p>
      </form>
    </section>
  );
}
