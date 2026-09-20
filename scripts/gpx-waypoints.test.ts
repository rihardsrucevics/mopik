import test from "node:test";
import assert from "node:assert/strict";
import { rideWaypoints, placeRegion, type RideWaypointPlace } from "../lib/gpx/waypoints";
import { generateGpx } from "../lib/gpx/generate-gpx";

/**
 * The planned places a rider sees on the device.
 *
 * `npx tsx --test scripts/gpx-waypoints.test.ts`
 *
 * The failure this guards against is invisible from inside the app: every one
 * of these rules is only ever checked on a Garmin or in OsmAnd, by the rider,
 * after he has already left. A sight quietly taking a stop's number, a round
 * trip growing a finish it does not have, a `&` in a place name breaking the
 * file, a `<wpt>` written after the `<trk>` where the schema forbids it —
 * none of them show up on screen and all of them reach him.
 */

const place = (name: string, lat = 57, lon = 24, extra: Partial<RideWaypointPlace> = {}): RideWaypointPlace =>
  ({ name, label: name, lat, lon, ...extra });

test("a one-way ride gets a green start, numbered stops and a red finish", () => {
  const w = rideWaypoints({
    places: [place("Sigulda"), place("Tūjas", 57.2), place("Cēsis", 57.3)],
    returnToStart: false,
    locale: "lv",
  });
  assert.deepEqual(w.map((x) => x.name), ["Starts · Sigulda", "1 · Tūjas", "Finišs · Cēsis"]);
  assert.deepEqual(w.map((x) => x.sym), ["Flag, Green", "Flag, Blue", "Flag, Red"]);
  assert.deepEqual(w.map((x) => x.type), ["start", "stop", "finish"]);
});

test("a round trip has no finish — the start is the finish", () => {
  const w = rideWaypoints({
    places: [place("Sigulda"), place("Līgatne", 57.2), place("Ērgļi", 56.9)],
    returnToStart: true,
    locale: "lv",
  });
  assert.deepEqual(w.map((x) => x.name), ["Starts · Sigulda", "1 · Līgatne", "2 · Ērgļi"]);
  // No red flag anywhere: a loop returns to the green one.
  assert.equal(w.filter((x) => x.type === "finish").length, 0);
  assert.equal(w.filter((x) => x.sym === "Flag, Red").length, 0);
});

test("a sight takes no number, so the stops after it still match the form", () => {
  const w = rideWaypoints({
    places: [
      place("Sigulda"),
      place("Tūjas", 57.2),
      place("Dauguļu ūdenskritums", 57.25, 25, { kind: "waterfall" }),
      place("Valmiera", 57.5),
      place("Cēsis", 57.3),
    ],
    returnToStart: false,
    locale: "lv",
  });
  assert.deepEqual(w.map((x) => x.name), [
    "Starts · Sigulda",
    "1 · Tūjas",
    "Ūdenskritums · Dauguļu ūdenskritums",
    // Would read "3 · Valmiera" if the waterfall had consumed a number.
    "2 · Valmiera",
    "Finišs · Cēsis",
  ]);
  assert.deepEqual(w.map((x) => x.type), ["start", "stop", "sight", "stop", "finish"]);
});

test("each sight kind gets its own Garmin symbol, and an unknown one a plain pin", () => {
  const kinds: [string, string, string][] = [
    ["viewpoint", "Scenic Area", "Skatu punkts"],
    ["manor", "Museum", "Muiža"],
    ["hillfort", "Summit", "Pilskalns"],
    ["ford", "Ford", "Brasls"],
    ["lighthouse", "Lighthouse", "Bāka"],
  ];
  for (const [kind, sym, word] of kinds) {
    const w = rideWaypoints({
      places: [place("Sigulda"), place("X", 57.2, 24, { kind })],
      returnToStart: true,
      locale: "lv",
    });
    assert.equal(w[1].sym, sym, kind);
    assert.equal(w[1].name, `${word} · X`, kind);
    assert.equal(w[1].type, "sight");
  }
  // A category this build does not know is a place the rider put in the ride:
  // it is a stop and takes a number, rather than a blank pin.
  const unknown = rideWaypoints({
    places: [place("Sigulda"), place("Y", 57.2, 24, { kind: "space_elevator" })],
    returnToStart: true,
    locale: "lv",
  });
  assert.equal(unknown[1].name, "1 · Y");
  assert.equal(unknown[1].sym, "Flag, Blue");
});

