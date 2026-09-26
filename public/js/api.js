// Dünne Hülle um fetch. Läuft die Access-Sitzung ab, leitet Cloudflare auf die
// Anmeldeseite um – das erkennen wir und laden die Seite neu (→ Login).

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

// Höchstens alle 30 Sekunden automatisch neu laden – sonst droht eine Endlosschleife.
function reloadForLogin() {
  try {
    const last = Number(sessionStorage.getItem("happa.reloadAt") || 0);
    if (Date.now() - last < 30000) return false;
    sessionStorage.setItem("happa.reloadAt", String(Date.now()));
  } catch { /* ohne sessionStorage einfach neu laden */ }
  location.reload();
  return true;
}

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

  // Umleitung zur Access-Anmeldeseite = Sitzung abgelaufen
  if (res.type === "opaqueredirect") {
    reloadForLogin();
    throw new ApiError("Bitte neu anmelden", 401);
  }

  const type = res.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    // HTML statt JSON heißt fast immer: Anmeldeseite von Access
    if (res.status < 500) reloadForLogin();
    throw new ApiError(res.status >= 500 ? "Der Server antwortet gerade nicht." : "Bitte neu anmelden", res.status || 401);
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(data?.error || "Fehler " + res.status, res.status, data);
  return data;
}
