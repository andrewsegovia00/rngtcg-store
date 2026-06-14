import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch, supabaseRpc } from "../_lib/supabase.js";

export async function onRequestGet({ request, env }) {
  const guard = requireAdmin(request, env);
  if (!guard.ok) return guard.response;

  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  try {
    const [products, inventory, orders] = await Promise.all([
      supabaseFetch(env, "/products?select=id,category,name,set_code,language,badge,tone,symbol,active,product_variants(sku,format,price_cents,stock_on_hand,stock_reserved,stock_sold,weight_oz,active)&order=category.asc,name.asc"),
      supabaseRpc(env, "get_inventory_snapshot", {}),
      supabaseFetch(env, "/checkout_orders?select=id,order_number,status,customer_email,stripe_customer_email,shipping_method,subtotal_cents,shipping_cents,total_before_tax_cents,stripe_session_id,expires_at,paid_at,released_at,fulfilled_at,tracking_number,order_tag,ready_to_ship,bundle_id,ship_mode,tiktok_username,ship_name,ship_phone,ship_line1,ship_line2,ship_city,ship_state,ship_postal_code,ship_country,created_at,checkout_order_items(id,title,format,language,category,set_code,quantity,unit_amount_cents,line_amount_cents)&order=created_at.desc&limit=500")
    ]);

    const totals = {
      products: Array.isArray(products) ? products.length : 0,
      variants: Array.isArray(inventory) ? inventory.length : 0,
      orders: Array.isArray(orders) ? orders.length : 0,
      pending: Array.isArray(orders) ? orders.filter(o => o.status === "pending").length : 0,
      paid: Array.isArray(orders) ? orders.filter(o => o.status === "paid").length : 0,
      unfulfilled: Array.isArray(orders) ? orders.filter(o => o.status === "paid" && !o.fulfilled_at).length : 0,
      reserved_units: Array.isArray(inventory) ? inventory.reduce((sum, v) => sum + Number(v.stock_reserved || 0), 0) : 0,
      available_units: Array.isArray(inventory) ? inventory.reduce((sum, v) => sum + Number(v.available || 0), 0) : 0,
      revenue_cents: Array.isArray(orders) ? orders.filter(o => o.status === "paid").reduce((sum, o) => sum + Number(o.total_before_tax_cents || 0), 0) : 0
    };

    return json({ ok: true, totals, products, inventory, orders });
  } catch (error) {
    return json({ error: error.message || "Could not load admin overview.", details: error.details || null }, error.status || 500);
  }
}
