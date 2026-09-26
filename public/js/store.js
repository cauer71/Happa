// Zentraler Zustand + Aktionen. Bewusst schlicht: ein Objekt, Abonnenten werden
// bei jeder Änderung benachrichtigt, Komponenten lesen per useStore().

import { useLayoutEffect, useReducer, useRef } from "preact/hooks";
import { api } from "./api.js";
import { today, addDays, storage, uid, haptic } from "./util.js";
import { goals, earnedBadges, BADGES, E } from "./nutrition.js";
import { putThumb, deleteThumb, clearThumbs } from "./thumbs.js";

export const state = {
  phase: "boot",          // boot | onboarding | app | error
  error: null,
  email: "",
  profile: {},
  days: {},               // JJJJMMTT → { d, log, water, weight, ai }
  selected: today(),
  streak: { current: 0, best: 0 },
  serverStreak: 0,
  logged: new Set(),      // Tage mit Einträgen (letzte ~60 Tage + lokale Änderungen)
  lastWeight: null,       // { d, w }
  aiLimit: 40,
  tab: "heute",
  overlays: [],           // [{ id, render, closing }]
  toast: null,
  celebrate: null,
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
  if (state.tab === tab) { scrollTo({ top: 0, behavior: "smooth" }); return; }
  haptic();
  set({ tab });
  scrollTo(0, 0);
  history.replaceState(history.state, "", "#" + tab);
}

export const emptyDay = (d) => ({ d, log: [], water: 0, weight: null, ai: 0 });
const putDay = (day) => set({ days: { ...state.days, [day.d]: day } });

// ── Overlays (Sheets, Kamera) mit Zurück-Taste ──
let ignorePop = 0;
export function openOverlay(render) {
  const id = uid();
  set({ overlays: [...state.overlays, { id, render, closing: false }] });
  history.pushState({ overlay: id }, "");
  return id;
}
export function closeOverlay(id, fromPop = false) {
  const o = state.overlays.find((x) => x.id === id);
  if (!o || o.closing) return;
  set({ overlays: state.overlays.map((x) => (x.id === id ? { ...x, closing: true } : x)) });
  setTimeout(() => set({ overlays: state.overlays.filter((x) => x.id !== id) }), 320);
  if (!fromPop && history.state?.overlay === id) { ignorePop++; history.back(); }
}
export const closeAll = () => [...state.overlays].reverse().forEach((o) => closeOverlay(o.id));
addEventListener("popstate", () => {
  if (ignorePop) { ignorePop--; return; }
  const top = [...state.overlays].reverse().find((o) => !o.closing);
  if (top) closeOverlay(top.id, true);
});

// ── Mitteilungen ──
let toastTimer;
export function toast(text, icon = "✓") {
  clearTimeout(toastTimer);
  set({ toast: { id: uid(), text, icon, closing: false } });
  toastTimer = setTimeout(() => {
    set({ toast: state.toast && { ...state.toast, closing: true } });
    toastTimer = setTimeout(() => set({ toast: null }), 300);
  }, 2600);
}
export const celebrate = (badge) => set({ celebrate: badge });

// ── Laden ──
export async function boot() {
  try {
    const d = today();
    const me = await api(`/me?d=${d}`);
    const logged = new Set(me.logged);
    set({
      email: me.email,
      profile: me.profile || {},
      days: { [d]: me.day },
      selected: d,
      serverStreak: me.streak.current,
      streak: me.streak,
      logged,
      lastWeight: me.lastWeight,
      aiLimit: me.aiLimit,
      phase: me.profile && me.profile.startWeight ? "app" : "onboarding",
    });
  } catch (err) {
    if (err.status !== 401) set({ phase: "error", error: err.message });
  }
}

export async function loadDay(d, force = false) {
  if (state.days[d] && !force) return state.days[d];
  const { days } = await api(`/days?from=${d}&to=${d}`);
  const day = days[0] || emptyDay(d);
  putDay(day);
  return day;
}

export async function loadRange(from, to) {
  const { days } = await api(`/days?from=${from}&to=${to}`);
  const map = { ...state.days };
  for (let d = from; d <= to; d = addDays(d, 1)) if (!map[d]) map[d] = emptyDay(d);
  for (const day of days) map[day.d] = day;
  set({ days: map });
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

// ── Einträge ──
export async function addEntries(d, entries, thumb) {
  const before = state.days[d] || emptyDay(d);
  const optimistic = { ...before, log: [...before.log, ...entries] };
  putDay(optimistic);
  markLogged(optimistic);
  try {
    let day = optimistic;
    for (const entry of entries) {
      day = (await api(`/days/${d}/entries`, { method: "POST", body: entry })).day;
      if (thumb) putThumb(entry[E.id], thumb);
    }
    putDay(day);
    markLogged(day);
    return day;
  } catch (err) {
    putDay(before);
    markLogged(before);
    throw err;
  }
}

export async function updateEntry(d, entry) {
  const before = state.days[d];
  putDay({ ...before, log: before.log.map((e) => (e[E.id] === entry[E.id] ? entry : e)) });
  try {
    const { day } = await api(`/days/${d}/entries/${entry[E.id]}`, { method: "PUT", body: entry });
    putDay(day);
  } catch (err) {
    putDay(before);
    throw err;
  }
}

export async function removeEntry(d, id) {
  const before = state.days[d];
  const optimistic = { ...before, log: before.log.filter((e) => e[E.id] !== id) };
  putDay(optimistic);
  markLogged(optimistic);
  try {
    const { day } = await api(`/days/${d}/entries/${id}`, { method: "DELETE" });
    putDay(day);
    markLogged(day);
    deleteThumb(id);
  } catch (err) {
    putDay(before);
    markLogged(before);
    throw err;
  }
}

// Wasser: schnelles Tippen wird gebündelt, gespeichert wird der letzte Stand.
const waterTimers = {};
export function setWater(d, ml) {
  const day = state.days[d] || emptyDay(d);
  putDay({ ...day, water: Math.max(0, ml) });
  clearTimeout(waterTimers[d]);
  waterTimers[d] = setTimeout(async () => {
    try {
      const res = await api(`/days/${d}`, { method: "PUT", body: { water: state.days[d].water } });
      putDay({ ...res.day, log: state.days[d].log });
      checkBadges(d);
    } catch (err) { toast(err.message, "⚠️"); }
  }, 700);
}

export async function setWeight(d, kg) {
  const { day } = await api(`/days/${d}`, { method: "PUT", body: { weight: kg } });
  putDay(day);
  if (kg != null && (!state.lastWeight || d >= state.lastWeight.d)) set({ lastWeight: { d, w: kg } });
  if (kg == null && state.lastWeight?.d === d) {
    const { weights } = await api("/weights");
    const last = weights[weights.length - 1];
    set({ lastWeight: last ? { d: last[0], w: last[1] } : null });
  }
  return day;
}

// ── Profil ──
export async function saveProfile(patch) {
  const profile = { ...state.profile, ...patch };
  set({ profile });
  await api("/profile", { method: "PUT", body: profile });
  return profile;
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
  });
  const have = state.profile.badges || {};
  const fresh = earned.filter((id) => !have[id]);
  if (!fresh.length) return;
  const badges = { ...have };
  for (const id of fresh) badges[id] = today();
  try { await saveProfile({ badges }); } catch { /* nächster Versuch beim nächsten Mal */ }
  celebrate(BADGES.find((b) => b.id === fresh[0]));
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

export async function deleteAccount() {
  await api("/me", { method: "DELETE" });
  storage.set("recent", []);
  await clearThumbs();
}
