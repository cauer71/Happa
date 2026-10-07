-- Happa: Datenbankschema (Cloudflare D1 / SQLite)
-- Bewusst klein gehalten: eine Zeile pro Person und eine Zeile pro Person und Tag.

CREATE TABLE IF NOT EXISTS users (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,  -- AUTOINCREMENT: IDs werden nie wiederverwendet
  email   TEXT NOT NULL UNIQUE,               -- aus der Cloudflare-Access-Anmeldung
  profile TEXT NOT NULL DEFAULT '{}'          -- Profil, Ziele, Abzeichen, zuletzt verwendet (JSON)
);

CREATE TABLE IF NOT EXISTS days (
  uid    INTEGER NOT NULL,                    -- users.id
  d      INTEGER NOT NULL,                    -- Datum als Zahl JJJJMMTT (lokales Datum)
  log    TEXT    NOT NULL DEFAULT '[]',       -- Einträge: [[id, Mahlzeit, Name, g, kcal, Eiweiß, KH, Fett, Quelle, Emoji], ...]
  water  INTEGER NOT NULL DEFAULT 0,          -- getrunken in ml
  weight REAL,                                -- Gewicht in kg (nur an Wiegetagen)
  ai     INTEGER NOT NULL DEFAULT 0,          -- KI-Erkennungen an diesem Tag (Tageslimit)
  act    TEXT,                                -- Verbrauch aus Apple Health (JSON, siehe worker/health.js)
  train  TEXT,                                -- Trainingsplan: [[id, Sportart, Titel, Minuten, "HH:MM", erledigt], ...]
  steps  INTEGER NOT NULL DEFAULT 0,          -- Schritte von Hand gezählt (Knöpfe à 1.000)
  PRIMARY KEY (uid, d)
) WITHOUT ROWID;

-- Schlüssel für den Import aus Health Auto Export (nur der SHA-256-Hash wird gespeichert)
CREATE TABLE IF NOT EXISTS health_keys (
  hash    TEXT PRIMARY KEY,
  uid     INTEGER NOT NULL,
  created INTEGER NOT NULL
) WITHOUT ROWID;

-- Bestehende Datenbank nachrüsten (einmalig):
--   ALTER TABLE days ADD COLUMN act TEXT;
--   ALTER TABLE days ADD COLUMN train TEXT;
--   ALTER TABLE days ADD COLUMN steps INTEGER NOT NULL DEFAULT 0;
