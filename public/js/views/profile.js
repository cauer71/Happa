// Tab „Profil“: Ziele, Körperdaten, Erscheinungsbild, Export, Abmelden, Konto löschen.
import { useState } from "preact/hooks";
import { html, cx, haptic, n0, n1, parseNum, initials, today } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, openOverlay, closeOverlay, saveProfile, toast, currentGoals, currentWeight, deleteAccount, clearLocalData, state } from "../store.js";
import { Sheet, Seg, NavBar, useScrolled } from "../ui.js";
import { ACTIVITY, SEXES, PACES, plan, bmi } from "../nutrition.js";
import { BadgesCard } from "./progress.js";
import { ClaudeCard } from "../claude.js";
import { openHelp } from "./help.js";
import { openHealth } from "./health.js";

const SPLITS = [
  { id: "balanced", name: "Ausgewogen", split: { carbs: 50, protein: 20, fat: 30 }, desc: "Empfehlung der DGE" },
  { id: "protein", name: "Eiweißreich", split: { carbs: 40, protein: 30, fat: 30 }, desc: "Sättigt gut, schützt Muskeln" },
  { id: "lowcarb", name: "Low Carb", split: { carbs: 25, protein: 30, fat: 45 }, desc: "Weniger Kohlenhydrate" },
];
const splitName = (s) => SPLITS.find((x) => JSON.stringify(x.split) === JSON.stringify(s || SPLITS[0].split))?.name || "Eigene";

