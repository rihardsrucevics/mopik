import { ImageResponse } from "next/og";
import { resolveShare } from "@/lib/share/resolve";

/** The share card: the actual route line, coloured by surface, with the numbers. */
export const alt = "Mopik maršruts";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const COLOR: Record<string, string> = { asphalt: "#2f7bff", gravel: "#f56300", compacted: "#f56300", ground: "#8a5a2b", dirt: "#8a5a2b", sand: "#8a5a2b", unknown: "#5b5b60" };

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const share = (await resolveShare(code))?.share ?? null;
  const W = 1200, H = 630, PAD = 60, MAP_W = 640;
  let paths: { d: string; color: string }[] = [];
  if (share) {
    const lats = share.points.map((p) => p[1]), lons = share.points.map((p) => p[0]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const midLat = (minLat + maxLat) / 2;
    const kx = Math.cos((midLat * Math.PI) / 180);
    const spanX = Math.max(1e-6, (maxLon - minLon) * kx), spanY = Math.max(1e-6, maxLat - minLat);
    const scale = Math.min((MAP_W - 2 * PAD) / spanX, (H - 2 * PAD) / spanY);
    const ox = PAD + ((MAP_W - 2 * PAD) - spanX * scale) / 2, oy = PAD + ((H - 2 * PAD) - spanY * scale) / 2;
    const px = (p: [number, number]) => [ox + (p[0] - minLon) * kx * scale, oy + (maxLat - p[1]) * scale] as const;
    let i = 0;
    while (i < share.points.length - 1) {
      const cls = share.classes[i];
      let j = i;
      while (j < share.points.length - 1 && share.classes[j].surface === cls.surface) j++;
      const d = share.points.slice(i, j + 1).map((p, k) => { const [x, y] = px(p); return `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }).join(" ");
      paths.push({ d, color: COLOR[cls.surface] ?? COLOR.unknown });
      i = j;
    }
  }
  if (!paths.length) paths = [{ d: "M 100 400 C 200 300, 300 500, 400 380 S 560 260, 600 300", color: "#f56300" }];
  const minutes = share?.minutes ?? 0;
  const dur = minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#faf9f6", fontFamily: "sans-serif", color: "#1c1917" }}>
        <svg width={MAP_W} height={H} viewBox={`0 0 ${MAP_W} ${H}`} style={{ position: "absolute", left: 0, top: 0 }}>
          <g fill="none" stroke="#e4e0d8" strokeWidth="1">
            <path d="M -10 520 C 120 470, 260 500, 400 540 S 560 600, 660 560" />
            <path d="M -10 120 C 100 60, 260 80, 380 130 S 540 220, 660 160" strokeDasharray="3 6" />
          </g>
          {paths.map((p, k) => <path key={k} d={p.d} fill="none" stroke={p.color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />)}
        </svg>
        <div style={{ position: "absolute", left: MAP_W, top: 0, width: W - MAP_W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 56px 48px 24px" }}>
          <div style={{ display: "flex", fontSize: 22, letterSpacing: 5, color: "#bd4b00", fontWeight: 700 }}>DALĪTS MARŠRUTS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", fontSize: 46, fontWeight: 800, lineHeight: 1.05, letterSpacing: -1 }}>{share?.name ?? "Mopik maršruts"}</div>
            <div style={{ display: "flex", gap: 28, marginTop: 8 }}>
              <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 18, color: "#78716c", letterSpacing: 2 }}>KM</span><span style={{ fontSize: 44, fontWeight: 700 }}>{share?.km ?? "—"}</span></div>
              <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 18, color: "#78716c", letterSpacing: 2 }}>LAIKS</span><span style={{ fontSize: 44, fontWeight: 700 }}>{dur}</span></div>
              <div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: 18, color: "#78716c", letterSpacing: 2 }}>GRANTS</span><span style={{ fontSize: 44, fontWeight: 700 }}>{share?.unpavedPercent ?? "—"} %</span></div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1 }}>Mopik<span style={{ color: "#f56300" }}>.</span></span>
            <span style={{ fontSize: 20, color: "#78716c" }}>mopik.eu</span>
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
