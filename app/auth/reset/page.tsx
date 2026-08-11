'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type State = 'loading' | 'form' | 'success' | 'expired'

export default function ResetPage() {
  const router = useRouter()
  const [state, setState]       = useState<State>('loading')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendDone, setResendDone] = useState(false)

  useEffect(() => {
    const supabase = createClient()

    // 1. Check query string for Supabase error (otp_expired, access_denied, etc.)
    const query = new URLSearchParams(window.location.search)
    const errorCode = query.get('error_code')
    if (errorCode) {
      setState('expired')
      return
    }

    // 2. Check URL hash for token (implicit flow: #access_token=...&type=recovery)
    const hash = window.location.hash
    const hashParams = new URLSearchParams(hash.replace('#', ''))
    const accessToken  = hashParams.get('access_token')
    const refreshToken = hashParams.get('refresh_token') ?? ''
    const type         = hashParams.get('type')

    if (accessToken && type === 'recovery') {
      supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          setState(error ? 'expired' : 'form')
        })
      return
    }

    // 3. PKCE flow — listen for PASSWORD_RECOVERY auth event
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setState('form')
    })

    // 4. If session already exists (user navigated back), show form
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) { setState('form'); return }
      // After 5s with no event, assume expired/invalid
      setTimeout(() => setState(s => s === 'loading' ? 'expired' : s), 5000)
    })

    return () => subscription.unsubscribe()
  }, [])

  const handleUpdate = async () => {
    if (!password || !confirm) return
    if (password.length < 8) { setError('Le mot de passe doit contenir au moins 8 caractères.'); return }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return }
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (updateError) { setError(updateError.message); return }
    setState('success')
    setTimeout(() => router.push('/dashboard'), 2500)
  }

  const handleResend = async () => {
    if (!resetEmail) return
    setResendLoading(true)
    const supabase = createClient()
    const origin = process.env.NEXT_PUBLIC_SITE_URL ?? window.location.origin
    await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: `${origin}/auth/reset`,
    })
    setResendLoading(false)
    setResendDone(true)
  }

  const inputCls = 'w-full rounded-full bg-white text-black placeholder:text-slate-500 px-5 py-3.5 text-base ring-1 ring-slate-300 focus:outline-none focus:ring-2 focus:ring-blue-300'

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">

        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-8">
          <img src="/logo-noujoum-el-chaouia.png" alt="ANCS"
            style={{ width: 52, height: 52, borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }} />
          <div className="text-xl font-serif font-semibold text-white leading-tight">
            Association<br />Noujoum El Chaouia
          </div>
        </div>

        <div className="card p-8">

          {/* ── LOADING ── */}
          {state === 'loading' && (
            <div className="flex flex-col items-center gap-4 py-6">
              <svg className="animate-spin h-8 w-8 text-white/40" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
              <p className="text-sm text-gray-400">Vérification du lien…</p>
            </div>
          )}

          {/* ── FORM ── */}
          {state === 'form' && (
            <>
              <h1 className="text-xl font-bold text-white mb-2">Nouveau mot de passe</h1>
              <p className="text-sm text-gray-400 mb-6">Choisissez un nouveau mot de passe sécurisé.</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Nouveau mot de passe</label>
                  <input type="password" className={inputCls} placeholder="8 caractères minimum"
                    value={password} onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdate()} disabled={loading} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-white mb-1.5">Confirmer</label>
                  <input type="password" className={inputCls} placeholder="••••••••"
                    value={confirm} onChange={e => setConfirm(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleUpdate()} disabled={loading} />
                </div>
                {error && (
                  <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3 text-sm text-red-700">{error}</div>
                )}
                <button onClick={handleUpdate} disabled={loading || !password || !confirm}
                  className="btn-dark w-full justify-center disabled:opacity-50">
                  {loading
                    ? <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Enregistrement…</span>
                    : 'Enregistrer le mot de passe'}
                </button>
              </div>
            </>
          )}

          {/* ── SUCCESS ── */}
          {state === 'success' && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white mb-2">Mot de passe mis à jour !</h2>
              <p className="text-sm text-gray-400">Redirection vers le tableau de bord…</p>
            </div>
          )}

          {/* ── EXPIRED / ERROR ── */}
          {state === 'expired' && (
            <div className="text-center py-2">
              <div className="w-14 h-14 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-4">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <h2 className="text-lg font-bold text-white mb-2">Lien expiré</h2>
              <p className="text-sm text-gray-400 mb-6">
                Ce lien de réinitialisation a expiré (valide 1h).<br />Saisissez votre email pour en recevoir un nouveau.
              </p>

              {resendDone ? (
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400 text-center">
                  ✓ Nouveau lien envoyé — vérifiez votre boîte mail.
                </div>
              ) : (
                <div className="space-y-3">
                  <input
                    type="email"
                    className={inputCls}
                    placeholder="votre@email.com"
                    value={resetEmail}
                    onChange={e => setResetEmail(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleResend()}
                    disabled={resendLoading}
                  />
                  <button onClick={handleResend} disabled={resendLoading || !resetEmail}
                    className="btn-dark w-full justify-center disabled:opacity-50">
                    {resendLoading
                      ? <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>Envoi…</span>
                      : 'Renvoyer le lien'}
                  </button>
                  <button onClick={() => router.push('/login')}
                    className="w-full text-center text-sm text-gray-500 hover:text-gray-300 transition-colors py-1">
                    Retour à la connexion
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
