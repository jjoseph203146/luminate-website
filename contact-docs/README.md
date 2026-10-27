# Production contact form — Resend (replaces Formspree)

The homepage "Start your project" form (`#connect`) no longer posts to Formspree. It now posts to our own server route,
**`/api/contact`**, which sends the emails through **Resend**:

1. an **internal notification** to your business email (reply-to is the visitor, so you can just hit Reply), and
2. a branded **confirmation** to the visitor with a copy of what they sent (can be switched off).

The existing LuminateOS lead push (`/api/leads/create`, fire-and-forget) is unchanged and still runs on every submission,
so a lead is never lost even if email delivery has a problem.

## What changed
| File | Change |
|---|---|
| `index.html` | The Formspree call is replaced by a call to `/api/contact`. Layout, fields and look are unchanged. The existing hidden `botcheck` checkbox is now the honeypot. A signed form token is fetched the first time someone starts typing (no extra request on plain page views). |
| `api/contact/index.ts` | The endpoint: same-origin + JSON only, rate limit, honeypot, token/timing check, server validation, then Resend. |
| `api/contact/_lib/*` | Validation, token/bot helpers, rate limiter, config, React Email templates, Resend sender. |
| `package.json` | Adds `react`, `react-dom`, `@react-email/*` (email templates). `resend` was already present. |

## Environment variables (Vercel → Settings → Environment Variables)

| Name | Value | Notes |
|---|---|---|
| `RESEND_API_KEY` | `re_…` | Server-only. Mark **Sensitive**. |
| `CONTACT_FROM_EMAIL` | `Luminate <hello@luminatewebdesign.com>` | Must be on your **verified** Resend domain. |
| `CONTACT_NOTIFY_EMAIL` | your business inbox | Where inquiries arrive. |
| `CONTACT_SECRET` | 32+ random characters | Signs the anti-bot token. `openssl rand -hex 32`. Mark Sensitive. |
| `CONTACT_SEND_CONFIRMATION` | *(unset)* | Set to `off` to stop sending the visitor confirmation (owner notification still sends). |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | *(optional)* | Shares rate limits across all serverless instances. |

Enable each for the environment you test in: **Preview** to try it on the branch preview, **Production** before it goes live on `main`.
Redeploy after changing variables. The old `TEST_CONTACT_*` variables are no longer used and can be deleted.

If a variable is missing, Vercel Logs show `"msg":"misconfigured"` with the exact variable name, and visitors see the form's normal
"Something went wrong… email us directly" message.

## Protections
- **Rate limit:** 5 submissions per 10 min per visitor, 60 per hour overall (429 + `Retry-After`).
- **Bot protection:** honeypot checkbox (bots get a fake "success"), HMAC-signed token that must be 3 s – 2 h old, same-origin only.
- **Validation:** done on the server; control characters are stripped so email headers cannot be injected; all values are HTML-escaped in emails.
- **Logging:** PII-free (reference id, short hashes, lengths). Name, email, phone and message are never logged.
- **Secrets:** `RESEND_API_KEY` is only read on the server.
- **Failure behavior:** if the owner notification can't be sent the visitor sees an error and can retry or email directly (and LuminateOS still has the lead).
  If only the visitor confirmation fails, the submission still counts as sent and a warning is logged.

## Testing
- Automated: `npm install && npm run test:contact` (13 tests: validation, injection, tokens, rate limit, rendering/escaping, every rejection path, no PII in logs).
- By hand: submit the live form, confirm the notification arrives (reply-to = the visitor) and the confirmation arrives, and check Vercel Logs.
