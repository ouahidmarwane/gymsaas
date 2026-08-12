'use client'

import { useEffect, useState } from 'react'
import { Building2, Dumbbell, Plus, Trash2 } from 'lucide-react'
import { api, ApiError } from '@/lib/client'

interface Branch { id: string; name: string; is_active: number }
interface Grade { id: string; rank: number; label: string }
interface Discipline { id: string; name: string; has_grading: number; grades: Grade[] }

// Echelles proposees : le club choisit la sienne ou part de zero. Rien n'est
// impose — un club de boxe n'a pas de grades du tout.
const LADDERS: Record<string, string[]> = {
  'Karate': ['Blanche', 'Jaune', 'Orange', 'Verte', 'Bleue', 'Marron', 'Noire'],
  'Judo': ['6e kyu', '5e kyu', '4e kyu', '3e kyu', '2e kyu', '1er kyu', '1er dan'],
  'Taekwondo': ['10e geup', '9e geup', '8e geup', '7e geup', '6e geup', '5e geup', '1er dan'],
  'Aucune (sport non grade)': [],
}

export default function SetupPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [disciplines, setDisciplines] = useState<Discipline[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [branchName, setBranchName] = useState('')
  const [sportName, setSportName] = useState('')
  const [ladder, setLadder] = useState<keyof typeof LADDERS>('Karate')

  async function reload() {
    const [b, d] = await Promise.all([
      api.get<{ branches: Branch[] }>('/api/branches'),
      api.get<{ disciplines: Discipline[] }>('/api/disciplines'),
    ])
    setBranches(b.branches)
    setDisciplines(d.disciplines)
  }

  useEffect(() => {
    reload().catch(e => setError(e instanceof ApiError ? e.message : 'Chargement impossible'))
  }, [])

  async function run(action: () => Promise<unknown>) {
    setBusy(true); setError(null)
    try { await action(); await reload() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Operation impossible') }
    finally { setBusy(false) }
  }

  return (
    <div className="dashboard-shell">
      <div>
        <h1 className="dz-hello">Configuration du club</h1>
        <p className="dz-sub">Vos salles et vos sports. C&apos;est vous qui les definissez.</p>
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

      {/* Salles ------------------------------------------------------- */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Building2 size={18} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Salles
          </h2>
          <span className="dz-card-note">{branches?.length ?? 0} enregistree(s)</span>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {branches?.map(b => (
            <li key={b.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0.7rem 1rem', borderRadius: 16,
              background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{b.name}</span>
              <button
                className="gf-hide"
                title={`Desactiver ${b.name}`}
                aria-label={`Desactiver ${b.name}`}
                disabled={busy}
                onClick={() => run(() => api.del(`/api/branches/${b.id}`))}
              >
                <Trash2 size={14} strokeWidth={2.2} />
              </button>
            </li>
          ))}
          {branches?.length === 0 && (
            <li className="dz-card-note">Aucune salle. Ajoutez au moins la salle principale.</li>
          )}
        </ul>

        <form
          style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}
          onSubmit={e => {
            e.preventDefault()
            if (!branchName.trim()) return
            run(() => api.post('/api/branches', { name: branchName.trim() })).then(() => setBranchName(''))
          }}
        >
          <input
            className="input-dark"
            style={{ flex: 1, minWidth: 200 }}
            placeholder="Nom de la salle, ex. Salle Centre"
            value={branchName}
            onChange={e => setBranchName(e.target.value)}
            maxLength={120}
          />
          <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                  disabled={busy || !branchName.trim()}>
            <Plus size={15} strokeWidth={2.4} /> Ajouter
          </button>
        </form>
      </section>

      {/* Sports ------------------------------------------------------- */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Dumbbell size={18} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Sports enseignes
          </h2>
          <span className="dz-card-note">{disciplines?.length ?? 0} enregistre(s)</span>
        </div>

        <ul style={{ listStyle: 'none', padding: 0, margin: '18px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {disciplines?.map(d => (
            <li key={d.id} style={{
              padding: '0.85rem 1rem', borderRadius: 16,
              background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.06)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: '0.9rem' }}>{d.name}</span>
                <span className="badge" style={{ fontSize: '0.6rem' }}>
                  {d.has_grading ? `${d.grades.length} grades` : 'sans grade'}
                </span>
                <button
                  className="gf-hide"
                  title={`Desactiver ${d.name}`}
                  aria-label={`Desactiver ${d.name}`}
                  disabled={busy}
                  onClick={() => run(() => api.del(`/api/disciplines/${d.id}`))}
                >
                  <Trash2 size={14} strokeWidth={2.2} />
                </button>
              </div>
              {d.grades.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                  {d.grades.map(g => (
                    <span key={g.id} className="grade-chip"
                          style={{ padding: '0.15rem 0.6rem', borderRadius: 999, fontSize: '0.68rem', fontWeight: 700 }}>
                      {g.label}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
          {disciplines?.length === 0 && (
            <li className="dz-card-note">Aucun sport. Declarez ce que votre club enseigne.</li>
          )}
        </ul>

        <form
          style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}
          onSubmit={e => {
            e.preventDefault()
            if (!sportName.trim()) return
            const grades = LADDERS[ladder]!.map(label => ({ label }))
            run(() => api.post('/api/disciplines', { name: sportName.trim(), grades }))
              .then(() => setSportName(''))
          }}
        >
          <input
            className="input-dark"
            style={{ flex: 1, minWidth: 180 }}
            placeholder="Nom du sport, ex. Karate"
            value={sportName}
            onChange={e => setSportName(e.target.value)}
            maxLength={80}
          />
          <select
            className="members-filter-select"
            value={ladder}
            onChange={e => setLadder(e.target.value as keyof typeof LADDERS)}
            aria-label="Echelle de grades"
          >
            {Object.keys(LADDERS).map(k => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                  disabled={busy || !sportName.trim()}>
            <Plus size={15} strokeWidth={2.4} /> Ajouter
          </button>
        </form>
        <p className="dz-card-note" style={{ marginTop: 10 }}>
          L&apos;echelle sert de point de depart : elle appartient a votre club et reste modifiable.
        </p>
      </section>
    </div>
  )
}
