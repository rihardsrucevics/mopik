import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { brandIconSvg, svgDataUri } from "@/components/brand-logo";

/**
 * App icons rendered on demand from the brand mark (`components/brand-logo`):
 * the orange tile with the cream mud splash and the navigation arrow. No
 * binary assets to keep in sync; cached by the CDN for a day.
 *
 * - `purpose: "any"` — the tile as designed, rounded corners on transparent.
 * - `?maskable=1` — full-bleed orange (the launcher cuts its own shape) with
 *   the splash shrunk to 88 %, so its furthest drop sits at ~34 % of the
 *   width from the centre, well inside the 40 % safe circle.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Math.min(1024, Math.max(48, Number(size) || 192));
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  const src = svgDataUri(maskable ? brandIconSvg({ bleed: true, scale: 0.88 }) : brandIconSvg());
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex" }}>
        {/* eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- satori, not a page */}
        <img src={src} width={px} height={px} />
      </div>
    ),
    { width: px, height: px, headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } },
  );
}
