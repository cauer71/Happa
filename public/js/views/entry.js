// Eintrag bearbeiten: Menge (Werte skalieren mit), Mahlzeit, löschen.
import { useState } from "preact/hooks";
import { html, cx, haptic, n0, n1, parseNum } from "../util.js";
import { Icon } from "../icons.js";
import { openOverlay, closeOverlay, updateEntry, deleteWithUndo, toast } from "../store.js";
import { Sheet, Seg, Thumb } from "../ui.js";
import { E, per100Of, makeEntry, unitOf } from "../nutrition.js";
import { mealOptions } from "./add.js";

const SOURCES = { k: "Per Foto erkannt (KI-Schätzung)", b: "Bundeslebensmittelschlüssel", o: "Open Food Facts", m: "Manuell eingetragen" };

export function openEntry(d, entry) {
  openOverlay((o) => html`<${EntrySheet} ...${o} d=${d} entry=${entry}/>`);
}

function EntrySheet({ id, closing, d, entry }) {
  const hasGrams = entry[E.grams] > 0;
  const [meal, setMeal] = useState(entry[E.meal]);
  const [name, setName] = useState(entry[E.name]);
  const [text, setText] = useState(String(hasGrams ? entry[E.grams] : ""));
  const [busy, setBusy] = useState(false);
  const grams = parseNum(text);
  const per100 = per100Of(entry);
  const unit = unitOf(entry);
  const next = hasGrams && grams > 0
    ? makeEntry({ id: entry[E.id], meal, name: name.trim() || entry[E.name], grams, per100, src: entry[E.src], emoji: entry[E.emoji], unit, perMl: true })
    : [entry[0], meal, name.trim() || entry[E.name], ...entry.slice(3)];
  const changed = JSON.stringify(next) !== JSON.stringify(entry);

  const save = async () => {
    setBusy(true);
    try { await updateEntry(d, next); haptic("success"); toast("Gespeichert"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const del = async () => {
    haptic("heavy");
    closeOverlay(id);
    try { await deleteWithUndo(d, entry[E.id]); }
    catch (err) { toast(err.message, "⚠️"); }
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Eintrag"
      footer=${html`<div class="row" style="gap:10px">
        <button class="btn btn-danger" aria-label="Eintrag löschen" onClick=${del}>${Icon.trash()}</button>
        <button class="btn btn-primary grow" disabled=${!changed || busy} onClick=${save}>Speichern</button></div>`}>
      <div class="food-hero">
        <${Thumb} id=${entry[E.id]} emoji=${entry[E.emoji]} cls="food-emoji"/>
        <input class="field center" style="font-weight:700;font-size:19px;background:transparent" value=${name}
          aria-label="Bezeichnung" onInput=${(e) => setName(e.currentTarget.value)}/>
        <div class="muted" style="font-size:13px">${SOURCES[entry[E.src]] || ""}</div>
      </div>
      <${Seg} label="Mahlzeit" options=${mealOptions} value=${meal} onChange=${setMeal}/>
      ${hasGrams && html`
        <label class="label" for="e-grams">Menge</label>
        <div class="stepper">
          <button class="icon-btn fill" aria-label=${`10 ${unit} weniger`} onClick=${() => { haptic(); setText(String(Math.max(1, (grams || 0) - 10))); }}>−</button>
          <div class="unit-input grow">
            <input id="e-grams" class="field num" inputmode="decimal" value=${text} onInput=${(e) => setText(e.currentTarget.value)} onFocus=${(e) => e.currentTarget.select()}/>
            <span>${unit}</span>
          </div>
          <button class="icon-btn fill" aria-label=${`10 ${unit} mehr`} onClick=${() => { haptic(); setText(String((grams || 0) + 10)); }}>+</button>
        </div>`}
      <div class="nutri">
        <div><b>${n0(next[E.kcal])}</b><span>kcal</span></div>
        <div><b style="color:var(--carbs)">${n1(next[E.carbs])}</b><span>KH g</span></div>
        <div><b style="color:var(--protein)">${n1(next[E.protein])}</b><span>Eiweiß g</span></div>
        <div><b style="color:var(--fat)">${n1(next[E.fat])}</b><span>Fett g</span></div>
      </div>
      ${entry[E.src] === "k" && html`<p class="fine">Die KI schätzt Menge und Nährwerte anhand des Fotos. Passe die Menge an, wenn du es genauer weißt.</p>`}
    </${Sheet}>`;
}
