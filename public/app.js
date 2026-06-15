/* ============================================================================
   R&G TCG — SHOP INTERACTION
   Block 7: Supabase-backed inventory overlay + existing chest/cart UX.
   ============================================================================ */
let activeCat = "all";
let activeLanguage = "all";
let activeFilter = "all";
let search = "";
let cart = loadCart(); // [{productId, format:"pack"|"box", quantity}]
const cardFormat = {};
let inventoryOverlay = {}; // productId -> { pack: available, box: available }
const FREE_SHIPPING_THRESHOLD = 200;
// Product card add-button style — flip this to decide which you prefer:
//   "plus" = compact square "+"   |   "text" = full-width "Add to Chest"
const ADD_BUTTON_STYLE = "plus";

const $ = s => document.querySelector(s);
function availableFor(p, fmt = cardFormat[p.id] || defaultFormat(p)){
  const live = inventoryOverlay[p.id]?.[fmt];
  return Number.isFinite(live) ? live : p.stock;
}
const stockClass = p => availableFor(p) === 0 ? "out" : availableFor(p) <= 5 ? "low" : "in";
const stockLabel = p => availableFor(p) === 0 ? "Sold out" : availableFor(p) <= 5 ? `Only ${availableFor(p)} left` : `${availableFor(p)} in stock`;
// Product photo for the current format (box art ↔ pack art), with fallback to
// whichever image exists. Returns null when there's no photo (CSS tile shows).
const artFor = (p, fmt) => (fmt === "box" ? (p.image || p.imagePack) : (p.imagePack || p.image)) || null;
// Some products sell in only one format (pack-only or box-only). Treat a format
// as available only when it has a price; default to whichever format exists.
const hasFormat = (p, fmt) => (fmt === "box" ? p.boxPrice : p.packPrice) != null;
const defaultFormat = p => (hasFormat(p, "pack") ? "pack" : "box");

function loadCart(){
  try {
    const raw = localStorage.getItem("rg_tcg_cart");
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(l => productById(l.productId)) : [];
  } catch (_) {
    return [];
  }
}
function saveCart(){
  localStorage.setItem("rg_tcg_cart", JSON.stringify(cart));
}

/* ==========================================================================
   FILTER RAIL
   ========================================================================== */
function renderCatalogbar(){
  const bar = $("#catalogbar");
  bar.innerHTML = `
    <div class="filter-group">
      <div class="filter-label">Game</div>
      <div class="filter-pills">
        ${CATEGORIES.map(c => `
          <button class="filter-pill ${c.id===activeCat?'is-active':''}" data-cat="${c.id}" style="--pill:${c.accent}">
            ${c.label}
          </button>`).join("")}
      </div>
    </div>
    <div class="filter-group filter-group--language">
      <div class="filter-label">Language</div>
      <div class="filter-pills">
        ${LANGUAGES.map(l => `
          <button class="filter-pill filter-pill--language ${l.id===activeLanguage?'is-active':''}" data-lang="${l.id}">
            ${l.label}
          </button>`).join("")}
      </div>
    </div>`;

  // Update active state in place (don't rebuild the bar) so the horizontal scroll
  // position of the pill rail is preserved — otherwise the selected pill scrolls
  // out of view and it looks like the choice reverted to the first option.
  bar.querySelectorAll("[data-cat]").forEach(b => {
    b.onclick = () => {
      activeCat = b.dataset.cat;
      bar.querySelectorAll("[data-cat]").forEach(x => x.classList.toggle("is-active", x === b));
      renderGrid();
    };
  });
  bar.querySelectorAll("[data-lang]").forEach(b => {
    b.onclick = () => {
      activeLanguage = b.dataset.lang;
      bar.querySelectorAll("[data-lang]").forEach(x => x.classList.toggle("is-active", x === b));
      renderGrid();
    };
  });
}

/* ==========================================================================
   PRODUCT GRID
   ========================================================================== */
