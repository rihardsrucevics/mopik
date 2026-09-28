"use client";

import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type * as maplibregl from "maplibre-gl";
import type { ProposalView, Segments } from "@/lib/map/edit-proposal";
import type { Point } from "@/lib/geo/geometry";
import { cumulative, pointAtDistance } from "@/lib/routing/detour";

/**
 * The proposed edit on the map (Phase 1, docs/DESIGN-route-editing.md B4):
 * the new stretch in its real surface colours with a yellow halo over the
 * ride dimmed to 0.3, gone the moment `proposal` is null.
 *
 * ## Reusing the ride's own look
 *
 * The proposed line is drawn in exactly the ride's colours and road-class
 * patterns (F3: not grey — grey means "surface unknown" and, from Phase 2,
 * "drawn"). Rather than copy `route-map.tsx`'s colour and dash expressions,
 * each proposal layer is a clone of the live ride layer it mirrors
 * (`route-casing` → `proposal-casing`, …), read back from the map's own style
 * with only its id and source changed. The two can therefore never drift: a
 * new surface colour or dash rhythm reaches the preview with no edit here.
 * The halo is `route-highlight`'s own paint (the badge yellow) without its
 * "match nothing" filter, over the `changed` metre ranges only.
 *
 * ## Dimming and cleaning up
 *
 * While a line is shown the ride's layers are dimmed to 0.3 of their own
 * opacity, and put back to exactly what they were when it goes — values read
 * off the map the first time it is dimmed, per map instance. Every change of
 * proposal clears the layers and draws them again from scratch (they change
 * at most every 250 ms, the page's debounce), so null, unmount and a map torn
 * down under the hook all leave nothing behind. A style reload wipes sources
 * and layers; `styledata` puts them back once the ride's layers are there.
 */

const SOURCE = "proposal";
const HALO_SOURCE = "proposal-halo";
/** Proposal layer → the ride layer it is a copy of, bottom to top. */
const CLONES: [string, string, string][] = [
  // [proposal layer id, ride layer it copies, source]
  ["proposal-halo", "route-highlight", HALO_SOURCE],
  ["proposal-casing", "route-casing", SOURCE],
  ["proposal-road", "route-road", SOURCE],
  ["proposal-track", "route-track", SOURCE],
  ["proposal-trail", "route-trail", SOURCE],
  ["proposal-drawn", "route-drawn", SOURCE],
  ["proposal-drawn-dash", "route-drawn-dash", SOURCE],
];
/** The ride's layers the proposal dims. */
const RIDE_LAYERS = ["route-glow", "route-highlight", "route-tet", "route-casing", "route-road", "route-track", "route-trail", "route-drawn", "route-drawn-dash"] as const;
/** What the ride is dimmed to, as a share of each layer's own opacity. */
export const RIDE_DIM = 0.3;
/**
 * Layers the edit draws on top of the ride — the grabbed-line connector and
 * the move preview. The proposal goes under them, so a pending move's dashes
 * still read over the new stretch.
 */
const ABOVE = ["plan-line", "grab-line", "move-preview-edge", "move-preview"];

/** Each map's ride opacities before the first dim, to put back exactly. */
const originals = new WeakMap<maplibregl.Map, Record<string, number>>();

/** The ride's coordinates in order, feature after feature, shared joints once. */
function flatten(line: Segments): Point[] {
  const out: Point[] = [];
  for (const f of line.features) for (const c of f.geometry.coordinates as Point[]) {
    const last = out[out.length - 1];
    if (!last || last[0] !== c[0] || last[1] !== c[1]) out.push(c);
  }
  return out;
}

/**
 * The `changed` metre ranges along `line` as line strings, for the halo.
 * Out-of-range and empty ranges are clamped or dropped, never guessed at.
 */
export function haloLines(line: Segments, changed: [number, number][]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  const coords = flatten(line);
  const features: GeoJSON.Feature<GeoJSON.LineString>[] = [];
  if (coords.length < 2) return { type: "FeatureCollection", features };
  const cum = cumulative(coords);
  const total = cum[cum.length - 1];
  for (const [rawA, rawB] of changed) {
    const a = Math.max(0, Math.min(total, Math.min(rawA, rawB)));
    const b = Math.max(0, Math.min(total, Math.max(rawA, rawB)));
    if (!(b > a)) continue;
    const from = pointAtDistance(coords, cum, a);
    const to = pointAtDistance(coords, cum, b);
    const mid: Point[] = [];
    for (let i = from.index; i < to.index; i++) if (cum[i] > a && cum[i] < b) mid.push(coords[i]);
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [from.point, ...mid, to.point] } });
  }
  return { type: "FeatureCollection", features };
}

const opacityOf = (map: maplibregl.Map, id: string): number => {
  const v = map.getPaintProperty(id, "line-opacity");
  return typeof v === "number" ? v : 1;
};

function dimRide(map: maplibregl.Map) {
  let saved = originals.get(map);
  if (!saved) {
    saved = {};
    for (const id of RIDE_LAYERS) if (map.getLayer(id)) saved[id] = opacityOf(map, id);
    originals.set(map, saved);
  }
  for (const id of RIDE_LAYERS) if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", (saved[id] ?? 1) * RIDE_DIM);
}

