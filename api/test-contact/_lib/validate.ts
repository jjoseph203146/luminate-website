export interface Submission {
  name: string
  email: string
  subject: string
  message: string
}

export type ValidationResult = { ok: true; value: Submission } | { ok: false; errors: Partial<Record<keyof Submission, string>> }

// Control characters (incl. CR/LF) are never legitimate in single-line fields and enable header injection.
const CONTROL = /[\u0000-\u001F\u007F]/g
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

function singleLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : ''
}

export function validateSubmission(body: unknown): ValidationResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = singleLine(b.name)
  const subject = singleLine(b.subject)
  const emailRaw = typeof b.email === 'string' ? b.email.trim() : ''
  const message = typeof b.message === 'string' ? b.message.replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '').trim() : ''

  const errors: Partial<Record<keyof Submission, string>> = {}
  if (name.length < 2) errors.name = 'Please enter your name.'
  else if (name.length > 80) errors.name = 'Name must be 80 characters or fewer.'

  if (!emailRaw) errors.email = 'Please enter your email address.'
  else if (emailRaw.length > 254 || !EMAIL.test(emailRaw)) errors.email = 'Please enter a valid email address.'

  if (subject.length < 3) errors.subject = 'Please enter a subject.'
  else if (subject.length > 120) errors.subject = 'Subject must be 120 characters or fewer.'

  if (message.length < 10) errors.message = 'Please write a message of at least 10 characters.'
  else if (message.length > 2000) errors.message = 'Message must be 2,000 characters or fewer.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, email: emailRaw, subject, message } }
}
