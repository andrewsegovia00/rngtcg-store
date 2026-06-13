/* ============================================================================
   R&G TCG — CHECKOUT HANDOFF
   Block 7: checkout posts cart to Cloudflare Function, which can reserve
   Supabase inventory before redirecting to Stripe Checkout.
   ============================================================================ */
let shipChoice = "standard";
const SHIP = { standard:5, express:15 };
const FREE_SHIPPING_THRESHOLD = 200;
const $ = s => document.querySelector(s);

function loadCart(){
  try {
    const parsed = JSON.parse(localStorage.getItem("rg_tcg_cart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}
let cart = loadCart().filter(l => productById(l.productId));

function subtotal(){
  return cart.reduce((s,l)=> s + unitPrice(productById(l.productId), l.format)*l.quantity, 0);
}
function itemCount(){ return cart.reduce((s,l)=>s+l.quantity,0); }
function shipping(){ return subtotal() >= FREE_SHIPPING_THRESHOLD ? 0 : SHIP[shipChoice]; }
function total(){ return subtotal() + shipping(); }

function renderSummary(){
  const lines = $("#summaryLines");
  const count = itemCount();
  $("#summaryCount").textContent = count + (count === 1 ? " item" : " items");

  if(!cart.length){
    lines.innerHTML = `<div class="summary-empty">Your checkout chest is empty. Go back to the shop and add product.</div>`;
  } else {
    lines.innerHTML = `<div class="summary-lines">${cart.map(l => {
      const p = productById(l.productId);
      const each = unitPrice(p,l.format);
      return `<div class="summary-line">
        <div class="summary-thumb" style="--tone:${p.tone}">${p.symbol}</div>
        <div><div class="summary-name">${p.name}</div><div class="summary-meta">${categoryShort(p.category)} · ${languageShort(p.language)} · ${l.format} · qty ${l.quantity}</div></div>
        <div class="summary-price">${formatMoney(each*l.quantity)}</div>
      </div>`;
    }).join("")}</div>`;
  }

  $("#summaryTotals").innerHTML = `
    <div class="total-row"><span>Subtotal</span><strong>${formatMoney(subtotal())}</strong></div>
    <div class="total-row"><span>Shipping</span><strong class="${shipping()===0?'free':''}">${shipping()===0?'Free':formatMoney(shipping())}</strong></div>
    <div class="total-row"><span>Tax</span><strong>Calculated by Stripe</strong></div>
    <div class="total-row grand"><span>Total before tax</span><strong>${formatMoney(total())}</strong></div>`;
  $("#placeTotal").textContent = formatMoney(total());
  $("#standardShip").textContent = subtotal() >= FREE_SHIPPING_THRESHOLD ? "Free" : "$5.00";
}

function setCheckoutState(state, message){
  const btn = $("#placeOrder");
  const msg = $("#checkoutMessage");
  btn.disabled = state === "loading";
  btn.classList.toggle("is-loading", state === "loading");
  if (state === "loading") btn.dataset.originalText = btn.dataset.originalText || btn.innerHTML;
  if (state === "loading") btn.innerHTML = "Opening secure Stripe Checkout…";
  if (state !== "loading" && btn.dataset.originalText) btn.innerHTML = btn.dataset.originalText;
  if (msg) {
    msg.textContent = message || "";
    msg.className = "checkout-message" + (state === "error" ? " is-error" : state === "success" ? " is-success" : "");
  }
}

async function releaseCancelledReservationIfPresent(){
  const params = new URLSearchParams(location.search);
  const orderId = params.get("order_id");
  if (!orderId || location.protocol === "file:") return;
  try {
    await fetch("/api/release-reservation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ order_id: orderId })
    });
  } catch (_) {}
}

async function startStripeCheckout(){
  if(!cart.length){
    setCheckoutState("error", "Your chest is empty.");
    return;
  }
  if (location.protocol === "file:") {
    setCheckoutState("error", "Open this through Cloudflare Pages / Wrangler dev so /api/create-checkout-session exists.");
    return;
  }

  setCheckoutState("loading", "Creating secure Stripe checkout…");
  const email = $("#email")?.value?.trim() || "";
  const newsletter = $("#newsletterOptIn")?.checked ?? false;

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cart, email, shipping: shipChoice, newsletter })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) {
      throw new Error(data.error || "Could not create Stripe Checkout Session.");
    }
    setCheckoutState("success", data.order_number ? `Reserved ${data.order_number}. Redirecting to Stripe…` : "Redirecting to Stripe…");
    window.location.assign(data.url);
  } catch (error) {
    setCheckoutState("error", error.message || "Checkout failed. Try again.");
  }
}

document.querySelectorAll(".ship-choice").forEach(b => {
  b.addEventListener("click", () => {
    shipChoice = b.dataset.ship;
    document.querySelectorAll(".ship-choice").forEach(x => x.classList.toggle("is-selected", x === b));
    renderSummary();
  });
});

$("#placeOrder").addEventListener("click", startStripeCheckout);

if (new URLSearchParams(location.search).get("checkout") === "cancelled") {
  setCheckoutState("error", "Checkout was cancelled. Your chest is still saved and the reservation was released.");
  releaseCancelledReservationIfPresent();
}

renderSummary();
