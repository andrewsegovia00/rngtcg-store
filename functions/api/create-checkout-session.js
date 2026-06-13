import { productById, unitPrice, toCents, categoryShort, languageShort } from "../_lib/catalog.js";
import { hasSupabase, supabaseRpc, maybeReleaseReservation } from "../_lib/supabase.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

function baseUrl(request, env) {
  const configured = env.SITE_URL && String(env.SITE_URL).replace(/\/$/, "");
  if (configured) return configured;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function append(params, key, value) {
  if (value !== undefined && value !== null) params.append(key, String(value));
}

function normalizeCart(cart) {
  if (!Array.isArray(cart)) throw new Error("Cart must be an array.");
  const merged = new Map();

  for (const line of cart) {
    const productId = String(line.productId || "");
    const format = line.format === "box" ? "box" : "pack";
    const quantity = Number.parseInt(line.quantity, 10);
    const product = productById(productId);

    if (!product) throw new Error(`Unknown product: ${productId}`);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      throw new Error(`Invalid quantity for ${product.name}.`);
    }
    if (product.stock <= 0) throw new Error(`${product.name} is sold out.`);
    if (quantity > product.stock) throw new Error(`Only ${product.stock} left for ${product.name}.`);

    const key = `${productId}:${format}`;
    const existing = merged.get(key) || { product, productId, format, quantity: 0 };
    existing.quantity += quantity;
    if (existing.quantity > product.stock) throw new Error(`Only ${product.stock} left for ${product.name}.`);
    merged.set(key, existing);
  }

  const lines = Array.from(merged.values());
  if (!lines.length) throw new Error("Your chest is empty.");
  if (lines.length > 50) throw new Error("Too many unique items in one checkout.");
  return lines;
}

function subtotalCents(lines) {
  return lines.reduce((sum, line) => sum + toCents(unitPrice(line.product, line.format)) * line.quantity, 0);
}

function addShippingOption(params, idx, name, amountCents, minDays, maxDays) {
  append(params, `shipping_options[${idx}][shipping_rate_data][type]`, "fixed_amount");
  append(params, `shipping_options[${idx}][shipping_rate_data][fixed_amount][amount]`, amountCents);
  append(params, `shipping_options[${idx}][shipping_rate_data][fixed_amount][currency]`, "usd");
  append(params, `shipping_options[${idx}][shipping_rate_data][display_name]`, name);
  append(params, `shipping_options[${idx}][shipping_rate_data][delivery_estimate][minimum][unit]`, "business_day");
  append(params, `shipping_options[${idx}][shipping_rate_data][delivery_estimate][minimum][value]`, minDays);
  append(params, `shipping_options[${idx}][shipping_rate_data][delivery_estimate][maximum][unit]`, "business_day");
  append(params, `shipping_options[${idx}][shipping_rate_data][delivery_estimate][maximum][value]`, maxDays);
}

async function createReservationIfConfigured(env, payload) {
  if (!hasSupabase(env)) return null;
  return supabaseRpc(env, "create_checkout_reservation", {
    p_customer_email: payload.email || null,
    p_shipping_method: payload.shipping === "express" ? "express" : "standard",
    // The reservation RPC reads snake_case columns (product_id) via jsonb_to_recordset,
    // but the client cart uses camelCase (productId). Remap before sending.
    p_cart: (Array.isArray(payload.cart) ? payload.cart : []).map(line => ({
      product_id: line.productId,
      format: line.format === "box" ? "box" : "pack",
      quantity: line.quantity
    })),
    p_hold_minutes: 30
  });
}

