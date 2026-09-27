// TEST „Happa Coach“ (Claude-Artifact): kopiert die letzten 4 Wochen als JSON in die
// Zwischenablage, damit man sie im Coach einfügen kann.
// Entfernen: diese Datei löschen und in views/profile.js den Import und <${CoachCard}/> streichen.
import { useEffect, useState } from "preact/hooks";
import { html, haptic, today, addDays } from "./util.js";
import { Icon } from "./icons.js";
import { state, loadRange, loadWeights, currentGoals, toast } from "./store.js";

export const COACH_URL = "https://claude.ai/artifact/WY5UBBEojUFsZmzDwxHJJr";

async function coachJson() {
  const to = today(), from = addDays(to, -27);
  await loadRange(from, to);
  const weights = await loadWeights().catch(() => []);
  const p = state.profile, g = currentGoals();
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = state.days[d];
    // nur id … Fett, ohne Quelle und Emoji
    if (day && (day.log.length || day.water)) days.push({ d, log: day.log.map((e) => e.slice(0, 8)), water: day.water });
  }
  return JSON.stringify({
    app: "Happa", kind: "coach", v: 1, created: new Date().toISOString(),
    profile: { name: p.name, sex: p.sex, born: p.born, height: p.height, startWeight: p.startWeight, goalWeight: p.goalWeight, activity: p.activity, pace: p.pace },
    goals: { kcal: g.kcal, protein: g.protein, carbs: g.carbs, fat: g.fat, water: g.water },
    days,
    weights: (weights || []).filter(([d]) => d >= addDays(to, -90)),
  });
}

export function CoachCard() {
  const [text, setText] = useState(null);
  // vorab laden: iOS erlaubt das Kopieren nur direkt im Tipp, nicht nach einem Netzaufruf
  useEffect(() => { coachJson().then(setText).catch(() => {}); }, []);

  const copy = async () => {
    haptic();
    try {
      if (text) await navigator.clipboard.writeText(text);
      else await navigator.clipboard.write([new ClipboardItem({ "text/plain": coachJson().then((t) => new Blob([t], { type: "text/plain" })) })]);
      toast("Kopiert – jetzt im Coach einfügen", "📋");
    } catch { toast("Kopieren ging nicht. Bitte noch einmal tippen.", "⚠️"); }
  };

  return html`
    <div>
      <div class="section-title">Happa Coach (Test)</div>
      <section class="card list">
        <button class="list-row" onClick=${copy}>
          <span class="list-icon" style="background:var(--accent)">📋</span>
          <span class="grow">Daten kopieren</span>
          <span class="list-value">4 Wochen</span>
        </button>
        <a class="list-row" href=${COACH_URL} target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
          <span class="list-icon" style="background:#5e5ce6">✨</span>
          <span class="grow">Coach in Claude öffnen</span>
          <span class="chev">${Icon.chevron()}</span>
        </a>
      </section>
      <p class="muted" style="font-size:13px;margin:8px 4px 0">Kopieren, im Coach auf „Daten einfügen“ tippen und einfügen. Claude wertet dann deine Woche aus.</p>
    </div>`;
}
