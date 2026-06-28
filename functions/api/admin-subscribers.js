/* ============================================================================
   Admin · Newsletter subscriber list.
   GET /api/admin-subscribers   (Authorization: Bearer <ADMIN_TOKEN>)
   Returns the newsletter list so the admin can view / export it.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

export async function onRequestGet({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  try {
    const rows = await supabaseFetch(
      env,
      "/newsletter_subscribers?select=email,source,subscribed_at,unsubscribed_at,welcome_coupon_code&order=subscribed_at.desc&limit=5000"
    );
    return json({ ok: true, subscribers: Array.isArray(rows) ? rows : [] });
  } catch (error) {
    return json({ error: error.message || "Could not load subscribers.", details: error.details || null }, error.status || 500);
  }
}
