import test from "node:test";
import assert from "node:assert/strict";
import { autoRetryDecision, classifyRequestFailure, rawFailure } from "../lib/chat/request-failure";
import { messages } from "../lib/i18n/messages";

/**
 * 2026-09-29 15:38, the rider's iPhone: „Neizdevās ģenerēt maršrutu.
 * (TypeError: Load failed)" while the server logged 200 for the same ride.
 * A dropped connection is survivable: a sentence, one quiet retry, a button.
 */

const typeError = (message: string) => new TypeError(message);
const domError = (name: string) => Object.assign(new Error("The operation was aborted."), { name });

test("the browsers' network failures are network", () => {
  for (const m of ["Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource.", "The network connection was lost.", "cancelled", "fetch failed", "network error"]) {
    assert.equal(classifyRequestFailure(typeError(m), { userCancelled: false }), "network", m);
  }
});

test("an abort the rider did not ask for is network; one he did is cancelled", () => {
  assert.equal(classifyRequestFailure(domError("AbortError"), { userCancelled: false }), "network");
  assert.equal(classifyRequestFailure(domError("TimeoutError"), { userCancelled: false }), "network");
  assert.equal(classifyRequestFailure(domError("AbortError"), { userCancelled: true }), "cancelled");
  assert.equal(classifyRequestFailure(typeError("Load failed"), { userCancelled: true }), "cancelled");
});

test("our own errors and code bugs are not network", () => {
  assert.equal(classifyRequestFailure(new Error("Serveris pārtrauca ģenerēšanu"), { userCancelled: false }), "other");
  assert.equal(classifyRequestFailure(new Error("Load failed"), { userCancelled: false }), "other", "only a TypeError from fetch");
  assert.equal(classifyRequestFailure(typeError("Cannot read properties of undefined (reading 'routes')"), { userCancelled: false }), "other");
  assert.equal(classifyRequestFailure(new SyntaxError("Unexpected token <"), { userCancelled: false }), "other");
  assert.equal(classifyRequestFailure(null, { userCancelled: false }), "other");
  assert.equal(classifyRequestFailure("Load failed", { userCancelled: false }), "other");
});

test("one quiet retry, only for a network failure before any response", () => {
  assert.equal(autoRetryDecision({ kind: "network", hadResponse: false, attempt: 0, visible: true }), "now");
  assert.equal(autoRetryDecision({ kind: "network", hadResponse: false, attempt: 0, visible: false }), "when-visible");
  assert.equal(autoRetryDecision({ kind: "network", hadResponse: false, attempt: 1, visible: true }), "no", "only once");
  assert.equal(autoRetryDecision({ kind: "network", hadResponse: true, attempt: 0, visible: true }), "no", "the server already did the work");
  assert.equal(autoRetryDecision({ kind: "other", hadResponse: false, attempt: 0, visible: true }), "no", "an HTTP 4xx/5xx is an answer");
  assert.equal(autoRetryDecision({ kind: "cancelled", hadResponse: false, attempt: 0, visible: true }), "no");
});

test("the raw error is kept short for analytics", () => {
  assert.equal(rawFailure(typeError("Load failed")), "TypeError: Load failed");
  assert.ok(rawFailure(new Error("x".repeat(500))).length <= 120);
});

test("the connection copy: four locales, what happened – what to do, no raw error", () => {
  const expected = {
    lv: "Savienojums pārtrūka, kamēr meklēju maršrutu – mēģini vēlreiz.",
    lt: "Ryšys nutrūko, kol ieškojau maršruto – bandyk dar kartą.",
    et: "Ühendus katkes, kui otsisin marsruuti – proovi uuesti.",
    en: "The connection dropped while I was searching for the route – try again.",
  } as const;
  for (const [locale, text] of Object.entries(expected) as [keyof typeof expected, string][]) {
    const m = messages(locale);
    assert.equal(m.chatErrConnection, text, locale);
    for (const s of [m.chatErrConnection, m.chatErrConnectionChat]) {
      assert.match(s, / – /, `${locale}: en dash between what happened and what to do`);
      assert.doesNotMatch(s, / - |TypeError|Load failed|fetch/i, locale);
    }
    assert.ok(m.chatRetry.length > 0, `${locale}: retry label`);
  }
  assert.equal(messages("lv").chatRetry, "Mēģināt vēlreiz");
});
