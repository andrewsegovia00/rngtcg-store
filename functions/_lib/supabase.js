/* ============================================================================
   Supabase REST helpers for Cloudflare Pages Functions.
   No npm dependency: this uses Supabase PostgREST + RPC over fetch.
   ============================================================================ */
export function hasSupabase(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}

function base(env) {
  return String(env.SUPABASE_URL || "").replace(/\/$/, "");
}

export async function supabaseFetch(env, path, options = {}) {
  if (!hasSupabase(env)) throw new Error("Supabase is not configured.");
  const url = `${base(env)}/rest/v1/${String(path).replace(/^\//, "")}`;
  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...(options.headers || {})
  };

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }

  if (!response.ok) {
    const message = data?.message || data?.hint || data?.error || `Supabase request failed: ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function supabaseRpc(env, fnName, body = {}) {
  return supabaseFetch(env, `/rpc/${fnName}`, {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify(body)
  });
}

export async function maybeReleaseReservation(env, orderId) {
  if (!hasSupabase(env) || !orderId) return null;
  try {
    return await supabaseRpc(env, "release_order_reservation", { p_order_id: orderId });
  } catch (error) {
    console.warn("Failed to release reservation", orderId, error.message);
    return null;
  }
}
