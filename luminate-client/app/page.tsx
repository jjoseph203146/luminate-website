'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase-client'

type State = 'idle' | 'loading' | 'sent' | 'error'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [uiState, setUiState] = useState<State>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setUiState('loading')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setErrorMsg(error.message)
      setUiState('error')
    } else {
      setUiState('sent')
    }
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{
            width: '48px', height: '48px', border: '1px solid var(--b28)',
            borderRadius: '12px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 14px',
            background: 'var(--card)',
          }}>
            <span style={{ fontFamily: "'Playfair Display', serif", fontSize: '22px', color: 'var(--accent)' }}>L</span>
          </div>
          <p style={{ margin: 0, fontSize: '12px', letterSpacing: '.32em', textTransform: 'uppercase', color: 'var(--dim2)', fontWeight: 600 }}>
            Luminate Client Portal
          </p>
        </div>

        {/* Card */}
        <div style={{ background: 'var(--card)', border: '1px solid var(--b14)', borderRadius: '16px', padding: '32px' }}>
          {uiState === 'sent' ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px' }}>✉️</div>
              <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 600 }}>Check your email</h2>
              <p style={{ margin: 0, color: 'var(--dim)', fontSize: '14px', lineHeight: 1.65 }}>
                We sent a magic link to{' '}
                <strong style={{ color: 'var(--ink)' }}>{email}</strong>.
                Click it to sign in — no password needed.
              </p>
              <button
                onClick={() => { setUiState('idle'); setEmail('') }}
                style={{ marginTop: '24px', background: 'none', border: 'none', color: 'var(--dim2)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
              >
                Use a different email
              </button>
            </div>
          ) : (
            <>
              <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>Sign in</h2>
              <p style={{ margin: '0 0 24px', color: 'var(--dim)', fontSize: '14px', lineHeight: 1.65 }}>
                Enter your email and we'll send you a magic link.
              </p>
              <form onSubmit={handleSubmit}>
                <label style={{ display: 'block', fontSize: '12px', color: 'var(--dim2)', marginBottom: '8px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  disabled={uiState === 'loading'}
                  style={{
                    display: 'block', width: '100%', padding: '12px 14px',
                    background: 'var(--navy2)', border: '1px solid var(--b24)',
                    borderRadius: '10px', color: 'var(--ink)', fontSize: '15px',
                    marginBottom: '8px', transition: 'border-color .2s',
                  }}
                />
                {uiState === 'error' && (
                  <p style={{ color: 'var(--red)', fontSize: '13px', margin: '0 0 12px', lineHeight: 1.5 }}>
                    {errorMsg || 'Something went wrong. Please try again.'}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={uiState === 'loading'}
                  style={{
                    display: 'block', width: '100%', marginTop: '16px',
                    padding: '13px', background: 'var(--accent)', color: 'var(--navy)',
                    border: 'none', borderRadius: '10px', fontSize: '15px',
                    fontWeight: 600, cursor: uiState === 'loading' ? 'not-allowed' : 'pointer',
                    opacity: uiState === 'loading' ? 0.65 : 1, transition: 'opacity .2s',
                  }}
                >
                  {uiState === 'loading' ? 'Sending…' : 'Send magic link'}
                </button>
              </form>
            </>
          )}
        </div>

        <p style={{ textAlign: 'center', marginTop: '24px', fontSize: '13px', color: 'var(--dim2)' }}>
          Don't have access yet?{' '}
          <a href="https://luminatewebdesign.com/#contact" style={{ color: 'var(--accent)', textDecoration: 'none', borderBottom: '1px solid var(--b28)' }}>
            Contact us
          </a>
        </p>
      </div>
    </main>
  )
}
