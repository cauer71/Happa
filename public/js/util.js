import { h } from "preact";
import htm from "htm";

export const html = htm.bind(h);

// ── Datum: überall als Zahl JJJJMMTT im lokalen Kalender ──
export const toInt = (date) => date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
export const fromInt = (d) => new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100, 12);
export const today = () => toInt(new Date());
export const addDays = (d, n) => { const x = fromInt(d); x.setDate(x.getDate() + n); return toInt(x); };
export const diffDays = (a, b) => Math.round((fromInt(a) - fromInt(b)) / 86400000);
export const mondayOf = (d) => { const x = fromInt(d); const wd = (x.getDay() + 6) % 7; return addDays(d, -wd); };

const fmtLong = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
const fmtWd = new Intl.DateTimeFormat("de-DE", { weekday: "short" });
export const longDate = (d) => fmtLong.format(fromInt(d));
export const shortDate = (d) => fmtShort.format(fromInt(d));
export const monthYear = (date) => fmtMonth.format(date);
export const weekdayShort = (d) => fmtWd.format(fromInt(d)).replace(".", "");

export function dayTitle(d) {
  const t = today();
  if (d === t) return "Heute";
  if (d === addDays(t, -1)) return "Gestern";
  if (d === addDays(t, 1)) return "Morgen";
  return new Intl.DateTimeFormat("de-DE", { weekday: "long" }).format(fromInt(d));
}

// ── Zahlen ──
const nf0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });
export const n0 = (v) => nf0.format(Math.round(v || 0));
// Liter aus ml mit bis zu 2 Nachkommastellen: 250 ml → „0,25“, 2.250 ml → „2,25“
export const liters = (ml) => String(Math.round((ml || 0) / 10) / 100).replace(".", ",");
export const n1 = (v) => nf1.format(Math.round((v || 0) * 10) / 10);
export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const parseNum = (s) => {
  const v = parseFloat(String(s).replace(",", "."));
  return Number.isFinite(v) ? v : NaN;
};

export const uid = () => (Date.now().toString(36) + Math.random().toString(36).slice(2, 6)).slice(0, 14);

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const cx = (...parts) => parts.filter(Boolean).join(" ");

// ── Haptisches Feedback ──
// Android: Vibration-API. iOS (ab 18): Das Umschalten eines <input switch>
// über sein Label löst die System-Haptik aus.
export function haptic(kind = "light") {
  try {
    if (navigator.vibrate) {
      navigator.vibrate(kind === "big" ? [30, 60, 30, 60, 30, 60, 120] : kind === "success" ? [20, 40, 30] : kind === "heavy" ? 22 : 9);
      return;
    }
    document.getElementById("haptic")?.click();
  } catch { /* egal */ }
}

// ── Bilder verkleinern (vor dem Senden an die KI) ──
export function drawScaled(source, maxSide, quality = 0.82) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const hgt = source.videoHeight || source.naturalHeight || source.height;
  const scale = Math.min(1, maxSide / Math.max(w, hgt));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(hgt * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

// Quadratisches Vorschaubild (Mitte) für die Einträge
export function squareThumb(source, size = 160) {
  const w = source.videoWidth || source.naturalWidth || source.width;
  const hgt = source.videoHeight || source.naturalHeight || source.height;
  const side = Math.min(w, hgt);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  canvas.getContext("2d").drawImage(source, (w - side) / 2, (hgt - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Bild konnte nicht geladen werden")); };
    img.src = url;
  });
}

export const initials = (name, email) => {
  const src = (name || email || "?").trim();
  const parts = src.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (name && parts[1] ? parts[1][0] : "")).toUpperCase();
};

export const storage = {
  get(key, fallback) {
    try { const v = localStorage.getItem("happa." + key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem("happa." + key, JSON.stringify(value)); } catch { /* voll oder gesperrt */ }
  },
};

export const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Erscheinungsbild: automatisch / hell / dunkel – auch die Farbe der Statusleiste folgt
const THEME_COLORS = { light: "#eef1f5", dark: "#000000" };
export function applyTheme(theme) {
  const root = document.documentElement;
  const metas = document.querySelectorAll('meta[name="theme-color"]');
  if (theme === "light" || theme === "dark") {
    root.dataset.theme = theme;
    metas.forEach((m) => { m.dataset.media ??= m.media; m.removeAttribute("media"); m.content = THEME_COLORS[theme]; });
  } else {
    delete root.dataset.theme;
    metas.forEach((m) => {
      if (m.dataset.media) m.media = m.dataset.media;
      m.content = m.media.includes("dark") ? THEME_COLORS.dark : THEME_COLORS.light;
    });
  }
}
