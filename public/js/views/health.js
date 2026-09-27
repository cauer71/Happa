// TEST: Aktivität aus Apple Health über die iPhone-App „Health Auto Export“.
// Einrichtung (Schlüssel, Anleitung, Status) und die Karte „Verbrauch“ auf „Heute“.
import { useState, useEffect } from "preact/hooks";
import { html, cx, haptic, n0 } from "../util.js";
import { Icon } from "../icons.js";
import { openOverlay, toast, state, set } from "../store.js";
import { Sheet } from "../ui.js";
import { api } from "../api.js";
import { totals } from "../nutrition.js";

const IMPORT_URL = "https://happa-mcp.auer.page/health/import";
const HEADER = "X-Happa-Key";

async function copy(text, label) {
  haptic();
  try { await navigator.clipboard.writeText(text); toast(`${label} kopiert`, "📋"); }
  catch { toast(text, "📋"); }
}

const workoutEmoji = (name) => {
  const n = String(name).toLowerCase();
  if (/lauf|run|jog/.test(n)) return "🏃";
  if (/rad|cycl|bike|velo/.test(n)) return "🚴";
  if (/schwimm|swim/.test(n)) return "🏊";
  if (/wander|hik|walk|geh/.test(n)) return "🥾";
  if (/ski|snow/.test(n)) return "⛷️";
  if (/yoga|pilates/.test(n)) return "🧘";
  if (/kraft|strength|weight|functional|hiit/.test(n)) return "🏋️";
  if (/tennis|padel|badminton/.test(n)) return "🎾";
  if (/fußball|soccer|football/.test(n)) return "⚽";
  return "💪";
};

// Tageswerte aus days.act: mit und ohne Sport
export function energyOf(act) {
  if (!act) return null;
  const basal = act.b || 0, active = act.a || 0;
  const sport = (act.w || []).reduce((s, w) => s + (w[2] || 0), 0);
  const total = basal + active;
  return { basal, active, sport, everyday: Math.max(0, active - sport), total, withoutSport: Math.max(0, total - sport), steps: act.s || 0, workouts: act.w || [], at: act.t };
}

// ── Karte auf „Heute“ ──
export function EnergyCard({ day, isToday }) {
  const e = energyOf(day.act);
  if (!e || (!e.total && !e.workouts.length)) return null;
  const eaten = totals(day.log).kcal;
  const max = Math.max(1, e.total);
  const seg = (v) => `${Math.max(0, (v / max) * 100)}%`;
  const balance = eaten - e.total;
  return html`
    <section class="card energy" aria-label="Verbrauch aus Apple Health">
      <div class="row between" style="align-items:flex-start">
        <div>
          <div class="energy-kicker">Verbrauch ${isToday ? "bisher" : ""} · Apple Health</div>
          <div class="energy-total"><span class="num">${n0(e.total)}</span> <small>kcal</small></div>
          <div class="muted" style="font-size:14px">${e.sport ? html`ohne Sport <b class="num">${n0(e.withoutSport)}</b> kcal` : "kein Sport erfasst"}</div>
        </div>
        ${e.steps > 0 && html`<div class="energy-steps"><b class="num">${n0(e.steps)}</b><span>Schritte</span></div>`}
      </div>
      <div class="energy-bar" role="img" aria-label=${`Grundumsatz ${n0(e.basal)}, Alltag ${n0(e.everyday)}, Sport ${n0(e.sport)} kcal`}>
        <i class="b" style=${`width:${seg(e.basal)}`}></i><i class="a" style=${`width:${seg(e.everyday)}`}></i><i class="s" style=${`width:${seg(e.sport)}`}></i>
      </div>
      <div class="energy-legend">
        <span><i class="b"></i>Grundumsatz <b class="num">${n0(e.basal)}</b></span>
        <span><i class="a"></i>Alltag <b class="num">${n0(e.everyday)}</b></span>
        <span><i class="s"></i>Sport <b class="num">${n0(e.sport)}</b></span>
      </div>
      ${e.workouts.length > 0 && html`<div class="energy-workouts">${e.workouts.map((w) => html`
        <div class="energy-workout"><span aria-hidden="true">${workoutEmoji(w[0])}</span><span class="grow">${w[0]}${w[3] ? html` <small class="muted">${w[3]}</small>` : ""}</span>
          <span class="muted num">${w[1]} min</span><b class="num">${n0(w[2])} kcal</b></div>`)}</div>`}
      ${eaten > 0 && e.basal > 0 && html`<div class="energy-balance">Gegessen <b class="num">${n0(eaten)}</b> kcal · Bilanz
        <b class=${cx("num", balance > 0 ? "over" : "under")}>${balance > 0 ? "+" : "−"}${n0(Math.abs(balance))}</b> kcal</div>`}
    </section>`;
}

