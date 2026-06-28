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

/**
 * Admin guard. Accepts EITHER:
 *   1. A Supabase access token (JWT) whose verified user email is on the
 *      ADMIN_EMAILS allowlist — the normal login path.
 *   2. The static ADMIN_TOKEN as a break-glass fallback (if configured).
 * Async because verifying a Supabase session is a network call.
 */
export async function requireAdmin(request, env) {
  const auth = request.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return { ok: false, response: json({ error: "Unauthorized admin request." }, 401) };

  // 1) Break-glass: static ADMIN_TOKEN (kept so a Supabase outage can't lock you out).
  if (env.ADMIN_TOKEN && String(env.ADMIN_TOKEN).length >= 12 && timingSafeEqual(token, env.ADMIN_TOKEN)) {
    return { ok: true, via: "token" };
  }

  // 2) Supabase session: verify the JWT, then enforce the email allowlist.
  if (env.SUPABASE_URL && (env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY)) {
    const user = await verifySupabaseUser(env, token);
    if (user) {
      if (isAllowedAdmin(env, user)) return { ok: true, via: "supabase", user };
      return { ok: false, response: json({ error: "This account is not authorized for admin access." }, 403) };
    }
  }

  return { ok: false, response: json({ error: "Unauthorized admin request." }, 401) };
}

// Validate a Supabase access token by asking the Auth API who it belongs to.
async function verifySupabaseUser(env, accessToken) {
  try {
    const base = String(env.SUPABASE_URL).replace(/\/$/, "");
    const apikey = env.SUPABASE_ANON_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey, authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    return user && user.id ? user : null;
  } catch (_) {
    return null;
  }
}

function isAllowedAdmin(env, user) {
  const allow = String(env.ADMIN_EMAILS || "")
    .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!allow.length) return false; // fail closed: no allowlist => nobody gets in via Supabase
  const email = String(user.email || "").toLowerCase();
  return Boolean(email) && allow.includes(email);
}

// Constant-time string compare so the token check can't be timing-probed.
function timingSafeEqual(a, b) {
  const x = String(a), y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export function parseInteger(value, label, { min = 0, max = 100000000 } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be an integer between ${min} and ${max}.`);
  return n;
}