test("the words follow the rider's language; the symbols stay Garmin's", () => {
  const places = [place("Sigulda"), place("Krimulda", 57.2), place("Cēsis", 57.3)];
  const en = rideWaypoints({ places, returnToStart: false, locale: "en" });
  assert.deepEqual(en.map((x) => x.name), ["Start · Sigulda", "1 · Krimulda", "Finish · Cēsis"]);
  const et = rideWaypoints({ places, returnToStart: false, locale: "et" });
  assert.equal(et[0].name, "Start · Sigulda");
  assert.equal(et[2].name, "Finiš · Cēsis");
  // Untranslated on purpose: a device reads these, not a rider.
  assert.deepEqual(en.map((x) => x.sym), et.map((x) => x.sym));
});

test("the label's region rides in desc, never in the name", () => {
  const w = rideWaypoints({
    places: [place("Sigulda"), { name: "Allaži", label: "Allaži · Allažu pagasts", lat: 57.1, lon: 24.6 }],
    returnToStart: true,
    locale: "lv",
  });
  assert.equal(w[1].name, "1 · Allaži");
  assert.equal(w[1].desc, "Allažu pagasts");
  // A label that is only the name says nothing extra.
  assert.equal(w[0].desc, undefined);
  assert.equal(placeRegion({ name: "Rīga", label: "Rīga", lat: 57, lon: 24 }), null);
});

test("the region is never left in the name — the rider's own Līgatne case", () => {
  /**
   * Measured on a real ride through the dev server, not imagined: the panel's
   * `resolvedPlaces` come from `routedPlaces` in components/home-page.tsx,
   * which builds every place with `name: p.label`. So a stop picked from the
   * list arrives with the region already inside `name`, and the first export
   * of Sigulda → Līgatne → Cēsis produced "1 · Līgatne · Līgatnes pagasts" —
   * the region in the pin's name AND in its description.
   */
  const w = rideWaypoints({
    places: [
      { name: "Sigulda", label: "Sigulda", lat: 57.154, lon: 24.857 },
      { name: "Līgatne · Līgatnes pagasts", label: "Līgatne · Līgatnes pagasts", lat: 57.185, lon: 25.021 },
      { name: "Cēsis", label: "Cēsis", lat: 57.313, lon: 25.275 },
    ],
    returnToStart: false,
    locale: "lv",
  });
  assert.equal(w[1].name, "1 · Līgatne");
  assert.equal(w[1].desc, "Līgatnes pagasts");
  // The two fields are disjoint however the caller filled them in.
  for (const x of w) assert.equal(x.name.includes(x.desc ?? "\u0000"), false, x.name);
});

test("nameless and coordinate-less places are dropped, not exported to the Gulf of Guinea", () => {
  const w = rideWaypoints({
    places: [
      place("Sigulda"),
      { name: "", label: "", lat: 57.2, lon: 24 },
      { name: "NaN place", label: "", lat: Number.NaN, lon: 24 },
      place("Cēsis", 57.3),
    ],
    returnToStart: false,
    locale: "lv",
  });
  assert.deepEqual(w.map((x) => x.name), ["Starts · Sigulda", "Finišs · Cēsis"]);
});

test("a glyph that reached a name is stripped before it reaches the device", () => {
  const w = rideWaypoints({
    places: [place("Sigulda"), place("💦 Ūdenskritums", 57.2, 24, { kind: "waterfall" })],
    returnToStart: true,
    locale: "lv",
  });
  assert.equal(w[1].name, "Ūdenskritums · Ūdenskritums");
  assert.doesNotMatch(w[1].name, /\p{Extended_Pictographic}/u);
});

test("a lone start still exports, and an empty ride exports nothing", () => {
  assert.deepEqual(
    rideWaypoints({ places: [place("Sigulda")], returnToStart: false, locale: "lv" }).map((x) => x.name),
    ["Starts · Sigulda"],
  );
  assert.deepEqual(rideWaypoints({ places: [], returnToStart: true, locale: "lv" }), []);
});

/* ---------- the file itself ---------- */

const line: [number, number][] = [[24.0, 57.0], [24.1, 57.1], [24.2, 57.2]];

test("XML metacharacters are escaped in every field a place can reach", () => {
  const gpx = generateGpx("Ride", line, undefined, [
    { lat: 57, lon: 24, name: `Kaspars & "Co" <b>`, desc: "a > b", sym: "Flag, Blue", type: "stop" },
  ]);
  assert.match(gpx, /<name>Kaspars &amp; &quot;Co&quot; &lt;b&gt;<\/name>/);
  assert.match(gpx, /<desc>a &gt; b<\/desc>/);
  // Nothing unescaped survived: every < in the file opens a real tag.
  assert.equal(gpx.includes("<b>"), false);
});

