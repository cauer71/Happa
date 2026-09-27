// Hilfe: aufklappbare Themen, erreichbar über Profil → Hilfe (oder direkt ein Thema öffnen).
import { html, haptic } from "../util.js";
import { Icon } from "../icons.js";
import { openOverlay, toast } from "../store.js";
import { Sheet } from "../ui.js";
import { MCP_URL, COACH_URL, openClaudeGuide, CoachLogo } from "../claude.js";

async function copyUrl() {
  haptic();
  try { await navigator.clipboard.writeText(MCP_URL); toast("Adresse kopiert", "📋"); }
  catch { toast(MCP_URL, "📋"); }
}

const TOPICS = [
  {
    id: "connect", e: "🔌", title: "Happa mit Claude verbinden",
    body: () => html`
      <p>Einmal pro Person, danach bleibt die Verbindung bestehen.</p>
      <ol>
        <li>In Claude: <b>Einstellungen → Connectors → Benutzerdefinierten Connector hinzufügen</b>.</li>
        <li>Name <b>Happa</b> und diese Adresse eintragen:
          <button class="cg-url" style="margin-top:6px" onClick=${copyUrl} aria-label="Connector-Adresse kopieren"><code>${MCP_URL}</code><span>Kopieren</span></button></li>
        <li>Die vorgeschlagenen Einstellungen lassen und <b>Hinzufügen</b> tippen.</li>
        <li>Mit deiner Happa-E-Mail anmelden und auf der Happa-Seite <b>Erlauben</b> tippen.</li>
        <li>Bei den Tool-Berechtigungen „Schreibgeschützte Tools“ auf <b>Immer erlauben</b> stellen. Fürs Eintragen empfiehlt sich <b>Genehmigung erforderlich</b> – dann bestätigst du jeden Eintrag.</li>
      </ol>
      <p class="muted">Trennen geht jederzeit in Claude unter Einstellungen → Connectors → Happa.</p>`,
  },
  {
    id: "ask", e: "💬", title: "Was kann ich Claude fragen?",
    body: () => html`
      <ul>
        <li>„Wie war meine Woche in Happa?“</li>
        <li>„Was kann ich heute Abend noch essen?“</li>
        <li>Foto vom Teller: „Schätz das und trag es als Mittagessen ein.“</li>
        <li>Foto vom Kühlschrank: „Was kann ich daraus kochen? Rechne die Kalorien mit Happa.“</li>
        <li>„Trag zum Frühstück 60 g Haferflocken mit 200 ml Milch ein.“</li>
        <li>„Wie entwickelt sich mein Gewicht?“</li>
      </ul>
      <p class="muted">Claude rechnet mit den Werten aus dem Bundeslebensmittelschlüssel. Ändern oder löschen kann Claude nichts – das geht nur hier in der App.</p>
      <button class="btn btn-glass block" onClick=${openClaudeGuide}>${Icon.sparkles()} Kurze Anleitung ansehen</button>`,
  },
  {
    id: "coach", e: () => html`<${CoachLogo} size=${26}/>`, title: "Happa Coach",
    body: () => html`
      <p>Der Coach läuft in Claude und lädt deine Daten über den Connector: Wochenrückblick, Chat über deine Daten und Rezepte für dein Restbudget. Er nutzt dein Claude-Kontingent, nicht Happa.</p>
      <a class="btn btn-glass block" href=${COACH_URL} target="_blank" rel="noopener">Coach öffnen</a>`,
  },
  {
    id: "favorites", e: "⭐", title: "Favoriten",
    body: () => html`
      <p>Kombinationen, die du oft isst – z. B. „Pasta-Abend“ mit 300 g Spaghetti, 25 g Thunfisch und 330 ml hellem Bier – speicherst du einmal und trägst sie danach mit einem Tipp ein.</p>
      <ul>
        <li><b>Anlegen:</b> auf „Heute“ bei einer Mahlzeit auf den Stern tippen – oder beim Hinzufügen „Neuer Favorit“.</li>
        <li><b>Eintragen:</b> beim Hinzufügen unter „Favoriten“ auf ＋ tippen. Antippen öffnet den Favoriten: Mengen anpassen, Teile entfernen oder hinzufügen, umbenennen, löschen.</li>
        <li><b>Mit Claude:</b> „Trag meinen Pasta-Abend als Abendessen ein.“</li>
      </ul>`,
  },
  {
    id: "training", e: "🏋️", title: "Trainingsplan",
    body: () => html`
      <p>Im Tab <b>Training</b> planst du deine Woche wie in einem Kalender: bei einem Tag auf ＋ tippen, Sportart, Dauer und Uhrzeit wählen – auf Wunsch jede Woche wiederholt.</p>
      <ul>
        <li><b>Abhaken:</b> passiert automatisch, sobald Health Auto Export ein passendes Workout schickt. Darunter stehen Dauer und kcal.</li>
        <li>Workouts ohne Plan erscheinen als <b>zusätzlich</b>. Ohne Uhr kannst du eine Einheit auch von Hand abhaken.</li>
        <li>Oben siehst du die Woche: absolviert, Sport-kcal und Ø Verbrauch.</li>
      </ul>`,
  },
  {
    id: "health", e: "❤️", title: "Aktivität aus Apple Health (Test)",
    body: () => html`
      <p>Mit der iPhone-App <b>Health Auto Export</b> kommen aktive Energie, Ruheenergie, Schritte und Workouts zu Happa. Auf „Heute“ zeigt die Karte „Verbrauch“ dann den Tag mit und ohne Sport. Unter „Fortschritt“ vergleicht „Gegessen vs. verbraucht“ jede Woche Tag für Tag – ohne Health-Daten mit dem geschätzten Verbrauch aus deinem Profil.</p>
      <p class="muted">Einrichten unter Profil → Körperdaten → Apple Health (Test): dort den Schlüssel erzeugen und der Anleitung folgen.</p>`,
  },
  {
    id: "photo", e: "📸", title: "Essen fotografieren in Happa",
    body: () => html`
      <ul>
        <li>Mit dem grünen Kamera-Knopf fotografieren – die KI erkennt die Bestandteile und schätzt Mengen und Nährwerte.</li>
        <li>Mengen vor dem Speichern prüfen; bei jedem Bestandteil kannst du einen Datenbankwert wählen.</li>
        <li>Stimmt etwas nicht, gib einen Hinweis („mit Sahnesoße“) und lass neu erkennen.</li>
        <li>Pro Tag sind 40 Fotos möglich.</li>
      </ul>`,
  },
  {
    id: "search", e: "🔎", title: "Suchen und Barcode",
    body: () => html`
      <ul>
        <li>Die Suche kennt 7.140 Lebensmittel aus dem Bundeslebensmittelschlüssel – auch offline.</li>
        <li>Markenprodukte kommen aus Open Food Facts; den Barcode kannst du scannen oder eintippen.</li>
        <li>Zuletzt Verwendetes steht oben und ist mit einem Tipp wieder eingetragen.</li>
      </ul>`,
  },
  {
    id: "goals", e: "🎯", title: "Kalorienziel und Tempo",
    body: () => html`
      <p>Happa berechnet deinen Bedarf nach der Mifflin-St-Jeor-Formel und plant höchstens 0,5 kg Abnahme pro Woche. Unter 1.200 kcal (Frauen) bzw. 1.500 kcal (Männer) plant Happa nie, und kein Ziel im Untergewicht.</p>
      <p class="muted">Eigene Ziele stellst du im Profil unter „Ziele“ ein.</p>`,
  },
  {
    id: "streak", e: "🔥", title: "Serie und Abzeichen",
    body: () => html`
      <p>Die Serie zählt Tage in Folge mit mindestens einem Eintrag. Abzeichen gibt es für Meilensteine wie die erste Woche, 100 Einträge oder das erreichte Ziel.</p>`,
  },
  {
    id: "privacy", e: "🔒", title: "Datenschutz",
    body: () => html`
      <ul>
        <li>Fotos gehen nur zur Erkennung an die Cloudflare-KI und werden nicht gespeichert. Vorschaubilder bleiben auf deinem Gerät.</li>
        <li>Jede Person sieht nur ihr eigenes Profil – auch Claude bekommt über den Connector nur deine Daten.</li>
        <li>Im Profil kannst du alles exportieren oder dein Konto samt Daten löschen.</li>
      </ul>`,
  },
  {
    id: "trouble", e: "🛠️", title: "Wenn etwas nicht klappt",
    body: () => html`
      <ul>
        <li><b>Einträge von Claude fehlen:</b> Sie erscheinen, sobald du zu Happa zurückkehrst (bei offener App spätestens nach einer Minute). Hilft das nicht, Happa schließen und neu öffnen.</li>
        <li><b>Claude meldet, die Verbindung sei abgelaufen:</b> in Claude unter Connectors bei Happa neu verbinden.</li>
        <li><b>Claude kann nicht eintragen:</b> Verbindung trennen und neu verbinden, dann auf der Happa-Seite „Erlauben“.</li>
        <li><b>Happa startet nicht:</b> auf dem Startbildschirm „Neu laden“ tippen.</li>
      </ul>`,
  },
];

export function openHelp(topic) {
  haptic();
  openOverlay((o) => html`<${HelpSheet} ...${o} topic=${topic}/>`);
}

function HelpSheet({ id, closing, topic }) {
  return html`
    <${Sheet} id=${id} closing=${closing} title="Hilfe" full>
      <div class="help">
        ${TOPICS.map((t) => html`
          <details class="help-item" open=${t.id === topic}>
            <summary><span class="help-e" aria-hidden="true">${typeof t.e === "function" ? t.e() : t.e}</span><span class="grow">${t.title}</span><span class="chev">${Icon.chevron()}</span></summary>
            <div class="help-body">${t.body()}</div>
          </details>`)}
      </div>
    </${Sheet}>`;
}
