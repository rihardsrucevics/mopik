"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { OBJECT_COLOR, type ObjectMark } from "@/lib/map/edit-guidance";
import { CircleDot, CirclePlus, MapPinned, MapPinPlus, Move, Route, Trash2, X, type LucideIcon } from "lucide-react";

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
/**
 * `pass`: „Padarīt caurbraucamu” — a stop made a pass-through point (Phase 1).
 * `via` / `addPass`: the line sheet's „Virzīt caur citu vietu” and
 * „Pievienot punktu šeit” (lib/map/line-sheet.ts).
 */
export type MapPointSheetIcon = "move" | "stop" | "remove" | "pass" | "via" | "addPass";

export type MapPointSheetRow = {
  key: string;
  label: string;
  icon: MapPointSheetIcon;
  onPress: (() => void) | null;
  /** Why a row is disabled (its tooltip), or its longer name. */
  title?: string;
  tone?: "danger";
  /** What pressing it will do, on a line under the label (lib/map/edit-guidance.ts). */
  detail?: string;
};

export type MapPointSheetModel =
  | {
      mode: "menu";
      /** A point's sheet, or the line's (a tapped stretch in edit mode). Absent: a point. */
      kind?: "point" | "line";
      /** Which point: „Pietura 3”, „Starts”, „Maršruta punkts”. */
      title: string;
      /** The place's own name, where it has one. */
      name?: string;
      /** The object's mark and colour, as on the map: a numbered disc, a white dot, a pin, a line swatch. */
      mark?: ObjectMark;
      /** What this object is, on a line under the title. */
      explainer?: string;
      /**
       * The notice area's guidance line („Pietura 2 izvēlēta – izvēlies
       * darbību.”). A phone's bottom sheet covers the notice area, so there
       * the sheet says it itself, above its header.
       */
      guide?: string;
      groups: { key: string; rows: MapPointSheetRow[] }[];
      /**
       * add-kind (B3, rider 2026-09-29): one segmented „Pietura |
       * Caurbraucams” control instead of two rows. `onSwitch` switches to
       * the other kind (null: off, `reason` says why).
       */
      kindSwitch?: { label: string; options: { key: string; label: string; selected: boolean }[]; onSwitch: (() => void) | null; reason?: string };
      closeLabel: string;
      cancelLabel: string;
      onClose: () => void;
    }
  | {
      mode: "move";
      hint: string;
      /** The colour of the object being moved (its mark on the map). */
      color?: string;
      closeLabel: string;
      onClose: () => void;
    };

const ICONS: Record<MapPointSheetIcon, LucideIcon> = { move: Move, stop: MapPinPlus, remove: Trash2, pass: CircleDot, via: Route, addPass: CirclePlus };

const PHONE = "(max-width: 767px)";

