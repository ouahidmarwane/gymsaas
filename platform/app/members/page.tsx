'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Search, X } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'

interface Member {
  id: string
  name: string
  phone: string
  email: string | null
  join_date: string
  sub_expiry: string | null
  is_insured: number
  branch_name: string | null
  discipline_name: string | null
  grade_label: string | null
}

interface Branch { id: string; name: string }
interface Discipline { id: string; name: string }

const AVATAR_COLORS = ['#2f6bff', '#4d8cff', '#9b72ff', '#7ea5ff', '#8b5cf6', '#16a34a']

export default function MembersPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [disciplines, setDisciplines] = useState<Discipline[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  async function reload() {
    const [m, b, d] = await Promise.all([
      api.get<{ members: Member[] }>('/api/members?limit=200'),
      api.get<{ branches: Branch[] }>('/api/branches'),
      api.get<{ disciplines: Discipline[] }>('/api/disciplines'),
    ])
    setMembers(m.members); setBranches(b.branches); setDisciplines(d.disciplines)
  }

  useEffect(() => {
    Promise.all([api.get<Me>('/api/me'), reload()])
      .then(([meData]) => setMe(meData))
      .catch(e => setError(e instanceof ApiError ? e.message : 'Chargement impossible'))
  }, [])

  const canWrite = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin', 'staff'].includes(me.org?.role ?? ''))
    : false

  const shown = useMemo(() => {
    if (!members) return null
    const q = search.trim().toLowerCase()
    if (!q) return members
    return members.filter(m =>
      m.name.toLowerCase().includes(q) || m.phone.includes(q))
  }, [members, search])

  return (
    <div className="dashboard-shell">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 className="dz-hello">Membres</h1>
          <p className="dz-sub">
            {members ? `${members.length} membre${members.length > 1 ? 's' : ''}` : 'Chargement…'}
          </p>
        </div>
        {canWrite && (
          <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                  onClick={() => setAdding(true)}>
            <Plus size={15} strokeWidth={2.4} /> Ajouter
          </button>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" style={{
            padding: '0.7rem 1rem', borderRadius: 14,
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: '0.85rem', fontWeight: 600,
          }}>{error}</p>
        )}
      </div>

      <div style={{ position: 'relative', maxWidth: 380 }}>
        <Search size={15} strokeWidth={2.2} style={{
          position: 'absolute', insetInlineStart: 16, top: '50%', transform: 'translateY(-50%)',
          color: 'var(--muted)', pointerEvents: 'none',
        }} />
        <input
          className="members-search-input"
          style={{ paddingInlineStart: 40, width: '100%' }}
          placeholder="Rechercher un nom ou un telephone"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Rechercher un membre"
        />
      </div>

      {!shown && (
        <div className="card" style={{ overflow: 'hidden', borderRadius: 22 }}>
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="members-skeleton-row" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      )}

      {shown && shown.length === 0 && (
        <div className="card" style={{ borderRadius: 22 }}>
          <div className="members-empty">
            <span className="members-empty-icon">👥</span>
            <span className="members-empty-text">
              {search ? 'Aucun membre ne correspond a cette recherche.' : 'Aucun membre pour l’instant.'}
            </span>
          </div>
        </div>
      )}

      {shown && shown.length > 0 && (
        <div className="card overflow-hidden members-page-table members-table-wrap" style={{ borderRadius: 22 }}>
          <table className="w-full">
            <thead className="members-page-table-head">
              <tr>
                <th className="members-th px-4 py-3.5 text-left text-xs font-bold uppercase"
                    style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Membre</th>
                <th className="members-th px-4 py-3.5 text-left text-xs font-bold uppercase mobile-hide"
                    style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Contact</th>
                <th className="members-th px-4 py-3.5 text-left text-xs font-bold uppercase mobile-hide"
                    style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Grade</th>
                <th className="members-th px-4 py-3.5 text-left text-xs font-bold uppercase"
                    style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Abonnement</th>
                <th className="members-th px-4 py-3.5 text-left text-xs font-bold uppercase mobile-hide"
                    style={{ color: 'var(--muted)', letterSpacing: '0.12em' }}>Salle</th>
              </tr>
            </thead>
            <tbody key={search}>
              {shown.map((m, i) => (
                <tr key={m.id} className="members-row" style={{ animationDelay: `${i * 45}ms` }}>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <span className="members-avatar-wrap">
                        <span style={{
                          width: 36, height: 36, borderRadius: '50%', display: 'grid', placeItems: 'center',
                          background: AVATAR_COLORS[m.name.charCodeAt(0) % AVATAR_COLORS.length],
                          color: '#fff', fontWeight: 700, fontSize: '0.8rem', flexShrink: 0,
                        }}>{initials(m.name)}</span>
                      </span>
                      <span style={{ minWidth: 0 }}>
                        <span className="members-name-btn" style={{ display: 'block' }}>{m.name}</span>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          Inscrit le {new Date(m.join_date).toLocaleDateString('fr-FR')}
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 mobile-hide">
                    <div style={{ fontSize: '0.85rem' }}>{m.phone}</div>
                    {m.email && <div className="text-xs" style={{ color: 'var(--muted)' }}>{m.email}</div>}
                  </td>
                  <td className="px-4 py-3.5 mobile-hide">
                    {m.grade_label
                      ? <span className="grade-chip" style={{ padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700 }}>{m.grade_label}</span>
                      : <span className="text-xs" style={{ color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td className="px-4 py-3.5"><SubBadge expiry={m.sub_expiry} /></td>
                  <td className="px-4 py-3.5 mobile-hide">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>{m.branch_name ?? '—'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddMember
          branches={branches}
          disciplines={disciplines}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); reload() }}
        />
      )}
    </div>
  )
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]!).join('').toUpperCase()
}

