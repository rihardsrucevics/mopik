"use client";

import { useEffect, useRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Heart, Mountain, TriangleAlert, type LucideIcon } from "lucide-react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RouteSegmentProperties } from "@/lib/types";
import { haversineMeters } from "@/lib/geo/geometry";
import { useLocale } from "@/lib/i18n/use-locale";
import { messages } from "@/lib/i18n/messages";
import type { UiLocale } from "@/lib/i18n/locale";

// Serve the MapLibre worker from /public — bundler-emitted module workers
// 404 under the Next.js dev server, leaving the map blank.
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

type Props = {
  segments: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteSegmentProperties> | null;
  start: { lat: number; lon: number } | null;
  destination?: { lat: number; lon: number } | null;
  via?: { lat: number; lon: number; label: string }[];
  showTet: boolean;
  onToggleTet: (visible: boolean) => void;
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

// The legend reads the way OSM readers already read a map: **one colour family
// for everything unpaved** (see `UNPAVED` below), and the LINE STYLE says what
// kind of way it is — solid gravel road, dashed track, dotted trail. Asphalt
// stays blue, because "is this tarmac or not" is the one distinction a rider
// makes at a glance.
//
// This replaces a scheme where colour encoded the surface (orange gravel,
// brown dirt, grey unknown) and trails were always red. It carried more
// information than a rider could read on a moving map, and it disagreed with
// every other map they use: a dotted line meant "trail" everywhere else and
// "red warning" here. Gravel and dirt still share a colour — the style says
// the rest, and the panel still reports the exact surface split in numbers.
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
 * The unpaved family — an experiment, and the one place to tune or revert it.
 *
 * It used to be one brown (`#8f5a24`) for every unpaved class, with the dash
 * pattern carrying the whole distinction. This swaps that family for the app's
 * own brand orange `#f56300` (the logo dot, the generate button, the PWA
 * theme colour), so the route on the map belongs to the same palette as the
 * app around it.
 *
 * The dash patterns still do the work of telling the classes apart — solid
 * gravel road, dashed track, dotted trail. The shades only reinforce what the
 * dashes already say: a trail is darker and deeper because a dotted line is
 * the thinnest ink on the map and the brand orange alone reads washed out at
 * the width of a dot.
 */
const UNPAVED = {
  /** Gravel and everything else unpaved: the brand orange itself. */
  road: "#f56300",
  /** Forest track, dashed. The button-hover shade, a step down. */
  track: "#d85600",
  /** Trail, dotted. The darkest of the three — see above. */
  trail: "#bd4b00",
} as const;

/**
 * The trail badge's heart, filled, in the app's destructive red.
 *
 * Deliberately NOT `UNPAVED.trail`: the heart is a solid shape, and filled in
 * the trail's own orange-red it sat too close to both the orange route line it
 * overlays and the amber triangle beside it on a two-icon pill — three warm
 * oranges and nothing to tell them apart. Red-600 is the same red the app
 * already uses for destructive UI (`--destructive` in `globals.css` is
 * `oklch(0.577 0.245 27.325)`, which is exactly this hex; the delete action and
 * the composer's error text use the neighbouring `red-700`), so the badge reads
 * as a warning rather than as a favourite, and separates cleanly from the amber.
 *
 * Tune here: this is the only place the trail badge's colour is set.
 */
const TRAIL_BADGE_COLOR = "#dc2626"; // red-600

/**
 * The glow, the casing-level fill and any layer that is not class-filtered
 * paint with the family's base, so an unpaved stretch never reads as a gap.
 */
const UNPAVED_COLOR = UNPAVED.road;

/**
 * Lever 1 of 3 for low-zoom legibility: the shades track and trail drift to as
 * the map zooms out, so colour can carry some of the distinction once the dash
 * patterns stop being legible.
 *
 * **These must stay clearly ORANGE.** The first version used `#a63d00` /
 * `#8a3a00`, which read as *brown* against the green basemap — "kāpēc nav viss
 * oranžs?" — and the one-orange-family rule the whole legend is built on is
 * worth more than the extra separation. These are a milder step of the same
 * family instead.
 *
 * Setting each of these equal to its `UNPAVED` counterpart switches the effect
 * off completely, which is the intended way to compare it.
 */
const LOW_ZOOM_TRACK = "#c95300";
const LOW_ZOOM_TRAIL = "#b04a00";

/** Where the colour drift runs between: full `UNPAVED` shades at and above
 * `DARKEN_FROM_ZOOM`, fully drifted at and below `DARKEN_TO_ZOOM`. */
const DARKEN_FROM_ZOOM = 12;
const DARKEN_TO_ZOOM = 9;

/**
 * Where the line stops being able to hold a pattern.
 *
 * - At/above `ZOOM_PATTERN_FINE` the line is ~5 px and the tight rhythm
 *   (`[2.2, 1.1]` / `[0, 1.8]`) reads as intended.
 * - Between the two it is ~3–4 px, so the dashes are stretched: the same ink
 *   in fewer, longer marks survives a thinner line.
 * - Below `ZOOM_PATTERN_OFF` nothing survives — the route is a thread across a
 *   whole region — so track and trail go solid and are told apart by colour
 *   and by a slightly narrower line than the gravel base.
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

type Warning = { kind: WarningKind; title: string; detail: string };

/**
 * The warning icons, as Lucide SVG rendered once to a string.
 *
 * Every surface that shows a warning is built by direct DOM or an HTML string
 * — the badges are MapLibre `Marker` elements, the popups take `setHTML`, and
 * the hover label is written from a mousemove handler that must not trigger a
 * React render. So each icon is rendered to a string once, cached, and
 * concatenated like the emoji it replaces (see `warningIcon` for why the
 * render cannot happen at module scope).
 *
 * Sized at 18 px against the emoji's ~14: the emoji were legible on a desk and
 * not at arm's length on a phone, and 18 is the largest that still leaves the
 * two-icon pill narrower than the route is long at z12.
 */
const WARNING_ICON_PX = 18;

/**
 * `fill` takes the colour literally, never `currentColor`.
 *
 * Lucide's `color` prop sets the SVG's `stroke` attribute only — it does not
 * set the CSS `color` property — so a `fill="currentColor"` resolves against
 * whatever text colour the badge happens to inherit. In these surfaces that is
 * the pill's black body text, which drew the filled heart black with a red
 * outline. Passing the colour itself to both keeps the glyph one solid colour
 * wherever the markup is dropped.
 */
const iconMarkup = (Icon: LucideIcon, color: string, filled: boolean): string =>
  renderToStaticMarkup(
    <Icon
      size={WARNING_ICON_PX}
      color={color}
      strokeWidth={2.25}
      fill={filled ? color : "none"}
      aria-hidden="true"
    />
  );

/**
 * Amber for access (the app's warning colour — the same family as the
 * `amber-50 / amber-900` warning lists in the result panel); the app's
 * destructive red for the trail's filled heart.
 *
 * The trail glyph was a flame in `UNPAVED.trail` before, matching the colour of
 * the dotted line it annotates. The heart that replaced it is a solid shape
 * rather than an outline, and in that orange-red it competed with both the
 * route line under it and the amber triangle next to it — so it takes the app's
 * red instead. See `TRAIL_BADGE_COLOR`.
 */
const WARNING_ICON_COLOR: Record<WarningKind, string> = {
  unverified: "#f59e0b",     // amber-500
  trail: TRAIL_BADGE_COLOR,  // red-600 — see the constant for why not the trail's orange
  rough: "#292524",          // stone-800
};

/**
 * Which glyphs are drawn solid. The heart is: an outlined heart at 18 px reads
 * as an empty "favourite" toggle — a thin ring the eye files as a control to
 * click, not as a warning about the ground. Filled, it is a small solid mark
 * that carries at a glance and holds its weight beside the amber triangle.
 * The triangle and the mountain stay outlines, as Lucide draws them.
 */
const WARNING_ICON_FILLED: Record<WarningKind, boolean> = {
  unverified: false,
  trail: true,
  rough: false,
};

const WARNING_ICON_COMPONENT: Record<WarningKind, LucideIcon> = {
  unverified: TriangleAlert,
  trail: Heart, // drawn filled — see `WARNING_ICON_FILLED`
  // Not badged on the map (see `BADGE_KINDS`), but the segment card still
  // lists it, and there it needs a glyph of its own: reusing the trail's
  // glyph made two different warnings look like the same one.
  rough: Mountain,
};

/**
 * Rendered on first use, not at module scope.
 *
 * A Lucide icon reads a context for its default size and stroke, and
 * `renderToStaticMarkup` at module scope runs that `useContext` while Next is
 * evaluating the module on the SERVER, where there is no React dispatcher —
 * which took the whole page down with "Cannot read properties of null (reading
 * 'useContext')". Rendering lazily keeps the markup a one-off (every surface
 * here is direct DOM or an HTML string, so it must be a string) while moving
 * the render to the browser, on a path only ever reached from an effect.
 */
const iconCache = new Map<WarningKind, string>();
const warningIcon = (kind: WarningKind): string => {
  const cached = iconCache.get(kind);
  if (cached !== undefined) return cached;
  const markup = iconMarkup(
    WARNING_ICON_COMPONENT[kind],
    WARNING_ICON_COLOR[kind],
    WARNING_ICON_FILLED[kind]
  );
  iconCache.set(kind, markup);
  return markup;
};

/** The icons for a list of warnings, side by side, as one HTML string. */
const iconsHtml = (warnings: Warning[]): string =>
  warnings.map((w) => warningIcon(w.kind)).join("");

/**
 * A badge on the line: a white pill with one icon, the way a phone map marks
 * a hazard. Built as an HTML element rather than a GL symbol layer because an
 * SVG cannot go in a `text-field` at all (and the emoji this replaced rendered
 * through the style's glyph stack and came out as boxes on most basemaps).
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
    // never overflow the dot. Counted by the caller — an icon is a whole SVG
    // element, so no length of `icon` is a count of glyphs.
    `width:${count > 1 ? 8 + (WARNING_ICON_PX + 4) * count : 24}px;height:24px;` +
    "border-radius:12px;" +
    "background:rgba(255,255,255,0.92);box-shadow:0 1px 2px rgba(0,0,0,0.2);" +
    "line-height:0;cursor:pointer;user-select:none;border:0;padding:0;opacity:0.9;" +
    // Under the start/finish pins, which are the rider's own answers and must
    // never be covered by an annotation about the road.
    "z-index:1";
  // `icon` is our own pre-rendered Lucide markup, never anything from a tag.
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
      iconCount: warnings.length,
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

/**
 * The class heading, in the legend's own words.
 *
 * It has to read `surface` as well as `roadClass`, exactly as the layers do
 * when they choose a colour: a `roadClass: "road"` is drawn BLUE when its
 * surface is asphalt and orange otherwise, so keying the heading on the class
 * alone called every paved road "gravel" — the card and the line it points at
 * disagreed. The rule below is the same one `surfaceColor` paints with:
 * asphalt first, then the class.
 */
const roadClassLabel = (m: Messages, roadClass?: string, surface?: string): string =>
  surface === "asphalt" ? m.legendAsphalt
  : roadClass === "trail" ? m.legendTrail
  : roadClass === "track" ? m.legendTrack
  : m.legendGravel;

/**
 * The surface, in the rider's language.
 *
 * Only asphalt and the gravel family have legend words of their own; the
 * looser OSM values (`ground`, `dirt`, `sand`) share the panel's "Zeme /
 * smiltis" line, and an untagged way says so rather than guessing.
 */
const surfaceLabel = (m: Messages, surface?: string): string =>
  surface === "asphalt" ? m.legendAsphalt
  : surface === "gravel" || surface === "compacted" ? m.legendGravel
  : surface === "ground" || surface === "dirt" || surface === "sand" ? m.resDirt
  : m.resUnknown;

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
    const head = `${warningIcon(w.kind)}<span>${esc(w.title)}</span>`;
    if (!w.detail) return `<div style="display:flex;align-items:center;gap:6px">${head}</div>`;
    return (
      `<details class="mopik-warn" style="margin:0">` +
      `<summary style="display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none">` +
      `${head}</summary>` +
      `<div style="margin:2px 0 0 24px;color:#6b7280">${esc(w.detail)}</div>` +
      `</details>`
    );
  });
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
    `${esc(m.segHeading)} · ${esc(roadClassLabel(m, props.roadClass, props.surface))}</strong>` +
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

