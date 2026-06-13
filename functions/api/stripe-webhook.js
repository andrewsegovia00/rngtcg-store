import { hasSupabase, supabaseRpc, supabaseFetch } from "../_lib/supabase.js";
import { hasResend, sendOrderConfirmationEmail } from "../_lib/email.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

function bytesToHex(buffer) {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map(part => {
    const [key, value] = part.split("=");
    return [key, value];
  }));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  // Reject events older than 5 minutes to prevent replay attacks.
  const toleranceSeconds = 300;
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signedPayload = `${timestamp}.${rawBody}`;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  return safeEqual(bytesToHex(signature), expected);
}

// Pull the shipping address Stripe collected on its hosted checkout page.
// Field names vary by API version, so check shipping_details, shipping, then
// fall back to the billing/customer address.
function extractShipping(session) {
  const details = session.shipping_details || session.shipping || session.collected_information?.shipping_details || {};
  const addr = details.address || session.customer_details?.address || {};
  return {
    name: details.name || session.customer_details?.name || null,
    phone: session.customer_details?.phone || null,
    line1: addr.line1 || null,
    line2: addr.line2 || null,
    city: addr.city || null,
    state: addr.state || null,
    postal_code: addr.postal_code || null,
    country: addr.country || null
  };
}

async function markPaid(env, session) {
  const orderId = session?.metadata?.order_id;
  if (!hasSupabase(env) || !orderId) return null;
  return supabaseRpc(env, "mark_order_paid", {
    p_order_id: orderId,
    p_stripe_session_id: session.id || null,
    p_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
    p_customer_id: typeof session.customer === "string" ? session.customer : null,
    p_customer_email: session.customer_details?.email || session.customer_email || null,
    p_payload: session,
    p_shipping: extractShipping(session)
  });
}

async function releaseReservation(env, session) {
  const orderId = session?.metadata?.order_id;
  if (!hasSupabase(env) || !orderId) return null;
  return supabaseRpc(env, "release_order_reservation", { p_order_id: orderId });
}

// Fetch the freshly-paid order (with line items + shipping) and send the
// branded confirmation email. Best-effort: never throws into the webhook.
async function sendConfirmation(env, orderId) {
  try {
    if (!hasResend(env) || !hasSupabase(env) || !orderId) return;
    const rows = await supabaseFetch(
      env,
      `/checkout_orders?id=eq.${encodeURIComponent(orderId)}&select=order_number,customer_email,stripe_customer_email,shipping_method,subtotal_cents,shipping_cents,total_before_tax_cents,ship_name,ship_line1,ship_line2,ship_city,ship_state,ship_postal_code,ship_country,checkout_order_items(title,format,language,quantity,line_amount_cents)`
    );
    const order = Array.isArray(rows) ? rows[0] : null;
    if (!order) return;
    const result = await sendOrderConfirmationEmail(env, order);
    console.log("Order confirmation email", order.order_number, result);
  } catch (error) {
    console.error("Order confirmation email failed", error.message, error.details || "");
  }
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  const rawBody = await request.text();
  const sig = request.headers.get("Stripe-Signature");

  if (!env.STRIPE_WEBHOOK_SECRET) {
    return json({ error: "Missing STRIPE_WEBHOOK_SECRET." }, 501);
  }

  const verified = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!verified) return json({ error: "Invalid Stripe webhook signature." }, 400);

  const event = JSON.parse(rawBody);
  const session = event.data?.object;

  try {
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const result = await markPaid(env, session);
      console.log("Order paid", result || session?.id);
      // Send the confirmation only on the first paid transition (Stripe retries
      // webhooks). Run it after responding so it never delays/blocks the ack.
      const orderId = result?.order_id || session?.metadata?.order_id;
      if (orderId && !result?.already_paid) {
        const task = sendConfirmation(env, orderId);
        if (typeof waitUntil === "function") waitUntil(task); else await task;

        // Record the buyer on the transactional/order-confirmation list.
        const email = session.customer_details?.email || session.customer_email;
        if (email && hasSupabase(env)) {
          const rec = supabaseRpc(env, "record_order_recipient", { p_email: email })
            .catch(e => console.warn("record_order_recipient failed", e.message));
          if (typeof waitUntil === "function") waitUntil(rec); else await rec;
        }
      }
    }

    if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      const result = await releaseReservation(env, session);
      console.log("Order reservation released", result || session?.id);
    }
  } catch (error) {
    console.error("Webhook database update failed", error.message, error.details || "");
    return json({ error: error.message || "Webhook database update failed." }, error.status || 500);
  }

  return json({ received: true, supabase_enabled: hasSupabase(env) });
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: "POST /api/stripe-webhook" });
}
