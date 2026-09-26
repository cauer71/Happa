// Speisenerkennung per Foto über Workers AI (kostenloses Tageskontingent).
//
// Gemma 4 liefert auf Deutsch gute Ergebnisse und kostet mit abgeschaltetem
// "Denken" nur etwa 6–16 Neuronen pro Foto. Llama 4 Scout springt ein, wenn
// Gemma gerade nicht verfügbar ist (≈ 45–50 Neuronen). Beide Modelle stehen im
// Workers-Free-Plan zur Verfügung; ist das Gratis-Kontingent (10.000 Neuronen
// pro Tag) aufgebraucht, wird nichts berechnet, sondern die Anfrage abgelehnt.

const MODELS = [
  {
    id: "@cf/google/gemma-4-26b-a4b-it",
    options: { chat_template_kwargs: { enable_thinking: false } },
  },
  { id: "@cf/meta/llama-4-scout-17b-16e-instruct", options: {} },
];

const PROMPT = `Du bist Ernährungsexperte. Erkenne alle Speisen und Getränke auf dem Foto und schätze die sichtbare Portion.
Antworte NUR mit einzeiligem JSON in genau diesem Format, ohne Text oder Codeblock davor oder danach:
{"dish":"kurzer deutscher Name der Mahlzeit","items":[{"name":"deutscher Name","emoji":"ein passendes Emoji","grams":150,"kcal":250,"protein":10.5,"carbs":30.2,"fat":8.1,"query":"allgemeiner deutscher Suchbegriff für eine Nährwertdatenbank, z. B. Spaghetti gekocht","confidence":0.8}]}
Regeln:
- grams = geschätztes Gewicht der sichtbaren Portion in Gramm (Getränke: ml ≈ g).
- kcal, protein, carbs, fat gelten für diese Portion, nicht pro 100 g.
- Zerlege Gerichte in erkennbare Bestandteile, wenn das sinnvoll ist (z. B. Schnitzel, Pommes, Salat), höchstens 6 Einträge.
- confidence zwischen 0 und 1: wie sicher du dir bei Art und Menge bist.
- Ist kein Essen und kein Getränk zu sehen, antworte {"dish":"","items":[]}.`;

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(+v) ? +v : 0));
const round1 = (v) => Math.round(v * 10) / 10;

function parseAnswer(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Antwort enthält kein JSON");
  const data = JSON.parse(text.slice(start, end + 1));

  const items = (Array.isArray(data.items) ? data.items : []).slice(0, 6).map((it) => {
    const protein = round1(clamp(it.protein, 0, 500));
    const carbs = round1(clamp(it.carbs, 0, 1000));
    const fat = round1(clamp(it.fat, 0, 500));
    let kcal = Math.round(clamp(it.kcal, 0, 10000));
    if (!kcal && (protein || carbs || fat)) kcal = Math.round(protein * 4 + carbs * 4 + fat * 9);
    return {
      name: String(it.name || "Unbekannt").slice(0, 80),
      emoji: String(it.emoji || "🍽️").slice(0, 8),
      grams: Math.round(clamp(it.grams, 1, 3000)),
      kcal, protein, carbs, fat,
      query: String(it.query || it.name || "").slice(0, 80),
      confidence: round1(clamp(it.confidence ?? 0.5, 0, 1)),
    };
  }).filter((it) => it.name);

  return { dish: String(data.dish || "").slice(0, 100), items };
}

function answerText(result) {
  if (!result) return "";
  if (typeof result.response === "string") return result.response;
  if (result.response && typeof result.response === "object") return JSON.stringify(result.response);
  const content = result.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export async function recognizeFood(env, imageDataUrl, hint) {
  const text = hint ? `${PROMPT}\nHinweis der Person zum Foto: ${String(hint).slice(0, 200)}` : PROMPT;
  const messages = [{
    role: "user",
    content: [
      { type: "text", text },
      { type: "image_url", image_url: { url: imageDataUrl } },
    ],
  }];

  const problems = [];
  for (const model of MODELS) {
    try {
      const result = await env.AI.run(model.id, {
        messages, max_tokens: 800, temperature: 0.2, ...model.options,
      });
      return { ...parseAnswer(answerText(result)), model: model.id.split("/").pop() };
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      problems.push(model.id + ": " + message);
      // Tageskontingent aufgebraucht → das zweite Modell hilft auch nicht.
      if (/4006|neurons|allocation|quota/i.test(message)) {
        const e = new Error("quota");
        e.quota = true;
        throw e;
      }
    }
  }
  const e = new Error("Die Erkennung ist fehlgeschlagen.");
  e.details = problems;
  throw e;
}
