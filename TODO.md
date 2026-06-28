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
  - Code: request level for 3DS on the Checkout Session.
  - Dashboard (Stripe): Radar rules (block/review by risk score, 3DS on elevated
    risk, blocklists, velocity rules). See notes when implemented.

## Backlog
- [ ] **Box / treasure SVG update** — refresh the chest/treasure artwork used in
  the shop + chest UI. (Details TBD — what new look/asset do we want?)
- [ ] **Limit / cap Google Maps API usage** — referrer-lock the key + hard
  per-day quota caps in Google Cloud Console (Step 7 of GO_LIVE.md).
- [ ] **USPS-only shipping + require tracking number** — restrict shipping
  options to USPS and require a tracking number before an order can be marked
  fulfilled/shipped. (`shipping.js`, admin fulfillment flow.)
- [ ] **PayPal as a payment option** — note: US Stripe Checkout does not offer
  PayPal, so this needs a separate integration path. Decide approach before
  building.
- [ ] **Admin login gating** — failed login should return a blank page / bounce
  back to the admin login instead of exposing the dashboard. Pair with
  Cloudflare Access (Step 6b of GO_LIVE.md) for defense in depth.
