import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";
import { fail } from "../_lib/respond.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  if (!sessionId) return json({ error: "Missing session_id." }, 400);

  if (!hasSupabase(env)) {
    return json({ supabase_enabled: false, session_id: sessionId, message: "Supabase not configured; Stripe accepted the checkout, but no order lookup is available yet." });
  }

  try {
    const orders = await supabaseFetch(
      env,
      `/checkout_orders?stripe_session_id=eq.${encodeURIComponent(sessionId)}&select=id,order_number,status,customer_email,stripe_customer_email,subtotal_cents,shipping_cents,total_before_tax_cents,paid_at,created_at,checkout_order_items(title,format,language,category,set_code,quantity,unit_amount_cents,line_amount_cents)&limit=1`
    );
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order) return json({ supabase_enabled: true, session_id: sessionId, found: false });
    return json({ supabase_enabled: true, found: true, order });
  } catch (error) {
    return fail(error, { context: "order-status", fallback: "Could not load your order right now." });
  }
}
