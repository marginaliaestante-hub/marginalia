// Marginália — service worker
// Serve os endereços "_blob/{id}" (capas, textos e PDFs) a partir do armazenamento
// privado do Supabase, com a sessão da usuária logada, e guarda uma cópia no aparelho
// para não baixar de novo (os arquivos nunca mudam: um arquivo novo ganha um id novo).

const CACHE = 'marginalia-blobs-v1';
let auth = null; // { token, uid, url, key, bucket }

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('message', e => {
  const m = e.data || {};
  if (m.type === 'auth') auth = m.auth;
  if (m.type === 'logout') { auth = null; e.waitUntil(caches.delete(CACHE)); }
});

// Pede a sessão atual a uma aba aberta (o service worker pode ter sido reiniciado e perdido a memória).
async function askAuth(clientId) {
  const list = [];
  if (clientId) { const c = await self.clients.get(clientId); if (c) list.push(c); }
  list.push(...await self.clients.matchAll({ type: 'window' }));
  for (const c of list) {
    const a = await new Promise(res => {
      const ch = new MessageChannel();
      const t = setTimeout(() => res(null), 3000);
      ch.port1.onmessage = ev => { clearTimeout(t); res(ev.data); };
      c.postMessage({ type: 'auth?' }, [ch.port2]);
    });
    if (a) return (auth = a);
  }
  return null;
}

async function serveBlob(event, id) {
  const cache = await caches.open(CACHE);
  const key = new URL('_blob/' + id, self.registration.scope).href;
  const hit = await cache.match(key);
  if (hit) return hit;

  for (let attempt = 0; attempt < 2; attempt++) {
    const a = (attempt === 0 && auth) ? auth : await askAuth(event.clientId);
    if (!a) return new Response('sem sessão', { status: 401 });
    const url = `${a.url}/storage/v1/object/authenticated/${a.bucket}/${a.uid}/${encodeURIComponent(id)}`;
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + a.token, apikey: a.key } });
    if (r.ok) {
      const body = await r.blob();
      const resp = new Response(body, { headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream' } });
      cache.put(key, resp.clone()).catch(() => {});
      return resp;
    }
    if (r.status !== 400 && r.status !== 401 && r.status !== 403) return new Response('erro', { status: r.status });
    auth = null; // token vencido: pede um novo e tenta mais uma vez
  }
  return new Response('não autorizado', { status: 403 });
}

self.addEventListener('fetch', event => {
  const u = new URL(event.request.url);
  if (u.origin !== self.location.origin || event.request.method !== 'GET') return;
  const scopePath = new URL(self.registration.scope).pathname;
  if (!u.pathname.startsWith(scopePath + '_blob/')) return;
  const id = decodeURIComponent(u.pathname.slice((scopePath + '_blob/').length));
  if (!id || id.includes('/')) return;
  event.respondWith(serveBlob(event, id));
});
