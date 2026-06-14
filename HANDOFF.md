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

### Phase 3 — PirateShip fulfillment ✅ DONE
Admin CSV export + fulfillment tracking, verified end-to-end (export, mark-shipped, re-export reflects it, 401 guard, admin UI).
- **DB:** added `checkout_orders.fulfilled_at timestamptz` + `tracking_number text`, plus partial index `idx_checkout_orders_unfulfilled` (status='paid' and fulfilled_at is null). Migration `add_order_fulfillment_tracking` applied; mirrored in `supabase/schema.sql`.
- **`functions/api/admin-export-orders.js`** (GET) — paid + unfulfilled orders → PirateShip-shaped CSV (`text/csv` attachment, `x-order-count` header). Columns: Order Number, Order Date, Recipient Name, Email, Phone, Address 1/2, City, State, Zipcode, Country, Item Description, Item Quantity, Weight (oz), Order Value. **Weight is an ESTIMATE** (`WEIGHT_OZ` = box 16 / pack 2 / default 8 oz) until real per-product weights exist — verify in PirateShip before buying labels.
- **`functions/api/admin-mark-fulfilled.js`** (POST `{order_ids[], tracking_number?, undo?}`) — sets/clears `fulfilled_at` (+ optional tracking) on paid orders via PATCH.
- **`admin-overview.js`** — orders select now includes `ship_*`, `fulfilled_at`, `tracking_number`; totals include `unfulfilled`.
- **Admin UI** (`admin.html`/`admin.js`/`admin.css`) — "Export PirateShip CSV" button (auth'd blob download); order filter defaults to "Paid · to ship" (+ "Shipped"); paid order cards show ship-to address, a To-ship/Shipped badge, and "Mark shipped"/"Undo shipped" buttons (tracking via prompt). New "To ship" metric.

Possible follow-ups: real product weights (column + UI), a bulk "mark all exported as shipped", and storing the ship-from/return address (PirateShip handles ship-from on its side today).

### Phase 4 — Order confirmation emails ✅ DONE (code) — needs Resend key to go live
Branded Resend order-confirmation email, wired into the webhook. Verified: email HTML renders correctly (template preview), webhook module loads, and a signed `checkout.session.completed` event marked an order paid + captured shipping with email gracefully skipped (Resend unconfigured) — no errors.
- **`functions/_lib/email.js`** — `hasResend(env)` gate + `buildOrderEmailHtml(order, env)` (inline-styled, email-client-safe, on-brand: dark header, loot table, totals, ship-to, "Drops drop in Discord first" CTA) + `sendOrderConfirmationEmail(env, order)` (Resend REST, no npm dep).
- **`stripe-webhook.js`** — on the **first** paid transition only (idempotent via `mark_order_paid`'s `already_paid`; Stripe retries safe), fetches the order + items and sends the email **non-blocking via `context.waitUntil`** in a try/catch — it can never delay or fail the webhook ack.
- **Docs:** `.dev.vars.example` + `KEYS_NEEDED.md` document `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, optional `RESEND_LOGO_URL` / `RESEND_HERO_GIF_URL` (the **logo + animated gif** the user wanted — drop in real URLs), and `DISCORD_INVITE_URL`.

**To go live (user action):** verify a sending domain in Resend, set `RESEND_API_KEY` + `RESEND_FROM_EMAIL` (and optional asset URLs + Discord invite) in `.dev.vars` / Cloudflare env, restart Wrangler, then run a real test checkout. Optionally also flip on Stripe automatic receipts (Dashboard → Settings → Customer emails) as a belt-and-suspenders.

### Phase 5 — Email lists, coupons, analytics ✅ DONE
All three sub-features built and verified end-to-end. Migrations `phase5_lists_coupons_email_events` + `phase5_marketing_overview_rpc` applied; mirrored in `supabase/schema.sql`.
- **Two lists, two tables.** `newsletter_subscribers` (opt-in) + `order_recipients` (transactional). RPCs `subscribe_newsletter` (lowercases/trims, clears unsubscribe) and `record_order_recipient` (upsert + `order_count` increment). Wired: checkout checkbox (`#newsletterOptIn`) → `create-checkout-session` opt-in (non-blocking); first paid webhook → `record_order_recipient`. **Verified:** RPCs normalize + increment correctly.
- **Coupons via Stripe promotion codes** (your choice). `POST /api/admin-generate-coupons` creates one Stripe coupon (percent off, `duration=once`) + N promotion codes with `max_redemptions=1` (Stripe enforces single-use), mirrored into `coupons`. `functions/_lib/stripe.js` is the shared form-encoded Stripe helper. Customers redeem on Stripe checkout (`allow_promotion_codes` already on). **Verified:** generated 2 live test-mode codes + DB mirror. Codes are unambiguous (`RG-XXXXXXXX`, no 0/O/1/I).
- **Email analytics.** `POST /api/resend-webhook` verifies Svix signatures (`RESEND_WEBHOOK_SECRET`) and stores events in `email_events`. **Verified:** Svix HMAC matches the official Svix test vector; endpoint 501s without the secret.
- **Admin Marketing panel** (`admin.html`/`admin.js`/`admin.css`) via new `GET /api/admin-marketing`: metrics (newsletter subs, order recipients, delivery/open/bounce rate from `marketing_overview()`), a coupon generator form, and a recent-codes table. **Verified:** renders with live data.

**To go live (user action):** point a Resend webhook at `/api/resend-webhook` and set `RESEND_WEBHOOK_SECRET` for analytics. Coupons + lists work as soon as Stripe/Supabase are configured (already are).

Possible follow-ups: sync coupon redemption back to the `coupons` table (Stripe already enforces single-use, so this is analytics-only), an unsubscribe endpoint/page, and auto-emailing a welcome 10%-off code on newsletter signup.

### Phase 1.5 — Admin dashboard polish (small, do alongside any phase)
The admin dashboard (`admin.html` / `admin.js`, guarded by `ADMIN_TOKEN`) already edits **price / stock / active** per SKU, and those edits now drive the live site. Still missing UI controls for:
- Setting `sale_percent` (add/remove sales)
- Deleting products
- Creating new products
- (Bulk) CSV upload — the Supabase columns are documented; could add an in-dashboard importer.

**CSV columns for bulk upload** — `products`: `id, category, name, set_code, language, badge, tone, symbol, image_label, sale_percent, active`. `product_variants`: `sku (=<id>:pack / <id>:box), product_id, format (pack|box), price_cents, stock_on_hand, active`. (Leave `stock_reserved` / `stock_sold` to the system.)

### Real inventory imported + product images ✅ DONE
The demo catalog was replaced with the real inventory (CSV import). Demo products with order history are kept but `active=false`; the rest were deleted; `test-01` kept.
- **22 real products / 34 variants** across Pokémon (JP + EN Phantasmal Flames), Weiss Schwarz (Hololive), Yu-Gi-Oh QC, One Piece — all JP except Phantasmal Flames. Sell Price → `price_cents`; Original Price → new `product_variants.cost_cents` (margins). Quantities → `stock_on_hand`.
- **New `weiss` category** added to `CATEGORIES` (both `catalog.js` + `functions/_lib/catalog.js`) + `--color-cat-weiss` token.
- **Image support added.** New `products.image_url` / `image_url_pack`; photos live as static assets in `assets/products/` (served by Pages), referenced as `/assets/products/*.png`. `app.js` renders `<img class="card__photo">` (box art ↔ pack art by format) with **automatic fallback to the CSS tile** when there's no photo or it 404s. `/api/catalog` returns `image`/`imagePack`.
- **Single-format products** (pack-only or box-only — e.g. Lost Abyss, OP-05, EB01 loose) now hide the unavailable format toggle and default to the format that exists (new `hasFormat`/`defaultFormat` in `app.js`).
- **Verified** on local wrangler: catalog endpoint, shop grid (photos + tile fallback), per-category views, single-format toggles, live stock labels, cart.

**Excluded for now** (per "box/pack only" decision): Phantasmal Flames **Blisters (qty 20)** and **3-Pack (qty 1)** — the schema only allows `pack`/`box`. Re-add once formats are extended. Products with **no photo** (tiles): QC Edition red, OP-05/OP-09/OP-01, Phantasmal Flames. The zip also contains art for sets not in the current CSV (EB03/04, OP10/12/14, Mega Dream, Nihil Zero, PRB02, QC Rarity) — available when those come in stock.

Follow-up fixes: the CSS tile was painting over photos (`.pack-mock{display:flex}` beat the `hidden` attr) — fixed with `.pack-mock[hidden]{display:none}`. The internal "(loose)" products were merged away (no customer-facing "(loose)"): OP-05/OP-09 gained the loose box as their box variant; EB01/OP-07 absorbed the single loose box into stock.

### TikTok username capture + order fulfillment stages ✅ DONE
- **TikTok username** captured at checkout (required field, `#tiktokUsername`), stored on `checkout_orders.tiktok_username` (PATCH after reservation; also in Stripe metadata as backup). Shown as a chip on the dashboard order card and added as a **TikTok Username** column in the PirateShip CSV (so you can call buyers out on live without revealing their name).
- **Order stages** via `checkout_orders.stage` (`new` → `opened_live` → `resolved` → `shipped`; default `new`). Dashboard stack is newest-first with a stage filter ("To ship · all / New / Opened live / Resolved", "Shipped"). Each paid/unshipped card has **Opened live / Resolved / ↺ New / Mark shipped** buttons. `new POST /api/admin-set-order-stage` handles the pre-ship moves; `admin-mark-fulfilled` sets `stage='shipped'` (+ `fulfilled_at`/tracking) and `'resolved'` on undo. Export still keys on `fulfilled_at`, so stages don't disturb the PirateShip flow.
- **Verified** on local wrangler: stage transitions, invalid-stage guard, mark shipped, CSV TikTok column + row, admin card (chip + badge + buttons), shop image fix + no "(loose)" names.

### Phase 6 (NEXT) — dynamic shipping (decided: **Shippo**)
Cheapest path: **Shippo** (no monthly fee, free rating API, pay-per-label; can attach own carrier accounts). Plan: add `weight_oz` per variant, quote live USPS rates at checkout from cart weight + destination, fall back to flat weight-tiers if the API is down. Then **bundling** (merge same-buyer paid+unshipped orders in the dashboard, refund excess shipping — never ship unpaid) and **weight variance** at fulfillment (Sealed / All cards / Hits-only ~3oz; charge sealed weight at checkout, pick actual mode when shipping). **Editable email template** deferred until the email design is locked.

---

## 5. Gotchas for the next session
- **Restart Wrangler after `.dev.vars` changes** — env is read only at startup.
- **Keep the Stripe listener running**; its `whsec_` is ephemeral.
- **Any product change should ideally go through Supabase now**, not the JS catalogs. If you do edit JS catalogs, they're fallback-only and won't match Supabase.
- **Never `git commit` from `/Users/pantheon/Downloads`** (that repo contains personal files). Commit only inside the project repo.
- When testing checkout, you create pending orders that hold stock; release with `release_order_reservation(order_id)` or let them expire (30 min). Reset the test product with: `update product_variants set stock_on_hand=100, stock_reserved=0, stock_sold=0 where product_id='test-01';`
- Stripe minimum charge is 50¢ USD.
