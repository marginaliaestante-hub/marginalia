// Marginália — intermediário de IA
// Só atende usuárias logadas. Guarda a chave do Gemini escondida e devolve JSON.
// Corpo: { prompt: string, tier: 'quick' | 'default' }  ->  { ok: true, data, model }
// GET ?info=1 -> modelos escolhidos (para diagnóstico)

const ALLOWED_ORIGINS = [
  'https://marginaliaestante-hub.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
];
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON = Deno.env.get('SUPABASE_ANON_KEY') || '';
const PUBLISHABLE = 'sb_publishable_kY8g53_gMXbwq3nIoeNH5g_c9Bp6CEe'; // pública por natureza
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

function geminiKey(): string | null {
  for (const n of ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_API_KEY']) {
    const v = Deno.env.get(n); if (v) return v.trim();
  }
  const env = Deno.env.toObject();
  for (const [k, v] of Object.entries(env)) if (/gemini/i.test(k) && v) return v.trim();
  return null;
}

function cors(req: Request) {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Vary': 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

async function userFrom(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return null;
  for (const apikey of [PUBLISHABLE, SUPABASE_ANON].filter(Boolean)) {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: auth, apikey } });
    if (r.ok) { const u = await r.json(); if (u && u.id) return u; }
    if (r.status === 401 || r.status === 403) { const t = await r.text(); if (/invalid api key|no api key/i.test(t)) continue; return null; }
  }
  return null;
}