/** Statut d'abonnement, avec le meme vocabulaire de couleurs que l'app d'origine. */
function SubBadge({ expiry }: { expiry: string | null }) {
  if (!expiry) return <span className="badge">Inconnu</span>

  const days = Math.ceil((Date.parse(expiry) - Date.now()) / 86_400_000)
  const cls = days < 0
    ? 'text-red-300 bg-red-500/10 ring-red-500/30'
    : days <= 7
      ? 'text-amber-300 bg-amber-500/10 ring-amber-500/30'
      : 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'
  const label = days < 0 ? 'Expire' : days <= 7 ? 'Expire bientot' : 'Actif'

  return (
    <>
      <span className={`badge ${cls}`}>{label}</span>
      <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
        {new Date(expiry).toLocaleDateString('fr-FR')}
      </div>
    </>
  )
}

function AddMember({
  branches, disciplines, onClose, onSaved,
}: {
  branches: Branch[]; disciplines: Discipline[]
  onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [branchId, setBranchId] = useState(branches[0]?.id ?? '')
  const [disciplineId, setDisciplineId] = useState(disciplines[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Ajouter un membre">
      <div className="compta-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>Ajouter un membre</h2>
          <button className="gf-hide" onClick={onClose} aria-label="Fermer"><X size={15} /></button>
        </div>

        <div aria-live="polite">
          {error && <p role="alert" style={{ color: '#fca5a5', fontSize: '0.82rem', marginBottom: 12 }}>{error}</p>}
        </div>

        <form
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          onSubmit={async e => {
            e.preventDefault()
            setBusy(true); setError(null)
            try {
              await api.post('/api/members', {
                name, phone,
                email: email || undefined,
                branchId: branchId || undefined,
                disciplineId: disciplineId || undefined,
              })
              onSaved()
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Enregistrement impossible')
              setBusy(false)
            }
          }}
        >
          <input className="input-dark" placeholder="Nom complet" required value={name}
                 onChange={e => setName(e.target.value)} autoFocus maxLength={200} />
          <input className="input-dark" placeholder="Telephone" required value={phone}
                 onChange={e => setPhone(e.target.value)} inputMode="tel" maxLength={30} />
          <input className="input-dark" placeholder="E-mail (facultatif)" type="email" value={email}
                 onChange={e => setEmail(e.target.value)} maxLength={200} />

          {branches.length > 0 && (
            <select className="input-dark" value={branchId} onChange={e => setBranchId(e.target.value)}
                    aria-label="Salle">
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}
          {disciplines.length > 0 && (
            <select className="input-dark" value={disciplineId} onChange={e => setDisciplineId(e.target.value)}
                    aria-label="Sport">
              {disciplines.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={onClose} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn-dark" style={{ flex: 1, background: 'var(--gold)', borderColor: 'transparent' }}
                    disabled={busy || !name.trim() || !phone.trim()}>
              {busy ? 'Enregistrement…' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
