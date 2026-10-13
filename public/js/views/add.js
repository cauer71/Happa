// Hinzufügen: Suche (BLS lokal + Open Food Facts), zuletzt verwendet (je Mahlzeit), Portion, manuell.
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html, cx, haptic, today, addDays, uid, n0, n1, parseNum, debounce } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, openOverlay, closeOverlay, closeAll, addEntries, toast, pushRecent, recentFoods, loadRange, currentGoals, checkBadges, state } from "../store.js";
import { Sheet, Seg, Thumb } from "../ui.js";
import { MEALS, E, mealForNow, makeEntry, totals, foodEmoji, unitFor, unitOf, per100Of, gramsOf, kcalPer100 } from "../nutrition.js";
import { searchFoods, productAsFood } from "../foods.js";
import { api } from "../api.js";
import { openCamera } from "./camera.js";
import { FavoritesSection } from "./favorites.js";
import { getThumb, putThumb, deleteThumb } from "../thumbs.js";

const DRINKS = 4;
// „Zuletzt beim Frühstück“, „… bei Getränken“ (Dativ)
const MEAL_DATIVE = ["beim Frühstück", "beim Mittagessen", "beim Abendessen", "bei Snacks", "bei Getränken"];
export const mealOptions = MEALS.map((m) => ({ value: m.id, label: m.name.replace("essen", "") }));
const UNITS = [{ value: "g", label: "g" }, { value: "ml", label: "ml" }];
const gramText = (g) => String(Math.round(g * 10) / 10).replace(".", ",");

// ── Zuletzt verwendet, getrennt nach Mahlzeit ──
// Quelle ist das Tagebuch der letzten Tage (auch Einträge von anderen Geräten, per Foto oder über Claude).
// Unter „Snacks“ erscheinen so nur zuletzt gegessene Snacks, unter „Getränke“ nur Getränke usw.
const RECENT_DAYS = 30, RECENT_MAX = 15;
const SOURCE = { b: "BLS", o: "Open Food Facts", k: "KI-Schätzung", m: "Manuell" };
const nameKey = (n) => String(n || "").trim().replace(/\s+/g, " ").toLowerCase();

// Eintrag → Lebensmittel für die Vorschlagsliste. Ein auf dem Gerät gespeichertes Lebensmittel (Bild, Quelle,
// genaue Nährwerte pro 100 g) zählt nur, wenn es den letzten Eintrag exakt ergibt – KI- und eigene
// Schätzungen gleichen Namens können jedes Mal anders sein. Sonst rechnen wir aus dem Eintrag zurück.
function foodFromEntry(e, known) {
  const unit = unitOf(e), grams = e[E.grams];
  const base = { name: e[E.name], emoji: e[E.emoji] || foodEmoji(e[E.name]), src: e[E.src], thumbId: e[E.id], source: SOURCE[e[E.src]] || "" };
  if (!(grams > 0)) return { ...base, fixed: e, grams: 0 }; // ohne Menge eingetragen: als ganze Portion übernehmen
  if (known?.per100 && known.src === e[E.src] && unitFor(known) === unit) {
    const kcal = makeEntry({ id: "x", meal: 0, name: e[E.name], grams, per100: known.per100, src: e[E.src], unit, perMl: known.perMl })[E.kcal];
    if (Math.abs(kcal - e[E.kcal]) <= 1) return { ...known, name: e[E.name], emoji: base.emoji, thumbId: e[E.id], grams, unit };
  }
  return { ...base, per100: per100Of(e), grams, unit, perMl: unit === "ml" };
}

export function recentForMeal(days, meal, t = today()) {
  const known = new Map(recentFoods().map((f) => [nameKey(f.name), f]));
  const from = addDays(t, -RECENT_DAYS);
  const ds = Object.keys(days).map(Number).filter((d) => d >= from && d <= t).sort((a, b) => b - a);
  const seen = new Set(), out = [];
  for (const d of ds) {
    const log = days[d]?.log || [];
    for (let i = log.length - 1; i >= 0; i--) { // neueste Einträge zuerst
      const e = log[i];
      if (e[E.meal] !== meal) continue;
      const key = nameKey(e[E.name]) + "|" + (e[E.grams] > 0 ? unitOf(e) : "portion");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(foodFromEntry(e, known.get(nameKey(e[E.name]))));
      if (out.length >= RECENT_MAX) return out;
    }
  }
  return out;
}

