"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * "Atsauksme": a rider's note straight to the maker. Posts to /api/feedback,
 * which e-mails it; if the server has no mail provider configured, the
 * rider's mail app opens with the same text instead, so nothing is lost.
 */
export function FeedbackDialog({ open, onClose, context }: { open: boolean; onClose: () => void; context?: string }) {
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;

  const submit = async () => {
    if (text.trim().length < 3 || state === "sending") return;
    setState("sending"); setError(null);
    try {
      const res = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text.trim(), email: email.trim() || undefined, context, page: window.location.href }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok) { track("feedback_sent", { with_email: Boolean(email.trim()), length: text.trim().length }); setState("sent"); setText(""); return; }
      if (data.mailto) { window.location.href = data.mailto; setState("sent"); return; }
      throw new Error(data.error || "Neizdevās nosūtīt.");
    } catch (e) {
      setState("error"); setError(e instanceof Error ? e.message : "Neizdevās nosūtīt.");
    }
  };

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={onClose} className="mopik-fade-in fixed inset-0 z-50 flex items-end justify-center bg-stone-900/60 p-3 backdrop-blur-sm md:items-center">
      <div onClick={(e) => e.stopPropagation()} className="relative w-full max-w-md rounded-3xl border border-stone-200 bg-white p-5 shadow-2xl">
        <button type="button" onClick={onClose} aria-label="Aizvērt" className="absolute right-3 top-3 flex size-9 items-center justify-center rounded-full text-stone-400 transition hover:bg-stone-100 hover:text-stone-700"><X className="size-4" /></button>
        <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#bd4b00]">Atsauksme</div>
        <h2 id="feedback-title" className="mt-1 text-lg font-semibold tracking-tight">Kas nestrādā, ko gribētu citādi?</h2>
        {state === "sent" ? (
          <p className="mt-4 rounded-xl bg-[#fff3ea] px-4 py-3 text-sm text-[#8a3a00]">Paldies! Ziņa ir ceļā pie Riharda.</p>
        ) : (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} placeholder="Piemēram: Siguldas apkārtnē maršruts veda pa privātu ceļu…"
              className="mt-3 w-full resize-none rounded-xl border border-stone-200 px-3 py-2.5 text-base outline-none placeholder:text-stone-400 focus:border-[#f56300] md:text-sm" />
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Tavs e-pasts, ja gribi atbildi (nav obligāti)" inputMode="email" autoComplete="email"
              className="mt-2 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-base outline-none placeholder:text-stone-400 focus:border-[#f56300] md:text-sm" />
            {context && <p className="mt-2 truncate text-[11px] text-stone-400" title={context}>Pievienots: {context}</p>}
            {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
            <button type="button" onClick={submit} disabled={state === "sending" || text.trim().length < 3}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-full bg-stone-900 text-sm font-semibold text-white transition hover:bg-[#f56300] disabled:opacity-40">
              {state === "sending" ? "Sūtu…" : "Nosūtīt"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
