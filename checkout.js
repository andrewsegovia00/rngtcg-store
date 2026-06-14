/* ============================================================================
   R&G TCG — CHECKOUT
   We collect the shipping address here, quote shipping (Shippo + flat fallback)
   via /api/shipping-quote, then create a Stripe Checkout session with the
   address stored on our order and the chosen rate as a line item. Stripe just
   takes payment (no second address entry).
   ============================================================================ */
const FREE_SHIPPING_THRESHOLD = 200;
const TEST_MODE = new URLSearchParams(location.search).get("test") === "1";
const $ = s => document.querySelector(s);

let chosenShipping = null;   // { id, amount_cents, label }
let ratesToken = 0;          // guards against out-of-order quote responses

function loadCart(){
  try {
    const parsed = JSON.parse(localStorage.getItem("rg_tcg_cart") || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
let cart = loadCart().filter(l => productById(l.productId));

function subtotal(){ return cart.reduce((s,l)=> s + unitPrice(productById(l.productId), l.format)*l.quantity, 0); }
function itemCount(){ return cart.reduce((s,l)=>s+l.quantity,0); }
function shippingDollars(){ return chosenShipping ? chosenShipping.amount_cents / 100 : 0; }
function total(){ return subtotal() + shippingDollars(); }

function readAddress(){
  return {
    name: $("#shipName")?.value?.trim() || "",
    line1: $("#shipLine1")?.value?.trim() || "",
    line2: $("#shipLine2")?.value?.trim() || "",
    city: $("#shipCity")?.value?.trim() || "",
    state: $("#shipState")?.value?.trim() || "",
    postal_code: $("#shipZip")?.value?.trim() || "",
    country: "US",
    phone: $("#shipPhone")?.value?.trim() || ""
  };
}
function addressReady(a){ return a.line1 && a.city && a.state && a.postal_code; }

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

  const shipCell = chosenShipping
    ? (chosenShipping.amount_cents === 0 ? '<strong class="free">Free</strong>' : `<strong>${formatMoney(shippingDollars())}</strong>`)
    : '<strong class="muted">Select above</strong>';
  $("#summaryTotals").innerHTML = `
    <div class="total-row"><span>Subtotal</span><strong>${formatMoney(subtotal())}</strong></div>
    <div class="total-row"><span>Shipping</span>${shipCell}</div>
    <div class="total-row"><span>Tax</span><strong>Calculated by Stripe</strong></div>
    <div class="total-row grand"><span>Total before tax</span><strong>${formatMoney(total())}</strong></div>`;
  $("#placeTotal").textContent = formatMoney(total());
}

function renderRates(quote){
  const box = $("#shipRates");
  if (!quote || !quote.options || !quote.options.length){
    box.innerHTML = `<p class="stripe-copy">No rates yet — check your address.</p>`;
    return;
  }
  box.innerHTML = quote.options.map((o, i) => `
    <label class="ship-rate">
      <input type="radio" name="shiprate" value="${o.id}" ${i===0?'checked':''} />
      <span class="ship-rate__label"><strong>${o.label}</strong>${o.days?`<small>${o.days} day${o.days>1?'s':''}</small>`:''}</span>
      <b>${o.amount_cents === 0 ? 'Free' : formatMoney(o.amount_cents/100)}</b>
    </label>`).join("");
  // default to first (cheapest / free / test)
  chosenShipping = quote.options[0];
  box.querySelectorAll('input[name="shiprate"]').forEach(r => r.onchange = () => {
    chosenShipping = quote.options.find(o => o.id === r.value) || null;
    renderSummary();
  });
  renderSummary();
}

let rateTimer = null;
function scheduleRates(){ clearTimeout(rateTimer); rateTimer = setTimeout(fetchRates, 400); }

async function fetchRates(){
  const address = readAddress();
  const box = $("#shipRates");
  if (!cart.length) return;
  if (!addressReady(address)){
    chosenShipping = null;
    box.innerHTML = `<p class="stripe-copy">Fill in your address above to see live shipping rates.</p>`;
    renderSummary();
    return;
  }
  if (location.protocol === "file:") return;
  const token = ++ratesToken;
  box.innerHTML = `<p class="stripe-copy">Getting rates…</p>`;
  try {
    const res = await fetch("/api/shipping-quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cart, address, test: TEST_MODE })
    });
    const data = await res.json().catch(() => ({}));
    if (token !== ratesToken) return; // a newer request superseded this one
    if (!res.ok) { box.innerHTML = `<p class="stripe-copy">${data.error || "Couldn't get rates."}</p>`; chosenShipping = null; renderSummary(); return; }
    renderRates(data);
  } catch (_) {
    if (token === ratesToken) box.innerHTML = `<p class="stripe-copy">Couldn't reach the rate service.</p>`;
  }
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
    await fetch("/api/release-reservation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ order_id: orderId }) });
  } catch (_) {}
}

async function startStripeCheckout(){
  if(!cart.length){ setCheckoutState("error", "Your chest is empty."); return; }
  if (location.protocol === "file:") {
    setCheckoutState("error", "Open this through Cloudflare Pages / Wrangler dev so /api/create-checkout-session exists.");
    return;
  }
  const email = $("#email")?.value?.trim() || "";
  const tiktok = $("#tiktokUsername")?.value?.trim() || "";
  const address = readAddress();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setCheckoutState("error", "Enter a valid email so we can send your order confirmation.");
    $("#email")?.focus(); return;
  }
  if (!address.name || !addressReady(address)) {
    setCheckoutState("error", "Fill in your full shipping address.");
    $("#shipName")?.focus(); return;
  }
  if (!chosenShipping) {
    setCheckoutState("error", "Pick a shipping option.");
    return;
  }
  setCheckoutState("loading", "Creating secure Stripe checkout…");
  const newsletter = $("#newsletterOptIn")?.checked ?? false;

  try {
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cart, email, tiktok_username: tiktok, newsletter, address, shipping_id: chosenShipping.id, test: TEST_MODE })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || "Could not create Stripe Checkout Session.");
    setCheckoutState("success", data.order_number ? `Reserved ${data.order_number}. Redirecting to Stripe…` : "Redirecting to Stripe…");
    window.location.assign(data.url);
  } catch (error) {
    setCheckoutState("error", error.message || "Checkout failed. Try again.");
  }
}

