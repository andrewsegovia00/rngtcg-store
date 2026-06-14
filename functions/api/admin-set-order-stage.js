/* ============================================================================
   Admin · Move a paid order through the fulfillment stack.

   POST /api/admin-set-order-stage   (Authorization: Bearer <ADMIN_TOKEN>)
   Body: { order_id, stage }   stage in: new | opened_live | resolved

   These are the pre-ship stages (order stays in the PirateShip export until it
   is marked shipped via /api/admin-mark-fulfilled). "shipped" is handled there
   so tracking + fulfilled_at stay in one place.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

const PRE_SHIP_STAGES = ["new", "opened_live", "resolved"];

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const orderId = String(payload.order_id || "").trim();
  const stage = String(payload.stage || "").trim();
  if (!orderId) return json({ error: "Missing order_id." }, 400);
  if (!PRE_SHIP_STAGES.includes(stage)) {
    return json({ error: `stage must be one of: ${PRE_SHIP_STAGES.join(", ")} (use /api/admin-mark-fulfilled to ship).` }, 400);
  }

  try {
    // Only paid, not-yet-shipped orders move through these stages.
    const updated = await supabaseFetch(
      env,
      `/checkout_orders?status=eq.paid&fulfilled_at=is.null&id=eq.${encodeURIComponent(orderId)}&select=id,order_number,stage`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({ stage })
      }
    );
    if (!Array.isArray(updated) || !updated.length) {
      return json({ error: "No matching paid, unshipped order to update." }, 404);
    }
    return json({ ok: true, order: updated[0] });
  } catch (error) {
    return json({ error: error.message || "Could not update order stage.", details: error.details || null }, error.status || 500);
  }
}
