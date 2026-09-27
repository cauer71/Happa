// Karte „Gegessen vs. verbraucht“ (Tab Fortschritt): pro Tag der Woche die gegessenen kcal
// neben dem Verbrauch aus Apple Health (Grundumsatz, Alltag, Sport). Tage ohne Health-Daten
// nutzen den geschätzten Verbrauch aus dem Profil (gestrichelt).
import { useState, useEffect } from "preact/hooks";
import { html, cx, haptic, today, addDays, mondayOf, n0, n1, weekdayShort } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, loadRange, currentWeight } from "../store.js";
import { totals, plan } from "../nutrition.js";
import { energyOf } from "./health.js";
import { dm, isoWeek } from "./training.js";

export function BalanceCard() {
  const s = useStore();
  const t = today();
  const [monday, setMonday] = useState(mondayOf(t));
  const sunday = addDays(monday, 6);
  useEffect(() => { loadRange(monday, sunday).catch(() => {}); }, [monday]);

  const { tdee } = plan(s.profile, currentWeight());
  const late = new Date().getHours() >= 20;
  const gainGoal = (s.profile.goalWeight || 0) > (s.profile.startWeight || 0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(monday, i);
    const day = s.days[d];
    const tt = totals(day?.log);
    const e = energyOf(day?.act);
    const measured = e && e.basal > 0 ? e : null;
    const burned = measured ? measured.total : tdee;
    // Heute zählt erst ab 20 Uhr, die Zukunft nie
    const counted = tt.count > 0 && (d < t || (d === t && late));
    return { d, eaten: tt.kcal, count: tt.count, e: measured, burned, counted, partial: d === t && !late, future: d > t, balance: tt.kcal - burned };
  });
  const counted = days.filter((x) => x.counted);
  const sumBal = counted.reduce((a, x) => a + x.balance, 0);
  const avgEat = counted.length ? counted.reduce((a, x) => a + x.eaten, 0) / counted.length : 0;
  const avgBurn = counted.length ? counted.reduce((a, x) => a + x.burned, 0) / counted.length : 0;
  const estimated = counted.filter((x) => !x.e).length;
  const good = (v) => (gainGoal ? v >= 0 : v <= 0);
  const thisWeek = monday === mondayOf(t);

  return html`
    <section class="card" aria-label="Gegessen gegen verbraucht">
      <div class="card-title"><span class="icon-dot" style="background:color-mix(in srgb, var(--streak) 15%, transparent)">⚡️</span>Gegessen vs. verbraucht</div>
      <div class="week-nav compact">
        <button class="icon-btn fill sm" aria-label="Vorige Woche" onClick=${() => { haptic(); setMonday(addDays(monday, -7)); }}>${Icon.left()}</button>
        <button class="week-label" onClick=${() => { haptic(); setMonday(mondayOf(t)); }} aria-label="Zur aktuellen Woche">
          <b>KW ${isoWeek(monday)}</b><span>${dm(monday)} – ${dm(sunday)}${thisWeek ? " · diese Woche" : ""}</span>
        </button>
        <button class="icon-btn fill sm" aria-label="Nächste Woche" disabled=${thisWeek} onClick=${() => { haptic(); setMonday(addDays(monday, 7)); }}>${Icon.right()}</button>
      </div>
      <div class="bal-kpis">
        <div><b class="num">${counted.length ? n0(avgEat) : "–"}</b><span>Ø gegessen</span></div>
        <div><b class="num">${counted.length ? n0(avgBurn) : "–"}</b><span>Ø verbraucht</span></div>
        <div><b class=${cx("num", counted.length && (good(sumBal) ? "under" : "over"))}>${counted.length ? `${sumBal > 0 ? "+" : sumBal < 0 ? "−" : "±"}${n0(Math.abs(sumBal))}` : "–"}</b><span>Bilanz Woche</span></div>
      </div>
      <${BalanceChart} days=${days} good=${good}/>
      <div class="energy-legend bal-legend">
        <span><i class="eat"></i>Gegessen</span>
        <span><i class="b"></i>Grundumsatz</span>
        <span><i class="a"></i>Alltag</span>
        <span><i class="s"></i>Sport</span>
        <span><i class="est"></i>geschätzt</span>
      </div>
      <p class="muted bal-note">
        ${counted.length
          ? html`${sumBal < 0 ? "Defizit" : "Überschuss"} von ${n0(Math.abs(sumBal))} kcal an ${counted.length} ${counted.length === 1 ? "Tag" : "Tagen"} – das entspricht etwa <b>${n1(Math.abs(sumBal) / 7700)} kg</b> ${sumBal < 0 ? "weniger" : "mehr"}.
              ${estimated ? ` ${estimated === counted.length ? "Der Verbrauch ist" : `An ${estimated} ${estimated === 1 ? "Tag ist" : "Tagen ist"} der Verbrauch`} aus deinem Profil geschätzt (${n0(tdee)} kcal), weil keine Daten aus Apple Health da sind.` : ""}`
          : "Sobald du an einem Tag dieser Woche etwas eingetragen hast, siehst du hier deine Bilanz."}
        ${thisWeek && !late ? " Heute zählt ab 20 Uhr mit." : ""}
      </p>
    </section>`;
}

