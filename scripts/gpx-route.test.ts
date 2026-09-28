import test from "node:test";
import assert from "node:assert/strict";
import { rideRoutePoints, MAX_ROUTE_POINTS } from "../lib/gpx/route-points";
import { parseRoutePoints } from "../lib/gpx/parse-route-points";
import { generateGpx, TRP_NS } from "../lib/gpx/generate-gpx";
import { rideWaypoints, type RideWaypointPlace } from "../lib/gpx/waypoints";

/**
 * The Garmin route (`<rte>`) inside a Mopik GPX — route editing Phase 1.
 *
 * `npx tsx --test scripts/gpx-route.test.ts`
 *
 * What a zūmo re-plans from: start, stops as announced vias, pass-through
 * points as silent shaping points, the finish (or the start again on a loop).
 * Every rule here is otherwise only checked on the device, after the rider
 * has left.
 */

const place = (name: string, lat: number, lon: number, extra: Partial<RideWaypointPlace> = {}): RideWaypointPlace =>
  ({ name, label: name, lat, lon, ...extra });

const sigulda = place("Sigulda", 57.15, 24.85);
const tujas = place("Tūjas", 57.3, 24.9);
const cesis = place("Cēsis", 57.31, 25.27);
const ligatne = place("Līgatne", 57.23, 25.04);

test("anchors in riding order: start, stops with shapes after their place, finish", () => {
  const r = rideRoutePoints({
    places: [sigulda, tujas, ligatne, cesis],
    shapePoints: [
      { lat: 57.2, lon: 24.88, afterPlace: 0 },
      { lat: 57.28, lon: 25.0, afterPlace: 2 },
      { lat: 57.29, lon: 25.1, afterPlace: 2 },
    ],
    returnToStart: false,
    locale: "lv",
  });
  assert.deepEqual(r.map((p) => p.kind), ["via", "shape", "via", "via", "shape", "shape", "via"]);
  assert.deepEqual(r.map((p) => p.name), [
    "Starts · Sigulda", "Caurbraucams punkts", "Pietura 1 · Tūjas", "Pietura 2 · Līgatne",
    "Caurbraucams punkts", "Caurbraucams punkts", "Finišs · Cēsis",
  ]);
});

test("a round trip repeats the start at the end, and has no finish", () => {
  const r = rideRoutePoints({ places: [sigulda, tujas, ligatne], returnToStart: true, locale: "en" });
  assert.equal(r.length, 4);
  assert.deepEqual(r[0], r[r.length - 1]);
  assert.deepEqual(r.map((p) => p.name), ["Start · Sigulda", "Stop 1 · Tūjas", "Stop 2 · Līgatne", "Start · Sigulda"]);
  assert.ok(!r.some((p) => p.name?.startsWith("Finish")));
});

test("a round trip with shapes after the last stop keeps them before the return", () => {
  const r = rideRoutePoints({
    places: [sigulda, tujas],
    shapePoints: [{ lat: 57.2, lon: 25.0, afterPlace: 1 }],
    returnToStart: true,
    locale: "lv",
  });
  assert.deepEqual(r.map((p) => p.kind), ["via", "via", "shape", "via"]);
  assert.equal(r[3].name, "Starts · Sigulda");
});

test("an afterPlace past the last stop goes before the finish", () => {
  const r = rideRoutePoints({
    places: [sigulda, tujas, cesis],
    shapePoints: [{ lat: 57.3, lon: 25.1, afterPlace: 9 }],
    returnToStart: false,
    locale: "lv",
  });
  assert.deepEqual(r.map((p) => p.kind), ["via", "via", "shape", "via"]);
});

test("a sight among the stops takes no number and reads like its pin", () => {
  const r = rideRoutePoints({
    places: [sigulda, place("Dauguļu ūdenskritums", 57.2, 24.9, { kind: "waterfall" }), tujas, cesis],
    returnToStart: false,
    locale: "lv",
  });
  assert.equal(r[1].name, "Ūdenskritums · Dauguļu ūdenskritums");
  assert.equal(r[2].name, "Pietura 1 · Tūjas");
});

