// Service Worker — Islande Road Trip
// Cache des tuiles OpenStreetMap pour utilisation hors-ligne

const CACHE_NAME = 'islande-v1';
const TILE_CACHE = 'islande-tiles-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Intercept OSM tile requests — cache first, then network
self.addEventListener('fetch', e => {
  if (!e.request.url.includes('tile.openstreetmap.org')) return;
  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request).then(resp => {
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(() => cached || new Response('', {status:503}));
      })
    )
  );
});

// Message handler
self.addEventListener('message', e => {
  if (e.data === 'count') {
    caches.open(TILE_CACHE).then(c => c.keys().then(k =>
      e.source.postMessage({type:'count', n: k.length})
    ));
  } else if (e.data === 'clear') {
    caches.delete(TILE_CACHE).then(() =>
      e.source.postMessage({type:'cleared'})
    );
  } else if (e.data && e.data.type === 'precache') {
    precache(e.source, e.data.tiles);
  }
});

async function precache(client, tiles) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = tiles.length;
  for (let i = 0; i < tiles.length; i += 6) {
    const batch = tiles.slice(i, i+6);
    await Promise.all(batch.map(async url => {
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
