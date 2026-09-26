// Tab „Heute“: Wochenleiste, Kalorienring, Mahlzeiten, Wasser, Gewicht, Tipp.
import { useState, useRef, useEffect } from "preact/hooks";
import { html, cx, haptic, today, addDays, mondayOf, dayTitle, longDate, weekdayShort, n0, n1, initials, shortDate } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, selectDay, loadRange, setWater, deleteWithUndo, toast, currentGoals, setTab, emptyDay, state, set } from "../store.js";
import { Ring, Bar, Thumb, CountUp, NavBar, useScrolled } from "../ui.js";
import { MEALS, totals, tipFor, E } from "../nutrition.js";
import { openAdd } from "./add.js";
import { openEntry } from "./entry.js";
import { openWeight } from "./weight.js";
import { openCamera } from "./camera.js";

export function useMedia(query) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}

export function TodayView() {
  const s = useStore();
  const scrolled = useScrolled();
  const wide = useMedia("(min-width: 960px)");
  const d = s.selected;
  const day = s.days[d] || emptyDay(d);
  const g = currentGoals();
  const t = totals(day.log);

  const cards = {
    kcal: html`<${CalorieCard} t=${t} g=${g} d=${d}/>`,
    meals: MEALS.map((m) => html`<${MealCard} key=${m.id} meal=${m} day=${day} kcal=${t.meals[m.id] || 0}/>`),
    water: html`<${WaterCard} day=${day} goal=${g.water}/>`,
    weight: html`<${WeightCard} d=${d} day=${day}/>`,
    tip: html`<${TipCard} d=${d}/>`,
  };

  return html`
    <${NavBar} title=${dayTitle(d)} show=${scrolled}/>
    <main class="page">
      <header class="header">
        <div>
          <h1 class="large-title">${dayTitle(d)}</h1>
          <p class="subtitle">${longDate(d)}</p>
        </div>
        <div class="row" style="gap:8px">
          <button class="pill btn-glass" style="color:var(--streak)" aria-label=${`Serie: ${s.streak.current} ${s.streak.current === 1 ? "Tag" : "Tage"} in Folge`}
            onClick=${() => { haptic(); toast(s.streak.current ? `${s.streak.current} ${s.streak.current === 1 ? "Tag" : "Tage"} in Folge – weiter so!` : "Trag heute etwas ein und starte deine Serie!", "🔥"); }}>
            🔥<span style="color:var(--text)">${s.streak.current}</span>
          </button>
          <button class="avatar" aria-label="Profil" onClick=${() => setTab("profil")}>${initials(s.profile.name, s.email)}</button>
        </div>
      </header>

      <${WeekStrip} selected=${d} logged=${s.logged}/>

      ${wide ? html`
        <div class="grid-2" style="margin-top:14px">
          <div class="stack">${cards.kcal}${cards.water}${cards.weight}${cards.tip}</div>
          <div class="stack">${cards.meals}</div>
        </div>` : html`
        <div class="stack fade-list" style="margin-top:14px">
          ${cards.kcal}${cards.meals}${cards.water}${cards.weight}${cards.tip}
        </div>`}
    </main>`;
}

