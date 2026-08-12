'use client'

import { useCallback, useEffect, useState } from 'react'
import { UserCog, UserPlus, X, Trash2 } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'

interface StaffRow {
  membership_id: string
  user_id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'staff' | 'viewer'
  status: string
  last_login_at: string | null
}

const ROLES = {
  owner:  { label: 'Proprietaire', note: 'Tous les droits. Un seul par club.' },
  admin:  { label: 'Administrateur', note: 'Gere les membres, la comptabilite et l equipe.' },
  staff:  { label: 'Reception', note: 'Ajoute et met a jour les membres, encaisse.' },
  viewer: { label: 'Lecture seule', note: 'Consulte, ne modifie rien.' },
} as const

export default function StaffPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [staff, setStaff] = useState<StaffRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [meData, d] = await Promise.all([
        api.get<Me>('/api/me'),
        api.get<{ staff: StaffRow[] }>('/api/staff'),
      ])
      setMe(meData); setStaff(d.staff); setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setStaff([])
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id); setError(null)
    try { await action(); await load() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Operation impossible') }
    finally { setBusy(null) }
  }

  const active = staff?.filter(s => s.status === 'active') ?? []

  return (
    <div className="dashboard-shell">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="dz-hello">Equipe et droits</h1>
          <p className="dz-sub">
            {staff ? `${active.length} compte(s) actif(s)` : 'Chargement…'}
          </p>
        </div>
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => setAdding(true)}>
          <UserPlus size={15} strokeWidth={2.2} /> Ajouter un compte
        </button>
      </div>

      <PageState error={error} onRetry={load} />

      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <UserCog size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Comptes du club
          </h2>
        </div>

        {!staff && (
          <div className="members-skeleton-row" style={{ height: 56, border: 'none', borderRadius: 16, marginTop: 16 }} />
        )}

        {staff && active.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucun compte en dehors du votre. Ajoutez vos receptionnistes pour qu&apos;ils
            saisissent les membres sans partager votre mot de passe.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: staff?.length ? 16 : 0 }}>
          {active.map(s => {
            const isSelf = s.user_id === me?.user.id
            const locked = s.role === 'owner' || isSelf
            return (
              <div key={s.membership_id} style={{
                display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                padding: '0.75rem 1rem', borderRadius: 16,
                background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)',
              }}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                    {s.name}{isSelf && <span className="dz-card-note"> · vous</span>}
                  </div>
                  <div className="dz-card-note" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.email}
                    {s.last_login_at
                      ? ` · vu le ${new Date(s.last_login_at).toLocaleDateString('fr-FR')}`
                      : ' · jamais connecte'}
                  </div>
                </div>

                {locked ? (
                  <span className="badge" style={{ fontSize: '0.6rem' }}>{ROLES[s.role].label}</span>
                ) : (
                  <select
                    className="members-filter-select"
                    value={s.role}
                    aria-label={`Role de ${s.name}`}
                    disabled={busy !== null}
                    onChange={e => act(s.membership_id, () =>
                      api.put(`/api/staff/${s.membership_id}`, { role: e.target.value }))}
                    style={{ padding: '0.4rem 2rem 0.4rem 0.85rem', fontSize: '0.8rem' }}
                  >
                    {(['admin', 'staff', 'viewer'] as const).map(r => (
                      <option key={r} value={r}>{ROLES[r].label}</option>
                    ))}
                  </select>
                )}

                {!locked && (
                  <button
                    className="gf-hide"
                    title={`Retirer l acces de ${s.name}`}
                    aria-label={`Retirer l acces de ${s.name}`}
                    disabled={busy !== null}
                    onClick={() => {
                      if (!confirm(`Retirer l'acces de ${s.name} a ce club ?`)) return
                      act(s.membership_id, () => api.del(`/api/staff/${s.membership_id}`))
                    }}
                  >
                    <Trash2 size={14} strokeWidth={2.2} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="dz-card">
        <h2 className="dz-card-title">Ce que permet chaque role</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
          {(Object.keys(ROLES) as Array<keyof typeof ROLES>).map(r => (
            <div key={r} style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
              <span className="badge" style={{ fontSize: '0.58rem', flex: 'none', minWidth: '7rem' }}>
                {ROLES[r].label}
              </span>
              <span className="dz-card-note">{ROLES[r].note}</span>
            </div>
          ))}
        </div>
      </section>

      {adding && (
        <AddStaff onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load() }} />
      )}
    </div>
  )
}

function AddStaff({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'staff' | 'viewer'>('staff')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="compta-modal-overlay" onClick={onClose}
         role="dialog" aria-modal="true" aria-label="Ajouter un compte">
      <div className="compta-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Ajouter un compte</h2>
          <button className="gf-hide" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>
        <p className="dz-card-note" style={{ marginBottom: 16 }}>
          Si l&apos;adresse existe deja sur la plateforme, le compte est simplement
          rattache a ce club.
        </p>

        {error && <p role="alert" style={{ color: '#fca5a5', fontSize: '0.82rem', marginBottom: 12 }}>{error}</p>}

        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true); setError(null)
            try {
              await api.post('/api/staff', { name, email, password, role })
              onSaved()
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Creation impossible')
              setBusy(false)
            }
          }}
        >
          <input className="input-dark" placeholder="Nom complet" required autoFocus maxLength={120}
                 value={name} onChange={e => setName(e.target.value)} />
          <input className="input-dark" placeholder="Adresse e-mail" type="email" required maxLength={200}
                 value={email} onChange={e => setEmail(e.target.value)} />
          <input className="input-dark" placeholder="Mot de passe provisoire (10 min.)" type="text"
                 required maxLength={200} value={password} onChange={e => setPassword(e.target.value)} />
          <select className="input-dark" value={role} aria-label="Role"
                  onChange={e => setRole(e.target.value as typeof role)}>
            <option value="admin">Administrateur</option>
            <option value="staff">Reception</option>
            <option value="viewer">Lecture seule</option>
          </select>

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn-dark"
                    style={{ flex: 1, background: 'var(--gold)', borderColor: 'transparent' }}
                    disabled={busy || password.length < 10}>
              {busy ? 'Creation…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
