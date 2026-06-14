# Go-Live Runbook — rngtcg.com

_Click-by-click steps to take R&G TCG live. Order matters: deploy first, then layer Access, Resend domain, and the go-live switches on top. Anything that says **(you)** is an account-level step only you can do; the repo is already prepped._

Legend: 🔴 = blocks real customers · 🟡 = do soon after launch · 🟢 = polish

---

## Step 0 — Put the repo on GitHub (you) 🔴

Cloudflare's "click" deploy connects to a Git repo. The project has its own local git but isn't pushed anywhere yet.

1. Create a **private** repo on GitHub (e.g. `rngtcg/store` or under your account). **Don't** reuse the Downloads-wide repo.
2. From the project dir:
   ```bash
   cd /Users/pantheon/Downloads/rg-tcg-complete-mvp
   git remote add origin git@github.com:<you>/<repo>.git
   git push -u origin main
   ```
3. Confirm `.dev.vars` is **not** in the push (it's gitignored — your live keys must never hit GitHub). `git ls-files | grep dev.vars` should return **nothing**.

> Prefer no GitHub? You can instead run `wrangler pages deploy .` for a direct upload. The dashboard/Git path below gives you auto-deploy on every push, which is why it's recommended.

---

## Step 1 — Create the Cloudflare Pages project (you) 🔴

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Pick your repo → **Begin setup**.
3. Build settings:
   - **Framework preset:** None
   - **Build command:** _(leave empty)_
   - **Build output directory:** `public`
   - The committed `wrangler.toml` already declares `pages_build_output_dir = "public"` and `name = "rg-tcg"` — keep the project name **`rg-tcg`** so they match (or change both). Only `public/` is deployed; internal docs, `supabase/` SQL, and config stay private.
4. **Save and Deploy.** First build deploys to `https://rg-tcg.pages.dev`. Functions under `functions/` are auto-detected.

Don't test purchases yet — env vars come next.

---

## Step 2 — Set production environment variables (you) 🔴

Pages project → **Settings** → **Variables and Secrets** → **Production**. Add each below. Mark everything except `SITE_URL` as **Secret** (encrypted). After saving, **Redeploy** (Deployments → ⋯ → Retry deployment) — Functions read env only at build/deploy.

| Variable | Value | Notes |
|---|---|---|
| `SITE_URL` | `https://rngtcg.com` | Plain var. Drives Stripe success/cancel URLs + email links. |
| `STRIPE_SECRET_KEY` | `sk_live_…` | **Live** key (Step 4). |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | From the **production** webhook endpoint (Step 4). |
| `SUPABASE_URL` | `https://eybplzqytavihdzkcolt.supabase.co` | Same project as dev. |
| `SUPABASE_SERVICE_ROLE_KEY` | `sb_secret_…` | Service-role (server-only) key. |
| `ADMIN_TOKEN` | long random string | Keep gating the admin **API** even behind Access (defense in depth). |
| `RESEND_API_KEY` | `re_…` | Step 3. |
| `RESEND_FROM_EMAIL` | `orders@rngtcg.com` | Only valid **after** the domain verifies (Step 3). |
| `RESEND_WEBHOOK_SECRET` | `whsec_…` | Step 6 (email analytics). |
| `DISCORD_INVITE_URL` | `https://discord.gg/JaaQuMrcTa` | Email + landing CTA. |
| `SHIPPO_API_KEY` | live Shippo token | Step 5. |
| `SHIP_FROM_NAME / _STREET1 / _CITY / _STATE / _ZIP / _COUNTRY / _PHONE` | your real fulfillment origin | Rates depend on it. |
| `GOOGLE_MAPS_API_KEY` | `AIza…` | Browser-safe; referrer-lock it (Step 7). |
| `RESEND_LOGO_URL` / `RESEND_HERO_GIF_URL` | optional asset URLs | Blank = built-in defaults. |

> Tip: copy your working `.dev.vars` values over, swapping the **test** keys for **live** ones.

---

## Step 3 — Verify rngtcg.com in Resend 🔴  _(no deploy needed — DNS only)_

This is the **single biggest blocker**: until the domain verifies, real buyers get **no** order confirmations or welcome codes (the `onboarding@resend.dev` test sender only delivers to your own inbox).

1. **(you)** Resend dashboard → **Domains** → **Add Domain** → enter `rngtcg.com`.
2. Resend shows a set of DNS records (an MX + TXT for the bounce/SPF subdomain, a DKIM `TXT`/CNAME, and a recommended DMARC `TXT`).
3. **(you)** Add those records to `rngtcg.com`'s DNS. If the domain is on **Cloudflare DNS**: dashboard → your domain → **DNS** → **Records** → add each exactly as shown (set DKIM/CNAME records to **DNS only / grey cloud**, not proxied).
4. Wait for propagation, then click **Verify** in Resend (usually minutes; can take up to a few hours).
5. Once it's **Verified**, set `RESEND_FROM_EMAIL=orders@rngtcg.com` (Step 2) and redeploy.

I can flip the email config the moment you tell me it's verified.

---

## Step 4 — Stripe go-live (you) 🔴

1. Stripe Dashboard → toggle **Test mode → off** (live).
2. **Developers → API keys** → copy the **live** secret key → set `STRIPE_SECRET_KEY`.
3. **Developers → Webhooks → Add endpoint:**
   - URL: `https://rngtcg.com/api/stripe-webhook`
   - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`, `checkout.session.async_payment_failed`
   - Save → copy the endpoint's **Signing secret** (`whsec_…`) → set `STRIPE_WEBHOOK_SECRET`.
4. Redeploy. (Optional belt-and-suspenders: Settings → **Customer emails** → enable receipts on successful payments.)

---

## Step 5 — Shippo + ship-from (you) 🔴

1. The current `shippo_test_…` token only **quotes** and was reported invalid → falls back to flat tiers. Shippo → **Settings → API** → copy your token (request a **live** token for production labels) → set `SHIPPO_API_KEY`.
2. Set the real `SHIP_FROM_*` (currently a placeholder/Tempe address) — rates depend on origin.
3. Redeploy. Verify `/api/shipping-quote` returns live "Ground shipping $X" rates.

---

## Step 6 — Custom domain + Cloudflare Access (admin login) (you) 🔴

### 6a. Point rngtcg.com at the Pages project
1. Pages project → **Custom domains** → **Set up a domain** → `rngtcg.com` (and `www` if you want) → follow the DNS prompt. Easiest if the domain's nameservers are on Cloudflare.

### 6b. Lock the admin to you (Cloudflare Access — zero code)
1. Cloudflare dashboard → **Zero Trust**. If first time, pick a team name (free plan covers up to 50 users).
2. **Access → Applications → Add an application → Self-hosted.**
3. Name: `R&G Admin`. Add these as **Application domains** (host + path) so only the admin shell is gated, not the storefront:
   - `rngtcg.com/admin.html`
   - `rngtcg.com/marketing.html`
   - `rngtcg.com/coupons.html`
   - `rngtcg.com/email-template.html`
   - _(also add the `rg-tcg.pages.dev/...` equivalents if you want the preview domain gated too)_
4. **Add policy** → Action **Allow** → Include → **Emails** → your Google address. (That single rule = owner-only.)
5. Identity: **One-time PIN** works with zero setup (Access emails you a 6-digit code). To use real "Sign in with Google," add Google as an IdP under Zero Trust → **Settings → Authentication** first — optional.
6. Save. Now anyone hitting those URLs without your session is bounced to a login and **sees nothing**. The `ADMIN_TOKEN` still guards the API underneath.

---

## Step 7 — Google Maps key hardening (you) 🟡

Google Cloud Console → **APIs & Services**:
1. Credentials → your key → **Application restrictions: HTTP referrers** → add `https://rngtcg.com/*` (and `https://www.rngtcg.com/*`).
2. **API restrictions:** allow only **Maps JavaScript API** + **Places API (New)**.
3. Quotas → set a hard **per-day cap** on both APIs; Billing → **Budgets & alerts** → add a budget + email alert. This is the only hard guarantee against overage.

---

## Step 8 — Resend analytics webhook (you) 🟡

For delivery/open/bounce rates in the admin Marketing panel:
1. Resend → **Webhooks** → Add endpoint: `https://rngtcg.com/api/resend-webhook` (events: sent/delivered/opened/bounced/complained).
2. Copy the signing secret → set `RESEND_WEBHOOK_SECRET` → redeploy.

---

## Step 9 — Post-launch verification checklist

- [ ] Visit `https://rngtcg.com` — storefront loads, catalog hydrates, photos show.
- [ ] Open `https://rngtcg.com/admin.html` in a logged-out/incognito window → **redirected to Access login**, no admin shell visible. ✅ #2 done.
- [ ] Log in with your email → admin loads; metrics/orders render (API accepts your `ADMIN_TOKEN`).
- [ ] Real checkout with a **live** card (small item) → Stripe payment succeeds → order shows `paid` in admin.
- [ ] Confirmation email arrives **from `orders@rngtcg.com`** (not resend.dev). ✅ #1 done.
- [ ] Newsletter popup signup → welcome 10%-off code emailed.
- [ ] Shipping quote shows real rates (live Shippo) at checkout.

---

## What's done in-repo already
- `wrangler.toml` — Pages deploy config (no build step; output dir `.`).
- All Functions, env-var wiring, and the email/Access-compatible structure are in place. No code change is needed for Access (it gates at the edge) or for Resend domain (just the `RESEND_FROM_EMAIL` value).

## Still-code follow-ups (separate from go-live)
- 🟡 Create-product UI · 🟡 Unsubscribe page (CAN-SPAM) · 🟢 Order search · 🟢 Abandoned-checkout emails.
