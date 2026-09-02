import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mopik",
  description: "Adventure motorcycle routes from natural language. From idea to GPX in seconds.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
