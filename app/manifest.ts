import type { MetadataRoute } from "next";

/** Installable on Android Chrome: name, icons, standalone display. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mopik — adventure motorcycle route planner",
    short_name: "Mopik",
    description: "Plans adventure and enduro rides along gravel and forest roads across Europe — from idea to GPX.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#f56300",
    lang: "en",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
