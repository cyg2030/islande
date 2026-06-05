// Service Worker — Islande Road Trip v2
const TILE_CACHE = 'islande-tiles-v2'; // version incrémentée pour forcer la mise à jour

self.addEventListener('install', e => {
  console.log('[SW v2] install');
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  console.log('[SW v2] activate');
  // Supprimer les anciens caches
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== TILE_CACHE).map(k => caches.delete(k)))
    ).then(() => clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  if (!url.includes('tile.openstreetmap.org')) return;

  e.respondWith(
    caches.open(TILE_CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        if (cached) return cached;
        return fetch(e.request, {credentials: 'omit'}).then(resp => {
          console.log('[SW v2] tile status:', resp.status, url.slice(-20));
          if (resp.ok) cache.put(e.request, resp.clone());
          return resp;
        }).catch(err => {
          console.error('[SW v2] error:', err.message);
          return new Response('', {status: 503});
        });
      })
    )
  );
});

self.addEventListener('message', e => {
  if (e.data === 'count') {
    caches.open(TILE_CACHE).then(c => c.keys().then(k => {
      console.log('[SW v2] count:', k.length);
      e.source.postMessage({type:'count', n: k.length});
    }));
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
          const r = await fetch(url, {credentials:'omit'});
          if (r.ok) await cache.put(url, r);
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
