/* ============================================================================
   R&G TCG — Orders page. Token-gated (shares the admin token).
   Recent checkout orders with status + date-range filters, tagging, bundling,
   fulfillment, and PirateShip export. Default view is the current month;
   switch the date range to see older orders.
   ============================================================================ */
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const fmtDate = value => value ? new Date(value).toLocaleString() : "—";
const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());

let orders = [];
const selectedOrders = new Set();
const TAG_LABEL = { sealed: "Sealed", open_live: "Open live" };

const token = () => (window.AdminAuth ? window.AdminAuth.accessToken() : "");

function showStatus(message, type = "ok") {
  const el = $("#status");
  el.hidden = false;
  el.className = `status ${type}`;
  el.textContent = message;
  if (type === "ok") setTimeout(() => { el.hidden = true; }, 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", "authorization": `Bearer ${token()}`, ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function load() {
  if (!token()) { showStatus("Paste your admin token to load orders.", "err"); return; }
  try {
    const data = await api("/api/admin-overview");
    orders = data.orders || [];
    renderOrders();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

function statusBadge(status) {
  const cls = status === "paid" ? "good" : status === "pending" ? "warn" : status === "released" || status === "expired" ? "bad" : "dark";
  return `<span class="badge ${cls}">${cap(status)}</span>`;
}

function withinRange(order) {
  const range = $("#dateRange").value;
  if (range === "all") return true;
  const created = new Date(order.created_at);
  if (Number.isNaN(created.getTime())) return true;
  const now = new Date();
  if (range === "month") return created.getFullYear() === now.getFullYear() && created.getMonth() === now.getMonth();
  const days = Number(range);
  if (Number.isFinite(days)) return (now - created) <= days * 86400000;
  return true;
}

function orderMatchesFilter(order, mode) {
  if (mode === "all") return true;
  const paid = order.status === "paid";
  const shipped = paid && !!order.fulfilled_at;
  if (mode === "to_open") return paid && !shipped && order.order_tag === "open_live" && !order.ready_to_ship;
  if (mode === "ready") return paid && !shipped && !!order.ready_to_ship;
  if (mode === "shipped") return shipped;
  if (mode === "all_active") return paid && !shipped;
  return order.status === mode; // pending / released / expired
}

function shipAddress(order) {
  const parts = [
    order.ship_name,
    [order.ship_line1, order.ship_line2].filter(Boolean).join(", "),
    [order.ship_city, order.ship_state, order.ship_postal_code].filter(Boolean).join(" "),
    order.ship_country
  ].filter(Boolean);
  if (!parts.length) return "";
  return `<div class="order-ship"><span class="mono-mini">Ship to</span> ${parts.join(" · ")}${order.ship_phone ? ` · ${order.ship_phone}` : ""}</div>`;
}

function renderOrders() {
  const mode = $("#orderFilter").value;
  const list = (orders || []).filter(o => withinRange(o) && orderMatchesFilter(o, mode));
  const visibleIds = new Set(list.map(o => o.id));
  [...selectedOrders].forEach(id => { if (!visibleIds.has(id)) selectedOrders.delete(id); });

  const box = $("#orders");
  box.innerHTML = list.map(order => {
    const email = order.customer_email || order.stripe_customer_email || "No email yet";
    const lines = order.checkout_order_items || [];
    const canRelease = order.status === "pending";
    const isPaid = order.status === "paid";
    const isFulfilled = isPaid && !!order.fulfilled_at;
    const tag = order.order_tag || "sealed";
    const ready = !!order.ready_to_ship;
    const tiktok = order.tiktok_username ? `<span class="order-tiktok">@${order.tiktok_username}</span>` : "";
    const stateBadge = isFulfilled
      ? `<span class="badge good">Shipped ${fmtDate(order.fulfilled_at)}${order.tracking_number ? ` · ${order.tracking_number}` : ""}</span>`
      : isPaid
        ? `<span class="badge ${tag === 'open_live' ? 'live' : 'dark'}">${TAG_LABEL[tag] || tag}</span>${ready ? `<span class="badge good">Ready</span>` : (tag === 'open_live' ? `<span class="badge warn">To open</span>` : "")}`
        : "";
    const shipMode = order.ship_mode || "sealed";
    const tagSelect = isPaid && !isFulfilled
      ? `<select class="tag-select" data-id="${order.id}" title="Order type">
           <option value="sealed" ${tag==='sealed'?'selected':''}>Sealed</option>
           <option value="open_live" ${tag==='open_live'?'selected':''}>Open live</option>
         </select>` : "";
    const modeSelect = isPaid && !isFulfilled
      ? `<select class="tag-select" data-mode-id="${order.id}" title="Ship weight mode">
           <option value="sealed" ${shipMode==='sealed'?'selected':''}>Ship: Sealed</option>
           <option value="all_cards" ${shipMode==='all_cards'?'selected':''}>Ship: All cards</option>
           <option value="hits_only" ${shipMode==='hits_only'?'selected':''}>Ship: Hits only</option>
         </select>` : "";
    const bundleBadge = order.bundle_id ? `<span class="badge live" title="${order.bundle_id}">Bundled</span>` : "";
    return `<article class="order-card${isFulfilled ? '' : ' is-actionable'}">
      <div class="order-head">
        <div class="order-head__main">
          ${isPaid && !isFulfilled ? `<input type="checkbox" class="order-pick" data-id="${order.id}" ${selectedOrders.has(order.id)?'checked':''} aria-label="Select order" />` : ""}
          <div>
            <div class="order-title">${order.order_number} ${tiktok}</div>
            <div class="order-email">${email} · ${fmtDate(order.created_at)}</div>
          </div>
        </div>
        <div class="tiny-edit">${statusBadge(order.status)}${stateBadge}${bundleBadge}</div>
      </div>
      ${isPaid ? shipAddress(order) : ""}
      <div class="order-lines">
        ${lines.map(line => `<div class="order-line"><span>${line.quantity}× ${line.title} <span class="mono-mini">${cap(line.format)} · ${cap(line.language)}</span></span><strong>${money(line.line_amount_cents)}</strong></div>`).join("") || `<div class="order-line">No line items loaded.</div>`}
      </div>
      <div class="order-actions">
        <span class="order-total">${money(order.total_before_tax_cents)}</span>
        <div class="tiny-edit">
          ${canRelease ? `<span class="mono-mini">Expires ${fmtDate(order.expires_at)}</span><button class="small-btn danger" data-release="${order.id}">Release hold</button>` : ""}
          ${tagSelect}
          ${modeSelect}
          ${isPaid && !isFulfilled && !ready ? `<button class="small-btn" data-ready="${order.id}">Mark ready to ship</button>` : ""}
          ${isPaid && !isFulfilled ? `<button class="small-btn" data-fulfill="${order.id}">Mark shipped</button>` : ""}
          ${isFulfilled ? `<button class="small-btn ghost" data-unfulfill="${order.id}">Undo shipped</button>` : ""}
        </div>
      </div>
    </article>`;
  }).join("") || `<article class="order-card">No orders match this filter.</article>`;

  $$('[data-release]').forEach(btn => btn.onclick = () => releaseOrder(btn.dataset.release));
  $$('[data-fulfill]').forEach(btn => btn.onclick = () => markFulfilled([btn.dataset.fulfill]));
  $$('[data-unfulfill]').forEach(btn => btn.onclick = () => markFulfilled([btn.dataset.unfulfill], true));
  $$('[data-ready]').forEach(btn => btn.onclick = () => updateOrders([btn.dataset.ready], { ready_to_ship: true }));
  $$('.tag-select[data-id]').forEach(sel => sel.onchange = () => updateOrders([sel.dataset.id], { order_tag: sel.value }));
  $$('.tag-select[data-mode-id]').forEach(sel => sel.onchange = () => updateOrders([sel.dataset.modeId], { ship_mode: sel.value }));
  $$('.order-pick').forEach(cb => cb.onchange = () => {
    cb.checked ? selectedOrders.add(cb.dataset.id) : selectedOrders.delete(cb.dataset.id);
    renderBulkBar();
  });
  renderBulkBar();
}

function renderBulkBar() {
  const bar = $("#bulkBar");
  if (!bar) return;
  const n = selectedOrders.size;
  bar.hidden = n === 0;
  if (n) $("#bulkCount").textContent = `${n} selected`;
}

async function updateOrders(ids, patch) {
  try {
    await api("/api/admin-update-order", { method: "POST", body: JSON.stringify({ order_ids: ids, ...patch }) });
    showStatus("Orders updated.", "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

async function releaseOrder(orderId) {
  if (!confirm("Release this pending inventory hold?")) return;
  try {
    await api("/api/admin-release-order", { method: "POST", body: JSON.stringify({ order_id: orderId }) });
    showStatus("Reservation released.", "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

async function markFulfilled(ids, undo = false) {
  ids = Array.isArray(ids) ? ids : [ids];
  if (!ids.length) return;
  if (undo && !confirm("Mark these order(s) as NOT shipped again?")) return;
  const body = { order_ids: ids, undo };
  if (!undo && ids.length === 1) {
    const tracking = prompt("Tracking number (optional — leave blank to skip):", "");
    if (tracking === null) return;
    if (tracking.trim()) body.tracking_number = tracking.trim();
  }
  try {
    await api("/api/admin-mark-fulfilled", { method: "POST", body: JSON.stringify(body) });
    showStatus(undo ? "Reopened as to-ship." : `Marked ${ids.length} shipped.`, "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

async function exportOrders() {
  if (!token()) return showStatus("Unlock with your admin token first.", "err");
  try {
    showStatus("Building PirateShip CSV…", "ok");
    const response = await fetch("/api/admin-export-orders", { headers: { authorization: `Bearer ${token()}` } });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Export failed: ${response.status}`);
    }
    const count = response.headers.get("x-order-count") || "?";
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match ? match[1] : `rg-pirateship-${new Date().toISOString().slice(0, 10)}.csv`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showStatus(`Exported ${count} order(s) to ${filename}.`, "ok");
  } catch (error) {
    showStatus(error.message, "err");
  }
}

$("#refreshBtn").onclick = load;
$("#lockBtn").onclick = () => window.AdminAuth.signOut();
$("#orderFilter").addEventListener("change", () => { selectedOrders.clear(); renderOrders(); });
$("#dateRange").addEventListener("change", () => { selectedOrders.clear(); renderOrders(); });
$("#exportBtn").onclick = exportOrders;
$("#bulkReady").onclick = () => selectedOrders.size && updateOrders([...selectedOrders], { ready_to_ship: true });
$("#bulkShipped").onclick = () => selectedOrders.size && markFulfilled([...selectedOrders]);
$("#bulkSealed").onclick = () => selectedOrders.size && updateOrders([...selectedOrders], { order_tag: "sealed" });
$("#bulkOpen").onclick = () => selectedOrders.size && updateOrders([...selectedOrders], { order_tag: "open_live" });
$("#bulkBundle").onclick = () => selectedOrders.size && updateOrders([...selectedOrders], { bundle: "new" });
$("#bulkUnbundle").onclick = () => selectedOrders.size && updateOrders([...selectedOrders], { bundle: "clear" });
$("#bulkClear").onclick = () => { selectedOrders.clear(); renderOrders(); };

window.AdminAuth.requireLogin(load);
