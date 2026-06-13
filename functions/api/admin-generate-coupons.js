/* ============================================================================
   Admin · Generate single-use discount codes via Stripe promotion codes.

   POST /api/admin-generate-coupons   (Authorization: Bearer <ADMIN_TOKEN>)
   Body: { count?=1, percent_off?=10, expires_days?, note? }

   Creates one Stripe coupon (percent off, duration=once) and N promotion codes
   each with max_redemptions=1 — Stripe enforces single-use redemption. Codes
   are mirrored into Supabase `coupons` for tracking. Customers redeem them on
   Stripe's hosted checkout (allow_promotion_codes is already enabled).
   ============================================================================ */
import { json, requireAdmin, parseInteger } from "../_lib/admin.js";
import { hasStripe, stripeRequest } from "../_lib/stripe.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

// Unambiguous alphabet (no 0/O/1/I) for human-readable codes.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(prefix = "RG") {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const body = Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("");
  return `${prefix}-${body}`;
}

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasStripe(env)) return json({ error: "Missing STRIPE_SECRET_KEY." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  let count, percentOff;
  try {
    count = parseInteger(payload.count ?? 1, "Count", { min: 1, max: 100 });
    percentOff = parseInteger(payload.percent_off ?? 10, "Percent off", { min: 1, max: 90 });
  } catch (error) {
    return json({ error: error.message }, 400);
  }

  let expiresAt = null; // unix seconds for Stripe
  if (payload.expires_days !== undefined && payload.expires_days !== null && payload.expires_days !== "") {
    const days = parseInteger(payload.expires_days, "Expires days", { min: 1, max: 365 });
    expiresAt = Math.floor(Date.now() / 1000) + days * 86400;
  }
  const note = payload.note ? String(payload.note).slice(0, 200) : null;

  try {
    // One coupon, many single-use promotion codes pointing at it.
    const coupon = await stripeRequest(env, "coupons", {
      percent_off: percentOff,
      duration: "once",
      name: `${percentOff}% off`,
      metadata: { source: "rg-admin" }
    });

    const created = [];
    for (let i = 0; i < count; i++) {
      const code = randomCode();
      const promo = await stripeRequest(env, "promotion_codes", {
        coupon: coupon.id,
        code,
        max_redemptions: 1,
        ...(expiresAt ? { expires_at: expiresAt } : {})
      });
      created.push({
        code,
        stripe_coupon_id: coupon.id,
        stripe_promotion_code_id: promo.id,
        percent_off: percentOff,
        max_redemptions: 1,
        expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
        note
      });
    }

    if (hasSupabase(env) && created.length) {
      try {
        await supabaseFetch(env, "/coupons", {
          method: "POST",
          headers: { prefer: "return=minimal" },
          body: JSON.stringify(created)
        });
      } catch (error) {
        // Codes already exist in Stripe and work; surface the mirror failure but
        // don't pretend the codes weren't created.
        return json({ ok: true, warning: `Codes created in Stripe but DB mirror failed: ${error.message}`, codes: created.map(c => c.code) });
      }
    }

    return json({ ok: true, count: created.length, percent_off: percentOff, codes: created.map(c => c.code) });
  } catch (error) {
    return json({ error: error.message || "Could not generate coupons.", details: error.details || null }, error.status || 500);
  }
}
