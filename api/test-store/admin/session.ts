import type { VercelRequest, VercelResponse } from '@vercel/node'
import { clearSession, isAdmin, isSafeMutation, issueSession, loginThrottled, passwordMatches } from '../_lib/auth'
import { errorMessage, json, log, methodNotAllowed } from '../_lib/http'

/**
 * GET    → { authed: boolean }
 * POST   { password } → sets an HttpOnly, SameSite=Strict, HMAC-signed session cookie
 * DELETE → clears the cookie
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') return json(res, 200, { authed: isAdmin(req) })

    if (req.method === 'POST') {
      if (!isSafeMutation(req)) return json(res, 400, { error: 'bad_request' })
      const ip = String(req.headers['x-forwarded-for'] ?? 'unknown').split(',')[0].trim()
      if (loginThrottled(ip)) return json(res, 429, { error: 'too_many_attempts' })
      await new Promise((r) => setTimeout(r, 400)) // slows password guessing
      if (!passwordMatches(String(req.body?.password ?? ''))) {
        log('warn', 'admin login failed')
        return json(res, 401, { error: 'wrong_password' })
      }
      issueSession(res, req)
      return json(res, 200, { authed: true })
    }

    if (req.method === 'DELETE') {
      clearSession(res, req)
      return json(res, 200, { authed: false })
    }

    return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  } catch (err) {
    log('error', 'admin session error', { error: errorMessage(err) })
    return json(res, 500, { error: 'server_error' })
  }
}
