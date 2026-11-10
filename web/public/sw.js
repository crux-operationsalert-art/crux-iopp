// Caches the static app shell only. Business data always goes to the server (SOW 12.6). Shows phone notifications.
const C = 'crux-shell-v3';
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(C).then((c) => c.addAll(['./', './index.html', './icon.svg']))); });
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== C).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // never cache API calls
  e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(C).then((c) => c.put(e.request, cp)); return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('./index.html'))));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'CRUX Productivity', {
    body: d.body || '', icon: './icon-192.png', badge: './icon-192.png', data: { url: d.url || '#/notifications' }, tag: d.tag, renotify: !!d.tag }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Open the exact screen the notification is about (D-101). An open app window is told to go there (a hash change inside
  // the page — navigate() is unreliable for same-page links and for windows this worker does not control); otherwise a new window opens on it.
  const route = String((e.notification.data && e.notification.data.url) || '#/').replace(/^\.?\/?/, '');
  const target = new URL('./' + (route.startsWith('#') ? route : '#' + (route.startsWith('/') ? route : '/' + route)), self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (ws) => {
    const w = ws.find((x) => x.url.startsWith(self.registration.scope));
    if (w) {
      try { await w.focus(); } catch { /* not allowed: fall through */ }
      w.postMessage({ type: 'open', url: target });
      return;
    }
    return self.clients.openWindow(target);
  }));
});
