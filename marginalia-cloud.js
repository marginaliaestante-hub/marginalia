/* Marginália — camada de compatibilidade
 * Imita window.claude.use('db' | 'assets' | 'downloads' | 'permissions' | 'sample')
 * do artefato, por cima do Supabase (login, banco e armazenamento privado).
 * O resto do código da Marginália continua chamando as mesmas funções de antes.
 */
(() => {
  const CFG = window.MARGINALIA_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.marginaliaSupabase = sb; // útil para depurar no console

  let session = null;
  let resolveReady;
  const ready = new Promise(r => (resolveReady = r));
  const uid = () => session && session.user.id;

  /* ===================== service worker (arquivos privados) ===================== */
  const authMsg = () => session && ({ token: session.access_token, uid: uid(), url: CFG.url, key: CFG.key, bucket: CFG.bucket });
  function postAuth() {
    const c = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (c && session) c.postMessage({ type: 'auth', auth: authMsg() });
  }
  async function setupSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data && e.data.type === 'auth?' && e.ports[0]) e.ports[0].postMessage(authMsg());
    });
    try {
      await navigator.serviceWorker.register('sw.js', { scope: './' });
      if (!navigator.serviceWorker.controller) {
        await new Promise(res => {
          const t = setTimeout(res, 4000);
          navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
        });
      }
    } catch (e) { console.warn('[marginalia] service worker indisponível', e); }
    postAuth();
  }

  /* ===================== tela de login ===================== */
  const css = `
  #mg-login{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:var(--bg,#F3EEF4);padding:24px 16px}
  #mg-login form{width:min(360px,100%);background:var(--surface,#FCF9FC);border:1px solid var(--line,#E3D9E6);border-radius:18px;padding:34px 28px 28px;box-shadow:0 18px 50px var(--shadow,rgba(60,30,60,.16))}
  #mg-login h1{font:400 44px/1 var(--f-display,Georgia,serif);margin:0 0 4px;color:var(--ink,#2A1F2D)}
  #mg-login h1 i{color:var(--accent,#8C3A69)}
  #mg-login p{margin:0 0 24px;color:var(--muted,#7B6C80);font:italic 15px/1.4 var(--f-book,Georgia,serif)}
  #mg-login label{display:block;font:500 12px/1 var(--f-body,system-ui);letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#7B6C80);margin:14px 0 6px}
  #mg-login input{width:100%;box-sizing:border-box;font:15px var(--f-body,system-ui);padding:11px 12px;border-radius:10px;border:1px solid var(--line,#E3D9E6);background:var(--bg,#F3EEF4);color:var(--ink,#2A1F2D)}
  #mg-login button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:999px;background:var(--accent,#8C3A69);color:var(--accent-ink,#fff);font:600 15px var(--f-body,system-ui);cursor:pointer}
  #mg-login button[disabled]{opacity:.6;cursor:wait}
  #mg-login .err{min-height:18px;margin-top:12px;color:#B3261E;font:13px/1.4 var(--f-body,system-ui)}
  #mg-login .hand{display:block;margin-top:18px;text-align:center;font:16px var(--f-hand,cursive);color:var(--muted,#7B6C80)}`;

  function showLoginStyles() {
    if (document.getElementById('mg-login-style')) return;
    const st = document.createElement('style'); st.id = 'mg-login-style'; st.textContent = css; document.head.appendChild(st);
  }
  function showLogin() {
    if (document.getElementById('mg-login')) return;
    showLoginStyles();
    const el = document.createElement('div');
    el.id = 'mg-login';
    el.innerHTML = `
      <form autocomplete="on">
        <h1>Margin<i>á</i>lia</h1>
        <p>Sua estante, seus grifos, seus post-its.</p>
        <label for="mg-email">E-mail</label>
        <input id="mg-email" type="email" autocomplete="username" required>
        <label for="mg-pass">Senha</label>
        <input id="mg-pass" type="password" autocomplete="current-password" required>
        <button type="submit">Entrar</button>
        <div class="err" role="alert"></div>
        <span class="hand">boa leitura ♡</span>
      </form>`;
    document.body.appendChild(el);
    const form = el.querySelector('form'), btn = el.querySelector('button'), err = el.querySelector('.err');
    form.onsubmit = async e => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      const { error } = await sb.auth.signInWithPassword({
        email: el.querySelector('#mg-email').value.trim(),
        password: el.querySelector('#mg-pass').value
      });
      btn.disabled = false;
      if (error) err.textContent = /invalid/i.test(error.message) ? 'E-mail ou senha não conferem.' : 'Não consegui entrar agora. Confira a internet e tente de novo.';
    };
    setTimeout(() => el.querySelector('#mg-email').focus(), 50);
  }

  // Nome da leitora (a Maggie chama você por ele e ele aparece no diário). Perguntado uma vez só.
  window.marginaliaUserName = () => (session && session.user.user_metadata && session.user.user_metadata.name) || '';
  function askName() {
    return new Promise(res => {
      if (window.marginaliaUserName()) return res();
      const el = document.createElement('div');
      el.id = 'mg-login';
      el.innerHTML = `
        <form>
          <h1>Oi<i>!</i></h1>
          <p>Como a Maggie deve chamar você?</p>
          <label for="mg-name">Seu nome</label>
          <input id="mg-name" autocomplete="given-name" maxlength="40" required>
          <button type="submit">Continuar</button>
          <div class="err" role="alert"></div>
        </form>`;
      document.body.appendChild(el);
      const form = el.querySelector('form'), btn = el.querySelector('button'), err = el.querySelector('.err');
      form.onsubmit = async e => {
        e.preventDefault();
        const name = el.querySelector('#mg-name').value.trim().slice(0, 40);
        if (!name) return;
        btn.disabled = true;
        const { data, error } = await sb.auth.updateUser({ data: { name } });
        btn.disabled = false;
        if (error) { err.textContent = 'Não consegui salvar agora. Tente de novo.'; return; }
        if (data && data.user) session = { ...session, user: data.user };
        el.remove(); res();
      };
      setTimeout(() => el.querySelector('#mg-name').focus(), 50);
    });
  }

  function addLogoutButton() {
    const ref = document.getElementById('b-backup');
    if (!ref || document.getElementById('mg-logout')) return;
    const b = document.createElement('button');
    b.className = 'btn ghost'; b.id = 'mg-logout'; b.textContent = 'Sair';
    b.title = session.user.email;
    b.onclick = async () => {
      const c = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (c) c.postMessage({ type: 'logout' });
      await sb.auth.signOut();
      location.reload();
    };
    ref.parentNode.insertBefore(b, ref);
  }

  /* ===================== banco: imitação do db do artefato ===================== */
  const T = 'docs';
  const clone = v => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const parentOf = p => p.replace(/\/[^/]+$/, '');
  const newId = () => {
    const a = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(a, x => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[x % 62]).join('').slice(0, 20);
  };
  const clean = p => String(p).replace(/^\/+|\/+$/g, '');

  // Ouvintes ativos: coleções e documentos
  const collL = new Map(); // coll -> { docs: Map(path -> data), cbs: Set }
  const docL = new Map();  // path -> { data, known, cbs: Set }

  class DocSnap {
    constructor(path, data) { this.id = path.split('/').pop(); this.ref = docRef(path); this.exists = data != null; this._d = data; }
    data() { return this._d == null ? undefined : clone(this._d); }
    get(f) { return this._d == null ? undefined : clone(this._d[f]); }
  }
  function collSnap(entry, changes) {
    const docs = [...entry.docs].map(([p, d]) => new DocSnap(p, d));
    return {
      docs, size: docs.length, empty: !docs.length,
      metadata: { fromCache: false, hasPendingWrites: false },
      docChanges: () => changes,
      forEach: f => docs.forEach(f)
    };
  }
  function fire(cbs, snap) { cbs.forEach(cb => { try { cb(snap); } catch (e) { console.error(e); } }); }

  // Aplica uma mudança (local ou vinda do tempo real) e avisa quem estiver ouvindo.
  function apply(path, data) {
    const coll = parentOf(path);
    const ce = collL.get(coll);
    if (ce) {
      const had = ce.docs.has(path), old = ce.docs.get(path);
      if (data == null ? had : !same(old, data)) {
        if (data == null) ce.docs.delete(path); else ce.docs.set(path, clone(data));
        const type = data == null ? 'removed' : had ? 'modified' : 'added';
        fire(ce.cbs, collSnap(ce, [{ type, doc: new DocSnap(path, data == null ? old : data) }]));
      }
    }
    const de = docL.get(path);
    if (de && (!de.known || !same(de.data, data))) {
      de.data = clone(data); de.known = true;
      fire(de.cbs, new DocSnap(path, data));
    }
  }

  async function fetchColl(coll) {
    const { data, error } = await sb.from(T).select('path,data').eq('parent', coll);
    if (error) throw error;
    return data;
  }
  async function refreshColl(coll) {
    const ce = collL.get(coll); if (!ce) return;
    const rows = await fetchColl(coll);
    const next = new Map(rows.map(r => [r.path, r.data]));
    const changes = [];
    for (const [p, d] of next) {
      if (!ce.docs.has(p)) changes.push({ type: 'added', doc: new DocSnap(p, d) });
      else if (!same(ce.docs.get(p), d)) changes.push({ type: 'modified', doc: new DocSnap(p, d) });
    }
    for (const [p, d] of ce.docs) if (!next.has(p)) changes.push({ type: 'removed', doc: new DocSnap(p, d) });
    ce.docs = next;
    if (changes.length || !ce.loaded) { ce.loaded = true; fire(ce.cbs, collSnap(ce, changes)); }
  }
  async function refreshDoc(path) {
    const de = docL.get(path); if (!de) return;
    const { data, error } = await sb.from(T).select('data').eq('path', path).maybeSingle();
    if (error) throw error;
    const d = data ? data.data : null;
    if (!de.known || !same(de.data, d)) { de.data = d; de.known = true; fire(de.cbs, new DocSnap(path, d)); }
  }
  function refreshAll() {
    collL.forEach((_, c) => refreshColl(c).catch(() => {}));
    docL.forEach((_, p) => refreshDoc(p).catch(() => {}));
  }

  function docRef(path) {
    path = clean(path);
    const ref = {
      id: path.split('/').pop(),
      path,
      parent: null,
      async get() {
        const { data, error } = await sb.from(T).select('data').eq('path', path).maybeSingle();
        if (error) throw error;
        return new DocSnap(path, data ? data.data : null);
      },
      async set(obj) {
        const d = clone(obj || {});
        const { error } = await sb.from(T).upsert({ owner: uid(), path, data: d }, { onConflict: 'owner,path' });
        if (error) throw error;
        apply(path, d);
      },
      async update(patch) {
        const { data, error } = await sb.rpc('doc_update', { p_path: path, p_patch: clone(patch || {}) });
        if (error) { const e = new Error(error.message); e.code = /not-found/.test(error.message) ? 'not-found' : error.code; throw e; }
        apply(path, data);
      },
      async delete() {
        const { error } = await sb.from(T).delete().eq('path', path);
        if (error) throw error;
        apply(path, null);
      },
      collection(sub) { return collRef(path + '/' + clean(sub)); },
      onSnapshot(cb, onErr) {
        let de = docL.get(path);
        if (!de) docL.set(path, (de = { data: null, known: false, cbs: new Set() }));
        de.cbs.add(cb);
        if (de.known) setTimeout(() => cb(new DocSnap(path, de.data)));
        else refreshDoc(path).catch(e => onErr && onErr(e));
        return () => { de.cbs.delete(cb); if (!de.cbs.size) docL.delete(path); };
      }
    };
    return ref;
  }

  function collRef(coll) {
    coll = clean(coll);
    return {
      id: coll.split('/').pop(),
      path: coll,
      doc(id) { return docRef(coll + '/' + (id ? clean(id) : newId())); },
      async add(obj) { const r = docRef(coll + '/' + newId()); await r.set(obj); return r; },
      async get() {
        const rows = await fetchColl(coll);
        const entry = { docs: new Map(rows.map(r => [r.path, r.data])) };
        return collSnap(entry, []);
      },
      onSnapshot(cb, onErr) {
        let ce = collL.get(coll);
        if (!ce) collL.set(coll, (ce = { docs: new Map(), cbs: new Set(), loaded: false }));
        ce.cbs.add(cb);
        if (ce.loaded) setTimeout(() => cb(collSnap(ce, [...ce.docs].map(([p, d]) => ({ type: 'added', doc: new DocSnap(p, d) })))));
        else refreshColl(coll).catch(e => onErr && onErr(e));
        return () => { ce.cbs.delete(cb); if (!ce.cbs.size) collL.delete(coll); };
      }
    };
  }

  const db = { doc: docRef, collection: collRef };

  // Tempo real: um canal só, com todas as mudanças da usuária (de qualquer aparelho).
  function startRealtime() {
    sb.realtime.setAuth(session.access_token);
    const ch = sb.channel('docs-' + uid())
      .on('postgres_changes', { event: '*', schema: 'public', table: T, filter: 'owner=eq.' + uid() }, p => {
        if (p.eventType === 'DELETE') { if (p.old && p.old.path) apply(p.old.path, null); }
        else if (p.new && p.new.path) apply(p.new.path, p.new.data);
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') refreshAll(); });
    // Ao voltar para a aba (celular que dormiu, por exemplo), confere se perdeu algo.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });
    window.addEventListener('online', refreshAll);
    return ch;
  }

  /* ===================== arquivos ===================== */
  const assets = {
    async upload(blob, opts = {}) {
      const id = newId();
      const type = opts.type || blob.type || 'application/octet-stream';
      const { error } = await sb.storage.from(CFG.bucket).upload(`${uid()}/${id}`, blob, { contentType: type, cacheControl: '31536000', upsert: false });
      if (error) {
        const e = new Error(error.message);
        e.code = /exceed|too large|size/i.test(error.message) ? 'too_large' : 'upload_failed';
        throw e;
      }
      // guarda já no aparelho, para abrir sem baixar de novo
      try {
        const c = await caches.open('marginalia-blobs-v1');
        await c.put(new URL('_blob/' + id, location.href).href, new Response(blob, { headers: { 'Content-Type': type } }));
      } catch {}
      return { id, url: '_blob/' + id };
    },
    async delete(id) {
      await sb.storage.from(CFG.bucket).remove([`${uid()}/${id}`]);
      try { const c = await caches.open('marginalia-blobs-v1'); await c.delete(new URL('_blob/' + id, location.href).href); } catch {}
    },
    url: id => '_blob/' + id
  };

  /* ===================== downloads ===================== */
  const downloads = {
    async save({ filename, data, type }) {
      const b = data instanceof Blob ? data : new Blob([data], { type: type || (/\.json$/i.test(filename) ? 'application/json' : 'text/markdown;charset=utf-8') });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = filename || 'arquivo';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
  };

  /* ===================== IA (via intermediário no Supabase) ===================== */
  const sample = {
    async json(prompt, opts = {}) {
      const { data } = await sb.auth.getSession();
      const tok = (data.session || session).access_token;
      const tier = ['deep', 'default'].includes(opts.modelTier) ? opts.modelTier : 'quick';
      // Tempo limite: um pedido que se perdeu no caminho não pode travar a leitura
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), tier === 'deep' ? 150000 : 70000);
      if (opts.signal) { if (opts.signal.aborted) ctl.abort(); else opts.signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
      let r, j;
      try {
        r = await fetch(`${CFG.url}/functions/v1/ai`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + tok, apikey: CFG.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: String(prompt), tier }),
          signal: ctl.signal
        });
        j = await r.json().catch(() => ({}));
      } catch (e) {
        clearTimeout(timer);
        if (opts.signal && opts.signal.aborted) throw e;
        const err = new Error(e && e.name === 'AbortError' ? 'a IA demorou demais' : 'sem conexão');
        err.code = e && e.name === 'AbortError' ? 'timeout' : 'network'; throw err;
      }
      clearTimeout(timer);
      if (!r.ok || !j.ok) {
        const err = new Error(j.error || 'erro da IA');
        // 'not_granted' faria o site desligar a Maggie de vez; sessão vencida não é motivo para isso
        err.code = j.code === 'not_granted' ? 'auth' : (j.code || 'ai_error');
        console.warn('[marginalia] IA:', err.code, err.message);
        throw err;
      }
      if (window.MARGINALIA_DEBUG) console.log('[marginalia] IA respondeu com', j.model);
      return j.data;
    }
  };

  /* ===================== window.claude.use ===================== */
  window.claude = {
    async use(name) {
      await ready;
      switch (name) {
        case 'db': return db;
        case 'assets': return assets;
        case 'downloads': return downloads;
        case 'sample': return sample;
        case 'permissions': return null;  // sem permissões a pedir fora do Claude
        default: return null;
      }
    }
  };

  /* ===================== início ===================== */
  async function start(s) {
    session = s;
    document.getElementById('mg-login')?.remove();
    await setupSW();
    if (!document.getElementById('mg-login-style')) showLoginStyles();
    await askName();
    startRealtime();
    addLogoutButton();
    resolveReady();
  }

  sb.auth.onAuthStateChange((event, s) => {
    if (event === 'TOKEN_REFRESHED' && s) { session = s; postAuth(); sb.realtime.setAuth(s.access_token); }
    if (event === 'SIGNED_IN' && s && !session) start(s);
    if (event === 'SIGNED_OUT' && session) location.reload();
  });

  sb.auth.getSession().then(({ data }) => {
    if (data.session) { if (!session) start(data.session); }
    else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showLogin);
    else showLogin();
  });
})();
