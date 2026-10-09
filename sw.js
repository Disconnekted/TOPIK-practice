// Offline support. App files: network first (so updates arrive when online),
// cached copy when offline. Audio clips and fonts: cached copy first.
const SHELL_CACHE = 'topik-shell-v2';
const AUDIO_CACHE = 'topik-audio';
const FONT_CACHE = 'topik-fonts';
const SHELL = ['./', 'index.html', 'app.js', 'audio-key.js', 'data/content.js', 'data/words.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'audio/index.json'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache =>
    Promise.all(SHELL.map(u => cache.add(u).catch(() => { })))
  ).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(k => k.startsWith('topik-shell-') && k !== SHELL_CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && (res.ok || res.type === 'opaque')) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    if (request.mode === 'navigate') return (await cache.match('index.html')) || (await cache.match('./'));
    throw e;
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONT_CACHE)); return;
  }
  if (url.origin !== self.location.origin) return; // e.g. the Anthropic API: always live
  if (url.pathname.endsWith('.mp3')) { event.respondWith(cacheFirst(req, AUDIO_CACHE)); return; }
  event.respondWith(networkFirst(req));
});
