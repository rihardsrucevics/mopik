// Minimal service worker: makes Mopik installable on Android Chrome. It does
// not cache anything on purpose — routes must always be fresh.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
