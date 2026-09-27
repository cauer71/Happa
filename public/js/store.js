// Zentraler Zustand + Aktionen. Bewusst schlicht: ein Objekt, Abonnenten werden
// bei jeder Änderung benachrichtigt, Komponenten lesen per useStore().

import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import { api } from "./api.js";
import { today, addDays, mondayOf, storage, uid, haptic, reduceMotion } from "./util.js";
import { goals, earnedBadges, BADGES, E } from "./nutrition.js";
import { putThumb, deleteThumb, clearThumbs } from "./thumbs.js";

export const state = {
  phase: "boot",          // boot | onboarding | app | error
  error: null,
  email: "",
  profile: {},
  days: {},               // JJJJMMTT → { d, log, water, weight, ai }
  selected: today(),
  today: today(),         // wechselt, wenn die App über Mitternacht offen bleibt
  streak: { current: 0, best: 0 },
  serverStreak: 0,
  logged: new Set(),      // Tage mit Einträgen (letzte ~60 Tage + lokale Änderungen)
  lastWeight: null,       // { d, w }
  weights: null,          // [[d, kg], …] – einmal pro Sitzung geladen
  aiLimit: 40,
  entries: 0,             // Anzahl aller Einträge (Abzeichen „100 Einträge“)
  tab: "heute",
  overlays: [],           // [{ id, render, closing }]
  toast: null,
  celebrate: null,
  celebrateQueue: [],     // weitere neue Abzeichen, nacheinander gefeiert
};

const listeners = new Set();
let version = 0;
export function set(patch) {
  Object.assign(state, typeof patch === "function" ? patch(state) : patch);
  version++;
  listeners.forEach((fn) => fn());
}
export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  const seen = useRef(version);
  seen.current = version;
  // Sofort (layout) abonnieren und verpasste Änderungen nachholen – sonst kann eine
  // sehr schnelle Serverantwort zwischen Rendern und Abonnieren verloren gehen.
  useLayoutEffect(() => {
    listeners.add(force);
    if (seen.current !== version) force();
    return () => listeners.delete(force);
  }, []);
  return state;
}

export function setTab(tab) {
  if (state.tab === tab) { scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); return; }
  haptic();
  set({ tab });
  scrollTo(0, 0);
  history.replaceState(history.state, "", "#" + tab);
}

export const emptyDay = (d) => ({ d, log: [], water: 0, weight: null, ai: 0 });
const putDay = (day) => set({ days: { ...state.days, [day.d]: day } });

// ── Overlays (Sheets, Kamera) mit Zurück-Taste ──
// stack: Overlays mit eigenem Verlaufseintrag, in Öffnungsreihenfolge.
let stack = [];
let ignorePop = 0;
let replaceNext = false;

export function openOverlay(render) {
  const id = uid();
  set({ overlays: [...state.overlays, { id, render, closing: false }] });
  if (replaceNext) { replaceNext = false; history.replaceState({ overlay: id }, ""); }
  else history.pushState({ overlay: id }, "");
  stack.push(id);
  return id;
}

function markClosing(ids) {
  set({ overlays: state.overlays.map((x) => (ids.includes(x.id) ? { ...x, closing: true } : x)) });
  setTimeout(() => set({ overlays: state.overlays.filter((x) => !ids.includes(x.id)) }), 320);
}

// replace: Das nächste openOverlay übernimmt den Verlaufseintrag (Sheet → Kamera usw.)
export function closeOverlay(id, { fromPop = false, replace = false } = {}) {
  const o = state.overlays.find((x) => x.id === id);
  if (!o || o.closing) return;
  markClosing([id]);
  const idx = stack.lastIndexOf(id);
  if (idx < 0) return;
  stack.splice(idx, 1);
  if (fromPop) return;
  if (replace && idx === stack.length) {
    replaceNext = true;
    // Folgt doch kein neues Overlay, den Eintrag wieder entfernen
    setTimeout(() => { if (replaceNext) { replaceNext = false; ignorePop++; history.back(); } }, 0);
    return;
  }
  if (idx === stack.length) { ignorePop++; history.back(); }
}

export function closeAll() {
  const open = state.overlays.filter((o) => !o.closing).map((o) => o.id);
  if (open.length) markClosing(open);
  const n = stack.length;
  stack = [];
  if (n) { ignorePop++; history.go(-n); }
}

