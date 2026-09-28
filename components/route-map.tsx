"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Check, Info, List, Plus, TriangleAlert, Undo2, X } from "lucide-react";
import { useMapLegend } from "@/lib/map/layer-prefs";
import { setMapPendingCount } from "@/lib/map/fullscreen";
import { RouteSegmentProperties } from "@/lib/types";
import { haversineMeters, type Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";
import { nearestAlong } from "@/lib/routing/reroute-leg";
import { LINE_HOLD_MS, TAP_SETTLE_MS, lineDragStep, type LineDragEvent, type LineDragState } from "@/lib/map/line-drag";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locale";
import { POI_KIND, stopNumbers, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";
import { PlaceInput } from "@/components/place-input";
import { MapPointSheet, type MapPointSheetModel } from "@/components/map-point-sheet";
import type { ResolvedPlace } from "@/lib/chat/places";
import { nearestUnder } from "@/lib/map/pin-hit";
import { neighboursAlong } from "@/lib/map/point-selection";
import type { ProposalView } from "@/lib/map/edit-proposal";
import { useProposalLayer } from "@/components/map/proposal-layer";
import { gatesAlong, gateHighlightLine, type GateOnRide } from "@/lib/map/gates-along";
import { gateAtLabel, gateCardHtml, gateGlyphFor, gateIconSvg, type GateGlyph } from "@/components/gate-card";
// ── P1-D: imports ──
import { LoaderCircle } from "lucide-react";
import { useProposalRefused } from "@/components/map/proposal-layer";

/**
 * ✓ in slot 3, desktop row and phone column alike (Phase 1 preview, B4).
 *
 * Always drawn, in every state (rider, 2026-09-28: every button of the bar
 * and the column is always there — never hidden, never invisible; one with
 * nothing to do is disabled, so there are no gaps and each button is always
 * where the thumb expects it):
 *
 * - `confirmBusy` — the proposal is still routing: a spinner in the SAME
 *   button, enabled (orange), still pressable (a press confirms it the moment
 *   it lands), named `previewConfirmQueued`.
 * - A refused proposal — disabled, named `previewConfirmRefused`; the reason
 *   is the chip in the notice slot.
 * - Nothing pending, or the off-road verdict in the bar — disabled.
 * - Otherwise the mark's own `confirmLabel` / `onConfirm`, as before.
 *
 * Disabled is a neutral grey fill with a grey icon, not a faded orange:
 * orange means it can be pressed.
 */
const SLOT_DISABLED = "disabled:cursor-default disabled:border-stone-200 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none disabled:hover:bg-stone-200";

function ConfirmSlot({ pending, round, phone = false, "data-slot": slot }: {
  pending: MapPendingMark | null;
  round: string;
  phone?: boolean;
  "data-slot": "3";
}) {
  const [locale] = useLocale();
  const m = messages(locale);
  const refused = useProposalRefused() && Boolean(pending);
  const idle = !pending || Boolean(pending.offRoad);
  const busy = !refused && !idle && Boolean(pending?.confirmBusy);
  const onConfirm = refused || idle ? null : pending!.onConfirm;
  const label = !pending ? m.pickOnMapConfirm
    : pending.offRoad ? pending.offRoad.title
    : refused ? m.previewConfirmRefused : busy ? m.previewConfirmQueued : pending.confirmLabel;
  const icon = phone ? "size-6" : "size-5";
  return (
    <button type="button" onClick={onConfirm ?? undefined} disabled={!onConfirm} aria-disabled={!onConfirm || undefined} data-slot={slot}
      data-confirm={refused ? "refused" : busy ? "busy" : onConfirm ? "ready" : "idle"} aria-busy={busy || undefined}
      aria-label={label} title={label}
      className={`${round} border border-[#f56300] bg-[#f56300] text-white transition hover:bg-[#d85600] ${SLOT_DISABLED}`}>
      {busy
        ? <LoaderCircle aria-hidden="true" className={`${icon} animate-spin`} />
        : <Check aria-hidden="true" className={icon} />}
    </button>
  );
}
// ── /P1-D: imports ──

/** A ride pin as built, with what pressing it means. */
type PinTarget = { el: HTMLElement; role: "start" | "via" | "finish"; index: number };
/** The pin a tap at client (`x`, `y`) meant — see `nearestUnder`. */
const nearestPin = (targets: PinTarget[], x: number, y: number): PinTarget | null =>
  nearestUnder(targets, (t) => (t.el.isConnected ? t.el.getBoundingClientRect() : null), x, y);

// Serve the MapLibre worker from /public — bundler-emitted module workers
// 404 under the Next.js dev server, leaving the map blank.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

/**
 * The planning map's header bar: everything the rider needs above the map
 * while he is composing a ride.
 *
 * ## Why the map carries all three
 *
 * The map had grown two modes that looked identical. A row's pin button put it
 * in "pick a place for row X"; with no row waiting, a tap on the same map made
 * a new stop instead. Both drew a marker, both offered Confirm, and nothing on
 * screen said which one was live — so a tap meant two different things
 * depending on invisible state, and pins landed in roles the rider had not
 * asked for.
 *
 * The model that replaced it has exactly one active row at any time, and **a
 * tap always means "this point → the active row"**. That rule is only honest
 * if the map says whose row it is, so:
 *
 * - `hint` is the one hint line — "Atzīmē kartē → „Līdz”" — always present
 *   while the map is being planned on, always naming the row the next tap
 *   answers. It is the only hint on the map; every other one has gone.
 * - `onAddStop` is the explicit control that replaced "a tap on the idle map
 *   creates a stop". The gesture is gone and the capability is a button, which
 *   is a thing the rider can see and aim at. `null` at the stop cap
 *   (`MAX_STOPS`), where the button is disabled and `addStopFullLabel` says
 *   why — and `notice` says it in a few words beside the header.
 * - `search` is the same place field the form's rows use, bound to the active
 *   row. A rider looking at the map should not have to go back to the form to
 *   type a name he already knows — and a pick here fills the row exactly as a
 *   pick in the form does, tick and recent places included.
 * - `pending` is the bar at the bottom of the map: Confirm / Cancel for the
 *   point under the pending marker, or the router's verdict that it is off the
 *   road with its own Move / Cancel. Present only while a mark is pending —
 *   marked, not yet confirmed. It lives on the map because that is where the
 *   rider's eyes and thumb are while he marks; under the row in the form it
 *   was off screen on a phone the moment the map was scrolled into view.
 *
 * Built by the composer, which is the one thing that knows which row is active
 * and what it is called; the page only relays it.
 */
export type MapPendingMark = {
  /** "Apstiprināt", or "Pārbauda…" while the routable-point check runs. */
  confirmLabel: string;
  /** Null while the check is in flight — the button is then disabled. */
  onConfirm: (() => void) | null;
  /**
   * Preview before commit (Phase 1): the proposal is still routing. ✓ spins
   * in its own slot and stays pressable — a press confirms it when it lands.
   * The slot never moves or disappears for it — no slot ever does.
   */
  confirmBusy?: boolean;
  cancelLabel: string;
  /** Drops the mark; a row "+ Pietura" made goes with it. Escape does the same. */
  onCancel: () => void;
  /** The router's "this point is N m from a road", replacing Confirm / Cancel
   *  while it is on screen. */
  offRoad: {
    title: string;
    moveLabel: string;
    /** Null when no road is near enough to still be the same place: the
     *  Move button is then not drawn at all. */
    onMove: (() => void) | null;
    dismissLabel: string;
    onDismiss: () => void;
  } | null;
  /** A batch's ↶: take the last pending stop away. Drawn between ✓ and ✕. */
  undo?: { label: string; onUndo: () => void };
  /** How many marks this is — a batch's size; one when absent. */
  count?: number;
};

export type MapControls = {
  /** "Atzīmē kartē → „Līdz”" — read out whenever the active row changes. */
  hint: string;
  /** The active row's own name („Līdz”, „Caur (1)”), shown as the field's tag. */
  rowLabel?: string;
  /**
   * What the pending mark will become: the start's green pin, the finish's
   * red one, or a stop's orange disc with the number it will wear. The mark
   * looks like its future pin from the moment it lands — see the marker
   * effect for how "not yet confirmed" stays readable.
   */
  pendingPin?: { role: "start" | "finish" | "via" | "shape"; number: number | null };
  pending: MapPendingMark | null;
  onAddStop: (() => void) | null;
  addStopLabel: string;
  addStopFullLabel: string;
  /**
   * The ride's own pins may be dragged — edit mode only. A dragged pin does
   * not move by itself: its row becomes the active one and the drop point its
   * mark, previewed and waiting for Confirm like any other. `index` counts
   * the numbered stops from 0; it is 0 for the two ends.
   */
  onPinDrag?: (role: "start" | "via" | "finish", index: number, at: { lat: number; lon: number }) => void;
  /**
   * A ride pin clicked: its row becomes the active one, as if its field had
   * been focused — no card, and the pin does not move (rider, 2026-09-25:
   * switching from the finish to the start meant going back to the form).
   * Of two pins that overlap, the one whose centre is nearer the tap is
   * the one pressed, so the one underneath can be taken too.
   */
  onPinPress?: (role: "start" | "via" | "finish", index: number) => void;
  search: {
    value: string;
    confirmed: ResolvedPlace | null;
    onChange: (value: string) => void;
    onPick: (place: ResolvedPlace | null) => void;
    near: { lat: number; lon: number } | null;
    placeholder: string;
    /**
     * The phone's shorter words for the same (rider, 2026-09-28: at 320 px
     * „Meklē vai atzīmē pieturu” was cut off) — „Meklē pieturu”. Absent:
     * `placeholder` on the phone too.
     */
    placeholderPhone?: string;
    /** The field cannot act (a batch, the cap with no row): off, and it looks it. */
    disabled?: boolean;
    /**
     * No row is active: focusing the field starts a new stop through „+”'s
     * own path, and the field then searches for it (backlog 40).
     */
    onFocus?: (() => void) | null;
  };
  /** The active row's own confirmed place, whose pin is raised on the map. */
  activePlace?: { lat: number; lon: number } | null;
  /** Planning: the pins joined in riding order, and a pending mark's slot. */
  planLine?: { confirmed: [number, number][]; pending: [number, number][] | null } | null;
  /**
   * Edit mode: a point on the drawn line was grabbed — by a deliberate drag
   * of the line only, never a tap (lib/map/line-drag.ts). `at` is on the line; `slot`
   * is how many of the ride's stops lie before it along the line, which is
   * where the new stop goes in the form.
   */
  onLineGrab?: (grab: { lat: number; lon: number; slot: number }) => void;
  /** The grabbed point while it waits for its new spot: a dot on the line. */
  grab?: { lat: number; lon: number } | null;
  /**
   * Edit mode: the ride's shaping points („maršruta punkti”, 2026-09-25) —
   * small white dots with a dark edge on the line, no number. A press
   * selects it (`onShapePress` → `selectedPoint` + `pointSheet`): moved by
   * the next mark, removed, or made a stop from the sheet. A confirmed dot
   * does not drag (rider, 2026-09-25: one that still followed the finger
   * after ✓ read as a point left half-edited, and its drag broke the line).
   * Never on a plain result or a shared ride, where the line already shows
   * the bend.
   */
  shapePoints?: { lat: number; lon: number }[];
  onShapeDrag?: (index: number, at: { lat: number; lon: number }) => void;
  onShapePress?: (index: number) => void;
  /** The dot's own name, tooltip and screen-reader label. */
  shapeLabel?: string;
  /**
   * The point the rider tapped — a ride pin or a shaping point — drawn with a
   * steady ring until the selection ends (✓, ✕, „Izņemt”, the sheet's ✕).
   */
  selectedPoint?: { lat: number; lon: number } | null;
  /** What can be done to the selected point, right there (`MapPointSheet`). */
  pointSheet?: MapPointSheetModel | null;
  /**
   * Edit mode, while a point is being moved or placed: thin dashed straight
   * lines from `candidate` to the places before and after it in riding order —
   * `neighbours` when the caller knows them (a stop's rows), else found along
   * the drawn line from `origin` (a shaping point: its old place, or where the
   * line was grabbed). Follows a dragged pending marker live.
   */
  movePreview?: { origin?: { lat: number; lon: number } | null; neighbours?: { lat: number; lon: number }[]; candidate: { lat: number; lon: number } | null } | null;
  /**
   * Batch adding (2026-09-25): while it is on, the single pending marker is
   * not drawn and nothing moves the camera; the batch's pending stops are
   * drawn here instead — dashed numbered pins that can be selected (a press),
   * dragged, and dropped (the ✕ a selected one carries).
   */
  batchMode?: boolean;
  /** `finish`: the new point rides on past the one-way finish and becomes it (Phase 1): a red pin, no number. */
  batch?: { id: number; lat: number; lon: number; number: number; selected: boolean; failing: boolean; finish?: boolean }[];
  onBatchSelect?: (id: number) => void;
  onBatchMove?: (id: number, at: { lat: number; lon: number }) => void;
  onBatchDrop?: (id: number) => void;
  /** Changes when every pin should be shown once — after a batch Confirm. */
  fitToken?: number;
  /** ↶ outside a batch; `onUndo` null when there is nothing to take back. */
  undo?: { label: string; onUndo: (() => void) | null };
  /**
   * A short fact about the header's state on a line of its own — the stop
   * cap, "Maks. 10 pieturas" (rider, 2026-09-25: said inside the field it was
   * cut to „Vairāk pieturu pievienot ne…” at 375 px, where the field is 71 px
   * wide beside ✓ ↶ ✕). `title` is the whole sentence, for the tooltip and
   * a screen reader.
   */
  notice?: { text: string; title: string } | null;
  /**
   * Choices about the pending mark, as chips in the notice area — never in
   * the bar or the column, whose slots stay put (Phase 1 addition,
   * 2026-09-28): the new point's kind („Pietura” / „Caurbraucams”), the leg
   * it goes into when Mopik is not sure, and — a pass-through point moved
   * onto the line — keep it or remove it. One row of groups; each group's
   * options side by side, the selected one filled.
   */
  choices?: MapChoiceGroup[] | null;
};

/** One group of choice chips; `label` names the group for a screen reader. */
export type MapChoiceGroup = {
  key: string;
  label: string;
  /** Plain buttons that do something once („Pārrēķināt posmu”), not a choice among options. */
  action?: boolean;
  options: { key: string; label: string; title?: string; selected: boolean; onSelect: () => void }[];
};

type Props = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null;
  /**
   * The ride's two ends. `label` is the place's own name where the caller has
   * one — a generated ride does, a form still being composed may not — and it
   * becomes the pin's tooltip and its screen-reader name, so the marker says
   * *which* place it is while the word under it says which end.
   */
  start: { lat: number; lon: number; label?: string } | null;
  destination?: { lat: number; lon: number; label?: string } | null;
  /**
   * The ride's stops. `kind` and `detail` are optional and filled in from the
   * POI dataset where the stop is a place it knows — a hillfort's marker then
   * says so, and one the rider typed by hand simply says "Pieturvieta".
   */
  via?: {
    lat: number; lon: number; label: string; kind?: string; detail?: string;
    /**
     * The number its pin wears, when the composer says (Phase 1: a new point
     * pending among the stops moves the ones after it up while it waits).
     * Absent: counted here, 1…n in order, sights skipped.
     */
    number?: number | null;
    /**
     * The POI category, when this via came from a suggestion rather than from
     * the form. It selects the glyph (`POI_KIND`) and the card's wording:
     * a sight says "Apskates objekts", a typed stop keeps 🅿️ and
     * "Pieturvieta". Absent on everything the rider typed.
     */
    category?: string;
  }[];
  /**
   * A place the rider asked to *look at* from Ieteikumi — not a stop.
   *
   * Deliberately its own prop rather than another entry in `via`: a via point
   * is part of the ride and gets the 🅿️ pill, while this is a place being
   * considered. It gets a pulsing ring instead, and it is temporary — the
   * `token` changes on every press so pressing Kartē twice on the same row
   * re-flies and re-opens the card rather than doing nothing, and `onClear`
   * fires when the rider clicks the map or presses Escape.
   */
  focus?: {
    lat: number; lon: number; label: string; kind?: string; token: number;
    /** Whether this place is currently ticked, so the card can say which. */
    picked?: boolean;
    /**
     * What riding to this place costs, exactly as the list's row states it.
     *
     * The card and the row are two views of one offer, so they must not
     * disagree — a rider who reads "+17,0 km · garš apbrauciens" in the list,
     * presses Kartē and finds a bare Pievienot has been told less on the map
     * than in the list, and the number is the whole basis of the decision.
     * `delta` is the formatted "+17,0 km · +34 min"; `note` is the muted word
     * after it ("garš apbrauciens", or "nav sasniedzams"); `why` is the
     * sentence Vairāk carries, shown here too because the map card has no
     * Vairāk of its own. `canPick` is false where there is nothing to splice —
     * the unreachable row — and the card then offers no button, for the same
     * reason the row offers no checkbox.
     */
    detour?: { delta?: string; note?: string; why?: string; canPick: boolean } | null;
  } | null;
  onFocusCleared?: () => void;
  /**
   * Tick or untick the focused place, from the card on the map itself.
   *
   * The rider asked for it in as many words — "kā man šos ērti pievienot
   * maršrutam?" — after browsing suggestions on the map: having flown to a
   * place and decided he wants it, going back to the list to find the row
   * again is a step that should not exist. It ticks rather than re-plans, so
   * the map card and the list row mean the same thing. Absent only where there
   * is no plan to re-plan — a share code old enough to carry none.
   */
  onFocusToggle?: () => void;
  /**
   * The sights ticked but not yet ridden through.
   *
   * Each gets a persistent pill — the kind's glyph, ringed — so the rider can
   * see what he has chosen spread across the route before spending a
   * generation on it. Distinct from `focus` (one place, temporary, cleared by
   * a click on the map) and from `via` (already part of the ride).
   */
  selectedPois?: { id: string; name: string; lat: number; lon: number; category: string }[];
  /**
   * The sights this ride passes or runs near, as the lookup returned them.
   *
   * Three states now exist on the map and they are three different claims, so
   * they are three different marks:
   *
   * - `via` — the rider asked the ride to go there. Ringed pill, always drawn,
   *   governed by nothing.
   * - `selectedPois` — ticked, not yet re-planned. Ringed pill, always drawn.
   * - these, in `onRoute` — the route already passes them and the rider chose
   *   nothing. A plain white pill, no ring: "on your way", not "you chose
   *   this". Drawn without the card ever being opened, which is what the rider
   *   asked for, and which is why the fetch moved up to the pages.
   * - these, in `nearby` — near the route and not in it. The same pill at the
   *   same size, one step lighter, because the map must not read as though the
   *   ride visits them — but must still show them, which the old small dot
   *   did not.
   *
   * A place that is already a via or already ticked is not drawn from here:
   * the ride's own mark wins, and two pills on one point read as two places.
   */
  routePois?: RoutePois | null;
  showTet: boolean;
  onToggleTet: (visible: boolean) => void;
  /**
   * The sights layer's switch: every sight marker on the map, of all four
   * kinds — on-route, nearby, ticked (`selectedPois`) and the ones already
   * added to the ride as vias.
   *
   * The rider settled this after seeing the first version: "Apskates vietas"
   * off must mean no sights on the map, and a sight he added is still a sight.
   * The things it does NOT govern are the ones that are not sights at all —
   * the 🅿️ stops he typed into the form, the start and finish pins, the
   * warning badges and the gate pills. The drawn line never changes either
   * way: hiding a marker is not un-planning the detour under it.
   */
  showSights: boolean;
  onToggleSights: (visible: boolean) => void;
  /** Open the row's card for a sight the rider clicked on the map. */
  onShowPoi?: (poi: RoutePoi) => void;
  /**
   * Pick mode: the next click on the map is a place for the form, not a
   * question about a road.
   *
   * Set only while a row is waiting for a point. The map then answers the
   * click with these coordinates and does nothing else — no segment card, no
   * highlight, no clearing the focus ring — because in pick mode every click
   * means the same thing and a card opening under the rider's finger would
   * cover the very spot he is aiming at.
   */
  onPickPoint?: (p: { lat: number; lon: number }) => void;
  /**
   * The point already picked, drawn as a marker the rider can drag.
   *
   * A finger lands within ~30 m of where it was aimed, which is the width of
   * a village street — dragging is how the pick is corrected, and it is the
   * reason this is a marker rather than a dot in a layer. `onPickedPointMove`
   * fires on `dragend` only: reverse geocoding every frame of a drag would be
   * a request per pointer sample.
   */
  pickedPoint?: { lat: number; lon: number } | null;
  onPickedPointMove?: (p: { lat: number; lon: number }) => void;
  /**
   * Where to take the map when pick mode opens, with a token so opening it
   * twice on the same row flies there twice — a rider who has panned away and
   * pressed the pin again means "take me back".
   *
   * Zoom ~14 rather than the route's fit: a rider aiming at a yard needs the
   * village legible, and the bounds the map happened to be showing are about
   * a different question.
   */
  pickCenter?: { lat: number; lon: number; token: number; fit?: { lat: number; lon: number }[] } | null;
  /**
   * A fix the map's own geolocate button obtained, handed back so the form can
   * reuse it rather than prompting again for the next row.
   */
  onGeolocated?: (p: { lat: number; lon: number }) => void;
  /**
   * The planning map's own header bar. Absent on the result map and on any map
   * that is not being planned on.
   *
   * See `MapControls` for what is in it and why the map draws all three.
   */
  controls?: MapControls | null;
  /**
   * Preview before commit (Phase 1, docs/DESIGN-route-editing.md B4): the
   * edit waiting for ✓ — its line over the dimmed ride and its chip in the
   * notice slot (`useProposalLayer`, components/map/proposal-layer.ts).
   * Absent or null: nothing is proposed.
   */
  proposal?: ProposalView | null;
};

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/**
 * The TET overlay, fetched per country for whatever the map is showing.
 *
 * The trail is 118,246 km across 33 countries — 4 MB of GeoJSON as one file,
 * and simplifying it to a phone-sized download costs the shape (1.1 points/km
 * against the 7.1 the Latvia-only layer had). `public/tet/index.json` carries
 * a bounding box per country, so the map can decide what it needs before
 * downloading anything, and each country is ~231 KB — the same scale that
 * already worked.
 */
type TetIndex = Record<string, { bbox: [number, number, number, number] }>;
let tetIndex: TetIndex | null = null;
const tetLoaded = new Map<string, GeoJSON.Feature[]>();

async function loadTet(map: maplibregl.Map) {
  try {
    tetIndex ??= (await (await fetch("/tet/index.json")).json()) as TetIndex;
    const b = map.getBounds();
    const visible = Object.entries(tetIndex)
      .filter(([, { bbox }]) =>
        bbox[0] <= b.getEast() && bbox[2] >= b.getWest() &&
        bbox[1] <= b.getNorth() && bbox[3] >= b.getSouth())
      .map(([country]) => country);

    const missing = visible.filter((c) => !tetLoaded.has(c));
    await Promise.all(missing.map(async (country) => {
      // Mark it taken first: panning fires this faster than a fetch returns,
      // and the same country must not be downloaded twice.
      tetLoaded.set(country, []);
      const res = await fetch(`/tet/${country}.geojson`);
      if (!res.ok) { tetLoaded.delete(country); return; }
      const fc = (await res.json()) as GeoJSON.FeatureCollection;
      tetLoaded.set(country, fc.features);
    }));

    // Always push, even when nothing was missing. This used to return early on
    // `!missing.length`, which made the cache poison itself: `markTet` runs on
    // every route and is deliberately not gated on the toggle, so it filled
    // `tetLoaded` before `map.on("load")` had created the source. `setData` on
    // an undefined source is a silent no-op through the optional chain, the
    // countries stayed marked loaded, and every later call — the toggle, a
    // pan — returned at the early exit without ever reaching here. Toggle on,
    // no line, no error. Only panning into a *new* country recovered it.
    const source = map.getSource("tet") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({ type: "FeatureCollection", features: [...tetLoaded.values()].flat() });
  } catch {
    // An optional overlay must never break the map.
  }
}

/**
 * Flag the runs that ride the TET, and push the result back to the source.
 *
 * Two steps, because the geometry it needs is downloaded per country and may
 * not be in hand yet: make sure the countries the route touches are loaded
 * (`loadTet` is already cached and deduplicated), then match and re-set the
 * data with `onTet` stamped on. A route with no TET anywhere near it costs one
 * `index.json` read and stops.
 */
async function markTet(
  map: maplibregl.Map,
  collection: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProps>
) {
  try {
    await loadTet(map);
    const tet = [...tetLoaded.values()].flat();
    if (!tet.length) return;
    const onTet = tetOverlap(collection.features, tet);
    if (!onTet.size) return;
    const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    source.setData({
      type: "FeatureCollection",
      features: collection.features.map((f) => {
        const id = f.properties?.[SEGMENT_ID];
        return typeof id === "number" && onTet.has(id)
          ? { ...f, properties: { ...f.properties, [ON_TET]: true } }
          : f;
      }),
    });
  } catch {
    // The casing is an annotation; never let it break the route.
  }
}

// Two independent dimensions, and each one is read off a different property of
// the line:
//
//   COLOUR  = what the surface is    (see `SURFACE_COLORS`)
//   PATTERN = what kind of way it is (solid road, dashed track, dotted trail)
//
// Keeping them independent is what lets 4 colours × 3 patterns explain all
// twelve combinations with seven legend entries. It also settles a real
// complaint: the rider found an asphalt stretch of a Como → Lugano ride drawn
// as a blue DASHED line and nothing in the legend said what that meant. It
// means exactly what it looks like — a paved forest track — and the legend now
// says so in two rows instead of pretending the combination cannot happen.
//
// The scheme before this one used colour for the road class (one orange family,
// a darker shade per class) and left the surface to the dash pattern alone.
// That made a paved track blue-dashed *by accident*, as a collision between the
// two rules rather than as a statement, and it had no way at all to say
// "surface unknown".
const PAVED_COLOR = "#0071e3";
/**
 * The TET purple, a step brighter than the `#af52de` it was.
 *
 * It has two jobs now: the reference overlay, and the casing under the parts
 * of the rider's own route that run along the trail (see `tetOverlap`). The
 * old shade was fine as a quiet background line but disappeared as a halo
 * behind a 5 px orange one, and the two have to read as the same thing.
 */
const TET_COLOR = "#c65cff";

/** Marks the TET line in the segment card, matching the purple casing. */
const TET_LEGEND_ICON = "🟣";

/**
 * Colour by surface — the four buckets the SEGUMS panel already reports, in
 * the same order, so the map and the numbers under it agree.
 *
 * Gravel is the app's own brand orange `#f56300` (the logo dot, the generate
 * button, the PWA theme colour), so the commonest adventure surface belongs to
 * the same palette as the app around it. Dirt keeps the darker, deeper orange
 * that used to mark trails: it is the rougher stuff, and it reads that way.
 *
 * Grey for unknown is the point of the fourth bucket. "OSM has not recorded
 * this surface" is real information a rider wants — it is the stretch to look
 * at satellite imagery for — and the old scheme had to fold it in with gravel
 * and silently overstate what it knew. Stone-500 rather than stone-400: on the
 * green basemap the lighter grey read as a faded route rather than a stated
 * unknown. The white casing under it is unchanged, so it still reads as a
 * route and not as a basemap line.
 */
const SURFACE_COLORS = {
  /** `asphalt` — the one distinction a rider makes at a glance. */
  asphalt: PAVED_COLOR,
  /** `gravel` + `compacted`: the brand orange. */
  gravel: "#f56300",
  /** `ground` + `dirt` + `sand`. */
  dirt: "#bd4b00",
  /** `unknown`: OSM does not say. */
  unknown: "#78716c",
} as const;

/**
 * The legend's pattern swatches only. Stone-700: dark enough to read at 3 px
 * on white, and deliberately not any of the four route colours, so the shape
 * of the sample is the only thing it says.
 */
const PATTERN_INK = "#44403c";

/**
 * Where the line stops being able to hold a pattern.
 *
 * - At/above `ZOOM_PATTERN_FINE` the line is ~5 px and the tight rhythm
 *   (`[2.2, 1.1]` / `[0, 1.8]`) reads as intended.
 * - Between the two it is ~3–4 px, so the dashes are stretched: the same ink
 *   in fewer, longer marks survives a thinner line.
 * - Below `ZOOM_PATTERN_OFF` nothing survives — the route is a thread across a
 *   whole region — so track and trail go solid, drawn a little narrower than
 *   the road base. At that zoom the class is genuinely not readable and the
 *   line only claims what it still can: the surface, by colour.
 *
 * `line-dasharray` is a cross-faded property: the style spec declares it
 * `interpolated: false` with `zoom` among its parameters (verified in
 * maplibre-gl 6.6.0's own spec), so `step` works and `interpolate` does not.
 * `line-color` and `line-width` are interpolated and take `interpolate`.
 */
const ZOOM_PATTERN_OFF = 10;
const ZOOM_PATTERN_FINE = 12;

/** `[1, 0]` is a dash as long as the line and no gap at all: a solid line. */
const SOLID_DASH = [1, 0];

/**
 * Dash pattern by zoom, in line widths. `step` returns the first value below
 * its first stop, so this reads: solid under z10, stretched under z12, the
 * design rhythm above.
 */
const dashByZoom = (
  far: number[],
  fine: number[]
): maplibregl.ExpressionSpecification =>
  // Each dash array has to be wrapped in `["literal", …]`: inside an
  // expression a bare array is read as a call, so `[4, 2]` parses as "the
  // operator 4", the property is rejected and the layer loses its paint
  // entirely. `step` over arrays is valid here but not expressible in the
  // narrow `ExpressionSpecification` union, hence the cast at the boundary.
  ([
    "step", ["zoom"],
    ["literal", SOLID_DASH],
    ZOOM_PATTERN_OFF, ["literal", far],
    ZOOM_PATTERN_FINE, ["literal", fine],
  ] as unknown) as maplibregl.ExpressionSpecification;

const TRACK_DASH = dashByZoom([4, 2], [2.2, 1.1]);
/**
 * The trail's dots. **The dash length must stay 0 at every step** — `[0, gap]`
 * with a round `line-cap` is what makes each dot exactly the round cap of the
 * line, i.e. a circle. Any non-zero dash length draws a short segment with a
 * rounded end at each side, which reads as an oval ("bumbiņas", not olives).
 * Only the sub-z10 solid fallback is exempt, being a line rather than dots.
 */
const TRAIL_DASH = dashByZoom([0, 2.6], [0, 1.8]);

/**
 * Widths for the two patterned classes. Identical to `LINE_WIDTH` where the
 * pattern still works, and a step narrower once the patterns are gone: when
 * three solid lines differ only in colour, the thinner one reads as the
 * lesser road without anyone having to look it up.
 */
const PATTERNED_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 2,
  10, 3.2,
  12, 4.6,
  14, 5.5,
  17, 7,
];