function restoreRide(map: maplibregl.Map) {
  const saved = originals.get(map);
  if (!saved) return;
  originals.delete(map);
  for (const id of RIDE_LAYERS) if (map.getLayer(id) && id in saved) map.setPaintProperty(id, "line-opacity", saved[id]);
}

/** Removes every proposal layer and source and undims the ride. Safe on a removed map. */
function removeProposalLayers(map: maplibregl.Map) {
  for (const [id] of [...CLONES].reverse()) if (map.getLayer(id)) map.removeLayer(id);
  for (const src of [SOURCE, HALO_SOURCE]) if (map.getSource(src)) map.removeSource(src);
}

function clearProposal(map: maplibregl.Map) {
  try {
    removeProposalLayers(map);
    restoreRide(map);
  } catch {
    // The map was removed first (`RouteMap`'s own cleanup runs before this
    // hook's): its layers went with it and there is nothing left to clear.
    originals.delete(map);
  }
}

/**
 * Draws `line` + halo. False when the ride's layers are not there yet (the
 * map has not loaded, or its style is reloading) — the caller waits.
 */
function drawProposal(map: maplibregl.Map, line: Segments, changed: [number, number][]): boolean {
  if (!map.getLayer("route-road")) return false;
  const specs = new Map((map.getStyle().layers ?? []).map((l) => [l.id, l]));
  if (CLONES.some(([, from]) => !specs.has(from))) return false;
  // Opacities from before any dim: the proposal is drawn at the ride's full
  // strength, not at the 0.3 the ride is about to be put at.
  const full = originals.get(map);
  // Whatever half of a proposal a reload left behind goes first.
  removeProposalLayers(map);
  map.addSource(SOURCE, { type: "geojson", data: line });
  map.addSource(HALO_SOURCE, { type: "geojson", data: haloLines(line, changed) });
  const before = ABOVE.find((id) => map.getLayer(id));
  for (const [id, from, source] of CLONES) {
    const spec = specs.get(from) as maplibregl.LineLayerSpecification;
    const clone: maplibregl.LineLayerSpecification = {
      ...spec,
      id,
      source,
      paint: { ...spec.paint, "line-opacity": full?.[from] ?? opacityOf(map, from) },
    };
    // The halo's source is the changed stretches alone; the ride's badge
    // filter ("match nothing" until a badge is pressed) must not come along.
    if (from === "route-highlight") delete clone.filter;
    map.addLayer(clone, before);
  }
  dimRide(map);
  return true;
}

/**
 * The ✓'s view of the proposal, for `DesktopBar` / `PhoneColumn`, which get
 * only `controls`: whether the shown proposal is refused (✓ disabled with
 * `previewConfirmRefused`). One entry per mounted hook, so a second map
 * without a proposal never clears the first one's.
 */
const tones = new Map<symbol, ProposalView["tone"] | "shown" | "warn">();
const listeners = new Set<() => void>();
const notify = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const refusedNow = () => [...tones.values()].includes("refused");
/** True while a mounted map shows a refused proposal. */
export function useProposalRefused(): boolean {
  return useSyncExternalStore(subscribe, refusedNow, () => false);
}
const warnNow = () => [...tones.values()].includes("warn");
/** True while a mounted map shows a proposal that waits for „Tomēr braukt” (`ProposalView.warn`): ✓ is off. */
export function useProposalWarn(): boolean {
  return useSyncExternalStore(subscribe, warnNow, () => false);
}

export function useProposalLayer(
  mapRef: RefObject<maplibregl.Map | null>,
  ready: boolean,
  proposal: ProposalView | null,
): void {
  const line = proposal?.line ?? null;
  const changedKey = proposal ? JSON.stringify(proposal.changed) : "";
  const tone = proposal ? proposal.tone ?? (proposal.warn ? "warn" : "shown") : undefined;

  useEffect(() => {
    const key = Symbol("proposal");
    if (tone) { tones.set(key, tone); notify(); }
    return () => { if (tones.delete(key)) notify(); };
  }, [tone]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !line) return;
    const changed = JSON.parse(changedKey || "[]") as [number, number][];
    drawProposal(map, line, changed);
    // Not loaded yet, or a style reload wiped the layers: draw again as soon
    // as the ride's layers are back. Own `addLayer` calls fire `styledata`
    // too; with the source in place the check is a no-op.
    const onStyle = () => {
      if (map.getSource(SOURCE)) return;
      // A reloaded style brings the ride back at full strength: what was
      // saved is stale. A ride still at the dim this hook set keeps it.
      const saved = originals.get(map);
      if (saved && map.getLayer("route-road")
        && Math.abs(opacityOf(map, "route-road") - (saved["route-road"] ?? 1) * RIDE_DIM) > 1e-6) originals.delete(map);
      drawProposal(map, line, changed);
    };
    map.on("styledata", onStyle);
    return () => {
      try { map.off("styledata", onStyle); } catch { /* map already removed */ }
      clearProposal(map);
    };
  }, [mapRef, ready, line, changedKey]);
}
