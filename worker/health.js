// TEST: Import aus der iPhone-App „Health Auto Export“ (Automation „REST API“).
//
// Adresse:  POST https://happa-mcp.auer.page/health/import
// Schlüssel: Header „X-Happa-Key: hk_…“ (oder „Authorization: Bearer hk_…“), in Happa unter
//            Profil → Apple Health (Test) erzeugt. Gespeichert wird nur der SHA-256-Hash.
// Gespeichert pro Tag in days.act (kompaktes JSON):
//   { b: Ruheenergie kcal, a: aktive Energie kcal, s: Schritte, x: Trainingsminuten,
//     w: [[Name, Minuten, kcal, "HH:MM"], …] Workouts, t: Zeitpunkt des Imports }
// Verbrauch mit Sport = b + a; ohne Sport = b + a − Summe der Workout-kcal.
// Werte eines Tages werden beim erneuten Import ersetzt (Tageswerte), Workouts zusammengeführt.

const MAX_BYTES = 1_000_000;
const MAX_DAYS = 400;
const KJ = 4.184;

const METRICS = {
  active_energy: "a", active_energy_burned: "a",
  basal_energy_burned: "b", resting_energy: "b", basal_energy: "b",
  step_count: "s", steps: "s",
  apple_exercise_time: "x", exercise_time: "x",
};

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// "2026-09-27 07:30:00 +0200" → 20260927 (lokales Datum des iPhones)
function dayOf(value) {
  const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[1] + m[2] + m[3]) : null;
}
const timeOf = (value) => (String(value || "").match(/[ T](\d{2}:\d{2})/) || [])[1] || "";

function energy(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  if (Array.isArray(v)) return v.reduce((a, x) => a + (energy(x) || 0), 0);
  const q = Number(v.qty ?? v.value);
  if (!Number.isFinite(q)) return null;
  return /kj/i.test(String(v.units || v.unit || "")) ? q / KJ : q;
}

function minutesOf(w) {
  const d = Number(w.duration);
  if (Number.isFinite(d) && d > 0) return d > 600 ? d / 60 : d; // Sekunden (v2) oder Minuten
  const a = Date.parse(String(w.start || "").replace(" ", "T").replace(" ", ""));
  const b = Date.parse(String(w.end || "").replace(" ", "T").replace(" ", ""));
  return Number.isFinite(a) && Number.isFinite(b) && b > a ? (b - a) / 60000 : 0;
}

const r0 = (v) => Math.round(v || 0);