export function ProfileView() {
  const s = useStore();
  const scrolled = useScrolled();
  const p = s.profile;
  const g = currentGoals();
  const act = ACTIVITY.find((a) => a.id === p.activity);

  const row = (icon, color, label, value, onClick) => html`
    <button class="list-row" onClick=${() => { haptic(); onClick(); }}>
      <span class="list-icon" style=${`background:${color}`}>${icon}</span>
      <span class="grow">${label}</span>
      <span class="list-value">${value}</span>
      <span class="chev">${Icon.chevron()}</span>
    </button>`;

  return html`
    <${NavBar} title="Profil" show=${scrolled}/>
    <main class="page">
      <header class="header"><h1 class="large-title">Profil</h1></header>
      <div class="grid-2">
        <div class="stack fade-list">
          <section class="card center" style="padding:22px 16px">
            <div class="avatar xl" style="margin:0 auto">${initials(p.name, s.email)}</div>
            <div style="font-size:22px;font-weight:700;margin-top:10px">${p.name || "Ohne Namen"}</div>
            <div class="muted" style="font-size:15px">${s.email.startsWith("service:") ? "Service-Zugang" : s.email}</div>
            <div class="row" style="justify-content:center;gap:26px;margin-top:16px">
              <div><div class="kpi" style="font-size:22px">${s.streak.best}</div><div class="muted" style="font-size:12px">Rekord-Serie</div></div>
              <div><div class="kpi" style="font-size:22px">${Object.keys(p.badges || {}).length}</div><div class="muted" style="font-size:12px">Abzeichen</div></div>
              <div><div class="kpi" style="font-size:22px">${n1(bmi(currentWeight(), p.height || 170))}</div><div class="muted" style="font-size:12px">BMI</div></div>
            </div>
          </section>

          <${BadgesCard}/>

          <div>
            <div class="section-title">Ziele</div>
            <section class="card list">
              ${row("🔥", "var(--accent)", "Kalorienziel", `${n0(g.kcal)} kcal${p.kcalGoal ? "" : " · auto"}`, () => openGoals())}
              ${row("🎯", "var(--weight)", "Zielgewicht", p.goalWeight ? `${n1(p.goalWeight)} kg` : "–", () => openTarget())}
              ${row("🥗", "var(--carbs)", "Nährstoffe", splitName(p.split), () => openGoals())}
              ${row("💧", "var(--water)", "Wasser", `${n1(g.water / 1000)} l`, () => openGoals())}
            </section>
          </div>

          <div>
            <div class="section-title">Körperdaten</div>
            <section class="card list">
              ${row("👤", "#8e8e93", "Name", p.name || "–", () => openBody())}
              ${row("📏", "#34aadc", "Größe", `${p.height || "–"} cm`, () => openBody())}
              ${row("🎂", "#ff9500", "Geburtsjahr", p.born || "–", () => openBody())}
              ${row(act?.e || "🚶", "#5ac8fa", "Aktivität", act?.name || "–", () => openBody())}
            </section>
          </div>
        </div>

        <div class="stack fade-list">
          <div>
            <div class="section-title">Darstellung</div>
            <section class="card">
              <${Seg} label="Erscheinungsbild" options=${[{ value: "auto", label: "Automatisch" }, { value: "light", label: "Hell" }, { value: "dark", label: "Dunkel" }]}
                value=${p.theme || "auto"} onChange=${(v) => saveProfile({ theme: v }).catch((e) => toast(e.message, "⚠️"))}/>
            </section>
          </div>

          <${ClaudeCard}/>

          <div>
            <div class="section-title">Daten</div>
            <section class="card list">
              <a class="list-row" href="/api/export" download="happa-export.json" style="color:inherit;text-decoration:none">
                <span class="list-icon" style="background:#34c759">${Icon.download()}</span><span class="grow">Daten exportieren</span><span class="chev">${Icon.chevron()}</span>
              </a>
              <button class="list-row" onClick=${async () => { haptic(); await clearLocalData().catch(() => {}); location.href = "/cdn-cgi/access/logout"; }}>
                <span class="list-icon" style="background:#8e8e93">${Icon.logout()}</span><span class="grow">Abmelden</span><span class="chev">${Icon.chevron()}</span>
              </button>
              <button class="list-row" onClick=${() => { haptic(); openDelete(); }}>
                <span class="list-icon" style="background:var(--danger)">${Icon.trash()}</span><span class="grow" style="color:var(--danger)">Konto und Daten löschen</span>
              </button>
            </section>
          </div>

          <div>
            <div class="section-title">Aktivität</div>
            <section class="card list">
              <button class="list-row" onClick=${openHealth}>
                <span class="list-icon" style="background:#ff2d55">❤️</span>
                <span class="grow">Apple Health (Test)</span>
                <span class="chev">${Icon.chevron()}</span>
              </button>
            </section>
          </div>

          <div>
            <div class="section-title">Hilfe</div>
            <section class="card list">
              <button class="list-row" onClick=${() => openHelp()}>
                <span class="list-icon" style="background:#34aadc">${Icon.info()}</span>
                <span class="grow">Hilfe und Anleitungen</span>
                <span class="chev">${Icon.chevron()}</span>
              </button>
            </section>
          </div>

          <div>
            <div class="section-title">Über Happa</div>
            <section class="card" style="font-size:14px;line-height:1.5">
              <p style="margin:0 0 8px"><b>So funktioniert’s:</b> Happa berechnet deinen Bedarf nach der Mifflin-St-Jeor-Formel und plant höchstens 0,5 kg Abnahme pro Woche – das gilt als gesund und nachhaltig. Das Wichtigste ist einfaches, regelmäßiges Eintragen.</p>
              <p class="muted" style="margin:0 0 8px">Fotos werden nur zur Erkennung an die Cloudflare-KI geschickt und nicht gespeichert. Vorschaubilder bleiben auf deinem Gerät.</p>
              <p class="muted" style="margin:0">Daten: <a href="https://blsdb.de" target="_blank" rel="noopener">Bundeslebensmittelschlüssel 4.0</a> (Max Rubner-Institut, CC BY 4.0) und <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a> (ODbL). Happa ersetzt keine ärztliche Beratung.</p>
            </section>
          </div>
        </div>
      </div>
    </main>`;
}

