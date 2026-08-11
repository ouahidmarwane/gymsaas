'use client'
// app/login/page.tsx
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { resolveLoginEmail, recordLogin, recordFailedLogin } from '@/lib/actions'

// Identifiant d'appareil persistant (détection de nouvelle connexion)
function getDeviceId(): string {
  try {
    let id = localStorage.getItem('gf_device')
    if (!id) {
      id = (crypto?.randomUUID?.() ?? String(Math.random()).slice(2)) + '-' + Date.now().toString(36)
      localStorage.setItem('gf_device', id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

type View = 'login' | 'reset' | 'reset_sent'

export default function LoginPage() {
  const router = useRouter()
  const [view, setView]         = useState<View>('login')
  const [email, setEmail]       = useState('')     // email OU nom d'utilisateur
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [notice, setNotice]     = useState('')
  const [loading, setLoading]   = useState(false)

  // Message de déconnexion selon la raison (?reason=…)
  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get('reason')
    if (reason === 'idle')    setNotice('Vous avez été déconnecté pour inactivité.')
    if (reason === 'expired') setNotice('Session expirée — veuillez vous reconnecter.')
    if (reason === 'revoked') setNotice('Votre session a été fermée par un administrateur.')
  }, [])

  // ── Login (email ou nom d'utilisateur) ────────────────────────
  const handleLogin = async () => {
    if (!email || !password) return
    setError('')
    setLoading(true)
    // Résoudre le nom d'utilisateur → email si besoin
    const resolved = await resolveLoginEmail(email)
    if (resolved.error || !resolved.email) {
      setError(resolved.error ?? 'Identifiant ou mot de passe incorrect.')
      setLoading(false)
      return
    }
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithPassword({ email: resolved.email, password })
    if (authError) {
      // Journalise l'échec (détection brute-force → alerte Telegram)
      recordFailedLogin(email).catch(() => {})
      setError('Identifiant ou mot de passe incorrect.')
      setLoading(false)
      return
    }
    // Détection d'une connexion depuis un nouvel appareil (alerte Telegram)
    try { await recordLogin(getDeviceId()) } catch {}
    window.location.href = '/dashboard'
  }

  // ── Reset password request ────────────────────────────────────
  const handleReset = async () => {
    if (!email) { setError('Veuillez saisir votre email.'); return }
    setError('')
    setLoading(true)
    const supabase = createClient()
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/reset`,
    })
    setLoading(false)
    if (resetError) {
      setError(resetError.message)
      return
    }
    setView('reset_sent')
  }

  const inputCls = 'input w-full rounded-full bg-white text-black placeholder:text-slate-500 px-5 py-4 text-base ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-200'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img src="/logo-noujoum-el-chaouia.png" alt="ANCS" style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }} />
            <div className="text-2xl font-serif font-semibold text-white tracking-tight text-left leading-tight">
              Association<br />Noujoum El Chaouia
            </div>
          </div>
          <div className="text-gray-400 text-sm mt-1">Gestion de salle de sport</div>
        </div>

        <div className="card p-8">

          {/* ── LOGIN VIEW ── */}
          {view === 'login' && (
            <>
              <h1 className="text-xl font-bold text-white mb-6">Connexion</h1>
              {notice && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-sm text-amber-800 mb-4">{notice}</div>
              )}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Email ou nom d'utilisateur</label>
                  <input type="text" autoCapitalize="none" autoComplete="username" className={inputCls} placeholder="admin@votresalle.ma ou votre nom"
                    value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()} disabled={loading} />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-sm font-medium text-white">Mot de passe</label>
                    <button
                      type="button"
                      onClick={() => { setView('reset'); setError('') }}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Mot de passe oublié ?
                    </button>
                  </div>
                  <input type="password" className={inputCls} placeholder="••••••••"
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()} disabled={loading} />
                </div>

                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
                )}

                <button onClick={handleLogin} disabled={loading || !email || !password}
                  className="btn-dark w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Connexion…
                    </span>
                  ) : 'Se connecter'}
                </button>
              </div>
            </>
          )}

          {/* ── RESET REQUEST VIEW ── */}
          {view === 'reset' && (
            <>
              <button onClick={() => { setView('login'); setError('') }}
                className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Retour
              </button>

              <h1 className="text-xl font-bold text-white mb-2">Réinitialiser le mot de passe</h1>
              <p className="text-sm text-gray-400 mb-6">
                Saisissez votre email et nous vous enverrons un lien pour créer un nouveau mot de passe.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Email</label>
                  <input type="email" className={inputCls} placeholder="admin@votresalle.ma"
                    value={email} onChange={e => setEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleReset()} disabled={loading} />
                </div>

                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
                )}

                <button onClick={handleReset} disabled={loading || !email}
                  className="btn-dark w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed">
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                      </svg>
                      Envoi…
                    </span>
                  ) : 'Envoyer le lien'}
                </button>
              </div>
            </>
          )}

          {/* ── RESET SENT VIEW ── */}
          {view === 'reset_sent' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <polyline points="22,6 12,13 2,6"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white mb-2">Email envoyé !</h2>
              <p className="text-sm text-gray-400 mb-6">
                Un lien de réinitialisation a été envoyé à <span className="text-white font-semibold">{email}</span>.
                Vérifiez votre boîte mail et cliquez sur le lien.
              </p>
              <button onClick={() => { setView('login'); setError('') }}
                className="btn-ghost w-full justify-center">
                Retour à la connexion
              </button>
            </div>
          )}

        </div>

        <p className="text-center text-gray-500 text-xs mt-6">
          Accès réservé au personnel autorisé
        </p>
      </div>
    </div>
  )
}
