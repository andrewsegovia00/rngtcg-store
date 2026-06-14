/* ============================================================================
   Admin · Export paid + unfulfilled orders as a PirateShip-ready CSV.

   GET /api/admin-export-orders   (Authorization: Bearer <ADMIN_TOKEN>)

   Returns text/csv with one row per order in PirateShip's bulk-import shape.
   PirateShip lets you map columns on import, so headers are plain-English.

   Weight is an ESTIMATE only (we don't store per-product weights yet) — verify
   it in PirateShip before buying labels. Tune the constants below as needed.
   ============================================================================ */
import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

// Placeholder shipping-weight estimates (ounces) until real product weights exist.
const WEIGHT_OZ = { box: 16, pack: 2, default: 8 };

function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  // Quote if it contains comma, quote, or newline; escape embedded quotes.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function estimateOrderWeightOz(items) {
  const total = (items || []).reduce((sum, line) => {
    const per = WEIGHT_OZ[line.format] ?? WEIGHT_OZ.default;
    return sum + per * Number(line.quantity || 0);
  }, 0);
  // Never ship at 0 oz; PirateShip rejects it.
  return Math.max(total, 1);
}

function describeItems(items) {
  return (items || [])
    .map(line => {
      const lang = line.language ? ` (${String(line.language).toUpperCase()})` : "";
      const fmt = line.format ? ` ${line.format}` : "";
      return `${line.quantity}x ${line.title}${fmt}${lang}`;
    })
    .join("; ");
}

function totalItemCount(items) {
  return (items || []).reduce((sum, line) => sum + Number(line.quantity || 0), 0);
}

// Weight variance: what actually ships depends on how the buyer wants it opened.
function applyShipMode(baseOz, mode) {
  if (mode === "hits_only") return 3;                         // just the chase cards in a mailer
  if (mode === "all_cards") return Math.max(Math.round(baseOz * 0.5), 4); // loose cards, no box/wrappers
  return baseOz;                                              // sealed = real weight
}

export async function onRequestGet({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  try {
    const orders = await supabaseFetch(
      env,
      "/checkout_orders?status=eq.paid&ready_to_ship=eq.true&fulfilled_at=is.null" +
        "&select=order_number,paid_at,created_at,customer_email,stripe_customer_email,tiktok_username,bundle_id,ship_mode," +
        "ship_name,ship_phone,ship_line1,ship_line2,ship_city,ship_state,ship_postal_code,ship_country," +
        "subtotal_cents,shipping_cents,checkout_order_items(title,format,language,quantity)" +
        "&order=paid_at.asc"
    );

    const list = Array.isArray(orders) ? orders : [];

    const headers = [
      "Order Number",
      "Order Date",
      "TikTok / Name",
      "Recipient Name",
      "Email",
      "Phone",
      "Address Line 1",
      "Address Line 2",
      "City",
      "State",
      "Zipcode",
      "Country",
      "Item Description",
      "Item Quantity",
      "Weight (oz)",
      "Item Total (USD)",
      "Shipping Paid (USD)"
    ];

    // Group bundled orders into one shipment (one label); solo orders stand alone.
    const groups = new Map();
    for (const o of list) {
      const key = o.bundle_id || `solo:${o.order_number}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }

    const rows = [...groups.values()].map(group => {
      const head = group[0];
      const items = group.flatMap(o => o.checkout_order_items || []);
      const date = head.paid_at || head.created_at;
      const weight = Math.max(
        group.reduce((sum, o) => sum + applyShipMode(estimateOrderWeightOz(o.checkout_order_items || []), o.ship_mode || "sealed"), 0),
        1
      );
      const itemTotal = group.reduce((s, o) => s + Number(o.subtotal_cents || 0), 0) / 100;
      const shipPaid = group.reduce((s, o) => s + Number(o.shipping_cents || 0), 0) / 100;
      return [
        group.map(o => o.order_number).join(" + "),
        date ? new Date(date).toISOString().slice(0, 10) : "",
        head.tiktok_username ? `@${head.tiktok_username}` : "",
        head.ship_name || "",
        head.customer_email || head.stripe_customer_email || "",
        head.ship_phone || "",
        head.ship_line1 || "",
        head.ship_line2 || "",
        head.ship_city || "",
        head.ship_state || "",
        head.ship_postal_code || "",
        head.ship_country || "US",
        describeItems(items),
        totalItemCount(items),
        weight,
        itemTotal.toFixed(2),
        shipPaid.toFixed(2)
      ].map(csvCell).join(",");
    });

    const csv = [headers.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";
    const filename = `rg-pirateship-${new Date().toISOString().slice(0, 10)}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
        "x-order-count": String(rows.length)
      }
    });
  } catch (error) {
    return json({ error: error.message || "Could not export orders.", details: error.details || null }, error.status || 500);
  }
}
