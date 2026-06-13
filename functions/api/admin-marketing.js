/* ============================================================================
   Admin · Marketing overview — coupons, email-list sizes, email analytics.
   GET /api/admin-marketing   (Authorization: Bearer <ADMIN_TOKEN>)
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch, supabaseRpc } from "../_lib/supabase.js";

export async function onRequestGet({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  try {
    const [coupons, overview] = await Promise.all([
      supabaseFetch(env, "/coupons?select=code,percent_off,max_redemptions,expires_at,note,created_at&order=created_at.desc&limit=50"),
      supabaseRpc(env, "marketing_overview", {})
    ]);

    return json({
      ok: true,
      coupons: Array.isArray(coupons) ? coupons : [],
      newsletter_count: overview?.newsletter_count ?? 0,
      order_recipient_count: overview?.order_recipient_count ?? 0,
      email_stats: overview?.email_stats ?? {}
    });
  } catch (error) {
    return json({ error: error.message || "Could not load marketing overview.", details: error.details || null }, error.status || 500);
  }
}
