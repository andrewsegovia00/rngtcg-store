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
- [x] **Admin login gating (admin.html)** — dashboard now starts locked behind a
  full-screen login gate; the token is verified against `/api/admin-overview`
  before anything renders. Bad/empty token bounces back to the gate; a token
  that stops working mid-session re-locks. (`admin.html`, `admin.css`, `admin.js`)
- [ ] **Extend login gate to other admin pages** — orders.html, marketing.html,
  coupons.html, email-template.html still show their shell unauthenticated
  (data is token-protected, but the UI is visible). Apply the same gate.
- [ ] **Cloudflare Access** (Step 6b of GO_LIVE.md) — the real lock (the JS gate
  is convenience/defense-in-depth, not a security boundary on its own).
