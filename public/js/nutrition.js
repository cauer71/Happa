// Ernährungslogik: Mahlzeiten, Kalorienziel, Summen, Abzeichen, Tipps, Symbole.

export const MEALS = [
  { id: 0, name: "Frühstück", emoji: "☕️", tint: "#ffb340" },
  { id: 1, name: "Mittagessen", emoji: "🍝", tint: "#ff7a59" },
  { id: 2, name: "Abendessen", emoji: "🥗", tint: "#5e8bff" },
  { id: 3, name: "Snacks", emoji: "🍎", tint: "#2fc27b" },
];

export function mealForNow(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h < 10.5) return 0;
  if (h < 14.5) return 1;
  if (h < 17.5) return 3;
  if (h < 21.5) return 2;
  return 3;
}

export const ACTIVITY = [
  { id: "low", pal: 1.2, e: "🪑", name: "Wenig aktiv", desc: "Überwiegend sitzend, kaum Bewegung" },
  { id: "light", pal: 1.375, e: "🚶", name: "Leicht aktiv", desc: "Viel auf den Beinen oder 1–3× Sport pro Woche" },
  { id: "active", pal: 1.55, e: "🚴", name: "Aktiv", desc: "Körperliche Arbeit oder 3–5× Sport pro Woche" },
  { id: "very", pal: 1.725, e: "🏃", name: "Sehr aktiv", desc: "Täglich intensives Training" },
];

export const PACES = [
  { v: 0.25, name: "Gemütlich", desc: "0,25 kg pro Woche – kaum spürbarer Verzicht" },
  { v: 0.5, name: "Empfohlen", desc: "0,5 kg pro Woche – nachhaltig und gut durchzuhalten" },
];

export const SEXES = [
  { id: "f", name: "Weiblich" },
  { id: "m", name: "Männlich" },
  { id: "d", name: "Divers" },
];

export const bmi = (kg, cm) => kg / ((cm / 100) ** 2);

// Grundumsatz nach Mifflin-St Jeor
export function bmr({ sex, born, height }, weight) {
  const age = new Date().getFullYear() - born;
  const base = 10 * weight + 6.25 * height - 5 * age;
  return base + (sex === "m" ? 5 : sex === "f" ? -161 : -78);
}

// Tagesziel und Prognose aus dem Profil
export function plan(p, weight = p.startWeight) {
  const act = ACTIVITY.find((a) => a.id === p.activity) || ACTIVITY[0];
  const base = bmr(p, weight);
  const tdee = base * act.pal;
  const diff = (p.goalWeight ?? weight) - weight;
  const mode = Math.abs(diff) < 0.3 ? "keep" : diff < 0 ? "lose" : "gain";
  const pace = mode === "keep" ? 0 : mode === "gain" ? 0.25 : Math.min(0.5, p.pace || 0.5);
  // 1 kg Körperfett ≈ 7.700 kcal
  const delta = (pace * 7700) / 7;
  const floor = p.sex === "m" ? 1500 : 1200;
  let kcal = mode === "lose" ? tdee - delta : mode === "gain" ? tdee + delta : tdee;
  const floored = mode === "lose" && kcal < floor;
  kcal = Math.round(Math.max(floor, kcal) / 10) * 10;
  // Tatsächliches Tempo: Liegt die Sicherheitsgrenze über dem Verbrauch, gibt es keins.
  const realPace = mode === "lose" ? Math.max(0, tdee - kcal) * 7 / 7700
    : mode === "gain" ? Math.max(0, kcal - tdee) * 7 / 7700 : 0;
  const weeks = realPace >= 0.05 ? Math.abs(diff) / realPace : null;
  const eta = weeks ? new Date(Date.now() + weeks * 7 * 86400000) : null;
  const split = p.split || { carbs: 50, protein: 20, fat: 30 };
  return {
    bmr: Math.round(base), tdee: Math.round(tdee), kcal, mode, pace: realPace, weeks, eta, floored,
    protein: Math.round((kcal * split.protein / 100) / 4),
    carbs: Math.round((kcal * split.carbs / 100) / 4),
    fat: Math.round((kcal * split.fat / 100) / 9),
    water: Math.min(3500, Math.max(1500, Math.round((weight * 35) / 250) * 250)),
  };
}

// Aktuelle Ziele (manuelle Vorgaben aus dem Profil haben Vorrang)
export function goals(profile, weight) {
  const auto = plan(profile, weight || profile.startWeight);
  const kcal = profile.kcalGoal || auto.kcal;
  const split = profile.split || { carbs: 50, protein: 20, fat: 30 };
  return {
    kcal,
    protein: Math.round((kcal * split.protein / 100) / 4),
    carbs: Math.round((kcal * split.carbs / 100) / 4),
    fat: Math.round((kcal * split.fat / 100) / 9),
    water: profile.waterGoal || auto.water,
    auto,
  };
}