/**
 * Line weight by zoom. A fixed width is wrong at both ends: 4 px is a thread
 * across a whole-country view and a slab when the rider is looking at one
 * junction. These interpolate, and the casing keeps a constant ~3 px halo
 * around the line at every step.
 */
const LINE_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 2.5,
  10, 4,
  14, 5.5,
  17, 7,
];
const CASING_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 5,
  10, 7,
  14, 9,
  17, 11,
];
const GLOW_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 10,
  10, 16,
  14, 22,
  17, 28,
];

/**
 * The TET casing: wider than the casing, narrower than the glow, so the purple
 * reads as a halo around the route's own colour rather than replacing it. The
 * class colour and its dashes stay exactly as they are on top — "this is a
 * track" and "this is the TET" are two different facts and both are shown.
 */
const TET_CASING_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 8,
  10, 11,
  14, 14,
  17, 17,
];

/**
 * The highlight under a badge's segments: a soft yellow, wide and translucent.
 *
 * Yellow because the basemap is greens, greys and the route's own blue and
 * orange — the one hue nothing else on the map is using, so the highlight
 * never reads as another road class. Wide enough to be visible past the glow,
 * translucent enough that the line it is pointing at stays readable.
 */
const HIGHLIGHT_COLOR = "#ffd60a";

/** A filter that matches no feature: the highlight's resting state. */
const HIGHLIGHT_NONE: maplibregl.FilterSpecification = ["==", ["literal", 1], 0];

/** …and one that matches exactly the runs a badge speaks for. */
const highlightFilter = (ids: number[]): maplibregl.FilterSpecification =>
  ids.length
    ? ["in", ["get", SEGMENT_ID], ["literal", ids]]
    : HIGHLIGHT_NONE;

const HIGHLIGHT_WIDTH: maplibregl.ExpressionSpecification = [
  "interpolate", ["linear"], ["zoom"],
  6, 12,
  10, 18,
  14, 26,
  17, 32,
];

/**
 * The warning kinds, and which of them earn a mark on the line itself.
 *
 * Rough track (tracktype grade 4–5) is deliberately NOT here: the rider asked
 * for it off the map, because a grade-4 track is the ride rather than a hazard
 * and the badges were annotating half the route. It is still counted in the
 * result panel's warnings and still listed in the segment card — those are
 * lists, which can afford a row; the map cannot afford a marker. Put `"rough"`
 * back in this array to re-enable the badge and its hover label; nothing else
 * has to change.
 */
type WarningKind = "unverified" | "trail" | "rough";
const BADGE_KINDS: WarningKind[] = ["unverified", "trail"];

/**
 * Gate markers on the line — backlog item 12, and a switch to turn them off.
 *
 * Only gates **on the ridden way** reach here — `classify.ts` matches them as
 * vertices of the route geometry, so the barrier across a driveway beside the
 * route is not marked ("ja vārti nav uz paša maršruta ceļa — jāņem ārā").
 *
 * Not a `WarningKind`, deliberately, and this is the rider's own distinction: a
 * warning is a property of a *stretch* of road, a gate is a *point* on it. The
 * warning machinery groups runs, picks a midpoint, merges icons into one pill
 * and highlights whole features — every one of which would put the gate marker
 * somewhere the gate is not. Gates get their own small pass with their own cap.
 *
 * `SHOW_GATE_MARKERS` is the off switch, the way `BADGE_KINDS` is for warnings:
 * set it to `false` and the line carries none. The RISKI row and the segment
 * card are unaffected — those are lists and can always afford a line.
 */
const SHOW_GATE_MARKERS = true;

/**
 * The gate glyph's size inside its 20 px pill.
 *
 * Not an emoji any more: the rider replaced the 🚪 with two small drawings of
 * our own, picked by `barrier=*` — a boom barrier (šlagbaums) for `lift_gate`
 * and `chain`, a field gate for everything else (`gateIconSvg` in
 * `components/gate-card.tsx` has both and why). 🚪 said "gate" but not which
 * kind, and the kind is what the gate card is about. The same drawing heads
 * the card and marks the gate in the segment card and in RISKI. The warning
 * badges stay ⚠️ and 🔥 — only the gate changed.
 */
const GATE_GLYPH_PX = 14;

/**
 * Most gate markers one route may carry.
 *
 * A gate is a point, so unlike a warning badge there is no run to merge into
 * and no natural spacing — a forest ride through Latvian farm country can meet
 * dozens. Thirty is where a phone map still reads as a route with marks on it
 * rather than as a line of doors. Past the cap the markers are thinned to every
 * k-th gate, so they stay spread along the whole ride instead of stopping at
 * the thirtieth: the marks then mean "gates along here", and the RISKI row
 * carries the exact number, which is the figure the rider acts on.
 */
const GATE_MARKER_MAX = 30;

/**
 * A gate's pill: the same construction as `badgeElement`, one size smaller.
 *
 * 20 px against the badge's 24 px, and z-index 0 against its 1, because a gate
 * is the least urgent of the three marks on the line — a warning can mean
 * turning back and a stop is the rider's own answer, while a gate is a thing to
 * expect. Below both, and it never grows: a gate pill holds one glyph.
 */
/**
 * Below the `md` breakpoint — the one the page's map layout already uses. On a
 * phone the planning (and edit) header row sits at the bottom of the map, in
 * the thumb's reach, and TET at the top (rider, 2026-09-25).
 */
const PHONE_QUERY = "(max-width: 767px)";
/** Whether the map is laid out for a phone now (the `max-md` layout), kept live. */
function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(PHONE_QUERY);
      q.addEventListener("change", onChange);
      return () => q.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * The phone field's row tag (rider, 2026-09-28): the pin the row's mark
 * becomes, small — a stop's number on its orange disc, the start's green and
 * the finish's red disc — in place of „Caur (2)”, which left the field 80 px
 * at 320 px. The words stay the tag's name for a screen reader and the
 * desktop's tag.
 */
function RowBadge({ pin, label }: { pin: NonNullable<MapControls["pendingPin"]>; label: string }) {
  const bg = pin.role === "start" ? START_PIN_COLOR : pin.role === "finish" ? FINISH_PIN_COLOR : pin.role === "shape" ? "#ffffff" : "#f56300";
  return (
    <span data-row-badge={pin.role} title={label} aria-label={label}
      className={`flex size-6 shrink-0 items-center justify-center rounded-full border-2 text-[12px] font-bold tabular-nums leading-none text-white shadow-sm ${pin.role === "shape" ? "border-stone-900" : "border-white"}`}
      style={{ background: bg }}>
      {pin.role === "via" && pin.number !== null ? pin.number : null}
    </span>
  );
}

/**
 * The finger's target round a gate pill, in CSS px.
 *
 * The pill is 20 px and stays so; a phone tap on it missed as often as not.
 * The button is this big and transparent, with the pill drawn in its middle,
 * so a tap anywhere near the gate glyph is the gate's — and, being a marker, never
 * reaches the line underneath (`onMarker` keeps a drag from grabbing it too).
 */
const GATE_HIT_PX = 44;

function gateElement(title: string, glyph: GateGlyph): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.dataset.gate = "";
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    `width:${GATE_HIT_PX}px;height:${GATE_HIT_PX}px;background:transparent;` +
    "line-height:0;cursor:pointer;user-select:none;border:0;padding:0;" +
    "-webkit-tap-highlight-color:transparent;touch-action:manipulation;" +
    // Under the warning badges (1) and the stops (2).
    "z-index:0";
  el.innerHTML =
    `<span aria-hidden="true" style="display:flex;align-items:center;justify-content:center;` +
    `width:20px;height:20px;border-radius:10px;` +
    `background:rgba(255,255,255,0.92);box-shadow:0 1px 2px rgba(0,0,0,0.2);opacity:0.9">` +
    `${gateIconSvg(glyph, GATE_GLYPH_PX)}</span>`;
  return el;
}

/**
 * The yellow highlight round one tapped gate: ~50 m of the line, not the
 * stretch it is on. Its own small source and layer, added the first time a
 * gate is tapped and slotted just above `route-highlight`, so it paints the
 * same way the segment highlight does.
 */
const GATE_HIGHLIGHT_ID = "gate-highlight";

function showGateHighlight(map: maplibregl.Map, line: [number, number][]): void {
  const data: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: line.length >= 2
      ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } }]
      : [],
  };
  const source = map.getSource(GATE_HIGHLIGHT_ID) as maplibregl.GeoJSONSource | undefined;
  if (source) { source.setData(data); return; }
  if (!map.getLayer("route-highlight")) return;
  map.addSource(GATE_HIGHLIGHT_ID, { type: "geojson", data });
  const layers = map.getStyle().layers ?? [];
  const above = layers[layers.findIndex((l) => l.id === "route-highlight") + 1]?.id;
  map.addLayer({
    id: GATE_HIGHLIGHT_ID,
    type: "line",
    source: GATE_HIGHLIGHT_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": HIGHLIGHT_COLOR,
      "line-width": HIGHLIGHT_WIDTH,
      "line-opacity": 0.6,
      "line-blur": 1,
    },
  }, above);
}

function clearGateHighlight(map: maplibregl.Map): void {
  const source = map.getSource(GATE_HIGHLIGHT_ID) as maplibregl.GeoJSONSource | undefined;
  source?.setData({ type: "FeatureCollection", features: [] });
}

/**
 * Every gate on the route, thinned to `GATE_MARKER_MAX`.
 *
 * Thinned by taking every k-th rather than the first thirty: a ride whose gates
 * are all in its last forest would otherwise show none of them. The count the
 * rider reads is the panel's, which is never thinned.
 */
function gateMarksFor(segments: GeoJSON.FeatureCollection<GeoJSON.LineString>): GateOnRide[] {
  // Each with its position along the ride, which the gate card names.
  const all = gatesAlong(segments.features as Parameters<typeof gatesAlong>[0]);
  if (all.length <= GATE_MARKER_MAX) return all;
  const step = Math.ceil(all.length / GATE_MARKER_MAX);
  return all.filter((_, i) => i % step === 0).slice(0, GATE_MARKER_MAX);
}

type Warning = { kind: WarningKind; title: string; detail: string };

/**
 * The warning icons are emoji — the rider's own choice, back after a spell as
 * Lucide SVG.
 *
 * Two glyphs exist in the whole app and no more: ⚠️ for access nobody has
 * verified, 🔥 for a trail. Rough track (grade 4–5) gets NO icon anywhere —
 * it has no badge (`BADGE_KINDS`) and no hover entry, and in the segment card
 * its row is words only. A grade-4 track is the ride, not a hazard, and giving
 * it a third glyph made it look like one.
 *
 * Every surface that shows a warning is built by direct DOM or an HTML string
 * — the badges are MapLibre `Marker` elements, the popups take `setHTML`, and
 * the hover label is written from a mousemove handler that must not trigger a
 * React render. Emoji are plain text, so each is just a character in that
 * string: no rendering to markup, no cache, and none of the server-side
 * `useContext` trouble a module-scope Lucide render used to cause.
 *
 * They carry their own colour, so the colour and fill tables the SVG needed
 * are gone with it.
 */
const WARNING_EMOJI: Partial<Record<WarningKind, string>> = {
  unverified: "⚠️",
  trail: "🔥",
  // `rough` deliberately absent — see above. `warningIcon` renders nothing for
  // a kind with no entry, which keeps every surface icon-free automatically.
};

/**
 * The emoji's footprint, matching the 18 px Lucide glyphs these replaced.
 *
 * A colour emoji draws noticeably wider than its font-size, so 15 px of type
 * in an 18 px box lands on the same visual weight the SVG had (checked on
 * screen) and keeps the badge pill exactly 24 px tall. The box is fixed so the
 * hover label's icon column stays aligned whatever glyph is in it.
 */
const WARNING_ICON_PX = 18;
const WARNING_EMOJI_FONT_PX = 15;

/**
 * The space between one line of a map card and the next.
 *
 * One value, applied as a `gap` on the card's own column rather than as a
 * margin per row — the rider asked for the cards to be "much more compact",
 * and a card built from margins gains a different space wherever a row is
 * dropped. 4 px against the old 6–8 px of margins: at 13 px type the rows
 * still read as separate lines, and a two-line card is 12 px shorter.
 */
const CARD_ROW_GAP_PX = 4;

/**
 * One icon as an HTML string, or "" for a kind that has no icon.
 *
 * Emoji are text, so this is only a sized span — but it still goes through one
 * helper so the badge, the hover label and the card cannot drift apart.
 */
const warningIcon = (kind: WarningKind): string => {
  const emoji = WARNING_EMOJI[kind];
  if (!emoji) return "";
  return (
    `<span aria-hidden="true" style="` +
    `display:inline-flex;align-items:center;justify-content:center;` +
    `width:${WARNING_ICON_PX}px;height:${WARNING_ICON_PX}px;` +
    `font-size:${WARNING_EMOJI_FONT_PX}px;line-height:1;flex:none">${emoji}</span>`
  );
};

/** The icons for a list of warnings, side by side, as one HTML string. */
const iconsHtml = (warnings: Warning[]): string =>
  warnings.map((w) => warningIcon(w.kind)).join("");

/**
 * A badge on the line: a white pill with one icon, the way a phone map marks
 * a hazard. Built as an HTML element rather than a GL symbol layer: in a
 * `text-field` an emoji renders through the style's own glyph stack and comes
 * out as boxes on most basemaps. In ordinary DOM the system font draws it.
 */
function badgeElement(icon: string, title: string, count = 1): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  // A `title` is a desktop hover and does not exist on a phone, which is where
  // the rider actually reads this. The marker carries a popup as well, so the
  // badge is tappable and explains itself.
  el.title = title;
  el.setAttribute("aria-label", title);
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;gap:2px;" +
    // A run can carry more than one warning, and then the badge shows every
    // icon side by side: a pill rather than a circle, widened per icon so two
    // never overflow the dot. Counted by the caller — an emoji is more than
    // one code unit and sits in a wrapper span, so no length of `icon` is a
    // count of glyphs.
    `width:${count > 1 ? 8 + (WARNING_ICON_PX + 4) * count : 24}px;height:24px;` +
    "border-radius:12px;" +
    "background:rgba(255,255,255,0.92);box-shadow:0 1px 2px rgba(0,0,0,0.2);" +
    "line-height:0;cursor:pointer;user-select:none;border:0;padding:0;opacity:0.9;" +
    // Under the start/finish pins, which are the rider's own answers and must
    // never be covered by an annotation about the road.
    "z-index:1";
  // `icon` is our own markup — a sized span per emoji, never anything from a tag.
  el.innerHTML = icon;
  return el;
}

/**
 * Metres a badge must be from the start and finish pins before it is drawn.
 *
 * A run often begins or ends exactly at an endpoint — the first measured case
 * put the warning underneath the Ērgļi pin, where it was invisible. Dropping
 * it loses nothing: the panel already counts those kilometres, and a warning
 * sitting on the finish says nothing the rider can act on while riding.
 */
const BADGE_CLEARANCE_M = 900;

/**
 * Most badges a route may carry, and how far apart they must sit.
 *
 * Measured on a 130 km hard-forest Sigulda loop: 19 markable runs, 10 after
 * 900 m spacing — and on screen those ten covered the route they annotate.
 * The badge is a hint that rough ground is coming, not an index of every
 * stretch of it, so the spacing is now a share of the ride and the count is
 * capped. The panel still reports the full kilometres.
 */
const BADGE_MAX = 5;
const BADGE_MIN_SPACING_SHARE = 0.12;

/**
 * The property that ties a badge to the stretch of road it is talking about.
 *
 * The API has never carried a segment identity — `RouteSegmentProperties` is
 * roadClass / surface / trackGrade / unverified / distanceMeters, and a run is
 * whatever survives `classify.ts`'s flush. Rather than change the response
 * shape (which would leave every saved and shared ride without the link), the
 * map stamps one on as it hands the collection to the source: the index of the
 * feature in the collection, which is stable for as long as that collection is
 * on screen, and that is exactly how long a highlight lives.
 */
const SEGMENT_ID = "segmentId";

/**
 * Set on the features whose geometry runs along the TET — see `tetOverlap`.
 * Read by the TET casing layer's filter.
 */
const ON_TET = "onTet";

type SegmentProps = RouteSegmentProperties & {
  [SEGMENT_ID]?: number;
  [ON_TET]?: boolean;
};

/**
 * Every warning one run carries — the single source of truth for both the
 * badges on the map and the segment card.
 *
 * It returns a LIST, not the first match. A stretch can be several things at
 * once: an unverified path that is also a rough grade-4 track is exactly the
 * kind a rider most wants warned about, and picking one flag hid the other on
 * both surfaces that show them. The order is by how much it should change the
 * riding: access first (it can mean turning back), then how rough.
 */
function warningsFor(
  m: Messages,
  props: SegmentProps
): Warning[] {
  const out: Warning[] = [];
  if (props.unverified) {
    out.push({ kind: "unverified", title: m.badgeUnverified, detail: m.badgeUnverifiedDetail });
  }
  if (props.roadClass === "trail") {
    out.push({ kind: "trail", title: m.badgeTrail, detail: m.badgeTrailDetail });
  }
  // grade4/grade5 is the panel's own definition of a rough track
  // (`roughTrackKm` in classify.ts); the map must agree with the numbers.
  if (props.trackGrade === "grade4" || props.trackGrade === "grade5") {
    out.push({ kind: "rough", title: m.segRough, detail: "" });
  }
  return out;
}

/** Only the warnings in `BADGE_KINDS` get a marker on the line and a hover
 * label; the rest stay in the lists (result panel, segment card) that can
 * afford a row each. */
const badgeWarnings = (warnings: Warning[]): Warning[] =>
  warnings.filter((w) => BADGE_KINDS.includes(w.kind));

type Badge = {
  point: [number, number];
  icon: string;
  /** How many icons `icon` holds, for sizing the pill. */
  iconCount: number;
  /** The badge's tooltip and aria-label. The warnings' explanations are not
   *  held here any more: the segment card shows them (see `segmentInfoHtml`),
   *  and the badge no longer has a popup of its own. */
  title: string;
  /**
   * Every run this badge speaks for. A badge survives the spacing cap on
   * behalf of the runs it crowded out, so highlighting only its own feature
   * would light up one of several identical stretches; the disjoint ones are
   * all carried here and all highlighted together.
   */
  segmentIds: number[];
};

/**
 * Where the badges go: the midpoint of every run worth marking.
 *
 * One per run, not one per kilometre — a route with 27 km of track has seven
 * runs, and seven badges annotate it while seventy would bury it. A run that
 * is both a trail and unverified gets the warning: "check the signs" is the
 * more actionable of the two.
 */
function badgesFor(
  segments: GeoJSON.FeatureCollection,
  locale: UiLocale,
  avoid: [number, number][] = []
): Badge[] {
  const m = messages(locale);
  const out: Badge[] = [];
  /** The badge each flag combination is currently collecting runs into. */
  const byKind = new Map<string, Badge>();

  // Spacing scales with the ride: 12 % of a 60 km loop is 7 km, of a 300 km
  // day 36 km. A fixed metre figure gave a short ride too few badges and a
  // long one a wall of them.
  let routeMeters = 0;
  for (const f of segments.features) {
    const meters = (f.properties as { distanceMeters?: number } | null)?.distanceMeters;
    if (typeof meters === "number") routeMeters += meters;
  }
  const spacing = Math.max(BADGE_CLEARANCE_M, routeMeters * BADGE_MIN_SPACING_SHARE);

  const tooClose = (p: [number, number]) =>
    avoid.some((a) => haversineMeters(p, a) < BADGE_CLEARANCE_M) ||
    // Two badges on top of each other are one unreadable badge.
    out.some((b) => haversineMeters(p, b.point) < spacing);

  // Longest runs first, so the badges that survive the cap mark the stretches
  // that actually matter rather than whichever came first along the line.
  const ordered = [...segments.features].sort(
    (a, b) =>
      (((b.properties as { distanceMeters?: number } | null)?.distanceMeters) ?? 0) -
      (((a.properties as { distanceMeters?: number } | null)?.distanceMeters) ?? 0)
  );

  for (const f of ordered) {
    if (f.geometry.type !== "LineString") continue;
    const props = (f.properties ?? {}) as SegmentProps;
    // Only the kinds that earn a marker — a rough track is reported in the
    // panel and in the segment card, but it does not put a badge on the line.
    const warnings = badgeWarnings(warningsFor(m, props));
    if (!warnings.length) continue;

    const coords = f.geometry.coordinates as [number, number][];
    if (coords.length === 0) continue;
    const id = props[SEGMENT_ID];
    // A run is grouped by its whole set of flags, not by the first one that
    // matched. A stretch that is both unverified AND a rough track is its own
    // kind: it shows both icons, and it is never folded into the plain
    // "unverified" badge, which would have hidden the second warning.
    const kind = warnings.map((w) => w.kind).join("+");
    const mid = coords[Math.floor(coords.length / 2)];

    const owner = byKind.get(kind);
    // Past the cap, or crowded: the run still gets a voice through the badge
    // of its own exact kind, so clicking that badge lights up every stretch it
    // stands for rather than one arbitrary member of the group. A kind that
    // has no badge yet is placed anyway — every warning the panel counts has
    // to be findable on the map, which is what the cap used to break.
    if (owner && (out.length >= BADGE_MAX || tooClose(mid))) {
      if (typeof id === "number") owner.segmentIds.push(id);
      continue;
    }
    // Only the pins are an absolute veto: a badge under the start marker is
    // invisible, and the panel still counts those kilometres.
    if (!owner && avoid.some((a) => haversineMeters(mid, a) < BADGE_CLEARANCE_M)) continue;

    const badge: Badge = {
      point: mid,
      segmentIds: typeof id === "number" ? [id] : [],
      icon: iconsHtml(warnings),
      // Icons actually drawn, not warnings held: a kind with no emoji (rough)
      // renders nothing, and counting it would widen the pill around a gap.
      iconCount: warnings.filter((w) => warningIcon(w.kind)).length,
      title: warnings.map((w) => w.title).join(" · "),
    };
    out.push(badge);
    byKind.set(kind, badge);
  }
  return out;
}

