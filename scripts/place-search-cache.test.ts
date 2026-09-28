import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CACHE_TTL_MS, EMPTY_TTL_MS, SEARCH_TIMEOUT_MS, USER_SEARCH_TIMEOUT_MS, clearPlaceCache, searchPlacesDetailed } from "../lib/chat/photon";
import { t } from "../lib/i18n/messages";
import type { UiLocale } from "../lib/i18n/locale";

/**
 * The place search's cache (bug found 2026-09-28): when Photon timed out,
 * `/api/places` cached the empty list and served "nothing found" for real
 * towns for ten minutes, until the server restarted. Now only real answers
 * are cached, a real empty answer briefly, a timeout is retried once, and
 * the form is told it was a timeout.
 *
 * `npx tsx --test scripts/place-search-cache.test.ts`
 */

const SIGULDA = { type: "Feature", geometry: { coordinates: [24.8567, 57.1541] }, properties: { name: "Sigulda", osm_key: "place", osm_value: "town", type: "city", country: "Latvija" } };
const answer = (features: unknown[]) => new Response(JSON.stringify({ type: "FeatureCollection", features }), { status: 200 });
const timeoutError = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/** A fake Photon: each call takes the next reply (a Response, or an error to throw). */
function photon(replies: (Response | Error)[]) {
  let calls = 0;
  const fetcher = (async () => {
    const r = replies[Math.min(calls++, replies.length - 1)];
    if (r instanceof Error) throw r;
    return r.clone();
  }) as unknown as typeof fetch;
  return { fetcher, calls: () => calls };
}
const quiet = () => { const warn = console.warn; console.warn = () => {}; return () => { console.warn = warn; }; };

test("a timeout is never cached, and is said as a timeout", async () => {
  clearPlaceCache();
  const restore = quiet();
  try {
    const slow = photon([timeoutError()]);
    const first = await searchPlacesDetailed("Sigulda", undefined, { fetcher: slow.fetcher });
    assert.deepEqual(first, { places: [], status: "timeout" });
    // Photon is back: the next search asks it again and gets the town.
    const back = photon([answer([SIGULDA])]);
    const second = await searchPlacesDetailed("Sigulda", undefined, { fetcher: back.fetcher });
    assert.equal(back.calls(), 1, "not served from the cache");
    assert.equal(second.status, "ok");
    assert.equal(second.places[0]?.name, "Sigulda");
    // Nor an error or an HTTP failure.
    clearPlaceCache();
    const down = photon([new Response("busy", { status: 503 })]);
    assert.equal((await searchPlacesDetailed("Cēsis", undefined, { fetcher: down.fetcher })).status, "error");
    const up = photon([answer([])]);
    await searchPlacesDetailed("Cēsis", undefined, { fetcher: up.fetcher });
    assert.equal(up.calls(), 1, "an error is not cached");
  } finally { restore(); }
});

test("a timeout is retried once when asked to, and the retry's answer counts", async () => {
  clearPlaceCache();
  const restore = quiet();
  try {
    const flaky = photon([timeoutError(), answer([SIGULDA])]);
    const got = await searchPlacesDetailed("Sigulda", undefined, { fetcher: flaky.fetcher, retries: 1 });
    assert.equal(flaky.calls(), 2);
    assert.equal(got.status, "ok");
    assert.equal(got.places[0]?.name, "Sigulda");
    clearPlaceCache();
    const dead = photon([timeoutError(), timeoutError(), answer([SIGULDA])]);
    assert.equal((await searchPlacesDetailed("Sigulda", undefined, { fetcher: dead.fetcher, retries: 1 })).status, "timeout");
    assert.equal(dead.calls(), 2, "once, not more");
  } finally { restore(); }
});

test("a real result is cached", async () => {
  clearPlaceCache();
  let clock = 1_000_000;
  const now = () => clock;
  const net = photon([answer([SIGULDA])]);
  await searchPlacesDetailed("Sigulda", undefined, { fetcher: net.fetcher, now });
  clock += CACHE_TTL_MS - 1;
  const again = await searchPlacesDetailed("Sigulda", undefined, { fetcher: net.fetcher, now });
  assert.equal(net.calls(), 1, "served from the cache");
  assert.equal(again.places[0]?.name, "Sigulda");
  clock += 2;
  await searchPlacesDetailed("Sigulda", undefined, { fetcher: net.fetcher, now });
  assert.equal(net.calls(), 2, "asked again once it is old");
});

test("a genuine empty answer is cached only briefly", async () => {
  clearPlaceCache();
  let clock = 5_000_000;
  const now = () => clock;
  const net = photon([answer([]), answer([SIGULDA])]);
  assert.deepEqual(await searchPlacesDetailed("Siguldx", undefined, { fetcher: net.fetcher, now }), { places: [], status: "ok" });
  clock += EMPTY_TTL_MS - 1;
  await searchPlacesDetailed("Siguldx", undefined, { fetcher: net.fetcher, now });
  assert.equal(net.calls(), 1, "kept for a moment");
  clock += 2;
  const later = await searchPlacesDetailed("Siguldx", undefined, { fetcher: net.fetcher, now });
  assert.equal(net.calls(), 2, "expired");
  assert.equal(later.places.length, 1);
  assert.ok(EMPTY_TTL_MS <= 60_000 && EMPTY_TTL_MS < CACHE_TTL_MS);
});

test("the form waits longer and is told; the background keeps its 6 s", () => {
  assert.equal(SEARCH_TIMEOUT_MS, 6_000);
  assert.equal(USER_SEARCH_TIMEOUT_MS, 9_000);
  const route = readFileSync(join(__dirname, "../app/api/places/route.ts"), "utf8");
  assert.match(route, /searchPlacesDetailed\(q, home, \{ timeoutMs: USER_SEARCH_TIMEOUT_MS, retries: 1 \}\)/);
  assert.match(route, /status === "ok" \? \{ places \} : \{ places, unavailable: status \}/);
  const input = readFileSync(join(__dirname, "../components/place-input.tsx"), "utf8");
  assert.match(input, /setSearchSlow\(Boolean\(data\.unavailable\)\)/);
  assert.match(input, /\{m\.placeSearchSlow\}/);
  assert.equal(t("lv", "placeSearchSlow"), "Vietu meklēšana šobrīd atbild lēni – mēģini vēlreiz");
  for (const l of ["lt", "et", "en"] as UiLocale[]) assert.match(t(l, "placeSearchSlow"), / – /);
});
