import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SharedRouteView } from "@/components/shared-route";
import { planPart } from "@/lib/share/route-code";
import { resolveShare } from "@/lib/share/resolve";
import { fi } from "@/lib/i18n/format";
import { t } from "@/lib/i18n/messages";
import { DEFAULT_SHARE_LOCALE } from "@/lib/share/card-locale";

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
  if (!resolved) return { title: t(DEFAULT_SHARE_LOCALE, "shareCardNotFound") };
  const { share } = resolved;
  /**
   * The card speaks the language of the rider who made the ride.
   *
   * Unlike the home page, a shared link *has* a right answer: it is one ride
   * made by one person and sent to people they chose, so the sender's own
   * language is the best guess about the reader's. The home page has no such
   * sender, which is why its metadata stays English.
   *
   * A code with no language is a link made before this existed — those were
   * made in Latvian, so that is the fallback rather than English.
   */
  const locale = share.locale ?? DEFAULT_SHARE_LOCALE;
  // The route's own name stays as the rider wrote it: it is a name, not a
  // sentence to translate.
  const title = `${share.name} · ${share.km} km · ${minutesLabel(share.minutes)}`;
  const description = fi(t(locale, "shareCardDescription"), {
    unpaved: share.unpavedPercent,
    repeated: share.repeatedPercent,
  });
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