test("ticked sights go where the line visits them, never before the start or after the finish", () => {
  // A line due north from Sigulda through Tūjas to a finish further north.
  const line: [number, number][] = [];
  for (let i = 0; i <= 100; i++) line.push([24.85, 57.15 + i * 0.004]);
  const start = place("S", 57.15, 24.85);
  const stop = place("Stop", 57.31, 24.85);
  const finish = place("F", 57.55, 24.85);
  const early = place("Early", 57.2, 24.851, { kind: "viewpoint" });
  const late = place("Late", 57.45, 24.851, { kind: "viewpoint" });
  const r = rideRoutePoints({ places: [start, stop, finish], returnToStart: false, locale: "en", sights: [late, early], line });
  assert.deepEqual(r.map((p) => p.name?.split(" · ").pop()), ["S", "Early", "Stop", "Late", "F"]);
  // Without the line there is no honest order, so sights are left out.
  const noLine = rideRoutePoints({ places: [start, stop, finish], returnToStart: false, locale: "en", sights: [late] });
  assert.equal(noLine.length, 3);
});

test("unusable places are dropped, not exported at (0, 0)", () => {
  const r = rideRoutePoints({ places: [sigulda, place("", 57, 24), place("X", NaN, 24), cesis], returnToStart: false, locale: "lv" });
  assert.equal(r.length, 2);
  assert.deepEqual(rideRoutePoints({ places: [], returnToStart: true, locale: "lv" }), []);
});

// ── the file ──

const line: [number, number][] = [[24.85, 57.15], [24.9, 57.3], [25.27, 57.31]];
const anchors = rideRoutePoints({
  places: [sigulda, tujas, cesis],
  shapePoints: [{ lat: 57.2, lon: 24.88, afterPlace: 0 }],
  returnToStart: false,
  locale: "lv",
});
const waypoints = rideWaypoints({ places: [sigulda, tujas, cesis], returnToStart: false, locale: "lv" });
const gpx = generateGpx("Sigulda — Cēsis & back", line, "desc", waypoints, anchors);

test("GPX 1.1 order: metadata, wpt*, rte, trk", () => {
  const order = [...gpx.matchAll(/<(metadata|wpt|rte|trk)[\s>]/g)].map((m) => m[1]);
  const collapsed = order.filter((x, i) => x !== order[i - 1]);
  assert.deepEqual(collapsed, ["metadata", "wpt", "rte", "trk"]);
  // Inside <rte>: its <name> before any <rtept>; inside each <rtept>: <name> before <extensions>.
  const rte = gpx.slice(gpx.indexOf("<rte>"), gpx.indexOf("</rte>"));
  assert.ok(rte.indexOf("<name>") < rte.indexOf("<rtept"));
  for (const pt of rte.split("<rtept").slice(1)) assert.ok(pt.indexOf("<name>") < pt.indexOf("<extensions>"));
});

test("one rtept per anchor, Via vs Shaping per kind", () => {
  const pts = gpx.match(/<rtept [^>]*>[\s\S]*?<\/rtept>/g) ?? [];
  assert.equal(pts.length, anchors.length);
  pts.forEach((pt, i) => {
    const want = anchors[i].kind === "via" ? "<trp:ViaPoint/>" : "<trp:ShapingPoint/>";
    assert.ok(pt.includes(`<extensions>${want}</extensions>`), pt);
    assert.ok(pt.includes(`lat="${anchors[i].lat.toFixed(6)}" lon="${anchors[i].lon.toFixed(6)}"`));
  });
  assert.equal((gpx.match(/<trp:ViaPoint\/>/g) ?? []).length, 3);
  assert.equal((gpx.match(/<trp:ShapingPoint\/>/g) ?? []).length, 1);
});

test("the trp namespace is declared, with its schema location", () => {
  assert.equal(TRP_NS, "http://www.garmin.com/xmlschemas/TripExtensions/v1");
  assert.ok(gpx.includes(`xmlns:trp="${TRP_NS}"`));
  assert.ok(gpx.includes(`${TRP_NS} https://www8.garmin.com/xmlschemas/TripExtensionsv1.xsd`));
});

