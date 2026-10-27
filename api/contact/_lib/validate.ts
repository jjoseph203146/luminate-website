export interface Submission {
  name: string
  email: string
  business: string
  phone: string
  about: string
  projectType: string
  message: string
}

export type ValidationResult = { ok: true; value: Submission } | { ok: false; errors: Partial<Record<keyof Submission, string>> }

// Control characters (incl. CR/LF) are never legitimate in single-line fields and enable email-header injection.
const CONTROL = /[\u0000-\u001F\u007F]/g
const CONTROL_EXCEPT_NEWLINE = /[\u0000-\u0009\u000B\u000C\u000E-\u001F\u007F]/g
const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/
const PHONE = /^[0-9+().\-\s]{7,30}$/

function singleLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : ''
}
function multiLine(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(CONTROL_EXCEPT_NEWLINE, '').trim() : ''
}

export function validateSubmission(body: unknown): ValidationResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const name = singleLine(b.name)
  const business = singleLine(b.business)
  const phone = singleLine(b.phone)
  const about = multiLine(b.about)
  const projectType = singleLine(b.projectType)
  const emailRaw = typeof b.email === 'string' ? b.email.trim() : ''
  const message = multiLine(b.message)

  const errors: Partial<Record<keyof Submission, string>> = {}
  if (name.length < 2) errors.name = 'Please enter your name.'
  else if (name.length > 80) errors.name = 'Name must be 80 characters or fewer.'

  if (!emailRaw) errors.email = 'Please enter your email address.'
  else if (emailRaw.length > 254 || !EMAIL.test(emailRaw)) errors.email = 'Please enter a valid email address.'

  if (business.length > 120) errors.business = 'Business name must be 120 characters or fewer.'
  if (phone && !PHONE.test(phone)) errors.phone = 'Please enter a valid phone number.'
  if (about.length > 500) errors.about = 'Please keep this to 500 characters or fewer.'
  if (projectType.length > 80) errors.projectType = 'Invalid selection.'

  if (message.length < 2) errors.message = 'Please tell us a little about your project.'
  else if (message.length > 3000) errors.message = 'Message must be 3,000 characters or fewer.'

  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { name, email: emailRaw, business, phone, about, projectType, message } }
}
