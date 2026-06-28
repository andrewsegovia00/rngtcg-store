# R&G TCG — Working To-Do

Living backlog for post-launch work. Newest priorities up top.

## Done
- [x] **Checkout 502 fix** — `SITE_URL` without an `https://` scheme made Stripe
  reject `success_url` (`url_invalid`). `baseUrl()` now prepends `https://` for a
  bare domain; `email.js` does the same for order links.
- [x] **Cart auto-expiry (4h)** — cart now stored as `{ items, savedAt }` in
  localStorage with a rolling 4-hour TTL. Stale carts (and legacy bare-array
  carts) clear themselves on next load. (`app.js`, `checkout.js`)

## In progress
- [ ] **Stripe protective measures** — Radar fraud rules + 3D Secure.
  - [x] Code (FREE — works on any Radar tier): `billing_address_collection=required`
    (enables AVS), and forced 3D Secure via `request_three_d_secure`
    (defaults to `any` = 3DS on every card; set `STRIPE_3DS_MODE=automatic` to
    dial back). 3DS shifts most fraud-chargeback liability to the issuer.

  ### Stripe Radar — free vs. paid (owner action in Stripe Dashboard)
  - **Free (standard Radar, already on):** ML fraud scoring on every payment +
    automatic blocking of the highest-risk charges. Nothing to enable.
    - [ ] Confirm Settings → Radar → "Block payments with high risk" is on.
    - [ ] Settings → Customer emails → enable receipts.
  - **Requires Radar for Fraud Teams (+$0.02 per successful charge):** custom
    rules + lists. Defer until volume/chargebacks justify it. Confirm current
    price at stripe.com/radar/pricing.
    - [ ] Block if `:risk_level: = 'highest'`
    - [ ] Request 3DS if `:risk_level: = 'elevated'`
    - [ ] Block if `:cvc_check: = 'fail'` / `:avs_zip_check: = 'fail'`
    - [ ] Review if `:card_country: != :ip_country:`
    - [ ] Velocity: block >~3 cards per IP / 24h
    - [ ] Card / email / IP blocklists
  - **Recommendation:** ship on the free tier now; upgrade to Fraud Teams only
    once real fraud patterns appear.

## Done (cont.)
- [x] **Mimic chest visual** — ported from the owner's preview: lid (back) +
  slabs erupting from the mouth + body (front); lid drops shut when empty,
  pulses when loot is added, cap 5 slabs + "+N". Scales to its column via a
  fit transform. (`app.js` renderChestVisual/fitMimic, `styles.css` .mimic,
  `public/assets/mimic/`). Note: full re-render means the lid open/close
  doesn't tween (it snaps to state) — can be made to animate by persisting the
  element if desired.

## Backlog
- [ ] **Limit / cap Google Maps API usage** — referrer-lock the key + hard
  per-day quota caps in Google Cloud Console (Step 7 of GO_LIVE.md).
- [ ] **USPS-only shipping + require tracking number** — restrict shipping
  options to USPS and require a tracking number before an order can be marked
  fulfilled/shipped. (`shipping.js`, admin fulfillment flow.)
- [ ] **PayPal as a payment option** — note: US Stripe Checkout does not offer
  PayPal, so this needs a separate integration path. Decide approach before
  building.
- [x] **Supabase admin auth (all pages + all endpoints)** — admins sign in with
  email + password via Supabase. Server guard (`functions/_lib/admin.js`,
  used by all 13 admin endpoints) verifies the Supabase access token AND an
  email allowlist; `ADMIN_TOKEN` still works as a break-glass fallback. A shared
  `admin-auth.js` injects a sign-in gate on every admin page (admin, orders,
  marketing, coupons, email-template); the dashboard stays hidden until a valid
  session exists. Degrades gracefully (gate shows "not configured" until keys set).

  **Owner setup required to turn it on:**
  1. Supabase → Authentication → Providers → enable **Email**; turn **OFF**
     "Enable sign-ups" so randoms can't self-register.
  2. Supabase → Authentication → Users → **Add user** (your email + password).
  3. Cloudflare Pages env (Production):
     - `SUPABASE_ANON_KEY` = your project's anon/public key
     - `ADMIN_EMAILS` = comma-separated allowlist (e.g. `you@example.com`)
     - (`SUPABASE_URL` already set; `ADMIN_TOKEN` kept as break-glass)
  4. Redeploy. Until then, the old `ADMIN_TOKEN` still works.
- [ ] **Cloudflare Access** (Step 6b of GO_LIVE.md) — optional hard edge lock in
  front of the admin URLs (defense in depth on top of the app-level auth).
