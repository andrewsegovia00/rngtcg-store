/* ============================================================================
   Live catalog endpoint — Supabase becomes the single source of truth for the
   storefront. Returns products in the same shape the client catalog used to
   hardcode, so the frontend can fetch instead of shipping a static list.
   Falls back to the in-code catalog when Supabase is not configured.
   ============================================================================ */
import { CATEGORIES, LANGUAGES, PRODUCTS } from "../_lib/catalog.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

// Shape a Supabase product + its variants into the client catalog shape.
function shapeProduct(p, variantsByProduct) {
  const variants = variantsByProduct.get(p.id) || [];
  const pack = variants.find(v => v.format === "pack");
  const box = variants.find(v => v.format === "box");
  const cents = v => (v && Number.isFinite(v.price_cents) ? v.price_cents / 100 : null);

  return {
    id: p.id,
    category: p.category,
    name: p.name,
    set: p.set_code,
    packPrice: cents(pack),
    boxPrice: cents(box),
    language: p.language || "english",
    // Display fallback only; live per-format availability comes from /api/inventory.
    stock: Math.max(box?.stock_on_hand ?? 0, pack?.stock_on_hand ?? 0),
    sale: p.sale_percent || null,
    badge: p.badge || null,
    tone: p.tone,
    symbol: p.symbol,
    imageLabel: p.image_label || p.name
  };
}

export async function onRequestGet({ env }) {
  if (!hasSupabase(env)) {
    return json({ supabase_enabled: false, categories: CATEGORIES, languages: LANGUAGES, products: PRODUCTS });
  }

  try {
    const [products, variants] = await Promise.all([
      supabaseFetch(env, "products?active=eq.true&select=id,category,name,set_code,language,badge,tone,symbol,image_label,sale_percent&order=created_at.asc"),
      supabaseFetch(env, "product_variants?active=eq.true&select=product_id,format,price_cents,stock_on_hand")
    ]);

    const variantsByProduct = new Map();
    for (const v of variants) {
      if (!variantsByProduct.has(v.product_id)) variantsByProduct.set(v.product_id, []);
      variantsByProduct.get(v.product_id).push(v);
    }

    // Only surface products that actually have a sellable variant + price.
    const shaped = products
      .map(p => shapeProduct(p, variantsByProduct))
      .filter(p => p.packPrice !== null || p.boxPrice !== null);

    return json({ supabase_enabled: true, categories: CATEGORIES, languages: LANGUAGES, products: shaped });
  } catch (error) {
    // Never take the storefront down — fall back to the in-code catalog.
    return json({
      supabase_enabled: false,
      fallback_reason: error.message || "Could not load catalog from Supabase.",
      categories: CATEGORIES,
      languages: LANGUAGES,
      products: PRODUCTS
    });
  }
}