addEventListener("popstate", () => {
  if (ignorePop) { ignorePop--; return; }
  const top = stack[stack.length - 1];
  if (top) closeOverlay(top, { fromPop: true });
});

// ── Mitteilungen ──
let toastTimer;
export function toast(text, icon = "✓", action = null) {
  clearTimeout(toastTimer);
  set({ toast: { id: uid(), text, icon, action, closing: false } });
  toastTimer = setTimeout(dismissToast, action ? 5000 : 2600);
}
export function dismissToast() {
  clearTimeout(toastTimer);
  if (!state.toast) return;
  set({ toast: { ...state.toast, closing: true } });
  toastTimer = setTimeout(() => set({ toast: null }), 300);
}
export function celebrate(badge) {
  if (state.celebrate) set({ celebrateQueue: [...state.celebrateQueue, badge] });
  else set({ celebrate: badge });
}
// Feier schließen; das nächste Abzeichen folgt, sobald die alte Karte weg ist
export function closeCelebrate() {
  const [next, ...rest] = state.celebrateQueue;
  set({ celebrate: null, celebrateQueue: rest });
  if (next) setTimeout(() => set({ celebrate: next }), 380);
}

// ── Laden ──
export async function boot() {
  try {
    const d = today();
    const me = await api(`/me?d=${d}`);
    set({
      email: me.email,
      profile: me.profile || {},
      days: { [d]: me.day },
      selected: d,
      today: d,
      serverStreak: me.streak.current,
      streak: me.streak,
      logged: new Set(me.logged),
      lastWeight: me.lastWeight,
      aiLimit: me.aiLimit,
      entries: me.entries || 0,
      phase: me.profile && me.profile.startWeight ? "app" : "onboarding",
    });
  } catch (err) {
    if (err.status !== 401) set({ phase: "error", error: err.message });
  }
}

// Bleibt die installierte App über Mitternacht offen, springt "Heute" beim
// Zurückkehren auf den neuen Tag – sonst landen Einträge beim Vortag.
function checkNewDay() {
  if (document.visibilityState === "hidden" || state.phase !== "app") return;
  const t = today();
  if (t === state.today) return;
  const wasToday = state.selected === state.today;
  set({ today: t });
  if (wasToday) selectDay(t);
  recomputeStreak();
}
document.addEventListener("visibilitychange", checkNewDay);
addEventListener("pageshow", checkNewDay);
addEventListener("focus", checkNewDay);

// Laufende Änderungen pro Tag: Solange etwas unterwegs ist, überschreiben Ladevorgänge
// den lokalen Stand nicht.
const pending = {};
const seq = {};
const waterTimers = {};
const busy = (d) => (pending[d] || 0) > 0 || !!waterTimers[d];

export async function loadDay(d, force = false) {
  if (state.days[d] && !force) return state.days[d];
  const { days } = await api(`/days?from=${d}&to=${d}`);
  const day = days[0] || emptyDay(d);
  if (!busy(d)) putDay(day);
  return state.days[d];
}

// Lädt nur die Tage eines Zeitraums, die noch fehlen
export async function loadRange(from, to) {
  let a = from, b = to;
  while (a <= b && state.days[a]) a = addDays(a, 1);
  while (b >= a && state.days[b]) b = addDays(b, -1);
  if (a > b) return [];
  const { days } = await api(`/days?from=${a}&to=${b}`);
  const map = { ...state.days };
  for (let d = a; d <= b; d = addDays(d, 1)) if (!map[d]) map[d] = emptyDay(d);
  for (const day of days) if (!busy(day.d)) map[day.d] = day;
  const logged = new Set(state.logged);
  for (let d = a; d <= b; d = addDays(d, 1)) (map[d].log.length ? logged.add(d) : logged.delete(d));
  set({ days: map, logged });
  recomputeStreak();
  return days;
}

export function selectDay(d) {
  set({ selected: d });
  loadDay(d).catch((err) => toast(err.message, "⚠️"));
}

