/**
 * What a failed `/api/generate-route` (or `/api/route-chat`) request was, and
 * whether the page may try it again by itself.
 *
 * Measured 2026-09-29 15:38–15:39 on the rider's iPhone (Švarcmuiža → Ģistas):
 * the server answered 200 both times (Vercel logs, ~45 s each), yet the page
 * showed „Neizdevās ģenerēt maršrutu. (TypeError: Load failed)". Safari's
 * "Load failed" is a fetch that died at the network level — the screen dimmed,
 * the tab went to the background, Wi-Fi handed over to 5G. A ~50 s request is
 * a long time for a phone to hold one connection, so this is expected, and
 * the answer is a plain sentence, one quiet retry, and a button.
 *
 * Pure, so the rules are pinned by `scripts/request-failure.test.ts`.
 */

export type RequestFailureKind =
  /** The rider pressed Atcelt: an answer, not an error. */
  | "cancelled"
  /** The connection itself failed; nothing the server said. */
  | "network"
  /** Anything else: an HTTP error, a bad body, our own message. */
  | "other";

/**
 * The messages browsers give a fetch that failed below HTTP. Safari: "Load
 * failed", "The network connection was lost.", "cancelled"; Chrome: "Failed
 * to fetch", "network error"; Firefox: "NetworkError when attempting to fetch
 * resource."; Node/undici: "fetch failed".
 */
const NETWORK_MESSAGE = /load failed|failed to fetch|networkerror|network error|network connection was lost|fetch failed|^cancelled$|internet connection appears to be offline|err_network|err_internet_disconnected/i;

export function classifyRequestFailure(e: unknown, opts: { userCancelled: boolean }): RequestFailureKind {
  if (opts.userCancelled) return "cancelled";
  if (!e || typeof e !== "object") return "other";
  const { name, message } = e as { name?: unknown; message?: unknown };
  // An abort nobody here asked for (the browser killed the request, or a
  // timeout signal fired) is the connection going away, not the rider.
  if (name === "AbortError" || name === "TimeoutError") return "network";
  if (name === "TypeError" && typeof message === "string" && NETWORK_MESSAGE.test(message.trim())) return "network";
  return "other";
}

/** How long the one quiet retry waits, so a network handover can settle. */
export const AUTO_RETRY_DELAY_MS = 1500;

export type AutoRetryDecision = "now" | "when-visible" | "no";

/**
 * Whether to try again without the rider asking.
 *
 * - Only a network failure: an HTTP 4xx/5xx is the server's answer, and asking
 *   again would get the same one.
 * - Only before any response arrived: once headers are in, the server has done
 *   the work, and the rider decides whether to spend it again.
 * - Only once per request the rider made (`attempt` counts the quiet ones).
 * - While the page is hidden, not now: a request from a background tab dies
 *   the same way. It waits for the page to come back, then goes.
 */
export function autoRetryDecision(p: { kind: RequestFailureKind; hadResponse: boolean; attempt: number; visible: boolean }): AutoRetryDecision {
  if (p.kind !== "network" || p.hadResponse || p.attempt >= 1) return "no";
  return p.visible ? "now" : "when-visible";
}

/** The raw error, short, for the console and analytics — never for the rider. */
export function rawFailure(e: unknown): string {
  if (e && typeof e === "object") {
    const { name, message } = e as { name?: unknown; message?: unknown };
    return `${String(name ?? "Error")}: ${String(message ?? "")}`.slice(0, 120);
  }
  return String(e).slice(0, 120);
}
