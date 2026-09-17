# OCR-Testseite

Kleine Testanwendung: Text **abfotografieren** → per **OCR** erkennen → in einer **Datenbank** speichern.

## Ablauf

1. **Browser**: Foto über die Gerätekamera aufnehmen (oder eine Bilddatei wählen).
2. **Browser**: [Tesseract.js](https://tesseract.projectnaptha.com/) erkennt den Text (Deutsch, Englisch, Italienisch).
   Der erkannte Text lässt sich vor dem Speichern noch korrigieren.
3. **Server**: Text, Sprache, Konfidenz und optional das Foto werden in einer SQLite-Datenbank abgelegt.

## Starten

```bash
node server.js          # oder: npm start
# → http://localhost:3000
```

Es sind **keine npm-Abhängigkeiten** nötig: Der Server nutzt nur die Node-Standardbibliothek
(`node:http`, `node:sqlite`, ab Node 22.5). Tesseract.js wird im Browser vom CDN geladen,
die Sprachdaten werden beim ersten Lauf einmalig heruntergeladen und gecacht.

### Kamera-Hinweis

`getUserMedia` funktioniert nur unter `https://` oder `http://localhost`. Auf dem Handy im
LAN daher entweder über einen HTTPS-Tunnel testen oder den Button „Bild auswählen“ nutzen —
dieser öffnet auf Mobilgeräten direkt die Kamera.

## Datenbank

SQLite-Datei: `data/ocr.db` (wird automatisch angelegt, per `.gitignore` ausgenommen).

```sql
CREATE TABLE scans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,   -- ISO-Zeitstempel
  text           TEXT NOT NULL,   -- erkannter (ggf. korrigierter) Text
  language       TEXT,            -- z. B. "deu" oder "deu+eng"
  confidence     REAL,            -- Konfidenz von Tesseract in Prozent
  image_data_url TEXT             -- optional: Foto als Data-URL
);
```

## API

| Methode | Pfad                 | Zweck                                                     |
| ------- | -------------------- | --------------------------------------------------------- |
| `GET`   | `/api/scans?limit=n` | Liste der Einträge (ohne Bilddaten), neueste zuerst        |
| `POST`  | `/api/scans`         | Eintrag anlegen: `{ text, language, confidence, imageDataUrl }` |
| `GET`   | `/api/scans/:id`     | Einzelner Eintrag inklusive Bild                           |
| `DELETE`| `/api/scans/:id`     | Eintrag löschen                                            |

Beispiel:

```bash
curl -X POST http://localhost:3000/api/scans \
  -H 'content-type: application/json' \
  -d '{"text":"Hallo Welt","language":"deu","confidence":91.5}'
```

## Dateien

```
server.js          HTTP-Server, SQLite-Anbindung, JSON-API
public/index.html  Oberfläche
public/app.js      Kamera, OCR, Speichern, Liste
public/style.css   Styling (hell/dunkel)
```

## Mögliche nächste Schritte

- OCR serverseitig ausführen, damit auch schwache Geräte schnell sind
- Bilder als Dateien statt als Data-URL speichern
- Volltextsuche über die gespeicherten Texte (SQLite FTS5)
- Authentifizierung, bevor die Seite öffentlich erreichbar ist