// ── Wochenleiste mit Wischen ──
function WeekStrip({ selected, logged }) {
  const t = today();
  const monday = mondayOf(selected);
  const touch = useRef(null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));

  useEffect(() => {
    // Woche einmal laden (nur fehlende Tage): danach ist jeder Tag sofort da
    loadRange(monday, Math.min(addDays(monday, 6), t)).catch(() => {});
  }, [monday]);

  const shift = (weeks) => {
    haptic();
    set({ selected: Math.min(addDays(selected, weeks * 7), t) }); // lädt die Wochenleiste selbst
  };
  const start = (e) => { touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const end = (e) => {
    if (!touch.current) return;
    const dx = e.changedTouches[0].clientX - touch.current.x;
    const dy = e.changedTouches[0].clientY - touch.current.y;
    touch.current = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx < 0 && addDays(monday, 7) <= t) shift(1);
      if (dx > 0) shift(-1);
    }
  };

  return html`
    <div class="row" style="gap:6px">
      <button class="icon-btn sm fill pointer-only" aria-label="Vorige Woche" onClick=${() => shift(-1)}>${Icon.left()}</button>
      <div class="week card grow" onTouchStart=${start} onTouchEnd=${end}>
        ${days.map((d) => html`
          <button class=${cx("day", d === selected && "sel", d === t && "today", logged.has(d) && "logged", d > t && "future")}
            disabled=${d > t} aria-label=${longDate(d)} aria-pressed=${d === selected}
            onClick=${() => { if (d !== selected) { haptic(); selectDay(d); } }}>
            <span>${weekdayShort(d)}</span><b>${d % 100}</b><i></i>
          </button>`)}
      </div>
      <button class="icon-btn sm fill pointer-only" aria-label="Nächste Woche" disabled=${addDays(monday, 7) > t}
        style=${addDays(monday, 7) > t ? "opacity:.3" : ""} onClick=${() => shift(1)}>${Icon.right()}</button>
    </div>
    ${selected !== t && html`<div class="center" style="margin-top:8px">
      <button class="btn-plain btn" onClick=${() => { haptic(); selectDay(t); }}>Zurück zu heute</button></div>`}`;
}

// ── Kalorien ──
function CalorieCard({ t, g, d }) {
  const small = useMedia("(max-width: 374px)");
  const remaining = g.kcal - t.kcal;
  const over = remaining < 0;
  const ratio = t.kcal / g.kcal;
  const isToday = d === today();
  const dayDone = !isToday || new Date().getHours() >= 20;
  const floor = state.profile.sex === "m" ? 1500 : 1200;
  let coach;
  if (!t.count) coach = isToday ? "Noch nichts eingetragen – ein Foto genügt 📸" : "An diesem Tag gibt es keine Einträge.";
  else if (over) coach = "Etwas drüber – kein Problem. Entscheidend ist der Wochenschnitt.";
  else if (ratio > 0.9) coach = "Fast genau im Ziel – stark! 🎯";
  else if (dayDone && (t.kcal < floor || ratio < 0.6)) coach = "Eher wenig – alles eingetragen? Zu wenig zu essen macht es auf Dauer schwerer.";
  else if (ratio > 0.5) coach = "Du liegst gut im Plan 👍";
  else coach = "Guter Start – weiter so!";

  return html`
    <section class="card" aria-label="Kalorien">
      <div class="hero">
        <div class="hero-side"><div class="v num"><${CountUp} value=${t.kcal}/></div><div class="l">Gegessen</div></div>
        <${Ring} size=${small ? 148 : 184} stroke=${small ? 15 : 18} value=${Math.min(ratio, 1)}
          from=${over ? "var(--over-a)" : "var(--kcal-a)"} to=${over ? "var(--over-b)" : "var(--kcal-b)"}>
          <div class="ring-value"><${CountUp} value=${Math.abs(remaining)}/></div>
          <div class="ring-label">${over ? "kcal drüber" : "kcal übrig"}</div>
        </${Ring}>
        <div class="hero-side"><div class="v num">${n0(g.kcal)}</div><div class="l">Ziel</div></div>
      </div>
      <div class="macros">
        ${[["Kohlenhydrate", t.carbs, g.carbs, "var(--carbs)"], ["Eiweiß", t.protein, g.protein, "var(--protein)"], ["Fett", t.fat, g.fat, "var(--fat)"]].map(([l, v, goal, c]) => html`
          <div class="macro">
            <div class="l">${l}</div>
            <div class="v">${n0(v)} <small>/ ${n0(goal)} g</small></div>
            <${Bar} value=${v / goal} color=${c}/>
          </div>`)}
      </div>
      <div class="muted center" style="font-size:14px;margin-top:14px">${coach}</div>
    </section>`;
}

