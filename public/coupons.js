/* ============================================================================
   R&G TCG — Coupons page. Token-gated (shares the admin token). Generate
   single-use codes, list all codes, delete (deactivates the Stripe promo code).
   ============================================================================ */
const TOKEN_KEY = "rg_admin_token";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const fmtDate = v => v ? new Date(v).toLocaleDateString() : "—";

const token = () => sessionStorage.getItem(TOKEN_KEY) || "";
const setToken = v => sessionStorage.setItem(TOKEN_KEY, v.trim());
const clearToken = () => sessionStorage.removeItem(TOKEN_KEY);

function showStatus(message, type = "ok") {
  const el = $("#status");
  el.hidden = false;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === "ok") setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "authorization": `Bearer ${token()}`, ...(options.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

async function load() {
  if (!token()) { showStatus("Paste your admin token to load coupons.", "err"); return; }
  try {
    const data = await api("/api/admin-marketing");
    renderCoupons(data.coupons || []);
  } catch (error) {
    showStatus(error.message, "err");
  }
}

function renderCoupons(coupons) {
  $("#couponTable tbody").innerHTML = coupons.map(c => `<tr>
    <td class="mono-mini">${c.code}</td>
    <td>${c.percent_off}%</td>
    <td>${c.expires_at ? fmtDate(c.expires_at) : "Never"}</td>
    <td>${fmtDate(c.created_at)}</td>
    <td><button class="small-btn danger" data-del="${c.code}">Delete</button></td>
  </tr>`).join("") || `<tr><td colspan="5">No codes yet.</td></tr>`;
  $$('[data-del]').forEach(b => b.onclick = () => deleteCoupon(b.dataset.del));
}

async function generate(event) {
  event.preventDefault();
  const count = Number.parseInt($("#couponCount").value, 10);
  const percent = Number.parseInt($("#couponPercent").value, 10);
  const expires = $("#couponExpires").value ? Number.parseInt($("#couponExpires").value, 10) : null;
  try {
    showStatus("Generating in Stripe…", "ok");
    const data = await api("/api/admin-generate-coupons", {
      method: "POST",
      body: JSON.stringify({ count, percent_off: percent, expires_days: expires })
    });
    const out = $("#couponOutput");
    out.hidden = false;
    out.value = (data.codes || []).join("\n");
    out.rows = Math.min(Math.max((data.codes || []).length, 2), 12);
    showStatus(data.warning || `Generated ${data.count} code(s).`, data.warning ? "err" : "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

async function deleteCoupon(code) {
  if (!confirm(`Delete ${code}? It will stop working immediately.`)) return;
  try {
    await api("/api/admin-delete-coupon", { method: "POST", body: JSON.stringify({ code }) });
    showStatus(`Deleted ${code}.`, "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

$("#tokenForm").addEventListener("submit", e => {
  e.preventDefault();
  const v = $("#adminToken").value;
  if (!v.trim()) return showStatus("Enter an admin token first.", "err");
  setToken(v);
  load();
});
$("#refreshBtn").onclick = load;
$("#lockBtn").onclick = () => { clearToken(); $("#adminToken").value = ""; showStatus("Locked.", "err"); };
$("#couponForm").addEventListener("submit", generate);

if (token()) { $("#adminToken").value = token(); load(); }
