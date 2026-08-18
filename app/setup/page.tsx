'use client'

import { useEffect, useState } from 'react'
import { Building2, Dumbbell, Palette, Plus, Trash2 } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import ThemePicker from '@/components/ThemePicker'
import BannerPicker from '@/components/BannerPicker'
import LogoPicker from '@/components/LogoPicker'
import LadderEditor from '@/components/LadderEditor'

interface Branch { id: string; name: string; is_active: number }
interface Grade { id: string; rank: number; label: string; color?: string | null }
interface Discipline { id: string; name: string; has_grading: number; grades: Grade[] }

/*
  Plus de liste d'echelles toutes faites.

  Elles imposaient les ceintures d'un autre club — karate, judo, taekwondo —
  et c'etait le SEUL moment ou une echelle pouvait etre posee : une fois le
  sport cree, plus rien ne permettait d'y toucher. Un club qui enseigne
  autre chose repartait avec des niveaux qui ne sont pas les siens.

  Une seule question a la creation : ce sport a-t-il des grades ? Si oui,
  l'echelle se saisit ensuite, niveau par niveau, dans la liste au-dessus.
*/

export default function SetupPage() {
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [disciplines, setDisciplines] = useState<Discipline[] | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [branchName, setBranchName] = useState('')
  const [sportName, setSportName] = useState('')
  const [sportGraded, setSportGraded] = useState(false)

  async function reload() {
    const [b, d, meData] = await Promise.all([
      api.get<{ branches: Branch[] }>('/api/branches'),
      api.get<{ disciplines: Discipline[] }>('/api/disciplines'),
      api.get<Me>('/api/me'),
    ])
    setBranches(b.branches)
    setDisciplines(d.disciplines)
    setMe(meData)
  }

  // Changer l'habillage engage tout le club, pas seulement celui qui clique :
  // c'est un reglage d'organisation. Reserve donc aux responsables, comme le
  // serveur le fait deja sur PUT /api/branding.
  const canBrand = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin'].includes(me.org?.role ?? ''))
    : false

  useEffect(() => {
    reload().catch(e => setError(e instanceof ApiError ? e.message : 'Chargement impossible'))
  }, [])

  /** Renvoie true si l'operation a reussi : l'appelant ne doit vider le
   *  champ que dans ce cas, sinon la saisie disparait sur un echec. */
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true); setError(null)
    try {
      await action()
      await reload()
      return true
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Operation impossible')
      return false
    } finally {
      setBusy(false)
    }
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

      {/* Apparence.
          Les memes cinq habillages que le compte plateforme, et le meme
          composant : la liste n'existe qu'a un seul endroit. Le serveur
          acceptait deja l'ecriture par un administrateur de club — seule
          l'interface la reservait a la plateforme. */}
      {canBrand && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Palette size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Apparence
            </h2>
          </div>
          <p className="dz-card-note" style={{ marginTop: 8, marginBottom: 16 }}>
            L&apos;habillage s&apos;applique à tout le club : chaque membre de votre équipe
            verra la plateforme ainsi. Le choix prend effet immédiatement, et se change
            d&apos;un clic.
          </p>
          <ThemePicker initial={me?.branding ?? null} />

          {/* Logo. Meme histoire que l'habillage et la banniere : le serveur
              ouvrait deja PUT /api/branding/logo aux administrateurs du club,
              seul l'ecran manquait — il n'existait que dans le panneau de la
              plateforme. Un club ne devrait pas avoir a demander un ticket
              pour changer sa propre image. */}
          <div style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <h3 style={{ fontSize: '0.86rem', fontWeight: 700, marginBottom: 4 }}>
              Logo du club
            </h3>
            <p className="dz-card-note" style={{ marginBottom: 14 }}>
              Il apparaît dans le rail de navigation, et partout où votre club
              est nommé.
            </p>
            <LogoPicker initial={me?.branding ?? null} name={me?.branding?.name}
                        onSaved={b => setMe(m => (m ? { ...m, branding: b } : m))} />
          </div>

          <div style={{ marginTop: 26, paddingTop: 22, borderTop: '1px solid var(--hairline)' }}>
            <h3 style={{ fontSize: '0.86rem', fontWeight: 700, marginBottom: 4 }}>
              Bannière du tableau de bord
            </h3>
            <p className="dz-card-note" style={{ marginBottom: 14 }}>
              L&apos;image en tête de votre tableau de bord. Une photo de la salle,
              de l&apos;équipe, ou rien du tout.
            </p>
            <BannerPicker initial={me?.branding ?? null}
                          onSaved={b => setMe(m => (m ? { ...m, branding: b } : m))} />
          </div>
        </section>
      )}

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
              background: 'var(--overlay-soft)', border: '1px solid var(--hairline)',
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
            run(() => api.post('/api/branches', { name: branchName.trim() }))
              .then(ok => { if (ok) setBranchName('') })
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
              background: 'var(--overlay-soft)', border: '1px solid var(--hairline)',
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
              {/* L'echelle se modifie ici, sur place. Les pastilles en
                  lecture seule ne disaient que ce qu'on avait choisi le jour
                  de la creation, sans moyen d'y revenir. */}
              {d.has_grading === 1 && (
                <LadderEditor
                  disciplineId={d.id}
                  initial={d.grades.map(g => ({ id: g.id, label: g.label, color: g.color ?? null }))}
                  onSaved={reload}
                />
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
            // Aucun niveau impose : le serveur retient `hasGrading`, et
            // l'echelle se saisit ensuite dans la liste au-dessus.
            run(() => api.post('/api/disciplines', {
              name: sportName.trim(), hasGrading: sportGraded,
            })).then(ok => { if (ok) { setSportName(''); setSportGraded(false) } })
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
          {/* Deux boutons radio plutot qu'un menu : il n'y a que deux
              reponses, et les montrer toutes les deux evite d'ouvrir une
              liste pour decouvrir qu'elle n'en contient pas d'autre. */}
          <fieldset className="graded-choice">
            <legend className="sr-only">Ce sport a-t-il des grades ?</legend>
            <label>
              <input type="radio" name="graded" checked={!sportGraded}
                     onChange={() => setSportGraded(false)} />
              <span>Sans grade</span>
            </label>
            <label>
              <input type="radio" name="graded" checked={sportGraded}
                     onChange={() => setSportGraded(true)} />
              <span>Avec grades</span>
            </label>
          </fieldset>
          <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                  disabled={busy || !sportName.trim()}>
            <Plus size={15} strokeWidth={2.4} /> Ajouter
          </button>
        </form>
        <p className="dz-card-note" style={{ marginTop: 10 }}>
          Un sport gradué démarre sans niveau : vous les saisissez ensuite, dans
          l&apos;ordre, sous son nom. L&apos;échelle appartient à votre club.
        </p>
      </section>
    </div>
  )
}
