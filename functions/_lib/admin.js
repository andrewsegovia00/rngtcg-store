/* ============================================================================
   Tiny token guard for the MVP admin dashboard.
   Keep ADMIN_TOKEN long/random and never commit a real production value.
   ============================================================================ */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 12) {
    return { ok: false, response: json({ error: "ADMIN_TOKEN is not configured or is too short." }, 501) };
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token || token !== env.ADMIN_TOKEN) {
    return { ok: false, response: json({ error: "Unauthorized admin request." }, 401) };
  }

  return { ok: true };
}

export function parseInteger(value, label, { min = 0, max = 100000000 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return n;
}
