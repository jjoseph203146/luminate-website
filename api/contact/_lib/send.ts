import { Resend } from 'resend'
import { render, toPlainText } from '@react-email/render'
import type { ContactConfig } from './config'
import { ConfirmationEmail, InternalNotificationEmail } from './templates'
import type { Submission } from './validate'

export interface MailMessage {
  from: string
  to: string[]
  subject: string
  html: string
  text: string
  replyTo?: string
  idempotencyKey: string
}
export interface Mailer {
  send(m: MailMessage): Promise<{ id: string }>
}

export function resendMailer(apiKey: string): Mailer {
  const resend = new Resend(apiKey)
  return {
    async send(m) {
      const { data, error } = await resend.emails.send(
        { from: m.from, to: m.to, subject: m.subject, html: m.html, text: m.text, replyTo: m.replyTo },
        { idempotencyKey: m.idempotencyKey },
      )
      if (error) throw new Error(`Resend: ${error.name}: ${error.message}`)
      return { id: data?.id ?? '' }
    },
  }
}

/** Header-safe single line for use in an email subject. */
export function safeSubject(s: string): string {
  return s.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 150)
}

export interface SendResult {
  internal: { id: string }
  confirmation: { id: string } | null
  confirmationError?: string
}

/**
 * Sends the owner notification (the one that matters: it replaces the old form-service email) and, unless disabled,
 * a branded confirmation to the visitor. If the notification fails this throws, so the visitor is told to try again
 * (the lead is also pushed to LuminateOS by the page). A failed confirmation alone is logged but not shown to the visitor.
 */
export async function sendSubmissionEmails(
  cfg: ContactConfig,
  mailer: Mailer,
  submission: Submission,
  meta: { reference: string; visitorRef: string; now?: Date },
): Promise<SendResult> {
  const receivedAt = (meta.now ?? new Date()).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'
  const internalHtml = await render(InternalNotificationEmail({ ...submission, reference: meta.reference, receivedAt, visitorRef: meta.visitorRef }))
  const internal: MailMessage = {
    from: cfg.from,
    to: [cfg.notifyEmail],
    subject: `New project inquiry — ${safeSubject(submission.name)}`,
    html: internalHtml,
    text: toPlainText(internalHtml),
    replyTo: submission.email,
    idempotencyKey: `contact-${meta.reference}-internal`,
  }

  let confirmationMessage: MailMessage | null = null
  if (cfg.sendConfirmation) {
    const confirmHtml = await render(ConfirmationEmail({ ...submission, reference: meta.reference }))
    confirmationMessage = {
      from: cfg.from,
      to: [submission.email],
      subject: 'We received your project details — Luminate',
      html: confirmHtml,
      text: toPlainText(confirmHtml),
      idempotencyKey: `contact-${meta.reference}-confirm`,
    }
  }

  const [i, c] = await Promise.allSettled([mailer.send(internal), confirmationMessage ? mailer.send(confirmationMessage) : Promise.resolve(null)])
  if (i.status === 'rejected') throw new Error(`internal notification failed: ${String(i.reason?.message ?? i.reason)}`)
  return {
    internal: i.value,
    confirmation: c.status === 'fulfilled' ? c.value : null,
    confirmationError: c.status === 'rejected' ? String(c.reason?.message ?? c.reason) : undefined,
  }
}
