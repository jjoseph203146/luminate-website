import { Resend } from 'resend'
import { render, toPlainText } from '@react-email/render'
import { assertRecipientsAllowed, type ContactConfig } from './config'
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
  confirmation: { id: string }
  internal: { id: string }
}

export async function sendSubmissionEmails(
  cfg: ContactConfig,
  mailer: Mailer,
  submission: Submission,
  meta: { reference: string; visitorRef: string; now?: Date },
): Promise<SendResult> {
  const testMode = cfg.restricted
  const receivedAt = (meta.now ?? new Date()).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' }) + ' ET'

  const confirmEl = ConfirmationEmail({ ...submission, reference: meta.reference, testMode })
  const internalEl = InternalNotificationEmail({ ...submission, reference: meta.reference, receivedAt, visitorRef: meta.visitorRef, testMode })
  const [confirmHtml, internalHtml] = await Promise.all([render(confirmEl), render(internalEl)])

  const confirmation: MailMessage = {
    from: cfg.from,
    to: [submission.email],
    subject: 'We received your message — Luminate',
    html: confirmHtml,
    text: toPlainText(confirmHtml),
    idempotencyKey: `test-contact-${meta.reference}-confirm`,
  }
  const internal: MailMessage = {
    from: cfg.from,
    to: [cfg.notifyEmail],
    subject: `${testMode ? '[Test] ' : ''}New contact: ${safeSubject(submission.subject)}`,
    html: internalHtml,
    text: toPlainText(internalHtml),
    replyTo: submission.email,
    idempotencyKey: `test-contact-${meta.reference}-internal`,
  }

  // Hard guard immediately before sending: while restricted, an unapproved address can never be mailed.
  assertRecipientsAllowed([...confirmation.to, ...internal.to], cfg)

  const [c, i] = await Promise.allSettled([mailer.send(confirmation), mailer.send(internal)])
  if (c.status === 'rejected' || i.status === 'rejected') {
    const err = new Error(
      [c.status === 'rejected' ? `confirmation: ${String(c.reason?.message ?? c.reason)}` : '', i.status === 'rejected' ? `internal: ${String(i.reason?.message ?? i.reason)}` : '']
        .filter(Boolean)
        .join(' | '),
    ) as Error & { partial?: { confirmationSent: boolean; internalSent: boolean } }
    err.partial = { confirmationSent: c.status === 'fulfilled', internalSent: i.status === 'fulfilled' }
    throw err
  }
  return { confirmation: c.value, internal: i.value }
}
