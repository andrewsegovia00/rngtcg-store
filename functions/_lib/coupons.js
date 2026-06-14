/* ============================================================================
   Create ONE single-use discount code (Stripe coupon + promotion code) and
   mirror it into the Supabase `coupons` table. Shared by the admin batch
   generator and the newsletter welcome flow. Stripe enforces single-use via
   max_redemptions=1.
   ============================================================================ */
import { stripeRequest } from "./stripe.js";
import { hasSupabase, supabaseFetch } from "./supabase.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function randomCode(prefix = "RG") {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `${prefix}-${Array.from(bytes, b => ALPHABET[b % ALPHABET.length]).join("")}`;
}

export async function createSingleUseCoupon(env, { percentOff = 10, expiresDays = null, note = null, prefix = "RG" } = {}) {
  const coupon = await stripeRequest(env, "coupons", {
    percent_off: percentOff,
    duration: "once",
    name: `${percentOff}% off`,
    metadata: { source: note || "rg" }
  });

  const expiresAt = expiresDays ? Math.floor(Date.now() / 1000) + expiresDays * 86400 : null;
  const code = randomCode(prefix);
  const promo = await stripeRequest(env, "promotion_codes", {
    coupon: coupon.id,
    code,
    max_redemptions: 1,
    ...(expiresAt ? { expires_at: expiresAt } : {})
  });

  const row = {
    code,
    stripe_coupon_id: coupon.id,
    stripe_promotion_code_id: promo.id,
    percent_off: percentOff,
    max_redemptions: 1,
    expires_at: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
    note
  };

  if (hasSupabase(env)) {
    try {
      await supabaseFetch(env, "/coupons", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(row) });
    } catch (e) { console.warn("coupon DB mirror failed", e.message); }
  }
  return row;
}
