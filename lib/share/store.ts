import { createHash } from "node:crypto";
import { head, put } from "@vercel/blob";

/**
 * Short share links: `/r/<8 chars>` instead of a 4 KB code. The full code is
 * stored as a small public text blob under a content hash, so the same route
 * shared twice gets the same id and nothing is ever overwritten. Without the
 * token (local dev without `vercel env pull`, or an outage) the app falls
 * back to the long, self-contained link — sharing never breaks.
 */
const PREFIX = "shares/";
const cache = new Map<string, string>();

export function shareId(code: string): string {
  return createHash("sha256").update(code).digest("base64url").slice(0, 8);
}

export function isShareId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8}$/.test(value);
}

export async function saveShare(code: string): Promise<string | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;
  const id = shareId(code);
  if (cache.has(id)) return id;
  try {
    await put(`${PREFIX}${id}`, code, {
      access: "public", addRandomSuffix: false, allowOverwrite: true, contentType: "text/plain; charset=utf-8",
      cacheControlMaxAge: 60 * 60 * 24 * 365,
    });
    cache.set(id, code);
    return id;
  } catch (err) {
    console.error("share store put failed:", err);
    return null;
  }
}

export async function loadShare(id: string): Promise<string | null> {
  const hit = cache.get(id);
  if (hit) return hit;
  if (!process.env.BLOB_READ_WRITE_TOKEN || !isShareId(id)) return null;
  try {
    const meta = await head(`${PREFIX}${id}`);
    const res = await fetch(meta.url, { signal: AbortSignal.timeout(6000), cache: "force-cache" });
    if (!res.ok) return null;
    const code = await res.text();
    cache.set(id, code);
    return code;
  } catch {
    return null;
  }
}
