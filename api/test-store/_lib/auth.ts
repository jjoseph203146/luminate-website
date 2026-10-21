import crypto from 'crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { requireEnv } from './env'

const COOKIE = 'ts_admin'
const SESSION_SECONDS = 8 * 60 * 60

function mac(payload: string): string {
  return crypto.createHmac('sha256', requireEnv('TEST_STORE_SESSION_SECRET')).update(payload).digest('hex')
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest()
  const hb = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(ha, hb)
}

export function passwordMatches(input: string): boolean {
  return safeEqual(input, requireEnv('TEST_STORE_ADMIN_PASSWORD'))
}

export function issueSession(res: VercelResponse, req: VercelRequest) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SECONDS
  const token = `${exp}.${mac(String(exp))}`
  res.setHeader('Set-Cookie', cookie(token, SESSION_SECONDS, req))
}

export function clearSession(res: VercelResponse, req: VercelRequest) {
  res.setHeader('Set-Cookie', cookie('', 0, req))
}

function cookie(value: string, maxAge: number, req: VercelRequest): string {
  const local = /^(localhost|127\.0\.0\.1)/.test(String(req.headers.host ?? ''))
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${local ? '' : '; Secure'}`
}

export function isAdmin(req: VercelRequest): boolean {
  const raw = String(req.headers.cookie ?? '')
  const match = raw.split(';').map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE}=`))
  if (!match) return false
  const token = match.slice(COOKIE.length + 1)
  const [exp, sig] = token.split('.')
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false
  return safeEqual(sig, mac(exp))
}

/** Bearer-secret auth for an external scheduler hitting the retry endpoint. */
export function hasRetrySecret(req: VercelRequest): boolean {
  const secret = process.env.TEST_STORE_RETRY_SECRET
  if (!secret) return false
  const header = String(req.headers.authorization ?? '')
  return header.startsWith('Bearer ') && safeEqual(header.slice(7), secret)
}

/** CSRF defence for state-changing admin calls: JSON content type + same-origin when an Origin header is sent. */
export function isSafeMutation(req: VercelRequest): boolean {
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(String(origin)).host === req.headers.host
  } catch {
    return false
  }
}

// Best-effort login throttle (per warm serverless instance; the password itself is the real protection).
const attempts = new Map<string, { count: number; resetAt: number }>()
export function loginThrottled(ip: string): boolean {
  const now = Date.now()
  const entry = attempts.get(ip)
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 })
    return false
  }
  entry.count++
  return entry.count > 10
}
