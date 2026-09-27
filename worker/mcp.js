// TEST „Happa-Connector“ für Claude (MCP-Server: lesen und neue Einträge hinzufügen).
//
// Adresse: https://happa-mcp.auer.page/mcp – in Claude unter Einstellungen → Connectors eintragen.
// - Anmeldung: OAuth 2.1 (Bibliothek @cloudflare/workers-oauth-provider, Tokens in KV).
//   Die Zustimmungsseite ist https://happa.auer.page/connect und liegt damit hinter der
//   bestehenden Cloudflare-Access-Anmeldung von Happa: Wer dort zustimmt, gibt Claude
//   Lesezugriff auf das eigene Happa-Profil – nie auf fremde.
// - happa-mcp.auer.page selbst hat keine Access-Anmeldung, bietet aber nur die OAuth-Schnittstellen
//   (Metadaten, Token, Registrierung) und /mcp, das ohne gültiges Token nichts herausgibt.
// - Werkzeuge: Zusammenfassung (Profil, Ziele, Tagebuch, Gewicht), ein Tag, Gewichtsverlauf,
//   Nährwertsuche im Bundeslebensmittelschlüssel, Eintragen (nur hinzufügen – ändern oder löschen
//   kann Claude nichts; braucht die Berechtigung happa:write). Dazu Vorlagen (MCP-Prompts).
// Entfernen: diese Datei löschen, in worker/index.js den Connector-Block zurückbauen,
// in wrangler.toml die zweite Route und den KV-Speicher streichen.

import { AuthorizationError, CimdFetchError } from "@cloudflare/workers-oauth-provider";
import { authenticate } from "./auth.js";
import { goals, MEALS, ACTIVITY, foodEmoji } from "../public/js/nutrition.js";
import { prepareFoods, rankFoods } from "../public/js/foods.js";

export const MCP_HOST = "happa-mcp.auer.page";
export const MCP_RESOURCE = `https://${MCP_HOST}/mcp`;
export const MCP_SCOPE = "happa:read";
export const MCP_WRITE_SCOPE = "happa:write";
export const MCP_SCOPES = [MCP_SCOPE, MCP_WRITE_SCOPE];
export const CONNECT_URL = "https://happa.auer.page/connect";

// Tokens gehen nur an Claude zurück (claude.ai / claude.com), an keine andere Adresse.
const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "claude.com"];
const PROTOCOL_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const FALLBACK_VERSION = "2025-06-18";

// ── Datum: Happa speichert JJJJMMTT im lokalen Datum (Südtirol) ──
const todayLocal = () => Number(new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date()).replaceAll("-", ""));
const toUtc = (d) => Date.UTC(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100);
const fromUtc = (t) => { const x = new Date(t); return x.getUTCFullYear() * 10000 + (x.getUTCMonth() + 1) * 100 + x.getUTCDate(); };
const addDays = (d, n) => fromUtc(toUtc(d) + n * 86400000);
const iso = (d) => `${Math.floor(d / 10000)}-${String(Math.floor(d / 100) % 100).padStart(2, "0")}-${String(d % 100).padStart(2, "0")}`;
const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const weekday = (d) => WD[new Date(toUtc(d)).getUTCDay()];
function parseDate(value) {
  if (value == null || value === "") return todayLocal();
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? Number(m[1] + m[2] + m[3]) : NaN;
  if (!Number.isInteger(d) || d < 20000101 || d > 21001231) throw new ToolError("Datum bitte als JJJJ-MM-TT angeben.");
  return d;
}

class ToolError extends Error {}

const r0 = (v) => Math.round(v || 0);
const r1 = (v) => Math.round((v || 0) * 10) / 10;

// ── Daten aus D1 (nur lesen, nur die eigene Person) ──
async function loadUser(env, email) {
  const row = await env.DB.prepare("SELECT id, profile FROM users WHERE email = ?").bind(email).first();
  if (!row) throw new ToolError("Für diese Anmeldung gibt es noch kein Happa-Profil. Bitte zuerst Happa öffnen und einrichten.");
  return { id: row.id, profile: JSON.parse(row.profile || "{}") };
}
async function loadDays(env, uid, from, to) {
  const { results } = await env.DB.prepare(
    "SELECT d, log, water, weight FROM days WHERE uid = ? AND d BETWEEN ? AND ? ORDER BY d"
  ).bind(uid, from, to).all();
  return results.map((r) => ({ d: r.d, log: JSON.parse(r.log || "[]"), water: r.water || 0, weight: r.weight ?? null }));
}
async function loadWeights(env, uid, from) {
  const { results } = await env.DB.prepare(
    "SELECT d, weight FROM days WHERE uid = ? AND weight IS NOT NULL AND d >= ? ORDER BY d"
  ).bind(uid, from).all();
  return results.map((r) => [r.d, r.weight]);
}
async function currentWeight(env, uid, profile) {
  const row = await env.DB.prepare(
    "SELECT weight FROM days WHERE uid = ? AND weight IS NOT NULL ORDER BY d DESC LIMIT 1"
  ).bind(uid).first();
  return row?.weight || profile.startWeight || 70;
}

