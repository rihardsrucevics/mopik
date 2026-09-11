import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedRouteView } from "@/components/shared-route";
import { decodeRouteShare } from "@/lib/share/route-code";

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
  const share = decodeRouteShare(decodeURIComponent(code));
  if (!share) return { title: "Maršruts nav atrasts" };
  const title = `${share.name} · ${share.km} km · ${minutesLabel(share.minutes)}`;
  const description = `${share.unpavedPercent} % grants un meža ceļu, ${share.repeatedPercent} % atkārtoti. Adventure maršruts no Mopik — lejupielādē GPX vai uztaisi līdzīgu.`;
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
  const raw = decodeURIComponent(code);
  const share = decodeRouteShare(raw);
  if (!share) notFound();
  const planCode = raw.split("~")[4] ?? null;
  return <SharedRouteView share={share} planCode={planCode} />;
}