// ── Streak lokal nachführen (ohne erneut die Datenbank zu fragen) ──
function recomputeStreak() {
  const t = today();
  let d = state.logged.has(t) ? t : addDays(t, -1);
  let n = 0;
  while (state.logged.has(d) && n < 400) { n++; d = addDays(d, -1); }
  const current = n >= 55 ? Math.max(n, state.serverStreak) : n;
  set({ streak: { current, best: Math.max(state.streak.best, current) } });
}

function markLogged(day) {
  const logged = new Set(state.logged);
  if (day.log.length) logged.add(day.d); else logged.delete(day.d);
  set({ logged });
  recomputeStreak();
}

// Gemeinsamer Ablauf für Eintrags-Änderungen: sofort anzeigen, Serverstand übernehmen,
// sobald nichts mehr unterwegs ist; bei Fehlern nur diese eine Änderung zurücknehmen.
async function mutateDay(d, apply, undo, request) {
  const my = (seq[d] = (seq[d] || 0) + 1);
  pending[d] = (pending[d] || 0) + 1;
  const opt = apply(state.days[d] || emptyDay(d));
  putDay(opt);
  markLogged(opt);
  try {
    const res = await request();
    pending[d]--;
    if (!pending[d] && seq[d] === my) {
      const cur = state.days[d];
      const day = { ...res.day, water: waterTimers[d] ? cur.water : res.day.water };
      putDay(day);
      markLogged(day);
    }
    return res;
  } catch (err) {
    pending[d]--;
    const back = undo(state.days[d] || emptyDay(d));
    putDay(back);
    markLogged(back);
    throw err;
  }
}

// Mehrere Einträge in EINER Anfrage (alles oder nichts). Wiederholungen mit denselben
// IDs legt der Server nicht doppelt an.
export async function addEntries(d, entries, thumb) {
  const before = state.days[d]?.log || [];
  const ids = new Set(entries.map((e) => e[E.id]));
  const res = await mutateDay(
    d,
    (day) => ({ ...day, log: [...day.log.filter((e) => !ids.has(e[E.id])), ...entries] }),
    (day) => ({ ...day, log: day.log.filter((e) => !ids.has(e[E.id])) }),
    () => api(`/days/${d}/entries`, { method: "POST", body: entries }),
  );
  if (thumb) entries.forEach((e) => putThumb(e[E.id], thumb));
  const had = new Set(before.map((e) => e[E.id]));
  set({ entries: state.entries + res.day.log.filter((e) => ids.has(e[E.id]) && !had.has(e[E.id])).length });
  return res.day;
}

export async function updateEntry(d, entry) {
  const old = (state.days[d]?.log || []).find((e) => e[E.id] === entry[E.id]);
  await mutateDay(
    d,
    (day) => ({ ...day, log: day.log.map((e) => (e[E.id] === entry[E.id] ? entry : e)) }),
    (day) => ({ ...day, log: day.log.map((e) => (e[E.id] === entry[E.id] && old ? old : e)) }),
    () => api(`/days/${d}/entries/${entry[E.id]}`, { method: "PUT", body: entry }),
  );
}

export async function removeEntry(d, id) {
  const log = state.days[d]?.log || [];
  const index = log.findIndex((e) => e[E.id] === id);
  const old = log[index];
  await mutateDay(
    d,
    (day) => ({ ...day, log: day.log.filter((e) => e[E.id] !== id) }),
    (day) => {
      if (!old || day.log.some((e) => e[E.id] === id)) return day;
      const next = [...day.log];
      next.splice(Math.min(index, next.length), 0, old);
      return { ...day, log: next };
    },
    () => api(`/days/${d}/entries/${id}`, { method: "DELETE" }),
  );
  if (old) set({ entries: Math.max(0, state.entries - 1) });
  return old;
}

// Löschen mit "Rückgängig" im Hinweis; das Vorschaubild bleibt bis dahin erhalten.
export async function deleteWithUndo(d, id) {
  const entry = await removeEntry(d, id);
  let undone = false;
  const timer = setTimeout(() => { if (!undone) deleteThumb(id); }, 6000);
  toast("Eintrag gelöscht", "🗑️", {
    label: "Rückgängig",
    run: () => {
      undone = true;
      clearTimeout(timer);
      if (entry) addEntries(d, [entry]).catch((err) => toast(err.message, "⚠️"));
    },
  });
}

