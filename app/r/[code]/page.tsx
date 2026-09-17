import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedRouteView } from "@/components/shared-route";
import { planPart } from "@/lib/share/route-code";
import { resolveShare } from "@/lib/share/resolve";

/**
 * /r/<code>: a shared route. The whole route lives in the code (see
 * lib/share/route-code.ts), so this page needs no storage and the link never
 * expires. The card preview (title, description, image) is generated from
 * the same code, so a link pasted into WhatsApp shows the ride.
 */
type Params = { params: Promise<{ code: string }> };

function minutesLabel(m: number): string {
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}` : `${m} min`;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { code } = await params;
  const resolved = await resolveShare(code);
  if (!resolved) return { title: "Route not found" };
  const { share } = resolved;
  // The route's own name stays as the rider wrote it — it is a place, not a
  // sentence to translate. Everything the app adds around it is English, the
  // same as the rest of the metadata: a shared link is unfurled once and
  // cached, so it cannot follow whoever opens it.
  const title = `${share.name} · ${share.km} km · ${minutesLabel(share.minutes)}`;
  const description = `${share.unpavedPercent} % gravel and forest roads, ${share.repeatedPercent} % retraced. An adventure route from Mopik — download the GPX or plan a similar one.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "article", images: [{ url: `/r/${code}/opengraph-image`, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
    robots: { index: false, follow: true },
  };
}

export default async function SharedRoutePage({ params }: Params) {
  const { code } = await params;
  const resolved = await resolveShare(code);
  if (!resolved) notFound();
  const planCode = planPart(resolved.code);
  return <SharedRouteView share={resolved.share} planCode={planCode} code={resolved.code} />;
}
