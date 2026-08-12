'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError } from '@/lib/client'
import styles from './login.module.css'

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
      const { orgId } = await api.post<{ orgId: string | null }>('/api/auth/login', {
        email, password,
      })
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
    <main className={styles.page}>
      <form className={styles.form} onSubmit={submit} noValidate>
        <div className={styles.mark} aria-hidden="true">GF</div>

        <div className={styles.head}>
          <h1>Connexion</h1>
          <p className={styles.sub}>Accedez a la gestion de votre club.</p>
        </div>

        {/* aria-live : l'echec doit etre annonce, pas seulement colore. */}
        <div aria-live="polite">
          {error && <p className={styles.alert} role="alert">{error}</p>}
        </div>

        <div className="field">
          <label className="label" htmlFor="email">Adresse e-mail</label>
          <input
            id="email"
            className="input"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
          />
        </div>

        <div className="field">
          <label className="label" htmlFor="password">Mot de passe</label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={e => setPassword(e.target.value)}
            aria-invalid={error ? 'true' : undefined}
          />
        </div>

        <button className="btn btn-primary" type="submit" data-busy={busy} disabled={busy}>
          Se connecter
        </button>
      </form>
    </main>
  )
}
