/* ============================================================================
   R&G TCG Admin MVP
   - Token-protected API calls
   - Inventory/price editing
   - Pending reservation release
   ============================================================================ */
let state = { products: [], inventory: [], orders: [], totals: null };
let editingVariant = null;

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const money = cents => `$${(Number(cents || 0) / 100).toFixed(2)}`;
const fmtDate = value => value ? new Date(value).toLocaleString() : "—";
const cap = s => String(s || "").replace(/^./, c => c.toUpperCase());

// Auth is handled by the shared Supabase gate (admin-auth.js); the bearer is
// the current Supabase access token.
function token() { return window.AdminAuth ? window.AdminAuth.accessToken() : ""; }

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
  if (!token()) return;   // gate (admin-auth.js) handles the unauthenticated case
  try {
    showStatus("Loading admin dashboard…", "ok");
    const data = await api("/api/admin-overview");
    state = data;
    renderAll();
    showStatus("Dashboard refreshed.", "ok");
  } catch (error) {
    // A session that stops working mid-use bounces back to the sign-in gate.
    if (/unauthor/i.test(error.message || "")) window.AdminAuth.signOut();
    else showStatus(error.message, "err");
  }
}

function renderAll() {
  renderMetrics();
  renderInventory();
}

function renderMetrics() {
  const t = state.totals || {};
  const metrics = [
    ["Revenue", money(t.revenue_cents)],
    ["To ship", Number(t.unfulfilled || 0).toLocaleString()],
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
          <button class="small-btn danger" data-delete-product="${product.id}">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("") || `<tr><td colspan="10">No variants match the current filters.</td></tr>`;

  $$('[data-edit]').forEach(btn => btn.onclick = () => openVariant(btn.dataset.edit));
  $$('[data-toggle-product]').forEach(btn => btn.onclick = () => toggleProduct(btn.dataset.toggleProduct, btn.dataset.active === "1"));
  $$('[data-delete-product]').forEach(btn => btn.onclick = () => deleteProduct(btn.dataset.deleteProduct));
}

async function deleteProduct(id) {
  const p = (state.products || []).find(x => x.id === id);
  const name = p ? p.name : id;
  if (!confirm(`Permanently delete "${name}" and its box/pack variants? This can't be undone.\n\nProducts that have ever sold can't be deleted — hide those instead.`)) return;
  try {
    await api("/api/admin-delete-product", { method: "POST", body: JSON.stringify({ id }) });
    showStatus(`Deleted ${name}.`, "ok");
    await load();
  } catch (error) {
    showStatus(error.message, "err");
  }
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
  $("#variantWeight").value = row.variant.weight_oz ?? "";
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
        weight_oz: $("#variantWeight").value === "" ? undefined : Number.parseFloat($("#variantWeight").value),
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

/* Orders moved to their own page — see orders.html / orders.js. */

$("#refreshBtn").onclick = load;
$("#lockBtn").onclick = () => window.AdminAuth.signOut();
$("#productSearch").addEventListener("input", renderInventory);
$("#stockFilter").addEventListener("change", renderInventory);
$("#variantForm").addEventListener("submit", saveVariant);
$("#cancelVariant").onclick = () => $("#variantDialog").close();

// Show the Supabase sign-in gate; load the dashboard once a session unlocks.
window.AdminAuth.requireLogin(load);
