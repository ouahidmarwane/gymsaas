'use client'

import { useCallback, useEffect, useState } from 'react'
import { Trophy, Plus, X, Medal } from 'lucide-react'
import { useDiscipline } from '@/lib/discipline'
import { api, ApiError, type Me } from '@/lib/client'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'

interface Championship {
  id: string
  name: string
  event_date: string
  location: string | null
  status: string
  discipline_name: string | null
  branch_name: string | null
  athletes: number
  medals: number
}

interface Athlete {
  id: string
  member_id: string
  member_name: string
  grade_label: string | null
  category: string | null
  weight_class: string | null
  place: number | null
}

interface Member { id: string; name: string }

const PLACE_LABEL: Record<number, string> = { 1: 'Or', 2: 'Argent', 3: 'Bronze' }
const PLACE_COLOR: Record<number, string> = { 1: '#f59e0b', 2: '#94a3b8', 3: '#b45309' }

export default function ChampionshipsPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [list, setList] = useState<Championship[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [athletes, setAthletes] = useState<Athlete[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  // Le vivier d'athletes suit la discipline retenue en haut : proposer un
  // judoka pour un championnat de karate n'aurait pas de sens.
  const { active } = useDiscipline()

  const load = useCallback(async () => {
    try {
      const [meData, d, m] = await Promise.all([
        api.get<Me>('/api/me'),
        api.get<{ championships: Championship[] }>('/api/championships'),
        api.get<{ members: Member[] }>(`/api/members?limit=200&disciplineId=${active}`),
      ])
      setMe(meData); setList(d.championships); setMembers(m.members); setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setList([])
    }
  }, [active])

  useEffect(() => { load() }, [load])

  const openRoster = useCallback(async (id: string) => {
    setSelected(id)
    try {
      const d = await api.get<{ athletes: Athlete[] }>(`/api/championships/${id}/athletes`)
      setAthletes(d.athletes)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement de la selection impossible')
    }
  }, [])

  async function act(id: string, action: () => Promise<unknown>) {
    setBusy(id); setError(null)
    try {
      await action()
      await load()
      if (selected) await openRoster(selected)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Operation impossible')
    } finally { setBusy(null) }
  }

  const canWrite = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin', 'staff'].includes(me.org?.role ?? ''))
    : false

  const current = list?.find(c => c.id === selected) ?? null
  const enrolled = new Set(athletes.map(a => a.member_id))

  return (
    <EditablePage
      page="championships"
      me={me}
      title="Championnats"
      subtitle={list ? `${list.length} competition(s)` : 'Chargement…'}
      actions={canWrite ? (
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => setCreating(true)}>
          <Plus size={15} strokeWidth={2.4} /> Ajouter
        </button>
      ) : undefined}
    >

      <PageState error={error} onRetry={load} />

      {!list && (
        <div className="members-skeleton-row" style={{ height: 120, border: 'none', borderRadius: 28 }} />
      )}

      {list && list.length === 0 && (
        <section className="dz-card">
          <div className="gf-placeholder">
            <Trophy size={38} strokeWidth={1.6} className="gf-placeholder-icon" />
            <h2 className="gf-placeholder-title">Aucune competition</h2>
            <p className="gf-placeholder-body">
              Enregistrez un championnat, puis selectionnez les athletes avec leur
              categorie et leur poids. Les resultats se saisissent ensuite.
            </p>
          </div>
        </section>
      )}

      {list && list.length > 0 && (
        <div className="admin-club-grid">
          {list.map(c => {
            const days = Math.ceil((Date.parse(c.event_date) - Date.now()) / 86_400_000)
            const past = days < 0
            return (
              <article key={c.id} className="dz-card admin-club-card"
                       style={{ borderColor: selected === c.id ? 'var(--gold)' : undefined }}>
                <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 className="admin-club-name">{c.name}</h2>
                    <span className="admin-club-slug" style={{ fontFamily: 'inherit' }}>
                      {new Date(c.event_date).toLocaleDateString('fr-FR', {
                        day: 'numeric', month: 'long', year: 'numeric',
                      })}
                      {c.location && ` · ${c.location}`}
                    </span>
                  </div>
                  <span className={`badge ${past
                          ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'
                          : 'text-amber-300 bg-amber-500/10 ring-amber-500/30'}`}
                        style={{ fontSize: '0.6rem', flex: 'none' }}>
                    {past ? 'passe' : days === 0 ? "aujourd'hui" : `J-${days}`}
                  </span>
                </header>

                <dl className="admin-club-figures">
                  <div className="admin-figure">
                    <dt className="admin-figure-label">Athletes</dt>
                    <dd className="admin-figure-value">{c.athletes}</dd>
                  </div>
                  <div className="admin-figure">
                    <dt className="admin-figure-label">Medailles</dt>
                    <dd className="admin-figure-value">{c.medals}</dd>
                  </div>
                  <div className="admin-figure">
                    <dt className="admin-figure-label">Sport</dt>
                    <dd className="admin-figure-value" style={{ fontSize: '0.85rem' }}>
                      {c.discipline_name ?? '—'}
                    </dd>
                  </div>
                </dl>

                <button className="btn-ghost" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                        onClick={() => openRoster(c.id)}>
                  {selected === c.id ? 'Selection ouverte' : 'Voir la selection'}
                </button>
              </article>
            )
          })}
        </div>
      )}

      {current && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Medal size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} />
              Selection — {current.name}
            </h2>
            <button className="gf-hide" onClick={() => setSelected(null)} aria-label="Fermer la selection">
              <X size={15} />
            </button>
          </div>

          {athletes.length === 0 ? (
            <p className="dz-card-note" style={{ marginTop: 14 }}>
              Aucun athlete selectionne pour cette competition.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
              {athletes.map(a => (
                <div key={a.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
                  padding: '0.6rem 0.9rem', borderRadius: 14,
                  background: 'var(--overlay-soft)', fontSize: '0.85rem',
                }}>
                  <span style={{ flex: 1, minWidth: 120, fontWeight: 600 }}>{a.member_name}</span>
                  {a.grade_label && (
                    <span className="grade-chip" style={{ padding: '0.1rem 0.55rem', borderRadius: 999,
                                                          fontSize: '0.65rem', fontWeight: 700 }}>
                      {a.grade_label}
                    </span>
                  )}
                  {a.category && <span className="dz-card-note">{a.category}</span>}
                  {a.weight_class && <span className="dz-card-note">{a.weight_class}</span>}

                  {a.place ? (
                    <span className="badge" style={{
                      fontSize: '0.6rem', color: PLACE_COLOR[a.place],
                      background: `${PLACE_COLOR[a.place]}1a`,
                    }}>{PLACE_LABEL[a.place]}</span>
                  ) : <span className="dz-card-note">sans resultat</span>}

                  {canWrite && (
                    <select
                      className="members-filter-select"
                      value={a.place ?? ''}
                      aria-label={`Resultat de ${a.member_name}`}
                      disabled={busy !== null}
                      style={{ padding: '0.3rem 1.8rem 0.3rem 0.7rem', fontSize: '0.75rem' }}
                      onChange={e => act(a.id, () =>
                        api.post(`/api/championships/athletes/${a.id}/result`, {
                          place: e.target.value === '' ? null : Number(e.target.value),
                        }))}
                    >
                      <option value="">Aucun</option>
                      <option value="1">Or</option>
                      <option value="2">Argent</option>
                      <option value="3">Bronze</option>
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}

          {canWrite && (
            <AddAthlete
              members={members.filter(m => !enrolled.has(m.id))}
              busy={busy !== null}
              onAdd={(memberId, category, weightClass) =>
                act(memberId, () => api.post(`/api/championships/${current.id}/athletes`, {
                  memberId, category, weightClass,
                }))}
            />
          )}
        </section>
      )}

      {creating && (
        <CreateChampionship onClose={() => setCreating(false)}
                            onSaved={() => { setCreating(false); load() }} />
      )}
    </EditablePage>
  )
}

function AddAthlete({ members, busy, onAdd }: {
  members: Member[]; busy: boolean
  onAdd: (memberId: string, category: string, weightClass: string) => void
}) {
  const [memberId, setMemberId] = useState('')
  const [category, setCategory] = useState('')
  const [weightClass, setWeightClass] = useState('')

  if (members.length === 0) {
    return <p className="dz-card-note" style={{ marginTop: 14 }}>Tous les membres sont deja selectionnes.</p>
  }

  return (
    <form
      style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap', alignItems: 'center' }}
      onSubmit={e => {
        e.preventDefault()
        if (!memberId) return
        onAdd(memberId, category, weightClass)
        setMemberId(''); setCategory(''); setWeightClass('')
      }}
    >
      <select className="members-filter-select" value={memberId} required aria-label="Membre"
              style={{ flex: '1 1 12rem' }} onChange={e => setMemberId(e.target.value)}>
        <option value="">Choisir un membre…</option>
        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      {/* Categorie et poids en texte libre : les federations ne les
          decoupent pas de la meme facon d'un sport a l'autre. */}
      <input className="input-dark" placeholder="Categorie" value={category} maxLength={80}
             style={{ flex: '0 1 9rem' }} onChange={e => setCategory(e.target.value)} />
      <input className="input-dark" placeholder="Poids" value={weightClass} maxLength={40}
             style={{ flex: '0 1 7rem' }} onChange={e => setWeightClass(e.target.value)} />
      <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
              disabled={busy || !memberId}>
        <Plus size={14} strokeWidth={2.4} /> Selectionner
      </button>
    </form>
  )
}

function CreateChampionship({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('')
  const [eventDate, setEventDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [location, setLocation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss}
         role="dialog" aria-modal="true" aria-label="Ajouter un championnat">
      <div ref={cardRef} className="compta-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700 }}>Ajouter un championnat</h2>
          <button className="gf-hide" onClick={dismiss} aria-label="Fermer"><X size={15} /></button>
        </div>

        {error && <p role="alert" style={{ color: '#fca5a5', fontSize: '0.82rem', marginBottom: 12 }}>{error}</p>}

        <form style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
              onSubmit={async e => {
                e.preventDefault()
                setBusy(true); setError(null)
                try {
                  await api.post('/api/championships', { name, eventDate, location: location || undefined })
                  onSaved()
                } catch (err) {
                  setError(err instanceof ApiError ? err.message : 'Creation impossible')
                  setBusy(false)
                }
              }}>
          <input className="input-dark" placeholder="Nom de la competition" required autoFocus maxLength={160}
                 value={name} onChange={e => setName(e.target.value)} />
          <input className="input-dark" type="date" required value={eventDate}
                 onChange={e => setEventDate(e.target.value)} />
          <input className="input-dark" placeholder="Lieu (facultatif)" maxLength={160}
                 value={location} onChange={e => setLocation(e.target.value)} />

          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={dismiss} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="btn-dark"
                    style={{ flex: 1, background: 'var(--gold)', borderColor: 'transparent' }}
                    disabled={busy || !name.trim()}>
              {busy ? 'Creation…' : 'Creer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
