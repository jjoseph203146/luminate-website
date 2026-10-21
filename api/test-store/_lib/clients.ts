import Stripe from 'stripe'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import { ConfigError, optionalEnv, requireEnv, stripeTestSecretKey } from './env'
import type { Mailer } from './notify'

/** All three clients are created lazily, server-side only. Nothing here is imported by browser code. */
export function getStripe(): Stripe {
  return new Stripe(stripeTestSecretKey())
}

export function getSupabase(): SupabaseClient {
  return createClient(requireEnv('TEST_STORE_SUPABASE_URL'), requireEnv('TEST_STORE_SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export function getMailer(): Mailer {
  const resend = new Resend(requireEnv('TEST_STORE_RESEND_API_KEY'))
  return {
    async send({ to, from, subject, html, text, idempotencyKey }) {
      const { data, error } = await resend.emails.send({ from, to, subject, html, text }, { idempotencyKey })
      if (error) throw new Error(`Resend error: ${error.name}: ${error.message}`)
      return { id: data?.id ?? '' }
    },
  }
}

export function notificationConfig() {
  const to = requireEnv('TEST_STORE_NOTIFY_EMAIL')
  // Resend's shared test sender works without verifying a domain, but only delivers to your own Resend account email.
  const from = optionalEnv('TEST_STORE_FROM_EMAIL') ?? 'Luminate Test Store <onboarding@resend.dev>'
  return { to, from }
}

export { ConfigError }
