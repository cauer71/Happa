// Happa — Cloudflare Worker: JSON-API unter /api/, alles andere sind statische Dateien.
//
// Sparsam mit der Datenbank (D1):
// - Lebensmitteldaten liegen als statische Datei im Repository (BLS 4.0), nicht in D1.
// - Pro Benutzer und Tag gibt es genau eine Zeile; die Einträge stehen darin
//   als kompaktes JSON-Array. Ein Tag lesen = 1 Zeile, eine Woche = 7 Zeilen.
// - Fotos werden nie gespeichert: Sie gehen einmal an die KI und sind dann weg.
//   Das kleine Vorschaubild bleibt nur im Browser (IndexedDB) des Geräts.

import { authenticate } from "./auth.js";
import { recognizeFood } from "./ai.js";
import { searchProducts, productByBarcode } from "./off.js";
import { OAuthAuthorizationServer, OAuthResourceServer } from "@cloudflare/workers-oauth-provider";
import { mcpApi, connect, MCP_HOST, MCP_RESOURCE, MCP_SCOPE, CONNECT_URL } from "./mcp.js";

const MAX_PROFILE_BYTES = 16000;
const MAX_BODY_BYTES = 64_000;
const MAX_IMAGE_BYTES = 3_000_000;
const MAX_BATCH = 10;

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(+v) ? +v : 0));
const r1 = (v) => Math.round(v * 10) / 10;

// JSON-Körper mit Größenbegrenzung lesen; nur Objekte und Arrays sind erlaubt.
async function body(request, limit = MAX_BODY_BYTES) {
  const length = Number(request.headers.get("content-length"));
  if (!length) throw new HttpError(411, "Leere Anfrage");
  if (length > limit) throw new HttpError(413, "Die Anfrage ist zu groß");
  let data;
  try { data = await request.json(); } catch { throw new HttpError(400, "Ungültiges JSON"); }
  if (data === null || typeof data !== "object") throw new HttpError(400, "Ungültige Daten");
  return data;
}

// Datum als Zahl JJJJMMTT; der Browser schickt immer sein lokales Datum.
function dayParam(value) {
  const d = Number(value);
  if (!Number.isInteger(d) || d < 20000101 || d > 21001231) throw new HttpError(400, "Ungültiges Datum");
  return d;
}

const toDay = (t) => {
  const x = new Date(t);
  return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
};
const prevDay = (d) => toDay(Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) - 86400000);

// Eintrag: [id, Mahlzeit 0–3, Name, Gramm, kcal, Eiweiß, Kohlenhydrate, Fett, Quelle, Emoji]
// Quelle: k = KI-Foto, b = BLS, o = Open Food Facts, m = manuell
function cleanEntry(e) {
  if (!Array.isArray(e)) throw new HttpError(400, "Eintrag muss ein Array sein");
  const [id, meal, name, grams, kcal, protein, carbs, fat, src, emoji] = e;
  if (typeof id !== "string" || !/^[a-z0-9]{4,16}$/.test(id)) throw new HttpError(400, "Ungültige Eintrags-ID");
  return [
    id,
    Math.round(clamp(meal, 0, 3)),
    String(name || "").trim().slice(0, 80) || "Eintrag",
    r1(clamp(grams, 0, 5000)),
    Math.round(clamp(kcal, 0, 10000)),
    r1(clamp(protein, 0, 1000)),
    r1(clamp(carbs, 0, 1000)),
    r1(clamp(fat, 0, 1000)),
    /^[kbom]$/.test(src) ? src : "m",
    String(emoji || "").slice(0, 8),
  ];
}

const dayOut = (row, d) => row
  ? { d: row.d, log: JSON.parse(row.log || "[]"), water: row.water || 0, weight: row.weight ?? null, ai: row.ai || 0 }
  : { d, log: [], water: 0, weight: null, ai: 0 };