test("pass-through points are never waypoints", () => {
  const wpts = gpx.match(/<wpt [\s\S]*?<\/wpt>/g) ?? [];
  assert.equal(wpts.length, 3);
  assert.ok(!wpts.some((w) => w.includes("Caurbraucams")));
  assert.ok(!wpts.some((w) => w.includes('lat="57.200000" lon="24.880000"')));
});

test("names are escaped and the track is untouched", () => {
  assert.ok(gpx.includes("<rte>\n    <name>Sigulda — Cēsis &amp; back</name>"));
  assert.equal((gpx.match(/<trkpt /g) ?? []).length, line.length);
});

test("no route points, or fewer than two, means no <rte>", () => {
  assert.ok(!generateGpx("x", line).includes("<rte>"));
  assert.ok(!generateGpx("x", line, undefined, waypoints, [anchors[0]]).includes("<rte>"));
});

// ── the export body ──

test("bad routePoints are ignored, never thrown", () => {
  const good = anchors.map(({ lat, lon, name, kind }) => ({ lat, lon, name, kind }));
  assert.deepEqual(parseRoutePoints(good), good);
  for (const bad of [
    undefined, null, "x", 42, {}, [],
    [good[0]],                                             // one point is not a route
    [{ ...good[0], kind: "stop" }, good[1]],               // unknown kind
    [{ ...good[0], lat: 91 }, good[1]],                    // out of range
    [{ ...good[0], lon: "24" }, good[1]],                  // wrong type
    [{ ...good[0], name: "x".repeat(161) }, good[1]],      // name too long
    Array.from({ length: MAX_ROUTE_POINTS + 1 }, () => good[0]), // over the cap: dropped, not cut
  ]) {
    assert.equal(parseRoutePoints(bad), undefined, JSON.stringify(bad)?.slice(0, 80));
  }
  assert.ok(parseRoutePoints(Array.from({ length: MAX_ROUTE_POINTS }, () => good[0])));
});

test("the cap covers the longest ride the planner can build", () => {
  // start + 10 stops + 20 shapes + 8 ticked sights + finish
  assert.equal(MAX_ROUTE_POINTS, 10 + 20 + 8 + 2);
});

test("a saved or shared ride's file: stops and pass-through points from its share code (release check, 2026-09-28)", async () => {
  const { sharedRideGpx } = await import("../lib/gpx/share-gpx");
  // Sigulda → Līgatne (pass-through) → Cēsis, one way, as a code carries it.
  const planCode = Buffer.from(JSON.stringify({ pl: [["Sigulda", "Sigulda", 57.154, 24.857], ["Cēsis", "Cēsis", 57.313, 25.275]] })).toString("base64url");
  const share = {
    name: "Sigulda → Cēsis", variant: "direct", km: 55, minutes: 70, unpavedPercent: 10, repeatedPercent: 0, startLabel: "Sigulda",
    points: [[24.857, 57.154], [25.04, 57.233], [25.275, 57.313]] as [number, number][], classes: [],
    plan: { returnToStart: false, shapePoints: [{ lat: 57.233, lon: 25.04, afterPlace: 0 }] },
  } as unknown as Parameters<typeof sharedRideGpx>[0]["share"];
  const { waypoints, routePoints } = sharedRideGpx({ share, planCode, locale: "lv", line: share.points });
  assert.deepEqual(routePoints?.map((p) => p.kind), ["via", "shape", "via"]);
  assert.equal(routePoints?.[2].name, "Finišs · Cēsis");
  assert.ok(waypoints.length >= 1);
  const gpx = generateGpx(share.name, share.points, undefined, waypoints, routePoints);
  assert.match(gpx, /<\/wpt>\s*<rte>[\s\S]*<trp:ViaPoint\/>[\s\S]*<trp:ShapingPoint\/>[\s\S]*<trp:ViaPoint\/>[\s\S]*<\/rte>\s*<trk>/);
  // An old code with no places and an open line: no route rather than a wrong one.
  assert.equal(sharedRideGpx({ share, planCode: null, locale: "lv", line: share.points }).routePoints, undefined);
});
