// Exists solely so ServiceWorkerRegistration.showNotification() is
// available for the training rest-timer's local notification banner
// (js/app.js). No push handling, no offline caching - those are explicitly
// out of scope; adding either here would need a much more careful
// cache-invalidation story than this one-line worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