test("<wpt> comes before <trk> — the schema's order, and Garmin enforces it", () => {
  const gpx = generateGpx("Ride", line, "desc", [
    { lat: 57.0, lon: 24.0, name: "Starts · Sigulda", sym: "Flag, Green", type: "start" },
    { lat: 57.2, lon: 24.2, name: "Finišs · Cēsis", sym: "Flag, Red", type: "finish" },
  ]);
  const firstWpt = gpx.indexOf("<wpt ");
  const lastWpt = gpx.lastIndexOf("<wpt ");
  const trk = gpx.indexOf("<trk>");
  assert.ok(firstWpt > 0, "the file carries waypoints");
  assert.ok(lastWpt < trk, `last <wpt> at ${lastWpt} must precede <trk> at ${trk}`);
  assert.ok(gpx.indexOf("<metadata>") < firstWpt, "metadata comes first");
  // Both ends are there, with their coordinates at GPX's six decimals.
  assert.match(gpx, /<wpt lat="57\.000000" lon="24\.000000">/);
  assert.match(gpx, /<wpt lat="57\.200000" lon="24\.200000">/);
});

test("the old signature still works and writes no <wpt> at all", () => {
  const gpx = generateGpx("Ride", line, "desc");
  assert.equal(gpx.includes("<wpt"), false);
  assert.match(gpx, /<trkpt lat="57\.000000" lon="24\.000000" \/>/);
  assert.equal(generateGpx("Ride", line, "desc", []).includes("<wpt"), false);
});

/**
 * A light well-formedness check rather than a parser dependency.
 *
 * It walks the tags and keeps a stack, which catches the things that actually
 * go wrong when a file is built by string concatenation: an unclosed element,
 * a mismatched close, stray text where markup was meant, and an unescaped `&`
 * or `<` in a place name. A real schema validation needs the XSD and a
 * network, and neither belongs in this suite.
 */
function xmlIsWellFormed(xml: string): true {
  const body = xml.replace(/^<\?xml[^?]*\?>\s*/, "");
  const stack: string[] = [];
  const tag = /<\/?([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*"[^"<]*")*)\s*(\/?)>/g;
  let at = 0;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(body))) {
    const between = body.slice(at, match.index);
    // Text between tags must not carry raw markup characters.
    assert.equal(/[<>]/.test(between), false, `stray markup character in text: ${JSON.stringify(between.slice(0, 60))}`);
    assert.equal(/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/.test(between), false, `unescaped & in ${JSON.stringify(between.slice(0, 60))}`);
    at = match.index + match[0].length;
    const [raw, name, , selfClose] = match;
    if (selfClose) continue;
    if (raw.startsWith("</")) {
      assert.equal(stack.pop(), name, `</${name}> closes the wrong element`);
    } else {
      stack.push(name);
    }
  }
  assert.deepEqual(stack, [], "every element is closed");
  assert.equal(/[<>]/.test(body.slice(at)), false, "no markup after the last tag");
  return true;
}

test("a real ride's file parses as XML", () => {
  const waypoints = rideWaypoints({
    places: [
      { name: "Sigulda & Co", label: "Sigulda & Co · Siguldas novads", lat: 57.1537, lon: 24.8598 },
      { name: "Tūjas", label: "Tūjas · Limbažu novads", lat: 57.4, lon: 24.4 },
      { name: "Gūtmaņa ala", label: "Gūtmaņa ala", lat: 57.18, lon: 24.85, kind: "cave" },
      { name: "Cēsis", label: "Cēsis · Cēsu novads", lat: 57.3126, lon: 25.2749 },
    ],
    returnToStart: false,
    locale: "lv",
  });
  const gpx = generateGpx("Sigulda → Cēsis & back", line, "120 km · 3 h · 40 % grants", waypoints);
  assert.equal(xmlIsWellFormed(gpx), true);
  assert.equal(waypoints.length, 4);
  assert.deepEqual(waypoints.map((w) => w.type), ["start", "stop", "sight", "finish"]);
  // The self-check catches what it claims to: a raw & in a name breaks it.
  assert.throws(() => xmlIsWellFormed(`<gpx><wpt><name>Kaspars & Co</name></wpt></gpx>`));
  assert.throws(() => xmlIsWellFormed(`<gpx><wpt><name>x</name></gpx>`));
});
