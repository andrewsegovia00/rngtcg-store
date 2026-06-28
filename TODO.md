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
- [x] **Supabase admin auth — Google sign-in (all pages + all endpoints)** —
  admins sign in with **Google** via Supabase OAuth. Server guard
  (`functions/_lib/admin.js`, used by all 13 admin endpoints) verifies the
  Supabase access token AND an email allowlist; `ADMIN_TOKEN` stays as a
  break-glass fallback. Shared `admin-auth.js` injects a "Continue with Google"
  gate on every admin page; the UI only unlocks after the server confirms the
  signed-in Google account is on the allowlist (non-admins never see the
  dashboard). Degrades gracefully (gate shows "not configured" until keys set).

  **Owner setup required to turn it on:**
  1. Google Cloud Console → APIs & Services → Credentials → create an **OAuth
     2.0 Client ID** (type: Web application). Authorized redirect URI:
     `https://<your-project-ref>.supabase.co/auth/v1/callback`.
  2. Supabase → Authentication → Providers → **Google** → paste the Client ID +
     Secret, enable it.
  3. Supabase → Authentication → URL Configuration → add your admin URLs to
     **Redirect URLs** (e.g. `https://rngtcg.com/**`) and set the Site URL.
  4. Cloudflare Pages env (Production):
     - `SUPABASE_ANON_KEY` = your project's anon / publishable key
     - `ADMIN_EMAILS` = the Google account email(s) allowed, comma-separated
     - (`SUPABASE_URL` already set; `ADMIN_TOKEN` kept as break-glass)
  5. Redeploy. Until then, the old `ADMIN_TOKEN` still works.
- [ ] **Cloudflare Access** (Step 6b of GO_LIVE.md) — optional hard edge lock in
  front of the admin URLs (defense in depth on top of the app-level auth).
