/* ============================================================================
   Public newsletter signup → welcome coupon.
   POST /api/newsletter-signup   Body: { email, source? }

   Optimal single-call flow: subscribe → mint ONE single-use 10%-off Stripe
   promo code → email it. One welcome code per email (tracked in
   newsletter_subscribers.welcome_coupon_code) so re-submitting can't farm codes.
   Degrades gracefully: no Stripe = no code; no Resend = code returned in the
   response so the modal can still show it.
   ============================================================================ */
import { json } from "../_lib/admin.js";
import { fail } from "../_lib/respond.js";
import { hasSupabase, supabaseFetch, supabaseRpc } from "../_lib/supabase.js";
import { hasStripe } from "../_lib/stripe.js";
import { createSingleUseCoupon } from "../_lib/coupons.js";
import { hasResend, sendWelcomeEmail } from "../_lib/email.js";

const WELCOME_PERCENT = 10;
const isEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export async function onRequestPost({ request, env }) {
  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const email = String(payload.email || "").trim().toLowerCase();
  if (!isEmail(email)) return json({ error: "Enter a valid email." }, 400);
  const source = String(payload.source || "popup").slice(0, 40);

  if (!hasSupabase(env)) return json({ ok: true, subscribed: false, coupon: false });

  try {
    // Upsert the subscriber (clears any prior unsubscribe).
    await supabaseRpc(env, "subscribe_newsletter", { p_email: email, p_source: source });

    // Already issued a welcome code? Don't mint another.
    const rows = await supabaseFetch(env, `/newsletter_subscribers?email=eq.${encodeURIComponent(email)}&select=welcome_coupon_code`);
    const existing = Array.isArray(rows) && rows[0] ? rows[0].welcome_coupon_code : null;
    if (existing) return json({ ok: true, subscribed: true, already: true });

    if (!hasStripe(env)) return json({ ok: true, subscribed: true, coupon: false });

    const coupon = await createSingleUseCoupon(env, { percentOff: WELCOME_PERCENT, expiresDays: 30, note: "newsletter-welcome" });
    await supabaseFetch(env, `/newsletter_subscribers?email=eq.${encodeURIComponent(email)}`, {
      method: "PATCH",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ welcome_coupon_code: coupon.code })
    });

    let emailed = false;
    if (hasResend(env)) {
      try { await sendWelcomeEmail(env, email, coupon.code, WELCOME_PERCENT); emailed = true; }
      catch (e) { console.warn("welcome email failed", e.message); }
    }

    // Never return the raw code to the browser — otherwise anyone could farm
    // codes with throwaway emails. It's delivered by email only (and visible to
    // the admin in the subscriber list). `emailed` tells the UI what to say.
    return json({ ok: true, subscribed: true, percent_off: WELCOME_PERCENT, emailed });
  } catch (error) {
    return fail(error, { context: "newsletter-signup", fallback: "Could not sign you up right now. Please try again." });
  }
}
