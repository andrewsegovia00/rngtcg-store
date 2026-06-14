/* ============================================================================
   R&G TCG — Marketing page. Token-gated (shares the admin token).
   Email-list & deliverability metrics + a viewable / downloadable newsletter
   subscriber list.
   ============================================================================ */
const TOKEN_KEY = "rg_admin_token";
const $ = (s, r = document) => r.querySelector(s);
const fmtDate = v => v ? new Date(v).toLocaleDateString() : "—";

let subscribers = [];

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

function pct(part, whole) {
  if (!whole) return "—";
  return `${Math.round((Number(part || 0) / whole) * 100)}%`;
}

function renderMetrics(m) {
  const s = m.email_stats || {};
  const sent = Number(s.sent || 0) || (Number(s.delivered || 0) + Number(s.bounced || 0));
  const delivered = Number(s.delivered || 0);
  const opened = Number(s.opened || 0);
  const bounced = Number(s.bounced || 0);
  const denom = sent || delivered || 0;
  const metrics = [
    ["Newsletter subs", Number(m.newsletter_count || 0).toLocaleString()],
    ["Order recipients", Number(m.order_recipient_count || 0).toLocaleString()],
    ["Delivery rate", denom ? pct(delivered, denom) : "—"],
    ["Open rate", delivered ? pct(opened, delivered) : "—"],
    ["Bounce rate", denom ? pct(bounced, denom) : "—"]
  ];
  $("#marketingMetrics").innerHTML = metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function renderSubscribers() {
  const active = subscribers.filter(s => !s.unsubscribed_at).length;
  $("#subsCount").textContent = `${active} active · ${subscribers.length} total`;
  $("#subsTable tbody").innerHTML = subscribers.map(s => `<tr>
    <td>${esc(s.email)}</td>
    <td><span class="badge">${esc(s.source || "—")}</span></td>
    <td class="mono-mini">${fmtDate(s.subscribed_at)}</td>
    <td class="mono-mini">${s.welcome_coupon_code ? esc(s.welcome_coupon_code) : "—"}</td>
    <td>${s.unsubscribed_at ? '<span class="badge bad">Unsubscribed</span>' : '<span class="badge good">Active</span>'}</td>
  </tr>`).join("") || `<tr><td colspan="5">No subscribers yet.</td></tr>`;
}

function downloadCsv() {
  if (!subscribers.length) return showStatus("No subscribers to export.", "err");
  const head = ["Email", "Source", "Subscribed At", "Welcome Code", "Status"];
  const rows = subscribers.map(s => [
    s.email,
    s.source || "",
    s.subscribed_at || "",
    s.welcome_coupon_code || "",
    s.unsubscribed_at ? "unsubscribed" : "active"
  ]);
  const csv = [head, ...rows]
    .map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rg-newsletter-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showStatus(`Exported ${subscribers.length} subscriber(s).`, "ok");
}

async function load() {
  if (!token()) { showStatus("Paste your admin token to load marketing.", "err"); return; }
  try {
    const [overview, subs] = await Promise.all([
      api("/api/admin-marketing"),
      api("/api/admin-subscribers")
    ]);
    renderMetrics(overview);
    subscribers = subs.subscribers || [];
    renderSubscribers();
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
$("#downloadBtn").onclick = downloadCsv;

if (token()) { $("#adminToken").value = token(); load(); }
