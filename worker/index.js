// Cloudflare-Worker: Texterkennung über Workers AI, Speicherung in D1.
// Gleiche JSON-API wie server.js, zusätzlich /api/ocr.

// Beide Modelle lesen deutsche und italienische Dokumente sauber ab; das
// zweite springt ein, wenn das erste gerade keine Kapazität hat.
const OCR_MODELS = [
  "@cf/mistralai/mistral-small-3.1-24b-instruct",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
];

const MODE_INSTRUCTION = {
  flow: "Gib den Text als Fließtext wieder und behalte Absätze und Zeilenumbrüche so bei, wie sie im Bild stehen.",
  table: "Der Text ist tabellarisch oder ein Formular. Gib ihn als Markdown-Tabelle bzw. als Liste aus Feldname: Wert wieder, damit die Struktur erhalten bleibt.",
  hand: "Der Text ist handschriftlich. Übertrage ihn so genau wie möglich und setze hinter unsichere Wörter ein [?].",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

function ocrPrompt(language, mode) {
  return [
    "Du liest den Text auf dem beigefügten Foto ab (OCR).",
    "Sprache im Dokument: " + language + ".",
    MODE_INSTRUCTION[mode] || MODE_INSTRUCTION.flow,
    "",
    "Regeln:",
    "- Antworte ausschließlich mit dem abgelesenen Text, ohne Einleitung, ohne Kommentar, ohne Code-Block.",
    "- Übersetze nichts und korrigiere keine Rechtschreibfehler; gib wieder, was dasteht.",
    "- Unleserliche Stellen markierst du mit [unleserlich].",
    "- Enthält das Bild keinen lesbaren Text, antworte genau mit: KEIN_TEXT",
  ].join("\n");
}

async function handleOcr(request, env) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Ungültiges JSON" }, 400);
  }

  const image = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl : "";
  if (!image.startsWith("data:image/")) {
    return json({ error: "Kein Bild übergeben" }, 400);
  }

  const messages = [{
    role: "user",
    content: [
      { type: "text", text: ocrPrompt(payload.language || "Deutsch", payload.mode) },
      { type: "image_url", image_url: { url: image } },
    ],
  }];

  const problems = [];
  for (const model of OCR_MODELS) {
    try {
      const result = await env.AI.run(model, { messages, max_tokens: 2000 });
      const text = (result && (result.response ?? result.description ?? "")).trim();
      if (!text) { problems.push(model + ": leere Antwort"); continue; }
      return json({ text, model, empty: text === "KEIN_TEXT" });
    } catch (err) {
      problems.push(model + ": " + (err && err.message ? err.message : String(err)));
    }
  }

  return json({ error: "Die Texterkennung ist fehlgeschlagen.", details: problems }, 502);
}

async function handleApi(request, env, url) {
  const idMatch = url.pathname.match(/^\/api\/scans\/(\d+)$/);
  const method = request.method;

  if (url.pathname === "/api/ocr" && method === "POST") {
    return handleOcr(request, env);
  }

  if (url.pathname === "/api/scans" && method === "GET") {
    const limit = Math.min(Number(url.searchParams.get("limit")) || 50, 200);
    const { results } = await env.DB.prepare(
      `SELECT id, created_at, text, language, confidence, engine
       FROM scans ORDER BY id DESC LIMIT ?`
    ).bind(limit).all();
    return json({ scans: results });
  }

  if (url.pathname === "/api/scans" && method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Ungültiges JSON" }, 400);
    }

    const text = typeof payload.text === "string" ? payload.text.trim() : "";
    if (!text) return json({ error: "Kein Text übergeben" }, 400);

    const { meta } = await env.DB.prepare(
      `INSERT INTO scans (created_at, text, language, confidence, engine)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(
      new Date().toISOString(),
      text,
      typeof payload.language === "string" ? payload.language : null,
      Number.isFinite(payload.confidence) ? payload.confidence : null,
      typeof payload.engine === "string" ? payload.engine : null
    ).run();

    return json({ id: meta.last_row_id }, 201);
  }

  if (idMatch && method === "GET") {
    const scan = await env.DB.prepare(`SELECT * FROM scans WHERE id = ?`).bind(Number(idMatch[1])).first();
    return scan ? json({ scan }) : json({ error: "Nicht gefunden" }, 404);
  }

  if (idMatch && method === "DELETE") {
    await env.DB.prepare(`DELETE FROM scans WHERE id = ?`).bind(Number(idMatch[1])).run();
    return json({ ok: true });
  }

  return json({ error: "Unbekannter Endpunkt" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await handleApi(request, env, url);
      } catch (err) {
        return json({ error: err.message ?? "Serverfehler" }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};
