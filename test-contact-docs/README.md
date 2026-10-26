# Luminate Test Contact Page — Resend transactional email test

A **temporary, non-indexed** page at **`/test-contact`** that sends two branded emails through Resend when submitted:

1. a **confirmation** to the person who filled in the form (thank-you + a summary of what they sent), and
2. a separate **internal notification** to your business email (reply-to is set to the submitter).

It is completely separate from the production contact form on the homepage (which still posts to LuminateOS and Formspree).
Nothing existing was changed: it only adds files, plus a `/test-contact` rewrite, a `noindex` header, and a `robots.txt` line.

> Note: this site is a static site with Vercel serverless functions, not a Next.js app, so this is built the same way as the
> earlier test store: a static page + an API route in `api/test-contact/` + React Email templates.

## How it works

```
/test-contact  ──GET /api/test-contact──►  signed form token (+ optional Turnstile site key)
      │
      └─POST /api/test-contact──► same-origin check ► rate limit ► honeypot ► token/time check ► (Turnstile)
                                  ► server validation ► approved-address check ► secure log
                                  ► React Email render ► Resend (confirmation + internal)
```

| File | Purpose |
|---|---|
| `test-contact/index.html` | The form page (loading state, field errors, success panel, honeypot). `noindex`. |
| `api/test-contact/index.ts` | The only endpoint: GET = token, POST = submit. All checks happen here, server-side. |
| `api/test-contact/_lib/validate.ts` | Server validation + sanitising (strips control characters → no email-header injection). |
| `api/test-contact/_lib/bot.ts` | Honeypot support, HMAC-signed timed form token, optional Cloudflare Turnstile verification. |
| `api/test-contact/_lib/ratelimit.ts` | Rate limiting (Upstash Redis if configured, else in-memory). |
| `api/test-contact/_lib/config.ts` | Reads/validates env vars, **test-mode recipient allow-list** and the final recipient guard. |
| `api/test-contact/_lib/templates.ts` | React Email templates (navy + cream, responsive, all content HTML-escaped). |
| `api/test-contact/_lib/send.ts` | Renders HTML + plain text and sends both emails with Resend (idempotency keys per submission). |

## Safety design

- **Approved addresses only (test mode, default).** The submitter's email must be in `TEST_CONTACT_ALLOWED_EMAILS`, and a second check
  right before sending refuses *any* recipient not on that list. So even if every other protection failed, the page cannot email a stranger.
  `TEST_CONTACT_NOTIFY_EMAIL` must also be on the list (the app refuses to start otherwise).
- **Kill switch:** nothing responds unless `TEST_CONTACT_ENABLED` is exactly `true`.
- **Secrets stay on the server.** `RESEND_API_KEY` is only read in `api/`. The page contains no keys.
- **Rate limiting:** 5 submissions / 10 min per visitor and 30 / hour overall (HTTP 429 + `Retry-After`).
- **Bot protection:** hidden honeypot field (bots get a fake "success"), a signed form token that must be 3 s – 2 h old, same-origin only,
  JSON only, optional Cloudflare Turnstile (turns on automatically when its two keys are set).
- **Secure logging:** each submission is logged to Vercel Logs as a reference id, a short hash of the email and visitor, and field *lengths*.
  The name, email, subject and message are **never** written to logs, and this page does not store submissions in a database.
- **Not indexed:** `<meta robots noindex>`, an `X-Robots-Tag: noindex` header, a `Disallow` in `robots.txt`, and it is not in the sitemap.

## Setup — what you need to do

### 1. Resend: verify your sending domain
1. Resend dashboard → **Domains → Add Domain** → `luminatewebdesign.com`.
2. Add the DNS records Resend shows (SPF, DKIM and optionally DMARC) at your domain registrar, then click **Verify**.
   (Until it is verified you can still test with `onboarding@resend.dev`, which only delivers to the email address on your Resend account.)
3. **API Keys → Create API Key** (sending access is enough). Copy it once.

### 2. Vercel environment variables
Vercel → your project → **Settings → Environment Variables**. Add these for **Production** (add Preview too if you want to test on preview deployments):

| Name | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Your Resend key. Server-only. |
| `TEST_CONTACT_ENABLED` | `true` | Master switch. Set to anything else to turn the page off instantly. |
| `TEST_CONTACT_FROM_EMAIL` | `Luminate <hello@luminatewebdesign.com>` | Must be an address on your **verified** Resend domain. |
| `TEST_CONTACT_NOTIFY_EMAIL` | `you@luminatewebdesign.com` | Where the internal notification goes. Must also be in the allowed list. |
| `TEST_CONTACT_ALLOWED_EMAILS` | `you@example.com, you@luminatewebdesign.com` | Comma-separated approved test addresses (submitter + notify address). |
| `TEST_CONTACT_SECRET` | 32+ random characters | Signs the form token. Generate with `openssl rand -hex 32`. |

Optional hardening:

| Name | Notes |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Free Upstash Redis database → makes rate limits shared across all serverless instances. Without it limits are per instance (the allow-list is still the backstop). |
| `TEST_CONTACT_TURNSTILE_SITE_KEY`, `TEST_CONTACT_TURNSTILE_SECRET_KEY` | From Cloudflare Turnstile (free). Adds a visible challenge to the form. |
| `TEST_CONTACT_RESTRICT` | Leave unset. Setting it to `off` lifts the approved-address restriction — only do that deliberately, later, after you have reviewed the page. |

After adding or changing variables, **redeploy** (Deployments → ⋯ → Redeploy). Environment variables only apply to new deployments.
Mark `RESEND_API_KEY`, `TEST_CONTACT_SECRET` and the Upstash/Turnstile secrets as **Sensitive** so they can't be read back in the dashboard.

## How to test it yourself

1. Open `https://luminatewebdesign.com/test-contact`.
2. Use one of your approved addresses as the email, fill the other fields, and wait a few seconds (the form rejects instant submits), then **Send test message**.
3. You should see the loading state, then the success panel with a reference id. Two emails arrive: the confirmation (to the submitter) and the internal notification
   (to `TEST_CONTACT_NOTIFY_EMAIL`, reply goes to the submitter). Check both on your phone as well — the layout is responsive.
4. Try the safety rails:
   - an email that is **not** approved → "test mode" message, nothing sent;
   - submit 6 times quickly → a rate-limit message (HTTP 429);
   - submit immediately after the page loads → "a little fast" message;
   - an invalid email / empty message → field-level errors.
5. Check Vercel → **Logs** for the structured entries (`submission received`, `emails sent`) and confirm no personal content appears.
6. Automated tests (no accounts needed): `npm install && npm run test:test-contact` — 18 tests covering validation, header injection, tokens,
   rate limiting, the recipient guard, rendering/escaping, every handler rejection path, and "no personal data in logs".

## When you're done
Set `TEST_CONTACT_ENABLED` to `false` (or delete the variable) — the endpoint stops immediately. To remove the page entirely, delete
`api/test-contact/`, `test-contact/`, `test-contact-docs/` and the `/test-contact` entries in `vercel.json` and `robots.txt`.

## Known limits
- Submissions are logged, not stored; if you want a database record, add a table and one insert before the send step.
- Without Upstash, rate limits are best-effort per serverless instance.
- Email clients can't load web fonts, so the emails use Georgia/system fonts as stand-ins for Playfair Display/Inter.
