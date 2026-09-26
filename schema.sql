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
  PRIMARY KEY (uid, d)
) WITHOUT ROWID;