// ── Mahlzeit ──
function MealCard({ meal, day, kcal }) {
  const entries = day.log.filter((e) => e[E.meal] === meal.id);
  return html`
    <section class="card" aria-label=${meal.name}>
      <div class="meal-head">
        <div class="meal-emoji" style=${`background:color-mix(in srgb, ${meal.tint} 18%, transparent)`}>${meal.emoji}</div>
        <div class="grow">
          <div class="meal-name">${meal.name}</div>
          <div class="meal-sub">${entries.length ? html`<span class="num">${n0(kcal)}</span> kcal · ${entries.length} ${entries.length === 1 ? "Eintrag" : "Einträge"}` : "Noch nichts eingetragen"}</div>
        </div>
        <button class="icon-btn sm fill" aria-label=${`Foto für ${meal.name}`} onClick=${() => { haptic(); openCamera({ meal: meal.id, d: day.d }); }}>${Icon.camera()}</button>
        <button class="icon-btn tint" aria-label=${`${meal.name} hinzufügen`} onClick=${() => { haptic(); openAdd(meal.id, day.d); }}>${Icon.plus()}</button>
      </div>
      ${entries.length > 0 && html`<div class="entries">${entries.map((e) => html`<${EntryRow} key=${e[E.id]} entry=${e} d=${day.d}/>`)}</div>`}
    </section>`;
}

