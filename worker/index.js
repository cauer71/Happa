// Cloudflare-Worker-Variante: gleiche JSON-API wie server.js, Daten liegen in D1.
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

async function handleApi(request, env, url) {
  const idMatch = url.pathname.match(/^\/api\/scans\/(\d+)$/);
  const method = request.method;

  if (url.pathname === '/api/scans' && method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, text, language, confidence
       FROM scans ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();
    return json({ scans: results });
  }

  if (url.pathname === '/api/scans' && method === 'POST') {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: 'Ungültiges JSON' }, 400);
    }

    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return json({ error: 'Kein Text übergeben' }, 400);

    const { meta } = await env.DB.prepare(
      `INSERT INTO scans (created_at, text, language, confidence)
       VALUES (?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      text,
      typeof payload.language === 'string' ? payload.language : null,
      Number.isFinite(payload.confidence) ? payload.confidence : null
    ).run();

    return json({ id: meta.last_row_id }, 201);
  }

  if (idMatch && method === 'GET') {
    const scan = await env.DB.prepare(`SELECT * FROM scans WHERE id = ?`).bind(Number(idMatch[1])).first();
    return scan ? json({ scan }) : json({ error: 'Nicht gefunden' }, 404);
  }

  if (idMatch && method === 'DELETE') {
    await env.DB.prepare(`DELETE FROM scans WHERE id = ?`).bind(Number(idMatch[1])).run();
    return json({ ok: true });
  }

  return json({ error: 'Unbekannter Endpunkt' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: err.message ?? 'Serverfehler' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
