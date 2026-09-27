# Happa 🍽️

Kalorien- und Abnehm-App im Stil einer nativen Apple-App („Liquid Glass“, iOS 26):
**Essen fotografieren → die Cloudflare-KI erkennt die Speisen → bestätigen → fertig.**
Läuft als Web-App (PWA) vor allem am iPhone, funktioniert aber genauso am PC.

**Live:** https://happa.auer.page (Anmeldung über Cloudflare Access, Einmal-PIN per E-Mail)

Die Analyse der Vorbild-Apps (YAZIO, MyFitnessPal, FDDB, Lifesum, Zanadio, Noom) steht in
[`docs/ANALYSE.md`](docs/ANALYSE.md), als gestaltete Seite in [`docs/analyse.html`](docs/analyse.html)
(veröffentlicht: https://claude.ai/artifact/2GAe6UZg1H3Fxpio3o5Bda).

## Funktionen

| Bereich | Was Happa macht |
| --- | --- |
| **Start** | kurze Animation mit großem App-Symbol (Gabel, Avocado, Ring) |
| **Anmeldung** | Cloudflare Access vor der ganzen Seite; der Worker prüft zusätzlich das signierte Access-Token. Jede E-Mail-Adresse hat ihr eigenes Profil. |
| **Onboarding** | Name, Geschlecht, Geburtsjahr, Größe, Gewicht, Ziel, Aktivität, Tempo → Tagesziel nach Mifflin-St Jeor; höchstens 0,5 kg/Woche, nie unter 1.200/1.500 kcal, kein Ziel im Untergewicht |
| **Heute** | Wochenleiste (gleitet beim Blättern, folgt dem Finger, federt an der Gegenwart zurück, „Heute“-Knopf), Kalorienring, Makro-Balken, vier Mahlzeiten, Wasser-Gläser, Gewicht, Tipp des Tages |
| **Foto-Erkennung** | Live-Kamera (oder Foto/Galerie) → Workers AI erkennt Bestandteile, Menge und Nährwerte → Mengen anpassen, KI-Schätzung oder Datenbankwert wählen, Hinweis geben und neu erkennen |
| **Suche** | 7.140 Lebensmittel aus dem Bundeslebensmittelschlüssel (offline, im Browser) + Markenprodukte über Open Food Facts |
| **Barcode** | eingebaute Erkennung (Android/Chrome) bzw. ZXing (iPhone), Nummer auch von Hand |
| **Fortschritt** | Gewichtskurve mit Ziel, Kalorien der Woche, Nährstoffverteilung, Prognose „Wenn jede Woche so wäre …“, Serie mit Kalender |
| **Motivation** | Serie (Flamme, grau bei 0), 13 Abzeichen: Konfetti, bei großen Meilensteinen (7 und 30 Tage, 100 Einträge, Zielgewicht) Feuerwerk; freundliche Rückmeldungen, sachliche Tipps, Haptik |
| **Profil** | Abzeichen-Sammlung, Ziele (automatisch/eigenes), Nährstoffverteilung, Wasser, Körperdaten, Hell/Dunkel, Datenexport (JSON), Abmelden, Konto löschen |
| **Desktop** | ab 960 px schwebende Seitenleiste (gleitende Glas-Auswahl) und zweispaltiges Layout |

## Kosten: alles im kostenlosen Cloudflare-Plan

- **Workers AI:** Gemma 4 (`@cf/google/gemma-4-26b-a4b-it`) mit abgeschaltetem „Denken“ braucht
  etwa 6–16 Neuronen pro Foto; Llama 4 Scout springt als Ersatz ein (≈ 45–50). Das Gratis-Kontingent
  von 10.000 Neuronen pro Tag reicht für Hunderte Fotos. Im Free-Plan wird nie etwas berechnet –
  ist das Kontingent aufgebraucht, antwortet die KI erst am nächsten Tag wieder (die App sagt das).
- **Tageslimit pro Person:** 40 Fotos (`AI_DAILY_LIMIT` in `wrangler.toml`).
- **D1:** eine Zeile pro Person und eine pro Person und Tag. Die Einträge eines Tages stehen als
  kompaktes JSON-Array in dieser Zeile – ein Tag lesen = 1 Zeile, eine Woche = 7 Zeilen.
- **Keine Fotos in der Datenbank:** Das Foto geht einmal an die KI und ist dann weg. Das kleine
  Vorschaubild (≈ 8 KB) bleibt nur im Browser (IndexedDB).
- **Lebensmitteldaten** liegen als statische Datei im Repository (`public/data/foods.json`), nicht in D1.
- „Zuletzt verwendet“ wird nur auf dem Gerät gespeichert (spart Schreibzugriffe).

## Aufbau

```
worker/index.js      API unter /api/*: Profil, Tage, Einträge, Wasser, Gewicht, Export, Konto löschen
worker/auth.js       Prüfung des Cloudflare-Access-JWT (RS256, AUD, Aussteller, Ablauf)
worker/ai.js         Speisenerkennung (Workers AI)
worker/off.js        Open Food Facts: Suche + Barcode, im Cloudflare-Cache zwischengespeichert
schema.sql           D1-Schema (users, days)
wrangler.toml        Worker, Domain, Assets, D1, AI, Access-Einstellungen
public/              Web-App ohne Build-Schritt (Preact + htm liegen in public/vendor)
  index.html         Startanimation, Import-Map
  css/app.css        Liquid-Glass-Gestaltung, hell/dunkel, Desktop-Layout
  js/app.js          Einstieg, Tabs, Overlays
  js/store.js        Zustand + Aktionen (optimistische Updates)
  js/views/*.js      Heute, Hinzufügen/Portion/Manuell, Kamera, Eintrag, Gewicht, Fortschritt, Profil, Onboarding
  js/foods.js        BLS-Suche im Browser
  sw.js              Service Worker (App offline starten, Lebensmittelsuche offline)
  data/foods.json    BLS 4.0 kompakt (7.140 Lebensmittel, ~130 KB komprimiert)
  icons/             App-Symbole + Manifest (per Access-Ausnahme öffentlich, für den Home-Bildschirm)
scripts/build-foods.py   BLS-Excel → foods.json
scripts/build-icons.mjs  icon.svg → PNG-Symbole
docs/ANALYSE.md      Analyse der sechs Abnehm-Apps
```

### API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| GET | `/api/me?d=JJJJMMTT` | Profil, heutiger Tag, Serie, letzte Wiegung, Anzahl Einträge |
| PUT | `/api/profile` | Profil speichern |
| GET | `/api/days?from=&to=` | Tage eines Zeitraums |
| PUT | `/api/days/:d` | Wasser (ml) und/oder Gewicht (kg) setzen |
| POST | `/api/days/:d/entries` | Eintrag hinzufügen |
| PUT / DELETE | `/api/days/:d/entries/:id` | Eintrag ändern / löschen |
| GET | `/api/weights` | alle Wiegungen |
| POST | `/api/recognize` | Foto erkennen: `{ image, d, hint? }` |
| GET | `/api/food/search?q=` | Open Food Facts durchsuchen |
| GET | `/api/food/barcode/:ean` | Produkt per Barcode |
| GET | `/api/export` | alle eigenen Daten als JSON |
| DELETE | `/api/me` | Konto und alle Daten löschen |

Eintrag: `[id, Mahlzeit 0–3, Name, Gramm, kcal, Eiweiß, Kohlenhydrate, Fett, Quelle, Emoji]`,
Quelle `k` = KI-Foto, `b` = BLS, `o` = Open Food Facts, `m` = manuell.

## Entwickeln und veröffentlichen

```bash
npm install
cp .dev.vars.example .dev.vars              # meldet lokal test@example.com an
npm run db:init:local                       # Tabellen in der lokalen D1-Kopie
npm run dev                                 # http://localhost:8787 (KI läuft über Cloudflare)

export CLOUDFLARE_API_TOKEN=…               # niemals ins Repository!
npm run db:init                             # einmalig: Tabellen in der echten D1
npm run deploy
```

**Automatisch:** Jeder Push auf `main` veröffentlicht die App über GitHub Actions
(`.github/workflows/deploy.yml`, ausgenommen reine Änderungen an `docs/` und `README.md`).
Das Repository-Secret `CLOUDFLARE_API_TOKEN` enthält den Cloudflare-Token „Happa GitHub Deploy“
(nur Workers-Skripte, Routen der Zone auer.page, D1 lesen). Von Hand starten: Actions → Deploy → *Run workflow*.

### Cloudflare Access

- Anwendung **„Happa“** für `happa.auer.page`: Einmal-PIN per E-Mail, Sitzung 730 h,
  Regel „Familie“ (erlaubte E-Mail-Adressen) und eine Service-Token-Regel für automatische Tests.
- Anwendung **„Happa – Symbole öffentlich“** für `happa.auer.page/icons`: *Bypass*, damit iOS das
  Home-Bildschirm-Symbol und das Manifest ohne Anmeldung laden kann.
- Weitere Personen freischalten: Zero Trust → Access → Anwendungen → Happa → Regel „Familie“ → E-Mail hinzufügen.
  Jede Person bekommt beim ersten Öffnen ihr eigenes, leeres Profil.
- `ACCESS_AUD` in `wrangler.toml` ist das „Application Audience (AUD) Tag“ der Anwendung.

### Auf dem iPhone installieren

Safari → https://happa.auer.page → anmelden → Teilen → **Zum Home-Bildschirm**.

## Datenquellen und Lizenzen

- **Bundeslebensmittelschlüssel (BLS) 4.0** – Max Rubner-Institut (2025), Deutsche Nährstoffdatenbank,
  Karlsruhe, DOI 10.25826/Data20251217-134202-0, Lizenz CC BY 4.0 (https://blsdb.de)
- **Open Food Facts** – Datenbank unter ODbL (https://world.openfoodfacts.org)
- **Preact** und **htm** – MIT-Lizenz (`public/vendor/LICENSE-*.txt`)
- Happa ersetzt keine ärztliche Beratung. Die KI liefert Schätzungen.