function filteredProducts(){
  const q = search.trim().toLowerCase();
  return PRODUCTS.filter(p => {
    if (activeCat !== "all" && p.category !== activeCat) return false;
    if (activeLanguage !== "all" && p.language !== activeLanguage) return false;
    if (activeFilter === "new"     && p.badge !== "NEW") return false;
    if (activeFilter === "sale"    && !p.sale) return false;
    if (activeFilter === "instock" && availableFor(p) === 0) return false;
    if (q && !(`${p.name} ${p.set} ${p.category} ${p.language}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function renderGrid(){
  const title = activeCat === "all" ? "All Games" : categoryById(activeCat).label;
  const languageTail = activeLanguage === "all" ? "" : ` · ${languageLabel(activeLanguage)}`;
  $("#catTitle").textContent = title + languageTail;

  const list = filteredProducts();
  $("#resultCount").textContent = list.length + (list.length === 1 ? " product" : " products");

  const grid = $("#grid");
  if (!list.length){
    grid.innerHTML = `<div class="empty"><div class="empty__mark">∅</div><div class="empty__title">No matches here</div><div class="empty__copy">Try a different game, language, or filter.</div></div>`;
    return;
  }

  grid.innerHTML = list.map(p => {
    const fmt = cardFormat[p.id] || defaultFormat(p);
    const out = availableFor(p, fmt) === 0;
    const price = unitPrice(p, fmt);
    const base = fmt === "box" ? p.boxPrice : p.packPrice;
    const lang = languageShort(p.language);
    const cat = categoryShort(p.category);
    return `
    <article class="card ${out?'is-out':''}" data-id="${p.id}" draggable="${!out}" aria-label="${p.name}">
      <div class="card__art" style="--tone:${p.tone}" draggable="false" data-id="${p.id}">
        ${p.badge ? `<span class="card__badge is-${String(p.badge).toLowerCase()}">${p.badge}</span>` : ""}
        ${p.sale ? `<span class="card__sale">-${p.sale}%</span>` : ""}
        ${out ? `<span class="sold-stamp">Sold<br>out</span>` : ""}
        ${artFor(p, fmt) ? `<img class="card__photo" src="${artFor(p, fmt)}" alt="${p.name}" loading="lazy" draggable="false" onerror="this.remove();this.closest('.card__art').querySelector('.pack-mock').hidden=false">` : ""}
        <div class="pack-mock"${artFor(p, fmt) ? " hidden" : ""}>
          <div class="pack-mock__top"></div>
          <div class="pack-mock__label">${p.set}</div>
          <div class="pack-mock__symbol">${p.symbol}</div>
          <div class="pack-mock__foot">Booster · ${fmt === "box" ? "box" : "10 cards"}</div>
        </div>
        ${hasFormat(p,'pack') && hasFormat(p,'box') ? `<div class="seg" data-id="${p.id}">
          <button class="${fmt==='pack'?'on':''}" data-fmt="pack">Pack</button>
          <button class="${fmt==='box'?'on':''}" data-fmt="box">Box</button>
        </div>` : ""}
        ${!out ? `<span class="card__grab">drag</span>` : ""}
      </div>
      <div class="card__body">
        <div class="card__set"><span>${cat}</span><span>·</span><span>${lang}</span><span>·</span><span>${p.set}</span></div>
        <div class="card__name">${p.name}</div>
        <div class="card__foot">
          <div class="card__price">${formatMoney(price)}${p.sale?`<span class="was">${formatMoney(base)}</span>`:""}<span class="per">/${fmt}</span></div>
        </div>
        <div class="card__foot card__foot--action">
          ${out
            ? `<span class="stock out"><span class="dot"></span>Sold out</span><button class="add-plus" data-add="${p.id}" disabled aria-label="Sold out">+</button>`
            : (ADD_BUTTON_STYLE === "plus"
                ? `<span class="stock ${stockClass(p)}"><span class="dot"></span>${stockLabel(p)}</span><button class="add-plus" data-add="${p.id}" aria-label="Add ${p.name} to chest">+</button>`
                : `<button class="add-btn" data-add="${p.id}">Add to Chest</button>`)}
        </div>
        ${(!out && ADD_BUTTON_STYLE === "text") ? `<span class="stock ${stockClass(p)}" style="margin-top:6px"><span class="dot"></span>${stockLabel(p)}</span>` : ""}
      </div>
    </article>`;
  }).join("");

  grid.querySelectorAll(".seg button").forEach(b =>
    b.onclick = e => { e.stopPropagation(); cardFormat[b.parentElement.dataset.id] = b.dataset.fmt; renderGrid(); });
  grid.querySelectorAll("[data-add]").forEach(b =>
    b.onclick = () => { if (b.disabled) return; addToCart(b.dataset.add, cardFormat[b.dataset.add]||defaultFormat(productById(b.dataset.add)), 1, b); });
  grid.querySelectorAll(".card[draggable='true']").forEach(card => {
    card.addEventListener("dragstart", e => {
      const id = card.dataset.id;
      e.dataTransfer.setData("text/plain", JSON.stringify({productId:id, format:cardFormat[id]||defaultFormat(productById(id)), quantity:1}));
      e.dataTransfer.effectAllowed = "copy";
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
  });
  grid.querySelectorAll(".card").forEach(card =>
    card.addEventListener("dblclick", () => openModal(card.dataset.id)));
}

/* ==========================================================================
   CHEST / CART
   ========================================================================== */
function totals(){
  let items=0, sum=0;
  cart.forEach(l => {
    const p = productById(l.productId);
    if (!p) return;
    items += l.quantity;
    sum += unitPrice(p,l.format) * l.quantity;
  });
  return {items, sum:+sum.toFixed(2)};
}


function renderChestVisual(items){
  // Pouch chest (from chest-pouch-preview): up to 5 category slabs + a "+N" overflow slab.
  const visible = cart.slice(0,5).map(l => {
    const p = productById(l.productId);
    const accent = categoryById(p.category)?.accent || p.tone;
    return `<div class="slab" style="background:${accent}"><span>${categoryShort(p.category)}</span></div>`;
  }).join("");
  const overflow = cart.length > 5
    ? `<div class="slab" style="background:var(--color-ink)"><span>+${cart.length-5}</span></div>`
    : "";

  return `
    <div class="chest__drop">
      <div class="pouch ${items ? "is-filled" : ""}" aria-hidden="true">
        <div class="pouch__shadow"></div>
        <div class="pouch__back"></div>
        <div class="slabs">${visible}${overflow}</div>
        <div class="pouch__front">
          <div class="window">
            <div class="window__brand">R&amp;G TCG</div>
            <div class="window__state">${items ? "loot loaded" : "drag items here"}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderBag(){
  const {items, sum} = totals();
  const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD - sum);
  const progress = Math.min(100, Math.round((sum / FREE_SHIPPING_THRESHOLD) * 100));
  const subtotalText = formatMoney(sum);

  $("#bagCountNum").textContent = items;
  $("#bagCount").textContent = items === 1 ? "item" : "items";
  $("#headerCount").textContent = items;
  const headerTotal = $("#headerCartTotal"); if (headerTotal) headerTotal.textContent = subtotalText;

  const inner = $("#bagInner");
  const prevScroll = inner.querySelector(".chest__scroll")?.scrollTop || 0;   // preserve position on re-render
  const dropZone = renderChestVisual(items);

  if (!cart.length){
    inner.innerHTML = `
      <div class="chest__scroll">
        <div class="chest__empty">
          ${dropZone}
          <div class="chest__empty-copy">Add sealed product to unlock checkout.</div>
        </div>
      </div>`;
    return;
  }

  // FREE-SHIPPING METER NOW LIVES AT THE TOP, under "The Chest / X items"
  const meter = `
    <div class="chest__topmeter">
      <div class="ship-meter" style="--ship-progress:${progress}%">
        <div class="ship-meter__top"><span>${sum >= FREE_SHIPPING_THRESHOLD ? "Free shipping unlocked" : formatMoney(remaining) + " to free shipping"}</span><span>${progress}%</span></div>
        <div class="ship-meter__track"><div class="ship-meter__bar"></div></div>
      </div>
    </div>`;

  inner.innerHTML = `
    ${meter}
    <div class="chest__scroll">
      ${dropZone}
      <div class="loot-list">
        ${cart.map((l,i) => {
          const p = productById(l.productId);
          const each = unitPrice(p,l.format);
          const line = each * l.quantity;
          const atMax = l.quantity >= availableFor(p, l.format);
          return `<div class="loot-line" data-language="${p.language}">
            <span class="loot-line__dot"></span>
            <div class="loot-line__main">
              <div class="loot-line__badges"><span>${categoryShort(p.category)}</span><span>${l.format==='box'?'BOX':'PACK'}</span><span>${languageShort(p.language)}</span></div>
              <div class="loot-line__name">${p.name}</div>
              <div class="loot-line__set">${p.set} · ${formatMoney(each)} ea</div>
            </div>
            <div class="qty"><button data-i="${i}" data-d="-1" aria-label="Decrease quantity">−</button><span>${l.quantity}</span><button data-i="${i}" data-d="1" ${atMax?'disabled':''} aria-label="Increase quantity">+</button></div>
            <strong class="loot-line__price">${formatMoney(line)}</strong>
            <button class="loot-line__rm" data-rm="${i}" aria-label="Remove ${p.name}">×</button>
          </div>`;
        }).join("")}
      </div>
    </div>
    <div class="bounty">
      <div class="bounty__row"><span>Bounty</span><strong>${subtotalText}</strong></div>
      <button class="checkout-sail" id="checkoutBtn">Set sail · Checkout<span class="cs-total"> · ${subtotalText}</span> <span class="cs-arrow">→</span></button>
      <div class="checkout-pay-note">Pay with <strong>stripe</strong> | Apple Pay</div>
    </div>`;

  // restore scroll position so adding/incrementing doesn't jump you to the top
  const scroller = inner.querySelector(".chest__scroll");
  if (scroller) scroller.scrollTop = prevScroll;

  inner.querySelectorAll(".qty button").forEach(b =>
    b.onclick = () => updateQty(+b.dataset.i, cart[+b.dataset.i].quantity + (+b.dataset.d)));
  inner.querySelectorAll(".loot-line__rm").forEach(b =>
    b.onclick = () => { cart.splice(+b.dataset.rm,1); saveCart(); renderBag(); });
  const co = $("#checkoutBtn");
  if (co) co.onclick = () => { saveCart(); window.location.href = "checkout.html"; };
}

function addToCart(id, format="pack", qty=1, fromEl){
  const p = productById(id);
  if (!p) return;
  const cap = availableFor(p, format);          // check the format being added, not the card default
  if (cap <= 0) return;
  const idx = cart.findIndex(l => l.productId===id && l.format===format);
  const current = idx >= 0 ? cart[idx].quantity : 0;
  // Already holding all available stock — do nothing (no count change, and no
  // misleading fly-to-chest animation).
  if (current >= cap) return;
  if (idx>=0) cart[idx].quantity = Math.min(current + qty, cap);
  else cart.push({productId:id, format, quantity:Math.min(Math.max(1, qty), cap)});
  saveCart();
  pulseBag();
  if (fromEl) flyToBag(fromEl, p);
  renderBag();
  bumpHeaderCart();
  flashChest();
  showAddToast();
}
function updateQty(i, q){
  if(q<=0){ cart.splice(i,1); }
  else {
    const line = cart[i];
    const p = productById(line.productId);
    const max = p ? Math.max(1, availableFor(p, line.format)) : q;
    cart[i].quantity = Math.min(q, max);
  }
  saveCart();
  renderBag();
}
function pulseBag(){ const b=$("#bag"); b.classList.remove("pulse"); void b.offsetWidth; b.classList.add("pulse"); }
function bumpHeaderCart(){ const h=$("#headerCart"); if(!h) return; h.classList.remove("bump"); void h.offsetWidth; h.classList.add("bump"); }
function flashChest(){ const b=$("#bag"); if(!b) return; b.classList.remove("flash"); void b.offsetWidth; b.classList.add("flash"); }
let _addToastEl;
function showAddToast(){
  if(!_addToastEl){ _addToastEl = document.createElement("div"); _addToastEl.className = "add-toast"; document.body.appendChild(_addToastEl); }
  _addToastEl.textContent = "✓ Added to chest";
  _addToastEl.classList.remove("show"); void _addToastEl.offsetWidth; _addToastEl.classList.add("show");
  clearTimeout(_addToastEl._t); _addToastEl._t = setTimeout(() => _addToastEl.classList.remove("show"), 1100);
}
// Mobile: the chest is collapsed by default — tapping its head expands the loot.
(function setupChestToggle(){
  const head = $("#chestHead");
  if(!head) return;
  const toggle = () => {
    const open = $("#bag").classList.toggle("is-open");
    head.setAttribute("aria-expanded", open ? "true" : "false");
  };
  head.addEventListener("click", toggle);
  head.addEventListener("keydown", e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); toggle(); } });
})();
function flyToBag(fromEl, p){
  const start = fromEl.getBoundingClientRect();
  const bag = $("#bag").getBoundingClientRect();
  const chip = document.createElement("div");
  chip.className = "fly"; chip.textContent = p.symbol;
  chip.style.background = p.tone;
  chip.style.left = start.left + start.width/2 - 20 + "px";
  chip.style.top  = start.top  + "px";
  document.body.appendChild(chip);
  requestAnimationFrame(() => {
    chip.style.transition = "transform .55s var(--ease-standard), opacity .55s";
    const dx = bag.left + bag.width/2 - (start.left + start.width/2);
    const dy = bag.top + 70 - start.top;
    chip.style.transform = `translate(${dx}px,${dy}px) scale(.4) rotate(20deg)`;
    chip.style.opacity = "0";
  });
  setTimeout(() => chip.remove(), 600);
}

const bagEl = $("#bag");
bagEl.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect="copy"; });
bagEl.addEventListener("dragenter", e => { e.preventDefault(); bagEl.classList.add("is-over"); });
bagEl.addEventListener("dragleave", e => { if(!bagEl.contains(e.relatedTarget)) bagEl.classList.remove("is-over"); });
bagEl.addEventListener("drop", e => {
  e.preventDefault(); bagEl.classList.remove("is-over");
  try { const d = JSON.parse(e.dataTransfer.getData("text/plain")); if(d&&d.productId) addToCart(d.productId, d.format, d.quantity); } catch(_){}
});

