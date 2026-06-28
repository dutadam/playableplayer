const CACHE = 'm3u-player-v4';
const SHELL = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache video streams or M3U playlist fetches
  const ext = url.pathname.split('.').pop().toLowerCase();
  if (['m3u', 'm3u8', 'ts', 'aac', 'mp4', 'mkv'].includes(ext)) return;
  if (url.hostname.includes('corsproxy') || url.hostname.includes('allorigins')) return;

  e.respondWith(
    caches.match(request).then(cached => {
      const network = fetch(request).then(res => {
        if (res.ok) {
          caches.open(CACHE).then(c => c.put(request, res.clone()));
        }
        return res;
      }).catch(() => cached);
      // Network-first for index.html, cache-first for other assets
      const isShell=url.pathname.endsWith('/')||url.pathname.endsWith('/index.html');
      return isShell ? network : (cached || network);
    })
  );
});
