export interface RateResult {
  allowed: boolean
  retryAfterSeconds: number
}

interface Opts {
  env?: Record<string, string | undefined>
  fetchImpl?: typeof fetch
  now?: () => number
}

/** Per-instance fallback. Serverless instances are short-lived and not shared, so this is best-effort only. */
const memory = new Map<string, { count: number; resetAt: number }>()
export function _resetMemoryLimiter() {
  memory.clear()
}

/**
 * Fixed-window counter. If Upstash Redis REST credentials are configured it is shared across all serverless instances
 * (recommended); otherwise it falls back to in-memory. In test mode the recipient allow-list is the hard backstop either way.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, opts: Opts = {}): Promise<RateResult> {
  const env = opts.env ?? process.env
  const now = opts.now ?? Date.now
  const url = env.UPSTASH_REDIS_REST_URL
  const token = env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) {
    try {
      const f = opts.fetchImpl ?? fetch
      const res = await f(`${url.replace(/\/$/, '')}/pipeline`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, String(windowSeconds), 'NX'],
          ['TTL', key],
        ]),
      })
      if (!res.ok) throw new Error(`upstash ${res.status}`)
      const out = (await res.json()) as Array<{ result?: number }>
      const count = Number(out[0]?.result ?? 0)
      const ttl = Math.max(1, Number(out[2]?.result ?? windowSeconds))
      return { allowed: count <= limit, retryAfterSeconds: ttl }
    } catch {
      // fall through to memory so a Redis outage never disables rate limiting entirely
    }
  }

  const t = now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt <= t) {
    memory.set(key, { count: 1, resetAt: t + windowSeconds * 1000 })
    return { allowed: true, retryAfterSeconds: windowSeconds }
  }
  entry.count++
  return { allowed: entry.count <= limit, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - t) / 1000)) }
}
