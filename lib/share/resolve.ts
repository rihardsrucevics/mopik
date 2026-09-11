import { decodeRouteShare, type SharedRoute } from "@/lib/share/route-code";
import { isShareId, loadShare } from "@/lib/share/store";

/** A short id or a full code → the route, plus the full code (for the plan part). */
export async function resolveShare(codeOrId: string): Promise<{ share: SharedRoute; code: string } | null> {
  const raw = decodeURIComponent(codeOrId);
  const code = raw.includes("~") ? raw : isShareId(raw) ? await loadShare(raw) : null;
  if (!code) return null;
  const share = decodeRouteShare(code);
  return share ? { share, code } : null;
}
