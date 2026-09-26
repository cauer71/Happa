// Anmeldung über Cloudflare Access.
//
// Access steht vor der ganzen Seite: Wer hier ankommt, hat sich bereits
// angemeldet (Einmal-PIN per E-Mail). Access hängt an jede Anfrage ein
// signiertes JWT (Header Cf-Access-Jwt-Assertion). Der Worker prüft Signatur,
// Aussteller, Zielgruppe (AUD) und Ablauf selbst — ohne gültiges Token gibt es
// keine Daten, auch wenn Access einmal falsch konfiguriert sein sollte.

const KEY_TTL_MS = 60 * 60 * 1000;
let keyCache = { at: 0, keys: new Map() };

const b64urlToBytes = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function loadKeys(teamDomain) {
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Access-Zertifikate nicht abrufbar: " + res.status);
  const { keys = [] } = await res.json();
  const map = new Map();
  for (const jwk of keys) {
    const key = await crypto.subtle.importKey(
      "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
    );
    map.set(jwk.kid, key);
  }
  keyCache = { at: Date.now(), keys: map };
}

async function keyFor(kid, teamDomain) {
  if (!keyCache.keys.has(kid) || Date.now() - keyCache.at > KEY_TTL_MS) {
    await loadKeys(teamDomain);
  }
  return keyCache.keys.get(kid);
}

function tokenFrom(request) {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? match[1] : null;
}

// Liefert { email } oder null. Service-Token (für automatisierte Tests)
// haben keine E-Mail; sie bekommen ein eigenes Profil "service:<Client-ID>".
export async function authenticate(request, env) {
  const token = tokenFrom(request);
  if (!token) {
    // Nur für "wrangler dev" auf dem eigenen Rechner (in .dev.vars setzen).
    return env.DEV_USER ? { email: env.DEV_USER } : null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const header = b64urlToJson(parts[0]);
    const payload = b64urlToJson(parts[1]);
    const key = await keyFor(header.kid, env.ACCESS_TEAM_DOMAIN);
    if (!key) return null;

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]),
      new TextEncoder().encode(parts[0] + "." + parts[1])
    );
    if (!valid) return null;

    const now = Math.floor(Date.now() / 1000);
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (payload.iss !== `https://${env.ACCESS_TEAM_DOMAIN}`) return null;
    if (!aud.includes(env.ACCESS_AUD)) return null;
    if (payload.exp && payload.exp < now) return null;
    if (payload.nbf && payload.nbf > now + 60) return null;

    if (payload.email) return { email: String(payload.email).toLowerCase() };
    if (payload.common_name) return { email: "service:" + payload.common_name };
    return null;
  } catch {
    return null;
  }
}
