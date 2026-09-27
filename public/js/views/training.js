// Tab „Training“: Wochenplan wie ein Kalender. Einheiten werden von Hand geplant und
// automatisch abgehakt, sobald Health Auto Export ein passendes Workout liefert (days.act.w).
// Einheit: [id, Sportart, Titel, Minuten, "HH:MM", manuell erledigt 0/1]
import { useState, useEffect } from "preact/hooks";
import { html, cx, haptic, today, addDays, mondayOf, fromInt, uid, n0, parseNum } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, openOverlay, closeOverlay, loadRange, setTraining, toast, state } from "../store.js";
import { Sheet, NavBar, useScrolled } from "../ui.js";
import { energyOf } from "./health.js";

export const SPORTS = [
  { id: "laufen", name: "Laufen", e: "🏃", re: /lauf|run|jog/i },
  { id: "rad", name: "Radfahren", e: "🚴", re: /rad|cycl|bike|velo/i },
  { id: "schwimmen", name: "Schwimmen", e: "🏊", re: /schwimm|swim/i },
  { id: "kraft", name: "Krafttraining", e: "🏋️", re: /kraft|strength|weight|functional|core/i },
  { id: "hiit", name: "HIIT", e: "🔥", re: /hiit|intervall|interval|cross|boot/i },
  { id: "yoga", name: "Yoga", e: "🧘", re: /yoga|pilates|flexib|stretch|dehn/i },
  { id: "gehen", name: "Gehen", e: "🚶", re: /geh|walk|spazier|wander|hik/i },
  { id: "sonst", name: "Sonstiges", e: "💪", re: null },
];
const sportOf = (id) => SPORTS.find((s) => s.id === id) || SPORTS[SPORTS.length - 1];
const sportForWorkout = (name) => SPORTS.find((s) => s.re && s.re.test(name)) || SPORTS[SPORTS.length - 1];
const WD = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
export const dm = (d) => `${d % 100}.${Math.floor(d / 100) % 100}.`;

