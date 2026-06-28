/* ============================================================================
   Resend transactional email helper (no npm dependency — uses fetch).

   Sends a branded "order confirmed" email from the Stripe webhook once an order
   flips to paid. Fully optional: if RESEND_API_KEY / RESEND_FROM_EMAIL are not
   set, hasResend() is false and the webhook simply skips email (same graceful
   pattern as Supabase/Stripe).

   Optional brand assets (set in env, leave unset to skip gracefully):
     RESEND_LOGO_URL      — small logo shown in the header
     RESEND_HERO_GIF_URL  — animated gif / hero image under the headline
     DISCORD_INVITE_URL   — community CTA link (defaults to a placeholder)

   These env vars remain supported as fallbacks, but the admin "Email template"
   editor (email_settings table) overrides them per-field. See resolveEmailConfig.
   ============================================================================ */
import { hasSupabase, supabaseFetch } from "./supabase.js";

export function hasResend(env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// Escape, then turn newlines into <br> — for admin-editable multi-line body copy.
function richText(value) {
  return escapeHtml(value).replace(/\r?\n/g, "<br>");
}

const COLORS = { ink: "#1a1320", purple: "#6b3bd6", soft: "#a07cff", muted: "#6b6478", bg: "#f7f5fb", line: "#e3ddec" };

/* --------------------------------------------------------------------------
   Editable email content (Phase 8).
   Defaults below are the original hard-coded copy. They are overridden, per
   field, by any non-blank value in the email_settings table (admin editor).
   Brand asset URLs additionally fall back to the original env vars.
   Body fields support {order_number} / {percent} placeholders.
   -------------------------------------------------------------------------- */
export const EMAIL_DEFAULTS = {
  logo_url: "",
  hero_gif_url: "",
  discord_url: "https://discord.gg/JaaQuMrcTa",
  order_eyebrow: "Order confirmed · Rip incoming",
  order_headline: "Thanks — we're on it.",
  order_body: "Order {order_number} is paid and queued to ship. We hand-check every order before it leaves.",
  cta_eyebrow: "Drops drop in Discord first",
  cta_body: "Join the crew to get pinged when new sealed product lands and swap pulls with rippers like you.",
  order_footer: "You're getting this because you placed an order at R&G TCG. We'll email tracking once it ships.",
  welcome_eyebrow: "Welcome to the crew",
  welcome_headline: "Here's {percent}% off your first order.",
  welcome_body: "Use this single-use code at checkout. Drops drop in Discord first — see you there.",
  welcome_footer: "One-time use. You're getting this because you signed up at R&G TCG."
};

// The keys whose default also falls back to an env var (legacy brand assets).
const ENV_FALLBACKS = {
  logo_url: "RESEND_LOGO_URL",
  hero_gif_url: "RESEND_HERO_GIF_URL",
  discord_url: "DISCORD_INVITE_URL"
};

// Fetch the single email_settings row; never throws (returns {} on any issue).
export async function getEmailSettings(env) {
  if (!hasSupabase(env)) return {};
  try {
    const rows = await supabaseFetch(env, "/email_settings?id=eq.1&select=*&limit=1");
    return (Array.isArray(rows) && rows[0]) || {};
  } catch (e) {
    console.warn("getEmailSettings failed", e.message);
    return {};
  }
}

// Merge defaults ← env ← stored settings (first non-blank wins, in reverse).
export function resolveEmailConfig(env, row = {}) {
  const cfg = {};
  for (const key of Object.keys(EMAIL_DEFAULTS)) {
    const stored = row && row[key] != null ? String(row[key]).trim() : "";
    const envVal = ENV_FALLBACKS[key] ? String(env[ENV_FALLBACKS[key]] || "").trim() : "";
    cfg[key] = stored || envVal || EMAIL_DEFAULTS[key];
  }
  // Match checkout's baseUrl(): tolerate a bare-domain SITE_URL so email links
  // (order status, etc.) always carry an explicit scheme.
  let siteUrl = String(env.SITE_URL || "").trim().replace(/\/$/, "");
  if (siteUrl && !/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;
  cfg.site_url = siteUrl;
  return cfg;
}

function shipBlock(order) {
  const lines = [
    order.ship_name,
    [order.ship_line1, order.ship_line2].filter(Boolean).join(", "),
    [order.ship_city, order.ship_state, order.ship_postal_code].filter(Boolean).join(" "),
    order.ship_country
  ].filter(Boolean).map(escapeHtml);
  if (!lines.length) return "";
  return `
    <tr><td style="padding:20px 32px 0">
      <p style="margin:0 0 6px;font:700 12px/1 'Courier New',monospace;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted}">Shipping to</p>
      <p style="margin:0;font:400 15px/1.5 Arial,sans-serif;color:${COLORS.ink}">${lines.join("<br>")}</p>
    </td></tr>`;
}

function itemRows(items) {
  return (items || []).map(line => {
    const meta = [line.format, line.language].filter(Boolean).map(s => escapeHtml(String(s))).join(" · ");
    return `
      <tr>
        <td style="padding:10px 0;border-top:1px solid ${COLORS.line};font:400 15px/1.4 Arial,sans-serif;color:${COLORS.ink}">
          <strong>${escapeHtml(line.quantity)}×</strong> ${escapeHtml(line.title)}
          <span style="display:block;font:400 12px/1.4 Arial,sans-serif;color:${COLORS.muted};text-transform:capitalize">${meta}</span>
        </td>
        <td style="padding:10px 0;border-top:1px solid ${COLORS.line};font:700 15px/1.4 Arial,sans-serif;color:${COLORS.ink};text-align:right;white-space:nowrap">${money(line.line_amount_cents)}</td>
      </tr>`;
  }).join("");
}

export function buildOrderEmailHtml(order, cfg) {
  const discord = cfg.discord_url;
  const logo = cfg.logo_url
    ? `<img src="${escapeHtml(cfg.logo_url)}" alt="R&amp;G TCG" height="36" style="display:block;border:0;height:36px">`
    : `<span style="font:700 24px/1 Georgia,serif;color:#fff">R&amp;G TCG</span>`;
  const hero = cfg.hero_gif_url
    ? `<tr><td style="padding:0 32px"><img src="${escapeHtml(cfg.hero_gif_url)}" alt="" width="536" style="display:block;border:0;width:100%;max-width:536px;border-radius:12px"></td></tr>`
    : "";
  const orderBody = richText(cfg.order_body.replace(/\{order_number\}/g, order.order_number || ""));
  const shipMethod = order.shipping_method === "express" ? "Express (1–2 business days)" : "Standard (4–6 business days)";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order confirmed</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border:2px solid ${COLORS.ink};border-radius:16px;overflow:hidden">

        <tr><td style="background:${COLORS.ink};padding:20px 32px">${logo}</td></tr>

        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 8px;font:700 12px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${COLORS.purple}">${escapeHtml(cfg.order_eyebrow)}</p>
          <h1 style="margin:0;font:700 30px/1.1 Georgia,serif;color:${COLORS.ink}">${escapeHtml(cfg.order_headline)}</h1>
          <p style="margin:12px 0 0;font:400 15px/1.6 Arial,sans-serif;color:${COLORS.muted}">${orderBody}</p>
        </td></tr>

        ${hero}

        <tr><td style="padding:24px 32px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td colspan="2" style="font:700 12px/1 'Courier New',monospace;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};padding-bottom:4px">Your loot</td></tr>
            ${itemRows(order.checkout_order_items)}
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${COLORS.ink};padding-top:8px">
            <tr><td style="padding-top:10px;font:400 14px/1.4 Arial,sans-serif;color:${COLORS.muted}">Subtotal</td><td style="padding-top:10px;font:400 14px/1.4 Arial,sans-serif;color:${COLORS.ink};text-align:right">${money(order.subtotal_cents)}</td></tr>
            <tr><td style="padding-top:6px;font:400 14px/1.4 Arial,sans-serif;color:${COLORS.muted}">Shipping — ${escapeHtml(shipMethod)}</td><td style="padding-top:6px;font:400 14px/1.4 Arial,sans-serif;color:${COLORS.ink};text-align:right">${money(order.shipping_cents)}</td></tr>
            <tr><td style="padding-top:10px;font:700 18px/1.2 Georgia,serif;color:${COLORS.ink}">Total</td><td style="padding-top:10px;font:700 18px/1.2 Georgia,serif;color:${COLORS.ink};text-align:right">${money(order.total_before_tax_cents)}</td></tr>
          </table>
        </td></tr>

        ${shipBlock(order)}

        <tr><td style="padding:28px 32px 8px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.ink};border-radius:12px"><tr><td style="padding:20px 24px">
            <p style="margin:0 0 4px;font:700 12px/1 'Courier New',monospace;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.soft}">${escapeHtml(cfg.cta_eyebrow)}</p>
            <p style="margin:0 0 14px;font:400 14px/1.5 Arial,sans-serif;color:#cfc6e6">${richText(cfg.cta_body)}</p>
            <a href="${escapeHtml(discord)}" style="display:inline-block;background:${COLORS.purple};color:#fff;text-decoration:none;font:700 14px/1 Arial,sans-serif;padding:12px 20px;border-radius:999px">Join the Discord →</a>
          </td></tr></table>
        </td></tr>

        <tr><td style="padding:20px 32px 32px">
          <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:${COLORS.muted}">${richText(cfg.order_footer)}</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildWelcomeEmailHtml(code, percentOff, cfg) {
  const discord = cfg.discord_url;
  const shop = (cfg.site_url || "") + "/index.html";
  const logo = cfg.logo_url
    ? `<img src="${escapeHtml(cfg.logo_url)}" alt="R&amp;G TCG" height="36" style="display:block;border:0;height:36px">`
    : `<span style="font:700 24px/1 Georgia,serif;color:#fff">R&amp;G TCG</span>`;
  const headline = richText(cfg.welcome_headline.replace(/\{percent\}/g, String(percentOff)));
  const body = richText(cfg.welcome_body.replace(/\{percent\}/g, String(percentOff)));
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to R&G TCG</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border:2px solid ${COLORS.ink};border-radius:16px;overflow:hidden">
      <tr><td style="background:${COLORS.ink};padding:20px 32px">${logo}</td></tr>
      <tr><td style="padding:32px 32px 8px">
        <p style="margin:0 0 8px;font:700 12px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${COLORS.purple}">${escapeHtml(cfg.welcome_eyebrow)}</p>
        <h1 style="margin:0;font:700 30px/1.1 Georgia,serif;color:${COLORS.ink}">${headline}</h1>
        <p style="margin:12px 0 0;font:400 15px/1.6 Arial,sans-serif;color:${COLORS.muted}">${body}</p>
      </td></tr>
      <tr><td style="padding:20px 32px 8px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};border:2px dashed ${COLORS.ink};border-radius:12px"><tr><td style="padding:18px;text-align:center">
          <div style="font:700 11px/1 'Courier New',monospace;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.muted};margin-bottom:6px">Your code</div>
          <div style="font:700 28px/1 Georgia,serif;color:${COLORS.ink};letter-spacing:1px">${escapeHtml(code)}</div>
        </td></tr></table>
      </td></tr>
      <tr><td style="padding:18px 32px 8px">
        <a href="${escapeHtml(shop)}" style="display:inline-block;background:${COLORS.purple};color:#fff;text-decoration:none;font:700 15px/1 Arial,sans-serif;padding:14px 24px;border-radius:999px;margin-right:8px">Shop sealed product</a>
        <a href="${escapeHtml(discord)}" style="display:inline-block;background:${COLORS.ink};color:#fff;text-decoration:none;font:700 15px/1 Arial,sans-serif;padding:14px 24px;border-radius:999px">Join the Discord</a>
      </td></tr>
      <tr><td style="padding:20px 32px 32px">
        <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:${COLORS.muted}">${richText(cfg.welcome_footer)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function sendWelcomeEmail(env, to, code, percentOff) {
  if (!hasResend(env) || !to) return { skipped: true };
  const cfg = resolveEmailConfig(env, await getEmailSettings(env));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [to],
      subject: `Your ${percentOff}% off code — R&G TCG`,
      html: buildWelcomeEmailHtml(code, percentOff, cfg)
    })
  });
  const text = await response.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) { const e = new Error(data?.message || `Resend send failed: ${response.status}`); e.status = response.status; throw e; }
  return { ok: true, id: data?.id || null };
}

export async function sendOrderConfirmationEmail(env, order) {
  if (!hasResend(env)) return { skipped: "resend-not-configured" };
  const to = order.customer_email || order.stripe_customer_email;
  if (!to) return { skipped: "no-recipient" };

  const cfg = resolveEmailConfig(env, await getEmailSettings(env));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [to],
      subject: `Order confirmed — ${order.order_number} · R&G TCG`,
      html: buildOrderEmailHtml(order, cfg)
    })
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || `Resend send failed: ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return { ok: true, id: data?.id || null };
}
