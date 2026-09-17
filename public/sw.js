// Minimal SW: installability only (no offline cache, no push). Phase 7 may add caching.
// Must live at the origin root (/sw.js) to control the whole scope — that's why it's in public/.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {}) // pass-through; presence of a fetch handler enables install

// Phase 7b: Web Push. The payload is JSON { title, body, url } sent by src/lib/push-core.ts.
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  event.waitUntil(
    self.registration.showNotification(data.title || '课程通知', {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url || '/' },
    }),
  )
})
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(self.clients.openWindow(url))
})
