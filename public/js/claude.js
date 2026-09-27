// „Happa mit Claude“: einmalige Karte auf „Heute“, Bereich im Profil und eine kurze,
// animierte Anleitung (Connector verbinden → Foto/Frage im Chat → Nährwerte → Eintrag → Coach).
// Entfernen: diese Datei löschen, in views/today.js und views/profile.js Import und Karte streichen.
import { useEffect, useState } from "preact/hooks";
import { html, cx, haptic, reduceMotion } from "./util.js";
import { Icon } from "./icons.js";
import { useStore, openOverlay, closeOverlay, saveProfile, toast, state } from "./store.js";
import { Sheet } from "./ui.js";

export const COACH_URL = "https://claude.ai/artifact/WY5UBBEojUFsZmzDwxHJJr";
export const MCP_URL = "https://happa-mcp.auer.page/mcp";
const STEP_MS = 5200;

async function copyUrl() {
  haptic();
  try { await navigator.clipboard.writeText(MCP_URL); toast("Adresse kopiert", "📋"); }
  catch { toast(MCP_URL, "📋"); }
}

const markSeen = () => { if (!state.profile.claudeSeen) saveProfile({ claudeSeen: 1 }).catch(() => {}); };

export function openClaudeGuide() {
  haptic();
  openOverlay((o) => html`<${GuideSheet} ...${o}/>`);
}

// ── Szenen: kleine Nachbauten von Claude und Happa, die sich beim Anzeigen aufbauen ──
const SCENES = {
  connect: () => html`
    <div class="cg-phone">
      <div class="cg-bar">Einstellungen · Connectors</div>
      <div class="cg-row cg-a1"><span class="cg-plus">+</span> Benutzerdefinierten Connector hinzufügen</div>
      <div class="cg-field cg-a2"><small>Name</small><span class="cg-type cg-t1">Happa</span></div>
      <div class="cg-field cg-a3"><small>MCP-Server-URL</small><span class="cg-type cg-t2">happa-mcp.auer.page/mcp</span></div>
      <div class="cg-btn cg-a4">Hinzufügen</div>
      <div class="cg-ok cg-a5">${Icon.check()} Happa verbunden</div>
    </div>`,
  chat: () => html`
    <div class="cg-phone cg-chat">
      <div class="cg-bar">Claude</div>
      <div class="cg-msg me cg-a1"><div class="cg-photo">🥕🧀🥚<br/>🍅🥬</div></div>
      <div class="cg-msg me cg-a2">Was kann ich daraus kochen? Ich habe noch Platz für 600 kcal.</div>
      <div class="cg-msg ai cg-a3"><span class="cg-dots"><i></i><i></i><i></i></span></div>
    </div>`,
  calc: () => html`
    <div class="cg-phone cg-chat">
      <div class="cg-bar">Claude</div>
      <div class="cg-msg ai cg-wide">
        <b class="cg-a1">Gemüse-Omelett</b>
        <div class="cg-line cg-a2"><span>Eier, 3 Stück</span><span>165 g · 229 kcal</span></div>
        <div class="cg-line cg-a3"><span>Gouda</span><span>30 g · 108 kcal</span></div>
        <div class="cg-line cg-a4"><span>Karotte, Tomate, Salat</span><span>250 g · 58 kcal</span></div>
        <div class="cg-line cg-sum cg-a5"><span>Summe</span><span>395 kcal</span></div>
        <small class="cg-src cg-a5">Nährwerte: Bundeslebensmittelschlüssel</small>
      </div>
    </div>`,
  log: () => html`
    <div class="cg-phone">
      <div class="cg-bar">Happa · Heute</div>
      <div class="cg-meal"><span>🥗 Abendessen</span><b class="cg-count">395 kcal</b></div>
      <div class="cg-entry cg-a2"><span>🍳 Gemüse-Omelett</span><span>445 g</span></div>
      <div class="cg-ok cg-a3">${Icon.check()} In Happa eingetragen</div>
      <div class="cg-meter cg-a4"><i></i></div>
      <small class="cg-note cg-a4">Noch 205 kcal übrig</small>
    </div>`,
  coach: () => html`
    <div class="cg-phone">
      <div class="cg-bar">Happa Coach</div>
      <div class="cg-bars">${[62, 80, 55, 90, 70, 48, 66].map((h, i) => html`<i style=${`--h:${h}%;--d:${0.15 + i * 0.08}s`}></i>`)}</div>
      <div class="cg-chips cg-a3"><span>Rückblick</span><span>Chat</span><span>Rezepte</span></div>
      <div class="cg-msg ai cg-wide cg-a4">Am Wochenende isst du im Schnitt 600 kcal mehr – vor allem abends.</div>
    </div>`,
};

