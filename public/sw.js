const CACHE = 'aimers-pwa-v1';
const OFFLINE = '/offline.html';
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll([OFFLINE, '/icons/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('aimers-pwa-') && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
// Never cache API responses, OAuth redirects, access tokens, or personal records.
self.addEventListener('fetch', (event) => {
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)));
  else if (new URL(event.request.url).pathname === '/icons/icon-192.png') event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Always display a visible notification. */ }
  event.waitUntil(self.registration.showNotification(data.title || 'AIMers', {
    body: data.body || '새로운 알림이 있어요.', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png',
    tag: data.tag || 'aimers', silent: false, data: { url: data.url || '/#/groups' },
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin);
  const url = target.origin === self.location.origin ? target.href : self.location.origin;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((item) => new URL(item.url).origin === self.location.origin);
    if (client) { await client.navigate(url); return client.focus(); }
    return self.clients.openWindow(url);
  }));
});
