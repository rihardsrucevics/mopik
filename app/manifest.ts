import type { MetadataRoute } from "next";

/** Installable on Android Chrome: name, icons, standalone display. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mopik — adventure moto maršruti",
    short_name: "Mopik",
    description: "Adventure un enduro maršruti pa grants un meža ceļiem Latvijā — no ieceres līdz GPX.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf9f6",
    theme_color: "#f56300",
    lang: "lv",
    icons: [
      { src: "/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/512?maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
