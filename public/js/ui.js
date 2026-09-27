// Wiederverwendbare Bausteine: Sheet, Ring, Segmente, Toast, Feier, Vorschaubild …
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { html, cx, haptic, reduceMotion } from "./util.js";
import { Icon } from "./icons.js";
import { state, closeOverlay, dismissToast, closeCelebrate } from "./store.js";
import { getThumb } from "./thumbs.js";

// ── Sheet von unten, mit Griff zum Wegziehen ──
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

// Fokus in einem Dialog halten, Escape schließt, danach Fokus zurückgeben.
export function useDialogFocus(ref, id, onEscape) {
  useEffect(() => {
    const prev = document.activeElement;
    const el = ref.current;
    requestAnimationFrame(() => {
      if (el && !el.contains(document.activeElement)) (el.querySelector("[autofocus]") || el).focus({ preventScroll: true });
    });
    const onKey = (e) => {
      const top = [...state.overlays].reverse().find((o) => !o.closing);
      if (!top || top.id !== id || !el) return;
      if (e.key === "Escape") { e.preventDefault(); onEscape(); return; }
      if (e.key !== "Tab") return;
      const items = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.({ preventScroll: true }); };
  }, []);
}

export function Sheet({ id, closing, title, left, right, footer, full, children, onClose }) {
  const ref = useRef();
  const drag = useRef(null);
  const close = () => { onClose?.(); closeOverlay(id); };
  useDialogFocus(ref, id, close);

  const down = (e) => {
    if (e.target.closest("button, input, textarea, select, a")) return;
    drag.current = { y: e.clientY, t: performance.now(), dy: 0 };
    ref.current.style.transition = "none";
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drag.current) return;
    const dy = e.clientY - drag.current.y;
    drag.current.dy = dy;
    const y = dy > 0 ? dy : dy / 6;
    ref.current.style.transform = `translateY(${y}px)`;
  };
  const cancel = () => {
    if (!drag.current) return;
    drag.current = null;
    ref.current.style.transition = "transform .35s cubic-bezier(.32,.72,0,1)";
    ref.current.style.transform = "";
  };
  const up = () => {
    if (!drag.current) return;
    const { dy, t } = drag.current;
    const v = dy / Math.max(1, performance.now() - t);
    drag.current = null;
    ref.current.style.transition = "transform .35s cubic-bezier(.32,.72,0,1)";
    if (dy > 120 || (dy > 30 && v > 0.6)) {
      ref.current.style.transform = "translateY(110%)";
      setTimeout(close, 60);
    } else {
      ref.current.style.transform = "";
    }
  };

  return html`
    <div class=${cx("scrim", closing && "closing")} onClick=${close}></div>
    <section ref=${ref} tabindex="-1" class=${cx("sheet", full && "full", closing && "closing")} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-drag" onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel}>
        <div class="sheet-grab"></div>
        <div class="sheet-head">
          <div style="width:44px">${left || html`<button class="icon-btn sm fill" onClick=${close} aria-label="Schließen">${Icon.close()}</button>`}</div>
          <div class="sheet-title">${title}</div>
          <div style="width:44px;display:flex;justify-content:flex-end">${right}</div>
        </div>
      </div>
      <div class="sheet-body">${children}</div>
      ${footer && html`<div class="sheet-foot">${footer}</div>`}
    </section>`;
}

