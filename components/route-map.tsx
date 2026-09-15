"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RouteSegmentProperties } from "@/lib/types";
import { haversineMeters } from "@/lib/geo/geometry";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import { fi } from "@/lib/i18n/format";
import type { UiLocale } from "@/lib/i18n/locale";
import { POI_KIND, type RoutePoi, type RoutePois } from "@/lib/poi/kinds";

// Serve the MapLibre worker from /public — bundler-emitted module workers
// 404 under the Next.js dev server, leaving the map blank.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

type Props = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null;
  start: { lat: number; lon: number } | null;
  destination?: { lat: number; lon: number } | null;
  /**
   * The ride's stops. `kind` and `detail` are optional and filled in from the
   * POI dataset where the stop is a place it knows — a hillfort's marker then
   * says so, and one the rider typed by hand simply says "Pieturvieta".
   */
  via?: {
    lat: number; lon: number; label: string; kind?: string; detail?: string;
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
   * - these, in `nearby` — near the route and not in it. Lighter still and
   *   smaller, because the map must not read as though the ride visits them.
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
    if (!missing.length) return;
    await Promise.all(missing.map(async (country) => {
      // Mark it taken first: panning fires this faster than a fetch returns,
      // and the same country must not be downloaded twice.
      tetLoaded.set(country, []);
      const res = await fetch(`/tet/${country}.geojson`);
      if (!res.ok) { tetLoaded.delete(country); return; }
      const fc = (await res.json()) as GeoJSON.FeatureCollection;
      tetLoaded.set(country, fc.features);
    }));

    const source = map.getSource("tet") as maplibregl.GeoJSONSource | undefined;
    source?.setData({ type: "FeatureCollection", features: [...tetLoaded.values()].flat() });
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
 * 🚪, and why it is a door rather than 🚧 or ⛩️.
 *
 * 🚧 is the roadworks barrier: it says "closed, works ahead", which is the one
 * thing a Latvian forest gate usually is not — it stands open more often than
 * not, and that is exactly why item 12 reports gates instead of avoiding them.
 * ⛩️ is a Shinto torii; it reads as a gateway but means a shrine, and its
 * crossbeams turn to mush at this size. 🚪 is a rectangle with a handle: almost
 * no internal detail, so it survives being drawn at 13 px in a 20 px pill, and
 * it means the thing the card says — something across your way that you can
 * open. Same glyph in the RISKI row (`GATE_ICON` in `result-panel.tsx`).
 */
const GATE_EMOJI = "🚪";

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
function gateElement(title: string): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    "width:20px;height:20px;border-radius:10px;" +
    "background:rgba(255,255,255,0.92);box-shadow:0 1px 2px rgba(0,0,0,0.2);" +
    "line-height:0;cursor:pointer;user-select:none;border:0;padding:0;opacity:0.9;" +
    // Under the warning badges (1) and the stops (2).
    "z-index:0";
  el.innerHTML =
    `<span aria-hidden="true" style="display:inline-flex;align-items:center;` +
    `justify-content:center;width:14px;height:14px;font-size:13px;line-height:1">` +
    `${GATE_EMOJI}</span>`;
  return el;
}

/** One gate to mark, and the run it belongs to so a click can open that card. */
type GateMark = { point: [number, number]; segmentId: number | undefined };

/**
 * Every gate on the route, thinned to `GATE_MARKER_MAX`.
 *
 * Thinned by taking every k-th rather than the first thirty: a ride whose gates
 * are all in its last forest would otherwise show none of them. The count the
 * rider reads is the panel's, which is never thinned.
 */