/**
 * Which of the route's runs lie along the TET.
 *
 * The server already measures TET coverage, but only as a total — one
 * `{ sectionName, sliceKm }` for the whole ride, computed in
 * `lib/routing/tet-coverage.ts` against the router's fine 12 m reference and
 * never carried per segment. Rather than change the API response (which every
 * saved and shared ride predates), the map matches against the overlay it has
 * already downloaded for the purple line — which has the added virtue that the
 * casing agrees with the TET the rider can actually see.
 *
 * Same rules as the server matcher, at a tolerance that absorbs the overlay's
 * coarser simplification: direction has to agree, and a run has to be
 * sustained before it counts, so a route merely crossing the TET is not
 * decorated as riding it.
 */
const TET_MATCH_M = 60;
const TET_CELL_M = 300;
/** Cosine of the angle between the two lines: ~37°, as the server uses. */
const TET_ALIGN = 0.8;
/** A feature counts as TET once this share of its samples matched. */
const TET_MIN_SHARE = 0.6;

function tetOverlap(
  features: GeoJSON.Feature<GeoJSON.LineString>[],
  tet: GeoJSON.Feature[]
): Set<number> {
  const onTet = new Set<number>();
  if (!features.length || !tet.length) return onTet;

  const lat0 = features[0].geometry.coordinates[0]?.[1] ?? 57;
  const kx = 111195 * Math.cos((lat0 * Math.PI) / 180);
  const project = (p: number[]): [number, number] => [p[0] * kx, p[1] * 111195];

  // A grid over the TET lines, so each sample tests a handful of candidate
  // segments instead of all 6,759 points of a country.
  const grid = new Map<string, [[number, number], [number, number]][]>();
  for (const f of tet) {
    if (f.geometry.type !== "LineString") continue;
    const cs = f.geometry.coordinates;
    for (let i = 1; i < cs.length; i++) {
      const a = project(cs[i - 1]), b = project(cs[i]);
      const seg: [[number, number], [number, number]] = [a, b];
      const x0 = Math.floor((Math.min(a[0], b[0]) - TET_MATCH_M) / TET_CELL_M);
      const x1 = Math.floor((Math.max(a[0], b[0]) + TET_MATCH_M) / TET_CELL_M);
      const y0 = Math.floor((Math.min(a[1], b[1]) - TET_MATCH_M) / TET_CELL_M);
      const y1 = Math.floor((Math.max(a[1], b[1]) + TET_MATCH_M) / TET_CELL_M);
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = `${x},${y}`;
          const bucket = grid.get(key);
          if (bucket) bucket.push(seg); else grid.set(key, [seg]);
        }
      }
    }
  }

  for (const f of features) {
    const id = (f.properties as SegmentProps | null)?.[SEGMENT_ID];
    if (typeof id !== "number") continue;
    const cs = f.geometry.coordinates;
    let samples = 0, hits = 0;
    for (let i = 1; i < cs.length; i++) {
      const a = project(cs[i - 1]), b = project(cs[i]);
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      samples++;
      const p: [number, number] = [a[0] + dx * 0.5, a[1] + dy * 0.5];
      const nearby = grid.get(`${Math.floor(p[0] / TET_CELL_M)},${Math.floor(p[1] / TET_CELL_M)}`);
      if (!nearby) continue;
      for (const [sa, sb] of nearby) {
        const ux = sb[0] - sa[0], uy = sb[1] - sa[1];
        const norm = Math.hypot(ux, uy);
        if (!norm || Math.abs(dx * ux + dy * uy) / (length * norm) < TET_ALIGN) continue;
        const u = Math.max(0, Math.min(1,
          ((p[0] - sa[0]) * ux + (p[1] - sa[1]) * uy) / (norm * norm)));
        if (Math.hypot(p[0] - sa[0] - u * ux, p[1] - sa[1] - u * uy) <= TET_MATCH_M) {
          hits++;
          break;
        }
      }
    }
    if (samples && hits / samples >= TET_MIN_SHARE) onTet.add(id);
  }
  return onTet;
}

/** The dictionary, as `messages()` hands it over. `Messages` is internal to
 * the i18n module, so it is read back off the function rather than exported —
 * the labels below need the whole bag, not one key at a time. */
type Messages = ReturnType<typeof messages>;

/** The route layers a pointer can interact with. Queried by name so the TET
 * overlay, the glow and the casings never answer for the line itself. */
const CLICKABLE_LAYERS = ["route-road", "route-track", "route-trail"] as const;

/**
 * How far from the line a tap still counts, in pixels.
 *
 * On a phone this is the only way to inspect a segment, and a 5 px line under
 * a fingertip is not a target. `queryRenderedFeatures` takes a box, so the
 * click is tested as a square around the point rather than at it.
 */
const TAP_SLOP_PX = 8;

/** The four surface buckets, as the map colours them and the panel counts them. */
type SurfaceBucket = "asphalt" | "gravel" | "dirt" | "unknown";

/**
 * Which colour bucket a stretch falls in — the one place that answers it.
 *
 * Kept identical to `classifyRoute`'s split for the SEGUMS percentages and to
 * `SURFACE_COLOR_EXPR`'s `match`: three rules over the same seven values, and
 * a rider who is told "30 % grants" should see exactly those stretches orange.
 */
const surfaceBucket = (surface?: string): SurfaceBucket =>
  surface === "asphalt" ? "asphalt"
  : surface === "gravel" || surface === "compacted" ? "gravel"
  : surface === "ground" || surface === "dirt" || surface === "sand" ? "dirt"
  : "unknown";

/**
 * The surface on its own, in the rider's language: the SEGUMS row's words, and
 * the whole heading for a plain road. An untagged way says "unknown" rather
 * than guessing — that is a fact worth showing, and the map greys it to match.
 */
const surfaceLabel = (m: Messages, surface?: string): string => {
  const bucket = surfaceBucket(surface);
  return bucket === "asphalt" ? m.legendAsphalt
    : bucket === "gravel" ? m.legendGravel
    : bucket === "dirt" ? m.resDirt
    : m.resUnknown;
};

/**
 * The card's heading: the two things the line is drawn from, in words —
 * surface + road class, "Grants meža ceļš", "Asfaltēta taciņa".
 *
 * It used to name the class alone (with asphalt as a special case that
 * overrode it), which could not describe a paved track at all: the map drew a
 * blue dashed line and the card said flatly "Asfalts". Now both dimensions are
 * always named, so the heading reads as the legend's two rows combined.
 *
 * A plain road is the one case with no compound: "Asfalts" or "Grants" on its
 * own. Naming the class as well ("asphalt road") states the default and makes
 * the interesting cases harder to spot.
 *
 * The compound is assembled through `fi` from a per-locale `{surface} {class}`
 * template rather than by joining words here, because the order and the
 * modifier's form are the translator's business: Latvian and Lithuanian
 * inflect the surface for the class noun's gender, which is why the surface
 * keys come in masculine and feminine forms.
 */
const segmentHeading = (m: Messages, roadClass?: string, surface?: string): string => {
  const bucket = surfaceBucket(surface);
  const plain = surfaceLabel(m, surface);
  if (roadClass !== "track" && roadClass !== "trail") return plain;

  const feminine = roadClass === "trail";
  const cls = feminine ? m.segClassTrail : m.segClassTrack;
  const mod =
    bucket === "asphalt" ? (feminine ? m.segSurfaceAsphaltF : m.segSurfaceAsphaltM)
    : bucket === "gravel" ? m.segSurfaceGravel
    : bucket === "dirt" ? (feminine ? m.segSurfaceDirtF : m.segSurfaceDirtM)
    : m.segSurfaceUnknown;
  return fi(m.segCompound, { surface: mod, class: cls });
};

/**
 * `tracktype` in words, or nothing.
 *
 * OSM's five grades describe how much of the surface is bound: grade1 solid,
 * grade2 mostly solid, grade3 an even mix, grade4 mostly soft, grade5
 * unimproved earth or grass. A rider needs two of those distinctions and not
 * five — a normal track, one that alternates, and one that is mostly soft —
 * so the scale collapses to three buckets and the raw "grade2" is never
 * shown. It said nothing to the rider it was written for, which is what
 * started this rework.
 */
type GradeBucket = "normal" | "mixed" | "rough";

const gradeBucket = (trackGrade?: string): GradeBucket =>
  trackGrade === "grade4" || trackGrade === "grade5" ? "rough"
  : trackGrade === "grade3" ? "mixed"
  : "normal";

/**
 * A distance in the rider's own notation: "5,7 km" in lv/lt/et, "5.7 km" in
 * English.
 *
 * `toLocaleString` with the UI locale rather than a hand-rolled comma swap —
 * the locale is already the browser's own tag, and one decimal is what the
 * panel shows for a figure this size (`Math.round(m / 100) / 10`), kept here
 * as the same arithmetic so the card and the panel cannot disagree by a
 * rounding step. `minimumFractionDigits` is not set: a round 6 km reads "6",
 * not "6,0".
 */
const kmLabel = (locale: UiLocale, meters: number): string =>
  (Math.round(meters / 100) / 10).toLocaleString(locale, { maximumFractionDigits: 1 });

/**
 * The whole first line of the segment card: what the stretch is, and how long.
 *
 * The rider's correction, with his own screenshot in hand: the card said
 * "Grants meža ceļš", then repeated the surface in a SEGUMS row, then offered
 * "grade2" under GRŪTĪBA. Three rows for one fact and one of them unreadable.
 * Now the compound and the distance are one headline and the rows are gone —
 * an asphalt stretch with no warnings is a single line, "Asfalts · 2,5 km".
 *
 * Roughness is folded in rather than listed: grade4–5 makes it "Grūts grants
 * meža ceļš", which is the panel's own wording for `roughTrackKm`, and the
 * adjective agrees with the class noun the same way the surface modifier
 * does. grade1–2 change nothing — a track that rides like a track needs no
 * adjective — and grade3 gets a second line instead, because "jaukts segums"
 * qualifies the stretch rather than renaming it.
 */
const segmentHeadline = (
  m: Messages,
  locale: UiLocale,
  props: SegmentProps,
  meters: number
): string => {
  const name = segmentHeading(m, props.roadClass, props.surface);
  const rough = gradeBucket(props.trackGrade) === "rough";
  // Only a named class can take the adjective: "Grūts asfalts" is not a thing
  // a rider would say, and a plain road never carries a tracktype anyway.
  const named = props.roadClass === "track" || props.roadClass === "trail";
  const full = rough && named
    ? `${props.roadClass === "trail" ? m.segRoughAdjF : m.segRoughAdjM} ${name.charAt(0).toLowerCase()}${name.slice(1)}`
    : name;
  return fi(m.segHeadline, { name: full, km: kmLabel(locale, meters) });
};

/** Metres along a line, for the length of a run the API did not measure. */
function lineMeters(coordinates: number[][]): number {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineMeters(
      coordinates[i - 1] as [number, number],
      coordinates[i] as [number, number]
    );
  }
  return total;
}

/** Escape the few characters that would let a tag value break out of the HTML. */
const esc = (value: string): string =>
  value.replace(/[&<>"]/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;");

/**
 * What one stretch of road is, as a small card.
 *
 * The rider asked to be able to tap a segment and see its facts; then, with
 * the card in front of him, he asked for it to stop saying the same fact
 * three times. It used to head itself with the compound and then list
 * Distance, Segums (the compound's own first word again) and Grūtība with the
 * raw OSM "grade2" in it. Now the first line carries the compound *and* the
 * distance, roughness is in the words of that line rather than in a row, and
 * everything below it is something the line does not already say: the
 * warnings, the gates, the TET.
 *
 * So an ordinary asphalt stretch is one line and a rough unverified trail is
 * four — the card is as long as the stretch is interesting, which is what a
 * rider tapping a line wants to find out.
 */
function segmentInfoHtml(
  m: Messages,
  locale: UiLocale,
  props: SegmentProps,
  meters: number,
  gates: GateOnRide[] = [],
): string {
  const grade = gradeBucket(props.trackGrade);

  // The same list the badges are built from, minus `rough`: the headline
  // already says "Grūts …" for grade4–5, and a row repeating it is exactly
  // the duplication this card was rebuilt to remove. `warningsFor` keeps the
  // entry because the hover label and the result panel still list it.
  //
  // The icon markup is ours; only the words that come from a tag or a
  // translation are escaped.
  //
  // This card is the ONLY thing a badge opens, so it also carries the
  // explanation the badge's own popup used to show. A warning with a detail
  // paragraph becomes a `<details>`: one line by default, the full text on
  // tap. `<details>` rather than a click handler because the popup's HTML is
  // set as a string and has no React or listeners of its own.
  const flags = warningsFor(m, props)
    .filter((w) => w.kind !== "rough")
    .map((w) => {
      const icon = warningIcon(w.kind);
      const head = `${icon || `<span style="display:inline-block;width:${WARNING_ICON_PX}px;flex:none"></span>`}<span>${esc(w.title)}</span>`;
      if (!w.detail) return `<div style="display:flex;align-items:center;gap:6px">${head}</div>`;
      return (
        `<details class="mopik-warn" style="margin:0">` +
        `<summary style="display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none">` +
        `${head}</summary>` +
        `<div style="margin:2px 0 0 24px;color:#6b7280">${esc(w.detail)}</div>` +
        `</details>`
      );
    });
  // Gates: a row of its own rather than a `warningsFor` entry, because it is
  // not a warning about the stretch — it is a count of points on it, and the
  // line says what that means for the riding, which the panel's bare number
  // cannot. Above the TET row and below the warnings: access first, then what
  // is on the road, then what the road is.
  // One row per gate, named by its kind and its kilometre („Vārti 37,2 km”),
  // rather than "this stretch has N gates". The count is the fallback for a
  // caller that could not place them.
  const gateCount = props.gates ?? 0;
  const gateRows: [string, GateGlyph][] = gates.length
    ? gates.map((g) => [gateAtLabel(m, locale, g), gateGlyphFor(g.info?.barrier)])
    : gateCount > 0 ? [[fi(m.segGates, { n: gateCount }), "field"]] : [];
  for (const [row, glyph] of gateRows) {
    flags.push(
      `<div style="display:flex;align-items:center;gap:6px">` +
      `<span aria-hidden="true" style="display:inline-flex;align-items:center;` +
      `justify-content:center;width:${WARNING_ICON_PX}px;flex:none">${gateIconSvg(glyph, GATE_GLYPH_PX)}</span>` +
      `<span>${esc(row)}</span></div>`
    );
  }

  if (props[ON_TET]) {
    flags.push(
      `<div style="display:flex;align-items:center;gap:6px">` +
      `<span>${TET_LEGEND_ICON}</span><span>${esc(m.segOnTet)}</span></div>`
    );
  }

  return (
    `<div style="font-size:13px;line-height:1.4;min-width:150px;` +
    `display:flex;flex-direction:column;gap:${CARD_ROW_GAP_PX}px">` +
    // Safari keeps its own disclosure triangle on a `<summary>` unless the
    // `-webkit-details-marker` pseudo-element is hidden, and a pseudo-element
    // cannot be set from an inline style. The rider is on an iPhone, so the
    // rule ships with the card rather than in the global sheet, where a popup
    // this file builds as a string would be the only thing using it.
    `<style>.mopik-warn>summary::-webkit-details-marker{display:none}</style>` +
    `<strong style="display:block;padding-right:24px;font-size:15px;font-weight:600">` +
    `${esc(segmentHeadline(m, locale, props, meters))}</strong>` +
    // grade3 only: "an even mix of hard and soft" is not a name for the
    // stretch, so it sits under the headline instead of inside it.
    (grade === "mixed"
      ? `<div style="color:#6b7280">${esc(m.segGradeMixed)}</div>`
      : "") +
    // One muted sentence saying what the grade means on the ground — kept for
    // grade3–5, where the rider has something to decide, and absent for a
    // normal track, where it would only be noise.
    (grade !== "normal"
      ? `<div style="color:#9ca3af;font-size:12px">` +
        `${esc(grade === "rough" ? m.segGradeWhyRough : m.segGradeWhyMixed)}</div>`
      : "") +
    (flags.length
      ? `<div style="margin-top:2px;padding-top:6px;border-top:1px solid #ececf0;` +
        `display:flex;flex-direction:column;gap:${CARD_ROW_GAP_PX}px">` +
        // Each row already carries its own wrapper (a plain div, or a
        // `<details>` when the warning has an explanation to expand).
        flags.join("") +
        `</div>`
      : "") +
    `</div>`
  );
}

/**
 * The mark a stop gets on the map.
 *
 * A stop is the rider's own answer — a place they chose, or one the loop was
 * planned through — so it is drawn the way the warning badges are (a white
 * pill, the system font's own emoji) rather than as another coloured dot. The
 * plain orange dots it replaces said nothing: two identical circles on a line,
 * with a `label` in a bare popup and no indication they were even the same
 * kind of thing as the start pin.
 *
 * 🅿️ rather than a flag or a pin: it reads as "stop here" at 18 px on a phone
 * and is not already spoken for by the start and finish markers.
 */
/**
 * Measured, and the reason the legend has no stop entry: at 390 px the pattern
 * row (solid / raustītā / punktotā / TET) is exactly one line, 12 px high, and
 * a "Pieturvieta" entry wraps the row to two lines, 30 px. The legend is
 * already a third of a phone map's height and covers the route it explains, so
 * the entry is deliberately skipped. The marker explains itself by being
 * tappable: the card it opens names the place and says "Pieturvieta" in the
 * rider's own language, which the legend could only repeat. Re-measure before
 * adding it — the probe is four lines of DOM in the console.
 */

/**
 * A typed stop is a **numbered pin**, not a glyph.
 *
 * It was 🅿️, chosen for legibility at 18 px on a phone, and the rider read it
 * as exactly what it means everywhere else: parking. Worse, every stop looked
 * identical — three 🅿️ pills on a line say "three stops somewhere" and leave
 * the rider matching them to his form by guessing which is which. A number
 * says *which* stop, and no glyph can: the whole content here is ordinal, and
 * a picture has no ordinals.
 *
 * The number is the stop's position in the ride the rider sees in the form —
 * 1, 2, 3 in via order — so the map and the form can be read against each
 * other. It is derived from the `via` array's own order on every rebuild, not
 * stored on the marker, which is what makes removing or moving a stop
 * renumber the rest for free.
 *
 * A solid pin rather than the white pill the glyph needed: a digit has to
 * carry at a glance against forest, water and the route's own orange, and
 * white bold on the brand orange is the highest-contrast pair already in the
 * map's vocabulary. 22 px with a 13 px digit — measured legible at phone width
 * in the verification screenshots, and the same footprint the sight pills use,
 * so a line of mixed markers still reads as one row of things.
 *
 * The start and the finish keep their own pins, and a sight keeps its kind's
 * glyph: numbering those would claim an order the ride does not have. Only
 * places the rider asked to ride *through* are numbered, and only they count
 * toward the number — see the map over `via`.
 */
const STOP_ICON = "🅿️";

/**
 * A stop's pill on the map. Wider and a touch taller than a warning badge
 * because its emoji is the point rather than an annotation, and z-indexed
 * above them: a hazard on the road under a stop should not hide the stop.
 */
function stopElement(title: string, icon: string = STOP_ICON, ringed = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    "width:28px;height:28px;border-radius:14px;" +
    "background:rgba(255,255,255,0.95);" +
    // A sight wears the brand ring, a typed stop the plain shadow: the two are
    // different claims — "something worth looking at, found for you" against
    // "a place you asked the ride to pass" — and the glyph alone was not
    // enough to tell them apart at 28 px among a dozen markers.
    (ringed
      ? "border:2px solid #f56300;box-shadow:0 1px 3px rgba(0,0,0,0.28),0 0 0 3px rgba(245,99,0,0.18);"
      : "box-shadow:0 1px 3px rgba(0,0,0,0.28);border:0;") +
    "line-height:0;cursor:pointer;user-select:none;padding:0;" +
    // Above the warning badges, below nothing: a stop is a place the rider
    // asked for and must never be covered by a note about the road.
    "z-index:2";
  el.innerHTML =
    `<span style="font-size:18px;line-height:1;display:inline-block">${icon}</span>`;
  return el;
}

/**
 * A typed stop: a solid orange pin carrying its number in the ride.
 *
 * See the block over `STOP_ICON` for why a number and not a glyph. The shape
 * is deliberately not `stopElement`'s white pill — that pill is the "something
 * to look at" vocabulary the sights own, and a stop the rider *asked for* is a
 * different claim. Solid brand orange with a white bold digit is the strongest
 * contrast pair the map already uses, and it matches the ✓ the form shows on a
 * confirmed row.
 *
 * 22 px, digit 13 px: the same footprint as the sight pills, so a line of
 * mixed markers reads as one row rather than as two sizes of thing. Above the
 * warning badges for the reason `stopElement` is — a note about the road must
 * never cover a place the rider chose.
 *
 * `n` is passed in rather than counted here: the caller knows the ride order,
 * and a counter living in the element would survive a rebuild and drift.
 */
/**
 * The word under one of the ride's two end pins — "Starts" or "Finišs".
 *
 * The rider's own correction. The finish was a plain red pin and the start a
 * plain green one — the same shape twice, distinguished by a colour pair that
 * says "stop / go" to a driver and nothing at all about *ends of a ride*. On a
 * round trip the two sit on the same spot, and on a phone, against a green
 * basemap, "which of these is where I start" was a question the map made the
 * rider answer from context.
 *
 * ## Why this is a marker of its own, and not part of the pin
 *
 * The first version redrew the whole pin as a DOM element — a disc with a
 * rotated square beneath it — so the label could sit inside the same flex
 * column. **The rider saw it on the dev server and reported it broken:** the
 * green teardrop came out clipped, tip pointing up into a blob, with a pale
 * halo around it. Rebuilding MapLibre's pin by hand means reproducing its SVG,
 * its anchor, its shadow and its transform exactly, and anything that wraps
 * the pin in a new box can shift or crop it.
 *
 * So the pin is MapLibre's own again, untouched, with its own colour and its
 * own `anchor`/transform — exactly what shipped before, and what production
 * draws. The label is a **second marker at the same coordinate**, whose
 * element is a zero-sized box with the pill absolutely positioned below it. It
 * cannot change the pin's geometry because it is not in the pin's box at all.
 *
 * The finish's flag rides on its own marker too, for the same reason: it is
 * drawn over MapLibre's pin rather than inside a hand-made one.
 */
function endpointLabelElement(params: { title: string; label: string }): HTMLElement {
  const el = document.createElement("div");
  el.title = params.title;
  el.setAttribute("aria-label", `${params.label}: ${params.title}`);
  // A box of its own, sized to nothing: it is anchored at the pin's tip (the
  // coordinate) and the pill hangs below that point, absolutely positioned, so
  // it has no influence on any other marker's box. `pointer-events:none` keeps
  // it from swallowing a click meant for the map or the pin.
  el.style.cssText = "position:relative;width:0;height:0;pointer-events:none;z-index:3";
  el.innerHTML =
    `<span style="position:absolute;top:3px;left:50%;transform:translateX(-50%);` +
    `background:rgba(255,255,255,0.95);border-radius:7px;` +
    `padding:1px 5px;font-size:10px;font-weight:700;line-height:1.4;` +
    `color:#1c1917;box-shadow:0 1px 2px rgba(0,0,0,0.2);white-space:nowrap;` +
    `font-family:inherit">${esc(params.label)}</span>`;
  return el;
}

/**
 * The finish pin is **plain red**, and the ends are told apart by their words.
 *
 * The chequered flag is reversed. It went flag-inside-a-red-pin → a whole
 * teardrop painted in black-and-white chequers → back to plain red, and the
 * rider's last word is the one that stands. The reasoning that survives the
 * reversal is worth keeping, because it is what the colours now rest on:
 *
 * - A flag *inside* the pin was "useless at that size" — at 13 px in a 27 px
 *   head the pole and pennant are three or four pixels each and turn to mush
 *   on a green basemap. So there is no glyph in either pin, and there should
 *   not be one: whatever distinguishes the ends has to survive 27 px.
 * - The chequers survived the size, but they cost the pair its symmetry. A
 *   patterned pin beside a flat green one reads as two different *kinds* of
 *   thing, when they are the same kind of thing at opposite ends of one ride.
 *
 * What actually answers "which of these is where I start" is the word under
 * the pin — `endpointLabelElement`, in the rider's own language — and once
 * the words are there the colour only has to separate the two at a glance.
 * Red against green does that, it is MapLibre's own pin at both ends, and it
 * is what production draws today.
 *
 * So there is no `finishPinElement`: the finish is `new maplibregl.Marker({
 * color: FINISH_PIN_COLOR })`, the start the same with green. Nothing is
 * hand-drawn, which is also the surest way to keep the clipped, haloed
 * teardrop the rider reported from coming back — see `endpointLabelElement`
 * for that history.
 */
const FINISH_PIN_COLOR = "#dc2626";
/** The start, for the same reason and in the same place. */
const START_PIN_COLOR = "#16a34a";

function numberedStopElement(title: string, n: number): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    "width:22px;height:22px;border-radius:11px;" +
    "background:#f56300;color:#fff;" +
    // A white hairline between the orange pin and whatever is under it: on the
    // route's own gravel orange the two hues are close enough that the pin's
    // edge disappears, and a disc with no edge reads as a smudge.
    "border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.32);" +
    "font-weight:700;font-size:13px;line-height:1;" +
    // The map's own font stack, so the digit is the interface's digit rather
    // than whatever the canvas inherits.
    "font-family:inherit;font-variant-numeric:tabular-nums;" +
    "cursor:pointer;user-select:none;padding:0;" +
    "z-index:2";
  // A number, so nothing here can carry markup — but it goes through the same
  // escape the cards use rather than trusting that forever.
  el.textContent = String(n);
  return el;
}