function sum(log) {
  const t = { kcal: 0, eiweiss_g: 0, kh_g: 0, fett_g: 0 };
  for (const e of log) { t.kcal += e[4] || 0; t.eiweiss_g += e[5] || 0; t.kh_g += e[6] || 0; t.fett_g += e[7] || 0; }
  return { kcal: r0(t.kcal), eiweiss_g: r0(t.eiweiss_g), kh_g: r0(t.kh_g), fett_g: r0(t.fett_g) };
}

function profileOut(p) {
  const year = new Date().getFullYear();
  return {
    name: p.name || null,
    geschlecht: p.sex === "m" ? "männlich" : p.sex === "f" ? "weiblich" : p.sex ? "divers" : null,
    alter: p.born ? year - p.born : null,
    groesse_cm: p.height || null,
    startgewicht_kg: p.startWeight ?? null,
    zielgewicht_kg: p.goalWeight ?? null,
    aktivitaet: ACTIVITY.find((a) => a.id === p.activity)?.name || null,
    tempo_kg_pro_woche: p.pace ?? null,
    start: p.startDate ? iso(p.startDate) : null,
  };
}
async function goalsOut(env, uid, p) {
  if (!p.height || !p.born) return null;
  const g = goals(p, await currentWeight(env, uid, p));
  return { kcal: g.kcal, eiweiss_g: g.protein, kh_g: g.carbs, fett_g: g.fat, wasser_ml: g.water, eigenes_ziel: !!p.kcalGoal };
}

