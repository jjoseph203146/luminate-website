import assert from 'node:assert/strict'
import { validateSubmission } from '../../api/contact/_lib/validate'
import { loadConfig } from '../../api/contact/_lib/config'
import { createFormToken, verifyFormToken, MIN_AGE_MS, MAX_AGE_MS } from '../../api/contact/_lib/bot'
import { rateLimit, _resetMemoryLimiter } from '../../api/contact/_lib/ratelimit'
import { sendSubmissionEmails, type MailMessage, type Mailer } from '../../api/contact/_lib/send'

const SECRET = 'x'.repeat(40)
const BASE_ENV: Record<string, string> = {
  RESEND_API_KEY: 're_test_dummy',
  CONTACT_FROM_EMAIL: 'Luminate <hello@luminatewebdesign.com>',
  CONTACT_NOTIFY_EMAIL: 'owner@luminatewebdesign.com',
  CONTACT_SECRET: SECRET,
}
function setEnv(over: Record<string, string | undefined> = {}) {
  for (const k of Object.keys(process.env)) if (k.startsWith('CONTACT_') || k === 'RESEND_API_KEY' || k.startsWith('UPSTASH_')) delete process.env[k]
  for (const [k, v] of Object.entries({ ...BASE_ENV, ...over })) if (v !== undefined) process.env[k] = v
}

const results: Array<[string, string | null]> = []
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push([name, null]) } catch (e) { results.push([name, e instanceof Error ? e.stack ?? e.message : String(e)]) }
}

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
const goodBody = (token: string, over: Record<string, unknown> = {}) => ({
  name: 'Jane Whitfield', email: 'jane@example.com', business: 'Whitfield Catering', phone: '(706) 555-0123', about: 'Catering in Evans',
  projectType: 'Website Design & Build', message: 'I need a new website with online inquiries.', botcheck: false, token, ...over,
})
async function newHandler(mailer: Mailer, env: Record<string, string | undefined> = {}) {
  setEnv(env); _resetMemoryLimiter()
  let clock = 1_800_000_000_000
  const { createHandler } = require('../../api/contact/index') as typeof import('../../api/contact/index')
  const handler = createHandler({ mailer: () => mailer, now: () => clock })
  const advance = (ms: number) => { clock += ms }
  const token = async () => { const r = fakeRes(); await handler(fakeReq('GET'), r); return r.body.token as string }
  return { handler, advance, token }
}

