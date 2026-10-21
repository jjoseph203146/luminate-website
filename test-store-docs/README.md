# Luminate Test Store — order notification workflow (Stripe sandbox)

An isolated sandbox storefront at **`/test-store`** that shows the full e-commerce notification pipeline:

```
Buyer ─► /test-store ─► POST /api/test-store/checkout ─► Stripe Checkout (sandbox)
                                                              │ payment succeeds
                                                              ▼
              Stripe ─► POST /api/test-store/webhook  (signature verified)
                                │
                                ├─► Supabase: test_store_orders / _order_items   (idempotent)
                                └─► Resend: "New order" email to your test inbox  (logged + retried)

You ─► /test-store/admin (password) ─► orders, fulfillment status, email status, retry button
```

Nothing here touches your real billing: all variables are prefixed `TEST_STORE_`, the code refuses any Stripe key that is
not `sk_test_…`/`rk_test_…`, the database is a separate Supabase project, and the tables reject live-mode data.

## What each file does

| File | Purpose |
|---|---|
| `test-store/index.html` | The storefront page (one sample product). Only sends `{productId, quantity}` to the server. |
| `test-store/admin/index.html` | Password-protected admin UI. Contains no data itself; it calls the authenticated API. |
| `api/test-store/checkout.ts` | Creates the Stripe Checkout Session. The **price lives on the server** (`_lib/products.ts`), so it can't be tampered with. |
| `api/test-store/webhook.ts` | Receives Stripe events, **verifies the signature on the raw body**, saves the order, sends the email. |
| `api/test-store/_lib/orders.ts` | Event → order logic with three layers of idempotency (see below). |
| `api/test-store/_lib/notify.ts` | Sending the email + logging + retry/backoff + concurrency lock. |
| `api/test-store/_lib/email.ts` | The email template (escapes all customer-supplied text). |
| `api/test-store/retry-notifications.ts` | Re-sends failed emails whose backoff time has arrived. |
| `api/test-store/admin/session.ts` / `orders.ts` | Login (signed HttpOnly cookie) and the admin data API. |
| `test-store-docs/schema.sql` | Database tables. Run once in a **new** Supabase project. |
| `test-store-docs/tests/` | Automated tests (`npm run test:test-store`). |

## Why it's built this way

- **Webhook, not the success page.** The browser can close or lie; Stripe's server-to-server webhook is the source of truth
  for "this was really paid". The `success_url` only shows a friendly message.
- **Signature verification** proves a request really came from Stripe. Without it anyone could POST a fake "paid" event.
- **Idempotency**, because Stripe deliberately delivers events *at least once* (retries, replays, duplicates):
  1. `test_store_webhook_events.event_id` is a primary key — the same event id is only processed once.
  2. `test_store_orders.stripe_session_id` is `UNIQUE` — two *different* events about one payment still make one order.
  3. `(order_id, stripe_line_item_id)` and `test_store_notifications.order_id` are `UNIQUE` — no duplicate items or emails.
  Concurrent deliveries are covered by these database constraints plus an optimistic lock on the notification row.
- **Status codes drive Stripe's retries.** `400` bad signature · `200` handled/duplicate/ignored · `500` database or Stripe API
  failure (Stripe redelivers; idempotency makes that safe). A failed *email* returns `200`, because the order is safely saved and the
  notification retry system owns that problem.
- **Email retries:** attempts back off 1 min → 5 min → 15 min → 1 h → 6 h, then the notification is marked `dead` (visible in admin).
  Retries run (a) after every order, (b) from the admin "Retry" buttons, and (c) from any scheduler you point at
  `POST /api/test-store/retry-notifications` with `Authorization: Bearer $TEST_STORE_RETRY_SECRET` (optional).
- **Secrets stay on the server.** Stripe secret key, webhook secret, Resend key and Supabase service-role key are only read in
  `api/` functions. The browser pages contain none of them. RLS is enabled with **no policies** on every table, so even the public
  Supabase anon key can read nothing. Customer data is only returned by the cookie-protected admin API.
