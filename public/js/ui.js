// Wiederverwendbare Bausteine: Sheet, Ring, Segmente, Toast, Feier, Vorschaubild …
import { useEffect, useRef, useState, useLayoutEffect } from "preact/hooks";
import { html, cx, haptic, reduceMotion } from "./util.js";
import { Icon } from "./icons.js";
import { state, set, closeOverlay, dismissToast } from "./store.js";
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

// ── Feier bei neuem Abzeichen (mit Konfetti) ──
export function Celebrate() {
  const badge = state.celebrate;
  const canvas = useRef();
  const btn = useRef();
  useEffect(() => {
    if (!badge) return;
    haptic("success");
    const prev = document.activeElement;
    requestAnimationFrame(() => btn.current?.focus());
    const onKey = (e) => { if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); if (e.key === "Escape") set({ celebrate: null }); } };
    document.addEventListener("keydown", onKey);
    const stop = canvas.current && !reduceMotion() ? confetti(canvas.current) : null;
    return () => { stop?.(); document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [badge]);
  if (!badge) return null;
  const close = () => set({ celebrate: null });
  return html`
    <div class="celebrate" onClick=${close} role="dialog" aria-modal="true" aria-labelledby="badge-title">
      <div class="medal" aria-hidden="true">${badge.e}</div>
      <div class="card glass center">
        <div class="muted" style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.06em">Neues Abzeichen</div>
        <div id="badge-title" style="font-size:24px;font-weight:700;margin:4px 0 6px">${badge.name}</div>
        <div class="muted">${badge.desc}</div>
        <button ref=${btn} class="btn btn-primary block" style="margin-top:16px" onClick=${close}>Weiter so!</button>
      </div>
    </div>
    <canvas id="confetti" ref=${canvas}></canvas>`;
}

function confetti(canvas) {
  const ctx = canvas.getContext("2d");
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#36d67e", "#0fb3a5", "#ffb340", "#ff375f", "#8e5cff", "#0a9cff", "#f5b700"];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2, y: innerHeight * 0.38,
    vx: (Math.random() - 0.5) * 13, vy: -Math.random() * 13 - 4,
    s: 5 + Math.random() * 6, r: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
    c: colors[(Math.random() * colors.length) | 0], shape: Math.random() > 0.5,
  }));
  let raf, frames = 0;
  const tick = () => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.32; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
      if (p.shape) ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      else { ctx.beginPath(); ctx.arc(0, 0, p.s / 2.4, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (++frames < 200) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function Empty({ e, title, text, children }) {
  return html`<div class="empty"><div class="e">${e}</div>
    <div style="font-weight:600;color:var(--text)">${title}</div>
    ${text && html`<div style="font-size:15px;margin-top:4px">${text}</div>`}${children}</div>`;
}
