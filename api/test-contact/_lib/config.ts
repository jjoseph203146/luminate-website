/**
 * Everything the test contact page needs from the environment. Read once per request so a Vercel
 * env-var change takes effect on the next deployment, and so missing values fail loudly and specifically.
 */
export class ConfigError extends Error {}

export interface ContactConfig {
  resendApiKey: string
  from: string
  notifyEmail: string
  /** Lower-cased approved test addresses. In restricted mode nothing is sent anywhere else. */
  allowed: Set<string>
  restricted: boolean
  secret: string
  turnstile?: { siteKey: string; secretKey: string }
}

type Env = Record<string, string | undefined>

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/** Extracts the bare address from either "a@b.com" or "Name <a@b.com>". */
export function bareAddress(value: string): string {
  const m = value.match(/<([^>]+)>/)
  return normalizeEmail(m ? m[1] : value)
}

export function isEnabled(env: Env = process.env): boolean {
  return env.TEST_CONTACT_ENABLED === 'true'
}

export function loadConfig(env: Env = process.env): ContactConfig {
  const missing: string[] = []
  const need = (name: string) => {
    const v = env[name]
    if (!v) missing.push(name)
    return v ?? ''
  }

  const resendApiKey = need('RESEND_API_KEY')
  const from = need('TEST_CONTACT_FROM_EMAIL')
  const notifyEmail = need('TEST_CONTACT_NOTIFY_EMAIL')
  const allowedRaw = need('TEST_CONTACT_ALLOWED_EMAILS')
  const secret = need('TEST_CONTACT_SECRET')
  if (missing.length) throw new ConfigError(`Missing environment variables: ${missing.join(', ')}${diagnose(missing, env)}`)
  if (secret.length < 32) throw new ConfigError('TEST_CONTACT_SECRET must be at least 32 characters')

  const allowed = new Set(allowedRaw.split(',').map(normalizeEmail).filter(Boolean))
  if (allowed.size === 0) throw new ConfigError('TEST_CONTACT_ALLOWED_EMAILS must list at least one address')

  const restricted = env.TEST_CONTACT_RESTRICT !== 'off'
  const siteKey = env.TEST_CONTACT_TURNSTILE_SITE_KEY
  const secretKey = env.TEST_CONTACT_TURNSTILE_SECRET_KEY

  const cfg: ContactConfig = {
    resendApiKey,
    from,
    notifyEmail,
    allowed,
    restricted,
    secret,
    turnstile: siteKey && secretKey ? { siteKey, secretKey } : undefined,
  }

  // Misconfiguration guard: in restricted mode the internal notification address must itself be approved,
  // otherwise every submission would be blocked at the send step.
  if (restricted && !allowed.has(bareAddress(notifyEmail))) {
    throw new ConfigError('While restricted, TEST_CONTACT_NOTIFY_EMAIL must also appear in TEST_CONTACT_ALLOWED_EMAILS')
  }
  return cfg
}

/** Last line of defence, checked immediately before sending: no unapproved recipient can ever be mailed in test mode. */
export function assertRecipientsAllowed(recipients: string[], cfg: ContactConfig): void {
  if (!cfg.restricted) return
  for (const r of recipients) {
    if (!cfg.allowed.has(bareAddress(r))) throw new Error('Recipient is not an approved test address')
  }
}

/**
 * Troubleshooting hint for the error log: variable NAMES only, never values. Helps spot typos, stray spaces,
 * empty values, and variables saved for a different Vercel environment (Production vs Preview).
 */
function diagnose(missing: string[], env: Env): string {
  const hints: string[] = []
  for (const name of missing) {
    const core = name.split('_')[0].toLowerCase()
    if (name in env) {
      hints.push(`${name} exists but its value is empty`)
      continue
    }
    const similar = Object.keys(env).filter((k) => k !== name && (k.toLowerCase().includes(core) || k.trim().toUpperCase() === name))
    if (similar.length) hints.push(`${name} not found; similar names present: ${similar.slice(0, 5).map((k) => JSON.stringify(k)).join(', ')}`)
    else hints.push(`${name} not found; no similarly named variable exists in this deployment (check the Environment checkboxes and redeploy)`)
  }
  return ` [${hints.join('; ')}] (deployment env: ${env.VERCEL_ENV ?? 'unknown'})`
}
