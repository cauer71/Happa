// Lebensmittelsuche im Browser über den Bundeslebensmittelschlüssel (BLS 4.0).
// Die Datei (~470 KB, komprimiert ~130 KB) wird beim ersten Suchen geladen und
// vom Service Worker zwischengespeichert – danach funktioniert die Suche offline.

import { foodEmoji, defaultGrams, isDrink } from "./nutrition.js";

let foods = null;
let loading = null;

export const norm = (s) => String(s).toLowerCase()
  .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
  .replace(/[^a-z0-9]+/g, " ").trim();

// Zusätze, die ein Lebensmittel "spezieller" machen – solche Einträge rutschen nach hinten
const SPECIAL = /\b(pulver|instantpulver|getrocknet|konserve|angereichert|tiefgefroren|trockenprodukt|instant|saftkonzentrat|diaet|sauer eingelegt|kandiert)\b/;

export function loadFoods() {
  if (foods) return Promise.resolve(foods);
  if (!loading) {
    loading = fetch("/data/foods.json")
      .then((r) => { if (!r.ok) throw new Error("Lebensmittel-Datei nicht verfügbar"); return r.json(); })
      .then((data) => (foods = prepareFoods(data)))
      .catch((err) => { loading = null; throw err; });
  }
  return loading;
}

// Auch vom Worker benutzt (Claude-Connector, Werkzeug happa_naehrwerte)
export function prepareFoods(data) {
  return data.items.map(([name, kcal, protein, fat, carbs, fiber, sugar, group]) => ({
    name, group, key: " " + norm(name) + " ", tight: norm(name).replace(/ /g, ""),
    per100: { kcal, protein, fat, carbs, fiber, sugar },
  }));
}

function score(item, tokens) {
  const key = item.key;
  let s = 0;
  // "haferflocken" soll auch "Hafer Flocken" finden (BLS schreibt manches getrennt)
  if (tokens.length === 1 && key.indexOf(tokens[0]) < 0) {
    const pos = item.tight.indexOf(tokens[0]);
    if (pos < 0) return -1;
    s += pos === 0 ? 60 : 10;
    if (item.tight.length - tokens[0].length <= 4) s += 30;
    if (SPECIAL.test(key)) s -= 18;
    return s - key.length * 0.35;
  }
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const pos = key.indexOf(t);
    if (pos < 0) return -1;
    if (key.indexOf(" " + t + " ") >= 0) s += 40;       // ganzes Wort
    else if (key.indexOf(" " + t) >= 0) s += 22;        // Wortanfang
    else s += 4;                                        // irgendwo im Wort
    if (i === 0 && pos === 1) s += 30;                  // Name beginnt damit
  }
  if (/\broh\b/.test(key) && "FGK".includes(item.group)) s += 12; // Obst/Gemüse: roh zuerst
  if (SPECIAL.test(key)) s -= 18;
  s -= key.length * 0.35;                               // kurze, allgemeine Namen bevorzugen
  return s;
}

export async function searchFoods(query, limit = 40) {
  return rankFoods(await loadFoods(), query, limit).map(asFood);
}

export function rankFoods(list, query, limit = 40) {
  const tokens = norm(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const hits = [];
  for (const item of list) {
    const s = score(item, tokens);
    if (s > -1) hits.push([s, item]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits.slice(0, limit).map(([, item]) => item);
}

// Einheitliches Lebensmittel-Objekt für Portion-Dialog und KI-Alternativen
export function asFood(item) {
  return {
    name: item.name,
    emoji: foodEmoji(item.name, item.group),
    per100: item.per100,
    src: "b",
    grams: defaultGrams(item.name, item.group),
    unit: isDrink(item.name, item.group) ? "ml" : "g",
    source: "BLS",
  };
}

export function productAsFood(p) {
  return {
    name: p.brand ? `${p.name} (${p.brand})` : p.name,
    emoji: foodEmoji(p.name),
    image: p.image,
    per100: { kcal: p.kcal, protein: p.protein, carbs: p.carbs, fat: p.fat, fiber: p.fiber, sugar: p.sugar },
    src: "o",
    grams: p.serving || defaultGrams(p.name),
    unit: p.liquid || isDrink(p.name) ? "ml" : "g",
    perMl: !!p.liquid, // Open Food Facts gibt Getränke pro 100 ml an
    source: "Open Food Facts",
    code: p.code,
  };
}
