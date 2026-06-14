import { productById, unitPrice, toCents, categoryShort, languageShort } from "../_lib/catalog.js";
import { hasSupabase, supabaseRpc, supabaseFetch, maybeReleaseReservation } from "../_lib/supabase.js";
import { quoteShipping } from "../_lib/shipping.js";

function cleanAddress(a = {}) {
  const s = v => (typeof v === "string" ? v.trim().slice(0, 120) : "");
  return {
    name: s(a.name), line1: s(a.line1), line2: s(a.line2), city: s(a.city),
    state: s(a.state).toUpperCase().slice(0, 2),
    postal_code: s(a.postal_code || a.zip), country: (s(a.country) || "US").toUpperCase().slice(0, 2),
    phone: s(a.phone)
  };
}

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

  const tiktok = typeof payload.tiktok_username === "string" ? payload.tiktok_username.trim().replace(/^@+/, "").slice(0, 60) : "";

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

  // We collect the shipping address ourselves and quote Shippo from it (Stripe
  // hosted Checkout can't be prefilled with an address). Require a usable one.
  const address = cleanAddress(payload.address);
  if (!address.line1 || !address.city || !address.state || !address.postal_code) {
    await maybeReleaseReservation(env, reservation?.order_id);
    return json({ error: "A full US shipping address is required." }, 400);
  }

  // Re-quote server-side — never trust the client's shipping amount.
  let shippingCents = 0, shippingLabel = "Shipping";
  try {
    const quote = await quoteShipping(env, { cart: payload.cart, address, test: Boolean(payload.test) });
    const chosen = quote.options.find(o => o.id === payload.shipping_id)
      || quote.options.slice().sort((a, b) => a.amount_cents - b.amount_cents)[0];
    if (chosen) { shippingCents = chosen.amount_cents; shippingLabel = chosen.label; }
  } catch (e) { console.warn("Shipping quote at checkout failed:", e.message); }

  const orderId = reservation?.order_id;
  const orderNumber = reservation?.order_number;
  const totalCents = subtotal + shippingCents;

  // Store address, tag, and the authoritative shipping/total on the order.
  if (supabaseEnabled && orderId) {
    const orderTag = tiktok ? "open_live" : "sealed";
    try {
      await supabaseFetch(env, `/checkout_orders?id=eq.${encodeURIComponent(orderId)}`, {
        method: "PATCH",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify({
          tiktok_username: tiktok || null,
          order_tag: orderTag,
          ready_to_ship: orderTag === "sealed",
          shipping_cents: shippingCents,
          total_before_tax_cents: totalCents,
          ship_name: address.name || null, ship_phone: address.phone || null,
          ship_line1: address.line1 || null, ship_line2: address.line2 || null,
          ship_city: address.city || null, ship_state: address.state || null,
          ship_postal_code: address.postal_code || null, ship_country: address.country || "US"
        })
      });
    } catch (e) { console.warn("Could not store address/shipping on order", e.message); }
  }

  const origin = baseUrl(request, env);
  const params = new URLSearchParams();

  append(params, "mode", "payment");
  append(params, "success_url", `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  append(params, "cancel_url", `${origin}/checkout.html?checkout=cancelled${orderId ? `&order_id=${encodeURIComponent(orderId)}` : ""}`);
  append(params, "allow_promotion_codes", "true");
  append(params, "billing_address_collection", "auto");
  // We already collected shipping on our page — Stripe just takes payment.
  append(params, "metadata[source]", "rg-tcg-mvp");
  append(params, "metadata[item_count]", stripeLines.reduce((sum, line) => sum + line.quantity, 0));
  append(params, "metadata[subtotal_cents]", subtotal);
  if (orderId) append(params, "metadata[order_id]", orderId);
  if (orderNumber) append(params, "metadata[order_number]", orderNumber);
  if (tiktok) append(params, "metadata[tiktok_username]", tiktok);

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

  // Shipping as its own line item (a fixed amount we computed from the address).
  if (shippingCents > 0) {
    const i = stripeLines.length;
    append(params, `line_items[${i}][quantity]`, 1);
    append(params, `line_items[${i}][price_data][currency]`, "usd");
    append(params, `line_items[${i}][price_data][unit_amount]`, shippingCents);
    append(params, `line_items[${i}][price_data][product_data][name]`, `Shipping — ${shippingLabel}`);
  }

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
