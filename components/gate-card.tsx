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
 * The rider asked for gates to be precise — the marker on the map already stood
 * on the gate itself, but tapping it opened the whole stretch's card, which could
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

/**
 * The gate glyphs — our own two small drawings, chosen by `barrier=*`.
 *
 * The rider replaced the 🚪 (option D): a door said "gate" but not which kind,
 * and the kind is exactly what the card is now about. Two shapes, because two
 * are what a rider tells apart at a glance on a forest track:
 *
 *   - **boom** (šlagbaums) — a dark post with a red-and-white arm, slightly
 *     raised: `lift_gate`, and `chain`, which is strung across the same way;
 *   - **field** — two dark posts, three rails and a diagonal brace: `gate`,
 *     `swing_gate`, every other barrier kind, and a gate whose kind is not
 *     known (a saved ride from before the card).
 *
 * Drawn on a 14-unit grid for the 13–14 px they are shown at, rails and posts
 * on whole or half units so they stay crisp; the white parts of the arm get a
 * dark outline, or they would vanish into the white pill. Inline SVG strings,
 * no assets: the map's markers and popups are DOM strings, and the React
 * surfaces (RISKI) insert the same string, so there is one drawing each.
 */
export type GateGlyph = "boom" | "field";

export const gateGlyphFor = (barrier: string | undefined): GateGlyph =>
  barrier === "lift_gate" || barrier === "chain" ? "boom" : "field";

const GLYPH_BODY: Record<GateGlyph, string> = {
  boom:
    // post and its foot
    `<rect x="1.5" y="3" width="2.5" height="9.5" rx="0.5" fill="#1f2937"/>` +
    `<rect x="0.5" y="12" width="4.5" height="1.5" rx="0.5" fill="#1f2937"/>` +
    // the arm, raised a little: outline, red, then white bands
    `<line x1="3.5" y1="6.2" x2="13.2" y2="3.4" stroke="#1f2937" stroke-width="3.2" stroke-linecap="round"/>` +
    `<line x1="3.5" y1="6.2" x2="13.2" y2="3.4" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>` +
    `<line x1="3.5" y1="6.2" x2="13.2" y2="3.4" stroke="#ffffff" stroke-width="2" stroke-dasharray="2 2" stroke-dashoffset="-2"/>` +
    `<circle cx="2.75" cy="6.4" r="1.1" fill="#dc2626"/>`,
  field:
    // two posts
    `<rect x="0.5" y="1.5" width="2" height="11.5" rx="0.4" fill="#1f2937"/>` +
    `<rect x="11.5" y="1.5" width="2" height="11.5" rx="0.4" fill="#1f2937"/>` +
    // three rails and the brace
    `<rect x="2.5" y="3" width="9" height="1.5" fill="#1f2937"/>` +
    `<rect x="2.5" y="6.5" width="9" height="1.5" fill="#1f2937"/>` +
    `<rect x="2.5" y="10" width="9" height="1.5" fill="#1f2937"/>` +
    `<line x1="3" y1="10.5" x2="11" y2="4" stroke="#1f2937" stroke-width="1.4"/>`,
};

/** One glyph as an SVG string, `px` square. */
export const gateIconSvg = (glyph: GateGlyph, px = 14): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" width="${px}" height="${px}" ` +
  `aria-hidden="true" focusable="false" style="display:block;flex:none">${GLYPH_BODY[glyph]}</svg>`;

/** The same glyph in a React surface — one drawing, not a second copy in JSX. */
export function GateIcon({ glyph, px = 14, className }: { glyph: GateGlyph; px?: number; className?: string }) {
  return <span aria-hidden="true" className={`inline-flex shrink-0 ${className ?? ""}`} dangerouslySetInnerHTML={{ __html: gateIconSvg(glyph, px) }} />;
}

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
    `<span aria-hidden="true" style="display:inline-flex;width:18px;justify-content:center">${gateIconSvg(gateGlyphFor(gate.info?.barrier), 16)}</span>` +
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
          <GateIcon glyph={gateGlyphFor(g.info?.barrier)} px={12} />
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
