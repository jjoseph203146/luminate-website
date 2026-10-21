import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import Stripe from 'stripe'
import { FakeDb } from './fakes'
import { processCheckoutEvent, type OrderDeps } from '../../api/test-store/_lib/orders'
import { attemptNotification, retryDueNotifications, MAX_ATTEMPTS, type Mailer } from '../../api/test-store/_lib/notify'
import { buildOrderEmail } from '../../api/test-store/_lib/email'
import { stripeTestSecretKey } from '../../api/test-store/_lib/env'

process.env.TEST_STORE_STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.TEST_STORE_STRIPE_WEBHOOK_SECRET = 'whsec_test_dummy'

const WHSEC = 'whsec_test_dummy'
const results: Array<[string, string | null]> = []
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); results.push([name, null]) } catch (e) { results.push([name, e instanceof Error ? e.stack ?? e.message : String(e)]) }
}

// ── helpers ────────────────────────────────────────────────────────────────
function makeSession(over: Partial<Record<string, any>> = {}): any {
  return {
    id: 'cs_test_1', livemode: false, payment_status: 'paid', currency: 'usd', amount_total: 5000,
    payment_intent: 'pi_test_1', metadata: { test_store: 'true' },
    customer_details: { email: 'buyer@example.com', name: 'Test Buyer' },
    collected_information: { shipping_details: { name: 'Test Buyer', address: { line1: '1 Main St', city: 'Augusta', state: 'GA', postal_code: '30901', country: 'US' } } },
    line_items: { data: [{ id: 'li_1', description: 'Luminate Studio Tote (TEST PRODUCT)', quantity: 2, price: { unit_amount: 2500 }, amount_total: 5000 }] },
    ...over,
  }
}
function makeEvent(id: string, session: any, type = 'checkout.session.completed', livemode = false): any {
  return { id, type, livemode, data: { object: { id: session.id, metadata: session.metadata } } }
}
function setup(session: any = makeSession(), mailerBehavior: (n: number) => void = () => {}) {
  const db = new FakeDb()
  const sent: Array<{ subject: string; html: string; text: string; to: string; key: string }> = []
  let calls = 0
  const mailer: Mailer = {
    async send(a) { calls++; mailerBehavior(calls); sent.push({ subject: a.subject, html: a.html, text: a.text, to: a.to, key: a.idempotencyKey }); return { id: `email_${calls}` } },
  }
  let clock = new Date('2026-10-21T12:00:00Z')
  const deps: OrderDeps = {
    stripe: { checkout: { sessions: { retrieve: async () => session } } } as any,
    sb: db as any, mailer, config: { to: 'owner@example.com', from: 'Test <onboarding@resend.dev>' }, now: () => clock,
  }
  return { db, deps, sent, advance: (ms: number) => { clock = new Date(clock.getTime() + ms) }, calls: () => calls }
}