// ---------- escolha de modelos (descoberta automática, guardada por algumas horas) ----------
type Chains = { quick: string[]; default: string[]; deep: string[]; at: number };
let chains: Chains | null = null;
const ver = (name: string) => {
  const m = name.match(/(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0;
};
async function getChains(key: string): Promise<Chains> {
  if (chains && Date.now() - chains.at < 6 * 3600e3) return chains;
  let names: string[] = [];
  try {
    const r = await fetch(`${GEMINI}/models?pageSize=1000`, { headers: { 'x-goog-api-key': key } });
    const j = await r.json();
    names = (j.models || [])
      .filter((m: any) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m: any) => String(m.name).replace(/^models\//, ''));
  } catch { /* usa a lista padrão abaixo */ }
  const stable = (n: string) => !/preview|exp|tts|image|audio|live|thinking|native|computer|robotics/i.test(n);
  const pick = (re: RegExp) => names.filter(n => re.test(n) && stable(n)).sort((a, b) => ver(b) - ver(a));
  const flash = pick(/^gemini-\d+(\.\d+)?-flash$/);
  const lite = pick(/^gemini-\d+(\.\d+)?-flash-lite$/);
  const gemma = names.filter(n => /^gemma-\d/.test(n) && /-it$/.test(n))
    .sort((a, b) => ver(b) - ver(a) || (parseInt(b.match(/(\d+)b/)?.[1] || '0') - parseInt(a.match(/(\d+)b/)?.[1] || '0')));
  const fallbackLite = ['gemini-2.5-flash-lite'];
  const L = lite.length ? lite.slice(0, 2) : fallbackLite;
  const F = flash.length ? flash.slice(0, 2) : ['gemini-2.5-flash'];
  const G = gemma.slice(0, 1);
  // O Flash grátis está levando 25 a 50 s por resposta; o Flash-Lite responde em 1 a 2 s com boa qualidade.
  // Por isso os dois níveis começam pelo Flash-Lite e usam o Flash só como reserva.
  // 'deep' (análises feitas em segundo plano, onde a espera não incomoda) usa o Flash primeiro.
  chains = { quick: [...L, ...G, ...F.slice(0, 1)], default: [...L, ...F.slice(0, 1), ...G], deep: [...F, ...L, ...G], at: Date.now() };
  return chains;
}

// Modelos que estouraram a cota recentemente (evita tentar de novo a cada pedido)
const cooldown = new Map<string, number>();

function parseJSON(text: string) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try { return JSON.parse(t); } catch { /* tenta recortar */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error('json_parse');
}

// Modelos que recusaram o ajuste de "raciocínio" ou de filtros (não mandamos de novo)
const noThinkCfg = new Set<string>();
const noSafety = new Set<string>();
// Livros têm violência, palavrão e cenas fortes: os filtros padrão bloqueiam trechos de romance comuns.
const SAFETY_CATS = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'];

async function callModel(key: string, model: string, prompt: string, timeoutMs = 40_000): Promise<{ status: number; error?: string; text?: string }> {
  const isGemma = model.startsWith('gemma');
  const body: any = {
    contents: [{ role: 'user', parts: [{ text: isGemma ? prompt + '\n\nResponda apenas com o JSON, sem texto antes ou depois.' : prompt }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
  };
  if (!isGemma) body.generationConfig.responseMimeType = 'application/json';
  // Raciocínio curto: respostas rápidas para a leitura não ficar esperando
  const thinkCfg = !isGemma && !noThinkCfg.has(model) && ver(model) >= 3;
  if (thinkCfg) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' };
  const safety = !isGemma && !noSafety.has(model);
  if (safety) body.safetySettings = SAFETY_CATS.map(category => ({ category, threshold: 'BLOCK_NONE' }));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let r: Response;
  try {
    r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch {
    clearTimeout(timer);
    cooldown.set(model, Date.now() + 15 * 60e3); // lento demais agora: deixa de lado por 15 min
    return { status: 504, error: 'demorou demais' };
  }
  clearTimeout(timer);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status === 400 && thinkCfg && /think/i.test(j?.error?.message || '')) {
    noThinkCfg.add(model);
    return callModel(key, model, prompt, timeoutMs);
  }
  if (!r.ok && r.status === 400 && safety && /safety|harm|threshold/i.test(j?.error?.message || '')) {
    noSafety.add(model);
    return callModel(key, model, prompt, timeoutMs);
  }
  if (!r.ok) return { status: r.status, error: j?.error?.message || 'erro' };
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => !p.thought).map((p: any) => p.text || '').join('');
  if (!text) {
    const why = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason || '?';
    return { status: /SAFETY|PROHIBITED|BLOCK|OTHER/i.test(why) ? 451 : 502, error: 'resposta vazia (' + why + ')' };
  }
  return { status: 200, text };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });

  const user = await userFrom(req);
  if (!user) return json(req, { ok: false, code: 'not_granted', error: 'faça login' }, 401);

  const key = geminiKey();
  if (!key) return json(req, { ok: false, code: 'sampling_disabled', error: 'chave do Gemini não configurada' }, 500);

  const ch = await getChains(key);
  if (req.method === 'GET') return json(req, { ok: true, chains: ch, cooling: [...cooldown.keys()], noThinkCfg: [...noThinkCfg] });

  let input: any;
  try { input = await req.json(); } catch { return json(req, { ok: false, code: 'bad_request' }, 400); }
  const prompt = String(input?.prompt || '');
  if (!prompt || prompt.length > 200_000) return json(req, { ok: false, code: 'bad_request' }, 400);
  const tier: 'quick' | 'default' | 'deep' = input?.tier === 'deep' ? 'deep' : input?.tier === 'default' ? 'default' : 'quick';

  let lastErr = '', sawLimit = false, blocked = false;
  const tried: string[] = [];
  for (const model of ch[tier]) {
    const until = cooldown.get(model);
    if (until && until > Date.now()) { sawLimit = true; continue; }
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await callModel(key, model, prompt, tier === 'deep' && !/lite|gemma/.test(model) ? 100_000 : 40_000);
      if (res.status === 200) {
        try { return json(req, { ok: true, data: parseJSON(res.text!), model }); }
        catch { lastErr = 'json_parse'; continue; } // tenta de novo uma vez
      }
      lastErr = `${model}: ${res.status} ${res.error}`;
      tried.push(`${model}: ${res.status} ${String(res.error).slice(0, 160)}`);
      console.warn('[ai]', tier, lastErr.slice(0, 300));
      if (res.status === 451) { blocked = true; break; } // trecho bloqueado pelo filtro do Google: tenta outro modelo
      if (res.status === 429) {
        sawLimit = true;
        // limite por minuto: espera pouco; limite diário: deixa o modelo de lado por 1h
        cooldown.set(model, Date.now() + (/per.?day|daily|PerDay/i.test(res.error || '') ? 3600e3 : 60e3));
        break;
      }
      if (res.status === 404 || res.status === 400 || res.status === 403 || res.status === 504) break; // modelo indisponível: próximo
      // 5xx: tenta mais uma vez o mesmo modelo
    }
  }
  console.error('[ai] falhou:', lastErr);
  const code = blocked && !tried.some(t => !/: 451 /.test(t) && !/: 429 /.test(t)) ? 'blocked' : sawLimit ? 'rate_limited' : 'ai_error';
  return json(req, { ok: false, code, error: lastErr, tried }, code === 'rate_limited' ? 429 : 502);
});