// ── Werkzeuge ──
const TOOLS = [
  {
    name: "happa_zusammenfassung",
    title: "Happa: Zusammenfassung",
    description: "Liest die Happa-Daten der angemeldeten Person für die letzten N Tage (Standard 28, höchstens 90): Profil, Tagesziele, Tagebuch mit allen Einträgen und Tagessummen, Wasser und Gewichtsverlauf. Für Wochenrückblicke, Muster und Fragen wie „Warum nehme ich nicht ab?“. Kalorienwerte sind Schätzungen aus der App.",
    inputSchema: {
      type: "object",
      properties: { tage: { type: "integer", minimum: 1, maximum: 90, description: "Anzahl Tage bis heute (Standard 28)" } },
      additionalProperties: false,
    },
    annotations: { title: "Happa: Zusammenfassung", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "happa_tag",
    title: "Happa: Tag",
    description: "Liest einen Tag aus Happa (Standard: heute): alle Einträge nach Mahlzeit, Summen, Tagesziel und was noch übrig ist, Wasser und Gewicht. Für Fragen wie „Was kann ich heute Abend noch essen?“.",
    inputSchema: {
      type: "object",
      properties: { datum: { type: "string", description: "Datum als JJJJ-MM-TT, leer = heute" } },
      additionalProperties: false,
    },
    annotations: { title: "Happa: Tag", readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "happa_gewicht",
    title: "Happa: Gewichtsverlauf",
    description: "Liest alle Wiegungen der letzten N Tage (Standard 180) mit Start- und Zielgewicht.",
    inputSchema: {
      type: "object",
      properties: { tage: { type: "integer", minimum: 7, maximum: 730, description: "Zeitraum in Tagen (Standard 180)" } },
      additionalProperties: false,
    },
    annotations: { title: "Happa: Gewichtsverlauf", readOnlyHint: true, openWorldHint: false },
  },
];

// ── Nährwerte aus dem BLS 4.0 (dieselbe Datei und Suche wie in der App) ──
let foodsCache = null;
async function foods(env) {
  if (!foodsCache) {
    const res = await env.ASSETS.fetch(new Request("https://happa.auer.page/data/foods.json"));
    if (!res.ok) throw new Error("foods.json nicht verfügbar: " + res.status);
    foodsCache = prepareFoods(await res.json());
  }
  return foodsCache;
}

TOOLS.push({
  name: "happa_naehrwerte",
  title: "Happa: Nährwerte suchen",
  description: "Sucht Lebensmittel im Bundeslebensmittelschlüssel (BLS 4.0, Max Rubner-Institut, 7.140 Lebensmittel) und liefert Nährwerte pro 100 g: kcal, Eiweiß, Kohlenhydrate, Fett, Ballaststoffe, Zucker. Für genaue Kalorien bei Rezepten und Fotos: je Zutat einen deutschen Suchbegriff angeben (z. B. „Ei gekocht“, „Gouda“, „Reis gekocht“, „Olivenöl“) und dann mit der geschätzten Menge umrechnen. Bis zu 12 Suchbegriffe pro Aufruf.",
  inputSchema: {
    type: "object",
    properties: {
      suche: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 12, description: "Deutsche Suchbegriffe, einer pro Zutat" },
      treffer: { type: "integer", minimum: 1, maximum: 8, description: "Treffer pro Suchbegriff (Standard 3)" },
    },
    required: ["suche"],
    additionalProperties: false,
  },
  annotations: { title: "Happa: Nährwerte suchen", readOnlyHint: true, openWorldHint: false },
});

async function toolFoods(env, email, args) {
  const list = await foods(env);
  const queries = (Array.isArray(args.suche) ? args.suche : [args.suche]).map((q) => String(q || "").trim().slice(0, 60)).filter(Boolean).slice(0, 12);
  if (!queries.length) throw new ToolError("Bitte mindestens einen Suchbegriff angeben.");
  const n = intArg(args.treffer, 3, 1, 8);
  return {
    quelle: "Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut, CC BY 4.0 – Werte pro 100 g essbarer Anteil",
    ergebnisse: queries.map((q) => ({
      suche: q,
      treffer: rankFoods(list, q, n).map((f) => ({
        name: f.name, kcal: f.per100.kcal, eiweiss_g: f.per100.protein, kh_g: f.per100.carbs,
        fett_g: f.per100.fat, ballaststoffe_g: f.per100.fiber, zucker_g: f.per100.sugar,
      })),
    })),
  };
}

// ── Favoriten (im Profil gespeicherte Mahlzeit-Kombinationen) ──
const favList = (profile) => (Array.isArray(profile.favorites) ? profile.favorites : []);
const findFav = (profile, name) => {
  const n = String(name || "").trim().toLowerCase();
  const list = favList(profile);
  return list.find((f) => f.n.toLowerCase() === n) || list.find((f) => f.n.toLowerCase().includes(n));
};

TOOLS.push({
  name: "happa_favoriten",
  title: "Happa: Favoriten",
  description: "Liest die gespeicherten Favoriten der Person: Mahlzeit-Kombinationen mit eigenem Namen (z. B. „Pasta-Abend“) mit allen Teilen, Mengen und Nährwerten. Einen Favoriten trägt happa_eintragen mit dem Feld „favorit“ ein.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { title: "Happa: Favoriten", readOnlyHint: true, openWorldHint: false },
});

async function toolFavorites(env, email) {
  const user = await loadUser(env, email);
  return {
    favoriten: favList(user.profile).map((f) => ({
      name: f.n,
      kcal: r0(f.items.reduce((a, it) => a + (it[2] || 0), 0)),
      teile: f.items.map((it) => ({ name: it[0], gramm: it[1], kcal: it[2], eiweiss_g: it[3], kh_g: it[4], fett_g: it[5] })),
    })),
  };
}

const MEAL_IDS = { fruehstueck: 0, "frühstück": 0, mittagessen: 1, abendessen: 2, snack: 3, snacks: 3 };

TOOLS.push({
  name: "happa_eintragen",
  title: "Happa: Eintragen",
  description: "Trägt Lebensmittel in das Happa-Tagebuch der angemeldeten Person ein (nur hinzufügen – nichts ändern oder löschen). Nur aufrufen, wenn die Person das ausdrücklich möchte, und die Werte vorher nennen. Entweder „eintraege“ angeben (Nährwerte gelten für die angegebene Menge, nicht pro 100 g; höchstens 10) oder „favorit“ mit dem Namen eines gespeicherten Favoriten (siehe happa_favoriten). Antwortet mit den neuen Tagessummen und dem Restbudget.",
  inputSchema: {
    type: "object",
    properties: {
      mahlzeit: { type: "string", enum: ["fruehstueck", "mittagessen", "abendessen", "snack"], description: "Mahlzeit, zu der eingetragen wird" },
      datum: { type: "string", description: "Datum als JJJJ-MM-TT, leer = heute (höchstens 30 Tage zurück)" },
      favorit: { type: "string", description: "Name eines gespeicherten Favoriten – statt „eintraege“" },
      eintraege: {
        type: "array", minItems: 1, maxItems: 10,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Kurzer deutscher Name, z. B. „Spaghetti Bolognese“" },
            gramm: { type: "number", description: "Menge in Gramm (bei Getränken ml)" },
            kcal: { type: "number" },
            eiweiss_g: { type: "number" },
            kh_g: { type: "number", description: "Kohlenhydrate in g" },
            fett_g: { type: "number" },
            emoji: { type: "string", description: "Optional, ein passendes Emoji" },
          },
          required: ["name", "gramm", "kcal"],
          additionalProperties: false,
        },
      },
    },
    required: ["mahlzeit"],
    additionalProperties: false,
  },
  annotations: { title: "Happa: Eintragen", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
});

