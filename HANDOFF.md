# R&G TCG — Session Handoff

_Last updated: 2026-06-13. Hand this to a new session to continue the build._

R&G TCG is an online store selling **sealed TCG product** (Pokémon, One Piece, Yu-Gi-Oh!, Magic, Lorcana) in English / Japanese / Chinese. This document captures the architecture, everything changed so far, and the remaining roadmap.

---

## 1. Stack & how to run it locally

| Layer | Tech |
|---|---|
| Frontend | Static HTML/CSS/JS (no framework) |
| Backend | Cloudflare Pages Functions (`functions/api/*`), run via Wrangler |
| Database | Supabase Postgres — project ref **`eybplzqytavihdzkcolt`** ("andrewsegovia00's Project", **free tier**) |
| Payments | Stripe Checkout (hosted), **test mode**, inline `price_data` (no Stripe product catalog) |

### Start the local environment (3 processes)

```bash
# 1. Dev server (serves site + API at http://localhost:8788)
cd /Users/pantheon/Downloads/rg-tcg-complete-mvp
npx wrangler pages dev . --compatibility-date=2025-08-01 --port 8788

# 2. Stripe webhook listener (forwards events to the local webhook).
#    Native binary (npx wrapper exits silently — call the binary directly):
~/.npm/_npx/0e3ca1c6983ec29f/node_modules/@stripe/cli-darwin-arm64/bin/stripe listen \
  --forward-to localhost:8788/api/stripe-webhook \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired,checkout.session.async_payment_failed
```

- The listener prints a `whsec_…` signing secret **valid only while it runs**. If you restart it, paste the new secret into `STRIPE_WEBHOOK_SECRET` in `.dev.vars` and **restart Wrangler** (it reads env only at startup).
- Test card: **`4242 4242 4242 4242`**, any future expiry / CVC / ZIP.
- A 50¢ test product (`test-01`, "TEST — Do Not Ship") exists for payment testing; it appears under the Pokémon filter. Note: 50¢ item + $5 standard shipping = $5.50 total (free shipping only over $75).

### Secrets — `.dev.vars` (gitignored, never commit)
```
STRIPE_SECRET_KEY=sk_test_…          # set
STRIPE_WEBHOOK_SECRET=whsec_…        # from `stripe listen`, ephemeral
SITE_URL=http://localhost:8788
SUPABASE_URL=https://eybplzqytavihdzkcolt.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_…   # secret key (NOT sb_publishable_)
ADMIN_TOKEN=<long random>            # protects the admin dashboard
```

---

## 2. CRITICAL architecture note — three catalog sources

Product data historically lived in **three** places:
1. `catalog.js` — client storefront list
2. `functions/_lib/catalog.js` — server-side trusted prices at checkout
3. Supabase `products` + `product_variants` — inventory + orders

**As of Phase 1, Supabase is the source of truth.** The storefront fetches `/api/catalog` on boot and checkout prices from the reservation RPC. The two JS catalogs now serve only as **offline fallbacks** if Supabase is unreachable. When adding products going forward, prefer Supabase (admin dashboard or CSV) — you no longer need to edit the JS files for normal catalog changes.

Access Supabase via the **Supabase MCP** (`mcp__plugin_supabase_supabase__*`) — `apply_migration` for DDL, `execute_sql` for data, project_id `eybplzqytavihdzkcolt`.

---

## 3. What was done this session

### Bug fix (checkout was 100% broken)
`create-checkout-session.js` sent the cart with camelCase `productId`, but the reservation RPC reads snake_case `product_id` → every order failed *"A product in your chest is no longer available."* Fixed by remapping keys before the RPC call.

### Phase 1 — Supabase as catalog source (commit `f1c1b93`)
- **New** `functions/api/catalog.js` — serves `{categories, languages, products}` from Supabase in the exact client shape; falls back to the in-code catalog on error.
- `catalog.js` — added `hydrateCatalogFromServer()` that fetches `/api/catalog` and replaces the `PRODUCTS` array contents in place.
- `app.js` — boot now: instant render from fallback → hydrate from Supabase → re-render → refresh stock.
- `create-checkout-session.js` — builds Stripe line items from the reservation RPC's authoritative `lines`, so **displayed price == charged price**. Static catalog path kept for the no-Supabase fallback.
- Supabase: added `products.sale_percent` column (0–90) for discounts.
- **Verified:** changing a price in Supabase changed both `/api/catalog` output and the real Stripe `amount_subtotal`.

