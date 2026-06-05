// Service Worker — Islande Road Trip
const TILE_CACHE = 'islande-tiles-v1';

self.addEventListener('install', e => {
  console.log('[SW] install');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] activate — claiming');
  e.waitUntil(clients.claim());
});

// Log ALL fetch events to diagnose
self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Log first few requests to confirm SW is intercepting
  if (!self._logged) {
    self._logged = 0;
  }
  if (self._logged < 5) {
    console.log('[SW] fetch intercepted:', url.substring(0, 60));
    self._logged++;
  }

  if (!url.includes('tile.openstreetmap.org')) return;

  console.log('[SW] tile fetch:', url.slice(-20));
  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) {
          console.log('[SW] served from cache');
          return cached;
        }
        return fetch(e.request).then(resp => {
          if (resp && resp.ok) {
            console.log('[SW] cached new tile');
            cache.put(e.request, resp.clone());
          }
          return resp;
        });
      })
    )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'count') {
    caches.open(TILE_CACHE).then(c => c.keys().then(k => {
      console.log('[SW] count:', k.length);
      e.source.postMessage({type: 'count', n: k.length});
    }));
  } else if (e.data === 'clear') {
    caches.delete(TILE_CACHE).then(() => e.source.postMessage({type: 'cleared'}));
  } else if (e.data && e.data.type === 'precache') {
    precache(e.source, e.data.tiles);
  }
});

async function precache(client, tiles) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = tiles.length;
  for (let i = 0; i < tiles.length; i += 6) {
    await Promise.all(tiles.slice(i, i+6).map(async url => {
      try {
        if (!await cache.match(url)) {
          const r = await fetch(url);
          if (r.ok) await cache.put(url, r);
        }
      } catch(e) {}
      done++;
    }));
    if (done % 100 === 0 || done === total)
      client.postMessage({type:'progress', done, total});
    await new Promise(r => setTimeout(r, 20));
  }
  client.postMessage({type:'done', total: done});
}
