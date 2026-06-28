import { json, requireAdmin } from "../_lib/admin.js";
import { hasSupabase, supabaseFetch } from "../_lib/supabase.js";

export async function onRequestPost({ request, env }) {
  const guard = await requireAdmin(request, env);
  if (!guard.ok) return guard.response;
  if (!hasSupabase(env)) return json({ error: "Supabase is not configured." }, 501);

  let payload = {};
  try { payload = await request.json(); } catch (_) { return json({ error: "Invalid JSON body." }, 400); }
  const id = String(payload.id || "").trim();
  if (!id) return json({ error: "Missing product id." }, 400);

  const patch = {};
  if (payload.active !== undefined) patch.active = Boolean(payload.active);
  if (payload.badge !== undefined) patch.badge = payload.badge ? String(payload.badge).trim().toUpperCase().slice(0, 12) : null;

  if (!Object.keys(patch).length) return json({ error: "Nothing to update." }, 400);

  try {
    const updated = await supabaseFetch(env, `/products?id=eq.${encodeURIComponent(id)}&select=id,category,name,set_code,language,badge,active`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify(patch)
    });
    if (!Array.isArray(updated) || !updated.length) return json({ error: "Product not found." }, 404);
    return json({ ok: true, product: updated[0] });
  } catch (error) {
    return json({ error: error.message || "Could not update product.", details: error.details || null }, error.status || 500);
  }
}
