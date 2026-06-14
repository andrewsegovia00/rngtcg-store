/* ============================================================================
   Admin · Mark paid orders as shipped/fulfilled.

   POST /api/admin-mark-fulfilled   (Authorization: Bearer <ADMIN_TOKEN>)
   Body: { order_ids: string[], tracking_number?: string, undo?: boolean }

   Sets fulfilled_at = now() (or NULL when undo) on the given paid orders.
   tracking_number is optional and only applied when marking fulfilled.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const ids = Array.isArray(payload.order_ids) ? payload.order_ids : (payload.order_id ? [payload.order_id] : []);
  const cleanIds = ids.map(id => String(id || "").trim()).filter(Boolean);
  if (!cleanIds.length) return json({ error: "Provide order_ids." }, 400);

  const undo = Boolean(payload.undo);
  const patch = undo
    ? { fulfilled_at: null, tracking_number: null, stage: "resolved" }
    : {
        fulfilled_at: new Date().toISOString(),
        stage: "shipped",
        ...(payload.tracking_number ? { tracking_number: String(payload.tracking_number).trim().slice(0, 120) } : {})
      };

  // PostgREST in.() filter — quote ids to be safe.
  const inList = cleanIds.map(id => `"${id.replace(/"/g, "")}"`).join(",");

  try {
    const updated = await supabaseFetch(
      env,
      `/checkout_orders?status=eq.paid&id=in.(${encodeURIComponent(inList)})&select=id,order_number,fulfilled_at,tracking_number`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(patch)
      }
    );
    if (!Array.isArray(updated) || !updated.length) {
      return json({ error: "No matching paid orders were updated." }, 404);
    }
    return json({ ok: true, updated: updated.length, orders: updated });
  } catch (error) {
    return json({ error: error.message || "Could not update fulfillment.", details: error.details || null }, error.status || 500);
  }
}
