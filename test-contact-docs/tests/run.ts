import assert from 'node:assert/strict'
import { validateSubmission } from '../../api/test-contact/_lib/validate'
import { loadConfig, assertRecipientsAllowed } from '../../api/test-contact/_lib/config'
import { createFormToken, verifyFormToken, MIN_AGE_MS, MAX_AGE_MS } from '../../api/test-contact/_lib/bot'
import { rateLimit, _resetMemoryLimiter } from '../../api/test-contact/_lib/ratelimit'
import { sendSubmissionEmails, type MailMessage, type Mailer } from '../../api/test-contact/_lib/send'

const SECRET = 'x'.repeat(40)
const BASE_ENV: Record<string, string> = {
  TEST_CONTACT_ENABLED: 'true',
  RESEND_API_KEY: 're_test_dummy',
  TEST_CONTACT_FROM_EMAIL: 'Luminate <hello@luminatewebdesign.com>',
  TEST_CONTACT_NOTIFY_EMAIL: 'owner@luminatewebdesign.com',
  TEST_CONTACT_ALLOWED_EMAILS: 'Tester@Example.com, owner@luminatewebdesign.com',
  TEST_CONTACT_SECRET: SECRET,
}
function setEnv(over: Record<string, string | undefined> = {}) {
  for (const k of Object.keys(process.env)) if (k.startsWith('TEST_CONTACT_') || k === 'RESEND_API_KEY' || k.startsWith('UPSTASH_')) delete process.env[k]
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...over })) if (v !== undefined) process.env[k] = v
}

const results: Array<[string, string | null]> = []
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push([name, null]) } catch (e) { results.push([name, e instanceof Error ? e.stack ?? e.message : String(e)]) }
}

// ── fake request / response / mailer ───────────────────────────────────────
function fakeRes() {
  const r: any = { headers: {} as Record<string, string>, code: 0, body: undefined as any }
  r.setHeader = (k: string, v: string) => { r.headers[k] = v }
  r.status = (c: number) => { r.code = c; return r }
  r.json = (b: any) => { r.body = b; return r }
  return r
}
function fakeReq(method: string, body?: any, headers: Record<string, string> = {}) {
  return { method, body, headers: { host: 'luminatewebdesign.com', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers } } as any
}
function makeMailer(fail?: (m: MailMessage) => boolean) {
  const sent: MailMessage[] = []
  const mailer: Mailer = { async send(m) { if (fail?.(m)) throw new Error('Resend: boom'); sent.push(m); return { id: `em_${sent.length}` } } }
  return { sent, mailer }
}
const goodBody = (token: string, over: Record<string, unknown> = {}) => ({ name: 'Test Person', email: 'tester@example.com', subject: 'Checking in', message: 'Hello Luminate, this is a test message.', website: '', token, ...over })

async function newHandler(mailer: Mailer, env: Record<string, string | undefined> = {}) {
  setEnv(env); _resetMemoryLimiter()
  let clock = 1_800_000_000_000
  const { createHandler } = require('../../api/test-contact/index') as typeof import('../../api/test-contact/index')
  const handler = createHandler({ mailer: () => mailer, now: () => clock })
  const advance = (ms: number) => { clock += ms }
  const token = async () => { const r = fakeRes(); await handler(fakeReq('GET'), r); return r.body.token as string }
  return { handler, advance, token }
}

