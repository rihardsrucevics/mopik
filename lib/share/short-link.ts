/**
 * The one way a ride's link is made for sharing: `/r/<8-char id>` from the
 * store (`/api/share` → `lib/share/store.ts`), the long self-contained
 * `/r/<code>` only when the store really fails — and then the caller is told,
 * so the rider is too.
 *
 * Why this exists (rider, 2026-09-28): a ride shared on WhatsApp went out as a
 * 4 KB link with no preview card. Three places made links three ways — the
 * result panel asked the store with a 4 s timeout and fell back silently, the
 * shared page passed on its own address as it was (a long one whenever it was
 * opened from „Saglabātie”, which open by the full code), and the saved list
 * linked by the full code. Production logs that day show a saved ride opened
 * by its 4.8 KB code and, seconds later, six requests for `/r/1` — the link
 * cut at its first `~` (WhatsApp's strikethrough marker), a 404, no card.
 *
 * Client-safe: no Node imports, `fetch` is injectable for the tests.
 */

/** A short id as the store makes them (`shareId` in lib/share/store.ts). */
export function isShareId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/.test(value);
}

/**
 * The long link, with `~` written as `%7E`.
 *
 * The same page opens either way (`resolveShare` decodes the segment), but a
 * literal `~` is where WhatsApp's link detection stops, so the fallback link
 * must not carry one.
 */
export function longShareUrl(code: string, origin: string): string {
  return `${origin}/r/${code.replace(/~/g, "%7E")}`;
}

export function shortUrl(id: string, origin: string): string {
  return `${origin}/r/${id}`;
}

export type ShareLink = {
  url: string;
  /** The short id, when the store gave one. */
  id: string | null;
  /** True when this is the long link because the store did not answer. */
  long: boolean;
};

type Options = {
  origin?: string;
  timeoutMs?: number;
  /** Extra attempts after the first; a 400 (a code the server refuses) is never retried. */
  retries?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 8000;

function defaultOrigin(): string {
  return typeof window !== "undefined" ? window.location.origin : "https://www.mopik.eu";
}

/**
 * The short link for `code`, asking the store up to twice (8 s each). A code
 * that is already a short id is returned as it is, without a request.
 */
export async function shortShareUrl(code: string, opts: Options = {}): Promise<ShareLink> {
  const origin = opts.origin ?? defaultOrigin();
  if (isShareId(code)) return { url: shortUrl(code, origin), id: code, long: false };
  const doFetch = opts.fetchImpl ?? fetch;
  const attempts = 1 + Math.max(0, opts.retries ?? 1);
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null) as { id?: unknown } | null;
        if (body && typeof body.id === "string" && isShareId(body.id)) return { url: shortUrl(body.id, origin), id: body.id, long: false };
      } else if (res.status === 400) {
        break; // the server will refuse this code every time
      }
    } catch {
      // timeout or network: try once more
    }
  }
  return { url: longShareUrl(code, origin), id: null, long: true };
}

/**
 * The link to pass on from a shared ride's page.
 *
 * Opened by a short id, the address already is the link. Opened by a long
 * one — a saved ride, an old link — the page asks for the short one itself
 * rather than pass the long address on.
 */
export async function shareLinkForPage(pathname: string, code: string, opts: Options = {}): Promise<ShareLink> {
  const seg = decodeURIComponent(pathname.replace(/\/+$/, "").split("/").pop() ?? "");
  const origin = opts.origin ?? defaultOrigin();
  if (isShareId(seg)) return { url: shortUrl(seg, origin), id: seg, long: false };
  return shortShareUrl(code, opts);
}