/**
 * A shaping point: a small white dot with a dark edge, no number — "the line
 * goes through here", not a place (rider, 2026-09-25). The element is a 24 px
 * button so a thumb can take it; the dot is the 12 px inside it. `pending`
 * draws the edge dashed, the look every not-yet-confirmed mark has here.
 */
function shapeDotElement(title: string, pending = false): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.dataset.shape = pending ? "pending" : "1";
  el.style.cssText = `display:flex;align-items:center;justify-content:center;width:24px;height:24px;padding:0;border:0;background:transparent;cursor:${pending ? "grab" : "pointer"};z-index:2`;
  const dot = document.createElement("span");
  dot.style.cssText = `display:block;width:12px;height:12px;border-radius:6px;background:#fff;border:2.5px ${pending ? "dashed" : "solid"} #1c1917;box-shadow:0 1px 3px rgba(0,0,0,0.35);box-sizing:content-box`;
  el.appendChild(dot);
  return el;
}

/**
 * The ring under a finger that holds the route line (see lib/map/line-drag.ts):
 * "the line is yours now — drag it". Not a point yet; it goes when the finger
 * lifts or the drag makes the point.
 */
function lineHoldElement(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.dataset.lineHold = "1";
  el.style.cssText = "width:36px;height:36px;border-radius:50%;pointer-events:none;border:3px solid #f56300;background:rgba(245,99,0,0.2);box-shadow:0 0 0 4px rgba(255,255,255,0.85)";
  return el;
}

/**
 * The steady ring around the point the rider has tapped (see the selection
 * effect): 52 px, a 4 px orange edge on a white halo, under the pin. A slow
 * outer pulse on top unless the rider asked for reduced motion — the ring
 * itself never moves, so the selection is readable either way.
 */
function selectionRingElement(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.dataset.selectionRing = "1";
  el.style.cssText = "width:52px;height:52px;border-radius:50%;pointer-events:none;z-index:1;border:4px solid #f56300;background:rgba(245,99,0,0.16)";
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.style.animation = "mopik-focus-pulse 1.6s ease-out infinite";
  }
  return el;
}

/**
 * A sight the ride passes or runs near, drawn without the rider asking.
 *
 * The rider's distinction, in his own words: "on your way" must read
 * differently from "you chose this". A chosen place (`via`, `selectedPois`)
 * wears the brand ring on a 28 px pill; these wear none. Within them the two
 * groups are ranked again, because the map must not imply the ride visits a
 * place it merely passes within a kilometre of:
 *
 * - `onRoute` — a 22 px white pill with a stone border and the kind's glyph at
 *   14 px. Lighter than a chosen sight, still plainly a place.
 * - `nearby` — the *same* 22 px pill and the same 14 px glyph, separated only
 *   by a lighter border and 85 % opacity.
 *
 * The nearby group used to be a 16 px muted dot with a 10 px glyph, and the
 * rider's verdict from the live site was that it "cannot be noticed on the map
 * at all — only at close zoom, and even then the icon is tiny". So size is no
 * longer the axis that separates the two groups: a suggestion the rider cannot
 * see is not an offer. Rank now reads only from weight — #e7e5e4 against
 * #d6d3d1, 0.85 against 1 — and the loudness the old design was spending on
 * restraint is spent instead on the switch, which is exactly what the rider
 * said the toggle is for: "that is why we have the toggle that can switch
 * these POIs off".
 *
 * Both sit at z-index 0 — the rider asked for them below the warning badges
 * (1), because a hazard on the road outranks a sight beside it.
 */
function sightElement(title: string, icon: string, group: "onRoute" | "nearby"): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  const onRoute = group === "onRoute";
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    "width:22px;height:22px;border-radius:11px;" +
    (onRoute
      ? "background:rgba(255,255,255,0.95);border:1px solid #d6d3d1;" +
        "box-shadow:0 1px 2px rgba(0,0,0,0.16);z-index:0;"
      : // Same pill, one step lighter: enough to rank them when the two sit
        // side by side, not enough to make one of them disappear.
        "background:rgba(255,255,255,0.95);border:1px solid #e7e5e4;" +
        "box-shadow:0 1px 2px rgba(0,0,0,0.12);opacity:0.85;z-index:0;") +
    "line-height:0;cursor:pointer;user-select:none;padding:0";
  el.innerHTML =
    `<span aria-hidden="true" style="display:inline-flex;align-items:center;` +
    `justify-content:center;font-size:14px;line-height:1">${icon}</span>`;
  return el;
}

/**
 * Below this zoom the nearby group is not drawn at all.
 *
 * Was z10, which is what the rider was complaining about: a 100 km ride frames
 * at roughly z9–10, so the suggestions were absent or half-absent exactly at
 * the zoom he looks at the ride from. At z8 a ride of any length a rider
 * actually plans is on screen, so this is effectively "always at ride scale";
 * the crowding that z10 was guarding against is handled by the collision rule
 * below instead, which drops pills rather than shrinking them.
 */
const SIGHT_NEARBY_MIN_ZOOM = 8;

/**
 * How close, in screen pixels, two sight pills may sit before the nearby one
 * is skipped.
 *
 * A pill is 22 px, so 18 px of centre-to-centre distance still leaves the two
 * overlapping slightly — deliberately: forbidding all overlap at low zoom
 * thins the suggestions far more than the map needs, and a pill half-tucked
 * behind another still reads as two places. Below this they merge into one
 * blob and the lower one is simply lost, which is worse than not drawing it.
 */
const SIGHT_COLLIDE_PX = 18;

/**
 * The glyph inside the sights switch's swatch.
 *
 * The viewpoint's own camera from `POI_KIND`, because a switch that governs
 * thirteen kinds cannot show all of them and the camera is the one a rider
 * reads as "something to look at" rather than as a specific kind of thing. It
 * is a bare symbol, not text, so it needs no dictionary entry.
 */
const SIGHTS_SWATCH_ICON = POI_KIND.viewpoint.icon;

/**
 * The ring that marks a place the rider is only *looking at*.
 *
 * Not a 🅿️: that pill means "this is a stop of your ride", and a suggestion
 * pressed from Ieteikumi is not one yet — showing it as a stop would say the
 * ride had changed when it had not. A pulsing orange ring instead, in the
 * brand colour so it reads as the app pointing at something, and with the
 * animation defined inline because the map's markers live outside React and
 * outside Tailwind's tree.
 *
 * `pointer-events:none`: the ring must not swallow the map click that is the
 * documented way of dismissing it.
 */
function focusElement(): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "width:28px;height:28px;border-radius:50%;pointer-events:none;" +
    "border:2px solid #f56300;background:rgba(245,99,0,0.18);" +
    "box-shadow:0 0 0 4px rgba(245,99,0,0.18);";
  // The ring stays, the pulse goes: the marker is the answer to a press and
  // has to be visible either way, but the repeat is what a rider who asked for
  // reduced motion is asking not to have. The global stylesheet's
  // `prefers-reduced-motion` block cannot reach an inline `animation`, so the
  // choice is made here instead.
  if (!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    el.style.animation = "mopik-focus-pulse 1.6s ease-out infinite";
  }
  return el;
}

/**
 * The card a stop's marker opens: its name, what kind of place it is, and
 * whatever the POI dataset knows about it.
 *
 * Deliberately the same mechanism as the segment card — a MapLibre popup with
 * `setHTML` — so the two never stack and a rider meets one card style on the
 * map. Every value that came from a tag or a translation is escaped; the
 * markup around it is ours.
 */
function stopInfoHtml(m: Messages, stop: { label: string; kind?: string; detail?: string; category?: string }): string {
  // "Apskates objekts" for a place that came from the suggestions,
  // "Pieturvieta" for one the rider typed into the form. The rider's own
  // correction: a sight is not a stop, and calling both by the stop's word
  // made the list of what the ride passes read as a list of errands.
  const what = stop.category ? m.resSight : m.mapStop;
  // The kind goes on a muted line of its own rather than in a labelled row.
  // "Apskates objekts   pilsdrupas" was a label and a value that say the same
  // kind of thing twice; "Apskates objekts · pilsdrupas" is one line, and the
  // segment card's compaction would otherwise stop at the segment card.
  const line = stop.kind ? `${what} · ${stop.kind}` : what;
  return (
    `<div style="font-size:13px;line-height:1.4;min-width:150px;` +
    `display:flex;flex-direction:column;gap:${CARD_ROW_GAP_PX}px">` +
    `<strong style="display:block;padding-right:24px;font-size:15px;font-weight:600">` +
    `${esc(stop.label)}</strong>` +
    `<div style="color:#6b7280;font-size:12px">${esc(line)}</div>` +
    (stop.detail
      ? `<div style="margin-top:2px;padding-top:6px;border-top:1px solid #ececf0;color:#6b7280">` +
        `${esc(stop.detail)}</div>`
      : "") +
    `</div>`
  );
}

/**
 * The card the focus ring opens: a name and what kind of place it is.
 *
 * Almost `stopInfoHtml`, and deliberately not it: that card's second line
 * says "Pieturvieta", which is exactly the claim this one must not make. A
 * suggestion the rider is looking at has not joined the ride, and the row's
 * own Pievienot button is what would change that.
 */
function focusInfoHtml(
  m: Messages,
  place: {
    label: string; kind?: string; picked?: boolean;
    detour?: { delta?: string; note?: string; why?: string; canPick: boolean } | null;
  },
  canAdd: boolean,
): string {
  const detour = place.detour ?? null;
  return (
    `<div style="font-size:13px;line-height:1.4;min-width:150px;` +
    `display:flex;flex-direction:column;gap:${CARD_ROW_GAP_PX}px">` +
    `<strong style="display:block;padding-right:24px;font-size:15px;font-weight:600">` +
    `${esc(place.label)}</strong>` +
    // The kind as a muted line, not a "Veids ——— pilsdrupas" row: the label
    // says nothing the word beside it does not, and the stop card next to it
    // was compacted the same way.
    (place.kind
      ? `<div style="color:#6b7280;font-size:12px">${esc(place.kind)}</div>`
      : "") +
    // The same delta the row shows, in the same plain colour: the map card is
    // a second view of one offer, not a shorter one.
    (detour?.delta
      ? `<div style="display:flex;gap:8px;justify-content:space-between">` +
        `<span style="color:#6b7280">${esc(m.resDetourCost)}</span>` +
        `<span style="text-align:right;font-variant-numeric:tabular-nums">` +
        `${esc(detour.delta)}${detour.note ? ` <span style="color:#6b7280">${esc(detour.note)}</span>` : ""}` +
        `</span></div>`
      : detour?.note
        ? `<div style="color:#6b7280">${esc(detour.note)}</div>`
        : "") +
    // The row's Vairāk sentence. The card has no expansion of its own, so the
    // words that make "205 m" and "+17,0 km" agree have to be on it.
    (detour?.why ? `<div style="color:#6b7280;font-size:12px">${esc(detour.why)}</div>` : "") +
    // The rider's own question — "kā man šos ērti pievienot maršrutam?" — is
    // answered here rather than only back in the list: having flown to a place
    // and decided, the next tap should be the one that does it. `data-add` is
    // how the effect finds this button once MapLibre has parsed the markup;
    // the popup's DOM is not ours to hold a React ref inside.
    // …unless there is nothing to splice. An unreachable place has no routed
    // detour, so the button would answer a press with nothing — the same
    // reason its row carries no checkbox. A *long* detour is offered here
    // exactly as it is in the list.
    (canAdd && detour?.canPick !== false
      ? `<button type="button" data-add="1" ` +
        `style="margin-top:4px;width:100%;display:flex;align-items:center;` +
        `justify-content:center;gap:4px;height:30px;border-radius:15px;` +
        // Ticked reads as filled, unticked as an outline — the same pair the
        // list's own checkbox uses, so one glance says which state this is.
        (place.picked
          ? `border:1px solid #f56300;background:#f56300;color:#fff;`
          : `border:1px solid #f5630040;background:#fff;color:#f56300;`) +
        `font-size:12px;font-weight:600;cursor:pointer;padding:0 10px">` +
        `${esc(place.picked ? `✓ ${m.resSelectionClear}` : m.resAddStop)}</button>`
      : "") +
    `</div>`
  );
}

/** How long the route takes to draw itself in. */
const REVEAL_MS = 900;

/**
 * Draw the route in from nothing.
 *
 * MapLibre has no "animate a line's length" property, so this animates what
 * it does have: the glow flares and settles, and the line fades up from its
 * casing. Deliberately not a dash-offset trick — the route is many separate
 * features (one per surface run), so a per-feature dash animation would draw
 * them all at once anyway and fight the dashes that mean "track" and "trail".
 */
function revealRoute(map: maplibregl.Map) {
  const layers = ["route-glow", "route-casing", "route-road", "route-track", "route-trail"] as const;
  if (layers.some((id) => !map.getLayer(id))) return;

  const start = performance.now();
  const step = () => {
    // The map can be torn down mid-animation (a new ride, a route panel
    // closing); every frame re-checks rather than trusting the closure.
    if (!map.getLayer("route-glow")) return;
    const t = Math.min(1, (performance.now() - start) / REVEAL_MS);
    // Ease out: quick to appear, slow to settle, which is what makes it feel
    // like a line being drawn rather than a fade.
    const e = 1 - Math.pow(1 - t, 3);

    map.setPaintProperty("route-glow", "line-opacity", 0.18 + 0.5 * Math.sin(Math.PI * e));
    map.setPaintProperty("route-casing", "line-opacity", 0.9 * e);
    map.setPaintProperty("route-road", "line-opacity", e);
    map.setPaintProperty("route-track", "line-opacity", e);
    map.setPaintProperty("route-trail", "line-opacity", e);

    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * Surface → colour, for every value of `SurfaceClass` that can reach the
 * client. The buckets are the SEGUMS panel's own (see `classifyRoute`, which
 * folds the seven classes into asphalt / gravel / dirt / unknown for the
 * percentages): map and numbers have to group the same way or the rider is
 * told 30 % gravel and shown two different oranges.
 *
 * Every class is listed explicitly rather than leaning on the fallback, so a
 * new `SurfaceClass` shows up here as a missing case instead of quietly
 * rendering as "unknown" grey. The fallback stays for an unrecognised value
 * off the wire — an old share link, or a router that learns a new tag.
 */
const SURFACE_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "surface"],
  "asphalt", SURFACE_COLORS.asphalt,
  ["gravel", "compacted"], SURFACE_COLORS.gravel,
  ["ground", "dirt", "sand"], SURFACE_COLORS.dirt,
  SURFACE_COLORS.unknown,
];

/**
 * The phone's right-hand column over the full-screen map's bottom row — fixed
 * slots, counted from the bottom, so nothing ever jumps (rider, 2026-09-27:
 * "one moment there's an X in the left corner, the next there isn't"):
 *
 *   3 (top)    ✓   enabled while something is pending and Confirm can act
 *   2          ↶   the batch's own while pending, the history's otherwise
 *   1 (bottom) „+” enabled when nothing is pending
 *   x (row)    ✕   in the bottom row right of the field, under „+”
 *              (rider, 2026-09-28: „+” and ✕ each their own button)
 *
 * Every slot is drawn in every state (rider, 2026-09-28): one with nothing to
 * do is disabled — grey, `aria-disabled`, not pressable — never hidden and
 * never `invisible`, so there are no gaps and nothing moves. The column is
 * `flex-col-reverse`: DOM order is bottom-up.
 *
 * The desktop draws the same controls in the row instead (`md:` above).
 */
/**
 * One of the map's switches (TET, sights, legend): the same pill for all — a
 * swatch or icon, the label, the orange switch. `labelClass` lets a phone
 * hide the words (they stay the button's name) to keep one row at 320 px.
 */
