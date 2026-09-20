"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { t } from "@/lib/i18n/messages";
import Link from "next/link";
import { ArrowLeft, ArrowUp, X } from "lucide-react";
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
   * (a shared or saved ride opened for correction). Until a new route is
   * generated there is nothing to go back to in this tab, so the way out is
   * the ride itself rather than an empty form.
   */
  originCode?: string | null;
  /**
   * A chip handled on the client rather than sent to the chat.
   *
   * The **whole reply** is passed, not just its `action`. `remove-stop` and
   * `move-stop` carry the place they act on in `reply.stop` — the name, the
   * index, the role and the road the router found — and a callback taking
   * only the action string dropped all of it on the floor, leaving the page
   * to guess which stop the rider meant. Passing the reply also means a chip
   * that grows a new field cannot silently lose it here.
   */
  onAction?: (reply: ChatQuickReply & { action: NonNullable<ChatQuickReply["action"]> }) => void;
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
    // On a phone the panel is as tall as what it holds, up to a ceiling — a
    // `max-h`, never an `h`. It used to be a fixed `h-[calc(100dvh-7.5rem)]`
    // whenever there was no route yet, which is exactly the first generation
    // from the form: the panel claimed a whole screen for a transcript of one
    // bubble and a loader, so the bottom row (the "Atcelt" of a generation in
    // flight) sat a full screen below the last thing on screen. Measured at
    // 375x812 with the 26dvh map stacked above: the row's top landed 204 px
    // past the fold and the rider had to scroll to call a generation off.
    //
    // The ceiling subtracts what is above the panel on a phone. `74dvh` is the
    // viewport minus the 26dvh map strip that is on screen while a generation
    // runs, and the 7.5rem covers the header, the page padding and the grid
    // gap (~93 px + 20 px measured at 375x812, which leaves the pinned row
    // 7 px inside the fold). It is written as a share of the viewport rather
    // than a fixed rem so it holds on a shorter phone too: the map above is
    // itself a share, so a constant would only ever be right at one height.
    //
    // Short transcripts now end where their content ends and the row follows
    // the last message with the row's own padding; long ones hit the ceiling
    // and the log scrolls inside the panel with the row pinned, which is what
    // `min-h-0 flex-1` on the log already does. Desktop keeps its fixed
    // column height.
    <section className={`flex flex-col overflow-hidden rounded-2xl border border-stone-200 bg-[#faf9f6] md:h-[calc(100vh-7rem)] md:max-h-none ${hasRoute ? "max-h-[max(360px,calc(74dvh-8.5rem))]" : "max-h-[calc(74dvh-7.5rem)]"}`} aria-label={t(locale, "a11yChatRegion")}>
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
            {quickReplies.map((reply) => <button key={reply.label} type="button" onClick={() => { track("quick_reply_used", { label: reply.label, action: reply.action ?? "message" }); if (reply.action) onAction?.({ ...reply, action: reply.action }); else send(reply.message); }} className="rounded-full border border-[#f56300] bg-white px-3.5 py-2 text-xs font-medium text-[#bd4b00] transition hover:bg-[#fff4ec]">{reply.label}</button>)}
          </div>
        )}
        {/* No `onCancel` here on purpose: while a generation runs the cancel
            lives in the bottom slot, where the input usually is. Exactly one
            Atcelt exists at a time. */}
        {busy && <RouteLoader phase={phase === "thinking" ? "thinking" : lucky ? "lucky" : "routing"} />}
        <div ref={endRef} />
      </div>

      {/* The bottom slot is the thumb's place. While a generation runs nothing
          typed there can be acted on, so the input and its hint give way to
          "Atcelt" — same handler, same outline style it had in the loader,
          just where the thumb already rests. Both states share this row's
          padding, so whatever the input row respects at the bottom of a phone
          the cancel respects too. */}
      {busy && onCancel ? (
        <div className="border-t border-stone-200 bg-white p-3">
          <button type="button" onClick={onCancel}
            className="flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-stone-200 bg-white text-sm font-medium text-stone-600 transition hover:border-stone-300 hover:text-stone-900 active:bg-stone-50">
            <X className="size-4" />
            {t(locale, "cancel")}
          </button>
        </div>
      ) : (
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-t border-stone-200 bg-white p-3">
          <label htmlFor="ride-message" className="sr-only">{t(locale, "chatMessageLabel")}</label>
          <div className="flex items-end gap-2 rounded-xl border border-stone-200 p-2 focus-within:border-[#f56300]">
            <textarea id="ride-message" value={text} onChange={(event) => setText(event.target.value)} rows={2} maxLength={6000} disabled={busy}
              onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}
              placeholder={hasRoute ? t(locale, "chatPlaceholder") : messages.length ? t(locale, "chatPlaceholderRefine") : t(locale, "chatPlaceholderDescribe")}
              className="min-w-0 flex-1 resize-none bg-transparent px-2 py-1 text-base outline-none placeholder:text-stone-400 disabled:opacity-60 md:text-sm" />
            <button type="submit" disabled={busy || !text.trim()} aria-label={t(locale, "chatSend")} className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-[#f56300] text-white transition hover:bg-[#d85600] disabled:opacity-35"><ArrowUp className="size-5" /></button>
          </div>
          <p className="mt-2 hidden px-1 text-[10px] text-stone-400 md:block">{t(locale, "chatEnterHint")}</p>
        </form>
      )}
    </section>
  );
}
