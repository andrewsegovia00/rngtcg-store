import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseRpc } from "../_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }
  if (!payload.order_id) return json({ error: "Missing order_id." }, 400);

  try {
    const result = await supabaseRpc(env, "release_order_reservation", { p_order_id: payload.order_id });
    return json({ ok: true, result });
  } catch (error) {
    return json({ error: error.message || "Could not release reservation.", details: error.details || null }, error.status || 500);
  }
}
