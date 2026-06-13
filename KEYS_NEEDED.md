# Keys and environment variables needed

Create a local `.dev.vars` file from `.dev.vars.example`.

## Required runtime environment variables

```txt
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SITE_URL=http://localhost:8788
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
ADMIN_TOKEN=your-long-random-admin-token
```

## What each key does

### `STRIPE_SECRET_KEY`

Your Stripe secret API key. Used only in Cloudflare Pages Functions to create Checkout Sessions.

Use test mode first:

```txt
sk_test_...
```

Use live mode only when ready:

```txt
sk_live_...
```

Never put this in browser JavaScript.

### `STRIPE_WEBHOOK_SECRET`

Your Stripe webhook signing secret. Used by `/api/stripe-webhook` to verify that webhook events really came from Stripe.

It usually starts with:

```txt
whsec_...
```

For local testing, get it from `stripe listen`.
For production, get it from the Stripe Dashboard webhook endpoint settings.

### `SITE_URL`

The public base URL of the site. Used to build Stripe success/cancel URLs.

Local example:

```txt
SITE_URL=http://localhost:8788
```

Production example:

```txt
SITE_URL=https://shop.yourdomain.com
```

### `SUPABASE_URL`

Your Supabase project URL.

Example:

```txt
SUPABASE_URL=https://abcxyz.supabase.co
```

### `SUPABASE_SERVICE_ROLE_KEY`

Your Supabase service-role key. Used only inside Cloudflare Pages Functions for inventory reservation, order writes, admin updates, and order lookup.

Never expose this in browser JavaScript.

### `ADMIN_TOKEN`

A long random token used to protect the MVP admin page.

Example:

```txt
ADMIN_TOKEN=rg_admin_4C9Tv3u9ZpQ7mX2kL8sHn5yA
```

The admin frontend sends it as:

```txt
Authorization: Bearer <ADMIN_TOKEN>
```

## Optional / later keys

**Order-confirmation email (Phase 4 — wired up, optional):**

```txt
RESEND_API_KEY=re_...                 # enables branded order emails
RESEND_FROM_EMAIL=orders@yourdomain.com   # must be a Resend-verified domain
RESEND_LOGO_URL=https://.../logo.png      # optional header logo (else text wordmark)
RESEND_HERO_GIF_URL=https://.../hero.gif  # optional animated gif/hero image
DISCORD_INVITE_URL=https://discord.gg/... # community CTA in the email + landing page
```

The Stripe webhook sends a branded "order confirmed" email on the first paid
transition (idempotent across Stripe retries; non-blocking via `waitUntil`). If
`RESEND_API_KEY`/`RESEND_FROM_EMAIL` are unset, email is skipped silently —
nothing else breaks. Template lives in `functions/_lib/email.js`.

**Quick win with no code:** enable Stripe automatic receipts in
Stripe Dashboard → Settings → Customer emails → "Successful payments."

**Email analytics (Phase 5 — optional):**

```txt
RESEND_WEBHOOK_SECRET=whsec_...   # Resend dashboard → Webhooks → signing secret
```

Point a Resend webhook at `https://YOUR-DOMAIN/api/resend-webhook` (events:
sent/delivered/opened/bounced/complained). Events land in `email_events` and
drive the open/delivery/bounce rates in the admin Marketing panel.

**Still later:**

```txt
STRIPE_TAX_ENABLED=true
```

Use Resend for drop codes, campaign emails, and abandoned-checkout follow-ups next.

## Keys you do NOT need yet

- No Stripe publishable key is required for this version because customers are redirected to Stripe Checkout.
- No Supabase anon key is required for this version because the browser does not talk directly to Supabase.
- No database password is needed by the app because Cloudflare Functions use Supabase REST/RPC with the service-role key.