async function main() {
  // ── security ────────────────────────────────────────────────────────────
  await test('live Stripe keys are refused', () => {
    process.env.TEST_STORE_STRIPE_SECRET_KEY = 'sk_live_abc'
    assert.throws(() => stripeTestSecretKey(), /TEST key/)
    process.env.TEST_STORE_STRIPE_SECRET_KEY = 'sk_test_dummy'
    assert.equal(stripeTestSecretKey(), 'sk_test_dummy')
  })

  await test('webhook rejects missing / forged / tampered signatures and accepts a valid one', async () => {
    const handler = require('../../api/test-store/webhook').default as (req: any, res: any) => Promise<unknown>
    const body = JSON.stringify({ id: 'evt_x', object: 'event', type: 'customer.created', livemode: false, data: { object: {} } })
    const call = async (headers: Record<string, string>, payload = body) => {
      const req: any = Readable.from([Buffer.from(payload)]); req.method = 'POST'; req.headers = headers
      const out: any = { headers: {} as any, setHeader(k: string, v: string) { this.headers[k] = v }, status(c: number) { this.code = c; return this }, json(b: any) { this.body = b } }
      await handler(req, out); return out
    }
    assert.equal((await call({})).code, 400)
    assert.equal((await call({ 'stripe-signature': 't=1,v1=deadbeef' })).code, 400)
    const good = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({ payload: body, secret: WHSEC })
    assert.equal((await call({ 'stripe-signature': good }, body.replace('customer.created', 'customer.deleted'))).code, 400)
    const ok = await call({ 'stripe-signature': good })
    assert.equal(ok.code, 200)
    assert.equal(ok.body.ignored, 'customer.created') // verified, but not an event we act on
  })

  // ── order processing ────────────────────────────────────────────────────
  await test('paid checkout → one order, items saved, one email with products, quantity, total, fulfillment status', async () => {
    const s = setup()
    const r = await processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps)
    assert.equal(r.status, 'processed')
    assert.equal(s.db.tables.test_store_orders.length, 1)
    assert.equal(s.db.tables.test_store_orders[0].fulfillment_status, 'new')
    assert.equal(s.db.tables.test_store_order_items.length, 1)
    assert.equal(s.db.tables.test_store_notifications[0].status, 'sent')
    assert.equal(s.sent.length, 1)
    const m = s.sent[0]
    assert.equal(m.to, 'owner@example.com')
    assert.match(m.text, /Luminate Studio Tote \(TEST PRODUCT\) × 2/)
    assert.match(m.text, /Total: \$50\.00/)
    assert.match(m.text, /Fulfillment status: new/)
    assert.match(m.subject, /New order .* \$50\.00/)
  })

  await test('the same event delivered twice does not duplicate the order or the email', async () => {
    const s = setup()
    const ev = makeEvent('evt_1', makeSession())
    await processCheckoutEvent(ev, s.deps)
    const again = await processCheckoutEvent(ev, s.deps)
    assert.equal(again.status, 'duplicate')
    assert.equal(s.db.tables.test_store_orders.length, 1)
    assert.equal(s.sent.length, 1)
  })

  await test('two different events for the same payment (completed + async_payment_succeeded) make one order', async () => {
    const s = setup()
    await processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps)
    await processCheckoutEvent(makeEvent('evt_2', makeSession(), 'checkout.session.async_payment_succeeded'), s.deps)
    assert.equal(s.db.tables.test_store_orders.length, 1)
    assert.equal(s.db.tables.test_store_order_items.length, 1)
    assert.equal(s.db.tables.test_store_notifications.length, 1)
    assert.equal(s.sent.length, 1)
  })

  await test('simultaneous deliveries of the same event (race) still produce one order and one email', async () => {
    const s = setup()
    const ev = makeEvent('evt_1', makeSession())
    await Promise.all([processCheckoutEvent(ev, s.deps), processCheckoutEvent(ev, s.deps), processCheckoutEvent(ev, s.deps)])
    assert.equal(s.db.tables.test_store_orders.length, 1)
    assert.equal(s.db.tables.test_store_order_items.length, 1)
    assert.equal(s.sent.length, 1)
  })

  await test('unpaid sessions are skipped, and saved once the async payment succeeds', async () => {
    const unpaid = makeSession({ payment_status: 'unpaid' })
    const s = setup(unpaid)
    assert.equal((await processCheckoutEvent(makeEvent('evt_1', unpaid), s.deps)).status, 'skipped_unpaid')
    assert.equal(s.db.tables.test_store_orders.length, 0)
    const paid = makeSession()
    const s2 = { ...s.deps, stripe: { checkout: { sessions: { retrieve: async () => paid } } } as any }
    assert.equal((await processCheckoutEvent(makeEvent('evt_2', paid, 'checkout.session.async_payment_succeeded'), s2)).status, 'processed')
    assert.equal(s.db.tables.test_store_orders.length, 1)
  })

  await test('live-mode events and non-test-store sessions are ignored', async () => {
    const s = setup()
    assert.equal((await processCheckoutEvent(makeEvent('evt_live', makeSession(), 'checkout.session.completed', true), s.deps)).status, 'ignored')
    const other = makeSession({ metadata: {} })
    assert.equal((await processCheckoutEvent(makeEvent('evt_other', other), s.deps)).status, 'ignored')
    assert.equal(s.db.tables.test_store_orders.length, 0)
    assert.equal(s.db.tables.test_store_webhook_events.length, 0)
  })

  await test('a live-mode session fetched from Stripe is refused and nothing is saved', async () => {
    const s = setup(makeSession({ livemode: true }))
    await assert.rejects(processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps), /live-mode/)
    assert.equal(s.db.tables.test_store_orders.length, 0)
  })

  await test('database outage → throws (webhook answers 500, Stripe retries), then the redelivery succeeds exactly once', async () => {
    const s = setup()
    s.db.failWrites.test_store_orders = 1
    const ev = makeEvent('evt_1', makeSession())
    await assert.rejects(processCheckoutEvent(ev, s.deps), /simulated database outage/)
    assert.equal(s.db.tables.test_store_webhook_events[0].status, 'failed')
    assert.equal((await processCheckoutEvent(ev, s.deps)).status, 'processed')
    assert.equal(s.db.tables.test_store_orders.length, 1)
    assert.equal(s.sent.length, 1)
  })

  // ── notification retries ────────────────────────────────────────────────
  await test('email failure keeps the order, records the error, and a later retry delivers it', async () => {
    const s = setup(makeSession(), (n) => { if (n === 1) throw new Error('Resend is down') })
    const r = await processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps)
    assert.equal(r.status === 'processed' && r.notification, 'failed')
    assert.equal(s.db.tables.test_store_orders.length, 1)
    const n = s.db.tables.test_store_notifications[0]
    assert.equal(n.status, 'failed'); assert.equal(n.attempts, 1); assert.match(n.last_error, /Resend is down/)
    // Not due yet → sweep does nothing.
    assert.deepEqual(await retryDueNotifications(s.deps), { attempted: 0, sent: 0, failed: 0 })
    s.advance(61_000) // past the 60s backoff
    assert.deepEqual(await retryDueNotifications(s.deps), { attempted: 1, sent: 1, failed: 0 })
    assert.equal(s.db.tables.test_store_notifications[0].status, 'sent')
    assert.equal(s.calls(), 2)
    s.advance(10 * 60_000)
    assert.equal((await retryDueNotifications(s.deps)).attempted, 0) // sent → never retried again
  })

  await test('backoff grows, and after the max attempts the notification is parked as dead', async () => {
    const s = setup(makeSession(), () => { throw new Error('always failing') })
    await processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps)
    const waits: number[] = []
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const n = s.db.tables.test_store_notifications[0]
      waits.push(new Date(n.next_retry_at).getTime() - new Date('2026-10-21T12:00:00Z').getTime())
      s.advance(7 * 3600_000)
      await retryDueNotifications(s.deps)
    }
    const n = s.db.tables.test_store_notifications[0]
    assert.equal(n.status, 'dead'); assert.equal(n.attempts, MAX_ATTEMPTS); assert.equal(n.next_retry_at, null)
    assert.ok(waits[0] === 60_000 && waits[1] > 0, 'first backoff is 60s')
    const before = s.calls()
    s.advance(24 * 3600_000)
    await retryDueNotifications(s.deps)
    assert.equal(s.calls(), before, 'dead notifications are not retried')
  })

  await test('an in-flight (fresh) "sending" notification is not claimed twice; an abandoned one is recovered', async () => {
    const s = setup()
    await processCheckoutEvent(makeEvent('evt_1', makeSession()), s.deps)
    const n = s.db.tables.test_store_notifications[0]
    Object.assign(n, { status: 'sending', updated_at: s.deps.now!().toISOString() })
    assert.equal(await attemptNotification(s.deps, n.id), 'skipped')
    s.advance(6 * 60_000) // looks crashed
    assert.equal(await attemptNotification(s.deps, n.id), 'sent')
  })

  await test('customer-supplied text is HTML-escaped in the email', () => {
    const e = buildOrderEmail({ id: 'abcdef123456', stripe_session_id: 'cs_1', currency: 'usd', amount_total: 100, fulfillment_status: 'new', created_at: '', customer_email: 'a@b.c', customer_name: '<script>alert(1)</script>', items: [{ name: '<img onerror=x>', quantity: 1, unit_amount: 100, amount_total: 100 }] })
    assert.ok(!e.html.includes('<script>') && !e.html.includes('<img onerror'))
    assert.ok(e.html.includes('&lt;script&gt;'))
  })

  const failed = results.filter(([, err]) => err)
  for (const [name, err] of results) console.log(`${err ? '✗' : '✓'} ${name}${err ? `\n    ${err.split('\n').slice(0, 4).join('\n    ')}` : ''}`)
  console.log(`\n${results.length - failed.length}/${results.length} passed`)
  process.exit(failed.length ? 1 : 0)
}
main()
