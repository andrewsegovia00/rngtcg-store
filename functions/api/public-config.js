/* ============================================================================
   Public, non-secret front-end config. GET /api/public-config
   Returns the browser-safe Google Maps key (referrer-restricted in Google Cloud
   Console — it's meant to be public). Empty string when unset → checkout falls
   back to plain manual address entry.
   Also returns the Turnstile SITE key (public by design); empty when unset →
   the frontend renders no widget and the server skips verification.
   ============================================================================ */
export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    maps_key: env.GOOGLE_MAPS_API_KEY || "",
    turnstile_key: env.TURNSTILE_SITE_KEY || ""
  }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "max-age=300" }
  });
}
