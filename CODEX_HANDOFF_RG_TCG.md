# CODEX HANDOFF — R&G TCG Complete MVP

Use this as the **read-first execution plan**. The current project zip is close, but it is incomplete as a full MVP handoff because it is mostly focused on the shop page. Do **not** rebuild only the shop. Preserve the existing frontend/backend work and fill the missing pages, docs, and deployment-ready wiring.

## 0. Current project snapshot

Project root inside the uploaded zip:

```txt
rg-tcg-complete-mvp/
```

Current important files found:

```txt
index.html                         # Shop page
styles.css                         # Shop/chest/pouch styling
app.js                             # Product grid, filters, cart, pouch chest
catalog.js                         # Client catalog sample data
checkout.html / checkout.css / checkout.js
success.html
cancel.html
admin.html / admin.css / admin.js
functions/api/*.js                 # Cloudflare Pages Functions
functions/_lib/*.js                # Supabase/admin/server catalog helpers
supabase/schema.sql
supabase/seed.sql
README.md
KEYS_NEEDED.md
DEPLOYMENT_NOTES.md
```

Current gaps:

```txt
landing.html is missing
landing.css is missing
preview.html is referenced in README but missing
review-map.html / API visual docs are missing
API_BREAKDOWN.md, CODE_FLOW_MAP.md, PROJECT_REVIEW.md are missing
README still claims preview.html exists, so docs and files are out of sync
```

## 1. Non-negotiable product direction

This project is a custom R&G TCG storefront for sealed TCG product. The experience should include:

```txt
Landing page
Shop page
Chest/pouch cart
Checkout review page
Stripe Checkout backend handoff
Success/cancel pages
Admin dashboard
Supabase inventory/order storage
Deployment docs
API/key breakdown docs
```

Do **not** remove the custom chest/pouch interaction. The shop is supposed to feel playful: customers drag/tap products into a pouch/chest, then checkout.

Do **not** put secret keys in browser code. All sensitive keys stay in Cloudflare Pages Functions environment variables.

## 2. Immediate Codex task list

### Task A — Add the missing bare-bones landing page

Create:

```txt
landing.html
landing.css
```

Landing page should contain only:

```txt
Header/nav
Hero section
Hero animation/art
Footer
```

Do **not** include product catalog sections, featured product cards, email capture, or admin content on the landing page.

Hero direction:

```txt
Eyebrow: Sealed product · Five games · One honest shop
Headline: Rip into something real.
Body: Booster boxes and packs across Pokémon, Magic, Yu-Gi-Oh!, Lorcana, and One Piece. Hand-checked collation, honest prices, and a cart you actually drag your loot into.
Primary CTA: Shop sealed product → index.html
Secondary CTA: How drops work / About anchor
Trust strip: Hand-checked collation · Ships in 24h · Honest pricing
Hero art: dark R&G pouch with floating product cards
Footer: simple R&G TCG brand, shop links, crew links, location/version text
```

Implementation notes:

```txt
Use existing tokens.css fonts/colors.
Keep Bagel Fat One / Space Grotesk / JetBrains Mono.
Keep sticker shadows, heavy black outlines, purple accent.
Keep mobile responsive.
```

### Task B — Keep `index.html` as the shop page

`index.html` should remain the shop/catalog page. Add navigation that points to:

```txt
Logo → landing.html
Shop → index.html
New/Drops/About → landing.html anchors or future placeholders
Cart/chest → scroll/focus the chest on shop page
Admin → admin.html only if intentionally exposed in preview/dev
```

Do not convert `index.html` into the landing page unless explicitly asked later.

### Task C — Verify chest/pouch behavior stays intact

Current `app.js` already has the desired pouch direction:

```txt
0 items → empty pouch says “drag items here”
1+ items → pouch fills with cards/slabs
More than 5 unique cart lines → show +N overflow slab
Free-shipping progress meter lives at the top of chest content
Loot rows stay below pouch/progress area
Bounty total + “Set sail · Checkout” remain at bottom
```

Check these code areas before editing:

```txt
app.js → renderChestVisual()
app.js → renderBag()
styles.css → .pouch, .slab, .chest__topmeter, .ship-meter, .loot-line, .bounty
```

If anything regresses visually, restore the pouch/chest behavior first.

### Task D — Add a local preview launcher

Create:

```txt
preview.html
preview.css optional, or inline CSS
```

It should link to:

```txt
landing.html
index.html
checkout.html
success.html
cancel.html
admin.html
README.md
KEYS_NEEDED.md
DEPLOYMENT_NOTES.md
CODEX_HANDOFF.md
API_BREAKDOWN.md if created
CODE_FLOW_MAP.md if created
```

Purpose: make it obvious that the project is multi-page, not shop-only.

### Task E — Add condensed handoff/review docs

Create these markdown files if missing:

```txt
CODEX_HANDOFF.md                 # this plan, copied into project root
API_BREAKDOWN.md                 # endpoints, request/response shape, env vars used
CODE_FLOW_MAP.md                 # product click → cart → checkout → webhook flow
PROJECT_REVIEW.md                # known gaps, launch checklist, improvements
```

Keep them concise but specific enough for a developer to continue without prior chat context.

## 3. Product/customer flow to preserve

### Flow 1 — Customer lands

```txt
landing.html
↓
Hero communicates sealed product, trust, shipping, honest shop
↓
Primary CTA opens index.html
```

Files involved:

```txt
landing.html
landing.css
tokens.css
```

