import { ImageResponse } from "next/og";

/**
 * The share card: the same "route drawing itself over the hills" motif as
 * the intro, frozen mid-stroke, with the wordmark and tagline. Rendered by
 * Next at build time and served at /opengraph-image.
 */
export const alt = "Mopik — adventure motorcycle routes in Latvia";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const ROUTE_D =
  "M 12 108 C 40 96, 52 70, 82 74 S 128 110, 158 92 C 184 76, 176 40, 206 38 S 250 68, 272 54 C 292 42, 300 28, 314 22";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#faf9f6",
          padding: "64px 72px",
          fontFamily: "sans-serif",
          color: "#1c1917",
        }}
      >
        <svg width="1056" height="330" viewBox="0 0 326 102" fill="none" style={{ position: "absolute", left: 72, top: 40 }}>
          <g stroke="#e4e0d8" strokeWidth="1">
            <path d="M -10 96 C 50 70, 90 70, 130 88 S 210 120, 260 96 S 320 72, 340 84" />
            <path d="M -10 78 C 40 50, 100 46, 140 66 S 200 104, 250 78 S 300 48, 340 62" />
            <path d="M 20 60 C 60 34, 110 30, 150 48 S 190 84, 240 60 S 290 30, 330 44" strokeDasharray="2 4" />
          </g>
          <path d="M 58 58 l 4 -8 l 4 8 z M 66 54 l 3 -6 l 3 6 z M 232 50 l 4 -8 l 4 8 z M 244 46 l 3 -6 l 3 6 z M 120 46 l 3 -6 l 3 6 z" fill="#cfd8c8" />
          <path d={ROUTE_D} stroke="#f56300" strokeOpacity="0.16" strokeWidth="3" strokeLinecap="round" />
          <path d={ROUTE_D} stroke="#f56300" strokeWidth="3" strokeLinecap="round" strokeDasharray="220 400" />
          <path d={ROUTE_D} stroke="#faf9f6" strokeWidth="3" strokeLinecap="round" strokeDasharray="4 6" strokeDashoffset="-120" />
          <g transform="translate(206 38) rotate(-8)" fill="#1c1917" stroke="#1c1917" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="-6.5" cy="2.5" r="3.2" fill="none" strokeWidth="1.8" />
            <circle cx="6.5" cy="2.5" r="3.2" fill="none" strokeWidth="1.8" />
            <path d="M -6.5 2.5 L -3 -2 L 3 -2 L 6.5 2.5 Z" strokeWidth="1.4" />
            <path d="M -4 -2 L -6 -5.5 M 3 -2 L 5.5 -5 L 8 -4.5" fill="none" strokeWidth="1.6" />
            <circle cx="-1.5" cy="-6.5" r="2.2" />
          </g>
        </svg>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 26, letterSpacing: 6, color: "#bd4b00", fontWeight: 700 }}>
          ADVENTURE · ENDURO · GPX
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex", fontSize: 148, fontWeight: 800, letterSpacing: -6, lineHeight: 1 }}>
            Mopik<span style={{ color: "#f56300" }}>.</span>
          </div>
          <div style={{ display: "flex", fontSize: 44, color: "#57534e" }}>Less planning. More riding.</div>
          <div style={{ display: "flex", fontSize: 28, color: "#78716c", marginTop: 6 }}>
            Gravel and forest road routes in Latvia — from idea to GPX in seconds.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