// ── Einrichtung ──
export function openHealth() {
  haptic();
  openOverlay((o) => html`<${HealthSheet} ...${o}/>`);
}

function HealthSheet({ id, closing }) {
  const [info, setInfo] = useState(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState("");

  const load = () => api("/health").then(setInfo).catch((err) => toast(err.message, "⚠️"));
  useEffect(() => { load(); }, []);

  const newKey = async () => {
    if (info?.hasKey && confirm !== "key") { haptic(); setConfirm("key"); return; }
    setBusy(true); setConfirm("");
    try { const r = await api("/health/key", { method: "POST", body: {} }); setKey(r.key); haptic("success"); await load(); }
    catch (err) { toast(err.message, "⚠️"); }
    setBusy(false);
  };
  const removeKey = async () => {
    if (confirm !== "del") { haptic(); setConfirm("del"); return; }
    setBusy(true); setConfirm("");
    try { await api("/health/key", { method: "DELETE" }); setKey(""); toast("Schlüssel gelöscht – Health Auto Export kann nichts mehr senden", "🔒"); await load(); }
    catch (err) { toast(err.message, "⚠️"); }
    setBusy(false);
  };
  const removeData = async () => {
    if (confirm !== "data") { haptic(); setConfirm("data"); return; }
    setBusy(true); setConfirm("");
    try {
      await api("/health/data", { method: "DELETE" });
      const days = { ...state.days };
      for (const d of Object.keys(days)) days[d] = { ...days[d], act: null };
      set({ days });
      toast("Importierte Aktivitäten entfernt", "🗑️"); await load();
    } catch (err) { toast(err.message, "⚠️"); }
    setBusy(false);
  };

  const last = info?.last;
  const fmt = (t) => new Date(t).toLocaleString("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  const dstr = (d) => d ? `${d % 100}.${Math.floor(d / 100) % 100}.` : "";

  return html`
    <${Sheet} id=${id} closing=${closing} title="Apple Health (Test)" full>
      <p class="muted" style="margin:0 0 12px;font-size:15px">Die iPhone-App <b>Health Auto Export</b> schickt deine Aktivität an Happa. Daraus zeigt Happa den täglichen Verbrauch – mit und ohne Sport.</p>

      <div class="label">Status</div>
      <section class="card health-status">
        ${!info ? html`<span class="spinner"></span>` : html`
          <div class="row between"><span>Schlüssel</span><b>${info.hasKey ? `aktiv seit ${fmt(info.created)}` : "noch keiner"}</b></div>
          <div class="row between"><span>Letzter Import</span><b>${last ? fmt(last.at) : "noch keiner"}</b></div>
          ${last && html`<div class="muted" style="font-size:14px">${last.days} ${last.days === 1 ? "Tag" : "Tage"}${last.from ? ` (${dstr(last.from)}–${dstr(last.to)})` : ""} · ${last.metrics?.length ? last.metrics.join(", ") : "keine Metriken"} · ${last.workouts || 0} Workouts${last.note ? " · " + last.note : ""}</div>`}
          <button class="link-btn" onClick=${() => { haptic(); load(); }}>${Icon.refresh()} Aktualisieren</button>`}
      </section>

      ${key && html`
        <div class="info-box warn" style="margin-top:14px">Dein Schlüssel – er wird <b>nur jetzt</b> angezeigt. Kopiere ihn in Health Auto Export.</div>
        <button class="cg-url" style="margin-top:8px" onClick=${() => copy(key, "Schlüssel")} aria-label="Schlüssel kopieren"><code>${key}</code><span>Kopieren</span></button>
        <div class="label" style="margin-top:12px">Am einfachsten: Adresse mit Schlüssel</div>
        <p class="muted" style="margin:0 0 6px;font-size:14px">Diese Adresse als <b>URL</b> in Health Auto Export eintragen – dann braucht es keinen Header.</p>
        <button class="cg-url" onClick=${() => copy(`${IMPORT_URL}/${key}`, "Adresse mit Schlüssel")} aria-label="Adresse mit Schlüssel kopieren"><code>${IMPORT_URL}/${key.slice(0, 8)}…</code><span>Kopieren</span></button>`}

      <div class="row" style="gap:10px;margin-top:14px">
        <button class=${cx("btn grow", info?.hasKey ? "btn-glass" : "btn-primary", confirm === "key" && "danger-soft")} disabled=${busy} onClick=${newKey}>
          ${confirm === "key" ? "Alten ersetzen?" : info?.hasKey ? "Neuer Schlüssel" : "Schlüssel erzeugen"}</button>
        ${info?.hasKey && html`<button class=${cx("btn btn-glass", confirm === "del" && "danger-soft")} disabled=${busy} onClick=${removeKey}>${confirm === "del" ? "Wirklich?" : "Löschen"}</button>`}
      </div>

      <div class="label">In Health Auto Export einrichten</div>
      <ol class="health-steps">
        <li>Unten auf <b>Automations</b> tippen, dann <b>+</b> (neue Automation), Typ <b>REST API</b>.</li>
        <li><b>URL</b>: <button class="cg-url" style="margin-top:6px" onClick=${() => copy(IMPORT_URL, "Adresse")}><code>${IMPORT_URL}</code><span>Kopieren</span></button></li>
        <li><b>Schlüssel</b>: entweder die <b>Adresse mit Schlüssel</b> von oben als URL verwenden (einfachste Variante) – oder unter <b>Headers</b> einen Header anlegen: Name <button class="chip" onClick=${() => copy(HEADER, "Header-Name")}>${HEADER}</button>, Wert: dein Schlüssel. Danach die Automation speichern.</li>
        <li><b>Data Type</b>: <b>Health Metrics</b>, darin <b>Active Energy</b>, <b>Resting Energy</b> und <b>Step Count</b> wählen.</li>
        <li><b>Export Format</b> JSON, <b>Aggregate Data</b> an mit Intervall <b>Days</b>, <b>Date Range</b> z. B. <b>Previous 7 Days</b> (ersetzt die Tageswerte, nichts wird doppelt).</li>
        <li>Zweite Automation genauso, aber Data Type <b>Workouts</b> – ohne Routen- und Workout-Detaildaten.</li>
        <li>Bei <b>Sync Cadence</b> z. B. stündlich wählen und zum Testen einmal <b>manuell ausführen</b>. Oben unter „Status“ erscheint dann der Import.</li>
      </ol>
      <p class="fine">Die Bezeichnungen können je nach App-Version leicht abweichen. Ohne Sport = Grundumsatz + aktive Energie − Workouts. Jeder Upload höchstens 1 MB.</p>

      <button class=${cx("btn block fav-delete", confirm === "data" && "confirm")} style="margin-top:14px" disabled=${busy} onClick=${removeData}>
        ${Icon.trash()} ${confirm === "data" ? "Wirklich alle Aktivitäten entfernen?" : "Importierte Aktivitäten entfernen"}</button>
    </${Sheet}>`;
}
