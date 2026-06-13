# Deployment notes

## Recommended hosting

Use Cloudflare Pages.

Why:

- Static frontend deploys cheaply
- `/functions/api/*` becomes Cloudflare Pages Functions
- No separate server required
- Environment variables are managed in the Cloudflare dashboard

## Cloudflare Pages setup

1. Push this folder to GitHub.
2. Create a Cloudflare Pages project.
3. Connect the GitHub repo.
4. Build command: leave blank or use `npm install` only if Cloudflare requires install.
5. Output directory: `/` or project root.
6. Add environment variables in Cloudflare Pages → Settings → Environment Variables.

Required production variables:

```txt
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
SITE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
ADMIN_TOKEN
```

## Supabase setup

1. Create Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Run `supabase/seed.sql`.
5. Confirm these tables exist:
   - `products`
   - `product_variants`
   - `checkout_orders`
   - `checkout_order_items`
6. Copy the project URL and service-role key to Cloudflare env vars.

## Stripe setup

1. Get your Stripe secret key.
2. Add `STRIPE_SECRET_KEY` to Cloudflare.
3. Create a webhook endpoint:

```txt
https://your-domain.com/api/stripe-webhook
```

4. Subscribe to at least:

```txt
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
checkout.session.expired
```

5. Copy the webhook signing secret into `STRIPE_WEBHOOK_SECRET`.

## Local testing

```bash
npm install
cp .dev.vars.example .dev.vars
npm run dev
```

Use Stripe test cards in Stripe Checkout.

## Important production reminders

- Switch `STRIPE_SECRET_KEY` from test to live only when ready.
- Change `SITE_URL` to the final production domain.
- Use a long random `ADMIN_TOKEN`.
- Never commit `.dev.vars`.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only.
- Before launch, test cancellation and expired checkout sessions to ensure inventory holds are released.
