// Favoriten: gespeicherte Mahlzeit-Kombinationen mit frei wählbarem Namen
// (z. B. „Pasta-Abend“ = 300 g Spaghetti + 25 g Thunfisch + 330 ml helles Bier).
// Gespeichert im Profil (auf allen Geräten gleich): profile.favorites =
//   [{ id, n: Name, items: [[Name, Menge, kcal, Eiweiß, KH, Fett, Quelle, Emoji, Einheit?], …] }]
// Einheit "ml" bei Getränken (Menge dann in Millilitern), sonst Gramm.
import { useState, useEffect } from "preact/hooks";
import { html, cx, haptic, uid, n0, n1, parseNum } from "../util.js";
import { Icon } from "../icons.js";
import { useStore, openOverlay, closeOverlay, closeAll, saveProfile, toast, state } from "../store.js";
import { Sheet, Seg } from "../ui.js";
import { E, makeEntry, mealForNow, MEALS, unitOf, unitFor, density, kcalPer100 } from "../nutrition.js";
import { searchFoods } from "../foods.js";
import { commitEntries, mealOptions } from "./add.js";

export const MAX_FAVORITES = 30;
const MAX_ITEMS = 15;
const gramText = (g) => String(Math.round(g * 10) / 10).replace(".", ",");

export const favorites = () => (Array.isArray(state.profile.favorites) ? state.profile.favorites : []);
const per100 = (it) => { const g = it[1] || 100; return { kcal: it[2] * 100 / g, protein: it[3] * 100 / g, carbs: it[4] * 100 / g, fat: it[5] * 100 / g }; };
// Favorit, der genau diese Einträge enthält (gleiche Namen und Mengen), sonst null
const itemKey = (name, amount) => `${String(name).trim().toLowerCase()}|${Math.round((amount || 0) * 10)}`;
export function favoriteFor(entries) {
  if (!entries.length) return null;
  const want = entries.map((e) => itemKey(e[E.name], e[E.grams])).sort().join("\n");
  return favorites().find((f) => f.items.length === entries.length && f.items.map((it) => itemKey(it[0], it[1])).sort().join("\n") === want) || null;
}
export const favKcal = (fav) => fav.items.reduce((a, it) => a + (it[2] || 0), 0);
const favEmoji = (fav) => fav.items.find((it) => it[7])?.[7] || "⭐";

// Favorit → neue Einträge für eine Mahlzeit
function toEntries(items, meal) {
  return items.map((it) => makeEntry({ id: uid(), meal, name: it.name, grams: it.grams, per100: it.per100, src: it.src, emoji: it.emoji, unit: it.unit, perMl: true }));
}

async function writeFavorites(list) {
  await saveProfile({ favorites: list });
}

export async function addFavoriteToMeal(fav, meal, d) {
  haptic();
  try { await commitEntries(d, toEntries(fav.items.map(fromStored), meal)); }
  catch (err) { toast(err.message, "⚠️"); }
}

// Gespeichertes Format ↔ Bearbeitungsformat
// per100 gilt hier immer pro 100 der Einheit des Teils (g oder ml)
const fromStored = (it) => ({ key: uid(), name: it[0], grams: it[1], text: gramText(it[1]), per100: per100(it), src: it[6] || "m", emoji: it[7] || "", unit: it[8] === "ml" ? "ml" : "g" });
const fromEntry = (e) => ({ key: uid(), name: e[E.name], grams: e[E.grams], text: gramText(e[E.grams]),
  per100: per100([e[E.name], e[E.grams], e[E.kcal], e[E.protein], e[E.carbs], e[E.fat]]), src: e[E.src], emoji: e[E.emoji], unit: unitOf(e) });
const toStored = (it) => {
  const g = Math.max(0, parseNum(it.text) || 0), f = g / 100;
  const out = [it.name.slice(0, 80), Math.round(g * 10) / 10, Math.round(it.per100.kcal * f), Math.round(it.per100.protein * f * 10) / 10,
    Math.round(it.per100.carbs * f * 10) / 10, Math.round(it.per100.fat * f * 10) / 10, it.src || "m", it.emoji || ""];
  if (it.unit === "ml") out.push("ml");
  return out;
};
const scale = (p, k) => ({ kcal: p.kcal * k, protein: p.protein * k, carbs: p.carbs * k, fat: p.fat * k });

// Öffnet einen Favoriten (fav), legt aus Einträgen einen neuen an (entries) oder einen leeren
export function openFavorite({ fav = null, entries = null, meal = mealForNow(), d = state.today } = {}) {
  haptic();
  openOverlay((o) => html`<${FavoriteSheet} ...${o} fav=${fav} entries=${entries} meal=${meal} d=${d}/>`);
}

