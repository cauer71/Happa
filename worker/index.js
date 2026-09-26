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

const MAX_PROFILE_BYTES = 16000;
const MAX_IMAGE_BYTES = 3_000_000;

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

async function body(request) {
  try { return await request.json(); } catch { throw new HttpError(400, "Ungültiges JSON"); }
}

// Datum als Zahl JJJJMMTT; der Browser schickt immer sein lokales Datum.
function dayParam(value) {
  const d = Number(value);
  if (!Number.isInteger(d) || d < 20000101 || d > 21001231) throw new HttpError(400, "Ungültiges Datum");
  return d;
}

function prevDay(d) {
  const t = Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100) - 86400000;
  const x = new Date(t);
  return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate();
}

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

// E-Mail → Benutzer-ID, pro Worker-Instanz zwischengespeichert (spart Lesezugriffe).
const uidCache = new Map();

async function userRow(env, email) {
  let row = await env.DB.prepare("SELECT id, profile FROM users WHERE email = ?").bind(email).first();
  if (!row) {
    row = await env.DB.prepare(
      "INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO UPDATE SET email = excluded.email RETURNING id, profile"
    ).bind(email).first();
  }
  uidCache.set(email, row.id);
  return row;
}

async function userId(env, email) {
  return uidCache.get(email) ?? (await userRow(env, email)).id;
}

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