// ── Ziele: Kalorien, Nährstoffverteilung, Wasser ──
function openGoals() { openOverlay((o) => html`<${GoalsSheet} ...${o}/>`); }
function GoalsSheet({ id, closing }) {
  const p = state.profile;
  const auto = plan(p, currentWeight());
  const [custom, setCustom] = useState(!!p.kcalGoal);
  const [kcal, setKcal] = useState(String(p.kcalGoal || auto.kcal));
  const [split, setSplit] = useState(p.split || SPLITS[0].split);
  const [water, setWater] = useState(p.waterGoal || auto.water);
  const [busy, setBusy] = useState(false);
  const k = parseNum(kcal);
  const valid = !custom || (k >= 1000 && k <= 6000);

  const save = async () => {
    setBusy(true);
    try {
      await saveProfile({ kcalGoal: custom ? Math.round(k) : null, split, waterGoal: water === auto.water ? null : water });
      toast("Ziele gespeichert", "🎯");
      closeOverlay(id);
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Ziele" footer=${html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${save}>Speichern</button>`}>
      <div class="card" style="background:var(--fill);box-shadow:none">
        <div class="row between"><span class="muted">Grundumsatz</span><b class="num">${n0(auto.bmr)} kcal</b></div>
        <div class="row between" style="margin-top:6px"><span class="muted">Gesamtumsatz</span><b class="num">${n0(auto.tdee)} kcal</b></div>
        <div class="row between" style="margin-top:6px"><span class="muted">Empfohlenes Ziel</span><b class="num" style="color:var(--accent)">${n0(auto.kcal)} kcal</b></div>
        ${auto.floored && html`<div class="muted" style="font-size:13px;margin-top:8px">Aus Sicherheitsgründen plant Happa nicht unter ${state.profile.sex === "m" ? "1.500" : "1.200"} kcal.</div>`}
      </div>
      <label class="label">Kalorienziel</label>
      <${Seg} label="Kalorienziel" options=${[{ value: false, label: "Automatisch" }, { value: true, label: "Eigenes Ziel" }]} value=${custom} onChange=${setCustom}/>
      ${custom && html`<div class="unit-input" style="margin-top:10px"><input class="field num" inputmode="numeric" value=${kcal} onInput=${(e) => setKcal(e.currentTarget.value)} aria-label="Eigenes Kalorienziel"/><span>kcal</span></div>
        ${!valid && html`<div class="field-hint">Bitte ein Ziel zwischen 1.000 und 6.000 kcal eingeben.</div>`}`}

      <label class="label">Nährstoffverteilung</label>
      <div class="choices">
        ${SPLITS.map((x) => html`
          <button class=${cx("choice", JSON.stringify(split) === JSON.stringify(x.split) && "on")} aria-pressed=${JSON.stringify(split) === JSON.stringify(x.split)} onClick=${() => { haptic(); setSplit(x.split); }}>
            <div class="grow"><b>${x.name}</b><small>${x.desc} · KH ${x.split.carbs} % · Eiweiß ${x.split.protein} % · Fett ${x.split.fat} %</small></div>
          </button>`)}
      </div>

      <label class="label">Wasser pro Tag</label>
      <div class="stepper">
        <button class="icon-btn fill" aria-label="250 ml weniger" onClick=${() => { haptic(); setWater(Math.max(1000, water - 250)); }}>−</button>
        <div class="field num center grow" style="display:grid;place-items:center;font-weight:700">${n1(water / 1000)} l</div>
        <button class="icon-btn fill" aria-label="250 ml mehr" onClick=${() => { haptic(); setWater(Math.min(5000, water + 250)); }}>+</button>
      </div>
    </${Sheet}>`;
}

// ── Zielgewicht & Tempo ──
function openTarget() { openOverlay((o) => html`<${TargetSheet} ...${o}/>`); }
function TargetSheet({ id, closing }) {
  const p = state.profile;
  const w = currentWeight();
  const [goal, setGoal] = useState(n1(p.goalWeight ?? w));
  const [pace, setPace] = useState(p.pace || 0.5);
  const [busy, setBusy] = useState(false);
  const gw = parseNum(goal);
  const minGoal = Math.ceil(18.5 * ((p.height || 170) / 100) ** 2 * 10) / 10;
  const valid = gw >= minGoal && gw <= 400;
  const preview = valid ? plan({ ...p, goalWeight: gw, pace }, w) : null;

  const save = async () => {
    setBusy(true);
    try { await saveProfile({ goalWeight: Math.round(gw * 10) / 10, pace }); toast("Ziel gespeichert", "🎯"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Zielgewicht" footer=${html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${save}>Speichern</button>`}>
      <label class="label">Zielgewicht</label>
      <div class="unit-input"><input class="field num" inputmode="decimal" value=${goal} onInput=${(e) => setGoal(e.currentTarget.value)} aria-label="Zielgewicht"/><span>kg</span></div>
      ${Number.isFinite(gw) && gw < minGoal && html`<div class="info-box warn">⚠️ Ein Zielgewicht unter ${n1(minGoal)} kg läge im Untergewicht (BMI unter 18,5).</div>`}
      ${Number.isFinite(gw) && gw > 400 && html`<div class="field-hint">Bitte ein Gewicht bis 400 kg eingeben.</div>`}
      <label class="label">Tempo</label>
      <div class="choices">
        ${PACES.map((x) => html`<button class=${cx("choice", pace === x.v && "on")} aria-pressed=${pace === x.v} onClick=${() => { haptic(); setPace(x.v); }}><div class="grow"><b>${x.name}</b><small>${x.desc}</small></div></button>`)}
      </div>
      ${preview && preview.mode !== "keep" && (p.kcalGoal
        ? html`<div class="info-box">🎯 Dein eigenes Kalorienziel (${n0(p.kcalGoal)} kcal) bleibt aktiv. Unter „Kalorienziel“ kannst du auf automatisch umstellen.</div>`
        : preview.eta
          ? html`<div class="info-box">📅 Neues Tagesziel: <b>${n0(preview.kcal)} kcal</b>. Ziel voraussichtlich erreicht im ${new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(preview.eta)}.</div>`
          : html`<div class="info-box warn">An der Sicherheitsgrenze von ${p.sex === "m" ? "1.500" : "1.200"} kcal reicht das Kaloriendefizit nicht – mehr Bewegung hilft hier am meisten.</div>`)}
    </${Sheet}>`;
}

// ── Körperdaten ──
function openBody() { openOverlay((o) => html`<${BodySheet} ...${o}/>`); }
function BodySheet({ id, closing }) {
  const p = state.profile;
  const [v, setV] = useState({ name: p.name || "", sex: p.sex || "f", born: String(p.born || ""), height: String(p.height || ""), activity: p.activity || "light" });
  const [busy, setBusy] = useState(false);
  const born = parseNum(v.born), height = parseNum(v.height);
  const year = new Date().getFullYear();
  const bornOk = born >= year - 100 && born <= year - 18;
  const heightOk = height >= 120 && height <= 230;
  const valid = bornOk && heightOk;
  const save = async () => {
    setBusy(true);
    try { await saveProfile({ name: v.name.trim(), sex: v.sex, born: Math.round(born), height: Math.round(height), activity: v.activity }); toast("Gespeichert"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  return html`
    <${Sheet} id=${id} closing=${closing} title="Körperdaten" full footer=${html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${save}>Speichern</button>`}>
      <label class="label" for="b-name">Name</label>
      <input id="b-name" class="field" value=${v.name} onInput=${(e) => setV({ ...v, name: e.currentTarget.value })}/>
      <label class="label">Geschlecht</label>
      <${Seg} label="Geschlecht" options=${SEXES.map((x) => ({ value: x.id, label: x.name }))} value=${v.sex} onChange=${(x) => setV({ ...v, sex: x })}/>
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="grow"><label class="label" for="b-born">Geburtsjahr</label><input id="b-born" class="field num" inputmode="numeric" value=${v.born} onInput=${(e) => setV({ ...v, born: e.currentTarget.value })}/></div>
        <div class="grow"><label class="label" for="b-height">Größe (cm)</label><input id="b-height" class="field num" inputmode="numeric" value=${v.height} onInput=${(e) => setV({ ...v, height: e.currentTarget.value })}/></div>
      </div>
      ${v.born && !bornOk && html`<div class="field-hint">${born > year - 18 && born <= year ? "Happa ist für Erwachsene gedacht – für Jugendliche gelten andere Richtwerte." : "Bitte ein vierstelliges Geburtsjahr eingeben."}</div>`}
      ${v.height && !heightOk && html`<div class="field-hint">Bitte die Größe in cm angeben (120–230).</div>`}
      <label class="label">Aktivität</label>
      <div class="choices">
        ${ACTIVITY.map((a) => html`<button class=${cx("choice", v.activity === a.id && "on")} aria-pressed=${v.activity === a.id} onClick=${() => { haptic(); setV({ ...v, activity: a.id }); }}><span class="e" aria-hidden="true">${a.e}</span><div class="grow"><b>${a.name}</b><small>${a.desc}</small></div></button>`)}
      </div>
    </${Sheet}>`;
}

// ── Konto löschen ──
function openDelete() { openOverlay((o) => html`<${DeleteSheet} ...${o}/>`); }
function DeleteSheet({ id, closing }) {
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try { await deleteAccount(); location.href = "/cdn-cgi/access/logout"; }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  return html`
    <${Sheet} id=${id} closing=${closing} title="Konto löschen">
      <div class="center" style="padding:6px 4px 4px">
        <div style="font-size:48px">🗑️</div>
        <p style="font-size:17px">Alle deine Einträge, Gewichte und dein Profil werden endgültig gelöscht. Das lässt sich nicht rückgängig machen.</p>
        <p class="muted" style="font-size:14px">Tipp: Exportiere deine Daten vorher.</p>
        <button class="btn btn-danger block" style="margin-top:8px" disabled=${busy} onClick=${del}>${busy ? html`<span class="spinner"></span>` : "Endgültig löschen"}</button>
        <button class="btn btn-plain block" style="margin-top:6px" onClick=${() => closeOverlay(id)}>Abbrechen</button>
      </div>
    </${Sheet}>`;
}