// Wasser: schnelles Tippen wird gebündelt, gespeichert wird der letzte Stand.
// Die Antwort des Servers überschreibt den lokalen Wert nicht (neuere Tipper gewinnen).
export function setWater(d, ml) {
  const day = state.days[d] || emptyDay(d);
  putDay({ ...day, water: Math.max(0, ml) });
  clearTimeout(waterTimers[d]);
  waterTimers[d] = setTimeout(async () => {
    const value = state.days[d].water;
    try {
      await api(`/days/${d}`, { method: "PUT", body: { water: value } });
      if (state.days[d].water === value) delete waterTimers[d];
      checkBadges(d);
    } catch (err) {
      delete waterTimers[d];
      toast(err.message, "⚠️");
    }
  }, 700);
}

export async function loadWeights() {
  if (state.weights) return state.weights;
  const { weights } = await api("/weights");
  set({ weights });
  return weights;
}

export async function setWeight(d, kg) {
  const res = await api(`/days/${d}`, { method: "PUT", body: { weight: kg } });
  putDay({ ...(state.days[d] || res.day), weight: res.day.weight });
  if (state.weights) {
    const list = state.weights.filter(([x]) => x !== d);
    if (kg != null) list.push([d, res.day.weight]);
    set({ weights: list.sort((a, b) => a[0] - b[0]) });
  }
  if (kg != null && (!state.lastWeight || d >= state.lastWeight.d)) set({ lastWeight: { d, w: res.day.weight } });
  if (kg == null && "lastWeight" in res) set({ lastWeight: res.lastWeight });
  return res.day;
}

// ── Profil: nur die Änderung wird geschickt, der Server führt zusammen ──
export async function saveProfile(patch) {
  const before = state.profile;
  const merged = { ...before, ...patch };
  for (const k of Object.keys(patch)) if (patch[k] === null) delete merged[k];
  set({ profile: merged });
  try {
    const { profile } = await api("/profile", { method: "PUT", body: patch });
    set({ profile });
    return profile;
  } catch (err) {
    set({ profile: before });
    throw err;
  }
}

export const currentWeight = () => state.lastWeight?.w || state.profile.startWeight || 70;
export const currentGoals = () => goals(state.profile, currentWeight());

// ── Abzeichen: nach jeder relevanten Aktion prüfen ──
export async function checkBadges(d = state.selected, extra = {}) {
  const day = state.days[d] || emptyDay(d);
  const g = currentGoals();
  const earned = earnedBadges({
    log: day.log,
    streak: state.streak.current,
    water: day.water,
    waterGoal: g.water,
    kcalGoal: g.kcal,
    weight: state.lastWeight?.w,
    profile: state.profile,
    usedAi: extra.usedAi || day.log.some((e) => e[E.src] === "k"),
    isPast: d < today() || new Date().getHours() >= 20,
    weekDone: Array.from({ length: 7 }, (_, i) => addDays(mondayOf(today()), i)).every((x) => state.logged.has(x)),
    entries: state.entries,
  });
  const have = state.profile.badges || {};
  const fresh = earned.filter((id) => !have[id]);
  if (!fresh.length) return;
  const badges = {};
  for (const id of fresh) badges[id] = today();
  try { await saveProfile({ badges: { ...have, ...badges } }); } catch { return; /* nächstes Mal */ }
  // große Meilensteine zuerst, dann der Reihe nach
  const list = BADGES.filter((b) => fresh.includes(b.id)).sort((a, b) => (b.big ? 1 : 0) - (a.big ? 1 : 0));
  list.forEach(celebrate);
}

// ── Zuletzt verwendet: nur auf dem Gerät (spart Schreibzugriffe) ──
export function recentFoods() {
  return storage.get("recent", []);
}
export function pushRecent(food, grams) {
  const list = recentFoods().filter((f) => f.name !== food.name);
  list.unshift({ name: food.name, emoji: food.emoji, per100: food.per100, src: food.src, grams, source: food.source });
  storage.set("recent", list.slice(0, 24));
}

export async function clearLocalData() {
  storage.set("recent", []);
  await clearThumbs();
}

export async function deleteAccount() {
  await api("/me", { method: "DELETE" });
  await clearLocalData();
}
