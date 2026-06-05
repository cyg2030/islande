// Service Worker — Islande Road Trip
const TILE_CACHE  = 'islande-tiles-v1';
const ROUTE_CACHE = 'islande-routes-v1';
const APP_CACHE   = 'islande-app-v1';

self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(
      keys.filter(k => ![TILE_CACHE,ROUTE_CACHE,APP_CACHE].includes(k)).map(k => caches.delete(k))
    ))
    .then(() => clients.claim())
));

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Tuiles OSM — cache first
  if (url.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(url).then(resp => {
            if (resp.status === 200) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => new Response('', {status: 503}));
        })
      )
    );
    return;
  }

  // Routes OSRM — cache first
  if (url.includes('router.project-osrm.org')) {
    e.respondWith(
      caches.open(ROUTE_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(url).then(resp => {
            if (resp.status === 200) cache.put(e.request, resp.clone());
            return resp;
          }).catch(() => new Response('', {status: 503}));
        })
      )
    );
    return;
  }

  // hikes.json — network first, cache fallback
  if (url.includes('hikes.json')) {
    e.respondWith(
      fetch(url).then(resp => {
        if (resp.ok) {
          caches.open(APP_CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() =>
        caches.open(APP_CACHE).then(c => c.match(e.request))
          .then(cached => cached || new Response('[]', {headers:{'Content-Type':'application/json'}}))
      )
    );
    return;
  }
});

self.addEventListener('message', e => {
  if (e.data === 'count') {
    Promise.all([
      caches.open(TILE_CACHE).then(c => c.keys().then(k => k.length)).catch(() => -1),
      caches.open(ROUTE_CACHE).then(c => c.keys().then(k => k.length)).catch(() => 0),
    ]).then(([tiles, routes]) =>
      e.source.postMessage({type:'count', n: tiles, routes})
    );
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
