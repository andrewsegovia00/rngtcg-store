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
#    Static site lives in ./public (set as pages_build_output_dir in wrangler.toml);
#    do NOT pass a positional dir or it overrides the config. Functions are in ./functions.
cd /Users/pantheon/Downloads/rg-tcg-complete-mvp
npx wrangler pages dev --compatibility-date=2025-08-01 --port 8788

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
- **Order stages** — the original `stage` enum was **replaced by a tag model** (see next section). `admin-set-order-stage` was removed.

### Newsletter welcome coupon + first-visit popup ✅ DONE
- **`POST /api/newsletter-signup`** (public): subscribe → mint ONE single-use 10%-off Stripe promo code (`_lib/coupons.js` `createSingleUseCoupon`) → email it (`_lib/email.js` `sendWelcomeEmail`). One welcome code per email (tracked in `newsletter_subscribers.welcome_coupon_code`) so re-submitting can't farm codes. Degrades: no Stripe = no code; no Resend = code returned in the response so the popup still shows it.
- **First-visit popup** (`newsletter.js` + `.news-pop` styles, included on `index.html` + `landing.html`): shows once per browser (localStorage `rg_news_seen`), posts the email, shows the code / "check your email". Verified end-to-end (signup → coupon in DB linked to subscriber → dedup → modal success state).

