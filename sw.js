// Service Worker — Islande Road Trip v3
const TILE_CACHE = 'islande-tiles-v3';

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.includes('tile.openstreetmap.org')) return;

  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        // Fetch sans aucune modification — requête la plus simple possible
        return fetch(url).then(resp => {
          console.log('[SW v3] status:', resp.status, resp.type, url.slice(-20));
          if (resp.status === 200) cache.put(e.request, resp.clone());
          return resp;
        }).catch(err => {
          console.error('[SW v3] error:', err.message, url.slice(-20));
          return new Response('', {status: 503});
        });
      })
    )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'count') {
    caches.open(TILE_CACHE).then(c => c.keys().then(k =>
      e.source.postMessage({type:'count', n: k.length})
    ));
  } else if (e.data === 'clear') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => e.source.postMessage({type:'cleared'}));
  } else if (e.data && e.data.type === 'precache') {
    precache(e.source, e.data.tiles);
  }
});

async function precache(client, tiles) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  for (let i = 0; i < tiles.length; i += 6) {
    await Promise.all(tiles.slice(i, i+6).map(async url => {
      try {
        if (!await cache.match(url)) {
          const r = await fetch(url);
          if (r.status === 200) await cache.put(url, r);
        }
      } catch(e) {}
      done++;
    }));
    if (done % 100 === 0 || done === tiles.length)
      client.postMessage({type:'progress', done, total: tiles.length});
    await new Promise(r => setTimeout(r, 20));
  }
  client.postMessage({type:'done', total: done});
}