function BalanceChart({ days, good }) {
  const W = 340, H = 184, P = { t: 10, b: 38 };
  const max = Math.max(2000, ...days.map((x) => Math.max(x.eaten, x.burned))) * 1.08;
  const base = H - P.b;
  const hOf = (v) => (v / max) * (base - P.t);
  const slot = W / 7, bw = 16, gap = 3;
  return html`
    <svg class="chart bal-chart" viewBox=${`0 0 ${W} ${H}`} role="img" aria-label="Gegessene und verbrauchte Kalorien pro Tag">
      <defs>
        <linearGradient id="bal-eat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--kcal-a)"/><stop offset="1" stop-color="var(--kcal-b)"/></linearGradient>
      </defs>
      <line class="grid" x1="0" x2=${W} y1=${base} y2=${base}/>
      ${days.map((x, i) => {
        const cx0 = i * slot + slot / 2;
        const xe = cx0 - bw - gap / 2, xb = cx0 + gap / 2;
        const he = x.eaten ? Math.max(3, hOf(x.eaten)) : 0;
        const dim = x.partial ? 0.5 : 1;
        let burnBar;
        if (x.future) burnBar = null;
        else if (x.e) {
          const parts = [["b", x.e.basal, "#8e8e93"], ["a", x.e.everyday, "var(--everyday)"], ["s", x.e.sport, "var(--streak)"]];
          let y = base;
          burnBar = parts.map(([k, v, c], j) => {
            const h = hOf(v); y -= h;
            const top = j === parts.length - 1 || parts.slice(j + 1).every((p) => !p[1]);
            return h > 0 && html`<rect key=${k} x=${xb} y=${y} width=${bw} height=${h} rx=${top ? 5 : 0} fill=${c} opacity=${dim}/>`;
          });
        } else if (x.count) {
          const h = hOf(x.burned);
          burnBar = html`<rect x=${xb + 0.75} y=${base - h + 0.75} width=${bw - 1.5} height=${h - 1.5} rx="5" fill="none" stroke="var(--text-3, var(--text-2))" stroke-width="1.5" stroke-dasharray="4 3" opacity=".8"/>`;
        }
        return html`
          <g key=${x.d}>
            ${he > 0 && html`<rect x=${xe} y=${base - he} width=${bw} height=${he} rx="5" fill="url(#bal-eat)" opacity=${dim}/>`}
            ${!he && !x.future && html`<rect x=${xe} y=${base - 3} width=${bw} height="3" rx="1.5" fill="var(--fill)"/>`}
            ${burnBar}
            <text x=${cx0} y=${H - 22} text-anchor="middle" style=${x.d === today() ? "fill:var(--accent)" : ""}>${weekdayShort(x.d)}</text>
            ${x.counted
              ? html`<text x=${cx0} y=${H - 6} text-anchor="middle" class=${good(x.balance) ? "bal-good" : "bal-bad"}>${x.balance > 0 ? "+" : x.balance < 0 ? "−" : "±"}${n0(Math.abs(x.balance))}</text>`
              : x.partial && x.count ? html`<text x=${cx0} y=${H - 6} text-anchor="middle">bisher</text>` : null}
          </g>`;
      })}
    </svg>`;
}
