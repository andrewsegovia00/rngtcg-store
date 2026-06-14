/* ============================================================================
   Admin · Delete a coupon. Deactivates the Stripe promotion code (so it can no
   longer be redeemed — Stripe promo codes can't be hard-deleted) and removes
   the mirror row from Supabase.

   POST /api/admin-delete-coupon   (Authorization: Bearer <ADMIN_TOKEN>)
   Body: { code }
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";
import { hasStripe, stripeRequest } from "../_lib/stripe.js";

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }
  const code = String(payload.code || "").trim();
  if (!code) return json({ error: "Missing code." }, 400);

  try {
    const rows = await supabaseFetch(env, `/coupons?code=eq.${encodeURIComponent(code)}&select=code,stripe_promotion_code_id`);
    const coupon = Array.isArray(rows) ? rows[0] : null;
    if (!coupon) return json({ error: "Coupon not found." }, 404);

    // Deactivate in Stripe so it can't be redeemed (best-effort).
    if (hasStripe(env) && coupon.stripe_promotion_code_id) {
      try { await stripeRequest(env, `promotion_codes/${coupon.stripe_promotion_code_id}`, { active: false }); }
      catch (e) { console.warn("Stripe promo deactivate failed", e.message); }
    }

    await supabaseFetch(env, `/coupons?code=eq.${encodeURIComponent(code)}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
    return json({ ok: true, deleted: code });
  } catch (error) {
    return json({ error: error.message || "Could not delete coupon.", details: error.details || null }, error.status || 500);
  }
}
