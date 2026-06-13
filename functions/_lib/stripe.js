/* ============================================================================
   Minimal Stripe REST helper (form-encoded, no npm dependency).
   Used for coupon / promotion-code creation. The checkout session endpoint
   builds its own params inline; this is the shared path for everything else.
   ============================================================================ */
export function hasStripe(env) {
  return Boolean(env.STRIPE_SECRET_KEY);
}

// Flatten nested objects into Stripe's bracketed form-encoding, e.g.
// { metadata: { source: "x" } } -> metadata[source]=x
function toForm(obj, params = new URLSearchParams(), prefix = "") {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) toForm(v, params, key);
    else params.append(key, String(v));
  }
  return params;
}

export async function stripeRequest(env, path, body = {}, method = "POST") {
  if (!hasStripe(env)) throw new Error("Missing STRIPE_SECRET_KEY.");
  const params = toForm(body);
  const response = await fetch(`https://api.stripe.com/v1/${String(path).replace(/^\//, "")}`, {
    method,
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: method === "GET" ? undefined : params
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message || `Stripe ${path} failed: ${response.status}`);
    error.status = response.status;
    error.details = data.error || data;
    throw error;
  }
  return data;
}