// Asphalt is the only surface that changes the colour. Anything else — gravel,
// compacted, ground, dirt, sand, or a way with no surface tag at all — takes
// the unpaved family, so an unpaved stretch never reads as a gap in the line.
//
// A layer already filtered to one road class passes that class's shade;
// the unfiltered layers (the glow) take the family's base.
const surfaceColor = (unpaved: string): maplibregl.ExpressionSpecification => [
  "match",
  ["get", "surface"],
  "asphalt",
  PAVED_COLOR,
  unpaved,
];

const SURFACE_COLOR_EXPR = surfaceColor(UNPAVED_COLOR);

/**
 * The same rule, but the unpaved shade widens away from the base as the map
 * zooms out — see `LOW_ZOOM_TRACK` / `LOW_ZOOM_TRAIL`. Asphalt is unaffected: blue vs orange never
 * stops being legible, however thin the line gets.
 */
const surfaceColorByZoom = (
  near: string,
  far: string
): maplibregl.ExpressionSpecification => [
  // `zoom` may only appear at the TOP level of a `step` or `interpolate`, so
  // the interpolation is the outer expression and the per-surface `match` is
  // evaluated inside each stop. Nesting it the other way round — one `match`
  // over two interpolated branches — is what the style spec rejects, and
  // MapLibre drops the whole paint property when it does: the track and trail
  // lines rendered as bare white casing with no colour on top at all.
  "interpolate", ["linear"], ["zoom"],
  DARKEN_TO_ZOOM, surfaceColor(far),
  DARKEN_FROM_ZOOM, surfaceColor(near),
];