export async function handleHealthImport(request, env) {
  if (request.method === "GET") return json({ ok: true, hint: "Daten per POST mit Header X-Happa-Key senden." });
  if (request.method !== "POST") return json({ error: "Nur POST" }, 405);

  const url = new URL(request.url);
  const auth = request.headers.get("authorization") || "";
  const key = request.headers.get("x-happa-key") || (auth.match(/^Bearer\s+(\S+)/i) || [])[1] || url.searchParams.get("key") || "";
  if (!/^hk_[A-Za-z0-9_-]{20,80}$/.test(key)) {
    return json({ error: key ? "Schlüssel hat ein ungültiges Format" : "Schlüssel fehlt: Header X-Happa-Key setzen oder ?key=… an die URL hängen" }, 401);
  }
  const row = await env.DB.prepare("SELECT uid FROM health_keys WHERE hash = ?").bind(await sha256(key)).first();
  if (!row) return json({ error: "Unbekannter Schlüssel" }, 401);
  const uid = row.uid;

  if (Number(request.headers.get("content-length")) > MAX_BYTES) {
    return json({ error: "Zu viele Daten. In Health Auto Export „Tage“ als Zusammenfassung und einen kurzen Zeitraum (z. B. 7 Tage) wählen, Routendaten ausschalten." }, 413);
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) return json({ error: "Zu viele Daten (höchstens 1 MB pro Upload)." }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: "Kein gültiges JSON" }, 400); }
  const data = body?.data || body || {};
  const metrics = Array.isArray(data.metrics) ? data.metrics : [];
  const workouts = Array.isArray(data.workouts) ? data.workouts : [];

  // Tageswerte aus den Metriken (bei stündlichen Daten: Summe des Tages in diesem Upload)
  const perDay = new Map();
  const seen = new Set();
  for (const m of metrics) {
    const field = METRICS[String(m?.name || "").toLowerCase()];
    if (!field || !Array.isArray(m.data)) continue;
    seen.add(m.name);
    const kj = /kj/i.test(String(m.units || ""));
    for (const e of m.data) {
      const d = dayOf(e?.date);
      const q = Number(e?.qty ?? e?.Avg ?? e?.avg);
      if (!d || !Number.isFinite(q)) continue;
      const cur = perDay.get(d) || {};
      cur[field] = (cur[field] || 0) + (kj && (field === "a" || field === "b") ? q / KJ : q);
      perDay.set(d, cur);
    }
  }

  // Workouts nach Tag
  const wByDay = new Map();
  for (const w of workouts) {
    const d = dayOf(w?.start);
    if (!d) continue;
    const kcal = energy(w.activeEnergyBurned) ?? energy(w.activeEnergy) ?? energy(w.totalEnergy) ?? 0;
    const item = [String(w.name || "Training").slice(0, 40), r0(minutesOf(w)), r0(kcal), timeOf(w.start)];
    const list = wByDay.get(d) || [];
    list.push(item);
    wByDay.set(d, list);
  }

  const days = [...new Set([...perDay.keys(), ...wByDay.keys()])].filter((d) => d >= 20000101 && d <= 21001231).sort((a, b) => a - b).slice(-MAX_DAYS);
  if (!days.length) {
    await saveLast(env, uid, { at: Date.now(), bytes: text.length, metrics: [...seen], workouts: workouts.length, days: 0, note: "Keine passenden Daten gefunden" });
    return json({ ok: true, days: 0, hint: "Keine passenden Daten. Erwartet: active_energy, basal_energy_burned, step_count oder Workouts." });
  }

  const { results } = await env.DB.prepare("SELECT d, act FROM days WHERE uid = ? AND d BETWEEN ? AND ?")
    .bind(uid, days[0], days[days.length - 1]).all();
  const old = new Map(results.map((r) => [r.d, r.act ? JSON.parse(r.act) : {}]));
  const now = Date.now();
  const stmts = days.map((d) => {
    const act = { ...(old.get(d) || {}) };
    const vals = perDay.get(d);
    if (vals) for (const [k, v] of Object.entries(vals)) act[k] = k === "s" || k === "x" ? r0(v) : r0(v);
    if (wByDay.has(d)) {
      const merged = new Map((act.w || []).map((w) => [w[0] + "|" + w[3], w]));
      for (const w of wByDay.get(d)) merged.set(w[0] + "|" + w[3], w);
      act.w = [...merged.values()].sort((a, b) => String(a[3]).localeCompare(String(b[3]))).slice(0, 20);
    }
    act.t = now;
    return env.DB.prepare(
      "INSERT INTO days (uid, d, act) VALUES (?1, ?2, ?3) ON CONFLICT(uid, d) DO UPDATE SET act = excluded.act"
    ).bind(uid, d, JSON.stringify(act));
  });
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));

  const summary = { at: now, bytes: text.length, metrics: [...seen], workouts: workouts.length, days: days.length, from: days[0], to: days[days.length - 1] };
  await saveLast(env, uid, summary);
  return json({ ok: true, ...summary });
}

const lastKey = (uid) => `happa-health-last:${uid}`;
async function saveLast(env, uid, summary) {
  try { await env.OAUTH_KV.put(lastKey(uid), JSON.stringify(summary), { expirationTtl: 60 * 86400 }); } catch { /* nur Anzeige */ }
}

// ── Verwaltung in der App (hinter Cloudflare Access): Schlüssel erzeugen, Status, Daten entfernen ──
export async function handleHealthApi(request, env, uid, path) {
  const method = request.method;
  if (path === "/api/health" && method === "GET") {
    const key = await env.DB.prepare("SELECT created FROM health_keys WHERE uid = ? ORDER BY created DESC LIMIT 1").bind(uid).first();
    const last = await env.OAUTH_KV.get(lastKey(uid), "json").catch(() => null);
    return json({ hasKey: !!key, created: key?.created || null, last, url: "https://happa-mcp.auer.page/health/import" });
  }
  if (path === "/api/health/key" && method === "POST") {
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    const key = "hk_" + btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await env.DB.batch([
      env.DB.prepare("DELETE FROM health_keys WHERE uid = ?").bind(uid),
      env.DB.prepare("INSERT INTO health_keys (hash, uid, created) VALUES (?, ?, ?)").bind(await sha256(key), uid, Date.now()),
    ]);
    return json({ key }, 201);
  }
  if (path === "/api/health/key" && method === "DELETE") {
    await env.DB.prepare("DELETE FROM health_keys WHERE uid = ?").bind(uid).run();
    return json({ ok: true });
  }
  if (path === "/api/health/data" && method === "DELETE") {
    await env.DB.prepare("UPDATE days SET act = NULL WHERE uid = ?").bind(uid).run();
    await env.OAUTH_KV.delete(lastKey(uid)).catch(() => {});
    return json({ ok: true });
  }
  return null;
}
