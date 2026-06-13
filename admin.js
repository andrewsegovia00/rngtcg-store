/* ============================================================================
   R&G TCG Admin MVP
   - Token-protected API calls
   - Inventory/price editing
   - Pending reservation release
   ============================================================================ */
const TOKEN_KEY = "rg_admin_token";
let state = { products: [], inventory: [], orders: [], totals: null };
let editingVariant = null;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const fmtDate = value => value ? new Date(value).toLocaleString() : "—";
const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());

function token() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function setToken(value) { sessionStorage.setItem(TOKEN_KEY, value.trim()); }
function clearToken() { sessionStorage.removeItem(TOKEN_KEY); }

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
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${token()}`,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

async function load() {
  if (!token()) {
    showStatus("Paste your admin token to load the dashboard.", "err");
    return;
  }
  try {
    showStatus("Loading admin dashboard…", "ok");
    const data = await api("/api/admin-overview");
    state = data;
    renderAll();
    showStatus("Dashboard refreshed.", "ok");
  } catch (error) {
    showStatus(error.message, "err");
  }
}

function renderAll() {
  renderMetrics();
  renderInventory();
  renderOrders();
}

function renderMetrics() {
  const t = state.totals || {};
  const metrics = [
    ["Revenue", money(t.revenue_cents)],
    ["Available units", Number(t.available_units || 0).toLocaleString()],
    ["Reserved units", Number(t.reserved_units || 0).toLocaleString()],
    ["Pending holds", Number(t.pending || 0).toLocaleString()]
  ];
  $("#metrics").innerHTML = metrics.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function flattenVariants() {
  return (state.products || []).flatMap(product => (product.product_variants || []).map(variant => ({ product, variant })));
}

function available(v) {
  return Math.max(Number(v.stock_on_hand || 0) - Number(v.stock_reserved || 0) - Number(v.stock_sold || 0), 0);
}

function renderInventory() {
  const q = $("#productSearch").value.trim().toLowerCase();
  const mode = $("#stockFilter").value;
  const rows = flattenVariants().filter(({ product, variant }) => {
    const hay = `${product.name} ${product.id} ${product.category} ${product.set_code} ${product.language} ${variant.sku} ${variant.format}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (mode === "low" && available(variant) > 5) return false;
    if (mode === "reserved" && Number(variant.stock_reserved || 0) <= 0) return false;
    if (mode === "inactive" && product.active && variant.active) return false;
    return true;
  });

  const body = $("#inventoryTable tbody");
  body.innerHTML = rows.map(({ product, variant }) => {
    const avail = available(variant);
    const statusClass = !product.active || !variant.active ? "bad" : avail <= 0 ? "bad" : avail <= 5 ? "warn" : "good";
    const statusText = !product.active || !variant.active ? "Inactive" : avail <= 0 ? "Sold out" : avail <= 5 ? "Low" : "OK";
    return `<tr>
      <td>
        <div class="product-name">${product.name}</div>
        <div class="product-meta">${cap(product.category)} · ${product.set_code}</div>
      </td>
      <td><span class="badge">${cap(product.language)}</span></td>
      <td><span class="badge dark">${cap(variant.format)}</span></td>
      <td class="mono-mini">${variant.sku}</td>
      <td>${money(variant.price_cents)}</td>
      <td>${variant.stock_on_hand}</td>
      <td><span class="badge ${statusClass}">${avail} · ${statusText}</span></td>
      <td>${variant.stock_reserved}</td>
      <td>${variant.stock_sold}</td>
      <td>
        <div class="tiny-edit">
          <button class="small-btn" data-edit="${variant.sku}">Edit</button>
          <button class="small-btn ghost" data-toggle-product="${product.id}" data-active="${product.active ? "0" : "1"}">${product.active ? "Hide" : "Show"}</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">No variants match the current filters.</td></tr>`;

  $$('[data-edit]').forEach(btn => btn.onclick = () => openVariant(btn.dataset.edit));
  $$('[data-toggle-product]').forEach(btn => btn.onclick = () => toggleProduct(btn.dataset.toggleProduct, btn.dataset.active === "1"));
}

function findVariant(sku) {
  return flattenVariants().find(row => row.variant.sku === sku);
}

function openVariant(sku) {
  const row = findVariant(sku);
  if (!row) return;
  editingVariant = row;
  $("#variantTitle").textContent = `${row.product.name} · ${cap(row.variant.format)}`;
  $("#variantSku").value = sku;
  $("#variantStock").value = row.variant.stock_on_hand;
  $("#variantPrice").value = (Number(row.variant.price_cents || 0) / 100).toFixed(2);
  $("#variantActive").checked = Boolean(row.variant.active);
  $("#variantDialog").showModal();
}

async function saveVariant(event) {
  event.preventDefault();
  const sku = $("#variantSku").value;
  const dollars = Number.parseFloat($("#variantPrice").value || "0");
  try {
    await api("/api/admin-update-variant", {
      method: "POST",
      body: JSON.stringify({
        sku,
        stock_on_hand: Number.parseInt($("#variantStock").value, 10),
        price_cents: Math.round(dollars * 100),
        active: $("#variantActive").checked
      })
    });
    $("#variantDialog").close();
    showStatus("Variant updated.", "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

async function toggleProduct(id, active) {
  try {
    await api("/api/admin-update-product", {
      method: "POST",
      body: JSON.stringify({ id, active })
    });
    showStatus(active ? "Product made visible." : "Product hidden.", "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

function statusBadge(status) {
  const cls = status === "paid" ? "good" : status === "pending" ? "warn" : status === "released" || status === "expired" ? "bad" : "dark";
  return `<span class="badge ${cls}">${cap(status)}</span>`;
}

function renderOrders() {
  const mode = $("#orderFilter").value;
  const orders = (state.orders || []).filter(order => mode === "all" || order.status === mode);
  const box = $("#orders");
  box.innerHTML = orders.map(order => {
    const email = order.customer_email || order.stripe_customer_email || "No email yet";
    const lines = order.checkout_order_items || [];
    const canRelease = order.status === "pending";
    return `<article class="order-card">
      <div class="order-head">
        <div>
          <div class="order-title">${order.order_number}</div>
          <div class="order-email">${email} · ${fmtDate(order.created_at)}</div>
        </div>
        ${statusBadge(order.status)}
      </div>
      <div class="order-lines">
        ${lines.map(line => `<div class="order-line"><span>${line.quantity}× ${line.title} <span class="mono-mini">${cap(line.format)} · ${cap(line.language)}</span></span><strong>${money(line.line_amount_cents)}</strong></div>`).join("") || `<div class="order-line">No line items loaded.</div>`}
      </div>
      <div class="order-actions">
        <span class="order-total">${money(order.total_before_tax_cents)}</span>
        <div class="tiny-edit">
          <span class="mono-mini">Expires ${fmtDate(order.expires_at)}</span>
          ${canRelease ? `<button class="small-btn danger" data-release="${order.id}">Release hold</button>` : ""}
        </div>
      </div>
    </article>`;
  }).join("") || `<article class="order-card">No orders match this filter.</article>`;

  $$('[data-release]').forEach(btn => btn.onclick = () => releaseOrder(btn.dataset.release));
}

async function releaseOrder(orderId) {
  if (!confirm("Release this pending inventory hold?")) return;
  try {
    await api("/api/admin-release-order", {
      method: "POST",
      body: JSON.stringify({ order_id: orderId })
    });
    showStatus("Reservation released.", "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
}

$("#tokenForm").addEventListener("submit", event => {
  event.preventDefault();
  const value = $("#adminToken").value;
  if (!value.trim()) return showStatus("Enter an admin token first.", "err");
  setToken(value);
  load();
});
$("#refreshBtn").onclick = load;
$("#lockBtn").onclick = () => { clearToken(); $("#adminToken").value = ""; showStatus("Admin session locked.", "err"); };
$("#productSearch").addEventListener("input", renderInventory);
$("#stockFilter").addEventListener("change", renderInventory);
$("#orderFilter").addEventListener("change", renderOrders);
$("#variantForm").addEventListener("submit", saveVariant);
$("#cancelVariant").onclick = () => $("#variantDialog").close();

if (token()) {
  $("#adminToken").value = token();
  load();
} else {
  renderMetrics();
}
