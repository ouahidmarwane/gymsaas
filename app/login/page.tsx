'use client'

import Image from 'next/image'
import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { JUST_LOGGED_IN, LOGIN_EVENT } from '@/components/WelcomeSplash'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    const animationStartedAt = performance.now()
    try {
      const { orgId } = await api.post<{ orgId: string | null }>('/api/auth/login', { email, password })
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const remainingAnimation = reducedMotion ? 0 : Math.max(0, 1500 - (performance.now() - animationStartedAt))
      if (remainingAnimation > 0) await new Promise(resolve => window.setTimeout(resolve, remainingAnimation))
      try { sessionStorage.setItem(JUST_LOGGED_IN, '1') } catch { /* mode prive */ }
      window.dispatchEvent(new Event(LOGIN_EVENT))
      router.replace(orgId ? '/dashboard' : '/admin')
      router.refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Connexion impossible')
      setBusy(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-auth-panel" aria-labelledby="login-title">
        <div className="login-auth-inner">
          <div className="login-intro">
            <h1 id="login-title">Heureux de vous revoir.</h1>
            <p>Connectez-vous pour piloter votre club et retrouver votre espace GymFlow.</p>
          </div>

          <form onSubmit={submit} noValidate className="login-form">
            <div className="login-field">
              <label htmlFor="login-email">Adresse e-mail</label>
              <div className="login-input-wrap">
                <Mail aria-hidden="true" size={19} strokeWidth={1.8} />
                <input id="login-email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" spellCheck="false" autoFocus required placeholder="vous@votreclub.ma" value={email} onChange={event => setEmail(event.target.value)} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'login-error' : undefined} disabled={busy} />
              </div>
            </div>

            <div className="login-field">
              <label htmlFor="login-password">Mot de passe</label>
              <div className="login-input-wrap">
                <LockKeyhole aria-hidden="true" size={19} strokeWidth={1.8} />
                <input id="login-password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" required placeholder="Votre mot de passe" value={password} onChange={event => setPassword(event.target.value)} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? 'login-error' : undefined} disabled={busy} />
                <button type="button" className="login-password-toggle" onClick={() => setPasswordVisible(current => !current)} aria-label={passwordVisible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'} aria-pressed={passwordVisible} disabled={busy}>
                  {passwordVisible ? <EyeOff aria-hidden="true" size={19} strokeWidth={1.8} /> : <Eye aria-hidden="true" size={19} strokeWidth={1.8} />}
                </button>
              </div>
            </div>

            <div className="login-feedback" aria-live="polite">
              {error && <p id="login-error" role="alert">{error}</p>}
            </div>

            <button
              type="submit"
              className="login-submit"
              disabled={busy}
              aria-busy={busy}
              onPointerMove={event => {
                const bounds = event.currentTarget.getBoundingClientRect()
                event.currentTarget.style.setProperty('--cursor-x', `${event.clientX - bounds.left}px`)
                event.currentTarget.style.setProperty('--cursor-y', `${event.clientY - bounds.top}px`)
              }}
            >
              <span>{busy ? 'Connexion en cours…' : 'Se connecter'}</span>
              <span className="login-submit-icon" aria-hidden="true">{busy ? <i className="login-spinner" /> : <ArrowRight size={20} strokeWidth={2} />}</span>
            </button>
          </form>

          <footer className="login-security-note">
            <ShieldCheck aria-hidden="true" size={17} strokeWidth={1.8} />
            <span>Accès sécurisé à votre espace de gestion</span>
          </footer>
        </div>
      </section>

      <section className="login-hero" aria-label="L’univers GymFlow">
        <Image src="/brand/gymflow-login-hero.webp" alt="Athlète s’entraînant dans un club équipé par GymFlow" fill sizes="(max-width: 767px) 100vw, (max-width: 1200px) 55vw, 64vw" className="login-hero-image" priority />
        <div className="login-hero-shade" aria-hidden="true" />
        <div className="login-hero-copy">
          <p>Votre club. Votre rythme.</p>
          <h2>Transformez chaque journée en performance.</h2>
          <span>Gestion, suivi et expérience membre réunis dans un seul espace.</span>
        </div>
      </section>
    </main>
  )
}
