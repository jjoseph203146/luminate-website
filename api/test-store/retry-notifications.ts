import type { VercelRequest, VercelResponse } from '@vercel/node'
import { hasRetrySecret, isAdmin, isSafeMutation } from './_lib/auth'
import { getMailer, getSupabase, notificationConfig } from './_lib/clients'
import { errorMessage, json, log, methodNotAllowed } from './_lib/http'
import { retryDueNotifications } from './_lib/notify'

/**
 * POST /api/test-store/retry-notifications
 * Re-sends order emails that failed earlier (respecting each one's backoff time).
 * Callable by: a logged-in admin, or any scheduler holding TEST_STORE_RETRY_SECRET as a Bearer token.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const viaSecret = hasRetrySecret(req)
  if (!viaSecret && !(isAdmin(req) && isSafeMutation(req))) return json(res, 401, { error: 'unauthorized' })

  try {
    const result = await retryDueNotifications({ sb: getSupabase(), mailer: getMailer(), config: notificationConfig() }, 20)
    log('info', 'retry sweep complete', result)
    return json(res, 200, result)
  } catch (err) {
    log('error', 'retry sweep failed', { error: errorMessage(err) })
    return json(res, 500, { error: 'retry_failed' })
  }
}
