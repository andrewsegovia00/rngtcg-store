/* ============================================================================
   Admin · Editable email template (Phase 8).
   GET  /api/admin-email-settings           → { settings, defaults, preview }
   POST /api/admin-email-settings           → save, returns { settings, preview }
        body { settings:{...}, preview_only?:bool }
        preview_only renders the submitted (unsaved) values for a live preview.

   _lib/email.js reads email_settings and falls back to env asset URLs, then to
   EMAIL_DEFAULTS, for any blank field. This editor only writes the deltas.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";
import {
  EMAIL_DEFAULTS, getEmailSettings, resolveEmailConfig,
  buildOrderEmailHtml, buildWelcomeEmailHtml
} from "../_lib/email.js";

const FIELDS = Object.keys(EMAIL_DEFAULTS);

// A representative order so the admin sees a realistic confirmation preview.
const SAMPLE_ORDER = {
  order_number: "RG-1042",
  subtotal_cents: 8400,
  shipping_cents: 600,
  total_before_tax_cents: 9000,
  shipping_method: "standard",
  ship_name: "Sample Buyer",
  ship_line1: "1151 S Forest Ave",
  ship_line2: "Apt 2",
  ship_city: "Tempe",
  ship_state: "AZ",
  ship_postal_code: "85281",
  ship_country: "US",
  checkout_order_items: [
    { quantity: 1, title: "Phantasmal Flames Booster Box", format: "box", language: "EN", line_amount_cents: 7000 },
    { quantity: 2, title: "Phantasmal Flames Booster Pack", format: "pack", language: "EN", line_amount_cents: 1400 }
  ]
};
const SAMPLE_PERCENT = 10;
const SAMPLE_CODE = "RG-WELCOME10";

function renderPreview(env, row) {
  const cfg = resolveEmailConfig(env, row);
  return {
    order: buildOrderEmailHtml(SAMPLE_ORDER, cfg),
    welcome: buildWelcomeEmailHtml(SAMPLE_CODE, SAMPLE_PERCENT, cfg)
  };
}

// Keep only known fields; normalise blanks to null so fallbacks kick in.
function sanitize(input = {}) {
  const out = {};
  for (const key of FIELDS) {
    if (!(key in input)) continue;
    const v = input[key] == null ? "" : String(input[key]).trim();
    out[key] = v === "" ? null : v.slice(0, 2000);
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);
  try {
    const row = await getEmailSettings(env);
    const settings = {};
    for (const key of FIELDS) settings[key] = row && row[key] != null ? row[key] : "";
    return json({ ok: true, settings, defaults: EMAIL_DEFAULTS, preview: renderPreview(env, row) });
  } catch (error) {
    return json({ error: error.message || "Could not load email settings.", details: error.details || null }, error.status || 500);
  }
}

export async function onRequestPost({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }
  const incoming = sanitize(payload.settings || {});

  // Live preview without persisting.
  if (payload.preview_only) {
    return json({ ok: true, preview: renderPreview(env, incoming) });
  }

  try {
    const saved = await supabaseFetch(env, "/email_settings?id=eq.1", {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ ...incoming, updated_at: new Date().toISOString() })
    });
    const row = (Array.isArray(saved) && saved[0]) || {};
    const settings = {};
    for (const key of FIELDS) settings[key] = row && row[key] != null ? row[key] : "";
    return json({ ok: true, settings, defaults: EMAIL_DEFAULTS, preview: renderPreview(env, row) });
  } catch (error) {
    return json({ error: error.message || "Could not save email settings.", details: error.details || null }, error.status || 500);
  }
}
