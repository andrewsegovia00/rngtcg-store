import { hasSupabase, supabaseRpc } from "../_lib/supabase.js";

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

async function markPaid(env, session) {
  const orderId = session?.metadata?.order_id;
  if (!hasSupabase(env) || !orderId) return null;
  return supabaseRpc(env, "mark_order_paid", {
    p_order_id: orderId,
    p_stripe_session_id: session.id || null,
    p_payment_intent: typeof session.payment_intent === "string" ? session.payment_intent : null,
    p_customer_id: typeof session.customer === "string" ? session.customer : null,
    p_customer_email: session.customer_details?.email || session.customer_email || null,
    p_payload: session
  });
}

async function releaseReservation(env, session) {
  const orderId = session?.metadata?.order_id;
  if (!hasSupabase(env) || !orderId) return null;
  return supabaseRpc(env, "release_order_reservation", { p_order_id: orderId });
}

export async function onRequestPost({ request, env }) {
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
