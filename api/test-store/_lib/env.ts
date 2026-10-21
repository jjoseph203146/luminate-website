/**
 * Every variable used by the test store is prefixed TEST_STORE_ so it can never collide with
 * (or accidentally read) a production variable such as STRIPE_SECRET_KEY.
 */
export class ConfigError extends Error {}

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new ConfigError(`Missing environment variable ${name}`)
  return value
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined
}

/** Hard guard: refuse to run with anything that is not a Stripe TEST-mode key. */
export function stripeTestSecretKey(): string {
  const key = requireEnv('TEST_STORE_STRIPE_SECRET_KEY')
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new ConfigError('TEST_STORE_STRIPE_SECRET_KEY must be a Stripe TEST key (sk_test_… or rk_test_…). Live keys are refused.')
  }
  return key
}

export function siteUrl(host: string | undefined): string {
  const configured = optionalEnv('TEST_STORE_SITE_URL')
  if (configured) return configured.replace(/\/$/, '')
  const isLocal = !host || host.startsWith('localhost') || host.startsWith('127.0.0.1')
  return `${isLocal ? 'http' : 'https'}://${host ?? 'localhost:3000'}`
}
