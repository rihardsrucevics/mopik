"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";
import Link from "next/link";
import { ArrowLeft, ArrowUp } from "lucide-react";
import { RouteLoader } from "@/components/route-loader";
import { track } from "@/lib/analytics";
import { ChatMessage, ChatQuickReply, RidePlan, planSummary } from "@/lib/chat/ride-plan";

type Props = {
  messages: ChatMessage[];
  plan: RidePlan | null;
  hasRoute: boolean;
  phase: "idle" | "thinking" | "routing";
  quickReplies: ChatQuickReply[];
  /** the rider gave only a start and no time: the lucky ride */
  lucky?: boolean;
  onSend: (text: string) => void;
  onBackToForm: () => void;
  /**
   * The route this conversation is adjusting, when the rider arrived from one
   * (a shared or saved ride opened with t(locale, "chatAdjust")). Until a new route is
   * generated there is nothing to go back to in this tab, so the way out is
   * the ride itself rather than an empty form.
   */
  originCode?: string | null;
  /** a quick reply that acts on the client (show the routes) instead of being sent */
  onAction?: (action: "show-routes" | "retry") => void;
  /** Call the generation in flight off. */
  onCancel?: () => void;
};

export function RoutePrompt({ messages, plan, hasRoute, phase, quickReplies, lucky = false, onSend, onBackToForm, originCode = null, onAction, onCancel }: Props) {
  const [locale] = useLocale();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastRef = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle";

  // A reply is read from its first line, so the log scrolls to the START of
  // the latest assistant message (only the log itself, never the page);
  // while working or after the rider's own message, it follows the end.
  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    const last = messages[messages.length - 1];
    if (!busy && last?.role === "assistant" && lastRef.current) {
      log.scrollTo({ top: Math.max(0, lastRef.current.offsetTop - 8), behavior: "smooth" });
    } else if (messages.length > 0 || busy) {
      log.scrollTo({ top: log.scrollHeight, behavior: "smooth" });
    }
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
    <section className={`flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] md:h-[calc(100vh-7rem)] ${hasRoute ? "h-[max(360px,calc(74dvh-8.5rem))]" : "h-[calc(100dvh-7.5rem)]"}`} aria-label={t(locale, "a11yChatRegion")}>
      <div className="border-b border-stone-200 px-4 py-3 md:px-5 md:py-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">{hasRoute ? t(locale, "chatRefine") : messages.length ? t(locale, "chatPlanned") : t(locale, "chatFree")}</div>
            <h2 className="text-lg font-semibold tracking-tight">{hasRoute ? t(locale, "chatWhatToChange") : messages.length ? t(locale, "chatTitle") : t(locale, "chatIntro")}</h2>
          </div>
          {/* Came from a route and none has been generated since? Then "back"
              means that route, not a blank form the rider never filled in. */}
          {originCode && !hasRoute ? (
            <Link href={`/r/${originCode}`} aria-label={t(locale, "backToRoute")} title={t(locale, "backToRoute")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900"><ArrowLeft className="size-4" /></Link>
          ) : (
            // Icon only: a left arrow already means "back to the form", and
            // the words were competing with the ride summary beside them.
            <button type="button" onClick={onBackToForm} disabled={busy} aria-label={t(locale, "backToForm")} title={t(locale, "backToForm")} className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 hover:text-stone-900 disabled:opacity-40"><ArrowLeft className="size-4" /></button>
          )}
        </div>
        {plan && <p className="mt-2 hidden line-clamp-2 text-[11px] leading-relaxed text-stone-500 md:block">{planSummary(plan, locale)}</p>}
      </div>

      <div ref={logRef} className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 md:space-y-5 md:px-5 md:py-5" role="log" aria-label={t(locale, "a11yChatMessages")} aria-live="polite">
        {messages.length === 0 && (
          <div className="py-5 text-sm leading-7 text-stone-600">
            <p>{t(locale, "chatSayAll")}</p>
            <p className="mt-3 border-l-2 border-[#f56300] pl-4 text-stone-500">{t(locale, "chatExample")}</p>
          </div>
        )}
        {messages.map((message, index) => (
          <div key={index} ref={index === messages.length - 1 ? lastRef : undefined} className={message.role === "user" ? "ml-5 rounded-2xl rounded-br-sm bg-stone-900 px-4 py-3 text-white" : "mr-2 text-stone-700"}>
            <div className={`mb-1 text-[10px] font-semibold uppercase tracking-widest ${message.role === "user" ? "text-stone-400" : "text-[#bd4b00]"}`}>{message.role === "user" ? t(locale, "chatYou") : "Mopik"}</div>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          </div>
        ))}
        {!busy && quickReplies.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label={t(locale, "chatQuickReplies")}>
            {quickReplies.map((reply) => <button key={reply.label} type="button" onClick={() => { track("quick_reply_used", { label: reply.label, action: reply.action ?? "message" }); if (reply.action) onAction?.(reply.action); else send(reply.message); }} className="rounded-full border border-[#f56300] bg-white px-3.5 py-2 text-xs font-medium text-[#bd4b00] transition hover:bg-[#fff4ec]">{reply.label}</button>)}
          </div>
        )}
        {busy && <RouteLoader phase={phase === "thinking" ? "thinking" : lucky ? "lucky" : "routing"} onCancel={onCancel} />}
        <div ref={endRef} />
      </div>

      <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-t border-stone-200 bg-white p-3">
        <label htmlFor="ride-message" className="sr-only">{t(locale, "chatMessageLabel")}</label>
        <div className="flex items-end gap-2 rounded-xl border border-stone-200 p-2 focus-within:border-[#f56300]">
          <textarea id="ride-message" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={6000} disabled={busy}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
            placeholder={hasRoute ? t(locale, "chatPlaceholder") : messages.length ? "Papildini ieceri…" : "Apraksti savu braucienu…"}
            className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-stone-400 disabled:opacity-60 md:text-sm" />
          <button type="submit" disabled={busy || !text.trim()} aria-label={t(locale, "chatSend")} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35"><ArrowUp className="size-5" /></button>
        </div>
        <p className="mt-2 hidden px-1 text-[10px] text-stone-400 md:block">{t(locale, "chatEnterHint")}</p>
      </form>
    </section>
  );
}