function gateMarksFor(segments: GeoJSON.FeatureCollection): GateMark[] {
  const all: GateMark[] = [];
  for (const f of segments.features) {
    const props = (f.properties ?? {}) as SegmentProps;
    const points = props.gatePoints;
    if (!points?.length) continue;
    const id = props[SEGMENT_ID];
    for (const point of points) all.push({ point, segmentId: typeof id === "number" ? id : undefined });
  }
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
 * The rider asked to be able to tap a segment and see its facts. Everything
 * here is already known per feature — the class, the surface, the grade, the
 * length and the two warning flags — and the panel's own vocabulary is reused
 * so the card and the numbers above the map agree on what a "Meža ceļš" is.
 */
function segmentInfoHtml(
  m: Messages,
  props: SegmentProps,
  meters: number
): string {
  const rows: string[] = [];
  const row = (label: string, value: string) =>
    rows.push(
      `<div style="display:flex;gap:8px;justify-content:space-between">` +
      `<span style="color:#6b7280">${esc(label)}</span>` +
      `<span style="text-align:right">${esc(value)}</span></div>`
    );

  row(m.resDistance, `${Math.round(meters / 100) / 10} km`);
  row(m.resSurfaceHeading, surfaceLabel(m, props.surface));
  // The raw OSM value only when it says something the label above does not.
  if (props.trackGrade) row(m.segGrade, props.trackGrade);

  // The same list the badges are built from — including the kinds the map
  // does not badge (`BADGE_KINDS`), because a card is a list and can say
  // everything the run carries. The icon markup is ours; only the words that
  // come from a tag or a translation are escaped.
  //
  // This card is now the ONLY thing a badge opens, so it also carries the
  // explanation the badge's own popup used to show. A warning with a detail
  // paragraph becomes a `<details>`: one line by default, the full text on
  // tap. `<details>` rather than a click handler because the popup's HTML is
  // set as a string and has no React or listeners of its own.
  const flags = warningsFor(m, props).map((w) => {
    // Rough track has no icon (see `WARNING_EMOJI`) — its row is words only.
    // The text still starts at the icon column's edge so the rows line up:
    // an empty 18 px cell, not a missing one.
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
  const gateCount = props.gates ?? 0;
  if (gateCount > 0) {
    flags.push(
      `<div style="display:flex;align-items:flex-start;gap:6px">` +
      `<span aria-hidden="true" style="display:inline-flex;align-items:center;` +
      `justify-content:center;width:${WARNING_ICON_PX}px;flex:none;` +
      `font-size:${WARNING_EMOJI_FONT_PX}px;line-height:1">${GATE_EMOJI}</span>` +
      `<span>${esc(fi(m.segGates, { n: gateCount }))}</span></div>`
    );
  }

  if (props[ON_TET]) {
    flags.push(
      `<div style="display:flex;align-items:center;gap:6px">` +
      `<span>${TET_LEGEND_ICON}</span><span>${esc(m.segOnTet)}</span></div>`
    );
  }

  return (
    `<div style="font-size:12px;line-height:1.5;min-width:170px">` +
    // Safari keeps its own disclosure triangle on a `<summary>` unless the
    // `-webkit-details-marker` pseudo-element is hidden, and a pseudo-element
    // cannot be set from an inline style. The rider is on an iPhone, so the
    // rule ships with the card rather than in the global sheet, where a popup
    // this file builds as a string would be the only thing using it.
    `<style>.mopik-warn>summary::-webkit-details-marker{display:none}</style>` +
    `<strong style="display:block;padding-right:24px;margin-bottom:4px">` +
    `${esc(segmentHeading(m, props.roadClass, props.surface))}</strong>` +
    rows.join("") +
    (flags.length
      ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #ececf0">` +
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
 * Measured, and the reason the legend has no 🅿️ entry: at 390 px the pattern
 * row (solid / raustītā / punktotā / TET) is exactly one line, 12 px high, and
 * a "🅿️ Pieturvieta" entry is 77 px wide against the 314 px the legend has
 * there — it wraps the row to two lines, 30 px. The legend is already a third
 * of a phone map's height and covers the route it explains, so the entry is
 * deliberately skipped. The marker explains itself by being tappable: the
 * card it opens names the place and says "Pieturvieta" in the rider's own
 * language, which the legend could only repeat. Re-measure before adding it —
 * the probe is four lines of DOM in the console.
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
 * - `nearby` — a 16 px muted dot with the glyph shrunk inside it, at reduced
 *   opacity. Visible when scanned for, invisible when not.
 *
 * Both sit at z-index 0 — the rider asked for them below the warning badges
 * (1), because a hazard on the road outranks a sight beside it — and `nearby`
 * goes below the gate pills too, which are the same "expect this" register.
 */
function sightElement(title: string, icon: string, group: "onRoute" | "nearby"): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.title = title;
  el.setAttribute("aria-label", title);
  const onRoute = group === "onRoute";
  const size = onRoute ? 22 : 16;
  el.style.cssText =
    "display:flex;align-items:center;justify-content:center;" +
    `width:${size}px;height:${size}px;border-radius:${size / 2}px;` +
    (onRoute
      ? "background:rgba(255,255,255,0.95);border:1px solid #d6d3d1;" +
        "box-shadow:0 1px 2px rgba(0,0,0,0.16);z-index:0;"
      : // Muted rather than merely small: a dozen of these around a ride is a
        // lot of ink, and at full strength they compete with the line itself.
        "background:rgba(255,255,255,0.85);border:1px solid #e7e5e4;" +
        "box-shadow:0 1px 1px rgba(0,0,0,0.10);opacity:0.75;z-index:0;") +
    "line-height:0;cursor:pointer;user-select:none;padding:0";
  el.innerHTML =
    `<span aria-hidden="true" style="display:inline-flex;align-items:center;` +
    `justify-content:center;font-size:${onRoute ? 14 : 10}px;line-height:1">${icon}</span>`;
  return el;
}

/**
 * Below this zoom the nearby group is not drawn at all.
 *
 * The rider's own instruction, and the reason is visible at z8: a ride across
 * three countries carries dozens of nearby sights, and at that scale they
 * merge into a band of dots along the line and hide the route. The on-route
 * group stays at every zoom — it is a fact about the ride rather than an offer,
 * and there are far fewer of them.
 */
const SIGHT_NEARBY_MIN_ZOOM = 10;

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
  return (
    `<div style="font-size:12px;line-height:1.5;min-width:150px">` +
    `<strong style="display:block;padding-right:24px;margin-bottom:4px">` +
    `${esc(stop.label)}</strong>` +
    (stop.kind
      ? `<div style="display:flex;gap:8px;justify-content:space-between">` +
        `<span style="color:#6b7280">${esc(what)}</span>` +
        `<span style="text-align:right">${esc(stop.kind)}</span></div>`
      : `<div style="color:#6b7280">${esc(what)}</div>`) +
    (stop.detail
      ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #ececf0;color:#6b7280">` +
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
    `<div style="font-size:12px;line-height:1.5;min-width:150px">` +
    `<strong style="display:block;padding-right:24px;margin-bottom:4px">` +
    `${esc(place.label)}</strong>` +
    (place.kind
      ? `<div style="display:flex;gap:8px;justify-content:space-between">` +
        `<span style="color:#6b7280">${esc(m.resPoiKind)}</span>` +
        `<span style="text-align:right">${esc(place.kind)}</span></div>`
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
        ? `<div style="color:#6b7280;margin-top:2px">${esc(detour.note)}</div>`
        : "") +
    // The row's Vairāk sentence. The card has no expansion of its own, so the
    // words that make "205 m" and "+17,0 km" agree have to be on it.
    (detour?.why ? `<div style="color:#6b7280;margin-top:4px">${esc(detour.why)}</div>` : "") +
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
        `style="margin-top:8px;width:100%;display:flex;align-items:center;` +
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

export function RouteMap({ segments, start, destination, via, focus, onFocusCleared, onFocusToggle, selectedPois, routePois, showTet, onToggleTet, showSights, onToggleSights, onShowPoi }: Props) {
  const [locale] = useLocale();
  const m = messages(locale);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const showTetRef = useRef(false);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
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
      attributionControl: { compact: true },
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

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  useEffect(() => {
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
      if (key && key !== revealedRef.current) {
        revealedRef.current = key;
        revealRoute(map);
      }

      if (map.getLayer("tet-line")) {
        map.setLayoutProperty("tet-line", "visibility", showTet ? "visible" : "none");
        showTetRef.current = showTet;
        if (showTet) void loadTet(map);
      }

      if (start) {
        if (!markerRef.current) {
          markerRef.current = new maplibregl.Marker({ color: "#16a34a" });
        }
        markerRef.current.setLngLat([start.lon, start.lat]).addTo(map);
      } else {
        markerRef.current?.remove();
      }

      if (destination) {
        if (!destMarkerRef.current) {
          destMarkerRef.current = new maplibregl.Marker({ color: "#ff3b30" });
        }
        destMarkerRef.current.setLngLat([destination.lon, destination.lat]).addTo(map);
      } else {
        destMarkerRef.current?.remove();
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
              const el = gateElement(m.resGatesRow);
              el.addEventListener("click", (event) => {
                // Same reason the badges stop it: otherwise the click also
                // reaches the map and opens a second card underneath this one.
                event.stopPropagation();
                if (typeof g.segmentId === "number") openCardRef.current(g.point, g.segmentId);
              });
              return new maplibregl.Marker({ element: el }).setLngLat(g.point).addTo(map);
            })
          : [];

      for (const marker of viaMarkersRef.current) marker.remove();
      // Every stop gets the 🅿️ pill and the same card mechanism the line and
      // the badges use. It replaces a plain orange dot with a bare popup: two
      // identical circles that said only a label, and read as decoration
      // rather than as the places the rider asked to ride through.
      viaMarkersRef.current = (via ?? []).map(place => {
        // A sight carries its own kind's glyph in a ringed pill; a typed stop
        // keeps the 🅿️. `category` is only set where the via came from a
        // suggestion, and an unknown category (an older share code, a dataset
        // built after this one) falls back to the 🅿️ rather than to a blank.
        const entry = place.category ? POI_KIND[place.category as keyof typeof POI_KIND] : undefined;
        const el = stopElement(place.label, entry?.icon ?? STOP_ICON, Boolean(entry));
        // A via that came from a suggestion is a *sight* the rider added, and
        // the rider's ruling is that "Apskates vietas" off means no sights on
        // the map — added ones included. Marked here and hidden by the small
        // visibility effect below rather than filtered out of this list: the
        // toggle must not be a reason to rebuild the route, the badges and the
        // gates, which is what putting `showSights` in this effect's deps
        // would cost. A typed stop carries no mark and is never hidden.
        if (entry) el.dataset.sight = "1";
        el.addEventListener("click", (event) => {
          // Same reason the badges stop it: otherwise the click reaches the
          // map and opens the segment card underneath this one.
          event.stopPropagation();
          infoPopupRef.current?.remove();
          infoPopupRef.current = new maplibregl.Popup({ offset: 16, maxWidth: "260px", closeButton: true })
            .setLngLat([place.lon, place.lat])
            .setHTML(stopInfoHtml(m, place))
            .addTo(map);
        });
        return new maplibregl.Marker({ element: el })
          .setLngLat([place.lon, place.lat])
          .addTo(map);
      });

      if (segments && segments.features.length > 0) {
        const bounds = new maplibregl.LngLatBounds();
        for (const f of segments.features) {
          for (const c of f.geometry.coordinates) bounds.extend(c as [number, number]);
        }
        map.fitBounds(bounds, { padding: 48, duration: 800 });
      } else if (start || (via && via.length)) {
        // No route yet — frame the places the rider has confirmed, so the map
        // answers "is this the right Valmiera?" before a generation is spent.
        const pins = [...(start ? [start] : []), ...(via ?? [])];
        if (pins.length === 1) map.easeTo({ center: [pins[0].lon, pins[0].lat], zoom: 11, duration: 600 });
        else if (pins.length > 1) {
          const bounds = new maplibregl.LngLatBounds();
          for (const p of pins) bounds.extend([p.lon, p.lat]);
          map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 700 });
        }
      }
    };

    syncRef.current = syncData;
    syncData();
    // `locale` is in the list so switching language re-labels the badges that
    // are already on the map, rather than waiting for the next generation.
  }, [segments, start, destination, via, showTet, locale]);

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
      // group goes away under z10, the on-route group never does.
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
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () => {
      const nearbyVisible = showSights && map.getZoom() >= SIGHT_NEARBY_MIN_ZOOM;
      for (const marker of [...sightMarkersRef.current, ...selectedMarkersRef.current, ...viaMarkersRef.current]) {
        const el = marker.getElement();
        if (!el.dataset.sight) continue;
        const show = el.dataset.sightGroup === "nearby" ? nearbyVisible : showSights;
        el.style.display = show ? "flex" : "none";
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
      infoPopupRef.current = new maplibregl.Popup({ offset: 12, maxWidth: "260px", closeButton: true })
        .setLngLat(lngLat)
        .setHTML(segmentInfoHtml(m, props, meters))
        .addTo(map);
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
      const feature = featureAt(e.point);
      const props = feature?.properties as SegmentProps | undefined;
      const id = props?.[SEGMENT_ID];
      if (!props || typeof id !== "number") {
        // A click on empty map is how a rider puts the highlight — and the
        // temporary ring on a suggestion — away.
        clearHighlight();
        clearFocus();
        return;
      }

      // A click that opens a segment card also ends the "look at this place"
      // gesture: the rider has moved on to asking about the road.
      clearFocus();
      openCard(e.lngLat, id, props);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { clearHighlight(); clearFocus(); } };

    map.on("mousemove", onMouseMove);
    map.on("mouseout", hideHover);
    map.on("click", onClick);
    // The hover element must not be left hanging over the map while it moves.
    map.on("movestart", hideHover);
    window.addEventListener("keydown", onKey);
    return () => {
      map.off("mousemove", onMouseMove);
      map.off("mouseout", hideHover);
      map.off("click", onClick);
      map.off("movestart", hideHover);
      window.removeEventListener("keydown", onKey);
    };
    // `segments` is a dependency so that the handlers are re-attached once the
    // map exists: on the very first commit `mapRef` can still be empty, and
    // without a second run the badge callbacks would keep calling the no-op
    // refs they were created with.
  }, [m, segments]);

  // The container changes size on the phone (smaller while the chat has
  // something to say, full screen on request); MapLibre only notices when told.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => mapRef.current?.resize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="relative h-full w-full">
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

      {/* The map's two layer switches, in one row at the top-left.
          `flex-wrap` because "Vaatamisväärsused" beside TET is wider than a
          375 px phone: the second switch drops onto its own line rather than
          running under the zoom controls on the right. `right-14` keeps them
          clear of those controls at every width. */}
      <div className="absolute left-3 right-14 top-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => onToggleTet(!showTet)}
        className="flex items-center gap-2 rounded-full border border-[#ececf0] bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <span
          className="inline-block h-[3px] w-4 rounded-full"
          style={{ background: TET_COLOR, opacity: showTet ? 0.9 : 0.3 }}
        />
        TET
        <span
          className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showTet ? "justify-end bg-[#f56300]" : "justify-start bg-[#e9e9eb]"
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
        </span>
      </button>
      {/* The sights switch: the same pill, the same row, the same colours —
          the rider asked for one control style on the map, and two switches
          that looked different would read as two different kinds of thing.
          Its swatch is a miniature of the mark it governs (a white pill with
          a stone border) rather than a colour sample, because what it turns on
          is a shape, not a line colour. */}
      <button
        type="button"
        onClick={() => onToggleSights(!showSights)}
        aria-pressed={showSights}
        aria-label={showSights ? m.resSightsLayerHide : m.resSightsLayerShow}
        title={showSights ? m.resSightsLayerHide : m.resSightsLayerShow}
        className="flex items-center gap-2 rounded-full border border-[#ececf0] bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white"
      >
        <span
          aria-hidden="true"
          className="inline-flex size-4 items-center justify-center rounded-full border border-stone-300 bg-white text-[9px] leading-none"
          style={{ opacity: showSights ? 1 : 0.35 }}
        >
          {SIGHTS_SWATCH_ICON}
        </span>
        {m.resSightsLayer}
        <span
          className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showSights ? "justify-end bg-[#f56300]" : "justify-start bg-[#e9e9eb]"
          }`}
        >
          <span className="h-3 w-3 rounded-full bg-white shadow-sm" />
        </span>
      </button>
      </div>
      {/* Bottom of the map, clear of the full-screen button in the corner.
          At the top-left it covered the corner the route is usually framed
          into. Down here it sits over the edge of the frame, clear of the TET
          switch and the zoom controls.

          The button stays bottom-left (thumb reach on a phone), so the legend
          gives way to it two different ways:
          - Narrow: the legend takes the very bottom of the map and the button
            sits directly ABOVE it. The rider asked for this after testing
            full screen on his phone: the legend is a strip of text, the
            button is the control, and the control belongs nearest the thumb.
            The legend is full width and its items wrap onto two rows — every
            entry stays visible at a glance, which is the whole point of a
            legend, and a horizontal scroller would hide entries behind a
            gesture nothing on the map suggests. Because the row count varies
            with width and language, the button cannot use a fixed offset: it
            is stacked above the legend by MapPanel, which measures the
            legend's real height (see `data-map-legend` below).
          - Wide: the full-screen button is `md:hidden` — inline AND in full
            screen, since a desktop map already fills its column — so nothing
            occupies the corner and the legend takes it, on the same 12 px
            inset as every other control (`md:left-3`). It is never centred:
            `md:max-w-max` keeps it exactly as wide as its content, so it hugs
            the corner instead of floating. The attribution ⓘ is the full
            width of the map away at this size.
          Text never goes below 12 px in either case.

          The max-width is the narrow-screen guard against the attribution ⓘ in
          the bottom-right: compact, it measures 36 px, and 3.25 rem (52 px)
          leaves it a gutter. The 0.75 rem is the legend's own left inset —
          `max-width` is measured from the box's left edge, not from the
          viewport's, so without it the cap lands 12 px too far right and the
          legend's corner runs under the ⓘ (measured: a 6 px overlap at
          375 px). It only binds when the legend is wide enough to reach
          across, which is exactly when it would otherwise collide.

          On a phone it appears only in full screen: on the inline 26-42dvh
          strip the legend is a third of the map and covers the route it is
          meant to explain. Desktop always shows it — there is room. */}
      <div data-map-legend className="absolute bottom-3 left-3 right-3 hidden max-w-[calc(100%-0.75rem-3.25rem)] flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white/95 px-2.5 py-2 text-xs leading-none shadow-sm backdrop-blur [[data-map-expanded]_&]:flex md:left-3 md:right-12 md:flex md:max-w-max md:px-3 md:py-2.5">
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
  );
}
