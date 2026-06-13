import { hasSupabase, supabaseRpc } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

export async function onRequestPost({ request, env }) {
  if (!hasSupabase(env)) return json({ ok: true, supabase_enabled: false });
  let payload = {};
  try { payload = await request.json(); } catch (_) {}
  if (!payload.order_id) return json({ error: "Missing order_id." }, 400);

  try {
    const result = await supabaseRpc(env, "release_order_reservation", { p_order_id: payload.order_id });
    return json({ ok: true, supabase_enabled: true, result });
  } catch (error) {
    return json({ error: error.message || "Could not release reservation.", details: error.details || null }, error.status || 500);
  }
}