const num = (v, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0; };
const newId = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");

async function toolAdd(env, email, args, scopes) {
  if (!scopes.includes(MCP_WRITE_SCOPE)) {
    throw new ToolError("Zum Eintragen braucht Claude eine neue Freigabe: in Claude unter Einstellungen → Connectors → Happa auf „Trennen“ tippen und neu verbinden, dann bei Happa „Erlauben“.");
  }
  const meal = typeof args.mahlzeit === "number" ? args.mahlzeit : MEAL_IDS[String(args.mahlzeit || "").toLowerCase()];
  if (![0, 1, 2, 3].includes(meal)) throw new ToolError("Mahlzeit bitte als fruehstueck, mittagessen, abendessen oder snack angeben.");
  const today = todayLocal();
  const d = parseDate(args.datum);
  if (d > addDays(today, 1) || d < addDays(today, -30)) throw new ToolError("Eintragen geht nur für die letzten 30 Tage.");
  const user = await loadUser(env, email);
  let list = Array.isArray(args.eintraege) ? args.eintraege : [];
  if (args.favorit) {
    const fav = findFav(user.profile, args.favorit);
    if (!fav) throw new ToolError(`Kein Favorit „${String(args.favorit).slice(0, 40)}“ gefunden. Gespeichert: ${favList(user.profile).map((f) => f.n).join(", ") || "keine"}.`);
    list = fav.items.map((it) => ({ name: it[0], gramm: it[1], kcal: it[2], eiweiss_g: it[3], kh_g: it[4], fett_g: it[5], emoji: it[7] }));
  }
  if (!list.length || list.length > 15) throw new ToolError("1 bis 10 Einträge pro Aufruf (oder einen Favoriten).");
  // gleiche Grenzen wie in der App (worker/index.js → cleanEntry); Quelle „k“ = KI-Schätzung
  const entries = list.map((e) => {
    const name = String(e?.name || "").trim().slice(0, 80) || "Eintrag";
    const emoji = String(e?.emoji || "").slice(0, 8) || foodEmoji(name) || "";
    return [newId(), meal, name, r1(num(e?.gramm, 5000)), r0(num(e?.kcal, 10000)),
      r1(num(e?.eiweiss_g, 1000)), r1(num(e?.kh_g, 1000)), r1(num(e?.fett_g, 1000)), "k", emoji];
  });
  const params = entries.map((e) => JSON.stringify(e));
  const refs = params.map((_, i) => `json(?${i + 3})`);
  const row = await env.DB.prepare(
    `INSERT INTO days (uid, d, log) VALUES (?1, ?2, json_array(${refs.join(", ")}))
     ON CONFLICT(uid, d) DO UPDATE SET log = json_insert(days.log, ${refs.map((r) => `'$[#]', ${r}`).join(", ")})
     RETURNING log`
  ).bind(user.id, d, ...params).first();
  const log = JSON.parse(row.log || "[]");
  const t = sum(log);
  const g = await goalsOut(env, user.id, user.profile);
  return {
    eingetragen: entries.map((e) => ({ name: e[2], gramm: e[3], kcal: e[4], eiweiss_g: e[5], kh_g: e[6], fett_g: e[7] })),
    mahlzeit: MEALS[meal].name,
    datum: `${weekday(d)} ${iso(d)}`,
    summe_tag: t,
    noch_uebrig: g ? { kcal: g.kcal - t.kcal, eiweiss_g: g.eiweiss_g - t.eiweiss_g, kh_g: g.kh_g - t.kh_g, fett_g: g.fett_g - t.fett_g } : null,
    hinweis: "In der Happa-App erscheinen die Einträge automatisch, sobald man zur App zurückkehrt; dort lassen sie sich ändern oder löschen.",
  };
}

