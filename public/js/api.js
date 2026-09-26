// Dünne Hülle um fetch. Läuft die Access-Sitzung ab, leitet Cloudflare auf die
// Anmeldeseite um – das erkennen wir und laden die Seite neu (→ Login).

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

let onLoginNeeded = () => location.reload();
export const setLoginHandler = (fn) => { onLoginNeeded = fn; };

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method, signal,
      redirect: "manual",
      credentials: "same-origin",
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Keine Verbindung. Bist du online?", 0);
  }

  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
    onLoginNeeded();
    throw new ApiError("Bitte neu anmelden", 401);
  }

  const type = res.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await res.json() : null;
  if (!res.ok) throw new ApiError(data?.error || "Fehler " + res.status, res.status, data);
  if (!data) {
    // HTML statt JSON heißt fast immer: Anmeldeseite von Access
    onLoginNeeded();
    throw new ApiError("Bitte neu anmelden", 401);
  }
  return data;
}