function FavoriteSheet({ id, closing, fav, entries, meal: initialMeal, d }) {
  useStore();
  const isNew = !fav;
  const [name, setName] = useState(fav ? fav.n : entries?.length ? suggestName(entries) : "");
  const [items, setItems] = useState(() => fav ? fav.items.map(fromStored) : (entries || []).map(fromEntry));
  const [meal, setMeal] = useState(initialMeal);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    if (q.trim().length < 2) { setHits([]); return; }
    searchFoods(q, 6).then((r) => alive && setHits(r)).catch(() => alive && setHits([]));
    return () => { alive = false; };
  }, [q]);

  const stored = items.map(toStored).filter((it) => it[1] > 0);
  const kcal = stored.reduce((a, it) => a + it[2], 0);
  const macros = stored.reduce((a, it) => ({ p: a.p + it[3], c: a.c + it[4], f: a.f + it[5] }), { p: 0, c: 0, f: 0 });
  const valid = name.trim().length > 0 && stored.length > 0;
  const changed = isNew || name.trim() !== fav.n || JSON.stringify(stored) !== JSON.stringify(fav.items);

  const update = (key, patch) => setItems(items.map((it) => it.key === key ? { ...it, ...patch } : it));
  // g ↔ ml umschalten: Nährwerte pro 100 über die Dichte umrechnen
  const toggleUnit = (it) => {
    haptic();
    const next = it.unit === "ml" ? "g" : "ml";
    const k = next === "ml" ? density(it.name) : 1 / density(it.name);
    update(it.key, { unit: next, per100: scale(it.per100, k) });
  };
  const remove = (key) => { haptic(); setItems(items.filter((it) => it.key !== key)); };
  const addFood = (food) => {
    haptic();
    if (items.length >= MAX_ITEMS) { toast(`Höchstens ${MAX_ITEMS} Teile pro Favorit`, "⚠️"); return; }
    const unit = unitFor(food);
    const p100 = unit === "ml" && !food.perMl ? scale(food.per100, density(food.name)) : food.per100;
    setItems([...items, { key: uid(), name: food.name, grams: food.grams, text: gramText(food.grams || 100), per100: p100, src: food.src, emoji: food.emoji, unit }]);
    setQ("");
  };

  const save = async () => {
    if (!valid) return null;
    const list = favorites();
    if (isNew && list.length >= MAX_FAVORITES) { toast(`Höchstens ${MAX_FAVORITES} Favoriten`, "⚠️"); return null; }
    const clash = list.find((x) => x.id !== fav?.id && x.n.toLowerCase() === name.trim().toLowerCase());
    if (clash) { toast(`„${clash.n}“ gibt es schon – bitte einen anderen Namen wählen`, "⚠️"); return null; }
    const entry = { id: fav?.id || uid(), n: name.trim().slice(0, 40), items: stored.slice(0, MAX_ITEMS) };
    const next = isNew ? [entry, ...list] : list.map((x) => x.id === entry.id ? entry : x);
    await writeFavorites(next);
    return entry;
  };

  const onSave = async () => {
    setBusy(true);
    try {
      const saved = await save();
      if (saved) { haptic("success"); toast(isNew ? `Favorit „${saved.n}“ gespeichert` : "Favorit gespeichert", "⭐"); closeOverlay(id); }
      else setBusy(false);
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const onLog = async () => {
    setBusy(true);
    try {
      if (changed && !isNew) await save();
      await commitEntries(d, toEntries(stored.map(fromStored), meal));
      closeAll();
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const onDelete = async () => {
    if (!confirmDelete) { haptic(); setConfirmDelete(true); return; }
    setBusy(true);
    try { await writeFavorites(favorites().filter((x) => x.id !== fav.id)); toast("Favorit gelöscht", "🗑️"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  const footer = isNew
    ? html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${onSave}>${busy ? html`<span class="spinner"></span>` : html`${Icon.star()} Als Favorit speichern`}</button>`
    : html`<div class="row" style="gap:10px">
        ${changed && html`<button class="btn btn-glass" disabled=${!valid || busy} onClick=${onSave}>Speichern</button>`}
        <button class="btn btn-primary grow" style="white-space:nowrap" disabled=${!valid || busy} onClick=${onLog}>${busy ? html`<span class="spinner"></span>` : changed ? `Eintragen · ${n0(kcal)} kcal` : html`${Icon.plus()} Eintragen · ${n0(kcal)} kcal`}</button>
      </div>`;

  return html`
    <${Sheet} id=${id} closing=${closing} title=${isNew ? "Neuer Favorit" : "Favorit"} full footer=${footer}>
      <label class="label" for="fav-name">Name</label>
      <input id="fav-name" class="field" value=${name} maxlength="40" placeholder="z. B. Pasta-Abend" autocomplete="off"
        onInput=${(e) => setName(e.currentTarget.value)}/>

      <div class="label">Zusammenstellung</div>
      ${items.length ? html`<div class="fav-items">
        ${items.map((it) => {
          const g = Math.max(0, parseNum(it.text) || 0);
          return html`<div class="fav-item" key=${it.key}>
            <span class="fav-emoji" aria-hidden="true">${it.emoji || "🍽️"}</span>
            <div class="grow" style="min-width:0">
              <div class="entry-name">${it.name}</div>
              <div class="entry-sub">${n0(it.per100.kcal * g / 100)} kcal</div>
            </div>
            <div class="unit-input fav-grams"><input class="field num" inputmode="decimal" value=${it.text} aria-label=${`Menge ${it.name}`}
              onFocus=${(e) => e.currentTarget.select()} onInput=${(e) => update(it.key, { text: e.currentTarget.value })}/><button type="button" class="unit-toggle" onClick=${() => toggleUnit(it)}
              aria-label=${`Einheit ${it.unit === "ml" ? "Milliliter" : "Gramm"}, tippen zum Wechseln`}>${it.unit === "ml" ? "ml" : "g"}</button></div>
            <button class="icon-btn sm fill" aria-label=${`${it.name} entfernen`} onClick=${() => remove(it.key)}>${Icon.close()}</button>
          </div>`;
        })}
      </div>` : html`<div class="muted" style="font-size:15px;padding:4px 0 8px">Noch leer – füge unten Lebensmittel hinzu.</div>`}

      <div class="search" style="margin-top:10px">
        ${Icon.search()}
        <input type="search" placeholder="Lebensmittel hinzufügen" value=${q} autocomplete="off" autocorrect="off" spellcheck="false"
          enterkeyhint="search" onInput=${(e) => setQ(e.currentTarget.value)} aria-label="Lebensmittel zum Favoriten hinzufügen"/>
      </div>
      ${hits.length > 0 && html`<div class="results" style="margin-top:6px">${hits.map((f, i) => html`
        <div class="result" key=${f.name + i}>
          <button type="button" class="result-main" onClick=${() => addFood(f)} aria-label=${`${f.name} hinzufügen`}>
            <div class="entry-thumb" aria-hidden="true">${f.emoji}</div>
            <div class="grow"><div class="entry-name">${f.name}</div><div class="entry-sub">${n0(kcalPer100(f))} kcal / 100 ${unitFor(f)} · ${gramText(f.grams)} ${unitFor(f)}</div></div>
          </button>
          <button type="button" class="result-add" aria-label=${`${f.name} hinzufügen`} onClick=${() => addFood(f)}>${Icon.plus()}</button>
        </div>`)}</div>`}

      ${stored.length > 0 && html`<div class="nutri">
        <div><b>${n0(kcal)}</b><span>kcal</span></div>
        <div><b style="color:var(--carbs)">${n1(macros.c)}</b><span>KH g</span></div>
        <div><b style="color:var(--protein)">${n1(macros.p)}</b><span>Eiweiß g</span></div>
        <div><b style="color:var(--fat)">${n1(macros.f)}</b><span>Fett g</span></div>
      </div>`}

      ${!isNew && html`
        <label class="label">Eintragen zu</label>
        <${Seg} label="Mahlzeit" options=${mealOptions} value=${meal} onChange=${setMeal}/>
        <button class=${cx("btn block fav-delete", confirmDelete && "confirm")} style="margin-top:22px" disabled=${busy} onClick=${onDelete}>
          ${Icon.trash()} ${confirmDelete ? "Wirklich löschen?" : "Favorit löschen"}</button>`}
    </${Sheet}>`;
}

function suggestName(entries) {
  const names = entries.map((e) => String(e[E.name]).split(/[,(]/)[0].trim()).filter(Boolean);
  const s = names.slice(0, 3).join(" + ");
  return s.length > 40 ? s.slice(0, 39) + "…" : s;
}

// Bereich im Hinzufügen-Dialog
export function FavoritesSection({ meal, d, q = "" }) {
  const s = useStore();
  const list = favorites();
  const term = q.trim().toLowerCase();
  const shown = term ? list.filter((f) => f.n.toLowerCase().includes(term)) : list;
  if (term && !shown.length) return null;
  const mealName = MEALS[meal]?.name || "";
  return html`
    <div class="group-label row between"><span>Favoriten</span>
      ${!term && html`<button class="link-btn" onClick=${() => openFavorite({ meal, d })}>${Icon.plus()} Neuer Favorit</button>`}</div>
    ${shown.length ? html`<div class="results">${shown.map((f) => html`
      <div class="result" key=${f.id}>
        <button type="button" class="result-main" onClick=${() => openFavorite({ fav: f, meal, d })} aria-label=${`Favorit ${f.n} öffnen`}>
          <div class="entry-thumb fav-thumb" aria-hidden="true">${favEmoji(f)}</div>
          <div class="grow">
            <div class="entry-name">${f.n}</div>
            <div class="entry-sub">${f.items.length} ${f.items.length === 1 ? "Teil" : "Teile"} · ${n0(favKcal(f))} kcal</div>
          </div>
        </button>
        <button type="button" class="result-add" aria-label=${`${f.n} zu ${mealName} hinzufügen (${n0(favKcal(f))} kcal)`}
          onClick=${() => addFavoriteToMeal(f, meal, d)}>${Icon.plus()}</button>
      </div>`)}</div>`
    : html`<div class="muted" style="font-size:15px;padding:6px 0">Speichere Kombinationen, die du oft isst – über den Stern bei einer Mahlzeit oder „Neuer Favorit“.</div>`}`;
}
