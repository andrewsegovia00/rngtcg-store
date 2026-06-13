import { PRODUCTS } from "../_lib/catalog.js";
import { hasSupabase, supabaseRpc } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  }
});

function fallbackInventory() {
  return PRODUCTS.flatMap(p => ([
    { product_id: p.id, format: "pack", sku: `${p.id}:pack`, available: p.stock, stock_on_hand: p.stock, stock_reserved: 0, stock_sold: 0 },
    { product_id: p.id, format: "box", sku: `${p.id}:box`, available: p.stock, stock_on_hand: p.stock, stock_reserved: 0, stock_sold: 0 }
  ]));
}

export async function onRequestGet({ env }) {
  if (!hasSupabase(env)) {
    return json({ supabase_enabled: false, variants: fallbackInventory() });
  }

  try {
    const variants = await supabaseRpc(env, "get_inventory_snapshot", {});
    return json({ supabase_enabled: true, variants });
  } catch (error) {
    return json({ error: error.message || "Could not load inventory.", details: error.details || null }, error.status || 500);
  }
}
