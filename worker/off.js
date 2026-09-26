// Markenprodukte und Barcodes über Open Food Facts (freie Datenbank, ODbL).
// Antworten werden im Cloudflare-Cache zwischengespeichert, damit wir die
// Server von Open Food Facts schonen und schneller antworten.

const UA = "Happa/1.0 (+https://happa.auer.page)";
const FIELDS = "code,product_name,product_name_de,brands,nutriments,serving_quantity,quantity,image_front_small_url";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
};

// Einheitliches, kleines Format: Werte pro 100 g
function simplify(p) {
  const n = p.nutriments || {};
  let kcal = n["energy-kcal_100g"];
  if (kcal == null && n["energy-kj_100g"] != null) kcal = n["energy-kj_100g"] / 4.184;
  if (kcal == null) return null;
  const brands = Array.isArray(p.brands) ? p.brands.join(", ") : p.brands || "";
  const name = p.product_name_de || p.product_name || "";
  if (!name) return null;
  return {
    code: p.code || "",
    name: name.trim().slice(0, 80),
    brand: brands.split(",")[0].trim().slice(0, 40),
    kcal: Math.round(Number(kcal)),
    protein: num(n.proteins_100g),
    carbs: num(n.carbohydrates_100g),
    fat: num(n.fat_100g),
    fiber: num(n.fiber_100g),
    sugar: num(n.sugars_100g),
    serving: num(p.serving_quantity) || null,
    image: p.image_front_small_url || null,
  };
}

async function cachedJson(url, ttlSeconds, ctx) {
  const cache = caches.default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) return hit.json();

  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!res.ok) throw new Error("Open Food Facts antwortet mit " + res.status);
  const data = await res.json();
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSeconds}` },
  })));
  return data;
}

export async function searchProducts(query, ctx) {
  const q = encodeURIComponent(query.slice(0, 60));
  const url = `https://search.openfoodfacts.org/search?q=${q}&langs=de&page_size=24&fields=${FIELDS}`;
  const data = await cachedJson(url, 86400, ctx);
  return (data.hits || []).map(simplify).filter(Boolean);
}

export async function productByBarcode(code, ctx) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`;
  const data = await cachedJson(url, 7 * 86400, ctx);
  if (data.status === 0 || !data.product) return null;
  return simplify({ ...data.product, code });
}
