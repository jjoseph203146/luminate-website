import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { errorMessage, log } from './http'
import { attemptNotification, retryDueNotifications, type NotifyDeps } from './notify'

export interface OrderDeps extends NotifyDeps {
  stripe: Stripe
}

/** Events that mean "money has actually been collected for a Checkout Session". */
export const HANDLED_EVENTS = new Set(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])

export type ProcessResult =
  | { status: 'ignored'; reason: string }
  | { status: 'duplicate' }
  | { status: 'skipped_unpaid' }
  | { status: 'processed'; orderId: string; notification: 'sent' | 'failed' | 'dead' | 'skipped' }

const UNIQUE_VIOLATION = '23505'

/**
 * Turn one verified Stripe event into (at most) one order and one notification.
 *
 * Idempotency has three independent layers, so a repeated or concurrent delivery can never create a duplicate:
 *   1. test_store_webhook_events.event_id is the primary key — the same event id is only "new" once.
 *   2. test_store_orders.stripe_session_id is UNIQUE — even a *different* event for the same payment
 *      (e.g. completed + async_payment_succeeded) maps to the same order row.
 *   3. test_store_order_items (order_id, stripe_line_item_id) and test_store_notifications.order_id are UNIQUE.
 *
 * Throws on infrastructure errors (database / Stripe API) so the webhook answers 500 and Stripe retries.
 */
export async function processCheckoutEvent(event: Stripe.Event, deps: OrderDeps): Promise<ProcessResult> {
  const { sb, stripe } = deps
  const eventSession = event.data.object as Stripe.Checkout.Session

  // Only handle sessions created by /api/test-store/checkout.
  if (eventSession.metadata?.test_store !== 'true') return { status: 'ignored', reason: 'not_a_test_store_session' }
  if (event.livemode) return { status: 'ignored', reason: 'livemode_event_rejected' }

  // ── Layer 1: record the event id. A conflict means we have seen this event before.
  const { error: insertErr } = await sb.from('test_store_webhook_events').insert({ event_id: event.id, event_type: event.type })
  if (insertErr) {
    if (insertErr.code !== UNIQUE_VIOLATION) throw new Error(`record event: ${insertErr.message}`)
    const { data: prior } = await sb.from('test_store_webhook_events').select('status').eq('event_id', event.id).maybeSingle()
    if (prior && (prior.status === 'processed' || prior.status === 'skipped')) {
      log('info', 'duplicate event ignored', { eventId: event.id })
      return { status: 'duplicate' }
    }
    log('info', 'resuming previously interrupted event', { eventId: event.id })
  }

  try {
    // Re-read the session from Stripe instead of trusting the payload we were sent.
    const session = await stripe.checkout.sessions.retrieve(eventSession.id, { expand: ['line_items'] })
    if (session.livemode) throw new Error('Refusing to process a live-mode session')

    if (session.payment_status !== 'paid') {
      await sb.from('test_store_webhook_events').update({ status: 'skipped', processed_at: new Date().toISOString() }).eq('event_id', event.id)
      log('info', 'session not paid yet; waiting for async_payment_succeeded', { eventId: event.id, sessionId: session.id })
      return { status: 'skipped_unpaid' }
    }

    const orderId = await saveOrder(sb, session)
    const notificationId = await ensureNotification(sb, orderId)
    const notification = await attemptNotification(deps, notificationId)

    await sb.from('test_store_webhook_events').update({ status: 'processed', error: null, processed_at: new Date().toISOString() }).eq('event_id', event.id)
    log('info', 'order processed', { eventId: event.id, orderId, notification })

    // Opportunistic retry sweep: no cron required for failed emails to eventually go out.
    try {
      await retryDueNotifications(deps, 3)
    } catch (e) {
      log('warn', 'retry sweep failed', { error: errorMessage(e) })
    }

    return { status: 'processed', orderId, notification }
  } catch (err) {
    await sb.from('test_store_webhook_events').update({ status: 'failed', error: errorMessage(err).slice(0, 500) }).eq('event_id', event.id)
    throw err
  }
}

async function saveOrder(sb: SupabaseClient, session: Stripe.Checkout.Session): Promise<string> {
  const shipping = session.collected_information?.shipping_details ?? null

  const { error: upsertErr } = await sb.from('test_store_orders').upsert(
    {
      stripe_session_id: session.id,
      stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : (session.payment_intent?.id ?? null),
      customer_email: session.customer_details?.email ?? null,
      customer_name: session.customer_details?.name ?? null,
      shipping: shipping ? { name: shipping.name, address: shipping.address } : null,
      currency: session.currency ?? 'usd',
      amount_total: session.amount_total ?? 0,
      payment_status: session.payment_status,
      livemode: false,
    },
    { onConflict: 'stripe_session_id', ignoreDuplicates: true },
  )
  if (upsertErr) throw new Error(`save order: ${upsertErr.message}`)

  const { data: order, error: readErr } = await sb.from('test_store_orders').select('id').eq('stripe_session_id', session.id).single()
  if (readErr || !order) throw new Error(`read order: ${readErr?.message ?? 'not found'}`)

  const lineItems = session.line_items?.data ?? []
  if (lineItems.length > 0) {
    const { error: itemsErr } = await sb.from('test_store_order_items').upsert(
      lineItems.map((li) => ({
        order_id: order.id,
        stripe_line_item_id: li.id,
        name: li.description ?? 'Item',
        quantity: li.quantity ?? 1,
        unit_amount: li.price?.unit_amount ?? 0,
        amount_total: li.amount_total,
      })),
      { onConflict: 'order_id,stripe_line_item_id', ignoreDuplicates: true },
    )
    if (itemsErr) throw new Error(`save items: ${itemsErr.message}`)
  }
  return order.id as string
}

async function ensureNotification(sb: SupabaseClient, orderId: string): Promise<string> {
  const { error } = await sb.from('test_store_notifications').upsert({ order_id: orderId }, { onConflict: 'order_id', ignoreDuplicates: true })
  if (error) throw new Error(`create notification: ${error.message}`)
  const { data, error: readErr } = await sb.from('test_store_notifications').select('id').eq('order_id', orderId).single()
  if (readErr || !data) throw new Error(`read notification: ${readErr?.message ?? 'not found'}`)
  return data.id as string
}
