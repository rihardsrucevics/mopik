"use client";

import { useState } from "react";
import type { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locale";
import { osmNodeUrl, type GateOnRide } from "@/lib/map/gates-along";

type Messages = ReturnType<typeof messages>;

/**
 * The gate card: what one gate on the ride is, in OSM's own words.
 *
 * The rider asked for gates to be precise — the 🚪 on the map already stood on
 * the gate itself, but tapping it opened the whole stretch's card, which could
 * only say "this stretch has a gate". This card is about that one node:
 *
 *   - its kind, from `barrier=*` („Vārti”, „Barjera ar pacēlāju”, „Ķēde” …);
 *   - its `access=*`, only where OSM tags one, in plain words;
 *   - how far along the ride it stands („37,2 km no starta”);
 *   - a link to the node on openstreetmap.org, only where the id is known.
 *
 * No guessing: a line is shown only for a fact OSM states. A gate from a saved
 * ride that predates this card has no `info` and shows its position alone.
 */
export const GATE_GLYPH = "🚪";

/** A position along the ride: always one decimal, „37,2”, in the UI locale. */
export const gateKm = (locale: UiLocale, meters: number): string =>
  (Math.round(meters / 100) / 10).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** `barrier=*` in words. An unknown value (or none) is the generic „Vārti uz ceļa”. */
export function gateKindLabel(m: Messages, barrier: string | undefined): string {
  switch (barrier) {
    case "gate": return m.gateKindGate;
    case "lift_gate": return m.gateKindLiftGate;
    case "swing_gate": return m.gateKindSwingGate;
    case "chain": return m.gateKindChain;
    case "bollard": return m.gateKindBollard;
    case "cattle_grid": return m.gateKindCattleGrid;
    default: return m.resGatesRow;
  }
}

/** `access=*` in plain words; any other value is shown verbatim, never interpreted. */
export function gateAccessLabel(m: Messages, access: string | undefined): string | null {
  if (!access) return null;
  switch (access) {
    case "private": return m.gateAccessPrivate;
    case "no": return m.gateAccessNo;
    case "permissive": return m.gateAccessPermissive;
    case "destination": return m.gateAccessDestination;
    case "customers": return m.gateAccessCustomers;
    case "permit": return m.gateAccessPermit;
    case "yes": return m.gateAccessYes;
    case "forestry": return m.gateAccessForestry;
    case "agricultural": return m.gateAccessAgricultural;
    case "military": return m.gateAccessMilitary;
    case "delivery": return m.gateAccessDelivery;
    case "residents": return m.gateAccessResidents;
    default: return fi(m.gateAccessRaw, { value: access });
  }
}

/** „Vārti 37,2 km” — one gate as a list row names it. */
export const gateAtLabel = (m: Messages, locale: UiLocale, gate: GateOnRide): string =>
  fi(m.gateAtKm, { name: gateKindLabel(m, gate.info?.barrier), km: gateKm(locale, gate.alongMeters) });

const esc = (value: string): string =>
  value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");

/**
 * The card as an HTML string, because the map's popups take `setHTML` (the
 * segment card is built the same way, for the same reason).
 */
export function gateCardHtml(m: Messages, locale: UiLocale, gate: GateOnRide): string {
  const access = gateAccessLabel(m, gate.info?.access);
  const id = gate.info?.id;
  return (
    `<div data-gate-card style="font-size:13px;line-height:1.4;min-width:150px;display:flex;flex-direction:column;gap:4px">` +
    `<strong style="display:flex;align-items:center;gap:6px;padding-right:24px;font-size:15px;font-weight:600">` +
    `<span aria-hidden="true" style="display:inline-flex;width:18px;justify-content:center;font-size:15px;line-height:1">${GATE_GLYPH}</span>` +
    `<span>${esc(gateKindLabel(m, gate.info?.barrier))}</span></strong>` +
    `<div style="color:#6b7280">${esc(fi(m.gateFromStart, { km: gateKm(locale, gate.alongMeters) }))}</div>` +
    (access ? `<div>${esc(access)}</div>` : "") +
    (id
      ? `<a href="${esc(osmNodeUrl(id))}" target="_blank" rel="noopener noreferrer" ` +
        `style="color:#2563eb;text-decoration:underline;width:fit-content">${esc(m.gateOsmLink)}</a>`
      : "") +
    `</div>`
  );
}

/** How many gates RISKI lists before it folds the rest behind „vēl N”. */
const GATE_LIST_SHOWN = 6;

/**
 * The gates in RISKI, each with its kilometre: „Vārti 37,2 km”.
 *
 * Under the count row, which stays the figure the rider acts on. A forest ride
 * can meet dozens, so the list shows the first few and folds the rest.
 */
export function GateRiskList({ gates, m, locale }: { gates: GateOnRide[]; m: Messages; locale: UiLocale }) {
  const [all, setAll] = useState(false);
  if (!gates.length) return null;
  const shown = all ? gates : gates.slice(0, GATE_LIST_SHOWN);
  const rest = gates.length - shown.length;
  return (
    <ul className="mb-0.5 ml-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] leading-snug text-stone-500">
      {shown.map((g, i) => (
        <li key={`${g.point[0]},${g.point[1]},${i}`} className="flex items-center gap-1 tabular-nums">
          <span aria-hidden="true" className="text-[11px] leading-none">{GATE_GLYPH}</span>
          {gateAtLabel(m, locale, g)}
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button type="button" className="text-stone-600 underline" onClick={() => setAll(true)}>
            {fi(m.gateListMore, { n: rest })}
          </button>
        </li>
      )}
    </ul>
  );
}
