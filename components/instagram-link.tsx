"use client";

import { useId, type ReactNode } from "react";
import { track } from "@/lib/analytics";

export const INSTAGRAM_URL = "https://www.instagram.com/mopik.eu";
/** The author's own account, linked from the credit line. */
export const AUTHOR_INSTAGRAM_URL = "https://www.instagram.com/rucijs";

/**
 * The Instagram glyph. `lucide-react` has no brand icons, and `AtSign` does not
 * read as Instagram — the rounded square with a lens is the thing people
 * recognise, so it is drawn here once and shared by every place that links out.
 */
export function InstagramGlyph({ className = "size-4" }: { className?: string }) {
  // The real mark, gradient and all: the outline version read as a generic
  // camera next to grey text. Each instance needs its own gradient id or the
  // second one on a page inherits the first's — `useId` keeps server and
  // client agreeing on it, which a module counter would not.
  const id = `mopik-ig-${useId()}`;
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <radialGradient id={id} cx="0.3" cy="1.05" r="1.25">
          <stop offset="0%" stopColor="#fdd757" />
          <stop offset="25%" stopColor="#f8a11c" />
          <stop offset="50%" stopColor="#f4341f" />
          <stop offset="72%" stopColor="#d92d7a" />
          <stop offset="100%" stopColor="#7239bd" />
        </radialGradient>
      </defs>
      <rect x="0.5" y="0.5" width="23" height="23" rx="6.5" fill={`url(#${id})`} />
      <rect x="5" y="5" width="14" height="14" rx="4.4" fill="none" stroke="#fff" strokeWidth="1.9" />
      <circle cx="12" cy="12" r="3.5" fill="none" stroke="#fff" strokeWidth="1.9" />
      <circle cx="17.1" cy="6.9" r="1.15" fill="#fff" />
    </svg>
  );
}

/**
 * "Sazinies" — feedback is a DM. The form mailed one address through Resend
 * and nobody could see the reply; Instagram is where riders already talk about
 * routes, and an answer there helps the next rider too.
 */
export function InstagramLink({ from, label = "Sazinies", className, href = INSTAGRAM_URL }: {
  /** where the link was tapped, so the analytics say which placement works */
  from: string;
  label?: ReactNode;
  className?: string;
  /** Defaults to the Mopik account; the author's own is a different one. */
  href?: string;
}) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer"
      onClick={() => track("instagram_opened", { from })}
      className={className ?? "inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-900"}>
      <InstagramGlyph />
      {label}
    </a>
  );
}
