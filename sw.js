// Service Worker — Islande Road Trip
const TILE_CACHE = 'islande-tiles-v1';

self.addEventListener('install', e => {
  console.log('[SW] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW] Activated — claiming clients');
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  if (!e.request.url.includes('tile.openstreetmap.org')) return;

  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) {
          return cached;
        }
        return fetch(e.request).then(resp => {
          if (resp && resp.ok) {
            cache.put(e.request, resp.clone());
            console.log('[SW] Cached tile:', e.request.url.slice(-30));
          }
          return resp;
        }).catch(() => new Response('', {status: 503}));
      })
    )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'count') {
    caches.open(TILE_CACHE).then(c => c.keys().then(k => {
      console.log('[SW] Cache count:', k.length);
      e.source.postMessage({type: 'count', n: k.length});
    }));
  } else if (e.data === 'clear') {
    caches.delete(TILE_CACHE).then(() => {
      console.log('[SW] Cache cleared');
      e.source.postMessage({type: 'cleared'});
    });
  } else if (e.data && e.data.type === 'precache') {
    precache(e.source, e.data.tiles);
  }
});

async function precache(client, tiles) {
  const cache = await caches.open(TILE_CACHE);
  let done = 0;
  const total = tiles.length;
  for (let i = 0; i < tiles.length; i += 6) {
    const batch = tiles.slice(i, i + 6);
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
      client.postMessage({type: 'progress', done, total});
    await new Promise(r => setTimeout(r, 20));
  }
  client.postMessage({type: 'done', total: done});
}