["#shipName","#shipLine1","#shipLine2","#shipCity","#shipState","#shipZip","#shipPhone"].forEach(sel => {
  const el = $(sel);
  if (el) el.addEventListener("input", scheduleRates);
});
$("#getRatesBtn")?.addEventListener("click", fetchRates);
$("#placeOrder").addEventListener("click", startStripeCheckout);

if (new URLSearchParams(location.search).get("checkout") === "cancelled") {
  setCheckoutState("error", "Checkout was cancelled. Your chest is still saved and the reservation was released.");
  releaseCancelledReservationIfPresent();
}

/* ----------------------------------------------------------------------------
   Google Places address autocomplete (mimics Stripe's address experience).
   Uses the current PlaceAutocompleteElement (the classic Autocomplete widget is
   not available to Google customers created after March 2025). Purely additive:
   a "Search address" box fills the manual fields below. If no key is configured
   (or Maps fails to load / the key is API-restricted), the manual fields stay —
   nothing breaks.
   ---------------------------------------------------------------------------- */
function fillAddressFromComponents(components){
  const get = type => (components || []).find(c => (c.types || []).includes(type)) || null;
  const num = get("street_number"); const route = get("route");
  const line1 = [num && (num.longText || num.long_name), route && (route.longText || route.long_name)].filter(Boolean).join(" ");
  const city = get("locality") || get("postal_town") || get("sublocality_level_1") || get("sublocality");
  const state = get("administrative_area_level_1");
  const zip = get("postal_code");
  if (line1) $("#shipLine1").value = line1;
  if (city) $("#shipCity").value = city.longText || city.long_name;
  if (state) $("#shipState").value = state.shortText || state.short_name;
  if (zip) $("#shipZip").value = zip.longText || zip.long_name;
  if (!$("#shipName").value) $("#shipName").focus();
  fetchRates();
}

async function initAddressAutocomplete(){
  const host = $("#addrAutocomplete");
  if (!host || !window.google?.maps?.importLibrary) return;
  try {
    const { PlaceAutocompleteElement } = await google.maps.importLibrary("places");
    const el = new PlaceAutocompleteElement();
    try { el.includedRegionCodes = ["us"]; } catch (_) {}
    el.id = "placeAutocomplete";
    host.appendChild(el);
    host.hidden = false;
    el.addEventListener("gmp-select", async ({ placePrediction }) => {
      try {
        const place = placePrediction.toPlace();
        await place.fetchFields({ fields: ["addressComponents"] });
        if (place.addressComponents) fillAddressFromComponents(place.addressComponents);
      } catch (_) { /* fall back to manual entry */ }
    });
  } catch (_) { /* manual entry still works */ }
}
window.__rgInitMaps = initAddressAutocomplete;

async function loadAddressAutocomplete(){
  if (location.protocol === "file:") return;
  try {
    const res = await fetch("/api/public-config");
    const cfg = await res.json().catch(() => ({}));
    if (!cfg.maps_key) return; // no key → plain manual entry
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(cfg.maps_key)}&libraries=places&callback=__rgInitMaps&loading=async`;
    document.head.appendChild(s);
  } catch (_) { /* manual entry still works */ }
}
loadAddressAutocomplete();

renderSummary();
