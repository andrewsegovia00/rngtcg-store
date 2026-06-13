import { json, requireAdmin, parseInteger } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

function cleanSku(value) {
  return String(value || "").trim();
}

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const sku = cleanSku(payload.sku);
  if (!sku) return json({ error: "Missing sku." }, 400);

  const patch = {};
  try {
    if (payload.stock_on_hand !== undefined) patch.stock_on_hand = parseInteger(payload.stock_on_hand, "Stock", { min: 0, max: 100000 });
    if (payload.price_cents !== undefined) patch.price_cents = parseInteger(payload.price_cents, "Price cents", { min: 0, max: 10000000 });
    if (payload.active !== undefined) patch.active = Boolean(payload.active);
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);

  try {
    const updated = await supabaseFetch(env, `/product_variants?sku=eq.${encodeURIComponent(sku)}&select=sku,product_id,format,price_cents,stock_on_hand,stock_reserved,stock_sold,active`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!Array.isArray(updated) || !updated.length) return json({ error: "Variant not found." }, 404);
    return json({ ok: true, variant: updated[0] });
  } catch (error) {
    return json({ error: error.message || "Could not update variant.", details: error.details || null }, error.status || 500);
  }
}
