import crypto from 'crypto'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createFormToken, hashForLog, verifyFormToken, verifyTurnstile } from './_lib/bot'
import { isEnabled, loadConfig, normalizeEmail } from './_lib/config'
import { rateLimit } from './_lib/ratelimit'
import { resendMailer, sendSubmissionEmails, type Mailer } from './_lib/send'
import { validateSubmission } from './_lib/validate'

/** Structured, PII-free logs: ids, hashes and lengths only — never the name, email, or message. */
function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), scope: 'test-contact', level, msg, ...ctx })
  if (level === 'error') console.error(line)
  else console.log(line)
}

function send(res: VercelResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
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
  fetchImpl?: typeof fetch
  now?: () => number
}

export function createHandler(deps: HandlerDeps = {}) {
  return async function handler(req: VercelRequest, res: VercelResponse) {
    // Kill switch: nothing is exposed unless TEST_CONTACT_ENABLED is exactly "true".
    if (!isEnabled()) return send(res, 503, { error: 'unavailable' })

    let cfg
    try {
      cfg = loadConfig()
    } catch (err) {
      log('error', 'misconfigured', { error: err instanceof Error ? err.message : String(err) })
      return send(res, 503, { error: 'unavailable' })
    }
    const ip = clientIp(req)
    const now = deps.now ?? Date.now

    // ── GET: hand out a signed form token (and the public Turnstile site key if enabled) ─────────────
    if (req.method === 'GET') {
      const rl = await rateLimit(`tc:get:${ip}`, 60, 600, { now })
      if (!rl.allowed) return send(res, 429, { error: 'rate_limited' }, { 'Retry-After': String(rl.retryAfterSeconds) })
      return send(res, 200, { token: createFormToken(cfg.secret, now()), turnstileSiteKey: cfg.turnstile?.siteKey ?? null, restricted: cfg.restricted })
    }

    if (req.method !== 'POST') return send(res, 405, { error: 'method_not_allowed' }, { Allow: 'GET, POST' })
    if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' })
    if (!String(req.headers['content-type'] ?? '').includes('application/json')) return send(res, 415, { error: 'unsupported_media_type' })
    const body = req.body
    if (!body || typeof body !== 'object' || JSON.stringify(body).length > 12_000) return send(res, 400, { error: 'bad_request' })

    // ── Rate limiting: per visitor and overall, before doing any other work ─────────────────────────
    const perIp = await rateLimit(`tc:post:${ip}`, 5, 600, { now })
    const global = await rateLimit('tc:post:global', 30, 3600, { now })
    if (!perIp.allowed || !global.allowed) {
      const retry = Math.max(perIp.allowed ? 0 : perIp.retryAfterSeconds, global.allowed ? 0 : global.retryAfterSeconds)
      log('warn', 'rate limited', { visitor: hashForLog(ip), scope: perIp.allowed ? 'global' : 'ip' })
      return send(res, 429, { error: 'rate_limited', message: 'Too many submissions. Please try again later.' }, { 'Retry-After': String(retry) })
    }

    // ── Bot protection ─────────────────────────────────────────────────────────────────────────────
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      log('warn', 'honeypot triggered', { visitor: hashForLog(ip) })
      return send(res, 200, { ok: true, reference: 'ignored' }) // look successful so bots don't adapt
    }
    const tokenCheck = verifyFormToken(body.token, cfg.secret, now())
    if (tokenCheck !== 'ok') {
      log('warn', 'form token rejected', { reason: tokenCheck, visitor: hashForLog(ip) })
      const message = tokenCheck === 'too_fast' ? 'That was a little fast. Please wait a moment and submit again.' : 'Your session expired. Please refresh the page and try again.'
      return send(res, 400, { error: `token_${tokenCheck}`, message })
    }
    if (cfg.turnstile && !(await verifyTurnstile(body.turnstileToken, ip, cfg.turnstile.secretKey, deps.fetchImpl))) {
      log('warn', 'turnstile failed', { visitor: hashForLog(ip) })
      return send(res, 400, { error: 'challenge_failed', message: 'Verification failed. Please try again.' })
    }

    // ── Server-side validation ─────────────────────────────────────────────────────────────────────
    const parsed = validateSubmission(body)
    if (!parsed.ok) return send(res, 422, { error: 'validation_failed', errors: parsed.errors })
    const submission = parsed.value

    // ── Test-mode restriction: only approved addresses may submit ──────────────────────────────────
    if (cfg.restricted && !cfg.allowed.has(normalizeEmail(submission.email))) {
      log('warn', 'blocked: address not approved for testing', { email: hashForLog(submission.email), visitor: hashForLog(ip) })
      return send(res, 403, { error: 'not_approved', message: 'This page is in test mode. Only the approved test email address can submit it.' })
    }

    // ── Securely log the submission (identifiers only; no personal content) ────────────────────────
    const reference = crypto.randomUUID().slice(0, 8).toUpperCase()
    log('info', 'submission received', {
      reference,
      email: hashForLog(submission.email),
      visitor: hashForLog(ip),
      lengths: { name: submission.name.length, subject: submission.subject.length, message: submission.message.length },
    })

    try {
      const mailer = (deps.mailer ?? resendMailer)(cfg.resendApiKey)
      const result = await sendSubmissionEmails(cfg, mailer, submission, { reference, visitorRef: hashForLog(ip) })
      log('info', 'emails sent', { reference, confirmationId: result.confirmation.id, internalId: result.internal.id })
      return send(res, 200, { ok: true, reference })
    } catch (err) {
      const e = err as Error & { partial?: unknown }
      log('error', 'email delivery failed', { reference, error: e.message, partial: e.partial })
      return send(res, 502, { error: 'delivery_failed', message: "We couldn't send your confirmation right now. Please try again in a few minutes." })
    }
  }
}

export default createHandler()