const intArg = (v, def, min, max) => {
  if (v == null || v === "") return def;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) throw new ToolError("Ungültige Zahl.");
  return Math.min(max, Math.max(min, n));
};

async function toolSummary(env, email, args) {
  const tage = intArg(args.tage, 28, 1, 90);
  const user = await loadUser(env, email);
  const to = todayLocal(), from = addDays(to, -(tage - 1));
  const days = await loadDays(env, user.id, from, to);
  const weights = await loadWeights(env, user.id, addDays(to, -Math.max(90, tage)));
  const g = await goalsOut(env, user.id, user.profile);
  return {
    app: "Happa", kind: "coach", v: 1,
    created: new Date().toISOString(),
    heute: iso(to),
    zeitraum: { von: iso(from), bis: iso(to) },
    profile: { name: user.profile.name, sex: user.profile.sex, born: user.profile.born, height: user.profile.height, startWeight: user.profile.startWeight, goalWeight: user.profile.goalWeight, activity: user.profile.activity, pace: user.profile.pace },
    profil: profileOut(user.profile),
    goals: g ? { kcal: g.kcal, protein: g.eiweiss_g, carbs: g.kh_g, fat: g.fett_g, water: g.wasser_ml } : null,
    entryFormat: ["id", "mahlzeit (0 Frühstück, 1 Mittagessen, 2 Abendessen, 3 Snacks)", "name", "gramm", "kcal", "eiweiss_g", "kh_g", "fett_g"],
    days: days.filter((x) => x.log.length || x.water || x.weight != null).map((x) => ({
      d: x.d, datum: `${weekday(x.d)} ${iso(x.d)}`, summe: sum(x.log),
      log: x.log.map((e) => e.slice(0, 8)), water: x.water, weight: x.weight,
    })),
    weights,
  };
}

async function toolDay(env, email, args) {
  const d = parseDate(args.datum);
  const user = await loadUser(env, email);
  const [day] = await loadDays(env, user.id, d, d);
  const log = day ? day.log : [];
  const t = sum(log);
  const g = await goalsOut(env, user.id, user.profile);
  return {
    datum: `${weekday(d)} ${iso(d)}`,
    ist_heute: d === todayLocal(),
    mahlzeiten: MEALS.map((m) => ({
      mahlzeit: m.name,
      eintraege: log.filter((e) => e[1] === m.id).map((e) => ({ name: e[2], gramm: e[3], kcal: e[4], eiweiss_g: e[5], kh_g: e[6], fett_g: e[7] })),
      kcal: r0(log.filter((e) => e[1] === m.id).reduce((a, e) => a + (e[4] || 0), 0)),
    })),
    summe: t,
    ziel: g,
    noch_uebrig: g ? { kcal: g.kcal - t.kcal, eiweiss_g: g.eiweiss_g - t.eiweiss_g, kh_g: g.kh_g - t.kh_g, fett_g: g.fett_g - t.fett_g } : null,
    wasser_ml: day ? day.water : 0,
    gewicht_kg: day ? day.weight : null,
  };
}

async function toolWeight(env, email, args) {
  const tage = intArg(args.tage, 180, 7, 730);
  const user = await loadUser(env, email);
  const weights = await loadWeights(env, user.id, addDays(todayLocal(), -tage));
  return {
    startgewicht_kg: user.profile.startWeight ?? null,
    zielgewicht_kg: user.profile.goalWeight ?? null,
    wiegungen: weights.map(([d, w]) => ({ datum: iso(d), kg: r1(w) })),
  };
}