// Eintrag mit Wischen-zum-Löschen (wie in iOS-Listen).
// Antippen öffnet über onClick; ein Wischen oder Scrollen löst dagegen nichts aus.
function EntryRow({ entry, d }) {
  const inner = useRef();
  const row = useRef();
  const g = useRef(null);
  const swiped = useRef(false);
  const [open, setOpen] = useState(false);
  const WIDTH = 96;
  const hideDel = () => setTimeout(() => row.current?.classList.remove("swiping"), 360);
  const snap = (toOpen) => {
    if (!inner.current) return;
    inner.current.style.transition = "";
    inner.current.style.transform = toOpen ? `translateX(${-WIDTH}px)` : "";
    setOpen(toOpen);
    if (!toOpen) hideDel();
  };

  const down = (e) => {
    g.current = { x: e.clientX, y: e.clientY, dx: 0, horiz: null };
    swiped.current = false;
  };
  const move = (e) => {
    const s = g.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (s.horiz === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      s.horiz = Math.abs(dx) > Math.abs(dy);
      if (s.horiz) e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (s.horiz === null) return;
    swiped.current = true; // jede echte Bewegung (auch senkrecht) ist kein Antippen
    if (!s.horiz) return;
    row.current.classList.add("swiping");
    s.dx = Math.min(0, Math.max(-WIDTH * 1.6, dx + (open ? -WIDTH : 0)));
    inner.current.style.transition = "none";
    inner.current.style.transform = `translateX(${s.dx}px)`;
  };
  const up = () => {
    const s = g.current;
    g.current = null;
    if (!s || !s.horiz) return;
    if (s.dx < -WIDTH * 1.4) { del(); return; }
    const willOpen = s.dx < -WIDTH / 2;
    snap(willOpen);
    if (willOpen) haptic();
  };
  // Browser übernimmt das Scrollen: nur zurücksetzen, nichts öffnen
  const cancel = () => {
    const s = g.current;
    g.current = null;
    if (s && s.horiz) snap(open);
  };
  const click = () => {
    if (swiped.current) { swiped.current = false; return; }
    if (open) { snap(false); return; }
    haptic();
    openEntry(d, entry);
  };
  const del = async () => {
    haptic("heavy");
    if (inner.current) inner.current.style.transform = "translateX(-100%)";
    try { await deleteWithUndo(d, entry[E.id]); }
    catch (err) { toast(err.message, "⚠️"); if (inner.current) snap(false); }
  };

  return html`
    <div class="entry" ref=${row}>
      <button class="entry-del" onClick=${del} aria-label=${`${entry[E.name]} löschen`} tabindex=${open ? 0 : -1}>Löschen</button>
      <div ref=${inner} class="entry-inner" role="button" tabindex="0" aria-label=${`${entry[E.name]}, ${n0(entry[E.kcal])} kcal – bearbeiten`}
        onPointerDown=${down} onPointerMove=${move} onPointerUp=${up} onPointerCancel=${cancel} onClick=${click}
        onKeyDown=${(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openEntry(d, entry); } if (e.key === "Delete" || e.key === "Backspace") del(); }}>
        <${Thumb} id=${entry[E.id]} emoji=${entry[E.emoji]}/>
        <div class="grow">
          <div class="entry-name">${entry[E.name]}${entry[E.src] === "k" && html`<span class="badge-ai">KI</span>`}</div>
          <div class="entry-sub">${n0(entry[E.grams])} g · KH ${n0(entry[E.carbs])} · E ${n0(entry[E.protein])} · F ${n0(entry[E.fat])}</div>
        </div>
        <div class="entry-kcal">${n0(entry[E.kcal])} <span class="muted" style="font-size:13px;font-weight:500">kcal</span></div>
      </div>
    </div>`;
}

// ── Wasser ──
function WaterCard({ day, goal }) {
  const cup = 250;
  const filled = Math.round(day.water / cup);
  const count = Math.min(16, Math.max(Math.ceil(goal / cup), filled + 1));
  const tap = (i) => {
    haptic();
    const next = i < filled ? i * cup : (i + 1) * cup;
    setWater(day.d, next);
    if (next >= goal && day.water < goal) toast("Wasserziel erreicht!", "💧");
  };
  return html`
    <section class="card" aria-label="Wasser">
      <div class="row between">
        <div class="card-title" style="margin:0"><span class="icon-dot" style="background:color-mix(in srgb, var(--water) 16%, transparent);color:var(--water)">💧</span>Wasser</div>
        <div><span class="kpi" style="font-size:22px">${n1(day.water / 1000)}</span> <span class="muted" style="font-size:15px">/ ${n1(goal / 1000)} l</span></div>
      </div>
      <div class="cups" style=${`grid-template-columns:repeat(${count <= 8 ? count : Math.ceil(count / 2)},1fr)`}>
        ${Array.from({ length: count }, (_, i) => html`
          <button class=${cx("cup", i < filled && "full", i === filled && "next")} aria-label=${`Glas ${i + 1} (${(i + 1) * cup} ml)`}
            aria-pressed=${i < filled} onClick=${() => tap(i)}></button>`)}
      </div>
    </section>`;
}

// ── Gewicht ──
function WeightCard({ d, day }) {
  const s = state;
  const last = s.lastWeight;
  const start = s.profile.startWeight;
  const shown = day.weight ?? (d === today() ? last?.w : null);
  const delta = shown && start ? shown - start : 0;
  const gainGoal = (s.profile.goalWeight || 0) > (start || 0);
  const good = gainGoal ? delta >= 0 : delta <= 0;
  return html`
    <section class="card tap" aria-label="Gewicht" onClick=${() => { haptic(); openWeight(d); }}>
      <div class="row between">
        <div class="card-title" style="margin:0"><span class="icon-dot" style="background:color-mix(in srgb, var(--weight) 16%, transparent);color:var(--weight)">⚖️</span>Gewicht</div>
        <button type="button" class="btn btn-tint small" aria-label=${`Gewicht für ${longDate(d)} ${day.weight ? "ändern" : "eintragen"}`}
          onClick=${(e) => { e.stopPropagation(); haptic(); openWeight(d); }}>${day.weight ? "Ändern" : "Eintragen"}</button>
      </div>
      <div class="row" style="margin-top:10px;align-items:baseline;gap:10px">
        <div class="kpi">${shown ? n1(shown) : "–"} <small>kg</small></div>
        ${shown && start && Math.abs(delta) >= 0.05 && html`<div style=${`font-weight:600;font-size:15px;color:${good ? "var(--accent-text)" : "var(--over-b)"}`}>
          ${delta <= 0 ? "−" : "+"}${n1(Math.abs(delta))} kg seit Start</div>`}
        ${shown && start && Math.abs(delta) < 0.05 && html`<div class="muted" style="font-weight:600;font-size:15px">Startgewicht</div>`}
      </div>
      <div class="muted" style="font-size:13px;margin-top:4px">
        ${day.weight ? `Gewogen am ${shortDate(d)}` : last ? `Zuletzt gewogen am ${shortDate(last.d)}` : "Noch kein Gewicht eingetragen"}
        ${s.profile.goalWeight ? ` · Ziel ${n1(s.profile.goalWeight)} kg` : ""}
      </div>
    </section>`;
}

function TipCard({ d }) {
  const [e, title, text] = tipFor(d);
  return html`
    <section class="card tip" aria-label="Tipp des Tages">
      <div class="tip-icon">${e}</div>
      <div><div style="font-weight:600">${title}</div><p>${text}</p></div>
    </section>`;
}
