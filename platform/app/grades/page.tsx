'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Award, Check, X, CalendarPlus } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'

interface Session {
  id: string
  member_name: string
  scheduled_date: string
  status: 'pending' | 'passed' | 'failed'
  from_label: string | null
  to_label: string | null
  to_color: string | null
  notes: string | null
}

interface Eligible {
  id: string
  name: string
  current_label: string | null
}

export default function GradesPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [eligible, setEligible] = useState<Eligible[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))

  const load = useCallback(async () => {
    try {
      const meData = await api.get<Me>('/api/me')
      setMe(meData)
      // Un club sans grade n'a rien a faire ici : l'ecran n'existe pas pour lui.
      if (meData.capabilities && !meData.capabilities.hasGrading) return

      const d = await api.get<{ sessions: Session[]; eligible: Eligible[] }>('/api/grades')
      setSessions(d.sessions); setEligible(d.eligible); setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setSessions([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id); setError(null)
    try { await action(); await load() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Operation impossible') }
    finally { setBusy(null) }
  }

  const canWrite = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin', 'staff'].includes(me.org?.role ?? ''))
    : false

  if (me?.capabilities && !me.capabilities.hasGrading) {
    return (
      <div className="dashboard-shell">
        <section className="dz-card">
          <div className="gf-placeholder">
            <Award size={38} strokeWidth={1.6} className="gf-placeholder-icon" />
            <h2 className="gf-placeholder-title">Aucune discipline gradee</h2>
            <p className="gf-placeholder-body">
              Ce club n&apos;enseigne aucun sport a ceintures ou a grades. Ajoutez une
              echelle a une discipline pour activer cet ecran.
            </p>
            <Link className="btn-ghost" href="/setup" style={{ marginTop: 8 }}>
              Ouvrir la configuration
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const pending = sessions?.filter(s => s.status === 'pending') ?? []
  const history = sessions?.filter(s => s.status !== 'pending') ?? []

  return (
    <EditablePage
      page="grades"
      me={me}
      title="Passage de grade"
      subtitle={sessions ? `${pending.length} passage(s) programme(s)` : 'Chargement…'}
    >

      <PageState error={error} onRetry={load} />

      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title">Passages programmes</h2>
        </div>

        {!sessions && (
          <div className="members-skeleton-row" style={{ height: 56, border: 'none', borderRadius: 16, marginTop: 16 }} />
        )}

        {sessions && pending.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucun passage programme. Convoquez un membre depuis la liste ci-dessous.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: pending.length ? 16 : 0 }}>
          {pending.map(s => {
            const days = Math.ceil((Date.parse(s.scheduled_date) - Date.now()) / 86_400_000)
            return (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '0.75rem 1rem', borderRadius: 16,
                background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{s.member_name}</div>
                  <div className="dz-card-note">
                    {s.from_label ?? 'sans grade'} → <strong style={{ color: s.to_color ?? 'var(--text)' }}>
                      {s.to_label ?? 'niveau suivant'}
                    </strong>
                    {' · '}{new Date(s.scheduled_date).toLocaleDateString('fr-FR')}
                  </div>
                </div>

                <span className={`badge ${days < 0 ? 'text-red-300 bg-red-500/10 ring-red-500/30'
                                                   : 'text-amber-300 bg-amber-500/10 ring-amber-500/30'}`}
                      style={{ fontSize: '0.6rem' }}>
                  {days < 0 ? `en retard de ${-days} j` : days === 0 ? "aujourd'hui" : `J-${days}`}
                </span>

                {canWrite && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn-ghost" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}
                            disabled={busy !== null}
                            onClick={() => act(s.id, () =>
                              api.post(`/api/grades/sessions/${s.id}/decision`, { passed: true }))}>
                      <Check size={13} strokeWidth={2.4} /> Reussi
                    </button>
                    <button className="btn-ghost" style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}
                            disabled={busy !== null}
                            onClick={() => act(s.id, () =>
                              api.post(`/api/grades/sessions/${s.id}/decision`, { passed: false }))}>
                      <X size={13} strokeWidth={2.4} /> Echoue
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {canWrite && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Membres eligibles</h2>
            <span className="dz-card-note">{eligible.length}</span>
          </div>
          <p className="dz-card-note" style={{ marginTop: 8 }}>
            Abonnement a jour, inscrits depuis trois mois au moins, et pas deja convoques.
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600 }}>
              Date du passage
            </label>
            <input className="input-dark" type="date" value={date} style={{ width: 'auto' }}
                   onChange={e => setDate(e.target.value)} />
          </div>

          {eligible.length === 0 ? (
            <p className="dz-card-note" style={{ marginTop: 14 }}>
              Personne n&apos;est eligible pour l&apos;instant.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14,
                          maxHeight: 320, overflow: 'auto' }}>
              {eligible.map(m => (
                <div key={m.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '0.55rem 0.85rem', borderRadius: 14,
                  background: 'rgba(255,255,255,0.04)', fontSize: '0.85rem',
                }}>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                  <span className="dz-card-note" style={{ flex: 'none' }}>
                    {m.current_label ?? 'sans grade'}
                  </span>
                  <button className="btn-ghost" style={{ padding: '0.3rem 0.7rem', fontSize: '0.73rem', flex: 'none' }}
                          disabled={busy !== null}
                          onClick={() => act(m.id, () =>
                            api.post('/api/grades/sessions', { memberId: m.id, scheduledDate: date }))}>
                    <CalendarPlus size={13} strokeWidth={2.2} /> Convoquer
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Historique</h2>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14,
                        maxHeight: 320, overflow: 'auto' }}>
            {history.map(s => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 12,
                                       fontSize: '0.82rem', padding: '0.5rem 0.85rem',
                                       borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap' }}>{s.member_name}</span>
                <span className="dz-card-note" style={{ flex: 'none' }}>{s.to_label ?? '—'}</span>
                <span className={`badge ${s.status === 'passed'
                        ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'
                        : 'text-red-300 bg-red-500/10 ring-red-500/30'}`}
                      style={{ fontSize: '0.58rem', flex: 'none' }}>
                  {s.status === 'passed' ? 'Reussi' : 'Echoue'}
                </span>
                <span className="dz-card-note" style={{ flex: 'none' }}>
                  {new Date(s.scheduled_date).toLocaleDateString('fr-FR')}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </EditablePage>
  )
}
