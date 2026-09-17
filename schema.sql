-- Schema der D1-Datenbank (identisch zur lokalen SQLite-Variante)
CREATE TABLE IF NOT EXISTS scans (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at     TEXT NOT NULL,
  text           TEXT NOT NULL,
  language       TEXT,
  confidence     REAL,            -- nur bei der Browser-Erkennung gefuellt
  engine         TEXT             -- "ai" (Workers AI) oder "tesseract"
);

CREATE INDEX IF NOT EXISTS scans_created_at_idx ON scans (created_at DESC);
