import type { VercelRequest, VercelResponse } from '@vercel/node'
import { isAdmin, isSafeMutation } from '../_lib/auth'
import { getMailer, getSupabase, notificationConfig } from '../_lib/clients'
import { errorMessage, json, log, methodNotAllowed } from '../_lib/http'
import { requeueNotification } from '../_lib/notify'

export const FULFILLMENT_STATUSES = ['new', 'processing', 'shipped', 'delivered', 'cancelled'] as const

/**
 * Admin-only (cookie-gated). Customer data leaves the server only through this authenticated endpoint.
 *   GET   → recent orders with items + email-notification status
 *   PATCH { id, fulfillment_status }  → update fulfillment
 *   POST  { id }                       → retry the order's notification email now
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAdmin(req)) return json(res, 401, { error: 'unauthorized' })

  try {
    const sb = getSupabase()

    if (req.method === 'GET') {
      const { data: orders, error } = await sb
        .from('test_store_orders')
        .select('*, items:test_store_order_items(*), notification:test_store_notifications(*)')
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw new Error(error.message)
      return json(res, 200, { orders })
    }

    if (req.method === 'PATCH') {
      if (!isSafeMutation(req)) return json(res, 400, { error: 'bad_request' })
      const status = String(req.body?.fulfillment_status ?? '')
      if (!(FULFILLMENT_STATUSES as readonly string[]).includes(status)) return json(res, 400, { error: 'invalid_status' })
      const { error } = await sb
        .from('test_store_orders')
        .update({ fulfillment_status: status, updated_at: new Date().toISOString() })
        .eq('id', String(req.body?.id ?? ''))
      if (error) throw new Error(error.message)
      return json(res, 200, { ok: true })
    }

    if (req.method === 'POST') {
      if (!isSafeMutation(req)) return json(res, 400, { error: 'bad_request' })
      const result = await requeueNotification({ sb, mailer: getMailer(), config: notificationConfig() }, String(req.body?.id ?? ''))
      return json(res, 200, { result })
    }

    return methodNotAllowed(res, ['GET', 'PATCH', 'POST'])
  } catch (err) {
    log('error', 'admin orders error', { error: errorMessage(err) })
    return json(res, 500, { error: 'server_error' })
  }
}