export function remainingText(d) {
  const day = state.days[d];
  const left = currentGoals().kcal - totals(day?.log).kcal;
  return left >= 0 ? `noch ${n0(left)} kcal` : `${n0(-left)} kcal drüber`;
}

// Eintragen + Rückmeldung (von Suche, Portion, Kamera genutzt)
export async function commitEntries(d, entries, { thumb, foods = [] } = {}) {
  // Vorschaubild schon vor dem Speichern hinterlegen – die Liste zeigt den neuen Eintrag sofort an
  if (thumb) entries.forEach((e) => putThumb(e[0], thumb));
  try { await addEntries(d, entries, thumb); }
  catch (err) { if (thumb) entries.forEach((e) => deleteThumb(e[0])); throw err; }
  foods.forEach(([food, grams, unit]) => pushRecent(food, grams, unit));
  haptic("success");
  toast(`Eingetragen · ${remainingText(d)}`, "✅");
  checkBadges(d, { usedAi: entries.some((e) => e[8] === "k") });
}

export function openAdd(meal = mealForNow(), d = today()) {
  openOverlay((o) => html`<${AddSheet} ...${o} meal=${meal} d=${d}/>`);
}

function AddSheet({ id, closing, meal: initialMeal, d }) {
  const s = useStore();
  const [meal, setMeal] = useState(initialMeal);
  const [q, setQ] = useState("");
  const [local, setLocal] = useState([]);
  const [products, setProducts] = useState({ q: "", list: [], loading: false, error: null });
  // Letzte Tage einmal nachladen (nur fehlende), damit die Vorschläge je Mahlzeit vollständig sind
  useEffect(() => { const t = today(); loadRange(addDays(t, -RECENT_DAYS), t).catch(() => {}); }, []);
  const recent = useMemo(() => recentForMeal(s.days, meal), [s.days, meal]);
  const latest = useRef("");
  const aborter = useRef(null);
  useEffect(() => () => aborter.current?.abort(), []);

  useEffect(() => {
    let alive = true;
    if (q.trim().length < 2) { setLocal([]); return; }
    // Unter „Getränke“ stehen Getränke vorne (sonst kommt bei „Tee“ zuerst Teegebäck)
    const drinksFirst = (r) => (meal === DRINKS ? [...r.filter((f) => unitFor(f) === "ml"), ...r.filter((f) => unitFor(f) !== "ml")] : r);
    searchFoods(q, 30).then((r) => alive && setLocal(drinksFirst(r))).catch(() => alive && setLocal([]));
    return () => { alive = false; };
  }, [q, meal]);

  // Nur die Antwort auf den zuletzt getippten Begriff zählt; ältere werden abgebrochen.
  const fetchProducts = useMemo(() => debounce(async (term) => {
    latest.current = term;
    aborter.current?.abort();
    if (term.trim().length < 3) { setProducts({ q: term, list: [], loading: false }); return; }
    const ctrl = (aborter.current = new AbortController());
    setProducts((p) => ({ ...p, loading: true }));
    try {
      const { products: list } = await api(`/food/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
      if (term === latest.current) setProducts({ q: term, list: list.map(productAsFood), loading: false });
    } catch (err) {
      if (err.name === "AbortError" || term !== latest.current) return;
      setProducts({ q: term, list: [], loading: false, error: err.message });
    }
  }, 450), []);
  useEffect(() => { fetchProducts(q); }, [q]);
  const productList = products.q === q ? products.list : [];

  // Foto-Vorschaubild des letzten Eintrags mitnehmen (falls vorhanden)
  const thumbOf = async (food) => (food.thumbId ? getThumb(food.thumbId).catch(() => null) : null);
  const quickAdd = async (food) => {
    const thumb = await thumbOf(food);
    if (food.fixed) { // ganze Portion wie beim letzten Mal
      try { await commitEntries(d, [[uid(), meal, ...food.fixed.slice(2)]], { thumb }); }
      catch (err) { toast(err.message, "⚠️"); }
      return;
    }
    const unit = unitFor(food);
    const entry = makeEntry({ id: uid(), meal, name: food.name, grams: food.grams, per100: food.per100, src: food.src, emoji: food.emoji, unit, perMl: food.perMl });
    try { await commitEntries(d, [entry], { thumb, foods: [[food, food.grams, unit]] }); }
    catch (err) { toast(err.message, "⚠️"); }
  };
  const pick = async (food) => {
    haptic();
    if (food.fixed) {
      const e = food.fixed;
      openManual(meal, d, e[E.name], { kcal: e[E.kcal], carbs: e[E.carbs], protein: e[E.protein], fat: e[E.fat], emoji: e[E.emoji], src: e[E.src], unit: unitOf(e) });
    } else openPortion(food, meal, d, { thumb: await thumbOf(food) });
  };

  const Row = (food, i) => {
    const amount = food.fixed ? `${n0(food.fixed[E.kcal])} kcal` : `${gramText(food.grams)} ${unitFor(food)}`;
    return html`
    <div class="result" key=${food.name + i}>
      <button type="button" class="result-main" onClick=${() => pick(food)}
        aria-label=${food.fixed ? `${food.name}, ${amount} – bearbeiten und eintragen` : `${food.name}, ${n0(kcalPer100(food))} kcal pro 100 ${unitFor(food)} – Menge wählen`}>
        ${food.image ? html`<div class="entry-thumb" aria-hidden="true"><img src=${food.image} alt="" loading="lazy" referrerpolicy="no-referrer"
            onError=${(e) => { e.currentTarget.replaceWith(document.createTextNode(food.emoji)); }}/></div>`
          : food.thumbId ? html`<${Thumb} id=${food.thumbId} emoji=${food.emoji}/>`
          : html`<div class="entry-thumb" aria-hidden="true">${food.emoji}</div>`}
        <div class="grow">
          <div class="entry-name">${food.name}</div>
          <div class="entry-sub">${food.fixed ? `${amount} · Portion` : `${n0(kcalPer100(food))} kcal / 100 ${unitFor(food)} · ${amount} Portion`}${food.source ? " · " + food.source : ""}</div>
        </div>
      </button>
      <button type="button" class="result-add" aria-label=${`${food.name} direkt hinzufügen (${amount})`}
        onClick=${() => { haptic(); quickAdd(food); }}>${Icon.plus()}</button>
    </div>`;
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Hinzufügen" full>
      <${Seg} label="Mahlzeit" options=${mealOptions} value=${meal} onChange=${setMeal}/>
      <div class="search" style="margin-top:12px">
        ${Icon.search()}
        <input type="search" placeholder="Lebensmittel oder Produkt suchen" value=${q}
          enterkeyhint="search" autocomplete="off" autocorrect="off" spellcheck="false"
          onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Suchen"/>
        ${q && html`<button class="icon-btn sm" style="width:24px;height:24px" onClick=${() => setQ("")} aria-label="Leeren">${Icon.close()}</button>`}
      </div>

      ${!q && html`
        <div class="quick">
          <button onClick=${() => { closeOverlay(id, { replace: true }); openCamera({ meal, d }); }}>${Icon.camera()}Foto erkennen</button>
          <button onClick=${() => { closeOverlay(id, { replace: true }); openCamera({ meal, d, mode: "barcode" }); }}>${Icon.barcode()}Barcode</button>
          <button onClick=${() => openManual(meal, d)}>${Icon.pencil()}Manuell</button>
        </div>
        <${FavoritesSection} meal=${meal} d=${d}/>
        <div class="group-label">Zuletzt ${MEAL_DATIVE[meal] || "bei dieser Mahlzeit"}</div>
        ${recent.length ? html`<div class="results">${recent.map(Row)}</div>`
          : html`<div class="muted" style="font-size:15px;padding:8px 0">Hier erscheint, was du zuletzt ${MEAL_DATIVE[meal] || "bei dieser Mahlzeit"} eingetragen hast.</div>`}`}

      ${q && html`
        <${FavoritesSection} meal=${meal} d=${d} q=${q}/>
        <div class="group-label">Lebensmittel</div>
        ${local.length ? html`<div class="results">${local.map(Row)}</div>`
          : html`<div class="muted" style="font-size:15px;padding:6px 0">${q.trim().length < 2 ? "Mindestens 2 Buchstaben eingeben" : "Keine Treffer in der Lebensmitteldatenbank"}</div>`}
        <div class="group-label row between"><span>Markenprodukte</span>${products.loading && html`<span class="spinner" style="width:14px;height:14px;border-width:2px"></span>`}</div>
        ${productList.length ? html`<div class="results">${productList.map(Row)}</div>`
          : html`<div class="muted" style="font-size:15px;padding:6px 0">${products.loading ? "Suche bei Open Food Facts …" : products.error ? products.error : q.trim().length < 3 ? "Ab 3 Buchstaben wird auch bei Open Food Facts gesucht" : "Keine Produkte gefunden"}</div>`}
        <button class="btn btn-tint block" style="margin-top:18px" onClick=${() => openManual(meal, d, q)}>„${q}“ manuell eintragen</button>`}

      <p class="fine">Lebensmittel: Bundeslebensmittelschlüssel 4.0, Max Rubner-Institut (CC BY 4.0) · Produkte: Open Food Facts (ODbL)</p>
    </${Sheet}>`;
}

// ── Portion wählen ──
export function openPortion(food, meal, d, opts = {}) {
  openOverlay((o) => html`<${PortionSheet} ...${o} food=${food} meal=${meal} d=${d} ...${opts}/>`);
}

function PortionSheet({ id, closing, food, meal: initialMeal, d, thumb }) {
  const [meal, setMeal] = useState(initialMeal ?? mealForNow());
  const [text, setText] = useState(gramText(food.grams || 100));
  const [unit, setUnit] = useState(unitFor(food));
  const [imgOk, setImgOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const grams = Math.max(0, parseNum(text) || 0);
  const f = gramsOf(grams, unit, food.name, food.perMl) / 100;
  const base = unit === "ml" ? [100, 200, 250, 330, 500] : [50, 100, 150, 200, 250];
  const chips = [...new Set([food.grams, ...base].filter(Boolean))].sort((a, b) => a - b);
  const per100Unit = kcalPer100(food, unit);

  const add = async () => {
    if (!grams) return;
    setBusy(true);
    const entry = makeEntry({ id: uid(), meal, name: food.name, grams, per100: food.per100, src: food.src, emoji: food.emoji, unit, perMl: food.perMl });
    try {
      await commitEntries(d, [entry], { thumb, foods: [[food, grams, unit]] });
      closeAll();
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Menge"
      footer=${html`<button class="btn btn-primary block" disabled=${!grams || busy} onClick=${add}>
        ${busy ? html`<span class="spinner"></span>` : html`${Icon.plus()} Hinzufügen · ${n0(food.per100.kcal * f)} kcal`}</button>`}>
      <div class="food-hero">
        <div class="food-emoji">${food.image && imgOk ? html`<img src=${food.image} alt="" referrerpolicy="no-referrer" onError=${() => setImgOk(false)}/>` : food.emoji}</div>
        <div class="food-name">${food.name}</div>
        <div class="muted" style="font-size:14px">${n0(per100Unit)} kcal pro 100 ${unit}${food.source ? " · " + food.source : ""}</div>
      </div>
      <${Seg} label="Mahlzeit" options=${mealOptions} value=${meal} onChange=${setMeal}/>
      <div class="row between unit-head">
        <label class="label" for="grams">Menge</label>
        <div class="unit-seg"><${Seg} label="Einheit" options=${UNITS} value=${unit} onChange=${setUnit}/></div>
      </div>
      <div class="stepper">
        <button class="icon-btn fill" aria-label=${`10 ${unit} weniger`} onClick=${() => { haptic(); setText(gramText(Math.max(0, grams - 10))); }}>−</button>
        <div class="unit-input grow">
          <input id="grams" class="field num" inputmode="decimal" value=${text} onInput=${(e) => setText(e.currentTarget.value)}
            onFocus=${(e) => e.currentTarget.select()}/>
          <span>${unit}</span>
        </div>
        <button class="icon-btn fill" aria-label=${`10 ${unit} mehr`} onClick=${() => { haptic(); setText(gramText(grams + 10)); }}>+</button>
      </div>
      <div class="chips" style="margin-top:10px">
        ${chips.map((c) => html`<button class=${cx("chip", grams === c && "on")} aria-pressed=${grams === c} onClick=${() => { haptic(); setText(gramText(c)); }}>${gramText(c)} ${unit}</button>`)}
      </div>
      <div class="nutri">
        <div><b>${n0(food.per100.kcal * f)}</b><span>kcal</span></div>
        <div><b style="color:var(--carbs)">${n1(food.per100.carbs * f)}</b><span>KH g</span></div>
        <div><b style="color:var(--protein)">${n1(food.per100.protein * f)}</b><span>Eiweiß g</span></div>
        <div><b style="color:var(--fat)">${n1(food.per100.fat * f)}</b><span>Fett g</span></div>
      </div>
    </${Sheet}>`;
}

// ── Manuell eintragen ──
export function openManual(meal, d, name = "", preset = null) {
  openOverlay((o) => html`<${ManualSheet} ...${o} meal=${meal} d=${d} initialName=${name} preset=${preset}/>`);
}

// preset: Werte zum Vorbelegen (z. B. ein früherer Eintrag ohne Menge)
function ManualSheet({ id, closing, meal: initialMeal, d, initialName, preset }) {
  const [meal, setMeal] = useState(initialMeal ?? mealForNow());
  const txt = (x) => (x ? String(x).replace(".", ",") : "");
  const kcalTxt = Number.isFinite(preset?.kcal) ? String(preset.kcal).replace(".", ",") : ""; // auch 0 kcal vorbelegen
  const [v, setV] = useState({ name: initialName, kcal: kcalTxt, grams: "", carbs: txt(preset?.carbs), protein: txt(preset?.protein), fat: txt(preset?.fat) });
  const [busy, setBusy] = useState(false);
  const upd = (k) => (e) => setV({ ...v, [k]: e.currentTarget.value });
  const kcal = parseNum(v.kcal);
  const valid = v.name.trim() && kcal >= 0 && Number.isFinite(kcal);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const grams = parseNum(v.grams) || 0;
    const num = (x) => Math.max(0, parseNum(x) || 0);
    const name = v.name.trim();
    // Vorbelegt aus einem früheren Eintrag: Emoji und ml behalten, solange der Name gleich ist;
    // die Quelle (z. B. KI-Schätzung) nur, wenn nichts geändert wurde
    const same = !!preset && nameKey(name) === nameKey(initialName);
    const unchanged = same && !grams && Math.round(kcal) === Math.round(preset.kcal || 0)
      && ["protein", "carbs", "fat"].every((k) => Math.abs(num(v[k]) - (preset[k] || 0)) < 0.05);
    const entry = [uid(), meal, name, grams, Math.round(kcal), num(v.protein), num(v.carbs), num(v.fat),
      unchanged ? preset.src || "m" : "m", same && preset.emoji ? preset.emoji : foodEmoji(name)];
    if (same && preset.unit === "ml") entry.push("ml");
    try { await commitEntries(d, [entry]); closeAll(); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  const field = (k, label, ph, mode = "decimal") => html`
    <label class="label" for=${"m-" + k}>${label}</label>
    <input id=${"m-" + k} class="field" inputmode=${mode} placeholder=${ph} value=${v[k]} onInput=${upd(k)}/>`;

  return html`
    <${Sheet} id=${id} closing=${closing} title="Manuell eintragen"
      footer=${html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${save}>Eintragen</button>`}>
      <${Seg} label="Mahlzeit" options=${mealOptions} value=${meal} onChange=${setMeal}/>
      ${field("name", "Bezeichnung", "z. B. Omas Apfelkuchen", "text")}
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="grow">${field("kcal", "Kalorien (kcal)", "z. B. 250")}</div>
        <div class="grow">${field("grams", "Menge (g, optional)", "–")}</div>
      </div>
      <div class="row" style="gap:10px;align-items:flex-start">
        <div class="grow">${field("carbs", "KH (g)", "–")}</div>
        <div class="grow">${field("protein", "Eiweiß (g)", "–")}</div>
        <div class="grow">${field("fat", "Fett (g)", "–")}</div>
      </div>
    </${Sheet}>`;
}