- **Logging:** structured JSON lines (ids and statuses, never emails/addresses/keys) in Vercel → Project → Logs.
  Per-order email state (`status`, `attempts`, `last_error`) and per-event state are stored in the database and shown in admin.

## Setup — what you need to do

### 1. Supabase (separate test project)
1. Create a **new** project at supabase.com (name it e.g. `luminate-test-store`). Do not use your Luminate OS project.
2. SQL Editor → paste all of `test-store-docs/schema.sql` → Run.
3. Project Settings → API → copy the **Project URL** and the **service_role** key (keep it secret).

### 2. Stripe sandbox
1. In the Stripe Dashboard, switch to your **sandbox / test mode** (toggle top-right). Everything below happens there.
2. Developers → API keys → copy the **Secret key** (`sk_test_…`).
3. Developers → Webhooks → **Add endpoint**:
   - Endpoint URL: `https://luminatewebdesign.com/api/test-store/webhook`
   - Events: `checkout.session.completed` and `checkout.session.async_payment_succeeded`
4. Open the new endpoint → **Signing secret → Reveal** → copy `whsec_…`.
   This is a *sandbox-only* endpoint, so it cannot affect your live webhooks.

### 3. Resend
1. Create an API key at resend.com/api-keys.
2. With no verified domain, use the default sender `onboarding@resend.dev` — Resend only delivers it to **the email address of your Resend account**,
   so set `TEST_STORE_NOTIFY_EMAIL` to that address. To send elsewhere, verify a domain and set `TEST_STORE_FROM_EMAIL`.

### 4. Vercel environment variables
Project → Settings → Environment Variables. Add every variable in `test-store-docs/.env.example` (Production scope), then **redeploy**
(env vars only apply to new deployments). `TEST_STORE_ENABLED` must be `true` or checkout returns "unavailable".

### 5. Local testing (optional)
```
npm i -g vercel stripe            # Stripe CLI: https://docs.stripe.com/stripe-cli
cp test-store-docs/.env.example .env.local   # fill in values (git-ignored)
vercel dev                        # serves site + /api on http://localhost:3000
stripe listen --forward-to localhost:3000/api/test-store/webhook
```
`stripe listen` prints its own `whsec_…` — use that as `TEST_STORE_STRIPE_WEBHOOK_SECRET` locally.

## How to test it yourself

1. **Happy path.** Open `/test-store` → Buy → card `4242 4242 4242 4242`, any future date, any CVC, any ZIP. You land back on
   `/test-store?status=success`. Within seconds: an email arrives (products, quantity, total, fulfillment status) and
   `/test-store/admin` shows the order as `new`, email `sent`.
2. **Fulfillment.** In admin, change the status to `shipped` and refresh — it persists.
3. **Duplicate delivery (idempotency).** Stripe Dashboard → Developers → Webhooks → your endpoint → the event → **Resend**.
   The response says `"status":"duplicate"`; there is still one order and no second email.
4. **Bad signature.** `curl -X POST https://luminatewebdesign.com/api/test-store/webhook -d '{}'` → `400`.
5. **Email failure + retry.** Temporarily change `TEST_STORE_RESEND_API_KEY` to a wrong value, redeploy, place an order. The order is saved;
   admin shows *Email failed · 1 attempt* with the error. Restore the key, redeploy, click **Retry email now** (or **Retry failed emails**).
6. **Declined / 3-D Secure cards.** `4000 0000 0000 0002` (declined) creates no order; `4000 0025 0000 3155` exercises authentication.
7. **Automated tests (no accounts needed):** `npm install && npm run test:test-store` — 14 tests covering signatures, idempotency,
   races, outages, retries, backoff and HTML escaping.

## Turning it off
Set `TEST_STORE_ENABLED` to anything other than `true` (checkout stops immediately), and/or delete the sandbox webhook endpoint in Stripe.
Test data lives only in the separate Supabase project and can be deleted with it.

## Known limits (it's a learning project)
- Only the first 10 line items of a session are saved (one product here, so irrelevant).
- One sample product, US shipping only, no tax/discounts/refund handling.
- The login throttle is per warm serverless instance; the strong password is the real protection.
- Vercel logs are short-lived on free plans; the database keeps the durable email/event status.