export function RouteMap({ segments, start, destination, via, showTet, onToggleTet }: Props) {
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

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
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
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");

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
          "line-color": surfaceColorByZoom(UNPAVED.track, LOW_ZOOM_TRACK),
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
          // A trail is a dotted line, not a red one. The dots already say
          // "this is the narrow, uncertain stuff"; painting it red as well
          // said it twice and broke the one-colour-per-surface rule.
          "line-color": surfaceColorByZoom(UNPAVED.trail, LOW_ZOOM_TRAIL),
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

      for (const marker of viaMarkersRef.current) marker.remove();
      viaMarkersRef.current = (via ?? []).map(place => new maplibregl.Marker({ color: "#f56300" })
        .setLngLat([place.lon, place.lat])
        .setPopup(new maplibregl.Popup().setText(place.label))
        .addTo(map));

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
      // Direct DOM, no re-render: see the note on this effect. `warningIcon`
      // is cached after its first call, so building the label costs no React
      // work in a mousemove handler.
      if (hover.dataset.label !== label) {
        hover.innerHTML = warnings
          .map((w) => `${warningIcon(w.kind)}<span>${esc(w.title)}</span>`)
          .join(`<span style="opacity:0.4">·</span>`);
        hover.dataset.label = label;
      }
      // `flex`, not `block`: the label is an icon beside its words, and the
      // inline style wins over the element's own flex class.
      hover.style.display = "flex";
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

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const feature = featureAt(e.point);
      const props = feature?.properties as SegmentProps | undefined;
      const id = props?.[SEGMENT_ID];
      if (!props || typeof id !== "number") {
        // A click on empty map is how a rider puts the highlight away.
        clearHighlight();
        return;
      }

      openCard(e.lngLat, id, props);
    };

    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") clearHighlight(); };

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
        style={{ display: "none" }}
        className="pointer-events-none absolute left-0 top-0 z-10 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-white/95 px-2 py-1 text-[11px] font-medium leading-none text-foreground shadow-sm backdrop-blur"
      />

      <button
        type="button"
        onClick={() => onToggleTet(!showTet)}
        className="absolute left-3 top-3 flex items-center gap-2 rounded-full border border-[#ececf0] bg-white/95 px-3 py-1.5 text-xs font-medium text-foreground shadow-sm backdrop-blur transition-colors hover:bg-white"
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
      {/* Bottom of the map, in one row.
          At the top-left it covered the corner the route is usually framed
          into. Down here it sits over the edge of the frame, clear of the TET
          switch and the zoom controls.
          On a phone it appears only in full screen: on the inline 26-42dvh
          strip the legend is a third of the map and covers the route it is
          meant to explain. Desktop always shows it — there is room. */}
      <div className="absolute bottom-16 left-3 right-3 hidden flex-col gap-1.5 rounded-xl border border-[#ececf0] bg-white/95 px-2.5 py-2 text-[10px] leading-none shadow-sm backdrop-blur [[data-map-expanded]_&]:flex md:bottom-3 md:left-16 md:right-auto md:flex md:max-w-max md:px-3 md:py-2.5 md:text-[11px]">
        {/* No heading: four labelled samples in a row need no title, and at
            the bottom of the map the line it would cost is the difference
            between one row and two. Read left to right as the ride gets
            rougher: asphalt, gravel road, track, trail. The samples use the
            same colours and dash patterns as the map, so the legend is the
            map in miniature rather than a description of it. */}
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: PAVED_COLOR }} />
              {m.legendAsphalt}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: UNPAVED.road }} />
              {m.legendGravel}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${UNPAVED.track} 0 5px, transparent 5px 8px)`,
                }}
              />
              {m.legendTrack}
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${UNPAVED.trail} 0 2px, transparent 2px 5px)`,
                }}
              />
              {m.legendTrail}
            </span>
            {/* The TET sample is the casing, not the overlay line: a purple
                halo around the route's own colour, which is what the rider
                now sees where their ride runs along the trail. Shown whether
                or not the reference overlay is switched on, because the
                casing is too — it is a fact about this route, not a layer. */}
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[7px] w-5 rounded-full"
                style={{
                  background: UNPAVED.road,
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