// Eintrag: [id, Mahlzeit, Name, Gramm, kcal, Eiweiß, KH, Fett, Quelle, Emoji]
export const E = { id: 0, meal: 1, name: 2, grams: 3, kcal: 4, protein: 5, carbs: 6, fat: 7, src: 8, emoji: 9 };

export function totals(log = []) {
  const t = { kcal: 0, protein: 0, carbs: 0, fat: 0, meals: [0, 0, 0, 0], count: log.length };
  for (const e of log) {
    t.kcal += e[E.kcal];
    t.protein += e[E.protein];
    t.carbs += e[E.carbs];
    t.fat += e[E.fat];
    t.meals[e[E.meal]] = (t.meals[e[E.meal]] || 0) + e[E.kcal];
  }
  return t;
}

// Aus Werten pro 100 g einen Eintrag bauen
export function makeEntry({ id, meal, name, grams, per100, src, emoji }) {
  const f = grams / 100;
  return [
    id, meal, name, Math.round(grams * 10) / 10,
    Math.round(per100.kcal * f),
    Math.round(per100.protein * f * 10) / 10,
    Math.round(per100.carbs * f * 10) / 10,
    Math.round(per100.fat * f * 10) / 10,
    src, emoji || "",
  ];
}

export function per100Of(entry) {
  const g = entry[E.grams] || 100;
  const f = 100 / g;
  return { kcal: entry[E.kcal] * f, protein: entry[E.protein] * f, carbs: entry[E.carbs] * f, fat: entry[E.fat] * f };
}

// ── Abzeichen ──
// big: große Meilensteine – Feuerwerk statt Konfetti
export const BADGES = [
  { id: "first", e: "🍽️", name: "Erster Bissen", desc: "Den ersten Eintrag gemacht." },
  { id: "photo", e: "📸", name: "Food-Fotograf", desc: "Zum ersten Mal ein Essen per Foto erkennen lassen." },
  { id: "streak3", e: "🔥", name: "Dranbleiber", desc: "3 Tage in Folge eingetragen." },
  { id: "week", e: "📅", name: "Ganze Woche", desc: "Von Montag bis Sonntag jeden Tag etwas eingetragen." },
  { id: "streak7", e: "🗓️", name: "Eine Woche!", desc: "7 Tage in Folge eingetragen.", big: true },
  { id: "streak30", e: "🏅", name: "Gewohnheit", desc: "30 Tage in Folge eingetragen – so entsteht eine Gewohnheit.", big: true },
  { id: "meals100", e: "💯", name: "100 Einträge", desc: "100 Mal gegessen und eingetragen.", big: true },
  { id: "water", e: "💧", name: "Gut gewässert", desc: "Das Wasserziel eines Tages erreicht." },
  { id: "balanced", e: "⚖️", name: "Punktlandung", desc: "Einen Tag mit mindestens 3 Mahlzeiten nahe am Kalorienziel (±10 %) abgeschlossen." },
  { id: "weigh", e: "📉", name: "Auf der Waage", desc: "Zum ersten Mal das Gewicht eingetragen." },
  { id: "kg1", e: "🌱", name: "Erstes Kilo", desc: "1 kg seit dem Start abgenommen." },
  { id: "kg5", e: "🌿", name: "Fünf geschafft", desc: "5 kg seit dem Start abgenommen." },
  { id: "goal", e: "🏆", name: "Ziel erreicht", desc: "Das Zielgewicht erreicht. Großartig!", big: true },
];

// ctx: { log, day, streak, water, waterGoal, kcalGoal, weight, profile, usedAi, isPast, weekDone, entries }
export function earnedBadges(ctx) {
  const got = [];
  const { profile } = ctx;
  if (ctx.log.length) got.push("first");
  if (ctx.usedAi) got.push("photo");
  if (ctx.streak >= 3) got.push("streak3");
  if (ctx.streak >= 7) got.push("streak7");
  if (ctx.streak >= 30) got.push("streak30");
  if (ctx.weekDone) got.push("week");
  if (ctx.entries >= 100) got.push("meals100");
  if (ctx.water >= ctx.waterGoal && ctx.waterGoal > 0) got.push("water");
  const t = totals(ctx.log);
  const mealsWithFood = t.meals.filter((k) => k > 0).length;
  if (ctx.isPast && mealsWithFood >= 3 && Math.abs(t.kcal - ctx.kcalGoal) <= ctx.kcalGoal * 0.1) got.push("balanced");
  if (ctx.weight) {
    got.push("weigh");
    const lost = (profile.startWeight || ctx.weight) - ctx.weight;
    if (lost >= 1) got.push("kg1");
    if (lost >= 5) got.push("kg5");
    const target = profile.goalWeight;
    if (target && profile.startWeight > target && ctx.weight <= target) got.push("goal");
  }
  return got;
}