/* ==========================================================================
   MODAL — double-click a card
   ========================================================================== */
let modalState = null;
function openModal(id){
  const p = productById(id); if(!p || availableFor(p) === 0) return;
  modalState = { id, format: cardFormat[id]||defaultFormat(productById(id)), qty:1 };
  drawModal(); $("#overlay").classList.add("open");
}
function drawModal(){
  const p = productById(modalState.id);
  const m = $("#modal");
  const price = unitPrice(p, modalState.format);
  m.innerHTML = `
    <button class="modal__close" id="mClose">×</button>
    <div class="modal__art" style="--tone:${p.tone}">
      ${artFor(p, modalState.format) ? `<img class="card__photo" src="${artFor(p, modalState.format)}" alt="${p.name}" draggable="false" onerror="this.remove();this.closest('.modal__art').querySelector('.pack-mock').hidden=false">` : ""}
      <div class="pack-mock pack-mock--modal"${artFor(p, modalState.format) ? " hidden" : ""}><div class="pack-mock__top"></div><div class="pack-mock__label">${p.set}</div><div class="pack-mock__symbol">${p.symbol}</div><div class="pack-mock__foot">${languageShort(p.language)} · ${categoryShort(p.category)}</div></div>
    </div>
    <div class="modal__body">
      <div class="modal__set">${categoryById(p.category).label} · ${languageLabel(p.language)} · ${p.set}</div>
      <div class="modal__name">${p.name}</div>
      <div class="modal__row">
        <span class="modal__lab">Format</span>
        <div class="seg">
          ${hasFormat(p,'pack') ? `<button class="${modalState.format==='pack'?'on':''}" data-mfmt="pack">Pack · ${formatMoney(unitPrice(p,'pack'))}</button>` : ""}
          ${hasFormat(p,'box') ? `<button class="${modalState.format==='box'?'on':''}" data-mfmt="box">Box · ${formatMoney(unitPrice(p,'box'))}</button>` : ""}
        </div>
      </div>
      <div class="modal__row">
        <span class="modal__lab">Quantity</span>
        <div class="qty"><button data-mq="-1">−</button><span>${modalState.qty}</span><button data-mq="1">+</button></div>
      </div>
      <button class="btn btn--primary btn--block btn--lg" id="mAdd">Add ${modalState.qty} to chest · ${formatMoney(price*modalState.qty)}</button>
    </div>`;
  $("#mClose").onclick = closeModal;
  m.querySelectorAll("[data-mfmt]").forEach(b => b.onclick = () => { modalState.format=b.dataset.mfmt; modalState.qty = Math.min(modalState.qty, Math.max(1, availableFor(p, modalState.format))); drawModal(); });
  m.querySelectorAll("[data-mq]").forEach(b => b.onclick = () => { modalState.qty=Math.max(1, Math.min(availableFor(p, modalState.format), modalState.qty + +b.dataset.mq)); drawModal(); });
  $("#mAdd").onclick = () => { addToCart(modalState.id, modalState.format, modalState.qty); closeModal(); };
}
function closeModal(){ $("#overlay").classList.remove("open"); }
$("#overlay").addEventListener("click", e => { if(e.target.id==="overlay") closeModal(); });
document.addEventListener("keydown", e => { if(e.key==="Escape") closeModal(); });

