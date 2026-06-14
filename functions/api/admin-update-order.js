/* ============================================================================
   Admin · Update one or more paid orders (tag + ready-to-ship). Bulk-capable.

   POST /api/admin-update-order   (Authorization: Bearer <ADMIN_TOKEN>)
   Body: { order_ids: string[], order_tag?: 'sealed'|'open_live', ready_to_ship?: bool }

   - "sealed"    → ships as-is (defaults ready_to_ship = true)
   - "open_live" → must be opened on stream first (defaults ready_to_ship = false)
   Pass ready_to_ship on its own to mark an opened order ready (the "mark ready
   to ship" action). Shipping itself stays in /api/admin-mark-fulfilled.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const ids = (Array.isArray(payload.order_ids) ? payload.order_ids : [payload.order_id])
    .map(id => String(id || "").trim()).filter(Boolean);
  if (!ids.length) return json({ error: "Provide order_ids." }, 400);

  const patch = {};
  if (payload.order_tag !== undefined) {
    if (!["sealed", "open_live"].includes(payload.order_tag)) {
      return json({ error: "order_tag must be 'sealed' or 'open_live'." }, 400);
    }
    patch.order_tag = payload.order_tag;
    // Default the ship-readiness from the tag unless caller overrides it.
    if (payload.ready_to_ship === undefined) patch.ready_to_ship = payload.order_tag === "sealed";
  }
  if (payload.ready_to_ship !== undefined) patch.ready_to_ship = Boolean(payload.ready_to_ship);
  if (payload.ship_mode !== undefined) {
    if (!["sealed", "all_cards", "hits_only"].includes(payload.ship_mode)) {
      return json({ error: "ship_mode must be sealed, all_cards, or hits_only." }, 400);
    }
    patch.ship_mode = payload.ship_mode;
  }
  // Bundling: 'new' groups the selected orders under one id; 'clear' un-bundles.
  if (payload.bundle === "new") patch.bundle_id = (crypto.randomUUID && crypto.randomUUID()) || `b_${Date.now()}`;
  else if (payload.bundle === "clear") patch.bundle_id = null;

  if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);

  const inList = ids.map(id => `"${id.replace(/"/g, "")}"`).join(",");
  try {
    const updated = await supabaseFetch(
      env,
      `/checkout_orders?status=eq.paid&id=in.(${encodeURIComponent(inList)})&select=id,order_number,order_tag,ready_to_ship`,
      { method: "PATCH", headers: { prefer: "return=representation" }, body: JSON.stringify(patch) }
    );
    if (!Array.isArray(updated) || !updated.length) return json({ error: "No matching paid orders were updated." }, 404);
    return json({ ok: true, updated: updated.length, orders: updated });
  } catch (error) {
    return json({ error: error.message || "Could not update order.", details: error.details || null }, error.status || 500);
  }
}