// ── Vorlagen (MCP-Prompts): fertige Aufträge, die Claude im Menü anbieten kann ──
const PROMPTS = [
  {
    name: "rezept_aus_kuehlschrank",
    title: "Rezept aus dem Kühlschrank",
    description: "Foto vom Kühlschrank oder eine Zutatenliste → Rezepte, die ins Restbudget von heute passen, mit echten Nährwerten.",
    arguments: [
      { name: "mahlzeit", description: "Frühstück, Mittagessen, Abendessen oder Snack", required: false },
      { name: "zutaten", description: "Zutaten als Text, falls kein Foto", required: false },
    ],
    text: (a) => `Ich möchte etwas kochen${a.mahlzeit ? ` (${a.mahlzeit})` : ""}. ${a.zutaten ? `Diese Zutaten habe ich: ${a.zutaten}.` : "Ich schicke dir ein Foto von meinem Kühlschrank oder meinen Zutaten."}
So gehst du vor:
1. Hol mit happa_tag mein Restbudget für heute.
2. Erkenne die Zutaten und schlage 2 einfache Rezepte vor (höchstens 30 Minuten), die hineinpassen. Vorräte wie Öl, Salz und Gewürze darf ich haben.
3. Rechne die Nährwerte mit happa_naehrwerte aus echten Werten pro 100 g aus. Zeige je Rezept eine kurze Tabelle mit Gramm, kcal, Eiweiß, Kohlenhydraten und Fett und die Summe.
4. Frag mich, ob du eins mit happa_eintragen eintragen sollst.`,
  },
  {
    name: "mahlzeit_eintragen",
    title: "Mahlzeit schätzen und eintragen",
    description: "Foto oder Beschreibung einer Mahlzeit → Mengen schätzen, mit echten Nährwerten rechnen, nach Bestätigung in Happa eintragen.",
    arguments: [
      { name: "mahlzeit", description: "Frühstück, Mittagessen, Abendessen oder Snack", required: false },
      { name: "beschreibung", description: "Was du gegessen hast, falls kein Foto", required: false },
    ],
    text: (a) => `${a.beschreibung ? `Ich habe gegessen: ${a.beschreibung}.` : "Ich schicke dir ein Foto meiner Mahlzeit."}
1. Bestimme die Bestandteile und schätze die Mengen in Gramm (denk an Öl, Butter und Soßen).
2. Hol die Nährwerte pro 100 g mit happa_naehrwerte und rechne sie auf die Mengen um.
3. Zeige eine kurze Tabelle mit Summe und frag, ob du sie ${a.mahlzeit ? `als ${a.mahlzeit}` : "zur passenden Mahlzeit"} mit happa_eintragen eintragen sollst.
4. Sag mir danach mit den Werten aus der Antwort, was heute noch übrig ist.`,
  },
  {
    name: "wochenrueckblick",
    title: "Wochenrückblick",
    description: "Was lief gut, woher die Kalorien kommen, Muster und zwei kleine Schritte für nächste Woche.",
    arguments: [],
    text: () => `Hol mit happa_zusammenfassung meine letzten 28 Tage und schreib mir einen kurzen Wochenrückblick über die letzten 7 Tage im Vergleich zu davor: Das lief gut · Woher die Kalorien kommen · Muster (mit Zahlen, z. B. Wochenende, abends) · 2 kleine, machbare Schritte für nächste Woche. Höchstens 250 Wörter, freundlich und ohne Moralpredigt.`,
  },
];

const HANDLERS = { happa_zusammenfassung: toolSummary, happa_tag: toolDay, happa_gewicht: toolWeight, happa_naehrwerte: toolFoods, happa_favoriten: toolFavorites, happa_eintragen: toolAdd };

