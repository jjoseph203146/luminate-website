import type { SupabaseClient } from '@supabase/supabase-js'
import { buildOrderEmail, type OrderEmailData } from './email'
import { errorMessage, log } from './http'

export interface Mailer {
  send(args: { to: string; from: string; subject: string; html: string; text: string; idempotencyKey: string }): Promise<{ id: string }>
}

export interface NotifyDeps {
  sb: SupabaseClient
  mailer: Mailer
  config: { to: string; from: string }
  now?: () => Date
}

/** Seconds to wait before retry #1, #2, … Exponential-ish: 1m, 5m, 15m, 1h, 6h. */
export const BACKOFF_SECONDS = [60, 300, 900, 3600, 21600]
/** After this many failed attempts the notification is parked as 'dead' and shown in the admin page. */
export const MAX_ATTEMPTS = 6
/** A 'sending' row older than this is assumed to belong to a crashed invocation and can be re-claimed. */
export const STALE_SENDING_SECONDS = 300

export type AttemptResult = 'sent' | 'failed' | 'dead' | 'skipped'

export function backoffFor(attempt: number): number {
  return BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)]
}

/**
 * Try to deliver one notification.
 *
 * Concurrency: the attempt is "claimed" with an optimistic lock — an UPDATE that only succeeds if
 * `attempts` still has the value we read. If two invocations race (webhook + retry sweep), exactly one
 * wins the claim and the other returns 'skipped', so we never double-send.
 */
export async function attemptNotification(deps: NotifyDeps, notificationId: string): Promise<AttemptResult> {
  const { sb, mailer, config } = deps
  const now = deps.now ?? (() => new Date())

  const { data: n, error: readErr } = await sb.from('test_store_notifications').select('*').eq('id', notificationId).maybeSingle()
  if (readErr) throw new Error(`read notification: ${readErr.message}`)
  if (!n) return 'skipped'
  if (n.status === 'sent' || n.status === 'dead') return 'skipped'
  // Another invocation is mid-send. Only take over if it looks abandoned (crashed / timed out).
  if (n.status === 'sending' && now().getTime() - new Date(n.updated_at).getTime() < STALE_SENDING_SECONDS * 1000) return 'skipped'

  const attempt: number = n.attempts + 1
  const { data: claimed, error: claimErr } = await sb
    .from('test_store_notifications')
    .update({ status: 'sending', attempts: attempt, updated_at: now().toISOString() })
    .eq('id', notificationId)
    .eq('attempts', n.attempts)
    .in('status', ['pending', 'failed', 'sending'])
    .select()
  if (claimErr) throw new Error(`claim notification: ${claimErr.message}`)
  if (!claimed || claimed.length === 0) {
    log('info', 'notification already claimed by another invocation', { notificationId })
    return 'skipped'
  }

  try {
    const order = await loadOrderForEmail(sb, n.order_id)
    const email = buildOrderEmail(order)
    const result = await mailer.send({
      to: config.to,
      from: config.from,
      subject: email.subject,
      html: email.html,
      text: email.text,
      // Scoped to the attempt: a retried attempt is a new send, but a duplicate delivery of the same attempt is not.
      idempotencyKey: `test-store-order-${n.order_id}-attempt-${attempt}`,
    })
    await sb
      .from('test_store_notifications')
      .update({ status: 'sent', sent_at: now().toISOString(), resend_email_id: result.id, last_error: null, updated_at: now().toISOString() })
      .eq('id', notificationId)
    log('info', 'notification sent', { notificationId, orderId: n.order_id, attempt })
    return 'sent'
  } catch (err) {
    const message = errorMessage(err).slice(0, 500)
    const dead = attempt >= MAX_ATTEMPTS
    const next = new Date(now().getTime() + backoffFor(attempt) * 1000)
    await sb
      .from('test_store_notifications')
      .update({
        status: dead ? 'dead' : 'failed',
        last_error: message,
        next_retry_at: dead ? null : next.toISOString(),
        updated_at: now().toISOString(),
      })
      .eq('id', notificationId)
    log(dead ? 'error' : 'warn', dead ? 'notification permanently failed' : 'notification failed, will retry', {
      notificationId,
      orderId: n.order_id,
      attempt,
      error: message,
      nextRetryAt: dead ? null : next.toISOString(),
    })
    return dead ? 'dead' : 'failed'
  }
}

/** Re-attempt every notification whose retry time has arrived (plus 'sending' rows abandoned by a crash). */
export async function retryDueNotifications(deps: NotifyDeps, limit = 10): Promise<{ attempted: number; sent: number; failed: number }> {
  const { sb } = deps
  const now = (deps.now ?? (() => new Date()))()
  const staleBefore = new Date(now.getTime() - STALE_SENDING_SECONDS * 1000).toISOString()

  const { data: due, error: e1 } = await sb
    .from('test_store_notifications')
    .select('id')
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', now.toISOString())
    .order('next_retry_at', { ascending: true })
    .limit(limit)
  if (e1) throw new Error(`list due notifications: ${e1.message}`)

  const { data: stale, error: e2 } = await sb
    .from('test_store_notifications')
    .select('id')
    .eq('status', 'sending')
    .lt('updated_at', staleBefore)
    .limit(limit)
  if (e2) throw new Error(`list stale notifications: ${e2.message}`)

  const ids = [...(due ?? []), ...(stale ?? [])].map((r) => r.id as string).slice(0, limit)
  let sent = 0
  let failed = 0
  for (const id of ids) {
    const r = await attemptNotification(deps, id)
    if (r === 'sent') sent++
    else if (r === 'failed' || r === 'dead') failed++
  }
  return { attempted: ids.length, sent, failed }
}

/** Admin "Retry now": reset a failed/dead notification so the next sweep (or this call) picks it up. */
export async function requeueNotification(deps: NotifyDeps, orderId: string): Promise<AttemptResult> {
  const { sb } = deps
  const { data: n } = await sb.from('test_store_notifications').select('id,status').eq('order_id', orderId).maybeSingle()
  if (!n || n.status === 'sent') return 'skipped'
  await sb
    .from('test_store_notifications')
    .update({ status: 'failed', next_retry_at: new Date().toISOString(), attempts: 0 })
    .eq('id', n.id)
  return attemptNotification(deps, n.id)
}

async function loadOrderForEmail(sb: SupabaseClient, orderId: string): Promise<OrderEmailData> {
  const { data: order, error } = await sb.from('test_store_orders').select('*').eq('id', orderId).single()
  if (error || !order) throw new Error(`load order: ${error?.message ?? 'not found'}`)
  const { data: items, error: itemsErr } = await sb.from('test_store_order_items').select('*').eq('order_id', orderId).order('created_at', { ascending: true })
  if (itemsErr) throw new Error(`load items: ${itemsErr.message}`)
  return { ...order, items: items ?? [] } as OrderEmailData
}
