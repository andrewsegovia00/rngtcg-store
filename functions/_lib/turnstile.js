/* ============================================================================
   Cloudflare Turnstile siteverify (server-side bot check).
   Pages-native — we verify inside the existing Functions, no separate Worker.

   Degrades gracefully (same pattern as hasStripe / hasResend / hasSupabase):
   if TURNSTILE_SECRET_KEY is unset, verification is SKIPPED (success) so the
   site keeps working before the widget keys are configured. The moment the
   secret is set in Cloudflare env, every protected endpoint starts enforcing.

   Flow is always: browser widget -> our Function -> Cloudflare siteverify.
   Never call siteverify from the browser; never expose the secret key.
   ============================================================================ */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export function hasTurnstile(env) {
  return Boolean(env.TURNSTILE_SECRET_KEY);
}

/**
 * Verify a Turnstile token. Returns { success, skipped, codes? }.
 * - No secret configured -> { success: true, skipped: true } (dormant).
 * - Missing token        -> { success: false } (don't even call Cloudflare).
 * - Network/parse error  -> { success: false } (fail closed when enforcing).
 */
export async function verifyTurnstile(env, token, remoteip) {
  if (!hasTurnstile(env)) return { success: true, skipped: true };
  if (!token || typeof token !== "string") return { success: false };

  const body = new URLSearchParams();
  body.append("secret", env.TURNSTILE_SECRET_KEY);
  body.append("response", token);
  if (remoteip) body.append("remoteip", remoteip);

  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    const data = await res.json().catch(() => ({}));
    return { success: Boolean(data.success), codes: data["error-codes"] };
  } catch (e) {
    console.warn("turnstile siteverify failed", e?.message);
    return { success: false };
  }
}

// Pull the client IP from the Cloudflare request (best-effort; optional arg to siteverify).
export function clientIp(request) {
  return request.headers.get("cf-connecting-ip") || "";
}