async function main() {
  await test('valid submissions pass; optional fields may be empty; values are trimmed', () => {
    const r = validateSubmission({ name: '  Ada   Lovelace ', email: ' ada@example.com ', message: 'Hello\r\nthere' })
    assert.ok(r.ok); if (r.ok) { assert.equal(r.value.name, 'Ada Lovelace'); assert.equal(r.value.business, ''); assert.equal(r.value.message, 'Hello\nthere') }
  })
  await test('invalid input is rejected with per-field errors', () => {
    const r = validateSubmission({ name: 'A', email: 'nope', phone: 'abc', message: '' })
    assert.ok(!r.ok); if (!r.ok) assert.deepEqual(Object.keys(r.errors).sort(), ['email', 'message', 'name', 'phone'])
    assert.ok(!validateSubmission({ name: 'Ok Name', email: 'a@b.co', message: 'x'.repeat(3001) }).ok)
    assert.ok(!validateSubmission(null).ok); assert.ok(!validateSubmission({ name: ['a'], email: 5 }).ok)
  })
  await test('header-injection attempts are neutralised', () => {
    const r = validateSubmission({ name: 'Eve\r\nBcc: x@y.z', email: 'a@b.co', business: 'Biz\nBcc: z', message: 'ten chars ok' })
    assert.ok(r.ok); if (r.ok) assert.ok(!/[\r\n]/.test(r.value.name + r.value.business))
    assert.ok(!validateSubmission({ name: 'Eve Smith', email: 'a@b.co\r\nBcc: x@y.z', message: 'ten chars ok' }).ok)
  })
  await test('config fails loudly with a helpful hint, and rejects short secrets', () => {
    setEnv({ RESEND_API_KEY: undefined }); assert.throws(() => loadConfig(), /Missing environment variables: RESEND_API_KEY \[.*no similarly named variable/)
    setEnv(); process.env['RESEND_API_KEY '] = 're_x'; delete process.env.RESEND_API_KEY
    assert.throws(() => loadConfig(), /similar names present: "RESEND_API_KEY "/)
    setEnv({ CONTACT_SECRET: 'short' }); assert.throws(() => loadConfig(), /32 characters/)
    setEnv(); assert.equal(loadConfig().sendConfirmation, true)
    setEnv({ CONTACT_SEND_CONFIRMATION: 'off' }); assert.equal(loadConfig().sendConfirmation, false)
  })
  await test('form tokens: accepted after the minimum age; too fast / expired / tampered / wrong secret rejected', () => {
    const t0 = 1_000_000, tok = createFormToken(SECRET, t0)
    assert.equal(verifyFormToken(tok, SECRET, t0 + 100), 'too_fast')
    assert.equal(verifyFormToken(tok, SECRET, t0 + MIN_AGE_MS + 1), 'ok')
    assert.equal(verifyFormToken(tok, SECRET, t0 + MAX_AGE_MS + 1), 'expired')
    assert.equal(verifyFormToken(tok.slice(0, -2) + 'aa', SECRET, t0 + 5000), 'invalid')
    assert.equal(verifyFormToken(tok, 'y'.repeat(40), t0 + 5000), 'invalid')
    assert.equal(verifyFormToken(undefined, SECRET), 'invalid')
  })
  await test('rate limiter blocks after the limit, resets after the window, and uses Upstash with fallback', async () => {
    _resetMemoryLimiter(); let t = 0; const o = { env: {}, now: () => t }
    for (let i = 0; i < 3; i++) assert.equal((await rateLimit('k', 3, 60, o)).allowed, true)
    assert.equal((await rateLimit('k', 3, 60, o)).allowed, false)
    t += 61_000; assert.equal((await rateLimit('k', 3, 60, o)).allowed, true)
    const env = { UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }; let n = 0
    const ok: typeof fetch = async () => new Response(JSON.stringify([{ result: ++n }, { result: 1 }, { result: 42 }]))
    await rateLimit('u', 1, 60, { env, fetchImpl: ok }); assert.equal((await rateLimit('u', 1, 60, { env, fetchImpl: ok })).retryAfterSeconds, 42)
    _resetMemoryLimiter(); const down: typeof fetch = async () => { throw new Error('net') }
    assert.equal((await rateLimit('d', 1, 60, { env, fetchImpl: down })).allowed, true); assert.equal((await rateLimit('d', 1, 60, { env, fetchImpl: down })).allowed, false)
  })
  await test('emails render every field with branding and escape user content; reply-to is the visitor', async () => {
    setEnv(); const cfg = loadConfig(); const { sent, mailer } = makeMailer()
    await sendSubmissionEmails(cfg, mailer, { name: '<b>Eve</b> Test', email: 'eve@example.com', business: 'Eve <script>x</script> LLC', phone: '706-555-0100', about: 'About <i>me</i>', projectType: 'Personal Website', message: 'Line one\nLine <img src=x onerror=alert(1)> two' }, { reference: 'ABC12345', visitorRef: 'v1' })
    const [internal, confirm] = sent
    assert.deepEqual(internal.to, ['owner@luminatewebdesign.com']); assert.deepEqual(confirm.to, ['eve@example.com'])
    assert.equal(internal.replyTo, 'eve@example.com'); assert.match(internal.subject, /^New project inquiry — /); assert.ok(!/[\r\n]/.test(internal.subject))
    for (const m of sent) { assert.ok(!m.html.includes('<script>') && !m.html.includes('<img src=x') && !m.html.includes('<b>Eve')); assert.ok(m.html.includes('#0D1B2E') && m.html.includes('#E8E2D4')); assert.ok(m.text.length > 50); assert.ok(!/TEST EMAIL/.test(m.html)) }
    assert.match(confirm.html, /Thank you,/); assert.match(confirm.html, /Personal Website/); assert.match(confirm.html, /706-555-0100/)
  })
  await test('confirmation can be switched off; a failed confirmation does not fail the submission; a failed notification does', async () => {
    setEnv({ CONTACT_SEND_CONFIRMATION: 'off' }); let m = makeMailer()
    await sendSubmissionEmails(loadConfig(), m.mailer, { name: 'Jane Doe', email: 'j@example.com', business: '', phone: '', about: '', projectType: '', message: 'hello there' }, { reference: 'R', visitorRef: 'v' })
    assert.equal(m.sent.length, 1)
    setEnv(); m = makeMailer((x) => x.to[0] === 'j@example.com')
    const r = await sendSubmissionEmails(loadConfig(), m.mailer, { name: 'Jane Doe', email: 'j@example.com', business: '', phone: '', about: '', projectType: '', message: 'hello there' }, { reference: 'R', visitorRef: 'v' })
    assert.equal(r.confirmation, null); assert.match(String(r.confirmationError), /boom/)
    m = makeMailer((x) => x.to[0].startsWith('owner@'))
    await assert.rejects(sendSubmissionEmails(loadConfig(), m.mailer, { name: 'Jane Doe', email: 'j@example.com', business: '', phone: '', about: '', projectType: '', message: 'hello there' }, { reference: 'R', visitorRef: 'v' }), /internal notification failed/)
  })

  await test('happy path: two emails, success reply, and no personal data in logs', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const logs: string[] = []; const o1 = console.log, o2 = console.error; console.log = (...a: any[]) => { logs.push(a.join(' ')) }; console.error = console.log
    try {
      const token = await h.token(); h.advance(MIN_AGE_MS + 500)
      const res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { message: 'SECRET-MESSAGE-BODY call me' })), res)
      assert.equal(res.code, 200); assert.equal(res.body.ok, true); assert.equal(sent.length, 2)
    } finally { console.log = o1; console.error = o2 }
    const all = logs.join('\n'); assert.ok(all.includes('submission received'))
    for (const pii of ['SECRET-MESSAGE-BODY', 'jane@example.com', 'Jane Whitfield', '555-0123', 'Whitfield Catering']) assert.ok(!all.includes(pii), `log leaked ${pii}`)
  })
  await test('honeypot, fast submissions, and missing/forged tokens are rejected without sending', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(5000)
    let res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { botcheck: true })), res); assert.equal(res.body.reference, 'ignored')
    const fresh = await h.token(); res = fakeRes(); await h.handler(fakeReq('POST', goodBody(fresh)), res); assert.equal(res.body.error, 'token_too_fast')
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody('forged.token.value')), res); assert.equal(res.body.error, 'token_invalid')
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody(undefined as any)), res); assert.equal(res.body.error, 'token_invalid')
    assert.equal(sent.length, 0)
  })
  await test('validation returns 422; rate limit returns 429 after 5 posts', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    let res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token, { name: '', email: 'bad' })), res)
    assert.equal(res.code, 422); assert.ok(res.body.errors.name && res.body.errors.email); assert.equal(sent.length, 0)
    const codes: number[] = []
    for (let i = 0; i < 6; i++) { const r = fakeRes(); await h.handler(fakeReq('POST', goodBody(token)), r); codes.push(r.code); res = r }
    assert.deepEqual(codes, [200, 200, 200, 200, 429, 429]); assert.ok(Number(res.headers['Retry-After']) > 0)
  })
  await test('cross-origin, wrong content type, and wrong method are refused', async () => {
    const { sent, mailer } = makeMailer(); const h = await newHandler(mailer)
    const token = await h.token(); h.advance(4000)
    let res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token), { origin: 'https://evil.example' }), res); assert.equal(res.code, 403)
    res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token), { 'content-type': 'text/plain' }), res); assert.equal(res.code, 415)
    res = fakeRes(); await h.handler(fakeReq('DELETE'), res); assert.equal(res.code, 405); assert.equal(sent.length, 0)
  })
  await test('delivery failure → friendly 502 with no provider details; misconfiguration → 503 without leaking', async () => {
    const { mailer } = makeMailer((m) => m.to[0].startsWith('owner@')); let h = await newHandler(mailer)
    let token = await h.token(); h.advance(4000)
    let res = fakeRes(); await h.handler(fakeReq('POST', goodBody(token)), res)
    assert.equal(res.code, 502); assert.ok(!res.body.ok); assert.ok(!JSON.stringify(res.body).includes('boom'))
    h = await newHandler(makeMailer().mailer, { RESEND_API_KEY: undefined })
    res = fakeRes(); await h.handler(fakeReq('GET'), res); assert.equal(res.code, 503); assert.deepEqual(res.body, { error: 'unavailable' })
  })

  const failed = results.filter(([, e]) => e)
  for (const [n, e] of results) console.log(`${e ? '✗' : '✓'} ${n}${e ? `\n    ${e.split('\n').slice(0, 5).join('\n    ')}` : ''}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
main()
