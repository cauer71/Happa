// Tab „Fortschritt“: Gewichtskurve, Kalorien der Woche, Prognose, Serie, Abzeichen.
import { useState, useEffect } from "preact/hooks";
import { html, cx, haptic, today, addDays, n0, n1, shortDate, weekdayShort, fromInt, monthYear, diffDays } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, loadRange, loadWeights, currentGoals, currentWeight, celebrate, toast, state } from "../store.js";
import { Seg, NavBar, useScrolled, Empty } from "../ui.js";
import { totals, BADGES, plan } from "../nutrition.js";
import { openWeight } from "./weight.js";

export function ProgressView() {
  const s = useStore();
  const scrolled = useScrolled();
  const [range, setRange] = useState("3m");
  const [weightError, setWeightError] = useState(false);
  const t = today();

  // Nur fehlende Tage und die Gewichte einmal pro Sitzung laden (spart Lesezugriffe)
  useEffect(() => { loadRange(addDays(t, -34), t).catch(() => {}); }, []);
  useEffect(() => { loadWeights().catch(() => setWeightError(true)); }, []);
  const weights = s.weights || (weightError ? [] : null);

  const g = currentGoals();
  const week = Array.from({ length: 7 }, (_, i) => addDays(t, i - 6)).map((d) => ({ d, t: totals(s.days[d]?.log) }));
  // Der heutige Tag zählt für Schnitt und Prognose erst ab 20 Uhr (sonst wirkt er zu niedrig)
  const complete = week.filter((x) => x.d < t || new Date().getHours() >= 20);
  const logged = complete.filter((x) => x.t.count > 0);
  const avg = logged.length ? logged.reduce((a, x) => a + x.t.kcal, 0) / logged.length : 0;
  const onTarget = logged.filter((x) => Math.abs(x.t.kcal - g.kcal) <= g.kcal * 0.1).length;
  const macro = logged.reduce((a, x) => ({ c: a.c + x.t.carbs * 4, p: a.p + x.t.protein * 4, f: a.f + x.t.fat * 9 }), { c: 0, p: 0, f: 0 });
  const macroSum = macro.c + macro.p + macro.f;

  return html`
    <${NavBar} title="Fortschritt" show=${scrolled}/>
    <main class="page">
      <header class="header"><h1 class="large-title">Fortschritt</h1></header>
      <div class="grid-2">
        <div class="stack fade-list">
          <${WeightCard} weights=${weights} range=${range} setRange=${setRange}/>
          <${ForecastCard} logged=${logged} avg=${avg}/>
          <${StreakCard}/>
        </div>
        <div class="stack fade-list">
          <section class="card" aria-label="Kalorien der letzten 7 Tage">
            <div class="card-title"><span class="icon-dot" style="background:color-mix(in srgb, var(--accent) 15%, transparent)">🔥</span>Kalorien · 7 Tage</div>
            <div class="row" style="gap:22px;margin-bottom:10px">
              <div><div class="kpi">${logged.length ? n0(avg) : "–"}</div><div class="muted" style="font-size:13px">Ø kcal pro Tag</div></div>
              <div><div class="kpi">${onTarget}<small>/${logged.length}</small></div><div class="muted" style="font-size:13px">Tage im Ziel (±10 %)</div></div>
            </div>
            <${WeekBars} week=${week} goal=${g.kcal}/>
          </section>
          <section class="card" aria-label="Nährstoffverteilung">
            <div class="card-title"><span class="icon-dot" style="background:color-mix(in srgb, var(--carbs) 15%, transparent)">🥗</span>Nährstoffe · Ø 7 Tage</div>
            ${macroSum ? html`
              <div style="display:flex;height:14px;border-radius:7px;overflow:hidden;gap:3px">
                <i style=${`flex:${macro.c};background:var(--carbs)`}></i><i style=${`flex:${macro.p};background:var(--protein)`}></i><i style=${`flex:${macro.f};background:var(--fat)`}></i>
              </div>
              <div class="row between" style="margin-top:10px;font-size:14px">
                ${[["Kohlenhydrate", macro.c, "var(--carbs)"], ["Eiweiß", macro.p, "var(--protein)"], ["Fett", macro.f, "var(--fat)"]].map(([l, v, c]) => html`
                  <div><span style=${`display:inline-block;width:9px;height:9px;border-radius:5px;background:${c};margin-right:6px`}></span>${l} <b class="num">${n0((v / macroSum) * 100)} %</b></div>`)}
              </div>
              <div class="muted" style="font-size:13px;margin-top:8px">Ziel: ${(s.profile.split || { carbs: 50, protein: 20, fat: 30 }).carbs} / ${(s.profile.split || { protein: 20 }).protein} / ${(s.profile.split || { fat: 30 }).fat} %</div>`
              : html`<div class="muted" style="font-size:15px">Sobald du etwas eingetragen hast, siehst du hier deine Verteilung.</div>`}
          </section>
        </div>
      </div>
    </main>`;
}