// Benutzer bei jeder Anfrage über den Index auf users.email auflösen (1 Zeile).
// Bewusst ohne Zwischenspeicher: Nach "Konto löschen" darf keine alte ID weiterleben.
async function userRow(env, email, withProfile = false) {
  const cols = withProfile ? "id, profile" : "id";
  let row = await env.DB.prepare(`SELECT ${cols} FROM users WHERE email = ?`).bind(email).first();
  if (!row) {
    row = await env.DB.prepare(
      `INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO UPDATE SET email = excluded.email RETURNING ${cols}`
    ).bind(email).first();
  }
  return row;
}
const userId = async (env, email) => (await userRow(env, email)).id;

function streaks(days, today) {
  // days: Tage mit Einträgen, absteigend sortiert
  let current = 0;
  let expected = days[0] === today ? today : prevDay(today);
  for (const d of days) {
    if (d !== expected) break;
    current++;
    expected = prevDay(d);
  }
  let best = 0, run = 0, prev = null;
  for (const d of days) {
    run = prev !== null && d === prevDay(prev) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return { current, best };
}

async function lastWeight(env, uid) {
  const row = await env.DB.prepare(
    "SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL ORDER BY d DESC LIMIT 1"
  ).bind(uid).first();
  return row ? { d: row.d, w: row.weight } : null;
}

async function handleMe(env, email, url) {
  const today = dayParam(url.searchParams.get("d"));
  const user = await userRow(env, email, true);
  const [dayRes, loggedRes, weightRes, countRes] = await env.DB.batch([
    env.DB.prepare("SELECT d, log, water, weight, ai FROM days WHERE uid = ? AND d = ?").bind(user.id, today),
    env.DB.prepare("SELECT d FROM days WHERE uid = ? AND d <= ? AND log != '[]' ORDER BY d DESC LIMIT 400").bind(user.id, today),
    env.DB.prepare("SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL ORDER BY d DESC LIMIT 1").bind(user.id),
    // Anzahl aller Einträge (für das Abzeichen „100 Einträge“)
    env.DB.prepare("SELECT COALESCE(SUM(json_array_length(log)), 0) AS n FROM days WHERE uid = ?").bind(user.id),
  ]);
  const logged = loggedRes.results.map((r) => r.d);
  const lw = weightRes.results[0];
  return json({
    email,
    profile: JSON.parse(user.profile || "{}"),
    day: dayOut(dayRes.results[0], today),
    streak: streaks(logged, today),
    logged: logged.slice(0, 60),
    lastWeight: lw ? { d: lw.d, w: lw.weight } : null,
    entries: countRes.results[0]?.n || 0,
    aiLimit: Number(env.AI_DAILY_LIMIT) || 40,
  });
}

// Profil: nur die geänderten Felder werden per json_patch eingespielt, damit ein
// zweites Gerät mit älterem Stand nicht alles überschreibt (null löscht ein Feld).
async function handleProfile(request, env, email) {
  const patch = await body(request);
  if (Array.isArray(patch)) throw new HttpError(400, "Profil muss ein Objekt sein");
  const uid = await userId(env, email);
  const row = await env.DB.prepare(
    `UPDATE users SET profile = json_patch(profile, ?1)
     WHERE id = ?2 AND length(json_patch(profile, ?1)) <= ?3
     RETURNING profile`
  ).bind(JSON.stringify(patch), uid, MAX_PROFILE_BYTES).first();
  if (!row) throw new HttpError(413, "Profil ist zu groß");
  return json({ profile: JSON.parse(row.profile) });
}

// Mehrere Einträge in einem Schritt: eine Anfrage, ein Schreibzugriff, alles oder nichts.
// IDs, die schon im Tag stehen, werden übersprungen (sichere Wiederholung nach Netzabbruch).
async function handleAddEntries(request, env, email, d) {
  const data = await body(request);
  const list = Array.isArray(data[0]) ? data : [data];
  if (!list.length || list.length > MAX_BATCH) throw new HttpError(400, "1 bis 10 Einträge erlaubt");
  const entries = list.map(cleanEntry);
  const uid = await userId(env, email);

  const existing = await env.DB.prepare("SELECT log FROM days WHERE uid = ? AND d = ?").bind(uid, d).first();
  const have = new Set(existing ? JSON.parse(existing.log).map((e) => e[0]) : []);
  const fresh = entries.filter((e) => !have.has(e[0]));
  if (!fresh.length) {
    const row = await env.DB.prepare("SELECT d, log, water, weight, ai FROM days WHERE uid = ? AND d = ?").bind(uid, d).first();
    return json({ day: dayOut(row, d) });
  }

  const params = fresh.map((e) => JSON.stringify(e));
  const refs = params.map((_, i) => `json(?${i + 3})`);
  const row = await env.DB.prepare(
    `INSERT INTO days (uid, d, log) VALUES (?1, ?2, json_array(${refs.join(", ")}))
     ON CONFLICT(uid, d) DO UPDATE SET log = json_insert(days.log, ${refs.map((r) => `'$[#]', ${r}`).join(", ")})
     RETURNING d, log, water, weight, ai`
  ).bind(uid, d, ...params).first();
  return json({ day: dayOut(row, d) }, 201);
}

// Tageslimit für die KI. Gezählt wird nach dem UTC-Datum des Servers (dann setzt
// auch Cloudflare das Gratis-Kontingent zurück) – der Browser kann es nicht verschieben.
// Ist das Limit erreicht, wird nichts mehr geschrieben.
async function takeAiCredit(env, uid, limit) {
  const aiDay = toDay(Date.now());
  const row = await env.DB.prepare(
    `INSERT INTO days (uid, d, ai) VALUES (?1, ?2, 1)
     ON CONFLICT(uid, d) DO UPDATE SET ai = days.ai + 1 WHERE days.ai < ?3
     RETURNING ai`
  ).bind(uid, aiDay, limit).first();
  return row ? { aiDay, used: row.ai } : null;
}

async function handleRecognize(request, env, email) {
  const data = await body(request, MAX_IMAGE_BYTES);
  const image = typeof data.image === "string" ? data.image : "";
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new HttpError(400, "Kein Foto übergeben");
  if (image.length > MAX_IMAGE_BYTES) throw new HttpError(413, "Das Foto ist zu groß");
  const limit = Number(env.AI_DAILY_LIMIT) || 40;

  const uid = await userId(env, email);
  const credit = await takeAiCredit(env, uid, limit);
  if (!credit) {
    return json({ error: `Du hast heute schon ${limit} Fotos erkennen lassen. Morgen geht es weiter – suchen und eintragen klappt natürlich trotzdem.`, limit: true }, 429);
  }

  try {
    const result = await recognizeFood(env, image, data.hint);
    return json({ ...result, left: Math.max(0, limit - credit.used) });
  } catch (err) {
    // Nur zurückbuchen, wenn gar kein Modell geantwortet hat (dann wurde nichts verbraucht)
    await env.DB.prepare("UPDATE days SET ai = MAX(ai - 1, 0) WHERE uid = ? AND d = ?").bind(uid, credit.aiDay).run();
    if (err.quota) {
      return json({ error: "Das kostenlose KI-Kontingent ist für heute aufgebraucht. Ab morgen früh geht es wieder – bis dahin bitte suchen oder den Barcode scannen.", quota: true }, 503);
    }
    return json({ error: "Die Erkennung hat nicht geklappt. Bitte noch einmal versuchen." }, 502);
  }
}

async function handleApi(request, env, ctx, url, email) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, "");
  let m;

  if (path === "/api/me" && method === "GET") return handleMe(env, email, url);

  if (path === "/api/me" && method === "DELETE") {
    const uid = await userId(env, email);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM days WHERE uid = ?").bind(uid),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid),
    ]);
    return json({ ok: true });
  }

  if (path === "/api/profile" && method === "PUT") return handleProfile(request, env, email);

  if (path === "/api/export" && method === "GET") {
    const user = await userRow(env, email, true);
    const { results } = await env.DB.prepare(
      "SELECT d, log, water, weight FROM days WHERE uid = ? ORDER BY d"
    ).bind(user.id).all();
    return json({
      app: "Happa", exported: new Date().toISOString(), email,
      profile: JSON.parse(user.profile || "{}"),
      entryFormat: ["id", "meal", "name", "grams", "kcal", "protein", "carbs", "fat", "source", "emoji"],
      days: results.map((r) => dayOut(r, r.d)).filter((x) => x.log.length || x.water || x.weight != null)
        .map(({ ai, ...rest }) => rest),
    }, 200, { "content-disposition": `attachment; filename="happa-export.json"` });
  }

  if (path === "/api/days" && method === "GET") {
    const from = dayParam(url.searchParams.get("from"));
    const to = dayParam(url.searchParams.get("to"));
    if (to < from) throw new HttpError(400, "Zeitraum ungültig");
    const uid = await userId(env, email);
    const { results } = await env.DB.prepare(
      "SELECT d, log, water, weight, ai FROM days WHERE uid = ? AND d BETWEEN ? AND ? ORDER BY d LIMIT 400"
    ).bind(uid, from, to).all();
    return json({ days: results.map((r) => dayOut(r, r.d)) });
  }

  if (path === "/api/weights" && method === "GET") {
    const uid = await userId(env, email);
    const from = url.searchParams.get("from") ? dayParam(url.searchParams.get("from")) : 0;
    const { results } = await env.DB.prepare(
      "SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL AND d >= ? ORDER BY d"
    ).bind(uid, from).all();
    return json({ weights: results.map((r) => [r.d, r.weight]) });
  }

  if ((m = path.match(/^\/api\/days\/(\d{8})$/)) && method === "PUT") {
    const d = dayParam(m[1]);
    const data = await body(request);
    const water = data.water === undefined ? null : Math.round(clamp(data.water, 0, 20000));
    const hasWeight = data.weight !== undefined;
    const weight = data.weight === null || !hasWeight ? null : r1(clamp(data.weight, 20, 400));
    const uid = await userId(env, email);
    const row = await env.DB.prepare(
      `INSERT INTO days (uid, d, water, weight) VALUES (?1, ?2, COALESCE(?3, 0), ?4)
       ON CONFLICT(uid, d) DO UPDATE SET
         water = COALESCE(?3, days.water),
         weight = CASE WHEN ?5 THEN ?4 ELSE days.weight END
       RETURNING d, log, water, weight, ai`
    ).bind(uid, d, water, weight, hasWeight ? 1 : 0).first();
    // Nach dem Entfernen einer Wiegung gleich die neue letzte mitliefern
    const extra = hasWeight && weight === null ? { lastWeight: await lastWeight(env, uid) } : {};
    return json({ day: dayOut(row, d), ...extra });
  }

  if ((m = path.match(/^\/api\/days\/(\d{8})\/entries$/)) && method === "POST") {
    return handleAddEntries(request, env, email, dayParam(m[1]));
  }

  if ((m = path.match(/^\/api\/days\/(\d{8})\/entries\/([a-z0-9]{4,16})$/))) {
    const d = dayParam(m[1]);
    const id = m[2];

    if (method === "PUT") {
      const raw = await body(request);
      if (Array.isArray(raw)) raw[0] = id;
      const entry = cleanEntry(raw);
      const uid = await userId(env, email);
      const row = await env.DB.prepare(
        `UPDATE days SET log = json_set(log,
            (SELECT '$[' || key || ']' FROM json_each(days.log) WHERE json_extract(value, '$[0]') = ?3),
            json(?4))
         WHERE uid = ?1 AND d = ?2
           AND EXISTS (SELECT 1 FROM json_each(days.log) WHERE json_extract(value, '$[0]') = ?3)
         RETURNING d, log, water, weight, ai`
      ).bind(uid, d, id, JSON.stringify(entry)).first();
      if (!row) throw new HttpError(404, "Eintrag nicht gefunden");
      return json({ day: dayOut(row, d) });
    }

    if (method === "DELETE") {
      const uid = await userId(env, email);
      const row = await env.DB.prepare(
        `UPDATE days SET log = (SELECT COALESCE(json_group_array(json(value)), '[]')
            FROM json_each(days.log) WHERE json_extract(value, '$[0]') != ?3)
         WHERE uid = ?1 AND d = ?2
         RETURNING d, log, water, weight, ai`
      ).bind(uid, d, id).first();
      return json({ day: dayOut(row, d) });
    }
  }

  if (path === "/api/recognize" && method === "POST") return handleRecognize(request, env, email);

  if (path === "/api/food/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return json({ products: [] });
    return json({ products: await searchProducts(q) });
  }

  if ((m = path.match(/^\/api\/food\/barcode\/(\d{6,14})$/)) && method === "GET") {
    const product = await productByBarcode(m[1]);
    return product ? json({ product }) : json({ error: "Produkt nicht gefunden" }, 404);
  }

  throw new HttpError(404, "Unbekannter Endpunkt");
}

