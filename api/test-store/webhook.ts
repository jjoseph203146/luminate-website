import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getMailer, getStripe, getSupabase, notificationConfig } from './_lib/clients'
import { requireEnv } from './_lib/env'
import { errorMessage, json, log, methodNotAllowed, readRawBody } from './_lib/http'
import { HANDLED_EVENTS, processCheckoutEvent } from './_lib/orders'

// Stripe signs the exact raw bytes of the request, so the body must not be parsed before verification.
export const config = { api: { bodyParser: false } }

/**
 * POST /api/test-store/webhook   (called by Stripe, never by the browser)
 *
 * Response codes matter because Stripe retries on anything that is not 2xx:
 *   400 → bad/missing signature (a forged or misconfigured request; Stripe will not retry a 400 usefully)
 *   200 → handled, duplicate, or intentionally ignored
 *   500 → our infrastructure failed (database / Stripe API) → Stripe redelivers later, and idempotency makes that safe
 * A failed *email* is NOT a 500: the order is already saved, and the notification retry mechanism owns that.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  let stripe
  let secret: string
  try {
    stripe = getStripe()
    secret = requireEnv('TEST_STORE_STRIPE_WEBHOOK_SECRET')
  } catch (err) {
    log('error', 'webhook misconfigured', { error: errorMessage(err) })
    return json(res, 500, { error: 'misconfigured' })
  }

  const signature = req.headers['stripe-signature']
  if (typeof signature !== 'string') return json(res, 400, { error: 'missing_signature' })

  let event
  try {
    const raw = await readRawBody(req)
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch (err) {
    log('warn', 'signature verification failed', { error: errorMessage(err) })
    return json(res, 400, { error: 'invalid_signature' })
  }

  if (!HANDLED_EVENTS.has(event.type)) {
    return json(res, 200, { received: true, ignored: event.type })
  }

  try {
    const result = await processCheckoutEvent(event, {
      stripe,
      sb: getSupabase(),
      mailer: getMailer(),
      config: notificationConfig(),
    })
    return json(res, 200, { received: true, ...result })
  } catch (err) {
    log('error', 'event processing failed; Stripe will retry', { eventId: event.id, error: errorMessage(err) })
    return json(res, 500, { error: 'processing_failed' })
  }
}
