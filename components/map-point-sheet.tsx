"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { MapPinned, MapPinPlus, Move, Trash2, X, type LucideIcon } from "lucide-react";

/**
 * What the map shows for the point the rider tapped (rider, 2026-09-25: act
 * on a stop or a shaping point right there, not in the list; the layout after
 * OsmAnd's point sheet).
 *
 * `menu`: a header naming the point („Pietura 3 · Lambertu iela”, „Maršruta
 * punkts”) with ✕, then groups of full-width rows — a label, an icon on the
 * right — in rounded cards, the destructive „Izņemt” last and red, and a
 * plain Cancel at the bottom. A bottom sheet on a phone, a compact popover in
 * the map's header column on the desktop. Only actions that work are listed;
 * the groups are there so later rows (segment actions, a stop ↔ pass-through
 * switch — backlog 34/35) slot in without a new layout.
 *
 * `move`: after „Pārvietot” the sheet gives way to one line above the bottom
 * bar — „Izvēlies jaunu vietu kartē” with its ✕ — so the map is free to tap.
 *
 * Built by the composer from its selection (lib/map/point-selection.ts).
 */
export type MapPointSheetIcon = "move" | "stop" | "remove";

export type MapPointSheetRow = {
  key: string;
  label: string;
  icon: MapPointSheetIcon;
  onPress: (() => void) | null;
  /** Why a row is disabled (its tooltip), or its longer name. */
  title?: string;
  tone?: "danger";
};

export type MapPointSheetModel =
  | {
      mode: "menu";
      /** Which point: „Pietura 3”, „Starts”, „Maršruta punkts”. */
      title: string;
      /** The place's own name, where it has one. */
      name?: string;
      groups: { key: string; rows: MapPointSheetRow[] }[];
      closeLabel: string;
      cancelLabel: string;
      onClose: () => void;
    }
  | {
      mode: "move";
      hint: string;
      closeLabel: string;
      onClose: () => void;
    };

const ICONS: Record<MapPointSheetIcon, LucideIcon> = { move: Move, stop: MapPinPlus, remove: Trash2 };

const PHONE = "(max-width: 767px)";
/** Between the point's title and its name — punctuation, not words. */
const NAME_SEPARATOR = " · ";

export function MapPointSheet({ sheet }: { sheet: MapPointSheetModel }) {
  // On a phone the menu is a bottom sheet over the page, so it goes to <body>:
  // inside the map it would be clipped by the map's rounded frame. Being out
  // of the full-screen layer, it carries its own `touch-none` — a pinch or a
  // double-tap on it must not zoom the page (lib/map/page-zoom).
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const on = () => setPhone(query.matches);
    query.addEventListener("change", on);
    return () => query.removeEventListener("change", on);
  }, []);

  if (sheet.mode === "move") {
    return (
      <div data-point-sheet="move" className="flex items-center gap-2 self-start rounded-full border-2 border-[#f56300] bg-white/95 py-1 pl-3 pr-1 shadow-md backdrop-blur max-md:mr-16">
        <MapPinned aria-hidden="true" className="size-4 shrink-0 text-[#bd4b00]" />
        {/* On a phone the hint keeps clear of the right-hand column (✓ ↶ ✕/+),
            wrapping rather than running under it. */}
        <span role="status" className="whitespace-nowrap text-[13px] font-semibold leading-tight text-[#bd4b00] max-md:whitespace-normal">{sheet.hint}</span>
        <button type="button" onClick={sheet.onClose} aria-label={sheet.closeLabel} title={sheet.closeLabel}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-stone-700 transition-colors hover:bg-stone-100">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    );
  }

  const nameAfter = sheet.name ? NAME_SEPARATOR + sheet.name : "";
  const menu = (
    <div role="dialog" aria-label={sheet.name ? `${sheet.title} · ${sheet.name}` : sheet.title} data-point-sheet="menu"
      className={phone
        ? "fixed inset-x-0 bottom-0 z-50 touch-none rounded-t-3xl border-t border-stone-200 bg-stone-100 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
        : "w-full max-w-xs rounded-2xl border border-stone-200 bg-stone-100 p-3 shadow-lg"}>
      {phone && <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-300" />}
      <div className="mb-3 flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-stone-900">
          {sheet.title}
          {sheet.name && <span className="font-normal text-stone-600">{nameAfter}</span>}
        </div>
        <button type="button" onClick={sheet.onClose} aria-label={sheet.closeLabel} title={sheet.closeLabel}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-700 transition-colors hover:bg-stone-300">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      <div className="space-y-3">
        {sheet.groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-2xl bg-white">
            {group.rows.map((row, i) => {
              const Icon = ICONS[row.icon];
              return (
                <button key={row.key} type="button" onClick={row.onPress ?? undefined} disabled={!row.onPress} title={row.title}
                  className={`flex h-12 w-full items-center gap-3 px-4 text-left text-[15px] font-medium transition-colors hover:bg-stone-50 disabled:opacity-45 ${i > 0 ? "border-t border-stone-100" : ""} ${row.tone === "danger" ? "text-red-600" : "text-stone-900"}`}>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  <Icon aria-hidden="true" className={`size-5 shrink-0 ${row.tone === "danger" ? "text-red-600" : "text-[#bd4b00]"}`} />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <button type="button" onClick={sheet.onClose}
        className="mt-3 h-12 w-full rounded-2xl bg-stone-200 text-[15px] font-semibold text-stone-800 transition-colors hover:bg-stone-300">
        {sheet.cancelLabel}
      </button>
    </div>
  );
  return phone ? createPortal(menu, document.body) : menu;
}