// ── Fortschrittsring (wie die Aktivitätsringe) ──
let gradId = 0;
export function Ring({ size = 200, stroke = 20, value = 0, from = "var(--kcal-a)", to = "var(--kcal-b)", children }) {
  const [id] = useState(() => "g" + ++gradId);
  const [shown, setShown] = useState(0);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(r); }, [value]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(shown, 1));
  return html`
    <div class="ring-wrap" style=${`width:${size}px;height:${size}px`}>
      <svg width=${size} height=${size} viewBox=${`0 0 ${size} ${size}`}>
        <defs><linearGradient id=${id} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color=${from}/><stop offset="1" stop-color=${to}/></linearGradient></defs>
        <circle class="ring-track" cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${stroke}/>
        <circle class="ring-bar" cx=${size / 2} cy=${size / 2} r=${r} stroke-width=${stroke}
          stroke=${`url(#${id})`} stroke-dasharray=${c} stroke-dashoffset=${c * (1 - v) + (v === 0 ? 0.001 : 0)}
          style=${v === 0 ? "opacity:0" : ""}/>
      </svg>
      <div class="ring-center">${children}</div>
    </div>`;
}

// ── Segmentierte Auswahl mit gleitendem Daumen ──
// Segmentierte Auswahl = Radiogruppe (Pfeiltasten wechseln wie bei iOS/macOS)
export function Seg({ options, value, onChange, label }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const pick = (o) => { if (o.value !== value) { haptic(); onChange(o.value); } };
  const onKey = (e) => {
    const dir = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const next = options[(idx + dir + options.length) % options.length];
    pick(next);
    requestAnimationFrame(() => e.currentTarget?.querySelector?.('[aria-checked="true"]')?.focus());
  };
  return html`
    <div class="seg" role="radiogroup" aria-label=${label} onKeyDown=${onKey}>
      <i class="seg-thumb" style=${`width:calc((100% - 6px) / ${options.length});transform:translateX(${idx * 100}%)`}></i>
      ${options.map((o) => html`<button type="button" role="radio" aria-checked=${o.value === value}
        tabindex=${o.value === value ? 0 : -1} onClick=${() => pick(o)}>${o.label}</button>`)}
    </div>`;
}

export function Bar({ value, color }) {
  const [shown, setShown] = useState(0);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(value)); return () => cancelAnimationFrame(r); }, [value]);
  return html`<div class="bar"><i style=${`width:${Math.min(100, Math.max(0, shown * 100))}%;background:${color}`}></i></div>`;
}

// ── Vorschaubild aus IndexedDB, sonst Emoji ──
export function Thumb({ id, emoji, cls = "entry-thumb" }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let alive = true;
    if (id) getThumb(id).then((s) => alive && setSrc(s));
    return () => { alive = false; };
  }, [id]);
  return html`<div class=${cls}>${src ? html`<img src=${src} alt="" loading="lazy"/>` : emoji || "🍽️"}</div>`;
}

// ── Zahl zählt hoch ──
export function CountUp({ value, format = (v) => Math.round(v).toLocaleString("de-DE"), ms = 900 }) {
  const [v, setV] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current, to = value, t0 = performance.now();
    if (from === to) return;
    if (reduceMotion()) { setV(to); prev.current = to; return; }
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (to - from) * e);
      if (p < 1) raf = requestAnimationFrame(step); else prev.current = to;
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); prev.current = to; };
  }, [value]);
  return html`<span class="num">${format(v)}</span>`;
}

// ── Kompakte Leiste beim Scrollen ──
export function useScrolled(threshold = 44) {
  const [scrolled, setScrolled] = useState(false);
  useLayoutEffect(() => {
    const on = () => setScrolled(scrollY > threshold);
    on();
    addEventListener("scroll", on, { passive: true });
    return () => removeEventListener("scroll", on);
  }, []);
  return scrolled;
}

export function NavBar({ title, show }) {
  return html`<div class=${cx("navbar", show && "show")} aria-hidden=${!show}>${title}</div>`;
}

// ── Toast ──
export function Toast() {
  const t = state.toast;
  if (!t) return null;
  return html`<div key=${t.id} class=${cx("toast glass", t.closing && "closing")} role="status" aria-live="polite">
    <span class="t-icon" aria-hidden="true">${t.icon}</span><span>${t.text}</span>
    ${t.action && html`<button class="toast-action" onClick=${() => { haptic(); t.action.run(); dismissToast(); }}>${t.action.label}</button>`}
  </div>`;
}

// ── Feier bei neuem Abzeichen: Konfetti, bei großen Meilensteinen Feuerwerk ──
export function Celebrate() {
  const badge = state.celebrate;
  const canvas = useRef();
  const btn = useRef();
  useEffect(() => {
    if (!badge) return;
    haptic(badge.big ? "big" : "success");
    const prev = document.activeElement;
    requestAnimationFrame(() => btn.current?.focus());
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); if (e.key === "Escape") closeCelebrate(); } };
    document.addEventListener("keydown", onKey);
    let stop = null;
    const t = setTimeout(() => { if (canvas.current && !reduceMotion()) stop = celebrationFx(canvas.current, badge.big); }, 160);
    return () => { clearTimeout(t); stop?.(); document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [badge]);
  if (!badge) return null;
  return html`
    <div key=${badge.id} class=${cx("celebrate", badge.big && "big")} onClick=${closeCelebrate} role="dialog" aria-modal="true" aria-labelledby="badge-title">
      <div class="medal" aria-hidden="true">${badge.e}</div>
      <div class="card glass center">
        <div class="celebrate-kicker">${badge.big ? "Großer Meilenstein" : "Neues Abzeichen"}</div>
        <div id="badge-title" style="font-size:24px;font-weight:700;margin:4px 0 6px">${badge.name}</div>
        <div class="muted">${badge.desc}</div>
        <button ref=${btn} class="btn btn-primary block" style="margin-top:16px" onClick=${(e) => { e.stopPropagation(); closeCelebrate(); }}>Weiter so!</button>
      </div>
    </div>
    <canvas id="confetti" ref=${canvas}></canvas>`;
}

// Konfetti-Burst aus der Mitte; mit big zusätzlich gut 3 s Feuerwerk.
function celebrationFx(canvas, big) {
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = innerWidth, H = innerHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches && document.documentElement.dataset.theme !== "light"
    || document.documentElement.dataset.theme === "dark";
  const colors = ["#36d67e", "#0fb3a5", "#ffb340", "#ff375f", "#8e5cff", "#0a9cff", "#f5b700"];
  const parts = [];
  const cx0 = W / 2, cy0 = H * 0.36;
  const sc = Math.max(1, Math.min(1.5, W / 520));

  const confetti = (n) => {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95, sp = (5 + Math.random() * 10) * sc;
      parts.push({ k: "c", x: cx0, y: cy0, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4,
        rot: Math.random() * 6, spin: (Math.random() - 0.5) * 0.3, flip: Math.random() * 6, fs: 0.08 + Math.random() * 0.14,
        wob: 0.05 + Math.random() * 0.1, c: colors[i % colors.length], round: Math.random() < 0.25, age: 0, life: 170 + Math.random() * 90 });
    }
  };
  const G = 0.16;
  const launch = () => {
    const apex = H * (0.12 + Math.random() * 0.28);
    const hues = [145, 45, 350, 205, 275, 25];
    parts.push({ k: "r", x: W * (0.15 + Math.random() * 0.7), y: H, vx: (Math.random() - 0.5) * 1.4,
      vy: -Math.sqrt(2 * G * (H - apex)), h: hues[(Math.random() * hues.length) | 0], age: 0 });
  };
  const explode = (p) => {
    const n = 70, s = Math.max(0.8, Math.min(1.6, W / 560));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.12, sp = (1.4 + Math.random() * 3.6) * s;
      parts.push({ k: "s", x: p.x, y: p.y, px: p.x, py: p.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, h: p.h + (Math.random() - 0.5) * 30, age: 0, life: 55 + Math.random() * 40 });
    }
  };

  confetti(Math.round((big ? 80 : 110) + W / (big ? 10 : 8)));
  const fwUntil = big ? performance.now() + 3200 : 0;
  let nextRocket = 0, raf;
  const tick = () => {
    const now = performance.now();
    ctx.clearRect(0, 0, W, H);
    if (now < fwUntil && now > nextRocket) { launch(); nextRocket = now + 240 + Math.random() * 280; }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age++;
      if (p.k === "r") {
        const px = p.x, py = p.y;
        p.vy += G; p.x += p.vx; p.y += p.vy;
        ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
        ctx.strokeStyle = `hsla(${p.h},100%,${dark ? 75 : 55}%,.9)`; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(px - p.vx * 3, py - p.vy * 3); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (p.vy >= -0.6) { explode(p); parts.splice(i, 1); }
        continue;
      }
      if (p.k === "s") {
        p.px = p.x; p.py = p.y; p.vx *= 0.965; p.vy = p.vy * 0.965 + 0.06; p.x += p.vx; p.y += p.vy;
        const a = 1 - p.age / p.life;
        if (a <= 0) { parts.splice(i, 1); continue; }
        ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
        ctx.strokeStyle = `hsla(${p.h},100%,${dark ? 55 + 25 * a : 48 + 10 * a}%,${a})`;
        ctx.lineWidth = 2.2 * a + 0.6;
        ctx.beginPath(); ctx.moveTo(p.px - p.vx * 2.5, p.py - p.vy * 2.5); ctx.lineTo(p.x, p.y); ctx.stroke();
        continue;
      }
      p.vx *= 0.985; p.vy = p.vy * 0.985 + 0.22;
      p.x += p.vx + Math.sin(p.age * p.wob) * 0.7; p.y += p.vy; p.rot += p.spin; p.flip += p.fs;
      if (p.y > H + 30 || p.age > p.life) { parts.splice(i, 1); continue; }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = Math.min(1, (p.life - p.age) / 30);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.scale(1, Math.cos(p.flip)); ctx.fillStyle = p.c;
      if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2.4, 0, 7); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore(); ctx.globalAlpha = 1;
    }
    if (parts.length || now < fwUntil) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, W, H); };
}

export function Empty({ e, title, text, children }) {
  return html`<div class="empty"><div class="e">${e}</div>
    <div style="font-weight:600;color:var(--text)">${title}</div>
    ${text && html`<div style="font-size:15px;margin-top:4px">${text}</div>`}${children}</div>`;
}
