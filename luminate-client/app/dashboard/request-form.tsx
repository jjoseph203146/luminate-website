'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase-client'

type SubmitState = 'idle' | 'loading' | 'success' | 'error'

interface CreatedRequest {
  id: string
  display_id: string
  title: string
  status: string
  created_at: string
}

interface ErrorState {
  type: 'unlinked' | 'auth' | 'validation' | 'server' | 'network'
  message: string
}

const OS_URL = process.env.NEXT_PUBLIC_LUMINATE_OS_URL ?? 'https://luminate-os.vercel.app'

export default function RequestForm() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [state, setState] = useState<SubmitState>('idle')
  const [created, setCreated] = useState<CreatedRequest | null>(null)
  const [error, setError] = useState<ErrorState | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setState('loading')
    setError(null)

    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()

    if (!session) {
      setError({ type: 'auth', message: 'Your session has expired. Please sign in again.' })
      setState('error')
      return
    }

    let res: Response
    try {
      res = await fetch(`${OS_URL}/api/requests/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ title: title.trim(), description: description.trim() || undefined }),
      })
    } catch {
      setError({ type: 'network', message: 'Could not reach the server. Check your connection and try again.' })
      setState('error')
      return
    }

    const body = await res.json()

    if (res.ok) {
      setCreated(body.request)
      setState('success')
      setTitle('')
      setDescription('')
      return
    }

    if (res.status === 401) {
      setError({ type: 'auth', message: 'Your session has expired. Please sign out and sign in again.' })
    } else if (res.status === 404) {
      setError({
        type: 'unlinked',
        message: "Your account isn't linked to a client record yet. Contact us and we'll get you set up.",
      })
    } else if (res.status === 400) {
      setError({ type: 'validation', message: body?.error ?? 'Please fill in the request title.' })
    } else {
      setError({ type: 'server', message: 'Something went wrong on our end. Please try again in a moment.' })
    }
    setState('error')
  }

  if (state === 'success' && created) {
    return (
      <div style={{ background: 'var(--card)', border: '1px solid var(--b14)', borderRadius: '16px', padding: '32px', textAlign: 'center' }}>
        <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(95,184,142,.12)', border: '1px solid rgba(95,184,142,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <span style={{ color: 'var(--green)', fontSize: '22px' }}>✓</span>
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: '20px', fontWeight: 600 }}>Request submitted</h2>
        <p style={{ margin: '0 0 20px', color: 'var(--dim)', fontSize: '14px', lineHeight: 1.65 }}>
          We've received your request and will be in touch shortly.
        </p>
        <div style={{ background: 'var(--navy2)', border: '1px solid var(--b14)', borderRadius: '10px', padding: '16px', marginBottom: '24px', textAlign: 'left' }}>
          <p style={{ margin: '0 0 4px', fontSize: '12px', color: 'var(--dim2)', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
            Request #{created.display_id}
          </p>
          <p style={{ margin: 0, fontSize: '15px', fontWeight: 500 }}>{created.title}</p>
          <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--dim2)' }}>
            Status: <span style={{ color: 'var(--accent)', textTransform: 'capitalize' }}>{created.status}</span>
          </p>
        </div>
        <button
          onClick={() => { setState('idle'); setCreated(null); setError(null) }}
          style={{ background: 'none', border: '1px solid var(--b28)', borderRadius: '10px', color: 'var(--ink)', fontSize: '14px', padding: '11px 24px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          Submit another request
        </button>
      </div>
    )
  }

  const isUnlinked = state === 'error' && error?.type === 'unlinked'

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--b14)', borderRadius: '16px', padding: '32px' }}>
      {isUnlinked ? (
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'rgba(240,235,225,.06)', border: '1px solid var(--b24)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
            <span style={{ fontSize: '22px' }}>🔗</span>
          </div>
          <h2 style={{ margin: '0 0 10px', fontSize: '20px', fontWeight: 600 }}>Account not linked</h2>
          <p style={{ margin: '0 0 24px', color: 'var(--dim)', fontSize: '14px', lineHeight: 1.65 }}>
            {error?.message}
          </p>
          <a
            href="https://luminatewebdesign.com/#contact"
            style={{ display: 'inline-block', padding: '11px 24px', background: 'var(--accent)', color: 'var(--navy)', borderRadius: '10px', fontWeight: 600, fontSize: '14px', textDecoration: 'none' }}
          >
            Contact us
          </a>
          <button
            onClick={() => { setState('idle'); setError(null) }}
            style={{ display: 'block', margin: '14px auto 0', background: 'none', border: 'none', color: 'var(--dim2)', fontSize: '13px', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            Try again
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--dim2)', marginBottom: '8px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
              Title <span style={{ color: 'var(--red)' }}>*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief summary of your request"
              required
              disabled={state === 'loading'}
              maxLength={160}
              style={{
                display: 'block', width: '100%', padding: '12px 14px',
                background: 'var(--navy2)', border: '1px solid var(--b24)',
                borderRadius: '10px', color: 'var(--ink)', fontSize: '15px',
                fontFamily: 'inherit', transition: 'border-color .2s',
              }}
            />
          </div>

          <div style={{ marginBottom: '24px' }}>
            <label style={{ display: 'block', fontSize: '12px', color: 'var(--dim2)', marginBottom: '8px', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 600 }}>
              Details <span style={{ color: 'var(--dim2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Any additional context, links, or specifics…"
              rows={5}
              disabled={state === 'loading'}
              style={{
                display: 'block', width: '100%', padding: '12px 14px',
                background: 'var(--navy2)', border: '1px solid var(--b24)',
                borderRadius: '10px', color: 'var(--ink)', fontSize: '15px',
                fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.6,
                transition: 'border-color .2s',
              }}
            />
          </div>

          {state === 'error' && error && !isUnlinked && (
            <div style={{ background: 'rgba(224,121,107,.08)', border: '1px solid rgba(224,121,107,.25)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px' }}>
              <p style={{ margin: 0, color: 'var(--red)', fontSize: '13px', lineHeight: 1.55 }}>{error.message}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={state === 'loading'}
            style={{
              display: 'block', width: '100%', padding: '13px',
              background: 'var(--accent)', color: 'var(--navy)',
              border: 'none', borderRadius: '10px', fontSize: '15px',
              fontWeight: 600, fontFamily: 'inherit',
              cursor: state === 'loading' ? 'not-allowed' : 'pointer',
              opacity: state === 'loading' ? 0.65 : 1, transition: 'opacity .2s',
            }}
          >
            {state === 'loading' ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      )}
    </div>
  )
}

// Small sign-out button exported as a named sub-component
RequestForm.SignOutButton = function SignOutButton() {
  const router = useRouter()
  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }
  return (
    <button
      onClick={signOut}
      style={{ background: 'none', border: '1px solid var(--b24)', borderRadius: '8px', color: 'var(--dim2)', fontSize: '13px', padding: '7px 14px', cursor: 'pointer', fontFamily: 'inherit', transition: 'color .2s, border-color .2s' }}
    >
      Sign out
    </button>
  )
}