// ── MCP über HTTP (JSON-RPC 2.0, zustandslos, Antwort als JSON) ──
const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function handleRpc(msg, env, email, scopes) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcError(msg?.id, -32600, "Invalid Request");
  const isNotification = msg.id === undefined;
  const params = msg.params || {};
  let out;
  switch (msg.method) {
    case "initialize": {
      const asked = params.protocolVersion;
      out = rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : FALLBACK_VERSION,
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
        serverInfo: {
          name: "happa", title: "Happa", version: "0.2.0",
          websiteUrl: "https://happa.auer.page",
          icons: [
            { src: `https://${MCP_HOST}/icon-192.png`, mimeType: "image/png", sizes: ["192x192"] },
            { src: `https://${MCP_HOST}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] },
            { src: `https://${MCP_HOST}/icon.svg`, mimeType: "image/svg+xml", sizes: ["any"] },
          ],
        },
        instructions: "Happa ist eine Kalorien- und Abnehm-App. Die Werkzeuge gelten nur für die angemeldete Person. Antworte auf Deutsch. Kalorienwerte sind Schätzungen; empfiehl nie weniger als 1.200 kcal (Frauen) bzw. 1.500 kcal (Männer) pro Tag. Für Kalorienangaben zu Fotos, Rezepten und Mahlzeiten die Werte pro 100 g mit happa_naehrwerte holen und auf die geschätzte Menge umrechnen, statt frei zu schätzen. happa_eintragen nur verwenden, wenn die Person ausdrücklich eintragen möchte; nenne vorher kurz, was eingetragen wird.",
      });
      break;
    }
    case "ping": out = rpcResult(msg.id, {}); break;
    case "tools/list": out = rpcResult(msg.id, { tools: TOOLS }); break;
    case "tools/call": {
      const fn = HANDLERS[params.name];
      if (!fn) { out = rpcError(msg.id, -32602, `Unbekanntes Werkzeug: ${params.name}`); break; }
      try {
        const data = await fn(env, email, params.arguments || {}, scopes);
        out = rpcResult(msg.id, { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data, isError: false });
      } catch (err) {
        if (!(err instanceof ToolError)) console.error(err);
        out = rpcResult(msg.id, { content: [{ type: "text", text: err instanceof ToolError ? err.message : "Happa ist gerade nicht erreichbar." }], isError: true });
      }
      break;
    }
    case "resources/list": out = rpcResult(msg.id, { resources: [] }); break;
    case "prompts/list":
      out = rpcResult(msg.id, { prompts: PROMPTS.map(({ name, title, description, arguments: args }) => ({ name, title, description, arguments: args })) });
      break;
    case "prompts/get": {
      const pr = PROMPTS.find((x) => x.name === params.name);
      if (!pr) { out = rpcError(msg.id, -32602, `Unbekannte Vorlage: ${params.name}`); break; }
      const a = Object.fromEntries(Object.entries(params.arguments || {}).map(([k, v]) => [k, String(v).slice(0, 300)]));
      out = rpcResult(msg.id, { description: pr.description, messages: [{ role: "user", content: { type: "text", text: pr.text(a) } }] });
      break;
    }
    default:
      if (msg.method.startsWith("notifications/")) return null;
      out = rpcError(msg.id, -32601, `Methode nicht unterstützt: ${msg.method}`);
  }
  return isNotification ? null : out;
}

// Geschützter Teil: hierher kommt nur, wer ein gültiges Token hat (ctx.props.email).
export const mcpApi = {
  async fetch(request, env, ctx) {
    const email = ctx.props?.email;
    const scope = ctx.auth?.scope;
    const scopes = Array.isArray(scope) ? scope : String(scope || "").split(" ").filter(Boolean);
    if (!email) return new Response("Forbidden", { status: 403 });
    if (request.method === "GET") return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (Number(request.headers.get("content-length")) > 256_000) return Response.json(rpcError(null, -32600, "Anfrage zu groß"), { status: 413 });
    let body;
    try { body = await request.json(); } catch { return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 }); }
    const list = Array.isArray(body) ? body.slice(0, 20) : [body];
    const replies = (await Promise.all(list.map((m) => handleRpc(m, env, email, scopes)))).filter(Boolean);
    if (!replies.length) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? replies : replies[0], { headers: { "cache-control": "no-store" } });
  },
};

// ── Zustimmungsseite (happa.auer.page/connect, hinter Cloudflare Access) ──
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title, bodyHtml, status = 200, headers = new Headers()) {
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self' https://claude.ai https://claude.com; frame-ancestors 'none'");
  return new Response(`<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>
:root{color-scheme:light dark;--bg:#eef1f5;--card:#fff;--text:#0b0b0f;--muted:rgba(60,60,67,.7);--fill:rgba(120,120,128,.12)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--muted:rgba(235,235,245,.66);--fill:rgba(120,120,128,.24)}}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:32px 16px}
main{max-width:440px;margin:0 auto;background:var(--card);border-radius:26px;padding:28px 22px;box-shadow:0 8px 24px rgba(22,38,60,.08)}
img{width:72px;height:72px;border-radius:18px;display:block;margin:0 auto 14px}
h1{font-size:22px;text-align:center;margin:0 0 6px;text-wrap:balance}p{margin:0 0 12px}.muted{color:var(--muted);font-size:14px}
ul{margin:0 0 16px;padding-left:20px}li{margin:4px 0}.box{background:var(--fill);border-radius:14px;padding:12px 14px;margin:0 0 16px;font-size:15px}
.row{display:flex;gap:10px;margin-top:8px}button{flex:1;border:0;border-radius:99px;padding:13px;font:600 16px/1 inherit;cursor:pointer;min-height:48px}
.ok{background:linear-gradient(135deg,#12a46d,#0a8458 50%,#07706f);color:#fff}.no{background:var(--fill);color:var(--text)}
</style></head><body><main>${bodyHtml}</main></body></html>`, { status, headers });
}

