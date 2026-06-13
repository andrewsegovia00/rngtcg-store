# R&G TCG Complete MVP

A complete MVP package for the R&G TCG sealed-product storefront.

This project includes:

- Frontend shop with brand/language filters
- Drag/tap product-to-chest cart
- Pack/box quantity selection
- Checkout review page
- Stripe Checkout handoff through Cloudflare Pages Functions
- Supabase order storage and inventory reservation
- Stripe webhook for paid/expired checkout sessions
- Success/cancel pages
- Private admin dashboard for inventory/orders
- Supabase schema and seed data

## Project structure

```txt
rg-tcg-complete-mvp/
├─ index.html                         # Shop frontend
├─ checkout.html                      # Checkout review / Stripe handoff
├─ success.html                       # Order success lookup
├─ cancel.html                        # Cancelled checkout
├─ admin.html                         # Private admin dashboard
├─ preview.html                       # Static preview launcher
├─ catalog.js                         # Client catalog data
├─ app.js                             # Shop/cart/chest behavior
├─ checkout.js                        # Checkout page behavior
├─ admin.js                           # Admin dashboard behavior
├─ styles.css                         # Shop styles
├─ checkout.css                       # Checkout styles
├─ admin.css                          # Admin styles
├─ tokens.css                         # Design tokens
├─ frontend-preview-board.png         # Visual preview board
├─ functions/
│  ├─ _lib/
│  │  ├─ admin.js                     # Admin token guard
│  │  ├─ catalog.js                   # Server-side trusted catalog/prices
│  │  └─ supabase.js                  # Supabase REST/RPC helper
│  └─ api/
│     ├─ create-checkout-session.js   # Reserve inventory + create Stripe Checkout Session
│     ├─ stripe-webhook.js            # Mark paid / release failed Stripe sessions
│     ├─ inventory.js                 # Live stock endpoint
│     ├─ order-status.js              # Success page order lookup
│     ├─ release-reservation.js       # Release cancelled holds
│     ├─ release-expired-reservations.js
│     ├─ admin-overview.js            # Admin data bundle
│     ├─ admin-update-variant.js      # Admin stock/price/active edits
│     ├─ admin-update-product.js      # Admin product visibility edits
│     └─ admin-release-order.js       # Admin release pending order
├─ supabase/
│  ├─ schema.sql                      # Tables + RPC functions
│  └─ seed.sql                        # Sample products/variants
├─ package.json
├─ .dev.vars.example
├─ KEYS_NEEDED.md
└─ DEPLOYMENT_NOTES.md
```

## Local development

Install dependencies and run with Cloudflare Wrangler:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Then open the local URL printed by Wrangler.

Do not open the HTML files directly from your filesystem if you want backend functions to work. The API routes only run through Cloudflare Pages Functions / Wrangler.

## Setup order

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Then run `supabase/seed.sql`.
4. Create a Stripe account and get your test secret key.
5. Add the required values to `.dev.vars` locally.
6. Run `npm run dev`.
7. Test checkout using Stripe test cards.
8. Configure the Stripe webhook endpoint for `/api/stripe-webhook`.
9. Deploy to Cloudflare Pages.
10. Add the same environment variables in Cloudflare Pages settings.

## Runtime behavior

Checkout flow:

```txt
Customer adds items to chest
↓
checkout.html reviews cart
↓
POST /api/create-checkout-session
↓
Supabase reserves inventory and creates pending order
↓
Cloudflare Function creates Stripe Checkout Session
↓
Customer pays on Stripe
↓
Stripe calls /api/stripe-webhook
↓
Supabase marks order paid and moves reserved stock to sold stock
↓
success.html loads order details with /api/order-status
```

## Admin

Open:

```txt
/admin.html
```

The admin dashboard is protected by `ADMIN_TOKEN`. It is a simple MVP admin, not a full user-auth system.

For early launch, this is okay. Later, replace it with Cloudflare Access, Supabase Auth, Clerk, or another proper login system.

## Current MVP limits

This version does not yet include:

- Customer login
- Points
- Emotes
- Artwork voting
- Gated drop codes
- Automated Resend/Postmark emails
- Tax calculation via Stripe Tax
- Shipping label purchasing

The project is structured so those can be added next without changing the core checkout/cart flow.