// Schutz gegen fremde Seiten, die im Namen angemeldeter Personen schreiben wollen (CSRF):
// Schreibende Anfragen müssen von der eigenen Seite kommen und JSON senden.
function csrfCheck(request, url) {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return "Anfrage von fremder Seite abgelehnt";
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return "Anfrage von fremder Seite abgelehnt";
  if ((request.method === "POST" || request.method === "PUT")
    && !(request.headers.get("content-type") || "").startsWith("application/json")) {
    return "Nur JSON erlaubt";
  }
  return null;
}

const app = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const blocked = csrfCheck(request, url);
    if (blocked) return json({ error: blocked }, 403);

    let user;
    try {
      user = await authenticate(request, env);
    } catch {
      return json({ error: "Die Anmeldung kann gerade nicht geprüft werden. Bitte gleich noch einmal versuchen." }, 503);
    }
    if (!user) return json({ error: "Nicht angemeldet", login: true }, 401);

    try {
      return await handleApi(request, env, ctx, url, user.email);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      if (err.upstream) return json({ error: err.message }, 502);
      console.error(err);
      return json({ error: "Serverfehler" }, 500);
    }
  },
};

// TEST Claude-Connector (siehe worker/mcp.js). Zum Entfernen alles ab hier durch `export default app;` ersetzen.
const authServer = new OAuthAuthorizationServer({
  issuer: `https://${MCP_HOST}`,
  resources: [MCP_RESOURCE],
  authorizeEndpoint: CONNECT_URL,
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  clientIdMetadataDocumentEnabled: true,
  scopesSupported: [MCP_SCOPE],
  accessTokenTTL: 3600,
  // Verbindung bleibt, solange sie benutzt wird; nach 60 Tagen ohne Nutzung neu verbinden
  refreshTokenTTL: 365 * 86400,
  refreshTokenIdleTTL: 60 * 86400,
});

const resourceServer = new OAuthResourceServer({
  resourceMetadata: {
    resource: MCP_RESOURCE,
    authorization_servers: [`https://${MCP_HOST}`],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Happa",
  },
  validateToken: (env) => (resource, token) => authServer.validateToken(resource, token, env),
  handler: mcpApi,
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.hostname === MCP_HOST) {
      const p = url.pathname;
      if (p === "/mcp" || p.startsWith("/mcp/") || p.startsWith("/.well-known/oauth-protected-resource")) {
        return resourceServer.fetch(request, env, ctx);
      }
      if (p === "/token" || p === "/register" || p.startsWith("/.well-known/")) return authServer.fetch(request, env, ctx);
      return new Response("Happa-Connector für Claude: " + MCP_RESOURCE, { status: p === "/" ? 200 : 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/connect") return connect(request, env, authServer.getOAuthApi(env));
    return app.fetch(request, env, ctx);
  },
};
