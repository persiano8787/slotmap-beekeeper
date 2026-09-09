const CACHE = 'slotmap-v3';
const DB_URL = './casino_map.sqlite';
const ASSETS = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', DB_URL];

/* @swdb start */
const SQLITE_HEAD = [0x53,0x51,0x4c,0x69,0x74,0x65,0x20,0x66,0x6f,0x72,0x6d,0x61,0x74,0x20,0x33,0x00];

function looksLikeSqlite(bytes) {
  if (!bytes || bytes.length < SQLITE_HEAD.length) return false;
  for (let i = 0; i < SQLITE_HEAD.length; i++) if (bytes[i] !== SQLITE_HEAD[i]) return false;
  return true;
}

// Due risposte sono lo stesso file se il server lo dice: prima l'ETag, poi Last-Modified.
// Se il server non manda né l'uno né l'altro rispondiamo "diverse": meglio scaricare un
// megabyte di troppo che lasciare la sala con dati vecchi senza accorgersene.
function sameEtag(a, b) {
  if (!a || !b) return false;
  const ea = a.headers.get('etag'), eb = b.headers.get('etag');
  if (ea && eb) return ea === eb;
  const la = a.headers.get('last-modified'), lb = b.headers.get('last-modified');
  if (la && lb) return la === lb;
  return false;
}

// 'aggiornato' | 'invariato' | 'saltato'. Non alza mai: un aggiornamento che fallisce
// non deve rompere un'app che sta già funzionando con la copia in cache.
async function refreshDb(cache, fetchFn, url) {
  let fresca;
  try {
    // no-cache = rivalida sempre col server. Se il server risponde 304 il browser
    // riusa il corpo che ha già: la rete vede poche decine di byte, non un megabyte.
    fresca = await fetchFn(url, { cache: 'no-cache' });
  } catch {
    return 'saltato';
  }
  if (!fresca || !fresca.ok) return 'saltato';

  const vecchia = await cache.match(url);
  if (vecchia && sameEtag(vecchia, fresca)) return 'invariato';

  let bytes;
  try {
    bytes = new Uint8Array(await fresca.clone().arrayBuffer());
  } catch {
    return 'saltato';   // scaricamento interrotto a metà
  }
  if (!looksLikeSqlite(bytes)) return 'saltato';

  await cache.put(url, fresca);
  return 'aggiornato';
}
/* @swdb end */

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        // Il database non si rinfresca qui: ci pensa refreshDb quando la pagina lo chiede.
        // Rifarlo a ogni richiesta vorrebbe dire un megabyte a ogni avvio.
        if (cached && e.request.url.endsWith('casino_map.sqlite')) return cached;
        const network = fetch(e.request).then(res => {
          if (res && res.status === 200 && e.request.url.startsWith(self.location.origin)) {
            cache.put(e.request, res.clone());
          }
          return res;
        }).catch(() => cached);
        return cached || network;
      })
    )
  );
});

// La pagina chiede il controllo all'avvio; rispondiamo solo se c'è davvero da ricaricare.
self.addEventListener('message', e => {
  if (!e.data || e.data.type !== 'check-db') return;
  e.waitUntil(
    caches.open(CACHE)
      .then(cache => refreshDb(cache, fetch, DB_URL))
      .then(esito => {
        if (esito === 'aggiornato' && e.source) e.source.postMessage({ type: 'db-updated' });
      })
  );
});