### Flow 2 — Customer shops

```txt
index.html loads
↓
catalog.js provides products/categories/languages
↓
app.js renders brand/language filters and product grid
↓
Customer taps Add or drags product into chest
↓
addToCart() updates cart
↓
saveCart() stores cart in localStorage
↓
renderBag() updates pouch, loot rows, bounty, progress meter
```

Files involved:

```txt
index.html
catalog.js
app.js
styles.css
tokens.css
```

### Flow 3 — Customer checks out

```txt
Set sail · Checkout
↓
checkout.html loads localStorage cart
↓
checkout.js renders review summary
↓
Customer clicks Continue to Stripe
↓
POST /api/create-checkout-session
↓
Function validates server-side catalog/Supabase prices and stock
↓
Supabase reserves inventory and creates pending order
↓
Stripe Checkout Session is created
↓
Browser redirects to Stripe-hosted checkout
```

Files involved:

```txt
checkout.html
checkout.css
checkout.js
functions/api/create-checkout-session.js
functions/_lib/catalog.js
functions/_lib/supabase.js
supabase/schema.sql
```

### Flow 4 — Stripe confirms payment

```txt
Stripe sends webhook
↓
POST /api/stripe-webhook
↓
Function verifies STRIPE_WEBHOOK_SECRET
↓
checkout.session.completed marks order paid
↓
Reserved inventory becomes sold inventory
↓
success.html uses /api/order-status to show order details
```

Files involved:

```txt
functions/api/stripe-webhook.js
functions/api/order-status.js
success.html
supabase/schema.sql
```

### Flow 5 — Admin manages inventory/orders

```txt
admin.html
↓
User enters ADMIN_TOKEN
↓
admin.js calls /api/admin-overview
↓
Admin can edit stock, price, active status, product visibility
↓
Admin can release pending inventory holds
```

Files involved:

```txt
admin.html
admin.css
admin.js
functions/_lib/admin.js
functions/api/admin-overview.js
functions/api/admin-update-variant.js
functions/api/admin-update-product.js
functions/api/admin-release-order.js
```

## 4. API endpoints expected in the complete MVP

Public/customer endpoints:

```txt
GET  /api/inventory
POST /api/create-checkout-session
POST /api/stripe-webhook
GET  /api/order-status?session_id=...
POST /api/release-reservation
POST /api/release-expired-reservations
```

Admin endpoints:

```txt
GET  /api/admin-overview
POST /api/admin-update-variant
POST /api/admin-update-product
POST /api/admin-release-order
```

Admin endpoints must require:

```txt
Authorization: Bearer <ADMIN_TOKEN>
```

## 5. Environment variables needed

Required for test/prod backend:

```txt
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=http://localhost:8788 or https://yourdomain.com
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_TOKEN=long-random-secret
```

Optional future variables:

```txt
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=orders@yourdomain.com
CLARITY_PROJECT_ID=...
POSTHOG_KEY=...
POSTHOG_HOST=...
```

Security rules:

```txt
Never expose STRIPE_SECRET_KEY in frontend JS.
Never expose SUPABASE_SERVICE_ROLE_KEY in frontend JS.
Never commit .dev.vars.
Use Cloudflare Pages environment variables for deployed secrets.
Use Cloudflare Access + ADMIN_TOKEN for admin hardening later.
```

## 6. Data model guidance

Preferred long-term model:

```txt
products
├─ id
├─ category
├─ name
├─ set_code
├─ visible
└─ marketing metadata

product_variants
├─ id
├─ product_id
├─ format: pack | box
├─ language: english | japanese | chinese
├─ price_cents
├─ stock_on_hand
├─ stock_reserved
├─ stock_sold
└─ active
```

Pack/box and language should be variants, not separate unrelated products.

## 7. Launch roadmap after files are corrected

Do not add more major frontend features before backend deployment. Execute in this order:

```txt
1. Frontend QA: landing, shop, chest, checkout, success, admin, mobile
2. Backend logic review: checkout reservation, Stripe session, webhook, release holds
3. Supabase setup: run schema.sql, run seed.sql, verify tables/RPCs
4. Stripe setup: test key, webhook endpoint, test checkout.session.completed
5. Cloudflare Pages deploy: static pages + functions + env vars
6. End-to-end test: add product → checkout → pay test card → webhook → success page → admin
7. Add email: Resend order confirmation/drop capture later
8. Add analytics: Clarity/PostHog events later
9. SEO polish: sitemap, robots, OG image, product structured data, product URLs later
```

## 8. Definition of done for this Codex pass

This pass is done when:

```txt
landing.html exists and looks like the intended hero-only landing page
landing.css exists or landing styles are cleanly scoped
preview.html exists and links every major page/doc
index.html remains the shop, not the landing page
shop chest/pouch still fills with slabs/cards when cart has products
free-shipping progress meter remains at top of chest area
checkout/success/cancel/admin pages are still present
Cloudflare Functions are still present
Supabase schema/seed are still present
README references match real files
CODEX_HANDOFF.md is copied into project root
```

## 9. What not to do

```txt
Do not delete backend functions.
Do not remove admin dashboard.
Do not flatten the project into only one shop page.
Do not move secret keys into frontend JavaScript.
Do not trust frontend prices at checkout.
Do not reduce inventory only in the browser.
Do not replace the custom chest/pouch cart with a generic cart drawer.
```

## 10. Quick local commands

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Open the Wrangler URL, not local file paths, when testing API routes.