function errorPage(message, status = 400) {
  return page("Happa", `<img src="/icons/icon-192.png" alt=""><h1>Das hat nicht geklappt</h1><p>${esc(message)}</p><p class="muted">Starte die Verbindung in Claude bitte noch einmal.</p>`, status);
}

// Kennung für die Freigabe: Hash der E-Mail (die Bibliothek trennt Codes an „:“,
// Service-Zugänge heißen aber „service:…“)
async function userKey(email) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email));
  return "u" + [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function redirectHostAllowed(uri) {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" && ALLOWED_REDIRECT_HOSTS.includes(u.hostname);
  } catch { return false; }
}

// Zustimmungsseite auf happa.auer.page/connect (hinter Cloudflare Access)
export async function connect(request, env, oauth) {
  const user = await authenticate(request, env).catch(() => null);
  if (!user) return errorPage("Bitte melde dich zuerst bei Happa an.", 401);

  try {
    if (request.method === "POST") {
      const form = await request.formData();
      const handle = String(form.get("handle") || "");
      if (form.get("decision") !== "approve") {
        const denied = await oauth.denyConsent(request, handle);
        return new Response(null, { status: 302, headers: denied.headers });
      }
      const approved = await oauth.approveConsent(request, handle, { scope: MCP_SCOPES });
      if (!redirectHostAllowed(approved.request.redirectUri)) return errorPage("Diese App darf nicht auf Happa zugreifen.", 403);
      const client = await oauth.lookupClient(approved.request.clientId);
      const { redirectTo } = await oauth.completeAuthorization({
        request: approved.request,
        userId: await userKey(user.email),
        metadata: { clientName: client?.clientName || "Claude", email: user.email },
        scope: MCP_SCOPES,
        props: { email: user.email },
      });
      approved.headers.set("location", redirectTo);
      return new Response(null, { status: 302, headers: approved.headers });
    }

    const authReq = await oauth.parseAuthRequest(request);
    if (!redirectHostAllowed(authReq.redirectUri)) {
      return errorPage(`Nur Claude darf auf Happa zugreifen (angefragt von ${new URL(authReq.redirectUri).hostname}).`, 403);
    }
    const client = await oauth.lookupClient(authReq.clientId);
    if (!client) return errorPage("Unbekannte App.");
    const consent = await oauth.beginConsent(authReq);
    const name = esc(client.clientName || "Claude");
    const host = esc(new URL(authReq.redirectUri).hostname);
    const who = user.email.startsWith("service:") ? "Service-Zugang" : user.email;
    return page("Happa mit Claude verbinden", `
      <img src="/icons/icon-192.png" alt="">
      <h1>${name} mit Happa verbinden?</h1>
      <p class="muted" style="text-align:center">Angemeldet als <b>${esc(who)}</b></p>
      <div class="box">
        <p style="margin:0 0 6px"><b>${name}</b> darf:</p>
        <ul style="margin:0">
          <li>Profil, Tagesziele, Tagebuch, Wasser und Gewicht <b>lesen</b></li>
          <li>neue Einträge ins Tagebuch <b>hinzufügen</b>, wenn du darum bittest</li>
        </ul>
      </div>
      <p class="muted">Ändern oder löschen kann Claude nichts – das geht nur in der Happa-App. Die Freigabe geht an <b>${host}</b>. Du kannst sie in Claude unter Einstellungen → Connectors jederzeit trennen.</p>
      <form method="post">
        <input type="hidden" name="handle" value="${esc(consent.handle)}">
        <div class="row">
          <button class="no" name="decision" value="deny">Ablehnen</button>
          <button class="ok" name="decision" value="approve">Erlauben</button>
        </div>
      </form>`, 200, consent.headers);
  } catch (err) {
    if (err instanceof AuthorizationError && err.redirectUri && redirectHostAllowed(err.redirectUri)) {
      const redirect = new URL(err.redirectUri);
      redirect.searchParams.set("error", err.code);
      redirect.searchParams.set("error_description", err.description);
      if (err.state) redirect.searchParams.set("state", err.state);
      if (err.issuer) redirect.searchParams.set("iss", err.issuer);
      return Response.redirect(redirect.href, 302);
    }
    if (err instanceof AuthorizationError) return errorPage(err.description || "Die Anfrage ist abgelaufen.");
    if (err instanceof CimdFetchError) return errorPage("Diese App konnte nicht überprüft werden.");
    throw err;
  }
}
