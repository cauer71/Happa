// Gewicht eintragen (für den ausgewählten Tag).
import { useState } from "preact/hooks";
import { html, haptic, n1, parseNum, longDate, clamp } from "../util.js";
import { openOverlay, closeOverlay, setWeight, toast, checkBadges, state, currentWeight } from "../store.js";
import { Sheet } from "../ui.js";

export function openWeight(d) {
  openOverlay((o) => html`<${WeightSheet} ...${o} d=${d}/>`);
}

function WeightSheet({ id, closing, d }) {
  const existing = state.days[d]?.weight;
  const [text, setText] = useState(n1(existing ?? currentWeight()));
  const [busy, setBusy] = useState(false);
  const kg = parseNum(text);
  const valid = kg >= 20 && kg <= 400;
  const start = state.profile.startWeight;
  const step = (delta) => { haptic(); setText(n1(clamp((Number.isFinite(kg) ? kg : currentWeight()) + delta, 20, 400))); };

  const save = async () => {
    setBusy(true);
    try {
      await setWeight(d, Math.round(kg * 10) / 10);
      haptic("success");
      const diff = start ? kg - start : 0;
      toast(diff < -0.05 ? `Gespeichert · −${n1(-diff)} kg seit Start 🎉` : "Gewicht gespeichert", "⚖️");
      closeOverlay(id);
      checkBadges(d);
    } catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };
  const remove = async () => {
    setBusy(true);
    try { await setWeight(d, null); toast("Gewicht entfernt", "🗑️"); closeOverlay(id); }
    catch (err) { toast(err.message, "⚠️"); setBusy(false); }
  };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Gewicht"
      footer=${html`<button class="btn btn-primary block" disabled=${!valid || busy} onClick=${save}>Speichern</button>
        ${existing != null && html`<button class="btn btn-plain block" style="margin-top:6px;color:var(--danger)" onClick=${remove}>Eintrag entfernen</button>`}`}>
      <p class="muted center" style="margin:0 0 16px;font-size:15px;text-transform:capitalize">${longDate(d)}</p>
      <div class="stepper">
        <button class="icon-btn fill" style="width:56px;height:56px;border-radius:28px;font-size:24px" aria-label="0,1 kg weniger" onClick=${() => step(-0.1)}>−</button>
        <div class="unit-input grow">
          <input class="field num" style="height:72px;font-size:40px;text-align:center" inputmode="decimal" value=${text}
            aria-label="Gewicht in Kilogramm" onInput=${(e) => setText(e.currentTarget.value)} onFocus=${(e) => e.currentTarget.select()}/>
          <span>kg</span>
        </div>
        <button class="icon-btn fill" style="width:56px;height:56px;border-radius:28px;font-size:24px" aria-label="0,1 kg mehr" onClick=${() => step(0.1)}>+</button>
      </div>
      <p class="fine">Tipp: Wiege dich möglichst immer zur gleichen Zeit, am besten morgens nach dem Aufstehen. Schwankungen von 1–2 kg von Tag zu Tag sind normal.</p>
    </${Sheet}>`;
}