const STEPS = [
  { scene: "connect", title: "Einmal verbinden", text: "In Claude unter Einstellungen → Connectors einen benutzerdefinierten Connector hinzufügen: Name „Happa“ und die Adresse unten. Dann mit deiner Happa-E-Mail anmelden und „Erlauben“ tippen." },
  { scene: "chat", title: "Fotografieren oder fragen", text: "Im Claude-Chat dein Essen oder den Kühlschrank fotografieren – oder einfach per Sprache fragen." },
  { scene: "calc", title: "Echte Nährwerte", text: "Claude schätzt die Mengen und rechnet mit den Werten aus dem Bundeslebensmittelschlüssel. Dein Restbudget kennt es aus Happa." },
  { scene: "log", title: "Direkt in Happa", text: "Sag „trag es ein“ – der Eintrag steht sofort in deinem Tagebuch. Ändern oder löschen geht nur hier in der App." },
  { scene: "coach", title: "Dein Wochenrückblick", text: "Der Happa Coach zeigt Muster, gibt Tipps und schlägt Rezepte für dein Restbudget vor." },
];

function GuideSheet({ id, closing }) {
  const [step, setStep] = useState(0);
  const [auto, setAuto] = useState(!reduceMotion());
  const last = step === STEPS.length - 1;
  const s = STEPS[step];

  useEffect(() => {
    if (!auto || last) return;
    const t = setTimeout(() => setStep((x) => Math.min(STEPS.length - 1, x + 1)), STEP_MS);
    return () => clearTimeout(t);
  }, [step, auto, last]);

  const go = (n) => { haptic(); setAuto(false); setStep(Math.max(0, Math.min(STEPS.length - 1, n))); };
  const done = () => { markSeen(); closeOverlay(id); };

  return html`
    <${Sheet} id=${id} closing=${closing} title="Happa mit Claude" onClose=${markSeen} footer=${html`
      <div class="cg-foot">
        <button class="btn btn-glass" disabled=${step === 0} onClick=${() => go(step - 1)}>Zurück</button>
        <div class="cg-dots-nav" role="tablist" aria-label="Schritte">
          ${STEPS.map((x, i) => html`<button role="tab" aria-selected=${i === step} aria-label=${`Schritt ${i + 1}: ${x.title}`} class=${cx(i === step && "on")} onClick=${() => go(i)}>
            ${i === step && auto && !last ? html`<i style=${`animation-duration:${STEP_MS}ms`}></i>` : null}</button>`)}
        </div>
        ${last ? html`<button class="btn btn-primary" onClick=${done}>Fertig</button>`
          : html`<button class="btn btn-primary" onClick=${() => go(step + 1)}>Weiter</button>`}
      </div>`}>
      <div class="cg-stage" key=${step} aria-hidden="true">${SCENES[s.scene]()}</div>
      <div class="cg-text" key=${"t" + step} aria-live="polite">
        <div class="cg-step">Schritt ${step + 1} von ${STEPS.length}</div>
        <h2>${s.title}</h2>
        <p>${s.text}</p>
        ${s.scene === "connect" && html`
          <button class="cg-url" onClick=${copyUrl} aria-label="Connector-Adresse kopieren"><code>${MCP_URL}</code><span>Kopieren</span></button>`}
        ${s.scene === "coach" && html`
          <a class="btn btn-glass block" href=${COACH_URL} target="_blank" rel="noopener" onClick=${markSeen}>${Icon.sparkles()} Coach öffnen</a>`}
      </div>
    </${Sheet}>`;
}

// ── Karte auf „Heute“: erscheint, bis die Anleitung angesehen oder die Karte geschlossen wurde ──
export function ClaudePromo() {
  const s = useStore();
  if (s.profile.claudeSeen) return null;
  return html`
    <section class="card cg-promo">
      <button class="icon-btn sm fill cg-close" aria-label="Hinweis schließen" onClick=${() => { haptic(); markSeen(); }}>${Icon.close()}</button>
      <div class="cg-promo-art" aria-hidden="true"><span>📸</span><span class="cg-arrow">→</span><span>✨</span><span class="cg-arrow">→</span><span>🍽️</span></div>
      <div class="cg-promo-kicker">Neu</div>
      <h3>Happa mit Claude</h3>
      <p>Essen oder Kühlschrank im Claude-Chat fotografieren – Claude rechnet mit echten Nährwerten und trägt es in Happa ein.</p>
      <button class="btn btn-primary block" onClick=${openClaudeGuide}>So geht’s · 1 Minute</button>
    </section>`;
}

// ── Bereich im Profil ──
export function ClaudeCard() {
  return html`
    <div>
      <div class="section-title">Happa mit Claude</div>
      <section class="card list">
        <button class="list-row" onClick=${openClaudeGuide}>
          <span class="list-icon" style="background:var(--accent)">${Icon.sparkles()}</span>
          <span class="grow">So funktioniert’s</span>
          <span class="chev">${Icon.chevron()}</span>
        </button>
        <a class="list-row" href=${COACH_URL} target="_blank" rel="noopener" style="color:inherit;text-decoration:none">
          <span class="list-icon" style="background:#5e5ce6">📊</span>
          <span class="grow">Happa Coach öffnen</span>
          <span class="chev">${Icon.chevron()}</span>
        </a>
        <button class="list-row" onClick=${copyUrl}>
          <span class="list-icon" style="background:#8e8e93">📋</span>
          <span class="grow">Connector-Adresse kopieren</span>
          <span class="list-value">happa-mcp…</span>
        </button>
      </section>
    </div>`;
}