// ── Tipps (sachlich, ohne Werbeversprechen) ──
export const TIPS = [
  ["📝", "Eintragen wirkt", "Regelmäßiges Eintragen hilft nachweislich beim Abnehmen – auch wenn nicht jede Zahl perfekt ist."],
  ["🥚", "Eiweiß macht satt", "Quark, Eier, Fisch oder Hülsenfrüchte zu jeder Mahlzeit helfen gegen Heißhunger."],
  ["💧", "Erst ein Glas Wasser", "Ein Glas Wasser vor dem Essen füllt den Magen – die Portion fällt oft kleiner aus."],
  ["🥦", "Gemüse zuerst", "Mit Salat oder Gemüse beginnen senkt die Kaloriendichte der ganzen Mahlzeit."],
  ["🐢", "Langsam ist schneller", "Ein moderates Tempo ist leichter durchzuhalten. Crash-Diäten enden oft im Jo-Jo-Effekt."],
  ["😴", "Schlaf zählt mit", "Zu wenig Schlaf steigert den Appetit auf Süßes und Fettiges."],
  ["🧃", "Getränke nicht vergessen", "Saft, Limo, Latte macchiato und Alkohol haben oft mehr Kalorien als gedacht."],
  ["🍽️", "Kleinere Teller", "Auf kleinen Tellern wirken Portionen größer – ein einfacher Trick gegen Nachschlag."],
  ["⏱️", "Langsam essen", "Das Sättigungsgefühl setzt erst nach etwa 20 Minuten ein."],
  ["🌾", "Ballaststoffe", "Vollkorn, Obst und Gemüse halten den Blutzucker stabil und machen länger satt."],
  ["⚖️", "Richtig wiegen", "Immer zur gleichen Zeit wiegen, am besten morgens. Schwankungen von 1–2 kg sind normal."],
  ["🌤️", "Ein Tag ist kein Rückschlag", "Entscheidend ist der Durchschnitt über Wochen, nicht ein einzelner Tag."],
  ["👟", "Alltagsbewegung", "Treppen und Spaziergänge verbrauchen oft mehr als ein kurzes Training – jeder Schritt zählt."],
  ["🥜", "Snacks planen", "Obst, eine Handvoll Nüsse oder Joghurt griffbereit verhindern spontane Süßigkeiten."],
  ["🫒", "Öl abmessen", "Ein Esslöffel Öl hat rund 90 kcal. Beim Kochen lieber abmessen als schütten."],
  ["📸", "Vor dem ersten Bissen", "Fotografiere dein Essen, bevor du anfängst – so vergisst du nichts."],
  ["🍷", "Alkohol", "Alkohol liefert 7 kcal pro Gramm und senkt die Hemmschwelle beim Essen."],
  ["🏋️", "Muskeln schützen", "Krafttraining 2–3× pro Woche erhält den Grundumsatz beim Abnehmen."],
];
export const tipFor = (d) => TIPS[d % TIPS.length];

