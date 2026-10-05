// Erster Start: Profil anlegen und einen realistischen Plan berechnen.
import { useState } from "preact/hooks";
import { html, cx, haptic, n0, n1, liters, parseNum, today } from "../util.js";
import { Icon } from "../icons.js";
import { state, set, saveProfile, setWeight, toast, checkBadges } from "../store.js";
import { Seg, Ring, CountUp } from "../ui.js";
import { ACTIVITY, SEXES, PACES, plan, bmi } from "../nutrition.js";

const STEPS = ["welcome", "about", "weight", "activity", "pace", "plan"];

export function Onboarding() {
  const guess = (state.email.split("@")[0] || "").split(/[._-]/)[0];
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState({
    name: guess && !state.email.startsWith("service:") ? guess[0].toUpperCase() + guess.slice(1) : "",
    sex: "f", born: "", height: "", weight: "", goal: "", activity: "light", pace: 0.5,
  });
  const up = (k) => (e) => setV({ ...v, [k]: e.currentTarget ? e.currentTarget.value : e });

  const year = new Date().getFullYear();
  const born = parseNum(v.born), height = parseNum(v.height), weight = parseNum(v.weight), goal = parseNum(v.goal);
  const minGoal = height ? Math.ceil(18.5 * (height / 100) ** 2 * 10) / 10 : 0;
  const bornOk = born >= year - 100 && born <= year - 18;
  const heightOk = height >= 120 && height <= 230;
  const weightOk = weight >= 30 && weight <= 400;
  const goalOk = goal >= Math.max(30, minGoal) && goal <= 400;
  const ok = {
    welcome: v.name.trim().length > 0,
    about: bornOk && heightOk,
    weight: weightOk && goalOk,
    activity: !!v.activity,
    pace: true,
    plan: true,
  };
  const key = STEPS[step];
  const losing = goal < weight - 0.3;
  const profile = {
    name: v.name.trim(), sex: v.sex, born: Math.round(born), height: Math.round(height),
    startWeight: Math.round(weight * 10) / 10, goalWeight: Math.round(goal * 10) / 10,
    activity: v.activity, pace: losing ? v.pace : 0.25, startDate: today(), badges: {},
  };
  const p = ok.about && ok.weight ? plan(profile, weight) : null;

  const next = async () => {
    haptic();
    // Das Tempo ist nur beim Abnehmen eine Frage
    if (key === "activity" && !losing) { setStep(STEPS.indexOf("plan")); return; }
    if (key !== "plan") { setStep(step + 1); return; }
    setBusy(true);
    try {
      await saveProfile(profile);
      await setWeight(today(), profile.startWeight);
      haptic("success");
      set({ phase: "app", tab: "heute" });
      toast(`Willkommen, ${profile.name}!`, "👋");
      setTimeout(() => checkBadges(today()), 800);
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const back = () => {
    haptic();
    if (key === "plan" && !losing) setStep(STEPS.indexOf("activity"));
    else setStep(Math.max(0, step - 1));
  };

  return html`
    <main class="onb">
      <div class="onb-top">
        <div style="width:44px">${step > 0 && html`<button class="icon-btn fill sm" aria-label="Zurück" onClick=${back}>${Icon.back()}</button>`}</div>
        <div class="dots" aria-hidden="true">${STEPS.map((_, i) => html`<i class=${i === step ? "on" : ""}></i>`)}</div>
        <div style="width:44px"></div>
      </div>

      <div class="onb-body" key=${key}>
        ${key === "welcome" && html`
          <div class="onb-hero"><img src="/icons/icon.svg" alt=""/></div>
          <h1 class="center">Willkommen bei Happa</h1>
          <p class="lead center">Regelmäßiges Eintragen hilft nachweislich beim Abnehmen – und mit Happa genügt dafür ein Foto: Happa erkennt dein Essen.</p>
          <label class="label" for="o-name">Wie heißt du?</label>
          <input id="o-name" class="field" value=${v.name} autocomplete="given-name" onInput=${up("name")} placeholder="Vorname"/>`}

        ${key === "about" && html`
          <h1>Ein paar Eckdaten</h1>
          <p class="lead">Damit berechnet Happa deinen Energiebedarf.</p>
          <label class="label">Geschlecht</label>
          <${Seg} label="Geschlecht" options=${SEXES.map((x) => ({ value: x.id, label: x.name }))} value=${v.sex} onChange=${(x) => setV({ ...v, sex: x })}/>
          <div class="row" style="gap:10px;align-items:flex-start">
            <div class="grow"><label class="label" for="o-born">Geburtsjahr</label><input id="o-born" class="field num" inputmode="numeric" placeholder="z. B. 1985" value=${v.born} onInput=${up("born")}/></div>
            <div class="grow"><label class="label" for="o-height">Größe</label><div class="unit-input"><input id="o-height" class="field num" inputmode="numeric" placeholder="170" value=${v.height} onInput=${up("height")}/><span>cm</span></div></div>
          </div>
          ${v.born && !bornOk && html`<div class="field-hint">${born > year - 18 && born <= year ? "Happa ist für Erwachsene gedacht – für Jugendliche gelten andere Richtwerte." : "Bitte ein vierstelliges Geburtsjahr eingeben."}</div>`}
          ${v.height && !heightOk && html`<div class="field-hint">Bitte die Größe in cm angeben (120–230).</div>`}`}

        ${key === "weight" && html`
          <h1>Dein Gewicht</h1>
          <p class="lead">Wo stehst du, wo willst du hin?</p>
          <label class="label" for="o-weight">Aktuelles Gewicht</label>
          <div class="unit-input"><input id="o-weight" class="field num" inputmode="decimal" placeholder="z. B. 78,5" value=${v.weight} onInput=${up("weight")}/><span>kg</span></div>
          <label class="label" for="o-goal">Zielgewicht</label>
          <div class="unit-input"><input id="o-goal" class="field num" inputmode="decimal" placeholder="z. B. 72" value=${v.goal} onInput=${up("goal")}/><span>kg</span></div>
          ${weight > 0 && height > 0 && html`<div class="info-box">📊 Dein BMI: <b>${n1(bmi(weight, height))}</b>${goal > 0 ? html` · am Ziel: <b>${n1(bmi(goal, height))}</b>` : ""}. Gesund ist ein BMI zwischen 18,5 und 25.</div>`}
          ${v.weight && !weightOk && html`<div class="field-hint">Bitte ein Gewicht zwischen 30 und 400 kg eingeben.</div>`}
          ${goal > 0 && goal < minGoal && html`<div class="info-box warn">⚠️ Unter ${n1(minGoal)} kg läge dein BMI unter 18,5 (Untergewicht). Bitte wähle ein höheres Ziel.</div>`}
          ${goal > 400 && html`<div class="field-hint">Bitte ein Zielgewicht bis 400 kg eingeben.</div>`}
          ${!height && html`<div class="field-hint">Für die BMI-Prüfung bitte zuerst die Größe angeben.</div>`}`}

        ${key === "activity" && html`
          <h1>Wie aktiv bist du?</h1>
          <p class="lead">Wie viel bewegst du dich in einer normalen Woche – Alltag und Sport zusammen?</p>
          <div class="choices">
            ${ACTIVITY.map((a) => html`<button class=${cx("choice", v.activity === a.id && "on")} aria-pressed=${v.activity === a.id} onClick=${() => { haptic(); setV({ ...v, activity: a.id }); }}>
              <span class="e">${a.e}</span><div class="grow"><b>${a.name}</b><small>${a.desc}</small></div></button>`)}
          </div>`}

        ${key === "pace" && html`
          <h1>Dein Tempo</h1>
          <p class="lead">Ein moderates Tempo ist leichter durchzuhalten – und das Gewicht bleibt danach eher unten.</p>
          <div class="choices">
            ${PACES.map((x) => html`<button class=${cx("choice", v.pace === x.v && "on")} aria-pressed=${v.pace === x.v} onClick=${() => { haptic(); setV({ ...v, pace: x.v }); }}>
              <span class="e">${x.v === 0.5 ? "🐇" : "🐢"}</span><div class="grow"><b>${x.name}</b><small>${x.desc}</small></div></button>`)}
          </div>
          <div class="info-box">💡 Happa plant höchstens 0,5 kg pro Woche – ein Tempo, das sich gut durchhalten lässt.</div>`}

        ${key === "plan" && p && html`
          <h1 class="center">Dein Plan, ${profile.name}</h1>
          <div class="plan-ring">
            <${Ring} size=${210} stroke=${20} value=${0.72}>
              <div class="ring-value" style="font-size:44px"><${CountUp} value=${p.kcal} ms=${1400}/></div>
              <div class="ring-label">kcal pro Tag</div>
            </${Ring}>
          </div>
          <div class="nutri" style="margin-top:0">
            <div><b style="color:var(--carbs)">${p.carbs}</b><span>KH g</span></div>
            <div><b style="color:var(--protein)">${p.protein}</b><span>Eiweiß g</span></div>
            <div><b style="color:var(--fat)">${p.fat}</b><span>Fett g</span></div>
            <div><b style="color:var(--water)">${liters(p.water)}</b><span>Wasser l</span></div>
          </div>
          ${p.mode === "lose" && p.eta ? html`<div class="info-box">📅 Mit ${n1(p.pace)} kg pro Woche erreichst du <b>${n1(profile.goalWeight)} kg</b> voraussichtlich im <b>${new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(p.eta)}</b>.</div>`
            : p.mode === "lose" ? html`<div class="info-box warn">An der Sicherheitsgrenze reicht das Kaloriendefizit kaum – mehr Bewegung hilft hier am meisten. Happa begleitet dich trotzdem.</div>`
            : p.mode === "gain" ? html`<div class="info-box">📈 Plan für eine langsame Zunahme bis <b>${n1(profile.goalWeight)} kg</b>.</div>`
            : html`<div class="info-box">⚖️ Plan zum Halten deines Gewichts.</div>`}
          ${p.floored && html`<div class="info-box warn">Aus Sicherheitsgründen plant Happa nicht unter ${profile.sex === "m" ? "1.500" : "1.200"} kcal pro Tag – dein Tempo ist deshalb etwas langsamer.</div>`}
          <p class="fine">Grundumsatz ${n0(p.bmr)} kcal · Gesamtumsatz ${n0(p.tdee)} kcal (Mifflin-St Jeor). Du kannst alles später im Profil ändern. Happa ersetzt keine ärztliche Beratung.</p>`}
      </div>

      <button class="btn btn-primary block" disabled=${!ok[key] || busy} onClick=${next}>
        ${busy ? html`<span class="spinner"></span>` : key === "plan" ? "Los geht’s" : "Weiter"}
      </button>
    </main>`;
}
