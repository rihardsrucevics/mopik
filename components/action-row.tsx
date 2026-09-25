"use client";

import { ChevronDown, ChevronUp, Share2, Bookmark, Pencil } from "lucide-react";
import { useId, type ReactNode } from "react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";

/**
 * The secondary actions under Lejupielādēt GPX: keep it, send it on, and —
 * on the planner's result — correct it on the map. One component because the
 * result panel and the shared-route page must look identical here; the rider
 * asked for exactly that, and two copies of the same grid drifted apart the
 * moment one of them was touched.
 *
 * It owns no state: saving and sharing live where the route does (a generated
 * route encodes its share code on demand, a shared one already has one), so
 * the parent passes the flags and the handlers.
 *
 * "Labot" appears only where the ride can be corrected — the planner's
 * result. The shared page has no router of its own and passes none: a button
 * there would have nothing to do.
 *
 * "Detaļas" used to be the last pill. Four pills did not fit a 375 px row in
 * every language ("Üksikasjad", "Salvestatud"), so the rider moved it out: it
 * is `DetailsToggle`, a disclosure line under the numbers it expands on. The
 * icons give way below 360 px so "Salvestatud" and "Nukopijuota" still fit a
 * third of a 320 px card without wrapping or an ellipsis.
 */
export function RouteActionRow({ saved, onToggleSave, onShare, copied, onEdit }: {
  saved: boolean;
  onToggleSave: () => void;
  onShare: () => void;
  copied: boolean;
  onEdit?: () => void;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const pill = "flex h-10 min-w-0 items-center justify-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-xs";
  const icon = "size-3.5 shrink-0 max-[359px]:hidden";
  return (
    <div className={`mt-2 grid gap-2 ${onEdit ? "grid-cols-3" : "grid-cols-2"}`}>
      <button type="button" onClick={onToggleSave} aria-label={saved ? m.resUnsave : m.resSaveLater} aria-pressed={saved}
        className={`${pill} font-medium transition ${saved ? "border-[#f56300] bg-[#fff3ea] text-[#bd4b00]" : "border-stone-200 text-stone-700 hover:bg-stone-50"}`}>
        <Bookmark className={`${icon} ${saved ? "fill-current" : ""}`} />{saved ? m.resSaved : m.resSave}
      </button>
      <button type="button" onClick={onShare} aria-label={m.resShareRoute} className={`${pill} border-stone-200 font-medium text-stone-700 hover:bg-stone-50`}>
        <Share2 className={icon} />{copied ? m.resCopied : m.resShare}
      </button>
      {onEdit && (
        <button type="button" onClick={onEdit} aria-label={m.resEditAria} title={m.resEditAria}
          className={`${pill} border-[#f56300]/50 font-semibold text-[#bd4b00] hover:bg-[#fff3ea]`}>
          <Pencil className={icon} />{m.resEdit}
        </button>
      )}
    </div>
  );
}

/**
 * "Detaļas ⌄": the road, surface and risk breakdown, as a collapsible row of
 * its own under the action row — the same bordered, full-width shape as
 * "Apskates vietas · N ⌄" right below it, which is what the rider asked for:
 * numbers → GPX → the three pills → Detaļas → Apskates vietas. It left the
 * action row because four pills did not fit 375 px in every language.
 */
export function DetailsCard({ open, onToggle, children, className = "" }: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const id = useId();
  return (
    <div className={`rounded-xl border border-stone-200 ${className}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id}
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left">
        <span className="text-xs font-semibold text-stone-700">{m.resDetails}</span>
        {open ? <ChevronUp className="size-3.5 shrink-0 text-stone-500" /> : <ChevronDown className="size-3.5 shrink-0 text-stone-500" />}
      </button>
      {open && <div id={id} className="space-y-3 border-t border-stone-200 p-3">{children}</div>}
    </div>
  );
}
