// Shared JSON + safe-error helpers for customer-facing Pages Functions.

export const json = (body, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

/**
 * Log the real error where only we can see it (Cloudflare/Wrangler logs) and
 * return a user-safe payload — so customers never see internal details (missing
 * keys, Stripe/Supabase/Postgres messages, stack traces).
 *
 * - Intentional/validation errors (status < 500) keep their message: in this
 *   codebase those are written to be customer-friendly ("A product in your chest
 *   is no longer available", "Your chest is empty", etc).
 * - Unexpected errors (>= 500, missing config, upstream failures) return a
 *   generic message plus a short `ref` code. The same ref is printed in the logs,
 *   so a customer can quote it and we can find the real cause — "encoded" so we
 *   know but they don't.
 * - Pass { generic: true } to force the generic message regardless of status
 *   (e.g. upstream provider errors whose message we don't trust to be safe).
 */
export function fail(error, { context = "request", fallback = "Something went wrong. Please try again.", status, generic = false } = {}) {
  const code = status || error?.status || 500;
  const ref = Math.random().toString(36).slice(2, 8).toUpperCase();
  console.error(`[${ref}] ${context} failed (${code}):`, error?.stack || error?.message || String(error));
  const safeMessage = !generic && code < 500 && typeof error?.message === "string" && error.message
    ? error.message
    : fallback;
  return json({ error: safeMessage, ref }, code);
}