// ── Gewicht ──
function WeightCard({ weights, range, setRange }) {
  const p = state.profile;
  const current = currentWeight();
  const start = p.startWeight || current;
  const goal = p.goalWeight;
  const lost = start - current;
  const toGo = goal ? current - goal : 0;
  const progress = goal && start !== goal ? Math.max(0, Math.min(1, (start - current) / (start - goal))) : 0;
  const t = today();
  const from = range === "1m" ? addDays(t, -30) : range === "3m" ? addDays(t, -91) : range === "1y" ? addDays(t, -365) : 0;
  const pts = (weights || []).filter(([d]) => d >= from);

  return html`
    <section class="card" aria-label="Gewicht">
      <div class="row between">
        <div class="card-title" style="margin:0"><span class="icon-dot" style="background:color-mix(in srgb, var(--weight) 15%, transparent)">⚖️</span>Gewicht</div>
        <button class="btn btn-tint small" onClick=${() => { haptic(); openWeight(t); }}>${Icon.plus()} Eintragen</button>
      </div>
      <div class="row" style="gap:22px;margin:12px 0 4px;align-items:flex-end">
        <div><div class="kpi">${n1(current)}<small> kg</small></div><div class="muted" style="font-size:13px">aktuell</div></div>
        <div><div class="kpi" style=${`color:${Math.abs(lost) < 0.05 ? "var(--text)" : (goal && goal > start ? lost < 0 : lost > 0) ? "var(--accent-text)" : "var(--over-b)"}`}>${Math.abs(lost) < 0.05 ? "±" : lost > 0 ? "−" : "+"}${n1(Math.abs(lost))}<small> kg</small></div><div class="muted" style="font-size:13px">seit Start</div></div>
        ${goal ? html`<div><div class="kpi">${toGo > 0 ? n1(toGo) : "0"}<small> kg</small></div><div class="muted" style="font-size:13px">bis zum Ziel</div></div>` : null}
      </div>
      ${goal && start > goal ? html`
        <div style="margin:12px 0 4px">
          <div class="bar" style="height:10px"><i style=${`width:${progress * 100}%;background:var(--accent-grad)`}></i></div>
          <div class="row between muted" style="font-size:12px;margin-top:5px"><span>Start ${n1(start)} kg</span><span>${n0(progress * 100)} % geschafft</span><span>Ziel ${n1(goal)} kg</span></div>
        </div>` : null}
      <div style="margin-top:14px">
        <${Seg} label="Zeitraum" options=${[{ value: "1m", label: "1 M" }, { value: "3m", label: "3 M" }, { value: "1y", label: "1 J" }, { value: "all", label: "Alle" }]} value=${range} onChange=${setRange}/>
      </div>
      <div style="margin-top:12px">
        ${weights === null ? html`<div class="muted center" style="padding:40px 0"><span class="spinner"></span></div>`
          : pts.length ? html`<${LineChart} points=${pts} goal=${goal}/>`
          : html`<${Empty} e="📉" title="Noch keine Werte" text="Trag dein Gewicht ein – einmal pro Woche reicht."/>`}
      </div>
    </section>`;
}

