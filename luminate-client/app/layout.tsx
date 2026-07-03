import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Luminate Client Portal',
  description: 'Submit and manage requests for your Luminate project.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