export async function onRequestPost(context) {
  const { request, env, waitUntil } = context;
  if (!env.STRIPE_SECRET_KEY) {
    return json({
      error: "Missing STRIPE_SECRET_KEY.",
      message: "Add your Stripe test secret key in Cloudflare Pages environment variables or .dev.vars."
    }, 501);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const supabaseEnabled = hasSupabase(env);

  // Newsletter opt-in (best-effort, non-blocking) from the checkout checkbox.
  const optInEmail = typeof payload.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email) ? payload.email : null;
  if (payload.newsletter && optInEmail && supabaseEnabled) {
    const task = supabaseRpc(env, "subscribe_newsletter", { p_email: optInEmail, p_source: "checkout" })
      .catch(e => console.warn("newsletter subscribe failed", e.message));
    if (typeof waitUntil === "function") waitUntil(task);
  }

  // When Supabase is the source of truth, the reservation RPC validates the cart
  // and returns authoritative prices/lines — so the price we DISPLAY and the price
  // we CHARGE both come from the database. Fall back to the in-code catalog only
  // when Supabase is not configured.
  let reservation = null;
  let stripeLines = [];
  let subtotal = 0;

  if (supabaseEnabled) {
    try {
      reservation = await createReservationIfConfigured(env, payload);
    } catch (error) {
      return json({
        error: error.message || "Could not reserve inventory.",
        details: error.details || null
      }, error.status || 400);
    }
    stripeLines = (reservation?.lines || []).map(l => ({
      name: `${l.title} — ${l.format === "box" ? "Booster Box" : "Booster Pack"}`,
      description: `${categoryShort(l.category)} · ${languageShort(l.language)} · ${l.set_code}`,
      unitAmountCents: l.unit_amount_cents,
      quantity: l.quantity,
      productId: l.product_id,
      format: l.format,
      language: l.language
    }));
    subtotal = reservation?.subtotal_cents ?? 0;
  } else {
    let lines;
    try {
      lines = normalizeCart(payload.cart);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
    stripeLines = lines.map(line => ({
      name: `${line.product.name} — ${line.format === "box" ? "Booster Box" : "Booster Pack"}`,
      description: `${categoryShort(line.product.category)} · ${languageShort(line.product.language)} · ${line.product.set}`,
      unitAmountCents: toCents(unitPrice(line.product, line.format)),
      quantity: line.quantity,
      productId: line.product.id,
      format: line.format,
      language: line.product.language
    }));
    subtotal = subtotalCents(lines);
  }

  if (!stripeLines.length) {
    return json({ error: "Your chest is empty." }, 400);
  }

  const origin = baseUrl(request, env);
  const params = new URLSearchParams();
  const freeStandard = subtotal >= 20000;
  const selectedShipping = payload.shipping === "express" ? "express" : "standard";
  const shippingOrder = selectedShipping === "express" ? ["express", "standard"] : ["standard", "express"];
  const orderId = reservation?.order_id;
  const orderNumber = reservation?.order_number;

  append(params, "mode", "payment");
  append(params, "success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  append(params, "cancel_url", `${origin}/checkout.html?checkout=cancelled${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ""}`);
  append(params, "allow_promotion_codes", "true");
  append(params, "billing_address_collection", "auto");
  append(params, "phone_number_collection[enabled]", "true");
  append(params, "shipping_address_collection[allowed_countries][0]", "US");
  append(params, "metadata[source]", "rg-tcg-mvp-block-7");
  append(params, "metadata[item_count]", stripeLines.reduce((sum, line) => sum + line.quantity, 0));
  append(params, "metadata[subtotal_cents]", subtotal);
  if (orderId) append(params, "metadata[order_id]", orderId);
  if (orderNumber) append(params, "metadata[order_number]", orderNumber);

  if (payload.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    append(params, "customer_email", payload.email);
  }

  stripeLines.forEach((line, i) => {
    append(params, `line_items[${i}][quantity]`, line.quantity);
    append(params, `line_items[${i}][price_data][currency]`, "usd");
    append(params, `line_items[${i}][price_data][unit_amount]`, line.unitAmountCents);
    append(params, `line_items[${i}][price_data][product_data][name]`, line.name);
    append(params, `line_items[${i}][price_data][product_data][description]`, line.description);
    append(params, `line_items[${i}][price_data][product_data][metadata][product_id]`, line.productId);
    append(params, `line_items[${i}][price_data][product_data][metadata][format]`, line.format);
    append(params, `line_items[${i}][price_data][product_data][metadata][language]`, line.language);
  });

  shippingOrder.forEach((choice, i) => {
    if (choice === "standard") addShippingOption(params, i, freeStandard ? "Standard shipping — free" : "Standard shipping", freeStandard ? 0 : 500, 4, 6);
    if (choice === "express") addShippingOption(params, i, "Express shipping", 1500, 1, 2);
  });

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.STRIPE_SECRET_KEY}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await stripeResponse.json();
  if (!stripeResponse.ok) {
    await maybeReleaseReservation(env, orderId);
    return json({ error: data.error?.message || "Stripe rejected the checkout session.", stripe_error: data.error || data }, stripeResponse.status);
  }

  if (orderId && hasSupabase(env)) {
    try {
      await supabaseRpc(env, "attach_stripe_session", {
        p_order_id: orderId,
        p_stripe_session_id: data.id
      });
    } catch (error) {
      await maybeReleaseReservation(env, orderId);
      return json({ error: error.message || "Could not attach Stripe session to order." }, error.status || 500);
    }
  }

  return json({
    id: data.id,
    url: data.url,
    order_id: orderId || null,
    order_number: orderNumber || null,
    reserved_until: reservation?.expires_at || null,
    supabase_enabled: hasSupabase(env)
  });
}

export async function onRequestGet() {
  return json({ ok: true, endpoint: "POST /api/create-checkout-session" });
}
