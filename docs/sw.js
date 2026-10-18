// JazzDojo service worker: cache-first so the app (and its samples) work offline after the first visit.
const CACHE = 'jazzdojo-mve16b83';
const PRECACHE = ["./","index.html","fonts/SairaSemiCondensed-Bold.ttf","fonts/SairaSemiCondensed-Regular.ttf","fonts/SairaSemiCondensed-SemiBold.ttf","icons/enso.svg","icons/icon-180.png","icons/icon-192.png","icons/icon-512.png","icons/icon.svg","icons/wordmark.svg","index.html","manifest.webmanifest","samples/bass/28.mp3","samples/bass/30.mp3","samples/bass/32.mp3","samples/bass/34.mp3","samples/bass/36.mp3","samples/bass/38.mp3","samples/bass/40.mp3","samples/bass/42.mp3","samples/bass/44.mp3","samples/bass/46.mp3","samples/bass/48.mp3","samples/bass/50.mp3","samples/bass/52.mp3","samples/drums/bell0.mp3","samples/drums/hhclosed0.mp3","samples/drums/hhclosed1.mp3","samples/drums/hhclosed2.mp3","samples/drums/hhclosed3.mp3","samples/drums/hhhalf0.mp3","samples/drums/hhpedal0.mp3","samples/drums/hhpedal1.mp3","samples/drums/hhpedal2.mp3","samples/drums/hhpedal3.mp3","samples/drums/kick0.mp3","samples/drums/kick1.mp3","samples/drums/kick2.mp3","samples/drums/ride0.mp3","samples/drums/ride1.mp3","samples/drums/ride2.mp3","samples/drums/ride3.mp3","samples/drums/ride4.mp3","samples/drums/ride5.mp3","samples/drums/snare0.mp3","samples/drums/snare1.mp3","samples/drums/snare2.mp3","samples/drums/snare3.mp3","samples/drums/xstick0.mp3","samples/drums/xstick1.mp3","samples/guitar/46.mp3","samples/guitar/48.mp3","samples/guitar/50.mp3","samples/guitar/52.mp3","samples/guitar/54.mp3","samples/guitar/56.mp3","samples/guitar/58.mp3","samples/guitar/60.mp3","samples/guitar/62.mp3","samples/guitar/64.mp3","samples/guitar/66.mp3","samples/guitar/68.mp3","samples/guitar/70.mp3","samples/guitar/72.mp3","samples/guitar/74.mp3","samples/guitar/76.mp3","samples/guitar/78.mp3","samples/manifest.json","samples/piano/46.mp3","samples/piano/48.mp3","samples/piano/50.mp3","samples/piano/52.mp3","samples/piano/54.mp3","samples/piano/56.mp3","samples/piano/58.mp3","samples/piano/60.mp3","samples/piano/62.mp3","samples/piano/64.mp3","samples/piano/66.mp3","samples/piano/68.mp3","samples/piano/70.mp3","samples/piano/72.mp3","samples/piano/74.mp3","samples/piano/76.mp3","samples/piano/78.mp3","samples/piano/80.mp3","samples/piano/82.mp3","samples/rhodes/46.mp3","samples/rhodes/48.mp3","samples/rhodes/50.mp3","samples/rhodes/52.mp3","samples/rhodes/54.mp3","samples/rhodes/56.mp3","samples/rhodes/58.mp3","samples/rhodes/60.mp3","samples/rhodes/62.mp3","samples/rhodes/64.mp3","samples/rhodes/66.mp3","samples/rhodes/68.mp3","samples/rhodes/70.mp3","samples/rhodes/72.mp3","samples/rhodes/74.mp3","samples/rhodes/76.mp3","samples/rhodes/78.mp3","samples/rhodes/80.mp3","samples/rhodes/82.mp3"];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
    if (res.ok && (new URL(req.url).origin === location.origin || req.url.startsWith('https://fonts.'))) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => hit)));
});
