# Analyse: sechs Abnehm-Apps – Grafik und Motivation

Grundlage: Women's Health, „Diese 6 Abnehm-Apps funktionieren wirklich – und diese sind nur Marketing“
(https://www.womenshealth.de/abnehmen/schnell-abnehmen/diese-6-abnehm-apps-funktionieren-wirklich-und-diese-sind-nur-marketing/),
ergänzt um eigene Recherche zu Oberfläche und Motivationsmechanismen (App-Store-Screenshots, Herstellerseiten, Berichte).

<!-- DETAILS -->

## Kernaussagen des Artikels

- **Einfaches Tracking ist der wirksamste Mechanismus.** Diese Grundfunktion bieten alle Apps kostenlos.
  Teure Zusatzfunktionen dienen vor allem dem Marketing, nicht der Wirkung.
- **Gesundes Tempo: höchstens 0,5 kg pro Woche.** Noom wirbt mit 1,2 kg pro Woche – unrealistisch.
- Urteil: YAZIO, MyFitnessPal, FDDB, Lifesum und Zanadio **funktionieren**; **Noom ist vor allem Marketing**
  (ca. 50 €/Monat, Coaches ohne zertifizierte Ausbildung, im Kern eine Diät-App).

| App | Urteil | Preis laut Artikel | Stärke laut Artikel | Schwäche laut Artikel |
| --- | --- | --- | --- | --- |
| YAZIO | funktioniert | kostenlos, PRO ab 6,99 €/Monat | deutsche Lebensmitteldatenbank, Barcode gratis, Intervallfasten, intuitiv | Analysen nur mit PRO |
| MyFitnessPal | funktioniert | kostenlos, Premium ab 4,17 €/Monat | größte Datenbank (14+ Mio.), Wearables, Community | fehlerhafte Community-Einträge, Datenschutz (USA) |
| FDDB | funktioniert | kostenlos, Premium ab 3,33 €/Monat | Basics dauerhaft gratis, Barcode gratis, deutsche Community | Werbung, einfaches Design |
| Lifesum | funktioniert | kostenlos, Premium ab 8,33 €/Monat | Pläne (Keto, Low Carb, mediterran), ansprechendes Design | wichtige Funktionen nur Premium |
| Zanadio | funktioniert | kostenlos auf Rezept (DiGA) | klinisch geprüft, EU-Datenschutz, Betreuung durch Fachleute | nur mit Rezept und medizinischer Indikation |
| Noom | Marketing | ca. 50 €/Monat, Jahresabo 13,67 €/Monat | psychologischer Ansatz, Lektionen, Chat | teuer, Coaches nicht zertifiziert, überzogene Versprechen |

## Was Happa daraus übernimmt

| Mechanismus | Vorbild | Umsetzung in Happa |
| --- | --- | --- |
| Tracking so einfach wie möglich | alle | Foto genügt: Workers AI erkennt Bestandteile, Menge und Nährwerte; Suche offline; Barcode; „Zuletzt verwendet“ mit Ein-Tipp-Hinzufügen |
| Kalorienring mit „übrig“ statt „gegessen“ | YAZIO, Lifesum, MyFitnessPal | großer Ring im Stil der Apple-Aktivitätsringe, links gegessen, rechts Ziel; über dem Ziel wird er orange statt rot |
| Makro-Balken | YAZIO, Lifesum | Kohlenhydrate, Eiweiß, Fett als Balken unter dem Ring |
| Mahlzeiten-Karten mit Plus | YAZIO, MyFitnessPal | Frühstück, Mittag, Abend, Snacks – je mit Kamera- und Plus-Taste |
| Wasser-Tracker | YAZIO, Lifesum | Gläser antippen, Ziel aus dem Körpergewicht (35 ml/kg) |
| realistische Zielprognose | YAZIO, Noom (Onboarding) | „Ziel voraussichtlich im März 2027“ – mit höchstens 0,5 kg/Woche |
| „Wenn jede Woche so wäre …“ | MyFitnessPal („Tagebuch abschließen“) | Prognose aus dem echten 7-Tage-Schnitt im Tab Fortschritt |
| Serie / Streak | MyFitnessPal, YAZIO, Noom | 🔥-Zähler, Kalender der letzten 5 Wochen, Rekord |
| Abzeichen | MyFitnessPal, Noom | 11 Abzeichen (erster Eintrag, erstes Foto, 3/7/30 Tage, Wasser, Punktlandung, 1 kg, 5 kg, Ziel) mit Konfetti |
| Gewichtskurve mit Ziellinie | alle | Kurve, Fortschrittsbalken Start → Ziel |
| sachliche Tipps | Noom (Lektionen), Zanadio (Programm) | ein kurzer, belegbarer Tipp pro Tag statt teurer Kurse |
| schönes Design | Lifesum | Liquid-Glass-Oberfläche, Emojis als Lebensmittelsymbole, Animationen, Haptik |
| deutsche Lebensmitteldaten | YAZIO, FDDB | Bundeslebensmittelschlüssel 4.0 (7.140 Lebensmittel) + Open Food Facts |
| Datenschutz | Zanadio | Cloudflare, Fotos werden nie gespeichert, Export und Konto löschen jederzeit |

## Bewusst weggelassen

- **Paywall und Abo-Druck** (Testphase mit Preisanker, gesperrte Funktionen): Happa hat keine Bezahlfunktionen.
- **Überzogene Versprechen** (1,2 kg/Woche): Tempo höchstens 0,5 kg/Woche, nie unter 1.200/1.500 kcal,
  kein Zielgewicht im Untergewicht.
- **Schuldgefühle**: kein Rot, keine Warnsymbole beim Überschreiten; stattdessen „Etwas drüber – kein Problem.
  Entscheidend ist der Wochenschnitt.“
- **Endlose Fragebögen**: Das Onboarding hat sechs kurze Schritte und endet mit dem fertigen Plan.
- **Werbung und Datenhandel**: keine.
