// cloudflare-worker.js - tu servidor privado de JARVIS (Cloudflare Workers, plan gratis).
// Guarda las claves de IA y de Supabase como "Secrets": nunca llegan al código público de la app.
//
// Variables (Settings > Variables and Secrets):
//   APP_TOKEN            contraseña larga que inventás; la ponés también en Ajustes de JARVIS
//   ALLOWED_ORIGIN       tu sitio, por ejemplo https://tuusuario.github.io  (sin barra final)
//   ANTHROPIC_API_KEY    (opcional) clave de Claude
//   GEMINI_API_KEY       (opcional) clave de Gemini
//   ANTHROPIC_MODEL      (opcional) por defecto claude-haiku-5-5
//   GEMINI_MODEL         (opcional) por defecto gemini-2.5-flash
//   SUPABASE_URL         (opcional) https://xxxx.supabase.co
//   SUPABASE_SERVICE_KEY (opcional) clave secreta de Supabase

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'null',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Vary': 'Origin'
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const auth = request.headers.get('Authorization') || '';
    if (!env.APP_TOKEN || !safeEqual(auth, 'Bearer ' + env.APP_TOKEN)) return json({ error: 'No autorizado: revisá el token.' }, 401);

    const url = new URL(request.url);
    try {
      if (url.pathname === '/ping') {
        return json({ ok: true, anthropic: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY, supabase: !!(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) });
      }

      if (url.pathname === '/chat' && request.method === 'POST') {
        const body = await request.json();
        const { provider, system, messages } = body || {};
        if (typeof system !== 'string' || system.length > 30000) return json({ error: 'Pedido inválido.' }, 400);
        if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) return json({ error: 'Pedido inválido.' }, 400);
        for (const m of messages) {
          if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string' || m.content.length > 8000) return json({ error: 'Pedido inválido.' }, 400);
        }

        if (provider === 'anthropic') {
          if (!env.ANTHROPIC_API_KEY) return json({ error: 'Falta ANTHROPIC_API_KEY en el servidor.' }, 400);
          const r = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
            body: JSON.stringify({ model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: 1024, system, messages })
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return json({ error: 'Claude respondió: ' + ((d.error && d.error.message) || r.status) }, 502);
          return json({ text: (d.content || []).filter(b => b.type === 'text').map(b => b.text).join('') });
        }

        if (provider === 'gemini') {
          if (!env.GEMINI_API_KEY) return json({ error: 'Falta GEMINI_API_KEY en el servidor.' }, 400);
          const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
          const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
            method: 'POST',
            headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type': 'application/json' },
            body: JSON.stringify({
              systemInstruction: { parts: [{ text: system }] },
              contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
              generationConfig: { maxOutputTokens: 1024, responseMimeType: 'application/json' }
            })
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) return json({ error: 'Gemini respondió: ' + ((d.error && d.error.message) || r.status) }, 502);
          const parts = (d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || [];
          return json({ text: parts.map(p => p.text || '').join('') });
        }
        return json({ error: 'Proveedor desconocido.' }, 400);
      }

      if (url.pathname === '/state') {
        if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) return json({ error: 'Supabase no está configurado en el servidor.' }, 400);
        const key = env.SUPABASE_SERVICE_KEY;
        const h = { apikey: key, 'Content-Type': 'application/json' };
        if (key.startsWith('eyJ')) h.Authorization = 'Bearer ' + key;
        const base = env.SUPABASE_URL.replace(/\/+$/, '') + '/rest/v1/jarvis_state';

        if (request.method === 'GET') {
          const r = await fetch(`${base}?id=eq.main&select=data,updated_at`, { headers: h });
          if (!r.ok) return json({ error: 'Supabase respondió ' + r.status + '. ¿Corriste el archivo supabase.sql?' }, 502);
          const rows = await r.json();
          return json(rows[0] ? { data: rows[0].data, updated_at: rows[0].updated_at } : { data: null });
        }
        if (request.method === 'PUT') {
          const text = await request.text();
          if (text.length > 2000000) return json({ error: 'Los datos son demasiado grandes.' }, 413);
          const { data } = JSON.parse(text);
          if (!data || typeof data !== 'object') return json({ error: 'Pedido inválido.' }, 400);
          const r = await fetch(base, {
            method: 'POST',
            headers: { ...h, Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify([{ id: 'main', data, updated_at: new Date().toISOString() }])
          });
          if (!r.ok) return json({ error: 'Supabase respondió ' + r.status + '.' }, 502);
          return json({ ok: true });
        }
      }
    } catch (e) {
      return json({ error: 'Error del servidor.' }, 500);
    }
    return json({ error: 'No encontrado.' }, 404);
  }
};
