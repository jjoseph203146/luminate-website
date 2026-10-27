import crypto from 'crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createFormToken, hashForLog, verifyFormToken } from './_lib/bot'
import { loadConfig } from './_lib/config'
import { rateLimit } from './_lib/ratelimit'
import { resendMailer, sendSubmissionEmails, type Mailer } from './_lib/send'
import { validateSubmission } from './_lib/validate'

/** Structured, PII-free logs: ids, hashes and lengths only — never the name, email, phone, or message. */
function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), scope: 'contact', level, msg, ...ctx })
  if (level === 'error') console.error(line)
  else console.log(line)
}

function send(res: VercelResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.setHeader('Cache-Control', 'no-store')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.status(status).json(body)
}

function clientIp(req: VercelRequest): string {
  const fwd = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()
  return fwd || String(req.headers['x-real-ip'] ?? 'unknown')
}

function sameOrigin(req: VercelRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(String(origin)).host === req.headers.host
  } catch {
    return false
  }
}

export interface HandlerDeps {
  mailer?: (apiKey: string) => Mailer
  now?: () => number
}

/**
 * GET  /api/contact → { token }   (signed, timed form token, fetched when the visitor starts filling in the form)
 * POST /api/contact → validates, rate-limits, bot-checks, then sends the owner notification (+ visitor confirmation) via Resend.
 */
export function createHandler(deps: HandlerDeps = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    let cfg
    try {
      cfg = loadConfig()
    } catch (err) {
      log('error', 'misconfigured', { error: err instanceof Error ? err.message : String(err) })
      return send(res, 503, { error: 'unavailable' })
    }
    const ip = clientIp(req)
    const now = deps.now ?? Date.now

    if (req.method === 'GET') {
      const rl = await rateLimit(`c:get:${ip}`, 60, 600, { now })
      if (!rl.allowed) return send(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfterSeconds) })
      return send(res, 200, { token: createFormToken(cfg.secret, now()) })
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' })
    if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' })
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'unsupported_media_type' })
    const body = req.body
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 20_000) return send(res, 400, { error: 'bad_request' })

    const perIp = await rateLimit(`c:post:${ip}`, 5, 600, { now })
    const global = await rateLimit('c:post:global', 60, 3600, { now })
    if (!perIp.allowed || !global.allowed) {
      const retry = Math.max(perIp.allowed ? 0 : perIp.retryAfterSeconds, global.allowed ? 0 : global.retryAfterSeconds)
      log('warn', 'rate limited', { visitor: hashForLog(ip), scope: perIp.allowed ? 'global' : 'ip' })
      return send(res, 429, { error: 'rate_limited', message: 'Too many submissions. Please try again later or email us directly.' }, { 'Retry-After': String(retry) })
    }

    // Honeypot: the form's hidden `botcheck` checkbox. Bots get a fake success so they don't adapt.
    if (body.botcheck === true || body.botcheck === 'on' || (typeof body.website === 'string' && body.website.trim() !== '')) {
      log('warn', 'honeypot triggered', { visitor: hashForLog(ip) })
      return send(res, 200, { ok: true, reference: 'ignored' })
    }
    const tokenCheck = verifyFormToken(body.token, cfg.secret, now())
    if (tokenCheck !== 'ok') {
      log('warn', 'form token rejected', { reason: tokenCheck, visitor: hashForLog(ip) })
      return send(res, 400, { error: `token_${tokenCheck}`, message: 'Please refresh the page and try again.' })
    }

    const parsed = validateSubmission(body)
    if (!parsed.ok) return send(res, 422, { error: 'validation_failed', errors: parsed.errors })
    const submission = parsed.value

    const reference = crypto.randomUUID().slice(0, 8).toUpperCase()
    log('info', 'submission received', {
      reference,
      email: hashForLog(submission.email),
      visitor: hashForLog(ip),
      lengths: { name: submission.name.length, message: submission.message.length },
    })

    try {
      const mailer = (deps.mailer ?? resendMailer)(cfg.resendApiKey)
      const result = await sendSubmissionEmails(cfg, mailer, submission, { reference, visitorRef: hashForLog(ip) })
      log('info', 'emails sent', { reference, internalId: result.internal.id, confirmationId: result.confirmation?.id ?? null })
      if (result.confirmationError) log('warn', 'confirmation email failed (owner notification was sent)', { reference, error: result.confirmationError })
      return send(res, 200, { ok: true, reference })
    } catch (err) {
      log('error', 'email delivery failed', { reference, error: err instanceof Error ? err.message : String(err) })
      return send(res, 502, { error: 'delivery_failed', message: "We couldn't send your message right now. Please try again, or email us directly." })
    }
  }
}

export default createHandler()
