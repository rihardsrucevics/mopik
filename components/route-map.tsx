"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RouteSegmentProperties } from "@/lib/types";

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

// The legend reads the way OSM readers already read a map: **one brown family
// for everything unpaved**, and the LINE STYLE says what kind of way it is —
// solid gravel road, dashed track, dotted trail. Asphalt stays blue, because
// "is this tarmac or not" is the one distinction a rider makes at a glance.
//
// This replaces a scheme where colour encoded the surface (orange gravel,
// brown dirt, grey unknown) and trails were always red. It carried more
// information than a rider could read on a moving map, and it disagreed with
// every other map they use: a dotted line meant "trail" everywhere else and
// "red warning" here. Gravel and dirt now share a colour — the style says the
// rest, and the panel still reports the exact surface split in numbers.
const PAVED_COLOR = "#0071e3";
/** Every unpaved way, whatever its surface: the style tells them apart. */
const UNPAVED_COLOR = "#8f5a24";
const TET_COLOR = "#af52de"; // TET overlay

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
// compacted, ground, dirt, sand, or a way with no surface tag at all — is
// brown, so an unpaved stretch never reads as a gap in the line.
const SURFACE_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  "match",
  ["get", "surface"],
  "asphalt",
  PAVED_COLOR,
  UNPAVED_COLOR,
];

export function RouteMap({ segments, start, destination, via, showTet, onToggleTet }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  const showTetRef = useRef(false);
  const destMarkerRef = useRef<maplibregl.Marker | null>(null);
  const loadedRef = useRef(false);
  const viaMarkersRef = useRef<maplibregl.Marker[]>([]);
  const syncRef = useRef<() => void>(() => {});
  /** Which route has already played its reveal, so a pan never replays it. */
  const revealedRef = useRef<string | null>(null);

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
          "line-width": LINE_WIDTH,
          // Long dash, short gap: reads as a continuous way that happens to be
          // unsealed, rather than as a row of ticks.
          "line-dasharray": [2.2, 1.1],
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
          "line-color": SURFACE_COLOR_EXPR,
          "line-width": LINE_WIDTH,
          "line-dasharray": [0, 1.8],
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

      const source = map.getSource("route") as maplibregl.GeoJSONSource | undefined;
      source?.setData(segments ?? EMPTY);

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
  }, [segments, start, destination, via, showTet]);

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
      <div className="absolute left-3 top-14 hidden flex-col gap-2 rounded-xl border border-[#ececf0] bg-white/95 px-3 py-2.5 text-[11px] leading-none shadow-sm backdrop-blur md:flex">
        <div className="flex flex-col gap-1.5">
          <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Ceļa veids
          </span>
          {/* One row, read left to right as the ride gets rougher: asphalt,
              gravel road, track, trail. The samples are drawn with the same
              colours and dash patterns the map uses, so the legend is the map
              in miniature rather than a description of it. */}
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: PAVED_COLOR }} />
              Asfalts
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-[3px] w-5 rounded-full" style={{ background: UNPAVED_COLOR }} />
              Grants
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${UNPAVED_COLOR} 0 5px, transparent 5px 8px)`,
                }}
              />
              Meža ceļš
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-[3px] w-5"
                style={{
                  background: `repeating-linear-gradient(90deg, ${UNPAVED_COLOR} 0 2px, transparent 2px 5px)`,
                }}
              />
              Taka
            </span>
            {showTet && (
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block h-[3px] w-5 rounded-full"
                  style={{ background: TET_COLOR, opacity: 0.65 }}
                />
                TET
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