export function isoWeek(d) {
  const x = fromInt(d);
  const t = new Date(Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

// Geplante Einheiten mit den Workouts aus Apple Health verbinden:
// 1. gleiche Sportart, 2. übrige Einheiten nehmen übrige Workouts, Rest = „zusätzlich“.
export function matchDay(day) {
  const plan = day?.train || [];
  const ws = (day?.act?.w || []).map((w) => ({ w, used: false }));
  const res = plan.map((p) => {
    const sp = sportOf(p[1]);
    const m = sp.re ? ws.find((x) => !x.used && sp.re.test(x.w[0])) : null;
    if (m) m.used = true;
    return { p, m: m?.w || null };
  });
  for (const r of res) {
    if (r.m || r.p[5]) continue;
    const m = ws.find((x) => !x.used);
    if (m) { m.used = true; r.m = m.w; r.other = true; }
  }
  return { items: res, extra: ws.filter((x) => !x.used).map((x) => x.w) };
}

export function TrainingView() {
  const s = useStore();
  const scrolled = useScrolled();
  const t = today();
  const [monday, setMonday] = useState(mondayOf(t));
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const sunday = days[6];
  useEffect(() => { loadRange(monday, sunday).catch(() => {}); }, [monday]);

  let planned = 0, done = 0, sportKcal = 0, burned = 0, burnedDays = 0;
  const rows = days.map((d) => {
    const day = s.days[d];
    const { items, extra } = matchDay(day);
    planned += items.length;
    done += items.filter((r) => r.m || r.p[5]).length;
    const e = energyOf(day?.act);
    if (e) { sportKcal += e.sport; if (e.total) { burned += e.total; burnedDays++; } }
    return { d, day, items, extra, e };
  });
  const thisWeek = monday === mondayOf(t);

  return html`
    <${NavBar} title="Training" show=${scrolled}/>
    <main class="page">
      <header class="header"><h1 class="large-title">Training</h1></header>

      <div class="week-nav">
        <button class="icon-btn fill sm" aria-label="Vorige Woche" onClick=${() => { haptic(); setMonday(addDays(monday, -7)); }}>${Icon.left()}</button>
        <button class="week-label" onClick=${() => { haptic(); setMonday(mondayOf(t)); }} aria-label="Zur aktuellen Woche">
          <b>KW ${isoWeek(monday)}</b><span>${dm(monday)} – ${dm(sunday)}${thisWeek ? " · diese Woche" : ""}</span>
        </button>
        <button class="icon-btn fill sm" aria-label="Nächste Woche" onClick=${() => { haptic(); setMonday(addDays(monday, 7)); }}>${Icon.right()}</button>
      </div>

      <section class="card train-sum">
        <div><b class="num">${done}<small>/${planned}</small></b><span>absolviert</span></div>
        <div><b class="num">${n0(sportKcal)}</b><span>Sport-kcal</span></div>
        <div><b class="num">${burnedDays ? n0(burned / burnedDays) : "–"}</b><span>Ø Verbrauch/Tag</span></div>
      </section>

      <div class="train-week">
        ${rows.map(({ d, items, extra, e }) => {
          const past = d < t, isToday = d === t;
          return html`
          <section class=${cx("card train-day", isToday && "today")} key=${d} aria-label=${`${WD[(fromInt(d).getDay() + 6) % 7]} ${dm(d)}`}>
            <div class="train-date"><span>${WD[(fromInt(d).getDay() + 6) % 7]}</span><b>${d % 100}</b></div>
            <div class="train-body">
              ${items.map(({ p, m, other }) => {
                const sp = sportOf(p[1]);
                const ok = !!m || !!p[5];
                const status = ok ? "done" : past ? "missed" : isToday ? "open" : "planned";
                return html`
                <button class=${cx("train-item", status)} onClick=${() => openSession({ d, item: p })}>
                  <span class="train-check" aria-hidden="true">${ok ? Icon.check() : status === "missed" ? "–" : ""}</span>
                  <span class="grow">
                    <span class="train-title">${sp.e} ${p[2] || sp.name}${p[3] ? html` <small class="muted">${p[3]} min${p[4] ? " · " + p[4] : ""}</small>` : p[4] ? html` <small class="muted">${p[4]}</small>` : ""}</span>
                    ${m ? html`<span class="train-done">${other ? `${m[0]} · ` : ""}${m[1]} min · <b class="num">${n0(m[2])} kcal</b></span>`
                      : p[5] ? html`<span class="train-done">von Hand abgehakt</span>`
                      : status === "missed" ? html`<span class="train-sub">nicht erfasst</span>`
                      : html`<span class="train-sub">${isToday ? "heute geplant" : "geplant"}</span>`}
                  </span>
                </button>`;
              })}
              ${extra.map((w) => html`
                <div class="train-item extra">
                  <span class="train-check" aria-hidden="true">${Icon.plus()}</span>
                  <span class="grow"><span class="train-title">${sportForWorkout(w[0]).e} ${w[0]} <small class="muted">zusätzlich</small></span>
                    <span class="train-done">${w[1]} min · <b class="num">${n0(w[2])} kcal</b></span></span>
                </div>`)}
              ${!items.length && !extra.length && html`<div class="train-empty">${past ? "Ruhetag" : "Noch nichts geplant"}</div>`}
              ${e && e.total > 0 && html`<div class="train-energy">Verbrauch <b class="num">${n0(e.total)}</b> kcal${e.sport ? html` · ohne Sport <b class="num">${n0(e.withoutSport)}</b>` : ""}</div>`}
            </div>
            <button class="icon-btn tint train-add" aria-label=${`Training am ${dm(d)} planen`} onClick=${() => openSession({ d })}>${Icon.plus()}</button>
          </section>`;
        })}
      </div>
      <p class="fine">Abgehakt wird automatisch, sobald Health Auto Export ein passendes Workout schickt (Profil → Körperdaten → Apple Health). Ohne Uhr kannst du eine Einheit auch von Hand abhaken.</p>
    </main>`;
}

// ── Einheit planen / bearbeiten ──
function openSession({ d, item = null }) {
  haptic();
  openOverlay((o) => html`<${SessionSheet} ...${o} d=${d} item=${item}/>`);
}

function SessionSheet({ id, closing, d, item }) {
  const isNew = !item;
  const [type, setType] = useState(item ? item[1] : "laufen");
  const [title, setTitle] = useState(item ? item[2] : "");
  const [minutes, setMinutes] = useState(item ? String(item[3] || "") : "45");
  const [time, setTime] = useState(item ? item[4] : "");
  const [repeat, setRepeat] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const min = Math.max(0, Math.round(parseNum(minutes) || 0));

  const build = (manual) => [item ? item[0] : uid(), type, title.trim().slice(0, 40), min, time || "", manual ? 1 : 0];

  const save = async (manualDone = item ? item[5] : 0) => {
    setBusy(true);
    try {
      if (isNew) {
        const targets = [d, ...Array.from({ length: repeat }, (_, i) => addDays(d, 7 * (i + 1)))];
        await loadRange(targets[0], targets[targets.length - 1]);
        for (const x of targets) {
          const list = state.days[x]?.train || [];
          if (list.length >= 10) continue;
          await setTraining(x, [...list, [uid(), type, title.trim().slice(0, 40), min, time || "", 0]]);
        }
        toast(repeat ? `Geplant: ${repeat + 1} Wochen` : "Training geplant", "📅");
      } else {
        const list = (state.days[d]?.train || []).map((x) => x[0] === item[0] ? build(manualDone) : x);
        await setTraining(d, list);
        toast("Gespeichert", "✅");
      }
      closeOverlay(id);
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const remove = async () => {
    if (!confirmDel) { haptic(); setConfirmDel(true); return; }
    setBusy(true);
    try { await setTraining(d, (state.days[d]?.train || []).filter((x) => x[0] !== item[0])); toast("Einheit gelöscht", "🗑️"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  const { items } = matchDay(state.days[d]);
  const match = item && items.find((r) => r.p[0] === item[0])?.m;

  return html`
    <${Sheet} id=${id} closing=${closing} title=${isNew ? `Training am ${dm(d)}` : "Training"} full
      footer=${html`<button class="btn btn-primary block" disabled=${busy} onClick=${() => save()}>${busy ? html`<span class="spinner"></span>` : isNew ? "Planen" : "Speichern"}</button>`}>
      <div class="label">Sportart</div>
      <div class="sport-grid">
        ${SPORTS.map((sp) => html`<button class=${cx("sport", type === sp.id && "on")} aria-pressed=${type === sp.id} onClick=${() => { haptic(); setType(sp.id); }}>
          <span aria-hidden="true">${sp.e}</span>${sp.name}</button>`)}
      </div>
      <label class="label" for="tr-title">Bezeichnung (optional)</label>
      <input id="tr-title" class="field" value=${title} maxlength="40" placeholder=${sportOf(type).name + ", z. B. locker 5 km"} onInput=${(e) => setTitle(e.currentTarget.value)}/>
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="grow">
          <label class="label" for="tr-min">Dauer</label>
          <div class="unit-input"><input id="tr-min" class="field num" inputmode="numeric" value=${minutes} onInput=${(e) => setMinutes(e.currentTarget.value)} onFocus=${(e) => e.currentTarget.select()}/><span>min</span></div>
        </div>
        <div class="grow">
          <label class="label" for="tr-time">Uhrzeit (optional)</label>
          <input id="tr-time" class="field" type="time" value=${time} onInput=${(e) => setTime(e.currentTarget.value)}/>
        </div>
      </div>
      <div class="chips" style="margin-top:10px">${[20, 30, 45, 60, 90].map((c) => html`<button class=${cx("chip", min === c && "on")} onClick=${() => { haptic(); setMinutes(String(c)); }}>${c} min</button>`)}</div>

      ${isNew ? html`
        <div class="label">Wiederholen</div>
        <div class="chips">${[[0, "Nur einmal"], [3, "4 Wochen"], [7, "8 Wochen"], [11, "12 Wochen"]].map(([n, l]) => html`
          <button class=${cx("chip", repeat === n && "on")} aria-pressed=${repeat === n} onClick=${() => { haptic(); setRepeat(n); }}>${l}</button>`)}</div>
        ${repeat > 0 && html`<p class="muted" style="font-size:14px;margin:8px 0 0">Jeden ${WD[(fromInt(d).getDay() + 6) % 7]} bis ${dm(addDays(d, 7 * repeat))}.</p>`}`
      : html`
        ${match ? html`<div class="info-box">✅ Absolviert laut Apple Health: <b>${match[0]}</b> · ${match[1]} min · ${n0(match[2])} kcal</div>`
          : html`<button class=${cx("btn block", item[5] ? "btn-glass" : "btn-tint")} style="margin-top:16px" disabled=${busy} onClick=${() => save(item[5] ? 0 : 1)}>
              ${Icon.check()} ${item[5] ? "Abhaken rückgängig" : "Von Hand abhaken"}</button>`}
        <button class=${cx("btn block fav-delete", confirmDel && "confirm")} style="margin-top:12px" disabled=${busy} onClick=${remove}>
          ${Icon.trash()} ${confirmDel ? "Wirklich löschen?" : "Einheit löschen"}</button>`}
    </${Sheet}>`;
}
