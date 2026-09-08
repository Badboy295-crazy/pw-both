// Study Hub PWA Service Worker
const CACHE_NAME = 'studyhub-v2';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (e) => {
  // Let network handle API and video streaming natively
  if (e.request.url.includes('/api/') || e.request.url.includes('/bot/send') || e.request.url.includes('.m3u8') || e.request.url.includes('.mpd')) {
    return;
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});