import type { Metadata } from "next";
import { SavedRidesPage } from "@/components/saved-rides-page";

export const metadata: Metadata = {
  title: "Saved routes",
  description: "Your saved Mopik routes on this device.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SavedRidesPage />;
}
