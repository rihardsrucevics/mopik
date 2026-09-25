import { ImageResponse } from "next/og";
import { isUiLocale } from "@/lib/i18n/locale";
import { t } from "@/lib/i18n/messages";
import { DEFAULT_METADATA_LOCALE } from "@/lib/i18n/metadata-locale";
import { BRAND_NAME, BRAND_WORDMARK_RATIO, brandWordmarkSvg, svgDataUri } from "@/components/brand-logo";

/**
 * The share card: the same "route drawing itself over the hills" motif as
 * the intro, frozen mid-stroke, with the "mopik." wordmark and tagline.
 *
 * A route handler rather than the `opengraph-image` file convention, because
 * that convention renders one image with no access to the request — so the
 * picture stayed English while the title beside it was Estonian. Here the
 * language rides in as `?lang=`, the same parameter the page itself uses, and
 * the caption is drawn in it.
 */
const size = { width: 1200, height: 630 };

/**
 * The header's "mopik." wordmark (orange dot, no icon, no "eu"), 128 px from
 * ascender to descender — ~423 px wide, about what the old 148 px "Mopik." took.
 */
const LOGO_H = 128;
const LOGO_SRC = svgDataUri(brandWordmarkSvg());

const ROUTE_D =
  "M 12 108 C 40 96, 52 70, 82 74 S 128 110, 158 92 C 184 76, 176 40, 206 38 S 250 68, 272 54 C 292 42, 300 28, 314 22";

export function GET(req: Request) {
  const asked = new URL(req.url).searchParams.get("lang");
  const locale = isUiLocale(asked) ? asked : DEFAULT_METADATA_LOCALE;
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
          {/* The product's own vocabulary, identical in lv, lt, et and en. */}
          {/* eslint-disable-next-line react/jsx-no-literals -- not prose; the same three words in every language */}
          {"ADVENTURE · ENDURO · GPX"}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div style={{ display: "flex" }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- satori, not a page */}
            <img src={LOGO_SRC} width={LOGO_H * BRAND_WORDMARK_RATIO} height={LOGO_H} alt={BRAND_NAME} />
          </div>
          <div style={{ display: "flex", fontSize: 44, color: "#57534e" }}>{t(locale, "tagline")}</div>
          <div style={{ display: "flex", fontSize: 28, color: "#78716c", marginTop: 6 }}>
            {t(locale, "metaCardLine")}
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
