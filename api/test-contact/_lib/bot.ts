import crypto from 'crypto'

/**
 * Bot protection, three layers (all server-verified):
 *  1. Honeypot field — a hidden input real people never fill in.
 *  2. Signed, timed form token — the page fetches a token when it loads; the server requires it to be genuine
 *     (HMAC), at least MIN_AGE old (bots submit instantly) and not older than MAX_AGE.
 *  3. Optional Cloudflare Turnstile challenge, enabled automatically when its keys are configured.
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

export async function verifyTurnstile(
  token: unknown,
  ip: string,
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (typeof token !== 'string' || !token) return false
  try {
    const res = await fetchImpl('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
    })
    const data = (await res.json()) as { success?: boolean }
    return data.success === true
  } catch {
    return false
  }
}

export function hashForLog(value: string): string {
  return crypto.createHash('sha256').update(value.toLowerCase()).digest('hex').slice(0, 12)
}
