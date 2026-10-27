import React from 'react'
import { Body, Container, Head, Heading, Hr, Html, Link, Preview, Section, Text } from '@react-email/components'
import type { Submission } from './validate'

/**
 * React Email templates for the production contact form. Written with React.createElement (no JSX) so they compile on Vercel without a tsconfig.
 * Palette mirrors the site: navy #0D1B2E, cream #E8E2D4 / #F3EEE3. Email clients can't load web fonts reliably,
 * so Georgia stands in for Playfair Display and system sans for Inter. All values are escaped by React.
 */
const h = React.createElement

const C = {
  navy: '#0D1B2E',
  navy2: '#132743',
  cream: '#E8E2D4',
  creamHi: '#F3EEE3',
  creamSoft: '#F8F4EA',
  line: '#E4DECF',
  ink: '#0D1B2E',
  body: '#3A4A63',
  dim: '#7E8DA0',
}
const SERIF = "Georgia, 'Times New Roman', serif"
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
export const SITE = 'https://luminatewebdesign.com'

const responsiveCss = `
  @media only screen and (max-width: 520px) {
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .h1 { font-size: 24px !important; }
  }
  a { color: ${C.navy}; }
`

function banner(testMode: boolean) {
  if (!testMode) return null
  return h(
    Section,
    { style: { backgroundColor: C.cream, padding: '8px 16px', textAlign: 'center' as const } },
    h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '11px', letterSpacing: '0.12em', color: C.navy, fontWeight: 600 } }, 'TEST EMAIL · NOT A REAL CUSTOMER MESSAGE'),
  )
}

function header() {
  return h(
    Section,
    { className: 'px', style: { backgroundColor: C.navy, padding: '28px 36px' } },
    h(Text, { style: { margin: 0, fontFamily: SERIF, fontSize: '20px', letterSpacing: '0.14em', color: C.creamHi, fontWeight: 600 } }, 'LUMINATE'),
    h(Text, { style: { margin: '4px 0 0', fontFamily: SANS, fontSize: '12px', color: C.dim } }, 'Web Design & Development · Augusta, GA'),
  )
}

function footer(note: string) {
  return h(
    Section,
    { className: 'px', style: { backgroundColor: C.navy, padding: '24px 36px' } },
    h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '12px', color: C.creamHi, lineHeight: '1.6' } }, 'Luminate Web Design & Development LLC · Augusta, GA'),
    h(
      Text,
      { style: { margin: '4px 0 0', fontFamily: SANS, fontSize: '12px', color: C.dim, lineHeight: '1.6' } },
      h(Link, { href: 'tel:7622279287', style: { color: C.cream, textDecoration: 'none' } }, '(762) 227-9287'),
      ' · ',
      h(Link, { href: 'mailto:luminatewebco@gmail.com', style: { color: C.cream, textDecoration: 'none' } }, 'luminatewebco@gmail.com'),
    ),
    h(Text, { style: { margin: '12px 0 0', fontFamily: SANS, fontSize: '11px', color: C.dim, lineHeight: '1.6' } }, note),
  )
}

function field(label: string, value: React.ReactNode, last = false) {
  return h(
    'tr',
    null,
    h(
      'td',
      { style: { padding: last ? '12px 0 0' : '12px 0', borderBottom: last ? 'none' : `1px solid ${C.line}` } },
      h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.dim } }, label),
      h(Text, { style: { margin: '4px 0 0', fontFamily: SANS, fontSize: '15px', color: C.ink, lineHeight: '1.55', wordBreak: 'break-word' as const } }, value),
    ),
  )
}

function messageBlock(message: string) {
  return h(
    'tr',
    null,
    h(
      'td',
      { style: { padding: '12px 0 0' } },
      h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.dim } }, 'Message'),
      h(
        'div',
        { style: { margin: '8px 0 0', padding: '12px 16px', borderLeft: `3px solid ${C.navy}`, backgroundColor: '#FFFFFF', fontFamily: SANS, fontSize: '14px', color: C.body, lineHeight: '1.65', whiteSpace: 'pre-wrap' as const, wordBreak: 'break-word' as const } },
        message,
      ),
    ),
  )
}

function summaryCard(rows: React.ReactNode[]) {
  return h(
    Section,
    { style: { backgroundColor: C.creamSoft, border: `1px solid ${C.line}`, borderRadius: '12px', padding: '8px 20px 20px', margin: '24px 0 0' } },
    h('table', { role: 'presentation', width: '100%', cellPadding: 0, cellSpacing: 0, style: { width: '100%' } }, h('tbody', null, ...rows)),
  )
}