### Phase 2 — Checkout address fix (commit `0edb30b`)
- `checkout.html` — removed the 6 dead name/address inputs (Stripe-hosted checkout collects these and **cannot be prefilled**, so they caused double entry). Replaced with an explanatory note. The email field is real and is passed to Stripe as `customer_email`.
- Supabase: added `checkout_orders.ship_name / ship_phone / ship_line1 / ship_line2 / ship_city / ship_state / ship_postal_code / ship_country`.
- `mark_order_paid` RPC — new `p_shipping jsonb` param writes those columns (backward-compatible default).
- `stripe-webhook.js` — `extractShipping(session)` pulls the address across Stripe API-version field names (`shipping_details` / `shipping` / `customer_details.address`) and passes it to the RPC.
- **Verified:** a simulated paid webhook stored a full address into all 8 columns.
- `supabase/schema.sql` + `seed.sql` updated to match the live DB (so fresh deploys are correct).

### Git
The project now has its **own repo** at the project directory (it previously had none; the only git was the Downloads-wide repo — **do NOT commit there**, it contains personal files). `.dev.vars`, `node_modules/`, `.wrangler/` are gitignored.

---

## 4. Roadmap — what to build next

### Phase 3 — PirateShip fulfillment (NEXT; user was choosing approach)
Paid orders now carry full shipping addresses (`ship_*` columns). Build an **admin "Export paid/unfulfilled orders → CSV"** in PirateShip's bulk-import column format (recipient name, full address, item summary, weight placeholder). User leaned toward **CSV export** over a direct API integration (PirateShip's API is limited/approval-gated). Suggested addition: a `fulfilled_at` / fulfillment status column so exported orders can be marked shipped.

### Phase 4 — Order confirmation emails
- **Quick win (no code):** enable Stripe automatic receipts — Stripe Dashboard → Settings → Customer emails → "Successful payments."
- **Branded email:** integrate **Resend** (the README already anticipates `RESEND_API_KEY` / `RESEND_FROM_EMAIL`). Send a branded "R&G TCG order confirmed" email from the webhook on `mark_order_paid`. User wants **logo + animated gifs/images** in the email.

### Phase 5 — Email lists, coupons, analytics
- **Two separate lists** (separate Supabase tables): (1) order/product-confirmation recipients, (2) newsletter subscribers. The checkout already has a "Email me drop codes & new arrivals" checkbox to wire up for the newsletter opt-in.
- **10%-off-first-order coupon:** randomly generated **single-use** codes (one redemption each). Needs a `coupons` table (code, discount, used_at, order_id) and validation in checkout — likely via Stripe promotion codes or a custom discount applied to line items. Checkout already sends `allow_promotion_codes=true` to Stripe.
- **Email analytics:** open rate, delivery rate, bounce rate — capture via **Resend webhooks** into a Supabase table.

### Phase 1.5 — Admin dashboard polish (small, do alongside any phase)
The admin dashboard (`admin.html` / `admin.js`, guarded by `ADMIN_TOKEN`) already edits **price / stock / active** per SKU, and those edits now drive the live site. Still missing UI controls for:
- Setting `sale_percent` (add/remove sales)
- Deleting products
- Creating new products
- (Bulk) CSV upload — the Supabase columns are documented; could add an in-dashboard importer.

**CSV columns for bulk upload** — `products`: `id, category, name, set_code, language, badge, tone, symbol, image_label, sale_percent, active`. `product_variants`: `sku (=<id>:pack / <id>:box), product_id, format (pack|box), price_cents, stock_on_hand, active`. (Leave `stock_reserved` / `stock_sold` to the system.)

### Known limitation — product images
There is **no image support** yet: cards render as CSS tiles from `tone` (color) + `symbol` (glyph) + `set_code`. Real photos need: an `image_url` column on `products`, `<img>` rendering in `app.js`, and hosting (Supabase Storage, 1GB free, is the natural fit).

---

## 5. Gotchas for the next session
- **Restart Wrangler after `.dev.vars` changes** — env is read only at startup.
- **Keep the Stripe listener running**; its `whsec_` is ephemeral.
- **Any product change should ideally go through Supabase now**, not the JS catalogs. If you do edit JS catalogs, they're fallback-only and won't match Supabase.
- **Never `git commit` from `/Users/pantheon/Downloads`** (that repo contains personal files). Commit only inside the project repo.
- When testing checkout, you create pending orders that hold stock; release with `release_order_reservation(order_id)` or let them expire (30 min). Reset the test product with: `update product_variants set stock_on_hand=100, stock_reserved=0, stock_sold=0 where product_id='test-01';`
- Stripe minimum charge is 50¢ USD.
