#!/usr/bin/env python3
"""Baut public/data/foods.json aus dem Bundeslebensmittelschlüssel (BLS) 4.0.

Quelle: Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 —
Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0
Lizenz: CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/deed.de
Download: https://blsdb.de/download (ZIP mit BLS_4_0_Daten_2025_DE.xlsx)

Aufruf:
    pip install openpyxl
    python3 scripts/build-foods.py pfad/zu/BLS_4_0_Daten_2025_DE.xlsx

Die Datei wird als statisches Asset ausgeliefert und im Browser durchsucht —
die Lebensmitteldaten belegen also keinen Platz in der Datenbank (D1).
"""
import json
import sys
from pathlib import Path

import openpyxl

# Nährstoffcodes laut BLS_4_0_Components_DE_EN.xlsx, alle Angaben pro 100 g
FIELDS = ["ENERCC", "PROT625", "FAT", "CHO", "FIBT", "SUGAR"]
OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "foods.json"


def num(value, digits):
    # "<LOD"/"<LOQ" (unter Nachweis-/Bestimmungsgrenze) und leere Felder zählen als 0
    try:
        value = round(float(value), digits)
    except (TypeError, ValueError):
        return 0
    return int(value) if value == int(value) else value


def main(xlsx):
    ws = openpyxl.load_workbook(xlsx, read_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = list(next(rows))
    cols = {code: next(i for i, h in enumerate(header) if h and h.startswith(code + " ")) for code in FIELDS}

    items = []
    for row in rows:
        code, name = row[0], row[1]
        if not code or not name or row[cols["ENERCC"]] is None:
            continue
        items.append([
            " ".join(str(name).split()),
            num(row[cols["ENERCC"]], 0),
            num(row[cols["PROT625"]], 1),
            num(row[cols["FAT"]], 1),
            num(row[cols["CHO"]], 1),
            num(row[cols["FIBT"]], 1),
            num(row[cols["SUGAR"]], 1),
            code[0],  # Hauptgruppe, z. B. F = Obst, G = Gemüse (für Symbole in der App)
        ])

    data = {
        "v": 1,
        "source": "Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 — "
                  "Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0 — CC BY 4.0",
        "cols": ["name", "kcal", "protein", "fat", "carbs", "fiber", "sugar", "group"],
        "items": items,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(items)} Lebensmittel → {OUT} ({OUT.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