async function main() {
  // ── validation ──────────────────────────────────────────────────────────
  await test('valid submissions pass and values are trimmed / normalised', () => {
    const r = validateSubmission({ name: '  Ada   Lovelace ', email: ' ada@example.com ', subject: 'Hi there', message: 'A message long enough.\r\nSecond line' })
    assert.ok(r.ok); if (r.ok) { assert.equal(r.value.name, 'Ada Lovelace'); assert.equal(r.value.email, 'ada@example.com'); assert.equal(r.value.message, 'A message long enough.\nSecond line') }
  })
  await test('invalid fields are rejected with per-field errors', () => {
    const r = validateSubmission({ name: 'A', email: 'nope', subject: 'x', message: 'short' })
    assert.ok(!r.ok); if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'message', 'name', 'subject'])
    assert.ok(!validateSubmission({ name: 'Ok Name', email: 'a@b.co', subject: 'Subject', message: 'x'.repeat(2001) }).ok)
    assert.ok(!validateSubmission(null).ok); assert.ok(!validateSubmission({ name: ['a'], email: 5 }).ok)
  })
  await test('header-injection attempts are neutralised in single-line fields and rejected in email', () => {
    const r = validateSubmission({ name: 'Eve\r\nBcc: x@y.z', email: 'a@b.co', subject: 'Hi\r\nBcc: victim@x.com', message: 'ten chars minimum ok' })
    assert.ok(r.ok); if (r.ok) { assert.ok(!/[\r\n]/.test(r.value.name + r.value.subject)) }
    assert.ok(!validateSubmission({ name: 'Eve Smith', email: 'a@b.co\r\nBcc: x@y.z', subject: 'Subject', message: 'ten chars minimum ok' }).ok)
  })

  // ── config ──────────────────────────────────────────────────────────────
  await test('config fails loudly on missing variables and unsafe setups', () => {
    setEnv({ RESEND_API_KEY: undefined, TEST_CONTACT_SECRET: undefined })
    assert.throws(() => loadConfig(), /RESEND_API_KEY.*TEST_CONTACT_SECRET/)
    setEnv({ TEST_CONTACT_SECRET: 'short' }); assert.throws(() => loadConfig(), /32 characters/)
    setEnv({ TEST_CONTACT_NOTIFY_EMAIL: 'stranger@elsewhere.com' }); assert.throws(() => loadConfig(), /NOTIFY_EMAIL must also appear/)
    setEnv({ TEST_CONTACT_NOTIFY_EMAIL: 'stranger@elsewhere.com', TEST_CONTACT_RESTRICT: 'off' }); assert.equal(loadConfig().restricted, false)
    setEnv(); const c = loadConfig(); assert.equal(c.restricted, true); assert.ok(c.allowed.has('tester@example.com')); assert.equal(c.turnstile, undefined)
  })
  await test('recipient guard blocks unapproved addresses while restricted', () => {
    setEnv(); const c = loadConfig()
    assert.doesNotThrow(() => assertRecipientsAllowed(['Tester@example.com', 'Luminate <owner@luminatewebdesign.com>'], c))
    assert.throws(() => assertRecipientsAllowed(['tester@example.com', 'rando@gmail.com'], c), /not an approved/)
  })

  // ── bot protection tokens ───────────────────────────────────────────────
  await test('form tokens: valid after the minimum age; too fast / expired / tampered / wrong secret are rejected', () => {
    const t0 = 1_000_000
    const tok = createFormToken(SECRET, t0)
    assert.equal(verifyFormToken(tok, SECRET, t0 + 100), 'too_fast')
    assert.equal(verifyFormToken(tok, SECRET, t0 + MIN_AGE_MS + 1), 'ok')
    assert.equal(verifyFormToken(tok, SECRET, t0 + MAX_AGE_MS + 1), 'expired')
    assert.equal(verifyFormToken(tok.slice(0, -2) + 'aa', SECRET, t0 + 5000), 'invalid')
    assert.equal(verifyFormToken(tok, 'y'.repeat(40), t0 + 5000), 'invalid')
    assert.equal(verifyFormToken(`${t0 - 999999}.${tok.split('.').slice(1).join('.')}`, SECRET, t0 + 5000), 'invalid')
    assert.equal(verifyFormToken(undefined, SECRET), 'invalid')
  })

  // ── rate limiting ───────────────────────────────────────────────────────
  await test('in-memory rate limit blocks after the limit and resets after the window', async () => {
    _resetMemoryLimiter(); let t = 0
    const o = { env: {}, now: () => t }
    for (let i = 0; i < 3; i++) assert.equal((await rateLimit('k', 3, 60, o)).allowed, true)
    const blocked = await rateLimit('k', 3, 60, o); assert.equal(blocked.allowed, false); assert.ok(blocked.retryAfterSeconds > 0)
    t += 61_000; assert.equal((await rateLimit('k', 3, 60, o)).allowed, true)
  })
  await test('Upstash limiter is used when configured, and falls back to memory if it errors', async () => {
    const env = { UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }
    let n = 0
    const ok: typeof fetch = async () => new Response(JSON.stringify([{ result: ++n }, { result: 1 }, { result: 42 }]))
    assert.equal((await rateLimit('u', 2, 60, { env, fetchImpl: ok })).allowed, true)
    assert.equal((await rateLimit('u', 2, 60, { env, fetchImpl: ok })).allowed, true)
    const third = await rateLimit('u', 2, 60, { env, fetchImpl: ok }); assert.equal(third.allowed, false); assert.equal(third.retryAfterSeconds, 42)
    _resetMemoryLimiter()
    const down: typeof fetch = async () => { throw new Error('network') }
    for (let i = 0; i < 2; i++) assert.equal((await rateLimit('d', 2, 60, { env, fetchImpl: down })).allowed, true)
    assert.equal((await rateLimit('d', 2, 60, { env, fetchImpl: down })).allowed, false)
  })

  // ── email rendering ─────────────────────────────────────────────────────
  await test('emails render with the summary, branding, and escaped user content', async () => {
    setEnv(); const cfg = loadConfig(); const { sent, mailer } = makeMailer()
    await sendSubmissionEmails(cfg, mailer, { name: '<b>Eve</b> Test', email: 'tester@example.com', subject: 'Quote <script>alert(1)</script>', message: 'Line one\nLine <img src=x onerror=alert(1)> two' }, { reference: 'ABC12345', visitorRef: 'v123' })
    const [confirm, internal] = sent
    assert.deepEqual(confirm.to, ['tester@example.com']); assert.deepEqual(internal.to, ['owner@luminatewebdesign.com'])
    assert.equal(internal.replyTo, 'tester@example.com')
    for (const m of sent) { assert.ok(!m.html.includes('<script>') && !m.html.includes('<img src=x')); assert.ok(m.html.includes('#0D1B2E') && m.html.includes('#E8E2D4')); assert.ok(m.text.length > 50) }
    assert.match(confirm.html, /Thank you,/); assert.match(confirm.html, /ABC12345/); assert.match(confirm.html, /Line one/)
    assert.match(confirm.html, /TEST EMAIL/); assert.match(internal.subject, /^\[Test\] New contact: Quote/)
    assert.ok(!/[\r\n]/.test(internal.subject))
  })
  await test('sending refuses unapproved recipients even if the handler checks were bypassed', async () => {
    setEnv(); const cfg = loadConfig(); const { sent, mailer } = makeMailer()
    await assert.rejects(sendSubmissionEmails(cfg, mailer, { name: 'Bad Actor', email: 'victim@gmail.com', subject: 'Subject', message: 'ten chars minimum ok' }, { reference: 'R1', visitorRef: 'v' }), /not an approved/)
    assert.equal(sent.length, 0)
  })

  // ── handler end to end ──────────────────────────────────────────────────
  await test('happy path: validated, two emails sent to the right people, no personal data in logs', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const logs: string[] = []; const orig = console.log; console.log = (...a: any[]) => { logs.push(a.join(' ')) }
    try {
      const token = await h.token(); h.advance(MIN_AGE_MS + 500)
      const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { message: 'SECRET-MESSAGE-BODY please call me' })), res)
      assert.equal(res.code, 200); assert.equal(res.body.ok, true); assert.match(res.body.reference, /^[A-F0-9]{8}$/)
      assert.equal(sent.length, 2)
      assert.equal(res.headers['X-Robots-Tag'], 'noindex, nofollow')
    } finally { console.log = orig }
    const all = logs.join('\n'); assert.ok(all.includes('submission received'))
    assert.ok(!all.includes('SECRET-MESSAGE-BODY') && !all.includes('tester@example.com') && !all.includes('Test Person'), 'logs must not contain personal data')
  })
  await test('submissions from non-approved addresses are blocked and nothing is sent', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(MIN_AGE_MS + 500)
    const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { email: 'stranger@gmail.com' })), res)
    assert.equal(res.code, 403); assert.equal(res.body.error, 'not_approved'); assert.equal(sent.length, 0)
  })
  await test('honeypot, fast submissions, missing/forged tokens are rejected without sending', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token()
    let res = fakeRes(); h.advance(5000); await h.handler(fakeReq('POST', goodBody(token, { website: 'http://spam.example' })), res)
    assert.equal(res.code, 200); assert.equal(res.body.reference, 'ignored')
    const fresh = await h.token(); res = fakeRes(); await h.handler(fakeReq('POST', goodBody(fresh)), res)
    assert.equal(res.code, 400); assert.equal(res.body.error, 'token_too_fast')
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody('forged.token.value')), res); assert.equal(res.body.error, 'token_invalid')
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody(undefined as any)), res); assert.equal(res.body.error, 'token_invalid')
    assert.equal(sent.length, 0)
  })
  await test('server validation returns 422 with field errors', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { name: '', message: 'hi' })), res)
    assert.equal(res.code, 422); assert.ok(res.body.errors.name && res.body.errors.message); assert.equal(sent.length, 0)
  })
  await test('rate limiting returns 429 with Retry-After after 5 posts from one visitor', async () => {
    const { mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    const codes: number[] = []; let last: any
    for (let i = 0; i < 7; i++) { const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token)), res); codes.push(res.code); last = res }
    assert.deepEqual(codes.slice(0, 5), [200, 200, 200, 200, 200]); assert.deepEqual(codes.slice(5), [429, 429])
    assert.ok(Number(last.headers['Retry-After']) > 0)
  })
  await test('cross-origin posts, wrong content type, wrong method, and the kill switch are refused', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    let res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token), { origin: 'https://evil.example' }), res); assert.equal(res.code, 403)
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token), { 'content-type': 'text/plain' }), res); assert.equal(res.code, 415)
    res = fakeRes(); await h.handler(fakeReq('DELETE'), res); assert.equal(res.code, 405)
    const off = await newHandler(mailer, { TEST_CONTACT_ENABLED: 'false' })
    res = fakeRes(); await off.handler(fakeReq('GET'), res); assert.equal(res.code, 503)
    assert.equal(sent.length, 0)
  })
  await test('a delivery failure returns a friendly 502 (and does not claim success)', async () => {
    const { mailer } = makeMailer((m) => m.to[0].startsWith('owner@'))
    const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token)), res)
    assert.equal(res.code, 502); assert.equal(res.body.error, 'delivery_failed'); assert.ok(!res.body.ok)
    assert.ok(!JSON.stringify(res.body).includes('boom'), 'provider errors are not leaked to the browser')
  })
  await test('misconfiguration returns 503 without leaking details', async () => {
    const { mailer } = makeMailer(); const h = await newHandler(mailer, { RESEND_API_KEY: undefined })
    const res = fakeRes(); await h.handler(fakeReq('GET'), res)
    assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'unavailable' })
  })

  const failed = results.filter(([, e]) => e)
  for (const [n, e] of results) console.log(`${e ? '✗' : '✓'} ${n}${e ? `\n    ${e.split('\n').slice(0, 5).join('\n    ')}` : ''}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
main()
