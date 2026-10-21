/**
 * Tiny in-memory stand-in for the slice of the Supabase query builder the test store uses.
 * It enforces the same UNIQUE constraints as schema.sql so idempotency can be tested without a network.
 */
type Row = Record<string, any>
const UNIQUE: Record<string, string[][]> = {
  test_store_orders: [['id'], ['stripe_session_id']],
  test_store_order_items: [['id'], ['order_id', 'stripe_line_item_id']],
  test_store_webhook_events: [['event_id']],
  test_store_notifications: [['id'], ['order_id']],
}
const DEFAULTS: Record<string, () => Row> = {
  test_store_orders: () => ({ fulfillment_status: 'new', created_at: new Date().toISOString() }),
  test_store_order_items: () => ({ created_at: new Date().toISOString() }),
  test_store_webhook_events: () => ({ status: 'processing', error: null }),
  test_store_notifications: () => ({ status: 'pending', attempts: 0, last_error: null, next_retry_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
}

let counter = 0
export class FakeDb {
  tables: Record<string, Row[]> = { test_store_orders: [], test_store_order_items: [], test_store_webhook_events: [], test_store_notifications: [] }
  /** Set to make the next N writes to a table fail (simulates a database outage). */
  failWrites: Record<string, number> = {}
  from(table: string) { return new Builder(this, table) }
  violates(table: string, row: Row, ignoreIndex?: number): boolean {
    return this.tables[table].some((r, i) => i !== ignoreIndex && UNIQUE[table].some((cols) => cols.every((c) => row[c] !== undefined && r[c] === row[c])))
  }
  fill(table: string, row: Row): Row {
    const r = { ...DEFAULTS[table](), ...row }
    if (!r.id && table !== 'test_store_webhook_events') r.id = `id-${++counter}`
    return r
  }
}

class Builder implements PromiseLike<{ data: any; error: any }> {
  private op: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private payload: any
  private opts: any = {}
  private filters: Array<(r: Row) => boolean> = []
  private returning = false
  private mode: 'single' | 'maybe' | null = null
  private max: number | null = null
  constructor(private db: FakeDb, private table: string) {}

  select(_cols?: string) { if (this.op === 'select') this.op = 'select'; else this.returning = true; return this }
  insert(p: any) { this.op = 'insert'; this.payload = p; return this }
  upsert(p: any, o: any) { this.op = 'upsert'; this.payload = p; this.opts = o; return this }
  update(p: any) { this.op = 'update'; this.payload = p; return this }
  eq(c: string, v: any) { this.filters.push((r) => r[c] === v); return this }
  in(c: string, v: any[]) { this.filters.push((r) => v.includes(r[c])); return this }
  lte(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] <= v); return this }
  lt(c: string, v: any) { this.filters.push((r) => r[c] != null && r[c] < v); return this }
  order() { return this }
  limit(n: number) { this.max = n; return this }
  maybeSingle() { this.mode = 'maybe'; return this }
  single() { this.mode = 'single'; return this }

  then<T1, T2>(ok?: (v: { data: any; error: any }) => T1 | PromiseLike<T1>, bad?: (e: any) => T2 | PromiseLike<T2>) {
    return Promise.resolve(this.run()).then(ok, bad)
  }

  private run(): { data: any; error: any } {
    const t = this.db.tables[this.table]
    const writes = this.op !== 'select'
    if (writes && (this.db.failWrites[this.table] ?? 0) > 0) {
      this.db.failWrites[this.table]--
      return { data: null, error: { code: 'XX000', message: 'simulated database outage' } }
    }
    if (this.op === 'insert') {
      const row = this.db.fill(this.table, this.payload)
      if (this.db.violates(this.table, row)) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
      t.push(row)
      return { data: null, error: null }
    }
    if (this.op === 'upsert') {
      const rows = Array.isArray(this.payload) ? this.payload : [this.payload]
      for (const p of rows) {
        const row = this.db.fill(this.table, p)
        if (this.db.violates(this.table, row)) { if (this.opts?.ignoreDuplicates) continue }
        else t.push(row)
      }
      return { data: null, error: null }
    }
    let matched = t.filter((r) => this.filters.every((f) => f(r)))
    if (this.max != null) matched = matched.slice(0, this.max)
    if (this.op === 'update') {
      matched.forEach((r) => Object.assign(r, this.payload))
      return { data: this.returning ? matched.map((r) => ({ ...r })) : null, error: null }
    }
    const copies = matched.map((r) => ({ ...r }))
    if (this.mode) return { data: copies[0] ?? null, error: this.mode === 'single' && !copies[0] ? { message: 'no rows' } : null }
    return { data: copies, error: null }
  }
}