// ── Symbole für Lebensmittel ──
const KEYWORDS = [
  [/apfelsine|orange|mandarine|clementine/, "🍊"], [/zitrone|limette/, "🍋"], [/apfel(?!sine)/, "🍎"],
  [/birne/, "🍐"], [/banane/, "🍌"], [/erdbeer/, "🍓"], [/heidelbeer|blaubeer/, "🫐"], [/kirsch/, "🍒"],
  [/traube|rosine/, "🍇"], [/wassermelone/, "🍉"], [/melone/, "🍈"], [/ananas/, "🍍"], [/mango/, "🥭"],
  [/kiwi/, "🥝"], [/pfirsich|aprikose|nektarine/, "🍑"], [/kokos/, "🥥"], [/avocado/, "🥑"],
  [/tomate|ketchup/, "🍅"], [/karotte|möhre|mohrrübe/, "🥕"], [/gurke/, "🥒"], [/paprika|peperoni/, "🫑"],
  [/brokkoli|broccoli/, "🥦"], [/salat|rucola|spinat/, "🥬"], [/mais/, "🌽"], [/pommes|frites/, "🍟"],
  [/kartoffel|kroket/, "🥔"], [/zwiebel/, "🧅"], [/knoblauch/, "🧄"], [/pilz|champignon/, "🍄"],
  [/aubergine/, "🍆"], [/bohne|linse|kichererbse|erbse/, "🫘"], [/croissant|hörnchen/, "🥐"],
  [/brezel|breze/, "🥨"], [/baguette|brötchen|semmel/, "🥖"], [/brot|toast|knäcke/, "🍞"],
  [/pfannkuchen|pancake|crêpe|waffel/, "🥞"], [/käse|mozzarella|parmesan|feta|gouda/, "🧀"],
  [/(^|\s)(hühner)?ei(er)?(\s|$)|rührei|spiegelei|omelett/, "🥚"], [/butter(?!milch)/, "🧈"],
  [/joghurt|quark|skyr|milch|kefir/, "🥛"], [/speck|bacon|schinken/, "🥓"], [/wurst|würstchen|salami/, "🌭"],
  [/hähnchen|huhn|hühner|pute|geflügel|chicken/, "🍗"], [/burger/, "🍔"], [/pizza/, "🍕"],
  [/döner|kebab|wrap|gyros/, "🥙"], [/sandwich/, "🥪"], [/taco|burrito/, "🌮"], [/sushi/, "🍣"],
  [/garnele|krabbe|shrimp|scampi/, "🦐"], [/fisch|lachs|thunfisch|forelle|hering|kabeljau/, "🐟"],
  [/steak|rind|schwein|fleisch|schnitzel|braten|hackfleisch|kalb|lamm/, "🥩"],
  [/reis|risotto/, "🍚"], [/nudel|spaghetti|pasta|teigwaren|lasagne|penne|makkaroni/, "🍝"],
  [/suppe|brühe|eintopf|gulasch|curry/, "🍲"], [/müsli|hafer|cornflakes|granola/, "🥣"],
  [/torte/, "🎂"], [/kuchen|strudel|muffin/, "🍰"], [/keks|plätzchen|cookie/, "🍪"], [/schokolade|praline/, "🍫"],
  [/(^|\s)eis(\s|$)|speiseeis|eiscreme|sorbet/, "🍨"], [/bonbon|gummi|süßigkeit/, "🍬"], [/honig/, "🍯"],
  [/popcorn/, "🍿"], [/nuss|nüsse|mandel|erdnuss|cashew|pistazie/, "🥜"], [/kaffee|espresso|cappuccino/, "☕️"],
  [/tee(\s|$)/, "🍵"], [/bier/, "🍺"], [/sekt|champagner/, "🥂"], [/wein/, "🍷"], [/saft|smoothie/, "🧃"],
  [/cola|limonade|limo|eistee/, "🥤"], [/wasser/, "💧"],
];
const GROUPS = {
  B: "🍞", C: "🌾", D: "🥐", E: "🥚", F: "🍎", G: "🥬", H: "🫘", K: "🥔", M: "🧀", N: "🥤",
  P: "🍷", Q: "🧈", R: "🧂", S: "🍬", T: "🐟", U: "🥩", V: "🍗", W: "🌭", X: "🍲", Y: "🍽️",
};
export function foodEmoji(name, group) {
  const n = String(name || "").toLowerCase();
  for (const [re, e] of KEYWORDS) if (re.test(n)) return e;
  return GROUPS[group] || "🍽️";
}

// Übliche Portionsgrößen als Vorschlag
const PORTIONS = [
  [/(^|\s)(hühner)?ei(er)?(\s|$)/, 60], [/apfel(?!saft|wein|kuchen|mus|essig)|birne|orange/, 150], [/banane/, 120],
  [/brötchen|semmel|croissant|brezel/, 60], [/brot|toast/, 50], [/joghurt|skyr|quark/, 150],
  [/milch(?!pulver|reis)/, 200], [/kaffee|espresso/, 150], [/tee(\s|$)/, 250], [/bier/, 500], [/wein|sekt/, 150],
  [/saft|cola|limonade|wasser/, 250], [/pizza/, 350], [/nudel|spaghetti|teigwaren|reis/, 200],
  [/butter|öl|margarine/, 10], [/käse/, 30], [/wurst|schinken|salami/, 30], [/schokolade/, 25],
  [/kuchen|torte|strudel/, 120], [/müsli|hafer|flocken/, 50], [/nuss|nüsse|mandel/, 25], [/suppe|eintopf/, 300],
];
export function defaultGrams(name, group) {
  const n = String(name || "").toLowerCase();
  for (const [re, g] of PORTIONS) if (re.test(n)) return g;
  if (group === "N") return 250;
  if (group === "X" || group === "Y") return 250;
  return 100;
}