async function handleMe(env, email, url) {
  const today = dayParam(url.searchParams.get("d"));
  const user = await userRow(env, email);
  const [dayRes, loggedRes, weightRes] = await env.DB.batch([
    env.DB.prepare("SELECT d, log, water, weight, ai FROM days WHERE uid = ? AND d = ?").bind(user.id, today),
    env.DB.prepare("SELECT d FROM days WHERE uid = ? AND d <= ? AND log != '[]' ORDER BY d DESC LIMIT 400").bind(user.id, today),
    env.DB.prepare("SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL ORDER BY d DESC LIMIT 1").bind(user.id),
  ]);
  const logged = loggedRes.results.map((r) => r.d);
  const lastWeight = weightRes.results[0];
  return json({
    email,
    profile: JSON.parse(user.profile || "{}"),
    day: dayOut(dayRes.results[0], today),
    streak: streaks(logged, today),
    logged: logged.slice(0, 60),
    lastWeight: lastWeight ? { d: lastWeight.d, w: lastWeight.weight } : null,
    aiLimit: Number(env.AI_DAILY_LIMIT) || 40,
  });
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
    uidCache.delete(email);
    return json({ ok: true });
  }

  if (path === "/api/profile" && method === "PUT") {
    const profile = await body(request);
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new HttpError(400, "Profil muss ein Objekt sein");
    const text = JSON.stringify(profile);
    if (text.length > MAX_PROFILE_BYTES) throw new HttpError(413, "Profil ist zu groß");
    const uid = await userId(env, email);
    await env.DB.prepare("UPDATE users SET profile = ? WHERE id = ?").bind(text, uid).run();
    return json({ ok: true });
  }

  if (path === "/api/export" && method === "GET") {
    const user = await userRow(env, email);
    const { results } = await env.DB.prepare(
      "SELECT d, log, water, weight FROM days WHERE uid = ? ORDER BY d"
    ).bind(user.id).all();
    return json({
      app: "Happa", exported: new Date().toISOString(), email,
      profile: JSON.parse(user.profile || "{}"),
      entryFormat: ["id", "meal", "name", "grams", "kcal", "protein", "carbs", "fat", "source", "emoji"],
      days: results.map((r) => dayOut(r, r.d)).map(({ ai, ...rest }) => rest),
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
    const { results } = await env.DB.prepare(
      "SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL ORDER BY d"
    ).bind(uid).all();
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
    return json({ day: dayOut(row, d) });
  }

  if ((m = path.match(/^\/api\/days\/(\d{8})\/entries$/)) && method === "POST") {
    const d = dayParam(m[1]);
    const entry = JSON.stringify(cleanEntry(await body(request)));
    const uid = await userId(env, email);
    const row = await env.DB.prepare(
      `INSERT INTO days (uid, d, log) VALUES (?1, ?2, json_array(json(?3)))
       ON CONFLICT(uid, d) DO UPDATE SET log = json_insert(days.log, '$[#]', json(?3))
       RETURNING d, log, water, weight, ai`
    ).bind(uid, d, entry).first();
    return json({ day: dayOut(row, d) }, 201);
  }

  if ((m = path.match(/^\/api\/days\/(\d{8})\/entries\/([a-z0-9]{4,16})$/))) {
    const d = dayParam(m[1]);
    const id = m[2];
    const uid = await userId(env, email);

    if (method === "PUT") {
      const raw = await body(request);
      if (Array.isArray(raw)) raw[0] = id;
      const entry = cleanEntry(raw);
      const row = await env.DB.prepare(
        `UPDATE days SET log = COALESCE(json_set(log,
            (SELECT '$[' || key || ']' FROM json_each(days.log) WHERE json_extract(value, '$[0]') = ?3),
            json(?4)), log)
         WHERE uid = ?1 AND d = ?2
         RETURNING d, log, water, weight, ai`
      ).bind(uid, d, id, JSON.stringify(entry)).first();
      if (!row) throw new HttpError(404, "Tag nicht gefunden");
      return json({ day: dayOut(row, d) });
    }

    if (method === "DELETE") {
      const row = await env.DB.prepare(
        `UPDATE days SET log = (SELECT COALESCE(json_group_array(json(value)), '[]')
            FROM json_each(days.log) WHERE json_extract(value, '$[0]') != ?3)
         WHERE uid = ?1 AND d = ?2
         RETURNING d, log, water, weight, ai`
      ).bind(uid, d, id).first();
      return json({ day: dayOut(row, d) });
    }
  }

  if (path === "/api/recognize" && method === "POST") {
    if (Number(request.headers.get("content-length") || 0) > MAX_IMAGE_BYTES) {
      throw new HttpError(413, "Das Foto ist zu groß");
    }
    const data = await body(request);
    const image = typeof data.image === "string" ? data.image : "";
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(image)) throw new HttpError(400, "Kein Foto übergeben");
    const d = dayParam(data.d);
    const limit = Number(env.AI_DAILY_LIMIT) || 40;

    // Tageslimit pro Person schützt das kostenlose KI-Kontingent des Kontos.
    const uid = await userId(env, email);
    const counter = await env.DB.prepare(
      `INSERT INTO days (uid, d, ai) VALUES (?1, ?2, 1)
       ON CONFLICT(uid, d) DO UPDATE SET ai = days.ai + 1
       RETURNING ai`
    ).bind(uid, d).first();
    if (counter.ai > limit) {
      return json({ error: `Du hast heute schon ${limit} Fotos erkennen lassen. Morgen geht es weiter – suchen und eintragen klappt natürlich trotzdem.`, limit: true }, 429);
    }

    try {
      const result = await recognizeFood(env, image, data.hint);
      return json({ ...result, left: Math.max(0, limit - counter.ai) });
    } catch (err) {
      await env.DB.prepare("UPDATE days SET ai = MAX(ai - 1, 0) WHERE uid = ? AND d = ?").bind(uid, d).run();
      if (err.quota) {
        return json({ error: "Das kostenlose KI-Kontingent ist für heute aufgebraucht. Ab morgen früh geht es wieder – bis dahin bitte suchen oder den Barcode scannen.", quota: true }, 503);
      }
      return json({ error: "Die Erkennung hat nicht geklappt. Bitte noch einmal versuchen.", details: err.details }, 502);
    }
  }

  if (path === "/api/food/search" && method === "GET") {
    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 2) return json({ products: [] });
    return json({ products: await searchProducts(q, ctx) });
  }

  if ((m = path.match(/^\/api\/food\/barcode\/(\d{6,14})$/)) && method === "GET") {
    const product = await productByBarcode(m[1], ctx);
    return product ? json({ product }) : json({ error: "Produkt nicht gefunden" }, 404);
  }

  throw new HttpError(404, "Unbekannter Endpunkt");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const user = await authenticate(request, env);
    if (!user) return json({ error: "Nicht angemeldet", login: true }, 401);

    try {
      return await handleApi(request, env, ctx, url, user.email);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: "Serverfehler" }, 500);
    }
  },
};
