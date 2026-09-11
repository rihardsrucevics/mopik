import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Rider feedback → the maker's inbox.
 *
 * Delivery is Resend (https://resend.com): `RESEND_API_KEY` in the
 * environment, sender `onboarding@resend.dev` (Resend's test sender may only
 * deliver to the account owner's own address, which is exactly the address
 * below, so no domain verification is needed). Without a key the API answers
 * 503 with a mailto: link carrying the same text, and the client opens it.
 * Every message is also logged, so Vercel's runtime logs keep a copy.
 */
const TO = "rihards.rucevics@gmail.com";
const FROM = process.env.FEEDBACK_FROM ?? "Mopik <onboarding@resend.dev>";

const Schema = z.object({
  text: z.string().trim().min(3).max(4000),
  email: z.string().trim().email().max(200).optional(),
  context: z.string().max(600).optional(),
  page: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Uzraksti vismaz pāris vārdus." }, { status: 400 });
  const { text, email, context, page } = parsed.data;
  const body = [text, "", "—", email ? `No: ${email}` : "No: anonīms", context ? `Plāns: ${context}` : "", page ? `Lapa: ${page}` : "", `Laiks: ${new Date().toISOString()}`].filter((l) => l !== "").join("\n");
  console.log("feedback:", JSON.stringify({ email: email ?? null, context: context ?? null, text }));

  const subject = `Mopik atsauksme${email ? ` no ${email}` : ""}`;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const mailto = `mailto:${TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return NextResponse.json({ error: "E-pasta sūtīšana serverī nav konfigurēta.", mailto }, { status: 503 });
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [TO], subject, text: body, ...(email ? { reply_to: email } : {}) }),
    signal: AbortSignal.timeout(10000),
  }).catch((e) => { console.error("feedback mail failed:", e); return null; });
  if (!res || !res.ok) {
    console.error("feedback mail rejected:", res?.status, await res?.text().catch(() => ""));
    const mailto = `mailto:${TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    return NextResponse.json({ error: "E-pasts neaizgāja.", mailto }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
