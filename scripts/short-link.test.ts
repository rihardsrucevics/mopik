import test from "node:test";
import assert from "node:assert/strict";
import { isShareId, longShareUrl, shareLinkForPage, shortShareUrl } from "../lib/share/short-link";

/**
 * Sharing a ride always sends the short /r/<id> link (rider, 2026-09-28: a
 * ride went to WhatsApp as a 4 KB link with no preview card).
 *
 * `npx tsx --test scripts/short-link.test.ts`
 */

const ORIGIN = "https://www.mopik.eu";
const CODE = "1~eyJuIjoiQmFsZG9uZSJ9~abc~def";

type Call = { url: string; body: unknown };
function fakeFetch(answers: (() => Promise<Response>)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    const next = answers[Math.min(calls.length - 1, answers.length - 1)];
    return next();
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const ok = (id: string) => async () => new Response(JSON.stringify({ id, path: `/r/${id}` }), { status: 200 });
const status = (n: number) => async () => new Response(JSON.stringify({ error: "x" }), { status: n });
const timeout = () => async () => { throw new DOMException("The operation timed out.", "TimeoutError"); };

test("the helper returns the short link", async () => {
  const f = fakeFetch([ok("QnNr_L3i")]);
  const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.deepEqual(link, { url: `${ORIGIN}/r/QnNr_L3i`, id: "QnNr_L3i", long: false });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "/api/share");
  assert.deepEqual(f.calls[0].body, { code: CODE });
});

test("it retries once on a timeout, and the second answer counts", async () => {
  const f = fakeFetch([timeout(), ok("Ab3_x-9Z")]);
  const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(f.calls.length, 2);
  assert.equal(link.url, `${ORIGIN}/r/Ab3_x-9Z`);
  assert.equal(link.long, false);
});

test("the timeout is real: a store that hangs is abandoned and asked once more", async () => {
  let calls = 0;
  const hang = ((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    calls++;
    if (calls === 2) return resolve(new Response(JSON.stringify({ id: "Ab3_x-9Z" }), { status: 200 }));
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  })) as unknown as typeof fetch;
  const t0 = Date.now();
  const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: hang, timeoutMs: 50 });
  assert.equal(calls, 2);
  assert.equal(link.id, "Ab3_x-9Z");
  assert.ok(Date.now() - t0 >= 45);
});

test("a store that keeps failing gives the long link, flagged, after exactly two tries", async () => {
  for (const fail of [timeout(), status(503)]) {
    const f = fakeFetch([fail]);
    const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: f.impl });
    assert.equal(f.calls.length, 2, "one retry, not more");
    assert.equal(link.long, true);
    assert.equal(link.id, null);
    assert.equal(link.url, longShareUrl(CODE, ORIGIN));
  }
});

test("a refused code (400) is not retried", async () => {
  const f = fakeFetch([status(400)]);
  const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  assert.equal(link.long, true);
});

test("an answer without a real id is a failure, not a broken link", async () => {
  const f = fakeFetch([async () => new Response(JSON.stringify({ id: "../../x" }), { status: 200 })]);
  const link = await shortShareUrl(CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(link.long, true);
});

test("the long fallback carries no literal ~ (where WhatsApp cut the link to /r/1)", () => {
  const url = longShareUrl(CODE, ORIGIN);
  assert.ok(!url.includes("~"));
  assert.equal(decodeURIComponent(url.slice(`${ORIGIN}/r/`.length)), CODE, "resolveShare decodes it back");
});

test("the shared page shortens a long URL", async () => {
  const f = fakeFetch([ok("QnNr_L3i")]);
  const link = await shareLinkForPage(`/r/${CODE}`, CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(f.calls.length, 1, "asks the store for the page's own code");
  assert.equal(link.url, `${ORIGIN}/r/QnNr_L3i`);
  // The same with the tildes percent-encoded, as the long fallback writes them.
  const g = fakeFetch([ok("QnNr_L3i")]);
  assert.equal((await shareLinkForPage(`/r/${CODE.replace(/~/g, "%7E")}`, CODE, { origin: ORIGIN, fetchImpl: g.impl })).url, `${ORIGIN}/r/QnNr_L3i`);
});

test("the shared page opened by a short id passes that id on without asking", async () => {
  const f = fakeFetch([ok("zzzzzzzz")]);
  const link = await shareLinkForPage("/r/QnNr_L3i", CODE, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(link, { url: `${ORIGIN}/r/QnNr_L3i`, id: "QnNr_L3i", long: false });
});

test("share ids and codes are told apart", () => {
  assert.ok(isShareId("QnNr_L3i"));
  assert.ok(!isShareId(CODE));
  assert.ok(!isShareId("1"));
});

// ---- saved rides: the list opens by the short id, and sharing an opened
// saved ride goes through the helper and remembers what it got.

function fakeWindow() {
  const store = new Map<string, string>();
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    dispatchEvent: () => true,
  };
}

test("a saved ride's share uses the helper, and the list then opens it by the short id", async () => {
  fakeWindow();
  const { saveSharedRide, listSaved, rememberShortId, savedRideHref } = await import("../lib/share/saved-rides");
  saveSharedRide(CODE, { name: "Baldone", km: 120, minutes: 180, unpavedPercent: 40, variant: "balanced" });
  const before = listSaved()[0];
  assert.equal(savedRideHref(before), `/r/${CODE}`, "old saves keep opening by their code");

  // What the shared page does on „Dalīties” after opening that saved ride.
  const f = fakeFetch([ok("QnNr_L3i")]);
  const link = await shareLinkForPage(savedRideHref(before), before.code, { origin: ORIGIN, fetchImpl: f.impl });
  assert.equal(f.calls.length, 1);
  assert.equal(link.url, `${ORIGIN}/r/QnNr_L3i`);
  rememberShortId(before.code, link.id!);

  assert.equal(savedRideHref(listSaved()[0]), "/r/QnNr_L3i");
  rememberShortId("some-other-code", "Zzzzzzzz");
  assert.equal(listSaved().length, 1, "an unsaved code changes nothing");
});

test("a ride saved from a short link keeps that id", async () => {
  fakeWindow();
  const { saveSharedRide, listSaved, savedRideHref } = await import("../lib/share/saved-rides");
  saveSharedRide(CODE, { name: "Baldone", km: 120, minutes: 180, unpavedPercent: 40, variant: "balanced" }, "QnNr_L3i");
  assert.equal(savedRideHref(listSaved()[0]), "/r/QnNr_L3i");
});
