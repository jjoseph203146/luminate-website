import type { VercelRequest, VercelResponse } from '@vercel/node'

/**
 * Structured JSON logs (visible in Vercel → Logs). We log ids and statuses only —
 * never customer emails, names, addresses, or any key material.
 */
export function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), scope: 'test-store', level, msg, ...ctx })
  if (level === 'error') console.error(line)
  else console.log(line)
}

export function json(res: VercelResponse, status: number, body: unknown) {
  res.setHeader('Cache-Control', 'no-store')
  res.status(status).json(body)
}

export function methodNotAllowed(res: VercelResponse, allow: string[]) {
  res.setHeader('Allow', allow.join(', '))
  json(res, 405, { error: 'method_not_allowed' })
}

/** Read the exact bytes Stripe signed. Must not be JSON-parsed first. */
export async function readRawBody(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  return Buffer.concat(chunks)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
