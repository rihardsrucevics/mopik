import type { Metadata } from "next";
import { SavedRidesPage } from "@/components/saved-rides-page";

export const metadata: Metadata = {
  title: "Saglabātie maršruti",
  description: "Tavi saglabātie Mopik maršruti šajā ierīcē.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SavedRidesPage />;
}