### Order tag workflow + coupons page ✅ DONE (this session)
- **Tag model** replaces the stage enum. `checkout_orders.order_tag` (`sealed` | `open_live`) + `ready_to_ship` bool. On order creation (`create-checkout-session`): a TikTok/preferred name → `open_live` + `ready_to_ship=false` (must be opened on stream first); no name → `sealed` + `ready_to_ship=true` (ships as-is). `POST /api/admin-update-order` (bulk-capable) sets tag / ready (setting a tag auto-defaults ready). `admin-mark-fulfilled` still ships. **Export now keys on `ready_to_ship=true && !fulfilled_at`** so open-live orders aren't exported until opened+marked ready.
- **Admin Orders**: filter "To open · live / Ready to ship / Shipped / All unshipped / …", per-order **tag dropdown** + **Mark ready to ship** + **Mark shipped**, checkboxes + a **bulk bar** (Mark ready / Mark shipped / Tag sealed / Tag open live). Verified all on wrangler.
- **TikTok / preferred name is now OPTIONAL; email is required.** (`checkout.js` validates email; the name only drives the tag.)
- **CSV** order value split into **Item Total (USD)** and **Shipping Paid (USD)** (tax is collected by Stripe, not stored here).
- **Coupons moved to a dedicated page** `coupons.html`/`coupons.js` (token-gated, shares admin token): generate + list + **delete** (`POST /api/admin-delete-coupon` deactivates the Stripe promo code, then removes the DB row). The generator was **removed from the main admin** (Marketing panel keeps only list/email metrics + a link). Coupons can't stack — Stripe hosted checkout already allows **one** promo code per order.
- **"Active variant"** now has help text in the variant dialog.
- **5 demo orders** seeded for dashboard testing (tagged `metadata.demo=true`). Dashboard-only (don't decrement stock). Clean up: `delete from checkout_orders where metadata->>'demo'='true';`
- **Login removed** — no account system (guest checkout by email). Shop header "Log in" → Discord; checkout shows "Guest checkout".

### Phase 6 — dynamic shipping ✅ DONE (flat fallback live; Shippo pending valid key)
**Checkout flow reversed** so we can do address-based rates: we now collect the shipping address on **our** checkout page (Stripe hosted Checkout can't be prefilled), quote shipping, store the address on the order, and create the Stripe session with **address collection OFF** + the chosen rate as a **line item**. Customer enters the address once; Stripe just takes payment. (Reverses the Phase-2 "Stripe collects address" decision.)
- **`product_variants.weight_oz`** (estimates seeded: box 16 / pack 2). `_lib/shipping.js`: `quoteShipping()` (shared, server-authoritative), `shippoRates()` (live USPS), `flatTier()` fallback (≤4oz $5, ≤8oz $6, ≤1lb $8, ≤2lb $10, ≤5lb $14, ≤10lb $20, else $25), free over $200.
- **`POST /api/shipping-quote`** (public): cart + address → `{source, weight_oz, subtotal_cents, options[]}`. `create-checkout-session` **re-quotes server-side** and picks the option by id (never trusts the client amount), stores `ship_*` + `shipping_cents` + `total`.
- **Checkout UI**: address form + live rate radios (auto-refresh on input) + summary. `?test=1` adds a **$0 "Test delivery"** option (hidden from normal customers) for real end-to-end test purchases.
- **Verified** on wrangler: quote (Shippo→flat fallback, free>$200, test $0, weights), full create-session storing address+tag+shipping, reservation release, checkout UI rates + totals.

⚠️ **Two keys to fix for production:**
1. **Shippo token is invalid** — the provided `shippo_test_…` returns *"Token does not exist"* from Shippo, so quoting falls back to flat tiers. Re-copy the API token from Shippo (Settings → API) into `.dev.vars`. Live rates work the moment it's valid (request the **live** key from Shippo for production labels).
2. **`SHIP_FROM_*`** in `.dev.vars` is a placeholder Austin address — set your real fulfillment origin (rates depend on it).
3. **`RESEND_FROM_EMAIL` can't be a gmail.com address** — Resend only sends from a verified domain; emails will fail until you verify a domain (or use `onboarding@resend.dev` for testing).

### Phase 7 — bundling + weight variance + Stripe address ✅ DONE
- **Stripe gets the address for fraud (Radar)**: `create-checkout-session` now passes the collected address via `payment_intent_data[shipping]` — Stripe sees it (Radar + dashboard + receipt) without the customer re-typing. Verified Stripe accepts it.
- **Bundling (no refunds)**: `checkout_orders.bundle_id`. Bulk **Bundle / Unbundle** in the dashboard groups a buyer's paid+unshipped orders; the PirateShip export emits **one combined row** per bundle (joined order numbers, merged items, summed weight/value/shipping) so they ship in one package. Verified: 2 orders → 1 export row.
- **Weight variance**: `checkout_orders.ship_mode` (`sealed`|`all_cards`|`hits_only`), per-order dropdown. Export weight = `applyShipMode(baseOz, mode)` — sealed = real, all_cards = ~half (min 4oz), hits_only = flat 3oz. Charge worst-case (sealed) at checkout; pick actual mode when shipping. Verified (bundle weight 16 sealed + 3 hits = 19oz).
- **Per-variant weight admin field**: variant editor now edits `weight_oz` (drives live Shippo quotes). `admin-update-variant` accepts it.
- **Live Shippo verified**: with the live key, `/api/shipping-quote` returns real UPS/USPS rates (rate-fetch is free; no labels bought).
- Config now set: `SHIP_FROM_*` = Tempe AZ; `RESEND_FROM_EMAIL` = `onboarding@resend.dev` (test sender, works without a domain). **Restart wrangler** to load.

### Phase 8 — editable email template ✅ DONE
The order-confirmation + welcome emails are now admin-editable. Migration `phase8_email_settings` applied; mirrored in `supabase/schema.sql`.
- **`email_settings`** single-row table (id=1) holds the editable bits: `logo_url`, `hero_gif_url`, `discord_url`, order email (`order_eyebrow/headline/body/cta_eyebrow/cta_body/order_footer`), welcome email (`welcome_eyebrow/headline/body/welcome_footer`). Body fields support `{order_number}` (order) and `{percent}` (welcome) placeholders.
- **`_lib/email.js`** refactored: `EMAIL_DEFAULTS` (the original copy) + `getEmailSettings(env)` + `resolveEmailConfig(env, row)` merge **defaults ← env asset vars ← stored settings** (first non-blank wins). `buildOrderEmailHtml`/`buildWelcomeEmailHtml` now take the resolved `cfg`. Blank fields fall back to env (`RESEND_LOGO_URL`/`RESEND_HERO_GIF_URL`/`DISCORD_INVITE_URL`) then to the built-in defaults — so nothing breaks if the table is empty.
- **`GET/POST /api/admin-email-settings`** (token-gated): GET returns `{settings, defaults, preview:{order,welcome}}`; POST saves (or `preview_only:true` renders unsaved values for live preview). Body text is escaped + nl2br'd on render.
- **`email-template.html`/`email-template.js`** (new admin page, shares the admin token, linked from the Marketing panel): grouped fields with defaults shown as placeholders, a **live server-rendered preview** (Order / Welcome toggle) that updates as you type. **Verified on wrangler:** save persists, preview reflects custom + default values, `{order_number}`/`{percent}` fill, welcome toggle works.

### Notes resolved this session
- **Resend test email (note 1):** `RESEND_FROM_EMAIL=onboarding@resend.dev` is live. **Verified** a real send is accepted to `andrew.segovia4@gmail.com`. ⚠️ Resend's test sender (no verified domain) only delivers to the **Resend account-owner email** — real customers won't get emails until a domain is verified. Also: the existing newsletter subscriber is the typo `anderew.segovia4@gmail.com`; sign up again in the popup with the correct address to receive the welcome code.
- **Google Maps address autocomplete (note 2):** wired on checkout via `GET /api/public-config` (browser-safe key) → `_lib`-free front-end in `checkout.js` using the **new `PlaceAutocompleteElement`** (the classic `Autocomplete` is blocked for Google customers created after Mar 2025). Additive "Search address" box fills the manual fields; if no key / Maps fails / key is API-restricted, manual entry stays. **Verified** wiring + graceful fallback on wrangler. ⚠️ The provided key currently returns `ApiTargetBlockedMapError` — in Google Cloud Console enable **Maps JavaScript API** + **Places API (New)** on the key and allow your domain's HTTP referrers. Key lives in gitignored `.dev.vars` (also in `.dev.vars.example` — it's public-by-design but should be referrer-locked).

Outstanding config: **Resend webhook** for email analytics — set `RESEND_WEBHOOK_SECRET` + point a Resend webhook at `https://YOUR-DOMAIN/api/resend-webhook` once deployed (needs a public URL). Swap `RESEND_FROM_EMAIL` to a verified domain when you have one.

### Admin pages restructure ✅ DONE (this session)
The admin is now **multiple pages with a shared top nav** (Command center · Marketing · Coupons · Email template), no longer one long command-center scroll.
- **`admin.html`** = Command center (metrics + inventory + orders only; Marketing panel removed).
- **`marketing.html`/`marketing.js`** (new) = lists & email-health metrics **+ a viewable newsletter subscriber table with a Download CSV button** (client-side CSV from `GET /api/admin-subscribers`).
- **`coupons.html`** + **`email-template.html`** unchanged in purpose; all four share the `.admin-nav` (active link via `aria-current`) and the same sessionStorage admin token.
- Spacing fixes: more generous `.panel__head` / `.email-editor` padding; the email-template **Save changes** button now uses a real `.primary` style.
- **Newsletter dedup UX:** the popup now keeps the form open and says "that email's already signed up — try a different one" instead of silently accepting a repeat (backend already dedups one welcome code per email).

### Bug fixes & polish (this session)
- **Orders are now their own page** (`orders.html`/`orders.js`), in the nav. Command center keeps metrics + inventory only. Orders page adds a **date-range filter** (default **This month**; Last 30/90 days; All time) on top of the existing status filter — older orders are out of view by default. `admin-overview` order limit raised 60 → 500.
- **Delete products:** `POST /api/admin-delete-product` + a Delete button per product. Hard-deletes the product + variants **only if it has no order history** (FK safety); otherwise refuses and tells you to hide it. Hiding (active=false) remains the path for sold products.
- **Welcome-code farming closed:** the signup popup no longer prints the code on screen and `/api/newsletter-signup` no longer returns it — codes are email-only (admin can still see them in the subscriber list). (The 4 "duplicate" subscribers were actually distinct typo'd emails, so each correctly got its own code; true duplicates are deduped.)
- **Shipping copy:** customer now sees a single **"Ground shipping $X"** (no USPS/UPS carrier name), and every charged rate is padded **+$1.00** (`RATE_BUFFER_CENTS`) so we don't lose money if the real label costs more.
- **Shop "+" over-add bug:** clicking + on an item already at its stock cap no longer fires the fly-to-chest animation (it now early-returns when `current >= cap`).
- **Shop header:** fixed the display-font descender (the "g" in "Magic: The Gathering") overlapping the subtitle (`line-height` + padding), and the filter chips now stay right-aligned even with a long title (`.filters{margin-left:auto}` + `min-width:0` headings).
- **Admin spacing:** coupons page `.marketing-grid` and the bulk bar got proper padding; the bulk bar's `hidden` attribute now actually hides it (`.bulk-bar[hidden]{display:none}` — `display:flex` was overriding it).

### Order statuses — what they mean
- **pending** = a checkout was started and stock is **reserved** but not paid yet (a hold). It auto-expires after 30 min (or you can **Release hold** to free the stock immediately).
- **paid** = payment captured. These are what you fulfill (tag Sealed/Open-live, mark ready, ship).
- **released** = a pending hold that was let go (manually or by you) — stock returned, no sale.
- **expired** = a pending hold that timed out — stock returned automatically.
Released/expired are dead holds kept for the record; with the new date filter they drop out of view after the current month.

### ⚠️ TODO — real admin auth (OAuth login, owner-only)
The admin pages are currently guarded only by a pasted `ADMIN_TOKEN` (the API still verifies it on every call, so data is safe — but an unauthenticated visitor still sees the admin **shell/UI**). **Build a proper login gate:** an OAuth sign-in (e.g. Google, restricted to the owner's single email / an allowlist) in front of `admin.html`, `marketing.html`, `coupons.html`, `email-template.html` so anyone hitting those URLs without a session is **redirected to a login page and sees nothing**. Likely a Cloudflare Access policy (zero code, fastest) or a small OAuth flow + signed session cookie checked by a Pages middleware (`functions/_middleware.js`). Single-user / owner-only.

### Google Maps cost control (free tier)
To avoid blowing past the free monthly credit on the checkout autocomplete: in **Google Cloud Console → APIs & Services → (each API) → Quotas & System Limits**, set a hard **per-day request cap** on *Maps JavaScript API* and *Places API (New)*; and in **Billing → Budgets & alerts**, add a budget + email alert. The new `PlaceAutocompleteElement` already bundles keystrokes into one billed session token, and `checkout.js` debounces input — but a quota cap is the only hard guarantee you won't be charged. Keep the key **referrer-restricted** to your domain so others can't use it.

(Interim test path: Stripe is in **test mode**, so a full purchase with `test-01` + card `4242 4242 4242 4242` costs $0 real money even with the $5 shipping.)

---

## 5. Gotchas for the next session
- **Restart Wrangler after `.dev.vars` changes** — env is read only at startup.
- **Keep the Stripe listener running**; its `whsec_` is ephemeral.
- **Any product change should ideally go through Supabase now**, not the JS catalogs. If you do edit JS catalogs, they're fallback-only and won't match Supabase.
- **Never `git commit` from `/Users/pantheon/Downloads`** (that repo contains personal files). Commit only inside the project repo.
- When testing checkout, you create pending orders that hold stock; release with `release_order_reservation(order_id)` or let them expire (30 min). Reset the test product with: `update product_variants set stock_on_hand=100, stock_reserved=0, stock_sold=0 where product_id='test-01';`
- Stripe minimum charge is 50¢ USD.
