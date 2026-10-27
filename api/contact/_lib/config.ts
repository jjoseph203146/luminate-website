/**
 * Environment for the production contact form. Read per request so missing values fail loudly and specifically.
 * Variables are named CONTACT_* (not TEST_CONTACT_*), so the removed test page can never be confused with this.
 */
export class ConfigError extends Error {}

export interface ContactConfig {
  resendApiKey: string
  from: string
  notifyEmail: string
  sendConfirmation: boolean
  secret: string
}

type Env = Record<string, string | undefined>

export function loadConfig(env: Env = process.env): ContactConfig {
  const missing: string[] = []
  const need = (name: string) => {
    const v = env[name]
    if (!v) missing.push(name)
    return v ?? ''
  }
  const resendApiKey = need('RESEND_API_KEY')
  const from = need('CONTACT_FROM_EMAIL')
  const notifyEmail = need('CONTACT_NOTIFY_EMAIL')
  const secret = need('CONTACT_SECRET')
  if (missing.length) throw new ConfigError(`Missing environment variables: ${missing.join(', ')}${diagnose(missing, env)}`)
  if (secret.length < 32) throw new ConfigError('CONTACT_SECRET must be at least 32 characters')
  return { resendApiKey, from, notifyEmail, sendConfirmation: env.CONTACT_SEND_CONFIRMATION !== 'off', secret }
}

/** Troubleshooting hint for the error log: variable NAMES only, never values. */
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