function shell(preview: string, testMode: boolean, children: React.ReactNode[], footerNote: string) {
  return h(
    Html,
    { lang: 'en' },
    h(Head, null, h('meta', { name: 'color-scheme', content: 'light' }), h('style', null, responsiveCss)),
    h(Preview, null, preview),
    h(
      Body,
      { style: { margin: 0, padding: '24px 12px', backgroundColor: C.creamHi, fontFamily: SANS } },
      h(
        Container,
        { style: { maxWidth: '600px', width: '100%', backgroundColor: '#FFFFFF', border: `1px solid ${C.line}`, borderRadius: '16px', overflow: 'hidden' } },
        banner(testMode),
        header(),
        h(Section, { className: 'px', style: { padding: '36px 36px 32px' } }, ...children),
        footer(footerNote),
      ),
    ),
  )
}

function details(p: Submission): React.ReactNode[] {
  const rows: React.ReactNode[] = [field('Name', p.name), field('Email', p.email)]
  if (p.business) rows.push(field('Business', p.business))
  if (p.phone) rows.push(field('Phone', p.phone))
  if (p.projectType) rows.push(field('Service', p.projectType))
  if (p.about) rows.push(field('About the business', p.about))
  rows.push(messageBlock(p.message))
  return rows
}

export interface ConfirmationProps extends Submission {
  reference: string
}

export function ConfirmationEmail(p: ConfirmationProps) {
  const first = p.name.split(' ')[0]
  return shell(
    `Thanks, ${first} — we received your project details.`,
    false,
    [
      h(Heading, { as: 'h1', className: 'h1', style: { margin: 0, fontFamily: SERIF, fontSize: '28px', lineHeight: '1.2', letterSpacing: '-0.02em', color: C.ink, fontWeight: 600 } }, `Thank you, ${first}.`),
      h(Text, { style: { margin: '14px 0 0', fontFamily: SANS, fontSize: '15px', lineHeight: '1.7', color: C.body } }, "We've received your project details. Here's a copy of what you sent, for your records."),
      summaryCard(details(p)),
      h(Text, { style: { margin: '24px 0 0', fontFamily: SANS, fontSize: '15px', lineHeight: '1.7', color: C.body } }, "You'll hear back from us directly at this email address. If you need to add something, simply reply to this message."),
      h(
        Section,
        { style: { margin: '24px 0 0' } },
        h(Link, { href: SITE, style: { display: 'inline-block', backgroundColor: C.navy, color: C.creamHi, fontFamily: SANS, fontSize: '14px', fontWeight: 600, textDecoration: 'none', padding: '12px 26px', borderRadius: '999px' } }, 'Visit luminatewebdesign.com'),
      ),
      h(Hr, { style: { borderColor: C.line, margin: '28px 0 12px' } }),
      h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '11px', color: C.dim } }, `Reference: ${p.reference}`),
    ],
    'You received this because you contacted Luminate Web Design & Development.',
  )
}

export interface InternalProps extends Submission {
  reference: string
  receivedAt: string
  visitorRef: string
}

export function InternalNotificationEmail(p: InternalProps) {
  return shell(
    `New project inquiry from ${p.name}`,
    false,
    [
      h(Heading, { as: 'h1', className: 'h1', style: { margin: 0, fontFamily: SERIF, fontSize: '26px', lineHeight: '1.2', letterSpacing: '-0.02em', color: C.ink, fontWeight: 600 } }, 'New project inquiry'),
      h(Text, { style: { margin: '10px 0 0', fontFamily: SANS, fontSize: '14px', lineHeight: '1.65', color: C.body } }, 'Reply to this email to respond directly to the sender.'),
      summaryCard(details(p).map((row, i) => (i === 1 ? field('Email', h(Link, { href: `mailto:${p.email}`, style: { color: C.navy } }, p.email)) : row))),
      h(Hr, { style: { borderColor: C.line, margin: '28px 0 12px' } }),
      h(Text, { style: { margin: 0, fontFamily: SANS, fontSize: '11px', color: C.dim, lineHeight: '1.7' } }, `Reference ${p.reference} · Received ${p.receivedAt} · Visitor ${p.visitorRef}`),
    ],
    'Internal notification from the Luminate website contact form.',
  )
}
