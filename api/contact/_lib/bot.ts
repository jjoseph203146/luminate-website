import crypto from 'crypto'

/**
 * Bot protection, layered (all server-verified):
 *  1. Honeypot field (the form's hidden `botcheck` checkbox) — real people never tick it.
 *  2. Signed, timed form token — the page fetches a token when it loads; the server requires it to be genuine
 *     (HMAC), at least MIN_AGE old (bots submit instantly) and not older than MAX_AGE.
 */
export const MIN_AGE_MS = 3_000
export const MAX_AGE_MS = 2 * 60 * 60 * 1000

function sign(secret: string, payload: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

export function createFormToken(secret: string, now = Date.now()): string {
  const payload = `${now}.${crypto.randomBytes(8).toString('hex')}`
  return `${payload}.${sign(secret, payload)}`
}

export type TokenCheck = 'ok' | 'invalid' | 'too_fast' | 'expired'

export function verifyFormToken(token: unknown, secret: string, now = Date.now()): TokenCheck {
  if (typeof token !== 'string') return 'invalid'
  const parts = token.split('.')
  if (parts.length !== 3) return 'invalid'
  const [ts, nonce, mac] = parts
  const expected = sign(secret, `${ts}.${nonce}`)
  const a = Buffer.from(mac)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return 'invalid'
  const age = now - Number(ts)
  if (!Number.isFinite(age) || age < 0) return 'invalid'
  if (age < MIN_AGE_MS) return 'too_fast'
  if (age > MAX_AGE_MS) return 'expired'
  return 'ok'
}

export function hashForLog(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 12)
}
