"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bookmark } from "lucide-react";
import { track } from "@/lib/analytics";
import { unseenSavedCount } from "@/lib/share/saved-rides";

/**
 * Saved rides in the header: the bookmark alone, with a count when there is
 * something the rider has not looked at.
 *
 * The word "Saglabātie" moved to the footer. A bookmark is the one icon every
 * app uses for exactly this, so the label was spending header width saying
 * what the icon already says — and that width is what the language picker
 * needed. The name still reaches a screen reader through `aria-label`.
 */
export function SavedRidesLink({ label, className = "" }: { label: string; className?: string }) {
  // Zero on the server and on the first client render: the count lives in
  // localStorage, and rendering it straight away is a hydration mismatch.
  const [unseen, setUnseen] = useState(0);

  useEffect(() => {
    const sync = () => setUnseen(unseenSavedCount());
    sync();
    // `mopik:saved-changed` fires on every write, so the count updates the
    // moment a ride is saved rather than on the next navigation. `storage`
    // catches the same in another tab.
    window.addEventListener("mopik:saved-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("mopik:saved-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return (
    <Link
      href="/saglabatie"
      onClick={() => track("saved_list_opened")}
      aria-label={unseen > 0 ? `${label} (${unseen} jauni)` : label}
      title={label}
      className={`relative inline-flex size-9 items-center justify-center rounded-full text-stone-600 transition hover:bg-stone-100 hover:text-stone-900 ${className}`}
    >
      <Bookmark className="size-5" strokeWidth={1.75} />
      {unseen > 0 && (
        // Sits on the icon's corner rather than beside it, so the control
        // keeps its width whether or not there is a count.
        <span
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex min-w-[16px] items-center justify-center rounded-full bg-[#f56300] px-1 text-[10px] font-semibold leading-[16px] text-white shadow-sm"
        >
          {unseen > 9 ? "9+" : unseen}
        </span>
      )}
    </Link>
  );
}
