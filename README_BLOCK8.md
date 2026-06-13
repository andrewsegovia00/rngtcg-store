# R&G TCG MVP — Block 8

Block 8 adds a small private admin dashboard so you can operate the MVP without opening Supabase tables directly.

## What is new

```txt
Block 8
├─ admin.html private ops dashboard
├─ admin.css / admin.js
├─ Token-protected admin API routes
├─ Inventory and price editing
├─ Product visibility toggle
├─ Recent order list
├─ Pending reservation release button
├─ Store metrics cards
└─ Carries forward Stripe Checkout + Supabase reservation flow from Block 7
```

## Files

```txt
rg-tcg-mvp-block-8/
├─ index.html
├─ checkout.html
├─ success.html
├─ admin.html
├─ catalog.js
├─ app.js
├─ checkout.js
├─ admin.js
├─ styles.css
├─ checkout.css
├─ admin.css
├─ tokens.css
├─ functions/
│  ├─ _lib/
│  │  ├─ admin.js
│  │  ├─ catalog.js
│  │  └─ supabase.js
│  └─ api/
│     ├─ create-checkout-session.js
│     ├─ stripe-webhook.js
│     ├─ inventory.js
│     ├─ order-status.js
│     ├─ release-reservation.js
│     ├─ release-expired-reservations.js
│     ├─ admin-overview.js
│     ├─ admin-update-variant.js
│     ├─ admin-update-product.js
│     └─ admin-release-order.js
└─ supabase/
   ├─ schema.sql
   └─ seed.sql
```

## Local setup

```bash
cd rg-tcg-mvp-block-8
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Open the local URL that Wrangler prints, then visit:

```txt
/admin.html
```

Do not open `admin.html` directly from your filesystem. The admin dashboard needs Cloudflare Pages Functions.

## Required environment variables

```txt
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=http://localhost:8788
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_TOKEN=change-me-to-a-long-random-token
```

Use a long random token for `ADMIN_TOKEN`. Example format:

```txt
ADMIN_TOKEN=rg_admin_4C9Tv3u9ZpQ7mX2kL8sHn5yA
```

The admin page stores this token in `sessionStorage` only. The server checks it on every admin request with an `Authorization: Bearer ...` header.

## Admin features

### Dashboard metrics

Shows:

- Paid revenue subtotal
- Available units
- Reserved units
- Pending holds

### Inventory table

You can:

- Search products/SKUs
- Filter low stock
- Filter reserved units
- Filter inactive products
- Edit variant stock
- Edit variant price
- Activate/deactivate a variant
- Hide/show a product

### Orders panel

You can:

- View recent orders
- Filter pending/paid/released/expired orders
- See line items
- Release a pending inventory hold

## Security note

This is an MVP admin. It is acceptable for early testing, but before real scale you should replace the shared token with a real login flow such as Supabase Auth, Clerk, or Cloudflare Access.

## Next block recommendation

Block 9 should add one of these:

1. **CSV/product import tools** so you can upload real inventory faster.
2. **Email capture + Resend transactional emails** for checkout confirmations and drop announcements.
3. **Supabase Auth customer login** if you want customer accounts, points, emotes, and gated drops next.
