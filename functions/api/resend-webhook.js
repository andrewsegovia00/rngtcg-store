/* ============================================================================
   Resend webhook → email analytics.
   POST /api/resend-webhook

   Resend signs webhooks with Svix. Set RESEND_WEBHOOK_SECRET (the "whsec_..."
   value from the Resend dashboard) to enable verification + ingestion. Events
   (sent / delivered / opened / bounced / complained) are stored in email_events
   and surfaced in the admin marketing panel.
   ============================================================================ */
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

function base64ToBytes(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Svix signature verification: base64( HMAC-SHA256( `${id}.${ts}.${body}`, key ) )
// compared against the space-separated "v1,<sig>" entries in svix-signature.
async function verifySvix(secret, id, timestamp, signatureHeader, body) {
  if (!secret || !id || !timestamp || !signatureHeader) return false;

  // Reject events older than 5 minutes (replay protection).
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) return false;

  const rawKey = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes;
  try { keyBytes = base64ToBytes(rawKey); } catch (_) { return false; }

  const cryptoKey = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signed = `${id}.${timestamp}.${body}`;
  const sigBuf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(signed));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const provided = signatureHeader.split(" ").map(part => part.split(",")[1]).filter(Boolean);
  return provided.some(sig => sig === expected);
}

export async function onRequestPost({ request, env }) {
  if (!env.RESEND_WEBHOOK_SECRET) return json({ error: "Missing RESEND_WEBHOOK_SECRET." }, 501);

  const rawBody = await request.text();
  const ok = await verifySvix(
    env.RESEND_WEBHOOK_SECRET,
    request.headers.get("svix-id"),
    request.headers.get("svix-timestamp"),
    request.headers.get("svix-signature"),
    rawBody
  );
  if (!ok) return json({ error: "Invalid webhook signature." }, 400);

  let event;
  try { event = JSON.parse(rawBody); } catch (_) { return json({ error: "Invalid JSON." }, 400); }

  const data = event?.data || {};
  const to = Array.isArray(data.to) ? data.to[0] : data.to;
  // Resend event types look like "email.delivered" — store the short form.
  const type = String(event?.type || "unknown").replace(/^email\./, "");

  try {
    if (hasSupabase(env)) {
      await supabaseFetch(env, "/email_events", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          resend_email_id: data.email_id || null,
          type,
          recipient: to || null,
          subject: data.subject || null,
          raw: event
        })
      });
    }
  } catch (error) {
    console.error("Failed to store email event", error.message, error.details || "");
    // Still 200 so Resend doesn't retry forever on a transient DB hiccup.
  }

  return json({ received: true });
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: "POST /api/resend-webhook" });
}
