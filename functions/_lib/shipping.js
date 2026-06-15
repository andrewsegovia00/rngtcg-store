/* ============================================================================
   Shipping rates: Shippo live USPS rates with a flat weight-tier fallback.

   - hasShippo(env): SHIPPO_API_KEY present.
   - cartWeightOz(env, cart): sum per-variant weight_oz from Supabase
     (fallback estimate: box 16oz / pack 2oz) for a cart of {product_id, format, quantity}.
   - flatTier(weightOz): flat USD-cents fallback by weight.
   - shippoRates(env, {to, weightOz}): live rates from Shippo (cheapest few).
   Free US shipping over $200 is applied by the caller, not here.
   ============================================================================ */
import { hasSupabase, supabaseFetch } from "./supabase.js";

const DEFAULT_WEIGHT = { box: 16, pack: 2, default: 8 };

// Flat fallback tiers (ounces → cents). Tune to sit at/above real PirateShip cost.
const FLAT_TIERS = [
  [4, 500],     // ≤ 4 oz   → $5.00
  [8, 600],     // ≤ 8 oz   → $6.00
  [16, 800],    // ≤ 1 lb   → $8.00
  [32, 1000],   // ≤ 2 lb   → $10.00
  [80, 1400],   // ≤ 5 lb   → $14.00
  [160, 2000]   // ≤ 10 lb  → $20.00
];
const FLAT_OVER = 2500; // > 10 lb → $25.00

// Padding added to every charged shipping rate so we stay safe if the real
// label ends up costing a bit more than the quote.
const RATE_BUFFER_CENTS = 100; // $1.00

export function hasShippo(env) {
  return Boolean(env.SHIPPO_API_KEY);
}

export function flatTier(weightOz) {
  const w = Math.max(Number(weightOz) || 0, 1);
  for (const [maxOz, cents] of FLAT_TIERS) if (w <= maxOz) return cents;
  return FLAT_OVER;
}

export async function cartWeightOz(env, cart) {
  const lines = (Array.isArray(cart) ? cart : []).map(l => ({
    sku: `${l.product_id || l.productId}:${l.format === "box" ? "box" : "pack"}`,
    format: l.format === "box" ? "box" : "pack",
    quantity: Math.max(parseInt(l.quantity, 10) || 0, 0)
  })).filter(l => l.quantity > 0);
  if (!lines.length) return 0;

  let weights = {};
  if (hasSupabase(env)) {
    try {
      const skus = lines.map(l => `"${l.sku}"`).join(",");
      const rows = await supabaseFetch(env, `/product_variants?sku=in.(${encodeURIComponent(skus)})&select=sku,format,weight_oz`);
      for (const r of (Array.isArray(rows) ? rows : [])) weights[r.sku] = r.weight_oz;
    } catch (_) { /* fall back to estimates */ }
  }
  return lines.reduce((sum, l) => {
    const per = Number(weights[l.sku]) || DEFAULT_WEIGHT[l.format] || DEFAULT_WEIGHT.default;
    return sum + per * l.quantity;
  }, 0);
}

const FREE_OVER_CENTS = 20000; // free US shipping over $200

