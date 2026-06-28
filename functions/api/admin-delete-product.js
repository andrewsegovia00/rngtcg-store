/* ============================================================================
   Admin · Delete a product (and its variants).
   POST /api/admin-delete-product   Body: { id }   (Bearer ADMIN_TOKEN)

   Hard delete is only allowed when NOTHING references the product — i.e. it has
   no order history. Orders keep a FK to products/variants, so deleting a product
   that has ever sold would orphan order records. In that case we refuse and tell
   the admin to hide it instead (active=false), which already removes it from the
   shop.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }
  const id = String(payload.id || "").trim();
  if (!id) return json({ error: "Product id is required." }, 400);

  try {
    // Refuse if any order line references this product.
    const used = await supabaseFetch(env, `/checkout_order_items?product_id=eq.${encodeURIComponent(id)}&select=id&limit=1`);
    if (Array.isArray(used) && used.length) {
      return json({ error: "This product has order history, so it can't be deleted. Hide it instead — that removes it from the shop while keeping past orders intact." }, 409);
    }

    // Variants first (they FK to the product), then the product itself.
    await supabaseFetch(env, `/product_variants?product_id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    await supabaseFetch(env, `/products?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });

    return json({ ok: true, deleted: id });
  } catch (error) {
    return json({ error: error.message || "Could not delete product.", details: error.details || null }, error.status || 500);
  }
}
