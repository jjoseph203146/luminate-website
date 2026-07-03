import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import RequestForm from './request-form'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/')

  return (
    <main style={{ minHeight: '100vh', padding: 'clamp(24px, 5vw, 48px) clamp(20px, 5vw, 72px)' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: '48px', paddingBottom: '20px',
        borderBottom: '1px solid var(--b12)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{
            width: '36px', height: '36px', border: '1px solid var(--b28)',
            borderRadius: '9px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', background: 'var(--card)',
          }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: '18px', color: 'var(--accent)' }}>L</span>
          </div>
          <span style={{ fontSize: '14px', color: 'var(--dim2)', letterSpacing: '.04em' }}>
            Client Portal
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '13px', color: 'var(--dim2)' }}>{user.email}</span>
          <RequestForm.SignOutButton />
        </div>
      </header>

      {/* Page body */}
      <div style={{ maxWidth: '560px', margin: '0 auto' }}>
        <div style={{ marginBottom: '32px' }}>
          <p style={{ margin: '0 0 4px', fontSize: '12px', letterSpacing: '.32em', textTransform: 'uppercase', color: 'var(--dim2)', fontWeight: 600 }}>
            New request
          </p>
          <h1 style={{ margin: 0, fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 600 }}>
            Submit a request
          </h1>
          <p style={{ margin: '10px 0 0', color: 'var(--dim)', fontSize: '15px', lineHeight: 1.65 }}>
            Describe what you need and we'll get back to you.
          </p>
        </div>

        <RequestForm />
      </div>
    </main>
  )
}
