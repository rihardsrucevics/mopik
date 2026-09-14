"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { Smartphone, X } from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * m.installTitle — Android Chrome only, where the browser lets a
 * page trigger the real install dialog (`beforeinstallprompt`). iOS has no
 * such API, so nothing is shown there. Appears only once a rider has a route
 * (the moment the app has proven useful), and stays dismissed for 30 days.
 */
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
const DISMISS_KEY = "mopik.install.dismissed";

export function InstallPrompt({ show }: { show: boolean }) {
  const [locale] = useLocale();
  const m = messages(locale);
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!/Android/i.test(navigator.userAgent)) return;
    try { if (Number(localStorage.getItem(DISMISS_KEY) ?? 0) > Date.now()) return; } catch { /* fine */ }
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); setHidden(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  useEffect(() => { if (show && event && !hidden) track("install_prompt_shown"); }, [show, event, hidden]);

  if (!show || !event || hidden) return null;

  const dismiss = () => {
    setHidden(true);
    try { localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 24 * 3600 * 1000)); } catch { /* fine */ }
  };
  const install = async () => {
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      track(outcome === "accepted" ? "install_accepted" : "install_dismissed");
    } catch { /* the browser declined to show it */ }
    dismiss();
  };

  return (
    <div className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5 md:hidden">
      <Smartphone className="size-5 shrink-0 text-[#f56300]" />
      <div className="min-w-0 flex-1 text-xs text-stone-700">{m.installBody}</div>
      <button type="button" onClick={install} className="shrink-0 rounded-full bg-stone-900 px-3 py-1.5 text-xs font-semibold text-white">{m.installAdd}</button>
      <button type="button" onClick={dismiss} aria-label={m.close} className="shrink-0 text-stone-400"><X className="size-4" /></button>
    </div>
  );
}
