/* ============================================================================
   Public shipping quote. POST /api/shipping-quote
   Body: { cart: [{productId, format, quantity}], address: {city,state,postal_code,country,...} }
   Returns { source, weight_oz, subtotal_cents, options:[{id,label,amount_cents,carrier?,days?}] }.
   Server is authoritative — create-checkout-session re-quotes and never trusts
   the client's amount.
   ============================================================================ */
import { quoteShipping } from "../_lib/shipping.js";
import { fail } from "../_lib/respond.js";

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export async function onRequestPost({ request, env }) {
  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }

  const cart = Array.isArray(payload.cart) ? payload.cart : [];
  if (!cart.length) return json({ error: "Cart is empty." }, 400);

  const address = payload.address || {};
  if (!address.postal_code && !address.zip) {
    return json({ error: "Enter a shipping ZIP code to see rates." }, 400);
  }

  try {
    const quote = await quoteShipping(env, { cart, address });
    return json({ ok: true, ...quote });
  } catch (error) {
    return fail(error, { context: "shipping-quote", fallback: "Could not get shipping rates. Please try again." });
  }
}
