"use client";

import { ChevronDown, ChevronUp, Share2, Bookmark } from "lucide-react";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";

/**
 * The three secondary actions under Lejupielādēt GPX: keep it, send it on,
 * look closer. One component because the result panel and the shared-route
 * page must look identical here — the rider asked for exactly that, and two
 * copies of the same grid drifted apart the moment one of them was touched.
 *
 * It owns no state: saving and sharing live where the route does (a generated
 * route encodes its share code on demand, a shared one already has one), so
 * the parent passes the flags and the handlers.
 */
export function RouteActionRow({ saved, onToggleSave, onShare, copied, details, onToggleDetails }: {
  saved: boolean;
  onToggleSave: () => void;
  onShare: () => void;
  copied: boolean;
  details: boolean;
  onToggleDetails: () => void;
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      <button type="button" onClick={onToggleSave} aria-label={saved ? m.resUnsave : m.resSaveLater} aria-pressed={saved}
        className={`flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border text-xs font-medium transition ${saved ? "border-[#f56300] bg-[#fff3ea] text-[#bd4b00]" : "border-stone-200 text-stone-700 hover:bg-stone-50"}`}>
        <Bookmark className={`size-3.5 ${saved ? "fill-current" : ""}`} />{saved ? m.resSaved : m.resSave}
      </button>
      <button type="button" onClick={onShare} aria-label={m.resShareRoute} className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50">
        <Share2 className="size-3.5" />{copied ? m.resCopied : m.resShare}
      </button>
      <button type="button" onClick={onToggleDetails} aria-expanded={details} className="flex h-10 min-w-0 items-center justify-center gap-1 rounded-full border border-stone-200 text-xs font-medium text-stone-700 hover:bg-stone-50">
        {m.resDetails}{details ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
      </button>
    </div>
  );
}
