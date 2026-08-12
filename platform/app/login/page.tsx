'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/client'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { orgId } = await api.post<{ orgId: string | null }>('/api/auth/login', { email, password })
      // Un compte de plateforme sans club atterrit sur la supervision ;
      // tout le monde d'autre sur son tableau de bord.
      router.replace(orgId ? '/dashboard' : '/admin')
      router.refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion impossible')
      setBusy(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4"
          style={{ background: 'linear-gradient(to bottom right, #080b12, #171a22)' }}>
      <form onSubmit={submit} noValidate className="card p-8 w-full" style={{ maxWidth: 420 }}>
        <div className="flex items-center gap-3 mb-6">
          <span className="rail-avatar" style={{ width: 44, height: 44, fontSize: '0.95rem' }}>GF</span>
          <div>
            <h1 style={{ fontSize: '1.35rem', fontWeight: 800, letterSpacing: '-0.025em' }}>GymFlow</h1>
            <p style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>Gestion de clubs sportifs</p>
          </div>
        </div>

        {/* aria-live : l'echec doit etre annonce, pas seulement colore. */}
        <div aria-live="polite">
          {error && (
            <p role="alert" style={{
              padding: '0.7rem 1rem', marginBottom: '1rem', borderRadius: 14,
              background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
              color: '#fca5a5', fontSize: '0.85rem', fontWeight: 600,
            }}>{error}</p>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>Adresse e-mail</span>
            <input
              className="input-dark"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              aria-invalid={error ? 'true' : undefined}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--muted)' }}>Mot de passe</span>
            <input
              className="input-dark"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              aria-invalid={error ? 'true' : undefined}
            />
          </label>

          <button
            type="submit"
            className="btn-dark w-full"
            style={{ background: 'var(--gold)', borderColor: 'transparent', marginTop: 6 }}
            disabled={busy}
          >
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </div>
      </form>
    </main>
  )
}
