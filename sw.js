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

// looksLikeSqlite guarda solo i primi 16 byte: un file troncato a metà scaricamento ma
// con l'intestazione buona li passa comunque. Un file VACUUMato (release/casino_map.sqlite
// lo è sempre, vedi vacuumToBytes in tools/build.mjs) è internamente coerente: page_size
// (byte 16-17, grande endian; il valore speciale 1 significa 65536) moltiplicato per page_count
// (byte 28-31) deve tornare alla lunghezza vera del file. Se page_count è 0 il campo non è
// significativo (file scritti da SQLite molto vecchie) e non possiamo verificare: non
// blocchiamo, meglio un file che non sappiamo controllare che un falso allarme perenne.
// NON si usa Content-Length: GitHub Pages serve il .sqlite compresso (gzip), quindi
// l'header conta i byte compressi mentre arrayBuffer() qui restituisce i byte
// decompressi — il confronto sarebbe sempre falso.
function looksComplete(bytes) {
  if (!bytes || bytes.length < 32) return false;
  const rawPageSize = bytes[16] << 8 | bytes[17];
  // 1 è il valore speciale per 65536 (non sta in 16 bit); 0 non è un page_size valido
  // in un header reale ma può capitare su byte non impostati: stesso ripiego, non blocca.
  const pageSize = rawPageSize === 1 ? 65536 : (rawPageSize || 65536);
  const pageCount = (bytes[28] << 24 | bytes[29] << 16 | bytes[30] << 8 | bytes[31]) >>> 0;
  if (pageCount && pageSize * pageCount !== bytes.length) return false;
  return true;
}

// Due risposte sono lo stesso file se il server lo dice: prima l'ETag, poi Last-Modified.
// Se il server non manda né l'uno né l'altro rispondiamo "diverse": meglio scaricare un
// megabyte di troppo che lasciare la sala con dati vecchi senza accorgersene.
// Note dal traffico vero di GitHub Pages (richiesto con Accept-Encoding: gzip):
// - l'ETag arriva DEBOLE (prefisso "W/") e il file è servito gzippato anche se è un
//   .sqlite: la forma dipende dall'Accept-Encoding della richiesta, non è un guasto.
//   Il confronto qui sotto resta corretto perché il browser manda sempre gli stessi
//   header, quindi le due risposte confrontate sono sempre nella stessa forma. Non
//   normalizzare il prefisso "W/" "per pulizia": non serve e nasconde questo dettaglio.
// - l'ETag ha forma "<istante-di-deploy>-<dimensione>": cambia a OGNI pubblicazione,
//   anche di sola pagina/codice senza toccare i dati. Conseguenza accettata: un push che
//   tocca solo viewer_HOST.html o sw.js fa riscaricare comunque il megabyte del database
//   e mostra la fascetta "Dati aggiornati" pure se i dati non sono cambiati. Innocuo, ma
//   va saputo: non è un bug da inseguire.
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
  if (!looksComplete(bytes)) return 'saltato';   // intestazione buona, corpo troncato

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