function LineChart({ points, goal }) {
  const W = 340, H = 170, P = { l: 34, r: 10, t: 12, b: 22 };
  const xs = points.map(([d]) => fromInt(d).getTime());
  const ys = points.map(([, w]) => w);
  // Ein einzelner Messpunkt steht mittig statt am Rand
  const minX = xs.length === 1 ? xs[0] - 86400000 * 3 : Math.min(...xs);
  const maxX = xs.length === 1 ? xs[0] + 86400000 * 3 : Math.max(...xs);
  let minY = Math.min(...ys, goal ?? Infinity), maxY = Math.max(...ys);
  if (maxY - minY < 2) { minY -= 1; maxY += 1; }
  minY = Math.floor(minY - 0.5); maxY = Math.ceil(maxY + 0.5);
  const x = (v) => P.l + ((v - minX) / (maxX - minX)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - minY) / (maxY - minY)) * (H - P.t - P.b);
  const pts = points.map(([d, w], i) => [x(xs[i]), y(w)]);
  // weiche Kurve (Catmull-Rom → Bézier)
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    path += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  const area = `${path} L${pts[pts.length - 1][0]},${H - P.b} L${pts[0][0]},${H - P.b} Z`;
  const ticks = [minY, (minY + maxY) / 2, maxY];
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Gewichtsverlauf">
      <defs><linearGradient id="wfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--weight)" stop-opacity=".28"/><stop offset="1" stop-color="var(--weight)" stop-opacity="0"/></linearGradient></defs>
      ${ticks.map((v) => html`<line class="grid" x1=${P.l} x2=${W - P.r} y1=${y(v)} y2=${y(v)}/><text x=${P.l - 6} y=${y(v) + 4} text-anchor="end">${n1(v)}</text>`)}
      ${goal != null && goal >= minY && goal <= maxY && html`<line class="goal" x1=${P.l} x2=${W - P.r} y1=${y(goal)} y2=${y(goal)}/><text x=${W - P.r} y=${y(goal) - 5} text-anchor="end" style="fill:var(--accent)">Ziel</text>`}
      <path d=${area} fill="url(#wfill)"/>
      <path d=${path} fill="none" stroke="var(--weight)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.length <= 40 && pts.map(([px, py]) => html`<circle cx=${px} cy=${py} r="3.5" fill="var(--card-solid)" stroke="var(--weight)" stroke-width="2"/>`)}
      <text x=${P.l} y=${H - 4}>${shortDate(points[0][0])}</text>
      <text x=${W - P.r} y=${H - 4} text-anchor="end">${shortDate(points[points.length - 1][0])}</text>
    </svg>`;
}

function WeekBars({ week, goal }) {
  const W = 340, H = 150, P = { t: 14, b: 22 };
  const max = Math.max(goal * 1.25, ...week.map((x) => x.t.kcal));
  const bw = 26, gap = (W - bw * 7) / 7;
  const y = (v) => P.t + (1 - v / max) * (H - P.t - P.b);
  return html`
    <svg class="chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Kalorien pro Tag">
      <defs>
        <linearGradient id="bar-ok" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--kcal-a)"/><stop offset="1" stop-color="var(--kcal-b)"/></linearGradient>
        <linearGradient id="bar-over" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--over-a)"/><stop offset="1" stop-color="var(--over-b)"/></linearGradient>
      </defs>
      ${week.map(({ d, t }, i) => {
        const x = gap / 2 + i * (bw + gap);
        const h = t.kcal ? Math.max(4, (H - P.b) - y(t.kcal)) : 4;
        return html`
          <rect x=${x} y=${H - P.b - h} width=${bw} height=${h} rx="8" fill=${t.kcal ? (t.kcal > goal * 1.1 ? "url(#bar-over)" : "url(#bar-ok)") : "var(--fill)"}/>
          <text x=${x + bw / 2} y=${H - 6} text-anchor="middle" style=${d === today() ? "fill:var(--accent)" : ""}>${weekdayShort(d)}</text>`;
      })}
      <line class="goal" x1="0" x2=${W} y1=${y(goal)} y2=${y(goal)}/>
    </svg>`;
}

// „Wenn jede Woche so wäre …“ – Prognose aus dem echten Schnitt
function ForecastCard({ logged, avg }) {
  if (logged.length < 3) {
    return html`<section class="card tip"><div class="tip-icon">🔮</div><div><div style="font-weight:600">Prognose</div>
      <p>Trag an mindestens 3 Tagen ein – dann zeigt Happa dir, wohin dich deine aktuelle Woche führt.</p></div></section>`;
  }
  const w = currentWeight();
  const { tdee } = plan(state.profile, w);
  const perWeek = ((avg - tdee) * 7) / 7700;
  const in5 = w + perWeek * 5;
  const gainGoal = (state.profile.goalWeight || 0) > (state.profile.startWeight || 0);
  const tooFast = !gainGoal && perWeek < -0.6;
  const good = gainGoal ? perWeek >= 0 : perWeek <= 0 && !tooFast;
  return html`
    <section class="card tip" aria-label="Prognose">
      <div class="tip-icon">🔮</div>
      <div>
        <div style="font-weight:600">Wenn jede Woche so wäre wie diese …</div>
        <p>… wiegst du in 5 Wochen etwa <b style=${`color:${good ? "var(--accent)" : "var(--over-b)"}`}>${n1(in5)} kg</b>
          (${perWeek <= 0 ? "−" : "+"}${n1(Math.abs(perWeek))} kg pro Woche). Grundlage: Ø ${n0(avg)} kcal bei einem Verbrauch von etwa ${n0(tdee)} kcal.
          ${tooFast ? " Das ist schneller als die empfohlenen 0,5 kg pro Woche – iss ruhig etwas mehr, dann hältst du leichter durch." : ""}</p>
      </div>
    </section>`;
}

function StreakCard() {
  const s = state;
  const t = today();
  const start = addDays(t, -34);
  const days = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  return html`
    <section class="card" aria-label="Serie">
      <div class="card-title"><span class="icon-dot" style="background:color-mix(in srgb, var(--streak) 15%, transparent)">🔥</span>Serie</div>
      <div class="row" style="gap:22px">
        <div><div class="kpi" style="color:var(--streak)">${s.streak.current}</div><div class="muted" style="font-size:13px">Tage in Folge</div></div>
        <div><div class="kpi">${s.streak.best}</div><div class="muted" style="font-size:13px">Rekord</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;margin-top:14px" aria-label="Eingetragene Tage der letzten 5 Wochen">
        ${days.map((d) => html`<div title=${shortDate(d)} style=${`aspect-ratio:1;border-radius:8px;background:${s.logged.has(d) ? "var(--accent-grad)" : "var(--fill)"};${d === t ? "box-shadow:0 0 0 2px var(--accent) inset" : ""}`}></div>`)}
      </div>
      <p class="muted" style="font-size:13px;margin:10px 0 0">Jeder Tag mit mindestens einem Eintrag zählt. Dranbleiben zahlt sich aus.</p>
    </section>`;
}

// Sammlung der Abzeichen (im Profil); große Meilensteine in Gold, die übrigen in Grün
export function BadgesCard() {
  const have = state.profile.badges || {};
  const count = BADGES.filter((b) => have[b.id]).length;
  return html`
    <section class="card" aria-label="Abzeichen">
      <div class="card-title"><span class="icon-dot" style="background:color-mix(in srgb, var(--gold) 20%, transparent)">🏅</span>Abzeichen <span class="more">${count} / ${BADGES.length}</span></div>
      <div class="badges">
        ${BADGES.map((b) => html`
          <button class=${cx("badge", b.big && "big", !have[b.id] && "locked")} onClick=${() => { haptic(); if (have[b.id]) celebrate(b); else toast(b.desc, "🔒"); }}
            title=${b.desc} aria-label=${`${b.name}: ${b.desc}${have[b.id] ? "" : " (noch nicht erreicht)"}`}>
            <div class="medal">${b.e}</div><b>${b.name}</b><small>${have[b.id] ? "Gesammelt" : b.big ? "Offen · Feuerwerk" : "Offen · Konfetti"}</small>
          </button>`)}
      </div>
    </section>`;
}
