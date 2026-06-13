import { hasSupabase, supabaseRpc } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

export async function onRequestPost({ env }) {
  if (!hasSupabase(env)) return json({ ok: true, supabase_enabled: false, released_count: 0 });
  try {
    const released_count = await supabaseRpc(env, "release_expired_reservations", {});
    return json({ ok: true, supabase_enabled: true, released_count });
  } catch (error) {
    return json({ error: error.message || "Could not release expired reservations.", details: error.details || null }, error.status || 500);
  }
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: "POST /api/release-expired-reservations" });
}
