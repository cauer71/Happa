// Hinzufügen: Suche (BLS lokal + Open Food Facts), zuletzt verwendet, Portion, manuell.
import { useState, useEffect, useRef, useMemo } from "preact/hooks";
import { html, cx, haptic, today, uid, n0, n1, parseNum, debounce } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, openOverlay, closeOverlay, closeAll, addEntries, toast, pushRecent, recentFoods, currentGoals, checkBadges, state } from "../store.js";
import { Sheet, Seg } from "../ui.js";
import { MEALS, mealForNow, makeEntry, totals, foodEmoji, unitFor, gramsOf, kcalPer100 } from "../nutrition.js";
import { searchFoods, productAsFood } from "../foods.js";
import { api } from "../api.js";
import { openCamera } from "./camera.js";
import { FavoritesSection } from "./favorites.js";

export const mealOptions = MEALS.map((m) => ({ value: m.id, label: m.name.replace("essen", "") }));
const UNITS = [{ value: "g", label: "g" }, { value: "ml", label: "ml" }];
const gramText = (g) => String(Math.round(g * 10) / 10).replace(".", ",");

export function remainingText(d) {
  const day = state.days[d];
  const left = currentGoals().kcal - totals(day?.log).kcal;
  return left >= 0 ? `noch ${n0(left)} kcal` : `${n0(-left)} kcal drüber`;
}

// Eintragen + Rückmeldung (von Suche, Portion, Kamera genutzt)
export async function commitEntries(d, entries, { thumb, foods = [] } = {}) {
  await addEntries(d, entries, thumb);
  foods.forEach(([food, grams, unit]) => pushRecent(food, grams, unit));
  haptic("success");
  toast(`Eingetragen · ${remainingText(d)}`, "✅");
  checkBadges(d, { usedAi: entries.some((e) => e[8] === "k") });
}

export function openAdd(meal = mealForNow(), d = today()) {
  openOverlay((o) => html`<${AddSheet} ...${o} meal=${meal} d=${d}/>`);
}

function AddSheet({ id, closing, meal: initialMeal, d }) {
  useStore();
  const [meal, setMeal] = useState(initialMeal);
  const [q, setQ] = useState("");
  const [local, setLocal] = useState([]);
  const [products, setProducts] = useState({ q: "", list: [], loading: false, error: null });
  const recent = useMemo(() => recentFoods(), []);
  const latest = useRef("");
  const aborter = useRef(null);
  useEffect(() => () => aborter.current?.abort(), []);

  useEffect(() => {
    let alive = true;
    if (q.trim().length < 2) { setLocal([]); return; }
    searchFoods(q, 30).then((r) => alive && setLocal(r)).catch(() => alive && setLocal([]));
    return () => { alive = false; };
  }, [q]);

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

  const quickAdd = async (food) => {
    const unit = unitFor(food);
    const entry = makeEntry({ id: uid(), meal, name: food.name, grams: food.grams, per100: food.per100, src: food.src, emoji: food.emoji, unit, perMl: food.perMl });
    try { await commitEntries(d, [entry], { foods: [[food, food.grams, unit]] }); }
    catch (err) { toast(err.message, "⚠️"); }
  };
  const pick = (food) => { haptic(); openPortion(food, meal, d); };

  const Row = (food, i) => html`
    <div class="result" key=${food.name + i}>
      <button type="button" class="result-main" onClick=${() => pick(food)} aria-label=${`${food.name}, ${n0(kcalPer100(food))} kcal pro 100 ${unitFor(food)} – Menge wählen`}>
        <div class="entry-thumb" aria-hidden="true">${food.image ? html`<img src=${food.image} alt="" loading="lazy" referrerpolicy="no-referrer"
          onError=${(e) => { e.currentTarget.replaceWith(document.createTextNode(food.emoji)); }}/>` : food.emoji}</div>
        <div class="grow">
          <div class="entry-name">${food.name}</div>
          <div class="entry-sub">${n0(kcalPer100(food))} kcal / 100 ${unitFor(food)} · ${gramText(food.grams)} ${unitFor(food)} Portion${food.source ? " · " + food.source : ""}</div>
        </div>
      </button>
      <button type="button" class="result-add" aria-label=${`${food.name} direkt hinzufügen (${gramText(food.grams)} ${unitFor(food)})`}
        onClick=${() => { haptic(); quickAdd(food); }}>${Icon.plus()}</button>
    </div>`;

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
        <div class="group-label">Zuletzt verwendet</div>
        ${recent.length ? html`<div class="results">${recent.map(Row)}</div>`
          : html`<div class="muted" style="font-size:15px;padding:8px 0">Hier erscheinen deine zuletzt verwendeten Lebensmittel, sobald du etwas eingetragen hast.</div>`}`}

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
export function openManual(meal, d, name = "") {
  openOverlay((o) => html`<${ManualSheet} ...${o} meal=${meal} d=${d} initialName=${name}/>`);
}

function ManualSheet({ id, closing, meal: initialMeal, d, initialName }) {
  const [meal, setMeal] = useState(initialMeal ?? mealForNow());
  const [v, setV] = useState({ name: initialName, kcal: "", grams: "", carbs: "", protein: "", fat: "" });
  const [busy, setBusy] = useState(false);
  const upd = (k) => (e) => setV({ ...v, [k]: e.currentTarget.value });
  const kcal = parseNum(v.kcal);
  const valid = v.name.trim() && kcal >= 0 && Number.isFinite(kcal);

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    const grams = parseNum(v.grams) || 0;
    const num = (x) => Math.max(0, parseNum(x) || 0);
    const entry = [uid(), meal, v.name.trim(), grams, Math.round(kcal), num(v.protein), num(v.carbs), num(v.fat), "m", foodEmoji(v.name)];
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
