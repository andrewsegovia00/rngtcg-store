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
   ============================================================================ */
export function hasResend(env) {
  return Boolean(env.RESEND_API_KEY && env.RESEND_FROM_EMAIL);
}

const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

const COLORS = { ink: "#1a1320", purple: "#6b3bd6", soft: "#a07cff", muted: "#6b6478", bg: "#f7f5fb", line: "#e3ddec" };

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

export function buildOrderEmailHtml(order, env) {
  const discord = env.DISCORD_INVITE_URL || "https://discord.gg/JaaQuMrcTa";
  const logo = env.RESEND_LOGO_URL
    ? `<img src="${escapeHtml(env.RESEND_LOGO_URL)}" alt="R&amp;G TCG" height="36" style="display:block;border:0;height:36px">`
    : `<span style="font:700 24px/1 Georgia,serif;color:#fff">R&amp;G TCG</span>`;
  const hero = env.RESEND_HERO_GIF_URL
    ? `<tr><td style="padding:0 32px"><img src="${escapeHtml(env.RESEND_HERO_GIF_URL)}" alt="" width="536" style="display:block;border:0;width:100%;max-width:536px;border-radius:12px"></td></tr>`
    : "";
  const shipMethod = order.shipping_method === "express" ? "Express (1–2 business days)" : "Standard (4–6 business days)";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Order confirmed</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border:2px solid ${COLORS.ink};border-radius:16px;overflow:hidden">

        <tr><td style="background:${COLORS.ink};padding:20px 32px">${logo}</td></tr>

        <tr><td style="padding:32px 32px 8px">
          <p style="margin:0 0 8px;font:700 12px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${COLORS.purple}">Order confirmed · Rip incoming</p>
          <h1 style="margin:0;font:700 30px/1.1 Georgia,serif;color:${COLORS.ink}">Thanks — we're on it.</h1>
          <p style="margin:12px 0 0;font:400 15px/1.6 Arial,sans-serif;color:${COLORS.muted}">Order <strong style="color:${COLORS.ink}">${escapeHtml(order.order_number)}</strong> is paid and queued to ship. We hand-check every order before it leaves.</p>
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
            <p style="margin:0 0 4px;font:700 12px/1 'Courier New',monospace;letter-spacing:1.5px;text-transform:uppercase;color:${COLORS.soft}">Drops drop in Discord first</p>
            <p style="margin:0 0 14px;font:400 14px/1.5 Arial,sans-serif;color:#cfc6e6">Join the crew to get pinged when new sealed product lands and swap pulls with rippers like you.</p>
            <a href="${escapeHtml(discord)}" style="display:inline-block;background:${COLORS.purple};color:#fff;text-decoration:none;font:700 14px/1 Arial,sans-serif;padding:12px 20px;border-radius:999px">Join the Discord →</a>
          </td></tr></table>
        </td></tr>

        <tr><td style="padding:20px 32px 32px">
          <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:${COLORS.muted}">You're getting this because you placed an order at R&amp;G TCG. We'll email tracking once it ships.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
}

export function buildWelcomeEmailHtml(code, percentOff, env) {
  const discord = env.DISCORD_INVITE_URL || "https://discord.gg/JaaQuMrcTa";
  const shop = (env.SITE_URL || "").replace(/\/$/, "") + "/index.html";
  const logo = env.RESEND_LOGO_URL
    ? `<img src="${escapeHtml(env.RESEND_LOGO_URL)}" alt="R&amp;G TCG" height="36" style="display:block;border:0;height:36px">`
    : `<span style="font:700 24px/1 Georgia,serif;color:#fff">R&amp;G TCG</span>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Welcome to R&G TCG</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg}">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.bg};padding:24px 12px"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border:2px solid ${COLORS.ink};border-radius:16px;overflow:hidden">
      <tr><td style="background:${COLORS.ink};padding:20px 32px">${logo}</td></tr>
      <tr><td style="padding:32px 32px 8px">
        <p style="margin:0 0 8px;font:700 12px/1 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:${COLORS.purple}">Welcome to the crew</p>
        <h1 style="margin:0;font:700 30px/1.1 Georgia,serif;color:${COLORS.ink}">Here's ${escapeHtml(percentOff)}% off your first order.</h1>
        <p style="margin:12px 0 0;font:400 15px/1.6 Arial,sans-serif;color:${COLORS.muted}">Use this single-use code at checkout. Drops drop in Discord first — see you there.</p>
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
        <p style="margin:0;font:400 12px/1.5 Arial,sans-serif;color:${COLORS.muted}">One-time use. You're getting this because you signed up at R&amp;G TCG.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export async function sendWelcomeEmail(env, to, code, percentOff) {
  if (!hasResend(env) || !to) return { skipped: true };
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.RESEND_FROM_EMAIL,
      to: [to],
      subject: `Your ${percentOff}% off code — R&G TCG`,
      html: buildWelcomeEmailHtml(code, percentOff, env)
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
      html: buildOrderEmailHtml(order, env)
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