/** The object's mark in the header — drawn as the map draws it (route-map.tsx). */
function Mark({ mark }: { mark: ObjectMark }) {
  if (mark.kind === "stop") {
    return (
      <span aria-hidden="true" data-sheet-mark="stop" className="flex size-6 shrink-0 items-center justify-center rounded-full border-2 border-white text-[11px] font-bold leading-none text-white shadow-[0_1px_3px_rgba(0,0,0,0.32)]" style={{ background: OBJECT_COLOR.stop }}>
        {mark.number}
      </span>
    );
  }
  if (mark.kind === "pass") {
    return <span aria-hidden="true" data-sheet-mark="pass" className="block size-3.5 shrink-0 rounded-full border-[2.5px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.35)]" style={{ borderColor: OBJECT_COLOR.pass }} />;
  }
  if (mark.kind === "line") {
    return (
      <span aria-hidden="true" data-sheet-mark="line" className="flex h-3.5 w-8 shrink-0 items-center rounded-full px-0.5" style={{ background: "rgba(250,204,21,0.55)" }}>
        <span className="block h-1.5 w-full rounded-full" style={{ background: mark.color }} />
      </span>
    );
  }
  const color = mark.kind === "start" ? OBJECT_COLOR.start : OBJECT_COLOR.finish;
  return (
    <svg aria-hidden="true" data-sheet-mark={mark.kind} viewBox="0 0 24 32" className="h-6 w-[18px] shrink-0">
      <path d="M12 0C5.4 0 0 5.3 0 11.9 0 20.8 12 32 12 32s12-11.2 12-20.1C24 5.3 18.6 0 12 0z" fill={color} />
      <circle cx="12" cy="12" r="4.5" fill="#fff" />
    </svg>
  );
}
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
      <div data-point-sheet="move" className="flex items-center gap-2 self-start rounded-full border-2 bg-white/95 py-1 pl-3 pr-1 shadow-md backdrop-blur max-md:mr-16" style={{ borderColor: sheet.color ?? "#f56300" }}>
        <MapPinned aria-hidden="true" className="size-4 shrink-0" style={{ color: sheet.color ?? "#bd4b00" }} />
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
    <div role="dialog" aria-label={sheet.name ? `${sheet.title} · ${sheet.name}` : sheet.title} data-point-sheet="menu" data-sheet-kind={sheet.kind ?? "point"}
      className={phone
        ? "fixed inset-x-0 bottom-0 z-50 touch-none rounded-t-3xl border-t border-stone-200 bg-stone-100 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(0,0,0,0.18)]"
        : "w-full max-w-xs rounded-2xl border border-stone-200 bg-stone-100 p-3 shadow-lg"}>
      {phone && <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-stone-300" />}
      {phone && sheet.guide && <p role="status" data-edit-guide="sheet" className="mb-2 text-xs font-medium leading-snug text-stone-600">{sheet.guide}</p>}
      <div className={`flex items-center gap-2 ${sheet.explainer ? "mb-0.5" : "mb-3"}`}>
        {sheet.mark && <Mark mark={sheet.mark} />}
        <div className="min-w-0 flex-1 truncate text-base font-semibold text-stone-900">
          {sheet.title}
          {sheet.name && <span className="font-normal text-stone-600">{nameAfter}</span>}
        </div>
        <button type="button" onClick={sheet.onClose} aria-label={sheet.closeLabel} title={sheet.closeLabel}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-stone-200 text-stone-700 transition-colors hover:bg-stone-300">
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
      {sheet.explainer && <p data-sheet-explainer className="mb-3 pr-11 text-[13px] leading-snug text-stone-600">{sheet.explainer}</p>}
      <div className="space-y-3">
        {/* ── add-kind ── the point's kind, switched with one tap on the other segment. */}
        {sheet.kindSwitch && (
          <div data-kind-switch className="rounded-2xl bg-white p-1">
            <div role="radiogroup" aria-label={sheet.kindSwitch.label} className="grid grid-cols-2 gap-1">
              {sheet.kindSwitch.options.map((o) => (
                <button key={o.key} type="button" role="radio" aria-checked={o.selected} data-kind={o.key}
                  onClick={o.selected ? undefined : sheet.kindSwitch!.onSwitch ?? undefined}
                  disabled={!o.selected && !sheet.kindSwitch!.onSwitch}
                  title={!o.selected ? sheet.kindSwitch!.reason : undefined}
                  className={`h-10 min-w-0 truncate rounded-xl px-2 text-[14px] font-semibold transition-colors disabled:opacity-45 ${o.selected ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100"}`}>
                  {o.label}
                </button>
              ))}
            </div>
            {sheet.kindSwitch.reason && <p data-kind-reason className="px-2 pb-1 pt-1 text-xs leading-snug text-stone-500">{sheet.kindSwitch.reason}</p>}
          </div>
        )}
        {sheet.groups.map((group) => (
          <div key={group.key} className="overflow-hidden rounded-2xl bg-white">
            {group.rows.map((row, i) => {
              const Icon = ICONS[row.icon];
              return (
                <button key={row.key} type="button" onClick={row.onPress ?? undefined} disabled={!row.onPress} title={row.title}
                  className={`flex min-h-12 w-full items-center gap-3 px-4 text-left text-[15px] font-medium transition-colors hover:bg-stone-50 disabled:opacity-45 ${row.detail ? "py-1.5" : ""} ${i > 0 ? "border-t border-stone-100" : ""} ${row.tone === "danger" ? "text-red-600" : "text-stone-900"}`}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{row.label}</span>
                    {row.detail && <span data-row-detail className="block text-xs font-normal leading-snug text-stone-500">{row.detail}</span>}
                  </span>
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
