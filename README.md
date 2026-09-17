# OCR-Testseite

Kleine Testanwendung: Text **abfotografieren** → per **OCR** erkennen → in einer **Datenbank** speichern.

Es gibt zwei Varianten mit identischer Oberfläche und identischer API:

| Variante | Server | Datenbank | Start |
| --- | --- | --- | --- |
| lokal | `server.js` (nur Node-Standardbibliothek) | SQLite (`data/ocr.db`) | `npm start` |
| Cloudflare | `worker/index.js` (Worker) | D1 (`happa-ocr`) | `npx wrangler deploy` |

Live: **https://happa-ocr.christian-auer-71.workers.dev**

## Ablauf

1. **Browser**: Foto über die Gerätekamera aufnehmen (oder eine Bilddatei wählen).
   Das Bild wird auf max. 1600 px verkleinert — das beschleunigt die Erkennung.
2. **Browser**: [Tesseract.js](https://tesseract.projectnaptha.com/) erkennt den Text
   (Deutsch, Englisch, Italienisch). Der Text lässt sich vor dem Speichern korrigieren.
3. **Server**: Es wird **ausschließlich der Text** gespeichert (mit Zeitstempel, Sprache und
   Konfidenz). Das Foto bleibt im Browser und verlässt das Gerät nicht.

## Lokal starten

```bash
node server.js          # oder: npm start
# → http://localhost:3000
```

Keine Laufzeit-Abhängigkeiten: Der Server nutzt nur `node:http` und `node:sqlite` (ab Node 22.5).
Tesseract.js wird im Browser vom CDN geladen; die Sprachdaten werden einmalig heruntergeladen
und danach gecacht.

### Kamera-Hinweis

`getUserMedia` funktioniert nur unter `https://` oder `http://localhost`. Auf dem Handy daher
die Cloudflare-URL nutzen oder den Button „Bild auswählen“ — dieser öffnet auf Mobilgeräten
direkt die Kamera.

## Cloudflare (Worker + D1)

```bash
npm install                                  # wrangler als devDependency
npx wrangler d1 execute happa-ocr --remote --file=schema.sql   # Tabelle anlegen
npx wrangler deploy                          # Worker + statische Dateien hochladen
npx wrangler dev                             # lokal gegen eine D1-Kopie entwickeln
```

Konfiguration in `wrangler.toml`: `public/` wird als statisches Asset ausgeliefert,
alles unter `/api/` beantwortet der Worker, die D1-Datenbank hängt am Binding `DB`.
Zum Deployen braucht `wrangler` einen API-Token in `CLOUDFLARE_API_TOKEN`
(oder einmalig `npx wrangler login`) — niemals im Repository ablegen.

## Datenbank

Beide Varianten nutzen dasselbe Schema (`schema.sql`):

```sql
CREATE TABLE scans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,   -- ISO-Zeitstempel
  text       TEXT NOT NULL,   -- erkannter (ggf. korrigierter) Text
  language   TEXT,            -- z. B. "deu" oder "deu+eng"
  confidence REAL             -- Konfidenz von Tesseract in Prozent
);
```

## API

| Methode | Pfad | Zweck |
| --- | --- | --- |
| `GET` | `/api/scans?limit=n` | Liste der Einträge, neueste zuerst |
| `POST` | `/api/scans` | Eintrag anlegen: `{ text, language, confidence }` |
| `GET` | `/api/scans/:id` | Einzelner Eintrag |
| `DELETE` | `/api/scans/:id` | Eintrag löschen |

```bash
curl -X POST https://happa-ocr.christian-auer-71.workers.dev/api/scans \
  -H 'content-type: application/json' \
  -d '{"text":"Hallo Welt","language":"deu","confidence":91.5}'
```

## Dateien

```
server.js          lokaler HTTP-Server mit SQLite
worker/index.js    Cloudflare Worker mit D1
wrangler.toml      Worker-Konfiguration (Assets + D1-Binding)
schema.sql         Tabellendefinition
public/index.html  Oberfläche
public/app.js      Kamera, OCR, Speichern, Liste
public/style.css   Styling (hell/dunkel)
```

## Offene Punkte für einen echten Einsatz

- **Die Seite ist offen erreichbar** — vor produktivem Einsatz Zugriffsschutz ergänzen
  (Cloudflare Access oder ein einfacher Token-Check im Worker).
- OCR serverseitig ausführen, damit auch schwache Geräte schnell sind
- Volltextsuche über die gespeicherten Texte (SQLite/D1 FTS5)
