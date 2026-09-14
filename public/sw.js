// Minimal SW: installability only (no offline cache, no push). Phase 7 may add caching.
// Must live at the origin root (/sw.js) to control the whole scope — that's why it's in public/.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {}) // pass-through; presence of a fetch handler enables install
