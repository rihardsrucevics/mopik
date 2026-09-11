import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";

/**
 * App icons rendered on demand: the orange route mark on cream. No binary
 * assets to keep in sync; cached by the CDN for a day.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  const px = Math.min(1024, Math.max(48, Number(size) || 192));
  const maskable = req.nextUrl.searchParams.get("maskable") === "1";
  // Maskable icons need a safe zone: keep the mark inside the inner 80 %.
  const pad = maskable ? px * 0.14 : px * 0.06;
  const s = px - pad * 2;
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex", alignItems: "center", justifyContent: "center", background: "#f56300", borderRadius: maskable ? 0 : px * 0.22 }}>
        <svg width={s} height={s} viewBox="0 0 100 100">
          <path d="M 14 74 C 30 64, 34 44, 50 48 S 72 70, 86 30" fill="none" stroke="#faf9f6" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="86" cy="30" r="8" fill="#1c1917" />
        </svg>
      </div>
    ),
    { width: px, height: px, headers: { "Cache-Control": "public, max-age=86400, s-maxage=86400" } },
  );
}
