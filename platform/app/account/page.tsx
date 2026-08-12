'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { KeyRound, Monitor, ShieldCheck } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'

interface SessionRow {
  created_at: string
  last_seen_at: string
  ip: string | null
  user_agent: string | null
  support_org_id: string | null
}

interface SupportEntry {
  action: string
  detail: string | null
  created_at: string
  actor_name: string | null
}

// Ce que chaque action de la plateforme signifie, en clair. Un journal qu'on
// ne sait pas lire ne rassure personne.
const ACTION_LABEL: Record<string, string> = {
  support_enter: 'Ouverture de votre club depuis la plateforme',
  support_exit: 'Fin de l intervention',
  support_write_enabled: 'Passage en modification',
  support_read_only: 'Passage en lecture seule',
  support_write_branding: 'Modification de l apparence',
  support_write_layout: 'Modification du tableau de bord',
  support_write_logo: 'Changement du logo',
  read_club_stats: 'Consultation de vos chiffres',
  write_branding: 'Modification de l apparence',
  GET_branches: 'Consultation de vos salles',
  POST_branches: 'Ajout d une salle',
  GET_disciplines: 'Consultation de vos sports',
  POST_disciplines: 'Ajout d un sport',
  create_club: 'Creation du club',
}

export default function AccountPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [supportLog, setSupportLog] = useState<SupportEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [meData, s] = await Promise.all([
        api.get<Me>('/api/me'),
        api.get<{ sessions: SessionRow[] }>('/api/account/sessions'),
      ])
      setMe(meData); setSessions(s.sessions); setError(null)

      // Reserve aux administrateurs du club : on tente, et on s'abstient
      // silencieusement si l'acces est refuse.
      try {
        const log = await api.get<{ entries: SupportEntry[] }>('/api/support-log')
        setSupportLog(log.entries)
      } catch { setSupportLog(null) }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="dashboard-shell">
      <div>
        <h1 className="dz-hello">Mon compte</h1>
        <p className="dz-sub">{me ? `${me.user.name} · ${me.user.email}` : 'Chargement…'}</p>
      </div>

      <PageState error={error} onRetry={load} />

      <PasswordCard />

      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Monitor size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Vos connexions
          </h2>
          <span className="dz-card-note">{sessions.length} session(s)</span>
        </div>
        <p className="dz-card-note" style={{ marginTop: 8 }}>
          Une connexion que vous ne reconnaissez pas ? Changez votre mot de passe :
          cela deconnecte partout ailleurs.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          {sessions.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.82rem',
                                  padding: '0.55rem 0.85rem', borderRadius: 14,
                                  background: 'var(--overlay-soft)' }}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                             whiteSpace: 'nowrap' }}>
                {s.ip ?? 'adresse inconnue'}
                {s.support_org_id && (
                  <span className="badge text-red-300 bg-red-500/10 ring-red-500/30"
                        style={{ fontSize: '0.55rem', marginInlineStart: 8 }}>support</span>
                )}
              </span>
              <span className="dz-card-note" style={{ flex: 'none' }}>
                {new Date(s.last_seen_at).toLocaleString('fr-FR', {
                  day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* La transparence promise au club : qui, cote plateforme, a ouvert ses
          donnees, et quand. Elle existait dans l'API sans jamais etre affichee. */}
      {supportLog && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <ShieldCheck size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} />
              Interventions de la plateforme
            </h2>
            <span className="dz-card-note">100 dernieres</span>
          </div>

          {supportLog.length === 0 ? (
            <p className="dz-card-note" style={{ marginTop: 14 }}>
              Personne de la plateforme n&apos;a ouvert les donnees de votre club.
              Toute intervention future apparaitra ici.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14,
                          maxHeight: 340, overflow: 'auto' }}>
              {supportLog.map((e, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.82rem',
                                      padding: '0.55rem 0.85rem', borderRadius: 14,
                                      background: 'var(--overlay-soft)' }}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {ACTION_LABEL[e.action] ?? e.action}
                    {e.actor_name && <span className="dz-card-note"> · {e.actor_name}</span>}
                  </span>
                  <span className="dz-card-note" style={{ flex: 'none' }}>
                    {new Date(e.created_at).toLocaleString('fr-FR', {
                      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}

function PasswordCard() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (next !== confirm) { setError('Les deux mots de passe ne correspondent pas'); return }
    setBusy(true); setError(null); setDone(false)
    try {
      await api.post('/api/account/password', { currentPassword: current, newPassword: next })
      setCurrent(''); setNext(''); setConfirm(''); setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Changement impossible')
    } finally { setBusy(false) }
  }

  return (
    <section className="dz-card">
      <div className="dz-card-head">
        <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <KeyRound size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Mot de passe
        </h2>
        <div aria-live="polite" style={{ fontSize: '0.78rem' }}>
          {error && <span style={{ color: '#fca5a5' }}>{error}</span>}
          {done && !error && <span style={{ color: '#6ee7b7' }}>Change. Vos autres sessions sont fermees.</span>}
        </div>
      </div>

      <form onSubmit={submit}
            style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 12rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Mot de passe actuel</span>
          <input className="input-dark" type="password" autoComplete="current-password" required
                 value={current} onChange={e => setCurrent(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 12rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Nouveau</span>
          <input className="input-dark" type="password" autoComplete="new-password" required minLength={10}
                 value={next} onChange={e => setNext(e.target.value)} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 12rem' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>Confirmer</span>
          <input className="input-dark" type="password" autoComplete="new-password" required minLength={10}
                 value={confirm} onChange={e => setConfirm(e.target.value)} />
        </label>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                disabled={busy || next.length < 10}>
          {busy ? 'Changement…' : 'Changer'}
        </button>
      </form>
      <p className="dz-card-note" style={{ marginTop: 10 }}>
        10 caracteres minimum. Changer le mot de passe ferme toutes vos autres sessions.
      </p>
    </section>
  )
}
