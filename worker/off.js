// Markenprodukte und Barcodes über Open Food Facts (freie Datenbank, ODbL).
// Antworten werden im Cloudflare-Cache der Zone zwischengespeichert (auch "nicht
// gefunden" für einen Tag) – das schont Open Food Facts und spart Zeit.

const UA = "Happa/1.0 (+https://happa.auer.page)";
const FIELDS = "code,product_name,product_name_de,brands,nutriments,serving_quantity,quantity,image_front_small_url";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
};

function upstreamError() {
  const e = new Error("Open Food Facts ist gerade nicht erreichbar. Bitte später noch einmal versuchen.");
  e.upstream = true;
  return e;
}

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
    liquid: /\d\s*(ml|cl|l)\b/i.test(String(p.quantity || "")) || undefined,
    image: p.image_front_small_url || null,
  };
}

async function getJson(url, ttlSeconds) {
  let res;
  try {
    res = await fetch(url, {
      headers: { "user-agent": UA, accept: "application/json" },
      cf: { cacheEverything: true, cacheTtlByStatus: { "200-299": ttlSeconds, "404": 86400, "500-599": 0 } },
    });
  } catch {
    throw upstreamError();
  }
  if (res.status === 404) return null;
  if (!res.ok) throw upstreamError();
  try { return await res.json(); } catch { throw upstreamError(); }
}

export async function searchProducts(query) {
  const q = encodeURIComponent(query.slice(0, 60));
  const data = await getJson(`https://search.openfoodfacts.org/search?q=${q}&langs=de&page_size=24&fields=${FIELDS}`, 86400);
  return ((data && data.hits) || []).map(simplify).filter(Boolean);
}

export async function productByBarcode(code) {
  const data = await getJson(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`, 7 * 86400);
  if (!data || data.status === 0 || !data.product) return null;
  return simplify({ ...data.product, code });
}