function MapSwitch({ on, onToggle, label, name, swatch, labelClass = "" }: {
  on: boolean;
  onToggle: () => void;
  label: string;
  /** The accessible name when it differs from the label („Rādīt leģendu”). */
  name?: string;
  swatch?: React.ReactNode;
  labelClass?: string;
}) {
  return (
    <button type="button" onClick={onToggle} aria-pressed={on} aria-label={name ?? label} title={name ?? label}
      className="flex h-[30px] shrink-0 items-center gap-2 rounded-full border border-[#ececf0] bg-white/95 px-3 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white max-md:gap-1.5 max-md:px-1.5">
      {swatch}
      <span className={`whitespace-nowrap ${labelClass}`}>{label}</span>
      <span aria-hidden="true" className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${on ? "justify-end bg-[#f56300]" : "justify-start bg-[#e9e9eb]"}`}>
        <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
      </span>
    </button>
  );
}

/**
 * The desktop's bottom bar after the field: [✓] [↶] [+/✕], 40 px, fixed slots
 * (rider, 2026-09-27 — the phone's rule, laid out in a row because there is
 * width for it). The bar has a fixed width, so the buttons sit at its right
 * end and never move: ✓ appears only while something is pending and the
 * field gives it the room; ↶ is always there (disabled when there is nothing
 * to take back); „+” and ✕ share the last slot. Confirm's words are its name
 * and tooltip.
 */
/**
 * „+” — a new stop, slot 1. Disabled while a mark is pending (it is ✓ or ✕
 * first) and at the stop cap, where its label says why.
 */
function AddSlot({ controls, plain, icon }: { controls: MapControls; plain: string; icon: string }) {
  const onAdd = controls.pending ? null : controls.onAddStop;
  const label = controls.onAddStop ? controls.addStopLabel : controls.addStopFullLabel;
  return (
    <button type="button" onClick={onAdd ?? undefined} disabled={!onAdd} aria-disabled={!onAdd || undefined} data-slot="1"
      aria-label={label} title={label} className={`${plain} text-[#bd4b00]`}>
      <Plus aria-hidden="true" className={icon} />
    </button>
  );
}

/**
 * ✕ — drop what is pending, its own slot `x` beside „+” (rider,
 * 2026-09-28: „+” and ✕ no longer share one). Disabled when nothing is.
 */
function CancelSlot({ controls, plain, icon }: { controls: MapControls; plain: string; icon: string }) {
  const [locale] = useLocale();
  const pending = controls.pending;
  const label = pending?.cancelLabel ?? messages(locale).pickOnMapCancel;
  return (
    <button type="button" onClick={pending?.onCancel} disabled={!pending} aria-disabled={!pending || undefined} data-slot="x"
      aria-label={label} title={label} className={`${plain} text-stone-700`}>
      <X aria-hidden="true" className={icon} />
    </button>
  );
}

function DesktopBar({ controls }: { controls: MapControls }) {
  const pending = controls.pending;
  const round = "flex size-10 shrink-0 items-center justify-center rounded-full shadow-sm";
  const plain = `${round} border border-[#ececf0] bg-white/95 backdrop-blur transition-colors hover:bg-white ${SLOT_DISABLED}`;
  const undo = pending ? pending.undo ? { label: pending.undo.label, onUndo: pending.undo.onUndo as (() => void) | null } : null : controls.undo ?? null;
  const [locale] = useLocale();
  const undoLabel = undo?.label ?? messages(locale).mapUndo;
  return (
    <div data-desktop-bar className="flex shrink-0 items-center gap-1.5 max-md:hidden">
      {/* ── P1-D: desktop-confirm ── */}
      <ConfirmSlot pending={pending} round={round} data-slot="3" />
      {/* ── /P1-D: desktop-confirm ── */}
      <button type="button" onClick={undo?.onUndo ?? undefined} disabled={!undo?.onUndo} aria-disabled={!undo?.onUndo || undefined} data-slot="2"
        aria-label={undoLabel} title={undoLabel}
        className={`${plain} text-stone-700`}>
        <Undo2 aria-hidden="true" className="size-4" />
      </button>
      <AddSlot controls={controls} plain={plain} icon="size-5" />
      <CancelSlot controls={controls} plain={plain} icon="size-5" />
    </div>
  );
}

/**
 * The phone: ✓ ↶ „+” in the column over the right edge, top to bottom, and
 * ✕ in the bottom row right of the field — directly under „+”, the same
 * size at the same x.
 */
function PhoneColumn({ controls }: { controls: MapControls }) {
  const pending = controls.pending;
  const round = "flex size-14 shrink-0 items-center justify-center rounded-full shadow-md";
  const plain = `${round} border border-[#ececf0] bg-white/95 backdrop-blur transition-colors hover:bg-white ${SLOT_DISABLED}`;
  const undo = pending ? pending.undo ? { label: pending.undo.label, onUndo: pending.undo.onUndo as (() => void) | null } : null : controls.undo ?? null;
  const [locale] = useLocale();
  const undoLabel = undo?.label ?? messages(locale).mapUndo;
  return (
    <>
      <div data-phone-column className="absolute bottom-full right-0 mb-2 flex flex-col-reverse gap-2 md:hidden">
        <AddSlot controls={controls} plain={plain} icon="size-7" />
        <button type="button" onClick={undo?.onUndo ?? undefined} disabled={!undo?.onUndo} aria-disabled={!undo?.onUndo || undefined} data-slot="2"
          aria-label={undoLabel} title={undoLabel}
          className={`${plain} text-stone-700`}>
          <Undo2 aria-hidden="true" className="size-6" />
        </button>
        {/* ── P1-D: phone-confirm ── */}
        <ConfirmSlot pending={pending} round={round} phone data-slot="3" />
        {/* ── /P1-D: phone-confirm ── */}
      </div>
      <div data-phone-cancel className="shrink-0 md:hidden">
        <CancelSlot controls={controls} plain={plain} icon="size-6" />
      </div>
    </>
  );
}

export function RouteMap({ segments, start, destination, via, focus, onFocusCleared, onFocusToggle, selectedPois, routePois, showTet, onToggleTet, showSights, onToggleSights, onShowPoi, onPickPoint, pickedPoint, onPickedPointMove, pickCenter, onGeolocated, controls, proposal }: Props) {
  const [locale] = useLocale();
  const m = messages(locale);
  /** The phone's field: shorter words, the row as a small badge. */
  const phoneLayout = usePhoneLayout();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const showTetRef = useRef(false);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  /**
   * The words under the end pins, and the finish's flag.
   *
   * Their own markers, so MapLibre's pins keep their own geometry — see
   * `endpointLabelElement` for the clipped teardrop that made this necessary.
   * Held together because they are removed together, on every rebuild.
   */
  const endpointDecorationsRef = useRef<maplibregl.Marker[]>([]);
  const loadedRef = useRef(false);
  const viaMarkersRef = useRef<maplibregl.Marker[]>([]);
  const badgeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const gateMarkersRef = useRef<maplibregl.Marker[]>([]);
  const syncRef = useRef<() => void>(() => {});
  /** Which route has already played its reveal, so a pan never replays it. */
  const revealedRef = useRef<string | null>(null);
  /**
   * The route's features with `segmentId` stamped on, kept out of React state
   * on purpose: the hover readout reads this on every `mousemove` and a
   * setState per pointer sample would re-render the map's whole subtree.
   */
  const featuresRef = useRef<GeoJSON.Feature<GeoJSON.LineString, SegmentProps>[]>([]);
  /** The floating element that follows the cursor over a warning segment. */
  const hoverRef = useRef<HTMLDivElement | null>(null);
  /** Which highlight is showing, so clicking the same source again clears it. */
  const highlightKeyRef = useRef<string | null>(null);
  const setHighlightRef = useRef<(ids: number[], key: string) => void>(() => {});
  const clearHighlightRef = useRef<() => void>(() => {});
  /**
   * Opens the segment card at a point — the one card a badge click produces.
   *
   * A badge used to carry a MapLibre popup of its own, which opened on top of
   * the segment card the same click produced through the map: two stacked
   * cards, each with its own close button. The badge now opens this instead,
   * and the explanation it used to show lives in the card's warning row.
   */
  const openCardRef = useRef<(lngLat: maplibregl.LngLatLike, id: number) => void>(() => {});
  /** The segment popover — one at a time, replaced rather than stacked. */
  const infoPopupRef = useRef<maplibregl.Popup | null>(null);
  /** The ring on a place being looked at, and the way to take it away again. */
  const focusMarkerRef = useRef<maplibregl.Marker | null>(null);
  const clearFocusRef = useRef<() => void>(() => {});
  // The parent's callback, read from map handlers that outlive the render that
  // created them. A ref so a parent re-creating the arrow every render does
  // not mean re-attaching every map listener.
  const onFocusClearedRef = useRef(onFocusCleared);
  useEffect(() => { onFocusClearedRef.current = onFocusCleared; }, [onFocusCleared]);
  const onFocusToggleRef = useRef(onFocusToggle);
  useEffect(() => { onFocusToggleRef.current = onFocusToggle; }, [onFocusToggle]);
  /** The pills for the ticked sights, replaced whole whenever the set changes. */
  const selectedMarkersRef = useRef<maplibregl.Marker[]>([]);
  /** The marks for the sights this ride passes or runs near. */
  const sightMarkersRef = useRef<maplibregl.Marker[]>([]);
  /**
   * Clicking a sight's mark opens the row's card, and the card is the page's —
   * so the handler goes through a ref, for the reason `onFocusToggle` does: a
   * parent that re-creates the callback every render (the ordinary case for an
   * inline arrow) must not be a reason to rebuild every marker on the map.
   */
  const onShowPoiRef = useRef(onShowPoi);
  useEffect(() => { onShowPoiRef.current = onShowPoi; }, [onShowPoi]);
  /**
   * Pick mode, read from the map's click handler for the same reason the
   * callbacks above are: the handler is attached once and outlives the render
   * that created it, so reading the prop directly would leave it forever
   * seeing whatever pick mode was when the listener was built.
   *
   * This one matters more than the others, because it is what decides that a
   * click is a place rather than a question about a road — a stale value here
   * means the tap opens a segment card instead of filling the row.
   */
  const onPickPointRef = useRef(onPickPoint);
  useEffect(() => { onPickPointRef.current = onPickPoint; }, [onPickPoint]);
  /** The idle "a tap on nothing is a new stop" door, through a ref for the same reason. */
  const onPickedPointMoveRef = useRef(onPickedPointMove);
  useEffect(() => { onPickedPointMoveRef.current = onPickedPointMove; }, [onPickedPointMove]);
  const onGeolocatedRef = useRef(onGeolocated);
  useEffect(() => { onGeolocatedRef.current = onGeolocated; }, [onGeolocated]);
  /**
   * A ride pin dragged in edit mode, through a ref for the reason every other
   * callback here is: the markers are built once per ride change, and a
   * closure over the prop would keep calling the handler that existed when
   * they were — one that still believes the rows are as they were then.
   *
   * `pinsDraggable` is the plain flag, and it is in the marker effect's deps:
   * entering edit mode has to rebuild the pins as draggable, and leaving it
   * has to pin them down again.
   */
  const pinDragRef = useRef(controls?.onPinDrag);
  useEffect(() => { pinDragRef.current = controls?.onPinDrag; }, [controls?.onPinDrag]);
  const pinPressRef = useRef(controls?.onPinPress);
  useEffect(() => { pinPressRef.current = controls?.onPinPress; }, [controls?.onPinPress]);
  /** When a pin drag last ended: the click that ends a drag is not a press. */
  const dragEndedAtRef = useRef(0);
  /** The ride's pins as built, for telling overlapping ones apart (`nearestPin`). */
  const pinTargetsRef = useRef<PinTarget[]>([]);
  const viaRef = useRef(via);
  useEffect(() => { viaRef.current = via; }, [via]);
  const lineGrabRef = useRef(controls?.onLineGrab);
  useEffect(() => { lineGrabRef.current = controls?.onLineGrab; }, [controls?.onLineGrab]);
  /** A grab is waiting for its spot: the next click is that spot, not a new grab. */
  const grabbingRef = useRef(false);
  useEffect(() => { grabbingRef.current = Boolean(controls?.grab); }, [controls?.grab]);
  /** Draws the grab's dashed connector, from the line to the spot (see its effect). */
  const connectorRef = useRef<(to: { lat: number; lon: number } | null) => void>(() => {});
  /** The tapped point's sheet, read by the map's click (a tap closes an open menu). */
  const pointSheetRef = useRef(controls?.pointSheet);
  useEffect(() => { pointSheetRef.current = controls?.pointSheet; });
  /** Redraws the move preview to a candidate, live while a mark is dragged (see its effect). */
  const movePreviewRef = useRef<(to: { lat: number; lon: number } | null) => void>(() => {});
  const pinsDraggable = Boolean(controls?.onPinDrag);
  /**
   * Where the planning (or edit) map's places may be framed: clear of the
   * header row — at the top on the desktop, at the bottom on a phone — of TET
   * and, where it shows, the legend under it (measured; it took the start pin
   * at 1280 px when this was a flat 64 px).
   */
  const planPadding = (): maplibregl.PaddingOptions | number => {
    if (!hasHeaderRef.current) return 64;
    const legend = containerRef.current?.parentElement?.querySelector<HTMLElement>("[data-map-legend]");
    const legendH = legend && legend.offsetParent !== null ? legend.getBoundingClientRect().height + 8 : 0;
    // The switches (and the legend, when shown) at the top, the field's bar
    // at the bottom — at every width now.
    return window.matchMedia(PHONE_QUERY).matches
      ? { top: 56 + legendH, bottom: 72, left: 48, right: 72 }
      : { top: 56 + legendH, bottom: 72, left: 64, right: 72 };
  };
  /** The rider has panned or zoomed this map himself (see its listener). */
  const userMovedRef = useRef(false);
  /** This map instance has framed a ride at least once. */
  const framedRef = useRef(false);
  /** Header height to keep clear when framing the ride, while there is a header. */
  const hasHeaderRef = useRef(false);
  useEffect(() => { hasHeaderRef.current = Boolean(controls); }, [controls]);
  /** The draggable marker for the picked point, kept out of the route's markers. */
  const pickedMarkerRef = useRef<maplibregl.Marker | null>(null);
  /** The "where am I" button, added only while a row is being picked. */
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  /** The header (and the off-road verdict under it), measured to keep the
   *  pending marker out from under them. */
  const headerRef = useRef<HTMLDivElement | null>(null);
  /** The map-data credit beside TET is open (see the TET switch). */
  const [creditOpen, setCreditOpen] = useState(false);
  /** The map exists. State, not a ref, because effects have to re-run on it. */
  const [ready, setReady] = useState(false);
  /**
   * The gesture that just pressed a sight's mark, so the map's own click can
   * let that one through.
   *
   * MapLibre listens for the pointer on the canvas *container*, which is the
   * marker's parent, and synthesises its `click` from `mousedown`/`mouseup` —
   * so `event.stopPropagation()` on the marker's own DOM `click` does not stop
   * it. The map's handler therefore ran straight after the marker's and called
   * `clearFocus()`, tearing down the card the marker had just asked for: a
   * click on a sight opened nothing, every time.
   *
   * The 🅿️ stops never showed this because they open `infoPopupRef` directly
   * and `clearFocus` no-ops when there is no focus marker to remove. A sight
   * goes through the page's `focus` prop, which is exactly what `clearFocus`
   * clears, so it was the first mark to hit it.
   *
   * A timestamp rather than a flag: a flag left set by a press that somehow
   * produced no map click would swallow the rider's next click on the map.
   */
  const sightClickAtRef = useRef(0);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const mapContainer = containerRef.current;
    const map = new maplibregl.Map({
      container: mapContainer,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }],
      },
      center: [24.6, 56.95], // Latvia
      zoom: 7,
      // Compact attribution, always. Left to itself MapLibre expands the
      // credit into a ~256 px strip along the bottom edge (measured), which
      // is exactly the row the legend and the full-screen button share. As a
      // collapsed ⓘ it is ~24 px in the corner, the legend can run to within
      // a gutter of it, and the credit is still one tap away.
      // Our own ⓘ beside the TET switch instead (see there). MapLibre's
      // compact control kept landing where something else was — along the
      // bottom edge, over the TET corner, as an empty white box under the zoom
      // stack — and its wrapper would not take the look of the buttons around
      // it. The credit is the same words, one tap away.
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

    // MapLibre renders the compact attribution as `<details open>` — it only
    // collapses once the rider touches the map. Open it is a ~200 px strip
    // along the bottom edge (measured at 375 px: 198 px, against 36 px shut),
    // which is the row the legend lives in. Shut it on load; the ⓘ still
    // opens it, and MapLibre's own toggling keeps working.
    map.once("load", () => {
      mapContainer.querySelector("details.maplibregl-ctrl-attrib")?.removeAttribute("open");
    });

    map.on("error", (e) => console.error("MapLibre error:", e.error ?? e));
    if (process.env.NODE_ENV === "development") {
      (window as unknown as Record<string, unknown>).__map = map;
    }

    // Panning into a country whose file is not loaded yet must fill it in;
    // the ref keeps the handler reading the current toggle rather than the
    // value captured when the map was created.
    map.on("moveend", () => { if (showTetRef.current) void loadTet(map); });

    map.on("load", () => {
      // TET overlay sits below the generated route.
      // Empty to start: the TET is 33 countries and 4 MB of line. What is on
      // screen is fetched when the layer is switched on — see `loadTet`.
      map.addSource("tet", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "tet-line",
        type: "line",
        source: "tet",
        layout: { "line-cap": "round", "line-join": "round", visibility: "none" },
        paint: { "line-color": TET_COLOR, "line-width": 2.5, "line-opacity": 0.65 },
      });

      map.addSource("route", { type: "geojson", data: EMPTY });

      // The line is drawn the way a good phone map draws one: a soft white
      // casing under everything so the route reads over any basemap colour,
      // round caps and joins so it never shows a mitred corner, and widths
      // that grow with zoom instead of staying a hairline on a wide view and
      // a slab up close.
      // A soft glow under the route. It does almost nothing on a quiet
      // basemap and a lot over forest green or a dense town, where a 5 px
      // line otherwise competes with every other line on the map. Widest and
      // faintest of the four layers, so it reads as light rather than as a
      // second line.
      map.addLayer({
        id: "route-glow",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": SURFACE_COLOR_EXPR,
          "line-width": GLOW_WIDTH,
          "line-opacity": 0.18,
          "line-blur": 6,
        },
      });
      // The highlight for a badge's segments, under everything but the glow so
      // the route keeps its own colours on top. Filtered to nothing until a
      // badge is clicked; `HIGHLIGHT_NONE` is a filter that matches no feature.
      map.addLayer({
        id: "route-highlight",
        type: "line",
        source: "route",
        filter: HIGHLIGHT_NONE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": HIGHLIGHT_COLOR,
          "line-width": HIGHLIGHT_WIDTH,
          "line-opacity": 0.6,
          "line-blur": 1,
        },
      });
      // Where the rider's own route runs along the TET. Under the white
      // casing, so it shows as a purple edge outside the route rather than
      // tinting it. It deliberately does NOT follow the TET toggle: the
      // toggle answers "show me the trail near this ride", while this answers
      // "this stretch of *your* ride is on it" — a fact about the route, which
      // should not vanish because a reference layer was switched off.
      map.addLayer({
        id: "route-tet",
        type: "line",
        source: "route",
        filter: ["==", ["get", ON_TET], true],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": TET_COLOR,
          "line-width": TET_CASING_WIDTH,
          "line-opacity": 0.75,
        },
      });
      map.addLayer({
        id: "route-casing",
        type: "line",
        source: "route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": CASING_WIDTH,
          "line-opacity": 0.9,
          "line-blur": 0.4,
        },
      });
      map.addLayer({
        id: "route-road",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "road"],
        layout: { "line-cap": "round", "line-join": "round" },
        // Opacity is declared so the reveal has something to animate from;
        // without it the first frame jumps from 1 to 0 and reads as a flicker.
        paint: { "line-color": SURFACE_COLOR_EXPR, "line-width": LINE_WIDTH, "line-opacity": 1 },
      });
      map.addLayer({
        id: "route-track",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "track"],
        // Butt caps: a dash with round caps grows by half its width at each
        // end, which closes the gaps and turns the dashes back into a solid
        // line at low zoom.
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": SURFACE_COLOR_EXPR,
          "line-width": PATTERNED_WIDTH,
          // Long dash, short gap: reads as a continuous way that happens to be
          // unsealed, rather than as a row of ticks. Stretched, then dropped
          // altogether, as the line thins — see `ZOOM_PATTERN_OFF`.
          "line-dasharray": TRACK_DASH,
          "line-opacity": 1,
        },
      });
      map.addLayer({
        id: "route-trail",
        type: "line",
        source: "route",
        filter: ["==", ["get", "roadClass"], "trail"],
        // Round caps with a zero-length dash give real round dots. A butt cap
        // here would draw little rectangles, which is what "dotted" looked
        // like before.
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          // The dots alone say "trail"; the colour is free to say what the
          // trail is made of. A gravel trail and a gravel track are therefore
          // the same orange in two patterns, which is the whole scheme.
          "line-color": SURFACE_COLOR_EXPR,
          "line-width": PATTERNED_WIDTH,
          "line-dasharray": TRAIL_DASH,
          "line-opacity": 1,
        },
      });

      loadedRef.current = true;
      syncRef.current();
    });

    // A pan or zoom the rider made himself (an `originalEvent` — ours have
    // none): the planning map's framing leaves his view alone from then on.
    map.on("movestart", (e) => { if ((e as { originalEvent?: Event }).originalEvent) userMovedRef.current = true; });
    mapRef.current = map;
    // A ref alone cannot wake the effects that need the map: this component
    // mounts with `mapRef` empty, and the pick-mode effects run for the first
    // time before this one has created anything. `segments` happens to serve
    // that purpose for the older effects (see the interaction effect's note);
    // pick mode has no such prop, and its control was silently never added.
    setReady(true);
    return () => {
      map.remove();
      mapRef.current = null;
      // `map.remove()` has already removed the geolocate control with it. A
      // ref still holding it made the next map skip adding its own, and the
      // next `removeControl` crash on the dead one ("reading 'off'") — seen
      // on leaving edit mode after the map had been re-created in dev.
      geolocateRef.current = null;
      loadedRef.current = false;
      setReady(false);
    };
  }, []);

  useEffect(() => {
    /**
     * Let a ride pin be dragged, in edit mode.
     *
     * The pin goes straight back where it was when the finger lifts, and the
     * drop point becomes the pending mark for that pin's row instead: named,
     * waiting for Confirm, cancellable. A pin that stayed where it was
     * dropped while the line still ran through its old spot would be a
     * marker and a route disagreeing — the one thing an edit must never show
     * — and a drag let go a few metres off is exactly what the preview is for.
     *
     * `dragend` alone: MapLibre moves the marker under the finger by itself,
     * and a request per pointer sample would be hundreds per drag. This is
     * MapLibre's own marker drag, the one the pending mark has always had — not
     * the DOM drag-and-drop for reordering rows that failed on iOS Safari three
     * times, which is still ruled out.
     */
    const pinDraggable = (marker: maplibregl.Marker, home: [number, number], role: "start" | "via" | "finish", index: number) => {
      marker.on("dragend", () => {
        dragEndedAtRef.current = performance.now();
        const { lat, lng } = marker.getLngLat();
        marker.setLngLat(home);
        pinDragRef.current?.(role, index, { lat, lon: lng });
      });
    };
    /**
     * A press on a ride pin while the map answers the form: that pin's row
     * becomes active. Returns whether it was taken, so a pin with no form to
     * answer keeps its card. The map's own click, which follows from the same
     * gesture, is told to let it through (`sightClickAtRef`) — otherwise it
     * would mark this very spot for the row that was active before.
     */
    /**
     * Whether a tap on a warning badge or a gate belongs to the map instead of
     * opening its card: while the map answers a row („Atzīmē kartē”, a new
     * stop, „Pārvietot”) the tap is that place, and while a point's sheet is
     * open it closes the sheet. The gate's 44 px target otherwise swallowed a
     * rider's mark next to a gate — the map never heard it and the row
     * stayed empty. Not stopped, the click reaches the map's own handler,
     * which reads the spot from the event.
     */
    const mapTakesTap = (): boolean => Boolean(onPickPointRef.current) || pointSheetRef.current?.mode === "menu";
    const pressPin = (event: MouseEvent, role: "start" | "via" | "finish", index: number): boolean => {
      const press = pinPressRef.current;
      if (!press) return false;
      event.stopPropagation();
      sightClickAtRef.current = event.timeStamp;
      if (performance.now() - dragEndedAtRef.current < 400) return true;
      // Two pins close together overlap (the rider's stops 4 and 5, 17 px
      // apart on his phone): the one drawn on top takes every tap on the
      // overlap, and the other could not be chosen. The pin pressed is the
      // one whose centre is nearest the tap, among those under it.
      const hit = nearestPin(pinTargetsRef.current, event.clientX, event.clientY);
      if (hit) press(hit.role, hit.index);
      else press(role, index);
      return true;
    };
    const syncData = () => {
      const map = mapRef.current;
      if (!map || !loadedRef.current) return;

      // Every run gets its index stamped on as `segmentId` before the source
      // sees it: the badge highlight, the hover readout and the click popover
      // all identify a feature by it, and the API has never carried one. Done
      // here rather than in the parent so a saved or shared ride — whose
      // stored response predates all of this — gets the link too.
      const enriched: GeoJSON.FeatureCollection<GeoJSON.LineString, SegmentProps> | null =
        segments && {
          type: "FeatureCollection",
          features: segments.features.map((f, i) => ({
            ...f,
            properties: { ...(f.properties as RouteSegmentProperties), [SEGMENT_ID]: i },
          })),
        };
      featuresRef.current = enriched?.features ?? [];

      const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      source?.setData(enriched ?? EMPTY);

      // The purple casing needs the TET geometry whether or not the reference
      // overlay is switched on — see the `route-tet` layer for why. `loadTet`
      // caches per country, so this is one fetch per area per session, and the
      // flags are applied when it resolves.
      if (enriched?.features.length) void markTet(map, enriched);

      // A new route draws itself in rather than appearing all at once. It is
      // the moment the rider waited the whole generation for, and a line that
      // arrives instantly reads as a picture; one that is drawn reads as a
      // ride being laid out. Keyed on the geometry so panning, zooming or
      // toggling TET never replays it.
      const key = segments?.features?.length
        ? `${segments.features.length}:${JSON.stringify(segments.features[0].geometry.coordinates[0] ?? [])}:${JSON.stringify(segments.features[segments.features.length - 1].geometry.coordinates.at(-1) ?? [])}`
        : null;
      // Not in edit mode: an edited stretch is a correction to a ride already
      // on screen, and drawing the whole ride in again from the start would
      // present it as a new one.
      if (key && key !== revealedRef.current) {
        revealedRef.current = key;
        if (!pinsDraggable) revealRoute(map);
      }

      if (map.getLayer("tet-line")) {
        map.setLayoutProperty("tet-line", "visibility", showTet ? "visible" : "none");
        showTetRef.current = showTet;
        if (showTet) void loadTet(map);
      }

      // The two ends. Both PINS are MapLibre's own, green and red, with their
      // own geometry, anchor and transform — untouched, exactly as they
      // shipped and as production draws them. Rebuilding one by hand to fit a
      // label inside produced a clipped teardrop with a halo, which the rider
      // saw and reported; see `endpointLabelElement`.
      //
      // The word under each is a separate marker at the same coordinate whose
      // element is a zero-sized box. They are rebuilt on every run rather than
      // reused because the label is translated — reusing would leave "Starts"
      // on the map after the rider switched the interface to English, the way
      // the badges did before `locale` joined this effect's deps.
      for (const marker of endpointDecorationsRef.current) marker.remove();
      endpointDecorationsRef.current = [];
      pinTargetsRef.current = [];

      markerRef.current?.remove();
      markerRef.current = null;
      if (start) {
        markerRef.current = new maplibregl.Marker({ color: START_PIN_COLOR, draggable: pinsDraggable })
          .setLngLat([start.lon, start.lat])
          .addTo(map);
        pinTargetsRef.current.push({ el: markerRef.current.getElement(), role: "start", index: 0 });
        if (pinsDraggable) pinDraggable(markerRef.current, [start.lon, start.lat], "start", 0);
        markerRef.current.getElement().addEventListener("click", (event) => { pressPin(event, "start", 0); });
        endpointDecorationsRef.current.push(
          new maplibregl.Marker({
            // The place's own name where there is one, so the tooltip and the
            // screen-reader name say *which* place this is — the pill beside
            // it says which end. `start` carries a label on a generated ride
            // and none while the form is only being composed.
            element: endpointLabelElement({ title: start.label ?? m.mapStart, label: m.mapStart }),
          }).setLngLat([start.lon, start.lat]).addTo(map),
        );
      }

      destMarkerRef.current?.remove();
      destMarkerRef.current = null;
      if (destination) {
        // MapLibre's own pin in red, exactly as the start is in green: same
        // geometry, same anchor, same tip on the coordinate. No element of our
        // own, so there is no box to clip the teardrop and no `anchor` to get
        // wrong — see `FINISH_PIN_COLOR` for why the chequers went.
        destMarkerRef.current = new maplibregl.Marker({ color: FINISH_PIN_COLOR, draggable: pinsDraggable })
          .setLngLat([destination.lon, destination.lat])
          .addTo(map);
        pinTargetsRef.current.push({ el: destMarkerRef.current.getElement(), role: "finish", index: 0 });
        if (pinsDraggable) pinDraggable(destMarkerRef.current, [destination.lon, destination.lat], "finish", 0);
        destMarkerRef.current.getElement().addEventListener("click", (event) => { pressPin(event, "finish", 0); });
        endpointDecorationsRef.current.push(
          new maplibregl.Marker({
            element: endpointLabelElement({ title: destination.label ?? m.mapFinish, label: m.mapFinish }),
          }).setLngLat([destination.lon, destination.lat]).addTo(map),
        );
      }

      for (const marker of badgeMarkersRef.current) marker.remove();
      // A new route's badges are about a different road: drop any highlight
      // left over from the last one.
      clearHighlightRef.current();
      badgeMarkersRef.current = enriched
        ? badgesFor(enriched, locale, [
            ...(start ? [[start.lon, start.lat] as [number, number]] : []),
            ...(destination ? [[destination.lon, destination.lat] as [number, number]] : []),
            ...(via ?? []).map(v => [v.lon, v.lat] as [number, number]),
          ]).map(b => {
            const el = badgeElement(b.icon, b.title, b.iconCount);
            // One card, not two. The badge used to carry a MapLibre popup of
            // its own AND let the click reach the map, which opened the
            // segment card underneath it — two overlapping cards, each with a
            // close button. Now the badge opens the same card the line does,
            // with the explanation inside it, and stops the event so the map's
            // own handler does not open a second one.
            el.addEventListener("click", (event) => {
              if (mapTakesTap()) return;
              event.stopPropagation();
              const id = b.segmentIds[0];
              if (typeof id === "number") openCardRef.current(b.point, id);
              // A badge speaks for every stretch it crowded out, so the
              // highlight still lights up all of them rather than just the
              // one the card describes.
              highlightKeyRef.current = null;
              setHighlightRef.current(b.segmentIds, `badge:${b.segmentIds.join(",")}`);
            });
            return new maplibregl.Marker({ element: el })
              .setLngLat(b.point)
              .addTo(map);
          })
        : [];

      for (const marker of gateMarkersRef.current) marker.remove();
      // Gates get their own pass, after the badges so they sit under them in
      // DOM order too, and only where the route actually carries positions —
      // outside the published countries `classify.ts` reports nothing at all,
      // which is "not measured", so the map stays as bare as the panel does.
      gateMarkersRef.current =
        enriched && SHOW_GATE_MARKERS
          ? gateMarksFor(enriched).map((g) => {
              const el = gateElement(gateAtLabel(m, locale, g), gateGlyphFor(g.info?.barrier));
              el.addEventListener("click", (event) => {
                if (mapTakesTap()) return;
                // Same reason the badges stop it: otherwise the click also
                // reaches the map and opens a second card underneath this one.
                event.stopPropagation();
                // The gate's own card and ~50 m of highlight — not the
                // stretch's. Tapping the same gate again puts both away.
                const key = `gate:${g.point[0]},${g.point[1]}`;
                const again = highlightKeyRef.current === key;
                clearHighlightRef.current();
                if (again) return;
                const popup = new maplibregl.Popup({ offset: 14, maxWidth: "240px", closeButton: true })
                  .setLngLat(g.point)
                  .setHTML(gateCardHtml(m, locale, g))
                  .addTo(map);
                // Above the stop pins (z-index 2), which would otherwise sit
                // on the card when a stop is near the gate.
                popup.getElement().style.zIndex = "3";
                popup.on("close", () => {
                  if (highlightKeyRef.current === key) highlightKeyRef.current = null;
                  clearGateHighlight(map);
                });
                infoPopupRef.current = popup;
                highlightKeyRef.current = key;
                showGateHighlight(map, gateHighlightLine(featuresRef.current, g.alongMeters));
              });
              return new maplibregl.Marker({ element: el }).setLngLat(g.point).addTo(map);
            })
          : [];

      for (const marker of viaMarkersRef.current) marker.remove();
      // Every stop gets a marker and the same card mechanism the line and the
      // badges use. It replaces a plain orange dot with a bare popup: two
      // identical circles that said only a label, and read as decoration
      // rather than as the places the rider asked to ride through.
      //
      // `via` arrives in ride order — the order the rider reads in the form —
      // and `stopNumbers` turns it into the digit each marker wears, skipping
      // the sights (see its own note). Computed from the whole list on every
      // rebuild, which is how removing or moving a stop renumbers the rest
      // with nothing to remember.
      const numbers = stopNumbers(via ?? []);
      viaMarkersRef.current = (via ?? []).map((place, i) => {
        // A sight carries its own kind's glyph in a ringed pill; a typed stop
        // gets its number. `category` is only set where the via came from a
        // suggestion, and an unknown category (an older share code, a dataset
        // built after this one) falls through to a numbered stop rather than
        // to a blank — it is in the ride, so it is a stop.
        const entry = place.category ? POI_KIND[place.category as keyof typeof POI_KIND] : undefined;
        const n = place.number ?? numbers[i];
        const el = n === null
          ? stopElement(place.label, entry?.icon ?? STOP_ICON, true)
          : numberedStopElement(place.label, n);
        // A via that came from a suggestion is a *sight* the rider added, and
        // the rider's ruling is that "Apskates vietas" off means no sights on
        // the map — added ones included. Marked here and hidden by the small
        // visibility effect below rather than filtered out of this list: the
        // toggle must not be a reason to rebuild the route, the badges and the
        // gates, which is what putting `showSights` in this effect's deps
        // would cost. A typed stop carries no mark and is never hidden.
        if (entry) el.dataset.sight = "1";
        pinTargetsRef.current.push({ el, role: "via", index: i });
        el.addEventListener("click", (event) => {
          // Answering the form, a press makes this stop's row active instead
          // of opening its card (`pressPin`).
          if (pressPin(event, "via", i)) return;
          // Same reason the badges stop it: otherwise the click reaches the
          // map and opens the segment card underneath this one.
          event.stopPropagation();
          infoPopupRef.current?.remove();
          infoPopupRef.current = new maplibregl.Popup({ offset: 16, maxWidth: "260px", closeButton: true })
            .setLngLat([place.lon, place.lat])
            .setHTML(stopInfoHtml(m, place))
            .addTo(map);
        });
        /**
         * A stop the rider can drag to somewhere better — wherever the map
         * answers the form (planning and edit mode), so a shared ride and a
         * plain result keep their pins fixed.
         * See `pinDraggable` for what a drag does and does not do.
         */
        const marker = new maplibregl.Marker({ element: el, draggable: pinsDraggable })
          .setLngLat([place.lon, place.lat])
          .addTo(map);
        if (pinsDraggable) {
          el.style.cursor = "grab";
          el.title = `${place.label} — ${m.mapDragStopHint}`;
          pinDraggable(marker, [place.lon, place.lat], "via", i);
        }
        return marker;
      });

      if (segments && segments.features.length > 0) {
        // In edit mode the view is the rider's: he is zoomed in on the place
        // he is correcting, and every Confirm re-framing the whole ride would
        // throw him back out of it — so it is framed once, when this map first
        // draws it (on a phone the map moves into the editor and starts
        // afresh), and then left alone. Anywhere else a new line is framed,
        // clear of the header when there is one, so the start pin is never
        // under it.
        if (!pinsDraggable || !framedRef.current) {
          framedRef.current = true;
          const bounds = new maplibregl.LngLatBounds();
          for (const f of segments.features) {
            for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
          }
          // With a header the top-right corner also carries the geolocate
          // button under the zoom stack, which covered a finish pin at 375 px.
          // At the bottom, wherever the legend is shown (the desktop, full
          // screen) it and the TET switch above it take ~100 px of the corner
          // a ride is often framed into — measured, they covered the start pin
          // at 1280 px.
          const header = hasHeaderRef.current;
          const legend = containerRef.current?.parentElement?.querySelector<HTMLElement>("[data-map-legend]");
          const legendH = legend && legend.offsetParent !== null ? legend.getBoundingClientRect().height + 48 : 0;
          // On a phone the header row is at the bottom, on the full-screen
          // button's line (see the header), and TET is at the top: the ride
          // is framed clear of those instead.
          const phoneHeader = header && window.matchMedia(PHONE_QUERY).matches;
          map.fitBounds(bounds, {
            // On a phone TET, the sights switch and (when shown) the legend
            // are all at the top-left.
            // The switch row and the legend are at the top-left at every
            // width; with a header its bar is at the bottom.
            padding: phoneHeader
              ? { top: 56 + legendH, bottom: 48 + 56, left: 48, right: 72 }
              : { top: 56 + legendH, bottom: header ? 72 : 48, left: 48, right: header ? 72 : 48 },
            duration: 800,
          });
        }
      } else if (start || destination || (via && via.length)) {
        // No route yet — frame the places the rider has confirmed, so the map
        // answers "is this the right Valmiera?" before a generation is spent.
        // The finish too: a finish picked in the form's own field was left
        // off-screen, and the rider could not see where his ride ended
        // (2026-09-25).
        //
        // Only when a pin is out of view, and never after the rider has
        // panned or zoomed the map himself since the last time it was framed
        // (rider, 2026-09-25): a confirmed place off-screen is shown, a view
        // he chose is left alone, and a Confirm with every pin in sight no
        // longer throws the map out to zoom 11.
        const pins = [...(start ? [start] : []), ...(via ?? []), ...(destination ? [destination] : [])];
        const view = map.getBounds();
        const outOfView = pins.some((p) => !view.contains([p.lon, p.lat]));
        if (!outOfView || userMovedRef.current) {
          // Left as it is.
        } else if (pins.length === 1) {
          map.easeTo({ center: [pins[0].lon, pins[0].lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
        } else if (pins.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const p of pins) bounds.extend([p.lon, p.lat]);
          // Clear of the header row — at the top on the desktop, at the
          // bottom on a phone — so no pin is framed under it.
          map.fitBounds(bounds, { padding: planPadding(), maxZoom: 12, duration: 700 });
        }
      }
    };

    syncRef.current = syncData;
    syncData();
    // `locale` is in the list so switching language re-labels the badges that
    // are already on the map, rather than waiting for the next generation.
  }, [segments, start, destination, via, showTet, locale, pinsDraggable]);

  /**
   * The active row's own pin, raised: larger, on top, with a slow orange ring
   * — so a rider who taps into „Caur (2)” in the form sees which pin that is
   * (rider, 2026-09-25). Found by its coordinates among the ride's own pins,
   * and re-applied whenever they are rebuilt (same deps as above, declared
   * after, so it runs after them). The other pins stay as they are.
   */
  const activePlace = controls?.activePlace ?? null;
  const activeKey = activePlace ? `${activePlace.lat},${activePlace.lon}` : "";
  useEffect(() => {
    const markers = [markerRef.current, destMarkerRef.current, ...viaMarkersRef.current].filter((x): x is maplibregl.Marker => Boolean(x));
    const undo: (() => void)[] = [];
    for (const marker of markers) {
      const { lat, lng } = marker.getLngLat();
      if (!activePlace || Math.abs(lat - activePlace.lat) > 1e-6 || Math.abs(lng - activePlace.lon) > 1e-6) continue;
      const el = marker.getElement();
      // MapLibre owns the element's transform, so the scale goes on what is
      // inside a default pin (its SVG) and the ring on the element itself.
      const inner = el.querySelector("svg") as SVGElement | null;
      const disc = !inner;
      // Above the other pins (a numbered stop is 2 already); the pending
      // marker, also 3 and added later, still paints on top of it.
      const wasZ = el.style.zIndex;
      el.style.zIndex = "3";
      el.dataset.activePin = "1";
      if (inner) { inner.style.transformOrigin = "50% 100%"; inner.style.transform = "scale(1.2)"; }
      const ring = el.animate(
        disc
          ? [{ boxShadow: "0 0 0 0 rgba(245,99,0,0.55)" }, { boxShadow: "0 0 0 8px rgba(245,99,0,0)" }]
          : [{ filter: "drop-shadow(0 0 0 rgba(245,99,0,0.8))" }, { filter: "drop-shadow(0 0 6px rgba(245,99,0,0.9))" }],
        { duration: 1100, iterations: Infinity, direction: disc ? "normal" : "alternate" },
      );
      undo.push(() => { ring.cancel(); el.style.zIndex = wasZ; delete el.dataset.activePin; if (inner) inner.style.transform = ""; });
    }
    return () => { for (const u of undo) u(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, segments, start, destination, via, showTet, locale, pinsDraggable]);

  /**
   * The pending mark — a point marked and not yet confirmed — as a marker the
   * rider can drag.
   *
   * It wears the pin it will become: the green start, the red finish, or the
   * orange stop disc with the number that row will get. It used to be a violet
   * pin of its own, "a fourth kind of thing", and the rider found that
   * illogical: he was marking the finish and saw something that was neither a
   * finish nor anything else on the map. What says "not yet" instead is the
   * way it is drawn — see-through and slowly pulsing, and a stop's disc with a
   * dashed edge — so a pending finish and a confirmed finish sit side by side
   * as the same pin, one of them still undecided.
   *
   * Rebuilt when the role or the number changes (the rider points the map at
   * another row), moved otherwise. `dragend` only: the reverse lookup behind a
   * move is a network request, and one per pointer sample would be a few
   * hundred requests per drag; MapLibre moves the marker under the finger
   * either way.
   */
  const pendingPin = controls?.pendingPin ?? null;
  const pendingPinKey = pendingPin ? `${pendingPin.role}:${pendingPin.number ?? ""}` : "none";
  const pendingPinKeyRef = useRef<string | null>(null);
  const batchMode = Boolean(controls?.batchMode);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    // In batch mode the marks are the batch's own pins (see below).
    if (!pickedPoint || batchMode) {
      pickedMarkerRef.current?.remove();
      pickedMarkerRef.current = null;
      pendingPinKeyRef.current = null;
      return;
    }
    if (!pickedMarkerRef.current || pendingPinKeyRef.current !== pendingPinKey) {
      pickedMarkerRef.current?.remove();
      const role = pendingPin?.role ?? "via";
      // A grabbed line point waits as the dot it will become, edge dashed.
      const marker = role === "shape"
        ? new maplibregl.Marker({ element: shapeDotElement(m.shapePointLabel, true), draggable: true })
        : role === "via"
        ? new maplibregl.Marker({ element: numberedStopElement(m.mapStop, pendingPin?.number ?? 1), draggable: true })
        : new maplibregl.Marker({ color: role === "start" ? START_PIN_COLOR : FINISH_PIN_COLOR, draggable: true });
      const el = marker.getElement();
      el.dataset.pending = role;
      // Above the ride's own pins. The moment a tap fills the row, the start
      // (or finish) marker appears at exactly the same coordinates and — being
      // added later — paints on top: measured, the pending marker was
      // completely hidden behind the green one and there was nothing left to
      // drag. The point being decided wins while it exists.
      el.style.zIndex = "3";
      if (role === "via") el.style.borderStyle = "dashed";
      // Opacity only: MapLibre owns this element's transform.
      el.animate([{ opacity: 0.5 }, { opacity: 0.9 }], { duration: 900, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
      marker.on("dragend", () => {
        const { lat, lng } = marker.getLngLat();
        onPickedPointMoveRef.current?.({ lat, lon: lng });
      });
      // A grabbed line point's connector, and the move preview, follow the
      // mark while it is dragged.
      marker.on("drag", () => {
        const { lat, lng } = marker.getLngLat();
        connectorRef.current({ lat, lon: lng });
        movePreviewRef.current({ lat, lon: lng });
      });
      pickedMarkerRef.current = marker;
      pendingPinKeyRef.current = pendingPinKey;
    }
    pickedMarkerRef.current.setLngLat([pickedPoint.lon, pickedPoint.lat]).addTo(map);
    // The coordinates, not the object. The parent rebuilds it on every reverse
    // lookup, and an identity dependency would re-run `setLngLat` for a point
    // that has not moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickedPoint?.lat, pickedPoint?.lon, pendingPinKey, batchMode]);

  /**
   * Keep the pending marker clear of the header.
   *
   * Confirm and Cancel live in the header now, beside the field (rider,
   * 2026-09-25: on the desktop the bar sat bottom-right while the search was
   * top-left, and a searched address had no Confirm anywhere near it). The
   * marker lands wherever the rider tapped, and a tap high on a phone map put
   * the pin behind the header — he could not see what he was confirming. So
   * when the marker's body is under the bar (or the off-road verdict above
   * it, about twice as tall), the map is panned just enough to stand it
   * clear, above the bar. Only then: a pin already in view is left where the
   * finger put it — the camera never follows a move.
   *
   * Keyed on what the header shows as well as on the point: the verdict comes
   * a moment after Confirm and is the taller of the two.
   */
  const pendingShown = !controls?.pending ? "" : controls.pending.offRoad ? "verdict" : "confirm";
  useEffect(() => {
    const map = mapRef.current;
    const header = headerRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    // Never while a batch grows: the camera moves only when the rider moves it.
    if (!ready || !map || !header || !box || !pickedPoint || !pendingShown || batchMode) return;
    const clear = () => {
      const el = pickedMarkerRef.current?.getElement();
      if (!el) return;
      const clearance = 12;
      const rows = header.getBoundingClientRect();
      const marker = el.getBoundingClientRect();
      // The bar is at the bottom at every width (ad96622): the marker must
      // stand above it, so the map is panned up just enough — on the desktop
      // too. The desktop branch still assumed a bar at the top and panned
      // every pending mark DOWN past the bottom bar, off the map (rider,
      // 2026-09-28: "when I move the line somewhere else, the map goes off
      // screen" — measured: a bend on Sigulda → Cēsis panned 415 px).
      const rowsTop = rows.top - box.top;
      const markerBottom = marker.bottom - box.top;
      if (markerBottom <= rowsTop - clearance) return;
      map.panBy([0, markerBottom - (rowsTop - clearance)], { duration: 300 });
    };
    // A place picked from the search arrives with its own `easeTo` (see
    // `pickCenter`), and the header's buttons change while that is still
    // running. Measured before either waited: the pin was judged where the
    // map *started*, and `panBy` cancelled the ease — the search pick was left
    // in the map's corner at the old zoom. So a moving map is judged where it
    // stops.
    if (map.isMoving()) {
      map.once("moveend", clear);
      return () => { map.off("moveend", clear); };
    }
    clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pendingShown, pickedPoint?.lat, pickedPoint?.lon]);

  /**
   * "Where am I", while a row is being picked.
   *
   * MapLibre's own control, with its own icon and its own error state — a
   * denied permission is something riders have seen a hundred times in other
   * map apps, and a sentence of ours beside it would add nothing.
   *
   * `trackUserLocation: false`: this centres once and then lets go. Tracking
   * would keep re-centring the map under a rider who is trying to drag a pin
   * onto a specific yard, which is the opposite of what the button is for.
   *
   * Added only in pick mode, because it is only ever an answer to "where do I
   * put this pin" — a finished route's map has no use for it and the corner is
   * already carrying the zoom controls.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!onPickPoint) {
      if (geolocateRef.current) { map.removeControl(geolocateRef.current); geolocateRef.current = null; }
      return;
    }
    if (geolocateRef.current) return;
    const control = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
      trackUserLocation: false,
      showAccuracyCircle: true,
    });
    // The permission prompt happens on the rider's tap and nowhere else — the
    // control never triggers itself, and nothing here calls `trigger()`.
    control.on("geolocate", (e) => {
      onGeolocatedRef.current?.({ lat: e.coords.latitude, lon: e.coords.longitude });
    });
    map.addControl(control, "top-right");
    geolocateRef.current = control;
  }, [ready, onPickPoint]);

  /**
   * The planning line: the confirmed pins joined straight, in riding order,
   * thin and dashed under the pins, and a pending mark's slot lighter still
   * (`lib/map/plan-line.ts`). One source, two layers; empty when there is
   * nothing to join, and never on a result or in edit mode, where the ride's
   * own line says it.
   */
  const planLineKey = controls?.planLine ? JSON.stringify(controls.planLine) : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const line = controls?.planLine ?? null;
    const apply = () => {
      const features: GeoJSON.Feature<GeoJSON.LineString, { kind: string }>[] = [];
      if (line?.confirmed.length) features.push({ type: "Feature", properties: { kind: "confirmed" }, geometry: { type: "LineString", coordinates: line.confirmed } });
      if (line?.pending?.length) features.push({ type: "Feature", properties: { kind: "pending" }, geometry: { type: "LineString", coordinates: line.pending } });
      const data: GeoJSON.FeatureCollection<GeoJSON.LineString, { kind: string }> = { type: "FeatureCollection", features };
      const source = map.getSource("plan-line") as maplibregl.GeoJSONSource | undefined;
      if (source) { source.setData(data); return; }
      map.addSource("plan-line", { type: "geojson", data });
      map.addLayer({ id: "plan-line", type: "line", source: "plan-line", filter: ["==", ["get", "kind"], "confirmed"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#c2410c", "line-width": 2, "line-opacity": 0.6, "line-dasharray": ["literal", [2, 3]] } });
      map.addLayer({ id: "plan-line-pending", type: "line", source: "plan-line", filter: ["==", ["get", "kind"], "pending"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#c2410c", "line-width": 2, "line-opacity": 0.35, "line-dasharray": ["literal", [0.5, 2]] } });
    };
    if (loadedRef.current) apply();
    else { map.once("load", apply); return () => { map.off("load", apply); }; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, planLineKey]);

  /**
   * A grabbed line point: a small white-bordered dot on the line where it was
   * taken, and a thin dashed connector from it to where it is going — the
   * pending mark, or the pointer while the line is being dragged. The dot is a
   * marker (above the line, like the pins); the connector a GeoJSON line.
   */
  const grabMarkerRef = useRef<maplibregl.Marker | null>(null);
  const grabAt = controls?.grab ?? null;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    if (!grabAt) {
      grabMarkerRef.current?.remove();
      grabMarkerRef.current = null;
    } else {
      if (!grabMarkerRef.current) {
        const el = document.createElement("div");
        el.style.cssText = "width:14px;height:14px;border-radius:7px;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,0.35);pointer-events:none";
        grabMarkerRef.current = new maplibregl.Marker({ element: el });
      }
      grabMarkerRef.current.setLngLat([grabAt.lon, grabAt.lat]).addTo(map);
    }
    const draw = (to: { lat: number; lon: number } | null) => {
      const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
        type: "FeatureCollection",
        features: grabAt && to ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[grabAt.lon, grabAt.lat], [to.lon, to.lat]] } }] : [],
      };
      if (!loadedRef.current) return;
      const source = map.getSource("grab-line") as maplibregl.GeoJSONSource | undefined;
      if (source) { source.setData(data); return; }
      map.addSource("grab-line", { type: "geojson", data });
      map.addLayer({ id: "grab-line", type: "line", source: "grab-line",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#2563eb", "line-width": 2, "line-opacity": 0.8, "line-dasharray": ["literal", [1.5, 2]] } });
    };
    connectorRef.current = draw;
    draw(pickedPoint ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, grabAt?.lat, grabAt?.lon, pickedPoint?.lat, pickedPoint?.lon]);

  /**
   * The move preview (`MapControls.movePreview`): straight, thin, dark grey
   * and finely dashed on a white edge — unlike the ridden line, the planning
   * line (orange) and the grab's connector (blue), and unlike the straight
   * segment a ride may one day carry (backlog 35), which will be drawn as
   * part of the ride. The neighbours are resolved once per preview; the
   * candidate end is redrawn live through `movePreviewRef`.
   */
  const movePreview = controls?.movePreview ?? null;
  const movePreviewKey = movePreview ? JSON.stringify(movePreview) : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const mp = movePreview;
    let ends: [number, number][] = [];
    if (mp?.neighbours) ends = mp.neighbours.map((p) => [p.lon, p.lat]);
    else if (mp?.origin) {
      const line: Point[] = featuresRef.current.flatMap((f, i) => (f.geometry.coordinates as Point[]).slice(i === 0 ? 0 : 1));
      if (line.length >= 2) {
        const cum = cumulative(line);
        const along = (p: { lat: number; lon: number }) => nearestAlong([p.lon, p.lat], line, cum).alongMeters;
        const same = (a: { lat: number; lon: number }, b: { lat: number; lon: number } | null) => Boolean(b) && Math.abs(a.lat - b!.lat) < 1e-7 && Math.abs(a.lon - b!.lon) < 1e-7;
        // Every place the line runs through, the moving point itself left out
        // (a dot being moved is drawn at its candidate spot).
        const anchors = [start, ...(via ?? []), ...(controls?.shapePoints ?? []), destination]
          .filter((p): p is { lat: number; lon: number } => Boolean(p))
          .filter((p) => !same(p, mp.origin ?? null) && !same(p, mp.candidate))
          .map((p) => ({ point: [p.lon, p.lat] as [number, number], along: along(p) }));
        ends = neighboursAlong(anchors, along(mp.origin), !destination);
      }
    }
    const draw = (to: { lat: number; lon: number } | null) => {
      const c: [number, number] | null = to ? [to.lon, to.lat] : null;
      const features: GeoJSON.Feature<GeoJSON.LineString>[] = !c ? [] : ends.map((e) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [e, c] } }));
      const data: GeoJSON.FeatureCollection<GeoJSON.LineString> = { type: "FeatureCollection", features };
      if (!loadedRef.current) return;
      const source = map.getSource("move-preview") as maplibregl.GeoJSONSource | undefined;
      if (source) { source.setData(data); return; }
      map.addSource("move-preview", { type: "geojson", data });
      map.addLayer({ id: "move-preview-edge", type: "line", source: "move-preview",
        layout: { "line-cap": "round" },
        paint: { "line-color": "#ffffff", "line-width": 4, "line-opacity": 0.7 } });
      map.addLayer({ id: "move-preview", type: "line", source: "move-preview",
        layout: { "line-cap": "butt" },
        paint: { "line-color": "#44403c", "line-width": 1.5, "line-opacity": 0.95, "line-dasharray": ["literal", [2, 2]] } });
    };
    movePreviewRef.current = draw;
    draw(mp?.candidate ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, movePreviewKey, segments]);

  /**
   * The batch's pending stops, drawn as dashed numbered pins in the stop
   * colour (the look a single pending stop has). A press selects one — ringed,
   * with a small ✕ that drops it alone — and the next mark or a drag moves
   * it; a pin the routable probe refused wears an amber edge. Rebuilt from the
   * list each time it changes: a batch is a handful of pins.
   */
  const batchMarkersRef = useRef<maplibregl.Marker[]>([]);
  const batchSelectRef = useRef(controls?.onBatchSelect);
  const batchMoveRef = useRef(controls?.onBatchMove);
  const batchDropRef = useRef(controls?.onBatchDrop);
  useEffect(() => { batchSelectRef.current = controls?.onBatchSelect; batchMoveRef.current = controls?.onBatchMove; batchDropRef.current = controls?.onBatchDrop; });
  const batchPins = controls?.batch ?? [];
  const batchPinsKey = batchPins.map((b) => `${b.id}:${b.lat},${b.lon}:${b.number}:${b.selected ? 1 : 0}:${b.failing ? 1 : 0}:${b.finish ? 1 : 0}`).join("|");
  useEffect(() => {
    const map = mapRef.current;
    for (const marker of batchMarkersRef.current) marker.remove();
    batchMarkersRef.current = [];
    if (!map || !ready) return;
    batchMarkersRef.current = batchPins.map((b) => {
      const el = numberedStopElement(b.finish ? m.mapFinish : m.mapStop, b.number);
      if (b.finish) { el.textContent = ""; el.style.background = FINISH_PIN_COLOR; }
      el.dataset.pending = b.finish ? "finish" : "via";
      el.dataset.batch = String(b.id);
      el.style.borderStyle = "dashed";
      el.style.zIndex = b.selected ? "4" : "3";
      el.style.cursor = "grab";
      if (b.failing) el.style.borderColor = "#f59e0b";
      if (b.selected) el.style.boxShadow = "0 0 0 4px rgba(245,99,0,0.35), 0 1px 3px rgba(0,0,0,0.32)";
      else el.animate([{ opacity: 0.55 }, { opacity: 0.95 }], { duration: 900, iterations: Infinity, direction: "alternate", easing: "ease-in-out" });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        sightClickAtRef.current = event.timeStamp;
        if (performance.now() - dragEndedAtRef.current < 400) return;
        batchSelectRef.current?.(b.id);
      });
      if (b.selected) {
        // The selected pin's own ✕: drop just this one.
        const drop = document.createElement("button");
        drop.type = "button";
        drop.setAttribute("aria-label", m.batchDropOne);
        drop.title = m.batchDropOne;
        drop.textContent = "×";
        drop.style.cssText = "position:absolute;top:-10px;right:-12px;width:18px;height:18px;border-radius:9px;background:#1c1917;color:#fff;font-size:13px;line-height:18px;text-align:center;border:1.5px solid #fff;padding:0;cursor:pointer";
        drop.addEventListener("click", (event) => {
          event.stopPropagation();
          sightClickAtRef.current = event.timeStamp;
          batchDropRef.current?.(b.id);
        });
        el.style.position = "relative";
        el.appendChild(drop);
      }
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([b.lon, b.lat]).addTo(map);
      marker.on("dragend", () => {
        dragEndedAtRef.current = performance.now();
        const { lat, lng } = marker.getLngLat();
        batchMoveRef.current?.(b.id, { lat, lon: lng });
      });
      return marker;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, batchPinsKey, locale]);

  /**
   * The ride's shaping points, edit mode only (see `MapControls.shapePoints`).
   * Rebuilt when the list changes — a ride has a handful. A press selects
   * it (`onShapePress` — the point sheet and the ring), and marks the gesture
   * as its own (`sightClickAtRef`), so the map's own click does not also land
   * on the line under the dot. Dots do not drag (see where the marker is made).
   */
  const shapeMarkersRef = useRef<maplibregl.Marker[]>([]);
  const shapePressRef = useRef(controls?.onShapePress);
  useEffect(() => { shapePressRef.current = controls?.onShapePress; });
  const shapeDots = controls?.shapePoints ?? [];
  const shapeDotsKey = shapeDots.map((p) => `${p.lat},${p.lon}`).join("|") + `|${controls?.shapeLabel ?? ""}`;
  useEffect(() => {
    const map = mapRef.current;
    for (const marker of shapeMarkersRef.current) marker.remove();
    shapeMarkersRef.current = [];
    if (!map || !ready) return;
    shapeMarkersRef.current = shapeDots.map((p, i) => {
      const el = shapeDotElement(controls?.shapeLabel ?? "");
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        sightClickAtRef.current = event.timeStamp;
        if (performance.now() - dragEndedAtRef.current < 400) return;
        infoPopupRef.current?.remove();
        shapePressRef.current?.(i);
      });
      // Not draggable (rider, 2026-09-25). A confirmed dot that still
      // followed the finger read as a point left half-edited, and on a phone
      // a tap on it that jittered a few pixels became a drag: MapLibre then
      // takes the dot's pointer events away for the gesture, the tap's click
      // fell through to the map beneath, and a waiting grab took the dot's
      // own spot as its new place — the dashed ghost and the broken line he
      // reported. A tap opens the dot's menu; that is all a dot does.
      return new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shapeDotsKey]);
  useEffect(() => () => { for (const marker of shapeMarkersRef.current) marker.remove(); }, []);

  /**
   * The point the rider tapped (`MapControls.selectedPoint`): a steady orange
   * ring around it, and the pin itself enlarged — the old faint blink was
   * missed on a phone (rider, 2026-09-25). The ring is a marker of its own
   * under the pins, so it looks the same around a teardrop, a numbered disc
   * or a white dot; the pin is found by its coordinates, the way the active
   * row's pin is. Gone the moment the selection ends.
   */
  const selectedAt = controls?.selectedPoint ?? null;
  const selectedKey = selectedAt ? `${selectedAt.lat},${selectedAt.lon}` : "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedAt) return;
    const ring = new maplibregl.Marker({ element: selectionRingElement() }).setLngLat([selectedAt.lon, selectedAt.lat]).addTo(map);
    const undo: (() => void)[] = [() => ring.remove()];
    const markers = [markerRef.current, destMarkerRef.current, ...viaMarkersRef.current, ...shapeMarkersRef.current].filter((x): x is maplibregl.Marker => Boolean(x));
    for (const marker of markers) {
      const { lat, lng } = marker.getLngLat();
      if (Math.abs(lat - selectedAt.lat) > 1e-6 || Math.abs(lng - selectedAt.lon) > 1e-6) continue;
      const el = marker.getElement();
      // MapLibre owns the element's transform, so a teardrop pin grows by its
      // SVG; a disc, a pill or a dot gets a white-and-orange edge instead.
      const inner = el.querySelector("svg");
      const was = { z: el.style.zIndex, shadow: el.style.boxShadow, radius: el.style.borderRadius };
      el.style.zIndex = "4";
      el.dataset.selectedPoint = "1";
      if (inner) { inner.style.transformOrigin = "50% 100%"; inner.style.transform = "scale(1.35)"; }
      else { el.style.borderRadius = "9999px"; el.style.boxShadow = "0 0 0 3px #fff, 0 0 0 6px #f56300"; }
      undo.push(() => { el.style.zIndex = was.z; el.style.boxShadow = was.shadow; el.style.borderRadius = was.radius; delete el.dataset.selectedPoint; if (inner) inner.style.transform = ""; });
    }
    return () => { for (const u of undo) u(); };
    // Same pin-rebuild deps as the active pin's raise, so a rebuilt pin is found again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedKey, segments, start, destination, via, showTet, locale, pinsDraggable, shapeDotsKey]);
  // The selected point is never left under its own sheet and the header row
  // (at the bottom on a phone, where the inline map is ~340 px tall): the map
  // pans it into the free part, once per selection and phase, after the sheet
  // is drawn. A phone's bottom sheet covers the page's lower part, so there
  // the page scrolls first, and the map pans for whatever scrolling cannot.
  const sheetMode = controls?.pointSheet?.mode ?? "";
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !selectedAt) return;
    const frame = requestAnimationFrame(() => {
      const project = () => {
        const box = map.getContainer().getBoundingClientRect();
        const at = map.project([selectedAt.lon, selectedAt.lat]);
        return { box, at, y: box.top + at.y, inside: at.x >= 0 && at.x <= box.width && at.y >= 0 && at.y <= box.height };
      };
      let p = project();
      if (!p.inside) return;
      const phone = window.matchMedia(PHONE_QUERY).matches;
      const sheet = document.querySelector('[data-point-sheet="menu"]')?.getBoundingClientRect();
      if (phone && sheet) {
        const target = sheet.top / 2;
        if (p.y < sheet.top - 32 && p.y > 24) return;
        window.scrollBy(0, p.y - target);
        p = project();
        if (Math.abs(p.y - target) > 24) map.panBy([0, p.y - target], { duration: 250 });
        return;
      }
      const header = headerRef.current?.getBoundingClientRect();
      if (!header) return;
      const top = header.top - p.box.top - 28;
      const bottom = header.bottom - p.box.top + 28;
      if (p.at.y < top || p.at.y > bottom) return;
      // Above the bottom bar: on a phone into the free half, on the desktop
      // just clear of it (the old target, below a bar at the top, was off the map).
      const target = phone ? Math.max(40, top / 2) : Math.max(40, top);
      map.panBy([0, p.at.y - target], { duration: 250 });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, selectedKey, sheetMode]);

  /**
   * After a batch is confirmed: every pin shown once, if one is off-screen —
   * the one camera move a batch makes, and only when it is needed.
   */
  const fitToken = controls?.fitToken ?? 0;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !fitToken) return;
    // A moment later, from the pins themselves: the confirmed stops reach this
    // map as props a render or two after the token does.
    const timer = setTimeout(() => {
      const pins = [markerRef.current, destMarkerRef.current, ...viaMarkersRef.current]
        .filter((x): x is maplibregl.Marker => Boolean(x))
        .map((x) => x.getLngLat());
      if (pins.length < 2) return;
      const view = map.getBounds();
      if (pins.every((p) => view.contains(p))) return;
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pins) bounds.extend(p);
      map.fitBounds(bounds, { padding: planPadding(), maxZoom: 13, duration: 700 });
    }, 300);
    return () => clearTimeout(timer);
  }, [ready, fitToken]);

  /**
   * Take the map to where the row's place already is when pick mode opens.
   *
   * Zoom 14, not the ride's bounds: a rider correcting a pin needs to see
   * which side of a village street he is on. Keyed on the token so pressing
   * the same row's pin twice flies back, for the reason `focus` does.
   */
  useEffect(() => {
    const map = mapRef.current;
    const box = containerRef.current?.getBoundingClientRect();
    if (!map || !pickCenter || !box) return;
    const phone = window.matchMedia(PHONE_QUERY).matches;
    // Left where it is when the place is already comfortably in view — clear
    // of the edges and of the header row (top on the desktop, bottom on a
    // phone). Activating a row is "show me where this is", not "zoom me in",
    // and a rider who has framed the ride himself keeps his frame (rider,
    // 2026-09-25). Otherwise eased to it at village zoom, nudged away from
    // the header row so the pin does not land under it.
    const at = map.project([pickCenter.lon, pickCenter.lat]);
    const rows = headerRef.current?.getBoundingClientRect();
    const margin = 48;
    const topEdge = !phone && rows ? rows.bottom - box.top + 12 : margin;
    const bottomEdge = phone && rows ? rows.top - box.top - 12 : box.height - margin;
    const inView = at.x >= margin && at.x <= box.width - margin && at.y >= topEdge + 24 && at.y <= bottomEdge;
    if (inView && map.getZoom() >= 10) return;
    // Far from the view (more than a view's width or height away) with other
    // places in the ride: frame them all, so the rider sees where the new
    // place sits in his ride rather than a village street with no context.
    const far = at.x < -box.width || at.x > 2 * box.width || at.y < -box.height || at.y > 2 * box.height;
    if (far && pickCenter.fit && pickCenter.fit.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pickCenter.fit) bounds.extend([p.lon, p.lat]);
      map.fitBounds(bounds, { padding: planPadding(), maxZoom: 14, duration: 800 });
      return;
    }
    map.easeTo({ center: [pickCenter.lon, pickCenter.lat], zoom: Math.max(map.getZoom(), 14), offset: [0, phone ? -40 : 30], duration: 700 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pickCenter?.token]);

  /**
   * "Kartē" on a suggestion: fly there, ring the place, open its card.
   *
   * Keyed on `focus.token` rather than on the place itself, so pressing the
   * same row twice flies back to it — a rider who has panned away and presses
   * again means "take me there", and comparing coordinates would make the
   * second press do nothing.
   *
   * `easeTo`, not `flyTo`: the target is often a few kilometres off the line
   * the map is already showing, and flyTo's zoom-out-and-back arc reads as the
   * map losing the route. Zoom 13 is close enough to see which side of the
   * road the place is on and wide enough to keep some of the ride on screen.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!focus) { clearFocusRef.current(); return; }

    focusMarkerRef.current?.remove();
    focusMarkerRef.current = new maplibregl.Marker({ element: focusElement() })
      .setLngLat([focus.lon, focus.lat])
      .addTo(map);

    infoPopupRef.current?.remove();
    // The same popup mechanism the 🅿️ markers and the segment card use, so
    // the rider meets one card style on the map. `mapStop` would be a lie
    // here — the place is not a stop — so the card carries the kind alone and
    // `stopInfoHtml` is given no `kind` fallback to fall back to.
    const popup = new maplibregl.Popup({ offset: 20, maxWidth: "260px", closeButton: true })
      .setLngLat([focus.lon, focus.lat])
      .setHTML(focusInfoHtml(m, focus, Boolean(onFocusToggleRef.current)))
      .addTo(map);
    infoPopupRef.current = popup;

    // The card's own Pievienot. Bound after `addTo`, which is when MapLibre
    // has parsed the markup and the element exists; the handler goes through a
    // ref so that a parent re-creating the callback every render — the
    // ordinary case for an inline arrow — is not a reason to rebuild the card
    // and lose the rider's place on the map.
    popup.getElement()?.querySelector<HTMLButtonElement>("[data-add]")
      ?.addEventListener("click", (event) => {
        event.stopPropagation();
        onFocusToggleRef.current?.();
      });
    // Closing the card with its own × is the same intent as clicking away, so
    // it goes through the one path that removes the ring and tells the parent.
    // `clearFocusRef` is what the interaction effect installed; it no-ops once
    // the marker is already gone, which is what keeps this from recursing when
    // the close came *from* `clearFocus` removing the popup.
    popup.on("close", () => clearFocusRef.current());

    map.easeTo({ center: [focus.lon, focus.lat], zoom: 13, duration: 800 });

    // Only the marker and this popup, never `clearFocus`: a cleanup that told
    // the parent would fire on the re-run that a *new* focus causes and
    // immediately undo the press.
    return () => {
      focusMarkerRef.current?.remove();
      focusMarkerRef.current = null;
      popup.remove();
      if (infoPopupRef.current === popup) infoPopupRef.current = null;
    };
    // `m` is read for the card's words; a language change while a card is open
    // re-renders it, which is right.
  }, [focus, m]);

  /**
   * The pills for the sights the rider has ticked.
   *
   * Its own effect, keyed on the selection alone, so ticking a row does not
   * disturb the route, the stops or the badges — those are rebuilt by the big
   * `segments` effect, and folding these in there would redraw the whole map
   * on every tick. Each is the kind's glyph in a ringed white pill: the same
   * mark the place will wear as a via once the ride is re-planned, so the
   * rider sees the answer before paying for it.
   *
   * The pill is not tappable — the ring is a statement, not a control, and
   * the card that would open is the list row's own Vairāk. It is drawn below
   * the ride's real stops so a ticked place can never hide one.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of selectedMarkersRef.current) marker.remove();
    selectedMarkersRef.current = (selectedPois ?? []).map((poi) => {
      const entry = POI_KIND[poi.category as keyof typeof POI_KIND];
      const el = stopElement(poi.name, entry?.icon ?? STOP_ICON, true);
      el.style.pointerEvents = "none";
      el.style.zIndex = "1";
      // A ticked place is a sight, so the layer switch governs it too.
      el.dataset.sight = "1";
      return new maplibregl.Marker({ element: el }).setLngLat([poi.lon, poi.lat]).addTo(map);
    });
    return () => {
      for (const marker of selectedMarkersRef.current) marker.remove();
      selectedMarkersRef.current = [];
    };
  }, [selectedPois]);

  /**
   * The places the ride already claims — its vias and the rider's ticks —
   * flattened to one string so the marks below are rebuilt when that set
   * actually changes and not merely when the parent re-renders.
   *
   * By id *and* by name: a via that arrived through a share code carries the
   * rider's label rather than the dataset's id, so matching on id alone would
   * draw a second, lighter pill on a place the ride already visits.
   */
  const takenKey = useMemo(
    () => [
      ...(selectedPois ?? []).flatMap((p) => [p.id, p.name]),
      ...(via ?? []).map((v) => v.label),
    ].join("\u0000"),
    [selectedPois, via],
  );

  /**
   * The sights the ride passes and the ones it runs near, drawn as soon as the
   * lookup answers.
   *
   * This is the change the rider asked for in part 2: a place already on his
   * route should be on the map the moment the list has loaded, without him
   * opening the card. The fetch therefore happens when the ride is shown (see
   * `lib/poi/use-route-pois.ts`) and the card reads the same state, so the two
   * views can never disagree about what is near this ride.
   *
   * A place the ride already carries — as a via, or as a tick — is skipped
   * here by id and by name: those have their own ringed pill from the effects
   * above, and two marks on one point read as two places. Name as well as id
   * because a via that arrived through a share code carries the rider's label
   * rather than the dataset's id.
   *
   * Its own effect, keyed on the lists, so a new list does not disturb the
   * route, the badges or the gates.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const marker of sightMarkersRef.current) marker.remove();
    sightMarkersRef.current = [];
    if (!routePois) return;

    const taken = new Set<string>(takenKey.split("\u0000").filter(Boolean));
    const draw = (poi: RoutePoi, group: "onRoute" | "nearby") => {
      if (taken.has(poi.id) || taken.has(poi.name)) return null;
      const entry = POI_KIND[poi.category];
      const el = sightElement(
        fi(group === "onRoute" ? m.resSightOnRouteAria : m.resSightNearbyAria, { place: poi.name }),
        entry?.icon ?? STOP_ICON,
        group,
      );
      // The same card a row's "Kartē" opens, for the same place: the rider
      // asked for one card, reachable from either side. The page owns it, so
      // this only reports the press — `focus` comes back down as a prop and
      // the focus effect draws the ring and the popup with its tick.
      el.addEventListener("click", (event) => {
        // Otherwise the click reaches the map and opens the segment card
        // underneath this one, exactly as it would on a badge.
        event.stopPropagation();
        // And this is what keeps the map's own click from immediately
        // clearing the card the next line asks for — see `sightClickAtRef`.
        sightClickAtRef.current = event.timeStamp;
        onShowPoiRef.current?.(poi);
      });
      // `data-sight-group` is what the low-zoom rule below reads: the nearby
      // group goes away under z8 and yields to a pill already placed within
      // ~18 px of it, the on-route group does neither.
      el.dataset.sight = "1";
      el.dataset.sightGroup = group;
      return new maplibregl.Marker({ element: el }).setLngLat([poi.lon, poi.lat]).addTo(map);
    };
    sightMarkersRef.current = [
      ...routePois.onRoute.map((p) => draw(p, "onRoute")),
      ...routePois.nearby.map((p) => draw(p, "nearby")),
    ].filter((mk): mk is maplibregl.Marker => mk !== null);

    return () => {
      for (const marker of sightMarkersRef.current) marker.remove();
      sightMarkersRef.current = [];
    };
    // `via` and `selectedPois` are read for the skip list but keyed by
    // `takenKey`: both props are rebuilt by their parent on every render — the
    // planner composes `via` inline in the JSX — and depending on the arrays
    // themselves would tear down and rebuild every mark on the map on every
    // keystroke elsewhere on the page. `m` is read for the labels, so a
    // language switch re-labels them.
  }, [routePois, takenKey, m]);

  /**
   * What "Apskates vietas" actually does, and the low-zoom rule.
   *
   * Visibility rather than existence, and its own effect rather than a
   * dependency of the effects that build the markers: flipping the switch must
   * not rebuild the route, the badges, the gates or the popups — and a rider
   * who flips it twice must get the same map back, not a redrawn one.
   *
   * Every sight marker on the map is marked `data-sight` by whichever effect
   * built it — the ride's added sights, the ticked ones, the on-route ones and
   * the nearby ones — so one rule reaches all four, which is what the rider
   * asked for: off means no sights, added ones included. The 🅿️ stops he
   * typed carry no mark and are never touched, and neither is the drawn line.
   *
   * The zoom rule is bound to the map's own `zoom` event rather than to React
   * state: a pinch fires it continuously and a setState per frame would
   * re-render the map's whole subtree.
   *
   * Since the nearby pills became full-size and start at z8, the same rule
   * also does the collision pass the rider's feedback implied: a place he can
   * see is the point, so when two pills would land on top of each other the
   * answer is to drop one, never to shrink it. Everything that is not a nearby
   * pill — the added sights, the ticked ones, the on-route ones — is placed
   * first and unconditionally, so a suggestion can only ever lose to a place
   * the ride actually carries, and nearby pills are placed in the lookup's own
   * order so the same pills survive from one `zoomend` to the next.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const nearbyVisible = showSights && map.getZoom() >= SIGHT_NEARBY_MIN_ZOOM;
      // Screen positions of everything already on the map, for the collision
      // pass. `project` is the map's own lng/lat → pixel, so this is measured
      // in what the rider actually sees rather than in degrees, which is what
      // makes one threshold work at every zoom.
      const placed: { x: number; y: number }[] = [];
      const nearby: { el: HTMLElement; marker: maplibregl.Marker }[] = [];
      for (const marker of [...sightMarkersRef.current, ...selectedMarkersRef.current, ...viaMarkersRef.current]) {
        const el = marker.getElement();
        if (!el.dataset.sight) continue;
        if (el.dataset.sightGroup === "nearby") {
          nearby.push({ el, marker });
          continue;
        }
        el.style.display = showSights ? "flex" : "none";
        if (showSights) placed.push(map.project(marker.getLngLat()));
      }
      for (const { el, marker } of nearby) {
        if (!nearbyVisible) {
          el.style.display = "none";
          continue;
        }
        const at = map.project(marker.getLngLat());
        const clash = placed.some(
          (p) => Math.abs(p.x - at.x) < SIGHT_COLLIDE_PX && Math.abs(p.y - at.y) < SIGHT_COLLIDE_PX,
        );
        el.style.display = clash ? "none" : "flex";
        if (!clash) placed.push(at);
      }
    };
    apply();
    map.on("zoomend", apply);
    // The big `segments` effect replaces the via markers wholesale, and the
    // sights effect replaces its own: a rule applied only on the switch's own
    // change would leave a freshly built pill visible under a switch that is
    // off. `routePois`, `via` and `selectedPois` are in the deps so the rule
    // is re-applied after every rebuild.
    return () => { map.off("zoomend", apply); };
  }, [showSights, routePois, takenKey, segments]);

  /**
   * Pointer behaviour on the route: the badge highlight, the hover readout and
   * the tap-a-segment card.
   *
   * All of it lives on the map's own event system and a handful of refs —
   * deliberately no React state. The hover handler runs on every pointer
   * sample over a route with hundreds of features, so it queries three named
   * layers and writes to one element's `style` and `textContent`; a setState
   * there would re-render this component on every mouse move.
   */
  useEffect(() => {
    // `mapRef` is filled by the mount effect above, which runs BEFORE this one
    // on the first commit — but only after its own body has run, so this must
    // not bail out permanently if it is ever null. `loadedRef` gates the parts
    // that need layers; the refs below are assigned either way, because the
    // badge markers capture them at creation time and a no-op left in place is
    // a badge that silently does nothing when clicked.
    const map = mapRef.current;

    const setHighlight = (ids: number[], key: string) => {
      if (!map) return;
      if (!map.getLayer("route-highlight")) return;
      // Clicking the same badge twice puts the highlight away again.
      const next = highlightKeyRef.current === key ? null : key;
      highlightKeyRef.current = next;
      map.setFilter("route-highlight", next ? highlightFilter(ids) : HIGHLIGHT_NONE);
    };
    const clearHighlight = () => {
      highlightKeyRef.current = null;
      if (map?.getLayer("route-highlight")) map.setFilter("route-highlight", HIGHLIGHT_NONE);
      if (map) clearGateHighlight(map);
      infoPopupRef.current?.remove();
      infoPopupRef.current = null;
    };
    setHighlightRef.current = setHighlight;
    clearHighlightRef.current = clearHighlight;
    // Without a map there is nothing to listen on; the refs above are still
    // live, so a later render wires the listeners up.
    if (!map) return;

    /** The feature under a point, tested as a box so a fingertip can hit it. */
    const featureAt = (point: maplibregl.Point) => {
      const layers = CLICKABLE_LAYERS.filter((id) => map.getLayer(id));
      if (!layers.length) return undefined;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [point.x - TAP_SLOP_PX, point.y - TAP_SLOP_PX],
        [point.x + TAP_SLOP_PX, point.y + TAP_SLOP_PX],
      ];
      return map.queryRenderedFeatures(box, { layers })[0];
    };

    const hover = hoverRef.current;
    const hideHover = () => {
      if (hover) hover.style.display = "none";
      map.getCanvas().style.cursor = "";
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const feature = featureAt(e.point);
      const props = feature?.properties as SegmentProps | undefined;
      if (!props) { hideHover(); return; }

      // Every segment is tappable (that is task D), but only a segment with
      // something to warn about earns a label that follows the cursor.
      //
      // It reads the whole list, not the first flag that matched: a stretch
      // that is both unverified AND a trail used to show only the warning
      // triangle, because the chain `unverified ? … : trail ? …` stopped at
      // the first. Same list and same filter the badges use, so the label and
      // the pill under the cursor never disagree.
      const warnings = badgeWarnings(warningsFor(m, props));
      map.getCanvas().style.cursor = "pointer";
      if (!warnings.length || !hover) { if (hover) hover.style.display = "none"; return; }

      const label = warnings.map((w) => w.title).join(" · ");
      // Direct DOM, no re-render: see the note on this effect. The icons are
      // emoji in a sized span, so building the label is string concatenation
      // and costs no React work in a mousemove handler.
      if (hover.dataset.label !== label) {
        // One warning per ROW, not a " · " run-on. A doubly-flagged stretch
        // read as one long line whose two labels ran together; the rider asked
        // for them stacked. A two-column grid rather than two flex rows so the
        // icons share a column and the words start at the same x whatever the
        // glyphs' widths — `auto 1fr` lets the icon column size to the widest
        // icon and gives the text the rest.
        hover.innerHTML = warnings
          .map((w) => `${warningIcon(w.kind)}<span>${esc(w.title)}</span>`)
          .join("");
        hover.dataset.label = label;
      }
      // The element is hidden with an inline `display:none`, so showing it
      // again has to restore the `grid` its class already asks for — an inline
      // style beats the class either way.
      hover.style.display = "grid";
      hover.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`;
    };

    /**
     * The one card: the segment's facts, its warnings and their explanations.
     *
     * Opened both by a click on the line and by a click on a badge, so the two
     * gestures can never stack two cards on top of each other. `props` is what
     * the click already queried; a badge has none and reads the source feature.
     */
    const openCard = (
      lngLat: maplibregl.LngLatLike,
      id: number,
      queried?: SegmentProps
    ) => {
      // The length is recomputed from the geometry rather than trusted from
      // the tile: `queryRenderedFeatures` returns clipped geometry, so the
      // property is the honest number and the fallback is for older shapes
      // that never carried one.
      const source = featuresRef.current[id];
      const props = { ...(queried ?? {}), ...(source?.properties ?? {}) } as SegmentProps;
      const meters = typeof props.distanceMeters === "number"
        ? props.distanceMeters
        : lineMeters(source?.geometry.coordinates ?? []);

      infoPopupRef.current?.remove();
      const popup = new maplibregl.Popup({ offset: 12, maxWidth: "260px", closeButton: true })
        .setLngLat(lngLat)
        .setHTML(segmentInfoHtml(m, locale, props, meters, gatesAlong(featuresRef.current).filter((g) => g.segmentIndex === id)))
        .addTo(map);
      infoPopupRef.current = popup;
      // The card and the highlight are one gesture: the rider should see which
      // line the numbers belong to. Keyed on the segment so tapping the same
      // one again closes both.
      const key = `segment:${id}`;
      if (highlightKeyRef.current === key) { clearHighlight(); return; }
      highlightKeyRef.current = null; // force it on rather than toggling off
      setHighlight([id], key);
    };
    openCardRef.current = (lngLat, id) => openCard(lngLat, id);

    /**
     * Take the "looking at this place" ring away.
     *
     * The parent is told as well as the map being cleaned, because the parent
     * owns the `focus` prop: clearing only the marker would leave the page
     * still believing a place was focused, and the next press on the *same*
     * row would then be a no-op change with nothing to re-render. Guarded on
     * the marker's existence so an ordinary click on empty map does not
     * announce a clear that clears nothing.
     */
    const clearFocus = () => {
      if (!focusMarkerRef.current) return;
      focusMarkerRef.current.remove();
      focusMarkerRef.current = null;
      infoPopupRef.current?.remove();
      infoPopupRef.current = null;
      onFocusClearedRef.current?.();
    };
    clearFocusRef.current = clearFocus;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      // The same gesture that pressed a sight's mark a moment ago. It is not a
      // click on the map and must not clear the card that press just opened;
      // MapLibre's click comes from the canvas container, so the marker's own
      // `stopPropagation` cannot reach it. Compared on the browser's own
      // timestamps, which are the same clock for both events.
      if (e.originalEvent.timeStamp - sightClickAtRef.current < 50) return;
      // Pick mode: this click is a place for the form and nothing else. It
      // returns before the segment lookup on purpose — a rider aiming at a
      // forest track is aiming at the drawn line as often as not, and opening
      // that road's card would both cover the point and leave the row empty.
      // A click on the drawn line never grabs it (rider, 2026-09-25: a
      // double-tap zoom's first tap left white points on his ride). Only a
      // deliberate drag does — see `lineDrag` below. So with a stop row
      // active, a tap on the line is that stop's new place, like any tap.
      // The release of a line drag, or of a hold on the line, is not a tap.
      if (performance.now() < lineClickMuteUntil) return;
      // A point's sheet is open: a tap on the map closes it, and does nothing
      // else — nothing moves until „Pārvietot”.
      const sheet = pointSheetRef.current;
      if (sheet?.mode === "menu") { sheet.onClose(); return; }
      const pick = onPickPointRef.current;
      if (pick) { pick({ lat: e.lngLat.lat, lon: e.lngLat.lng }); return; }
      const feature = featureAt(e.point);
      const props = feature?.properties as SegmentProps | undefined;
      const id = props?.[SEGMENT_ID];
      if (!props || typeof id !== "number") {
        // A click on empty map is how a rider puts the highlight — and the
        // temporary ring on a suggestion — away. While planning it never
        // creates anything: a new stop is the header's own button now, so a
        // tap here that hit nothing means nothing, which is what a map has
        // always meant by it.
        clearHighlight();
        clearFocus();
        return;
      }

      // A click that opens a segment card also ends the "look at this place"
      // gesture: the rider has moved on to asking about the road.
      clearFocus();
      openCard(e.lngLat, id, props);
    };

    /**
     * Whether a mouse event began on a marker — a pin or a shaping point's
     * dot sits ON the line, and pressing one to drag it must drag that marker,
     * not grab the line underneath it as well.
     */
    const onMarker = (e: maplibregl.MapMouseEvent): boolean =>
      Boolean((e.originalEvent.target as Element | null)?.closest?.(".maplibregl-marker"));

    /**
     * The drawn line under `point`, if any, grabbed there: the point is moved
     * onto the line itself and the stops before it counted along it, and the
     * form is told (`onLineGrab`). Only the route's own layers count — a pin,
     * a sight or a badge is a marker above the canvas and never reaches here.
     */
    const grabLineAt = (point: maplibregl.Point, lngLat: maplibregl.LngLat): boolean => {
      const grab = lineGrabRef.current;
      if (!grab || !featureAt(point)) return false;
      const line: Point[] = featuresRef.current.flatMap((f, i) => (f.geometry.coordinates as Point[]).slice(i === 0 ? 0 : 1));
      if (line.length < 2) return false;
      const cum = cumulative(line);
      const near = nearestAlong([lngLat.lng, lngLat.lat], line, cum);
      const on = pointAtDistance(line, cum, near.alongMeters).point;
      const slot = (viaRef.current ?? []).filter((v) => nearestAlong([v.lon, v.lat], line, cum).alongMeters < near.alongMeters).length;
      grab({ lat: on[1], lon: on[0], slot });
      return true;
    };

    /**
     * Drag the line: the only way a shaping point is made (`lineDragStep` in
     * lib/map/line-drag.ts has the rule and why). Mouse: press on the line —
     * `preventDefault` stops the map panning — and drag ≥ 12 px. Touch: hold
     * one finger still on the line, then drag ≥ 12 px; a finger that moves at
     * once pans, a second finger pinches, and neither grabs anything. The drag
     * draws the connector live; letting go is the new spot's mark, which then
     * waits for Confirm like any other.
     */
    let lineDrag: LineDragState | null = null;
    let lineDragFrom: { point: maplibregl.Point; lngLat: maplibregl.LngLat } | null = null;
    let lineDragLast: maplibregl.LngLat | null = null;
    let lineHoldTimer: ReturnType<typeof setTimeout> | null = null;
    let lineHoldRing: maplibregl.Marker | null = null;
    let lineClickMuteUntil = 0;
    const lineDragUndo = () => {
      if (lineHoldTimer) clearTimeout(lineHoldTimer);
      lineHoldTimer = null;
      lineHoldRing?.remove();
      lineHoldRing = null;
      // `dragPan` is gone once the map itself has been removed (the cleanup).
      if (map.dragPan && !map.dragPan.isEnabled()) map.dragPan.enable();
    };
    const lineDragFeed = (ev: LineDragEvent, at?: maplibregl.LngLat) => {
      const was = lineDrag;
      const { state, action } = lineDragStep(lineDrag, ev);
      lineDrag = state;
      if (at) lineDragLast = at;
      if (action === "arm" && lineDragFrom) {
        // The finger holds the line: the map stops panning under it, and a
        // ring where it rests says so.
        map.dragPan.disable();
        lineHoldRing = new maplibregl.Marker({ element: lineHoldElement() }).setLngLat(lineDragFrom.lngLat).addTo(map);
        navigator.vibrate?.(10);
      } else if (action === "grab" && lineDragFrom) {
        lineHoldRing?.remove();
        lineHoldRing = null;
        if (!grabLineAt(lineDragFrom.point, lineDragFrom.lngLat)) { lineDrag = null; lineDragUndo(); }
      } else if (action === "follow" && at) {
        connectorRef.current({ lat: at.lat, lon: at.lng });
        movePreviewRef.current({ lat: at.lat, lon: at.lng });
      } else if (action === "drop" || action === "abort") {
        // A hold or a drag that ends is not also a tap on the map.
        if (was && (was.phase === "dragging" || (was.pointer === "touch" && was.phase === "armed"))) lineClickMuteUntil = performance.now() + 700;
        lineDragUndo();
        const to = lineDragLast;
        lineDragFrom = null;
        if (action !== "drop" || !to) return;
        // The form opens the new point on the grab; its pick handler arrives
        // a render later, and the release can beat it.
        const spot = { lat: to.lat, lon: to.lng };
        let tries = 0;
        const deliver = () => {
          const pick = onPickPointRef.current;
          if (pick && grabbingRef.current) { pick(spot); return; }
          if (++tries < 40) setTimeout(deliver, 25);
        };
        deliver();
      }
    };
    const lineDragStart = (pointer: "mouse" | "touch", point: maplibregl.Point, lngLat: maplibregl.LngLat, fingers: number, onLine: boolean) => {
      lineDragUndo();
      lineDragFrom = { point, lngLat };
      lineDragLast = lngLat;
      lineDragFeed({ type: "down", pointer, x: point.x, y: point.y, at: performance.now(), onLine, fingers });
      if (lineDrag?.phase === "pressed") lineHoldTimer = setTimeout(() => lineDragFeed({ type: "hold", at: performance.now() }), LINE_HOLD_MS);
    };
    const lineGrabbable = () => Boolean(lineGrabRef.current) && !grabbingRef.current;
    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      // The mouse events a phone makes up after a tap are not a mouse.
      if (performance.now() - lastTouchEndAt < 800) return;
      if (!lineGrabbable() || e.originalEvent.button !== 0 || onMarker(e) || !featureAt(e.point)) return;
      e.preventDefault();
      lineDragStart("mouse", e.point, e.lngLat, 1, true);
    };
    const onDragMove = (e: maplibregl.MapMouseEvent) => {
      if (lineDrag?.pointer === "mouse") lineDragFeed({ type: "move", x: e.point.x, y: e.point.y, fingers: 1 }, e.lngLat);
    };
    const onMouseUp = () => { if (lineDrag?.pointer === "mouse") lineDragFeed({ type: "up" }); };
    const onTouchStart = (e: maplibregl.MapTouchEvent) => {
      const fingers = e.originalEvent.touches.length;
      // A tap waiting to settle is the first half of a double tap: drop it.
      if (tapTimer) { clearTimeout(tapTimer); tapTimer = null; }
      if (lineDrag) { lineDragFeed({ type: "move", x: e.point.x, y: e.point.y, fingers }); return; }
      if (!lineGrabbable()) return;
      const onLine = fingers === 1 && !(e.originalEvent.target as Element | null)?.closest?.(".maplibregl-marker") && Boolean(featureAt(e.point));
      if (onLine) lineDragStart("touch", e.point, e.lngLat, fingers, true);
    };
    const onTouchMove = (e: maplibregl.MapTouchEvent) => {
      if (!lineDrag) return;
      lineDragFeed({ type: "move", x: e.point.x, y: e.point.y, fingers: e.originalEvent.touches.length }, e.lngLat);
      // Held: the finger drags the line, not the page.
      if (lineDrag && lineDrag.phase !== "pressed") e.originalEvent.preventDefault();
    };
    const onTouchEnd = (e: maplibregl.MapTouchEvent) => {
      lastTouchEndAt = performance.now();
      if (lineDrag && e.originalEvent.touches.length === 0) lineDragFeed({ type: "up" });
    };
    const onTouchCancel = () => { if (lineDrag) lineDragFeed({ type: "move", x: 0, y: 0, fingers: 2 }); };

    /**
     * A tap on a phone settles for `TAP_SETTLE_MS` before it counts, and a
     * touch that begins meanwhile drops it: it was the first tap of a
     * double-tap zoom (or a tap-and-drag zoom), which marked the spot — or
     * added a pending stop row to a batch — as the map zoomed. The browser's
     * click follows its `touchend` within a few ms; a mouse click has none.
     */
    let lastTouchEndAt = -Infinity;
    let tapTimer: ReturnType<typeof setTimeout> | null = null;
    const onMapClick = (e: maplibregl.MapMouseEvent) => {
      if (performance.now() - lastTouchEndAt > 500) { onClick(e); return; }
      if (tapTimer) clearTimeout(tapTimer);
      tapTimer = setTimeout(() => { tapTimer = null; onClick(e); }, TAP_SETTLE_MS);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { clearHighlight(); clearFocus(); } };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onDragMove);
    map.on("mouseup", onMouseUp);
    map.on("touchstart", onTouchStart);
    map.on("touchmove", onTouchMove);
    map.on("touchend", onTouchEnd);
    map.on("touchcancel", onTouchCancel);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", hideHover);
    map.on("click", onMapClick);
    // The hover element must not be left hanging over the map while it moves.
    map.on("movestart", hideHover);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onDragMove);
      map.off("mouseup", onMouseUp);
      map.off("touchstart", onTouchStart);
      map.off("touchmove", onTouchMove);
      map.off("touchend", onTouchEnd);
      map.off("touchcancel", onTouchCancel);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", hideHover);
      map.off("click", onMapClick);
      if (tapTimer) clearTimeout(tapTimer);
      lineDragUndo();
      map.off("movestart", hideHover);
      window.removeEventListener("keydown", onKey);
    };
    // `segments` is a dependency so that the handlers are re-attached once the
    // map exists: on the very first commit `mapRef` can still be empty, and
    // without a second run the badge callbacks would keep calling the no-op
    // refs they were created with. `locale` moves with `m` — the segment card
    // formats its kilometres with it — and is listed so the rule can see it.
  }, [m, locale, segments]);

  // The container changes size on the phone (smaller while the chat has
  // something to say, full screen on request); MapLibre only notices when told.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The phone's legend switch, remembered per device (lib/map/layer-prefs).
  // Off on a phone, on on the desktop until the rider says otherwise; one
  // remembered choice per device (lib/map/layer-prefs).
  const [legendOpen, setLegendOpen] = useMapLegend();
  // The sights switch: a result with a ride, no header (see there). On a
  // phone it is the second row at the top-left, under TET.
  const sightsRow = !controls && Boolean(segments && segments.features.length > 0);
  // How many marks wait for ✓, for the collapsed preview's chip: the map can
  // be minimised with them pending, and must say so (lib/map/fullscreen).
  const pendingCount = controls?.pending ? controls.pending.count ?? 1 : 0;
  useEffect(() => { setMapPendingCount(pendingCount); }, [pendingCount]);
  useEffect(() => () => setMapPendingCount(0), []);

  // ── P1-D: proposal ──
  // The proposed edit's line over the dimmed ride (Phase 1). A no-op stub
  // until P1-D implements it.
  useProposalLayer(mapRef, ready, proposal ?? null);
  // ── /P1-D: proposal ──

  return (
    <div className="relative h-full w-full" data-map-pending={controls?.pending ? "true" : undefined}>
      <div ref={containerRef} className="h-full w-full rounded-lg" />

      {/* The label that follows the cursor over a warning stretch, so the
          rider can see which line a badge is about without clicking anything.
          Positioned by `transform` from the map's own mousemove handler and
          never re-rendered by React — see the interaction effect. Hidden from
          assistive tech and from the pointer: the badge and the segment card
          are the accessible paths to the same words. */}
      <div
        ref={hoverRef}
        aria-hidden="true"
        style={{ display: "none", gridTemplateColumns: "auto 1fr" }}
        className="pointer-events-none absolute left-0 top-0 z-10 grid items-center justify-items-start gap-x-2 gap-y-1 whitespace-nowrap rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium leading-none text-foreground shadow-sm backdrop-blur"
      />

      {/* The planning (and edit) bar: at the BOTTOM of the map at every width
          (rider, 2026-09-27 — switches at the top, adding places at the
          bottom, the desktop following the phone). The field, then ✓ ↶ +/✕
          in fixed slots — a row after the field on the desktop
          (`DesktopBar`), a column on the right edge on a phone
          (`PhoneColumn`), where MapPanel's collapse button takes the left
          slot of the row. Notices, the off-road verdict, the move hint and
          the point popover stack above the bar (`flex-col-reverse`), well
          under the switch row at the top. The field's suggestions open
          upward, over the map. */}
      <div ref={headerRef} data-map-chrome className={controls ? "absolute bottom-3 left-3 right-3 z-20 flex flex-col-reverse gap-2 has-[input:focus]:z-30 max-md:left-[4.75rem]" : "hidden"}>
      {controls && (
        /* The header, in ONE row — backlog 30. The rider's screenshot at
           375 px showed three stacked pills (the field, "+ Pietura", the hint)
           with TET under them: 127 px of a 341 px map, the top third, gone.

           Now: the field, whose leading tag names the row the map answers and
           whose placeholder says what a mark does ("Atzīmē kartē vai meklē…"),
           and beside it either a round "+" that makes a new stop — the words
           "+ Pietura" are its tooltip and its name for a screen reader — or,
           while a mark is pending, Confirm and Cancel. They used to be a bar
           at the bottom of the map; on the desktop that put Confirm in the
           far corner from the field the rider had just searched in (rider,
           2026-09-25). The full hint is the `role="status"` a screen reader
           hears whenever the active row changes, and the field's tooltip.

           With no row active a tap on the field starts a new stop — „+”'s
           own path — and the field searches for it („Meklē vai atzīmē kartē
           jaunu pieturu”, backlog 40); "+" stays, for adding by marking the
           map. When neither can act the field is off and looks it. */
        <div className="group flex items-center gap-1.5 max-md:relative max-md:gap-2 md:w-full md:max-w-xl">
          <span role="status" className="sr-only">{controls.hint}</span>
          <PlaceInput
            className="min-w-0 flex-1"
            value={controls.search.value}
            onChange={controls.search.onChange}
            onPick={controls.search.onPick}
            confirmed={controls.search.confirmed}
            near={controls.search.near}
            placeholder={phoneLayout ? controls.search.placeholderPhone ?? controls.search.placeholder : controls.search.placeholder}
            disabled={controls.search.disabled}
            onFocus={controls.search.onFocus ?? undefined}
            title={controls.hint}
            // At the bottom of a phone map the suggestions open upward, over
            // the map, instead of off its lower edge.
            placement="above"
            leading={controls.rowLabel && phoneLayout && controls.pendingPin ? <RowBadge pin={controls.pendingPin} label={controls.rowLabel} /> : controls.rowLabel ? (
              <span aria-hidden="true" className="shrink-0 rounded-full bg-[#fff3ea] px-2 py-0.5 text-[11px] font-semibold text-[#bd4b00]">
                {controls.rowLabel}
              </span>
            ) : undefined}
            compact
          />
          {/* ✓ ↶ + ✕: one row after the field on the desktop; on a phone
              ✓ ↶ + in a column on the right edge and ✕ after the field —
              every one always drawn, in fixed slots. */}
          <DesktopBar controls={controls} />
          <PhoneColumn controls={controls} />
        </div>
      )}
      {/* The tapped point's own actions — above the bottom bar (the column
          is reversed), like the notice. */}
      {controls?.pointSheet && <MapPointSheet sheet={controls.pointSheet} />}
      {/* ── P1-D: notice ── */}
      {/* Above the bottom bar (the column is reversed), clear of the switch
          row at the top, never squeezed into the field. A proposal's chip
          takes the same slot — its notes are its own (B4) — so the two never
          stack: landed, the delta („72,4 → 75,1 km · +6 min · …”) on white;
          routing, the same with a quiet spinner; refused, the reason in the
          notice's own amber, a line of text and not a badge. */}
      {/* Choices about the pending mark (Phase 1 addition): directly above
          the bar, one row of groups — each group's options side by side,
          wrapping only between groups — so the notice stays compact and the
          slots never move. */}
      {controls?.choices && controls.choices.length > 0 && (
        <div data-map-choices className="flex w-max min-w-0 max-w-full flex-wrap items-center gap-1.5 self-start max-md:-ml-16 max-md:mr-16">
          {controls.choices.map((group) => (
            <div key={group.key} role={group.action ? "group" : "radiogroup"} aria-label={group.label} data-choice-group={group.key}
              className="flex min-w-0 max-w-full items-center rounded-full border border-[#ececf0] bg-white/95 p-0.5 shadow-sm backdrop-blur">
              {group.options.map((option) => (
                <button key={option.key} type="button" role={group.action ? undefined : "radio"} aria-checked={group.action ? undefined : option.selected} data-choice={option.key}
                  title={option.title ?? option.label} onClick={option.onSelect}
                  className={`min-w-0 max-w-[11rem] shrink truncate rounded-full px-2.5 py-1 text-xs font-medium leading-tight transition max-md:px-2 max-md:text-[11px] ${group.action ? "bg-[#f56300] text-white hover:bg-[#d85600]" : option.selected ? "bg-stone-900 text-white" : "text-stone-600 hover:text-stone-900"}`}>
                  {option.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
      {controls && proposal ? (
        <div role="status" data-proposal-chip={proposal.tone ?? "proposed"} title={proposal.title} aria-label={proposal.title}
          className={`flex max-w-full items-start gap-1.5 self-start rounded-2xl border px-3 py-1 text-xs font-medium leading-snug shadow-sm backdrop-blur max-md:-ml-16 max-md:mr-16 ${proposal.tone === "refused" ? "border-amber-300 bg-amber-50/95 text-amber-900" : "border-[#ececf0] bg-white/95 text-foreground"}`}>
          {proposal.tone === "routing" && <LoaderCircle aria-hidden="true" className="mt-px size-3.5 shrink-0 animate-spin text-stone-400" />}
          {proposal.tone === "refused" && <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />}
          {/* The numbers on one line; the proposal's notes under them,
              smaller, at most two lines (the chip wrapped to four on a phone
              with the notes run on). */}
          <span className="min-w-0">
            <span data-proposal-text className="block tabular-nums max-md:text-[11px]">{proposal.text}</span>
            {proposal.notes && <span data-proposal-notes className="line-clamp-2 text-[10.5px] font-normal leading-snug text-stone-500">{proposal.notes}</span>}
          </span>
        </div>
      ) : controls?.notice && (
        <div role="status" title={controls.notice.title} aria-label={controls.notice.title}
          className="self-start rounded-2xl border border-amber-300 bg-amber-50/95 px-3 py-1 text-xs font-medium leading-snug text-amber-900 shadow-sm backdrop-blur max-md:mr-16">
          {controls.notice.text}
        </div>
      )}
      {/* ── /P1-D: notice ── */}
      {/* The off-road verdict, directly under the header it answers: the pin
          stays where he put it and the answer sits beside the Confirm he just
          pressed. `role="alert"`: it arrives after a press and replaces what
          Confirm was about to do. */}
      {controls?.pending?.offRoad && (
        <div role="alert" className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50/95 p-2.5 shadow-md backdrop-blur max-md:mr-16 md:max-w-md">
          <div className="flex gap-2 text-xs font-medium text-amber-900">
            <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
            <span className="min-w-0 flex-1">{controls.pending.offRoad.title}</span>
          </div>
          <div className="flex items-center gap-2">
            {controls.pending.offRoad.onMove && (
              <button type="button" onClick={controls.pending.offRoad.onMove}
                className="h-9 flex-1 rounded-full bg-[#f56300] px-3 text-xs font-semibold text-white transition hover:bg-[#d85600]">
                {controls.pending.offRoad.moveLabel}
              </button>
            )}
            <button type="button" onClick={controls.pending.offRoad.onDismiss}
              className={`h-9 rounded-full border border-amber-300 bg-white/80 px-3 text-xs font-medium text-amber-900 transition hover:bg-amber-100 ${controls.pending.offRoad.onMove ? "shrink-0" : "flex-1"}`}>
              {controls.pending.offRoad.dismissLabel}
            </button>
          </div>
        </div>
      )}
            </div>
      {/* The map's switches, ONE row at the top-left at every width (rider,
          2026-09-27: "too chaotic — put the toggles in ONE row; the legend can
          be switched on and off"): TET, the sights (a result with a ride
          only — sights are the ones a ride passes), the legend, all the same
          pill — a label and the orange switch — then the ⓘ map-data credit.
          Zoom and compass keep the top-right; adding places is the bottom bar.

          On a phone the pills go compact so the row never wraps at 320 px:
          no TET swatch, the sights pill its 📷 viewpoint mark alone (its words
          are its name and tooltip), the legend its word — or, below 360 px
          with the sights pill beside it, a list icon instead.

          Under the row, in the same column: the credit when ⓘ is open, then
          the legend when it is on — one compact box directly under the row,
          nothing when it is off. On a phone the legend only shows in full
          screen (the inline map is a preview). */}
      <div data-map-chrome className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-4.5rem)] flex-col items-start gap-2">
      <div data-map-toggles className="flex max-w-full items-center gap-1.5 max-md:gap-1 max-md:overflow-x-auto">
      <MapSwitch on={showTet} onToggle={() => onToggleTet(!showTet)} label="TET"
        swatch={<span aria-hidden="true" className="inline-block h-[3px] w-4 rounded-full max-md:hidden" style={{ background: TET_COLOR, opacity: showTet ? 0.9 : 0.3 }} />} />
      {sightsRow && (
        <MapSwitch on={showSights} onToggle={() => onToggleSights(!showSights)} label={m.resSightsLayer}
          name={showSights ? m.resSightsLayerHide : m.resSightsLayerShow} labelClass="max-md:sr-only"
          swatch={<span aria-hidden="true" className="inline-flex size-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[9px] leading-none" style={{ opacity: showSights ? 1 : 0.35 }}>{SIGHTS_SWATCH_ICON}</span>} />
      )}
      <MapSwitch on={legendOpen} onToggle={() => setLegendOpen(!legendOpen)} label={m.mapLegend}
        name={legendOpen ? m.mapLegendHide : m.mapLegendShow} labelClass={sightsRow ? "max-[359px]:sr-only" : ""}
        swatch={sightsRow ? <List aria-hidden="true" className="size-4 text-stone-500 min-[360px]:hidden" /> : undefined} />
      <button type="button" onClick={() => setCreditOpen((v) => !v)} aria-expanded={creditOpen}
        aria-label={m.mapCreditToggle} title={m.mapCreditToggle}
        className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-[#ececf0] bg-white/95 text-stone-700 shadow-sm backdrop-blur transition-colors hover:bg-white">
        <Info aria-hidden="true" className="size-4" />
      </button>
      </div>
      {creditOpen && (
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer"
          className="max-w-full truncate rounded-full border border-[#ececf0] bg-white/95 px-3 py-1.5 text-[11px] text-stone-700 shadow-sm backdrop-blur hover:underline">
          {m.mapCredit}
        </a>
      )}
      {legendOpen && (
      <div className="max-w-full max-md:hidden max-md:[[data-map-expanded]_&]:block">
      <div data-map-legend className="flex w-max max-w-full flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white/95 px-2.5 py-2 text-xs leading-none shadow-sm backdrop-blur md:px-3 md:py-2.5">
        {/* Two rows, because the line carries two independent facts and a
            single row could only ever explain one of them. Row 1 is the
            colours — what the surface is; row 2 is the patterns — what kind of
            way it is. Read together they cover all twelve combinations with
            seven entries, which is why a blue dashed line (a paved forest
            track) is now something the legend can actually say.

            No heading, and no "colour:" / "pattern:" labels either: the
            swatches are the distinction — four flat colours above, three grey
            patterns below — and at the bottom of a phone map every line costs
            more than it explains. Each row wraps on its own. */}
        <div className="flex flex-col gap-1.5">
          {/* Colour = surface. Flat solid samples: the pattern is deliberately
              not varied here, or the row would be making two claims at once. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: SURFACE_COLORS.asphalt }} />
              {m.legendAsphalt}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: SURFACE_COLORS.gravel }} />
              {m.legendGravel}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: SURFACE_COLORS.dirt }} />
              {m.resDirt}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: SURFACE_COLORS.unknown }} />
              {m.legendUnknown}
            </span>
          </div>
          {/* Pattern = road class, drawn in a neutral dark grey. Painting these
              samples in any route colour would imply a surface — "dashed means
              orange" is exactly the confusion the two-row legend exists to
              undo — so the ink here says nothing but the shape. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: PATTERN_INK }} />
              {m.legendSolid}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${PATTERN_INK} 0 5px, transparent 5px 8px)`,
                }}
              />
              {m.legendTrack}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${PATTERN_INK} 0 2px, transparent 2px 5px)`,
                }}
              />
              {m.legendTrail}
            </span>
            {/* The TET sample is the casing, not the overlay line: a purple
                halo around the route's own colour, which is what the rider
                now sees where their ride runs along the trail. Shown whether
                or not the reference overlay is switched on, because the
                casing is too — it is a fact about this route, not a layer.
                Its core stays gravel orange: this swatch is about the halo. */}
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[7px] w-5 rounded-full"
                style={{
                  background: SURFACE_COLORS.gravel,
                  boxShadow: `0 0 0 2px ${TET_COLOR}`,
                }}
              />
              TET
            </span>
          </div>
        </div>
      </div>
      </div>
      )}
      </div>
      
    </div>
  );
}