function showSetSailConfirm(){
  const m = $("#modal");
  m.innerHTML = `
    <div class="confirm">
      <div class="confirm__title">Ready to set sail?</div>
      <div class="confirm__copy">Take your chest to checkout and complete your order.</div>
      <div class="confirm__actions">
        <button class="btn" id="sailNo">Not yet</button>
        <button class="btn btn--primary" id="sailYes">Yes, checkout →</button>
      </div>
    </div>`;
  $("#overlay").classList.add("open");
  $("#sailNo").onclick = closeModal;
  $("#sailYes").onclick = () => { saveCart(); window.location.href = "checkout.html"; };
}

$("#headerCart").addEventListener("click", e => {
  e.preventDefault();
  if (!cart.length){ $("#bag").scrollIntoView({behavior:"smooth", block:"center"}); return; }
  showSetSailConfirm();
});
const searchEl = $("#search"); if (searchEl) searchEl.addEventListener("input", e => { search = e.target.value; renderGrid(); });
$("#filters").querySelectorAll(".chip").forEach(c =>
  c.onclick = () => { activeFilter=c.dataset.f; $("#filters").querySelectorAll(".chip").forEach(x=>x.classList.toggle("is-on", x===c)); renderGrid(); });

function renderAll(){ renderCatalogbar(); renderGrid(); }

async function refreshInventory(){
  if (location.protocol === "file:") return;
  try {
    const response = await fetch("/api/inventory", { headers: { accept: "application/json" }, cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    const next = {};
    (data.variants || []).forEach(v => {
      if (!next[v.product_id]) next[v.product_id] = {};
      next[v.product_id][v.format] = Number(v.available || 0);
    });
    inventoryOverlay = next;
    renderAll();
  } catch (_) {
    // Static catalog remains the fallback if the API is unavailable.
  }
}

renderAll();   // instant first paint from the static fallback catalog
renderBag();
// Replace the catalog with the live Supabase data, then refresh stock overlay.
hydrateCatalogFromServer().then(changed => {
  if (changed) renderAll();
  refreshInventory();
});

// Admin link stays hidden in the navbar unless this browser has logged into admin.
try {
  if (localStorage.getItem("rg_admin_token")) {
    const adminNav = document.getElementById("adminNav");
    if (adminNav) adminNav.hidden = false;
  }
} catch (_) {}