// One place both /api/shipping-quote and create-checkout-session use, so the
// price we DISPLAY equals the price we CHARGE (server re-quotes; client amounts
// are never trusted). Returns { source, weight_oz, subtotal_cents, options[] }.
export async function quoteShipping(env, { cart, address }) {
  const lines = (Array.isArray(cart) ? cart : []).map(l => ({
    sku: `${l.product_id || l.productId}:${l.format === "box" ? "box" : "pack"}`,
    format: l.format === "box" ? "box" : "pack",
    quantity: Math.max(parseInt(l.quantity, 10) || 0, 0)
  })).filter(l => l.quantity > 0);

  let priceBy = {}, weightBy = {};
  if (hasSupabase(env) && lines.length) {
    try {
      const skus = lines.map(l => `"${l.sku}"`).join(",");
      const rows = await supabaseFetch(env, `/product_variants?sku=in.(${encodeURIComponent(skus)})&select=sku,price_cents,weight_oz`);
      for (const r of (Array.isArray(rows) ? rows : [])) { priceBy[r.sku] = r.price_cents; weightBy[r.sku] = r.weight_oz; }
    } catch (_) { /* estimates below */ }
  }

  let subtotal = 0, weightOz = 0;
  for (const l of lines) {
    subtotal += (Number(priceBy[l.sku]) || 0) * l.quantity;
    weightOz += (Number(weightBy[l.sku]) || DEFAULT_WEIGHT[l.format] || DEFAULT_WEIGHT.default) * l.quantity;
  }

  const options = [];

  if (subtotal >= FREE_OVER_CENTS) {
    options.push({ id: "free", label: "Free shipping (orders $200+)", amount_cents: 0 });
    return { source: "free", weight_oz: weightOz, subtotal_cents: subtotal, options };
  }

  let source = "flat";
  if (hasShippo(env) && address && (address.postal_code || address.zip)) {
    try {
      const rates = await shippoRates(env, { to: address, weightOz });
      if (rates && rates.length) {
        // One customer-facing "Ground shipping" option from the cheapest live
        // rate, padded by $1 so we never lose money if the real label costs a
        // little more. We don't surface the carrier (USPS/UPS) to the customer.
        const cheapest = rates[0];
        options.push({
          id: "ground",
          label: "Ground shipping",
          amount_cents: cheapest.amount_cents + RATE_BUFFER_CENTS,
          days: cheapest.days || null
        });
        source = "shippo";
      }
    } catch (e) { console.warn("Shippo quote failed, using flat tier:", e.message); }
  }
  if (source !== "shippo") {
    options.push({ id: "flat", label: "Ground shipping", amount_cents: flatTier(weightOz) + RATE_BUFFER_CENTS });
  }
  return { source, weight_oz: weightOz, subtotal_cents: subtotal, options };
}

function shipFrom(env) {
  return {
    name: env.SHIP_FROM_NAME || "R&G TCG",
    street1: env.SHIP_FROM_STREET1 || "",
    city: env.SHIP_FROM_CITY || "",
    state: env.SHIP_FROM_STATE || "",
    zip: env.SHIP_FROM_ZIP || "",
    country: env.SHIP_FROM_COUNTRY || "US",
    phone: env.SHIP_FROM_PHONE || "",
    email: env.RESEND_FROM_EMAIL || "orders@example.com"
  };
}

// Returns up to 3 cheapest USPS rates as {id,label,amount_cents,carrier,days}.
export async function shippoRates(env, { to, weightOz }) {
  if (!hasShippo(env)) return null;
  const body = {
    address_from: shipFrom(env),
    address_to: {
      name: to.name || "Customer",
      street1: to.line1 || "",
      street2: to.line2 || "",
      city: to.city || "",
      state: to.state || "",
      zip: to.postal_code || to.zip || "",
      country: to.country || "US",
      phone: to.phone || ""
    },
    parcels: [{
      length: "9", width: "7", height: "4", distance_unit: "in",
      weight: String(Math.max(Number(weightOz) || 1, 1)), mass_unit: "oz"
    }],
    async: false
  };

  const res = await fetch("https://api.goshippo.com/shipments/", {
    method: "POST",
    headers: { authorization: `ShippoToken ${env.SHIPPO_API_KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.detail || `Shippo error: ${res.status}`);
    err.status = res.status; err.details = data;
    throw err;
  }
  const rates = (data.rates || [])
    .map(r => ({
      id: `shippo:${r.servicelevel?.token || r.object_id}`,
      label: `${r.provider} ${r.servicelevel?.name || ""}`.trim(),
      amount_cents: Math.round(Number(r.amount) * 100),
      carrier: r.provider,
      days: r.estimated_days || null
    }))
    .filter(r => Number.isFinite(r.amount_cents) && r.amount_cents > 0)
    .sort((a, b) => a.amount_cents - b.amount_cents);

  // De-dupe by label, keep cheapest 3.
  const seen = new Set();
  const picks = [];
  for (const r of rates) { if (seen.has(r.label)) continue; seen.add(r.label); picks.push(r); if (picks.length === 3) break; }
  return picks;
}
