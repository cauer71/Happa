// Testserver: nimmt OCR-Ergebnisse entgegen und legt sie in einer SQLite-Datenbank ab.
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PUBLIC_DIR = join(ROOT, 'public');
const DATA_DIR = join(ROOT, 'data');
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_BYTES = 1 * 1024 * 1024; // es wird nur Text übertragen

mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(join(DATA_DIR, 'ocr.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    text TEXT NOT NULL,
    language TEXT,
    confidence REAL,
    engine TEXT
  );
`);

const insertScan = db.prepare(
  `INSERT INTO scans (created_at, text, language, confidence, engine)
   VALUES (?, ?, ?, ?, ?)`
);
const listScans = db.prepare(
  `SELECT id, created_at, text, language, confidence, engine
   FROM scans ORDER BY id DESC LIMIT ?`
);
const getScan = db.prepare(`SELECT * FROM scans WHERE id = ?`);
const deleteScan = db.prepare(`DELETE FROM scans WHERE id = ?`);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Anfrage zu groß'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const rel = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const file = join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    return sendJson(res, 403, { error: 'Zugriff verweigert' });
  }
  try {
    const content = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(content);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Nicht gefunden');
  }
}

async function handleApi(req, res, url) {
  const idMatch = url.pathname.match(/^\/api\/scans\/(\d+)$/);

  if (url.pathname === '/api/ocr' && req.method === 'POST') {
    return sendJson(res, 501, {
      error: 'Die serverseitige Erkennung läuft über Workers AI und steht nur in der '
        + 'Cloudflare-Variante zur Verfügung. Lokal bitte auf „Im Browser“ umschalten.',
    });
  }

  if (url.pathname === '/api/scans' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
    return sendJson(res, 200, { scans: listScans.all(limit) });
  }

  if (url.pathname === '/api/scans' && req.method === 'POST') {
    const payload = JSON.parse((await readBody(req)) || '{}');
    const text = typeof payload.text === 'string' ? payload.text.trim() : '';
    if (!text) return sendJson(res, 400, { error: 'Kein Text übergeben' });

    const confidence = Number.isFinite(payload.confidence) ? payload.confidence : null;
    const result = insertScan.run(
      new Date().toISOString(),
      text,
      typeof payload.language === 'string' ? payload.language : null,
      confidence,
      typeof payload.engine === 'string' ? payload.engine : null
    );
    return sendJson(res, 201, { id: Number(result.lastInsertRowid) });
  }

  if (idMatch && req.method === 'GET') {
    const scan = getScan.get(Number(idMatch[1]));
    return scan ? sendJson(res, 200, { scan }) : sendJson(res, 404, { error: 'Nicht gefunden' });
  }

  if (idMatch && req.method === 'DELETE') {
    deleteScan.run(Number(idMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'Unbekannter Endpunkt' });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    await serveStatic(res, url.pathname);
  } catch (err) {
    sendJson(res, err.status ?? 500, { error: err.message ?? 'Serverfehler' });
  }
});

server.listen(PORT, () => {
  console.log(`OCR-Testseite läuft auf http://localhost:${PORT}`);
});
