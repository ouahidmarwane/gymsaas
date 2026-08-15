'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  Award, Check, X, CalendarPlus, CalendarClock, Percent, TriangleAlert, RefreshCw,
} from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'
import SlidingTabs from '@/components/SlidingTabs'
import GradeCalendar from '@/components/GradeCalendar'
import GradeScheduleModal from '@/components/GradeScheduleModal'
import { isOnGrid } from '@/src/club/grade-cycle'

/*
  Ecran unique des passages de grade.
  ------------------------------------------------------------------
  Il reunit deux ecrans qui coexistaient : celui de l'ancienne
  application (cadence trimestrielle, compte a rebours, taux de reussite)
  et celui-ci (liste des eligibles, bouton Convoquer). Le geste de
  convocation est garde tel quel — c'est lui qu'on utilise tous les jours.

  LES COULEURS. Tout l'accent de la page passe par var(--gold), la couleur
  du club, posee sur <html> par la coquille. Ni le bleu de l'ancien ecran ni
  le vert de celui-ci ne survivent : la page suit l'habillage comme le reste
  de la plateforme, et elle change de couleur sans rechargement quand le club
  change la sienne.

  UNE SEULE EXCEPTION, et elle est deliberee : les pastilles de ceinture
  gardent leur VRAIE couleur. Une ceinture verte est verte, dans tous les
  habillages. Faire suivre --gold a une ceinture reviendrait a mentir sur le
  grade — c'est une donnee, pas une decoration.

  L'etat est deduit au serveur : prochaine date, eligibilite, taux. Les
  recalculer ici aurait duplique la regle des trois mois de part et d'autre
  du reseau, et les deux copies auraient fini par diverger.
*/

interface Session {
  id: string
  member_name: string
  scheduled_date: string
  status: 'pending' | 'passed' | 'failed'
  from_label: string | null
  from_color: string | null
  to_label: string | null
  to_color: string | null
  discipline_id: string | null
  /** Motif, quand la convocation a ete posee hors des regles. */
  notes: string | null
}

interface Candidate {
  id: string
  name: string
  current_label: string | null
  current_color: string | null
  discipline_id: string | null
  discipline_name: string | null
  sub_expiry: string | null
  next_id: string | null
  next_label: string | null
  next_color: string | null
}

interface Level { id: string; label: string; color: string | null; rank: number }

interface Overview {
  anchorMonth: number
  nextSessionDate: string
  sessionDate: string
  sessions: Session[]
  eligible: Candidate[]
  blocked: Candidate[]
  distribution: Array<{ label: string; color: string | null; count: number }>
  disciplines: Array<{ id: string; name: string }>
  ladders: Record<string, Level[]>
  stats: {
    pending: number
    /** Convoqués pour LA session affichée, pas toutes dates confondues. */
    pendingForSession: number
    passed: number
    failed: number
    /** Passages déjà jugés : le dénominateur du taux. */
    decided: number
    successRate: number | null
  }
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
                'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']

const day = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('fr-FR')
const longDay = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`)
  .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Jours restants, calcules sur des dates seules pour ignorer les fuseaux. */
function daysTo(iso: string): number {
  const today = new Date().toISOString().slice(0, 10)
  return Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
    - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

export default function GradesPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [data, setData] = useState<Overview | null>(null)
  const [discipline, setDiscipline] = useState('all')
  const [date, setDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  /** Ceinture visee choisie a la main, par membre. */
  const [target, setTarget] = useState<Record<string, string>>({})
  const [scheduling, setScheduling] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const meData = await api.get<Me>('/api/me')
      setMe(meData)
      if (meData.capabilities && !meData.capabilities.hasGrading) return

      const q = new URLSearchParams()
      if (discipline !== 'all') q.set('disciplineId', discipline)
      if (date) q.set('date', date)
      setData(await api.get<Overview>(`/api/grades?${q}`))
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) return
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setData(null)
    }
  }, [discipline, date])

  useEffect(() => { load() }, [load])

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key); setError(null)
    try { await run(); await load() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Operation impossible') }
    finally { setBusy(null) }
  }

  const canWrite = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin', 'staff'].includes(me.org?.role ?? ''))
    : false

  const pending = useMemo(() => data?.sessions.filter(s => s.status === 'pending') ?? [], [data])
  const history = useMemo(() => data?.sessions.filter(s => s.status !== 'pending') ?? [], [data])

  if (me?.capabilities && !me.capabilities.hasGrading) {
    return (
      <div className="dashboard-shell">
        <section className="dz-card">
          <div className="gf-placeholder">
            <Award size={38} strokeWidth={1.6} className="gf-placeholder-icon" />
            <h2 className="gf-placeholder-title">Aucune discipline graduée</h2>
            <p className="gf-placeholder-body">
              Ce club n&apos;enseigne aucun sport à ceintures ou à grades. Ajoutez une
              échelle à une discipline pour activer cet écran.
            </p>
            <Link className="btn-ghost" href="/setup" style={{ marginTop: 8 }}>
              Ouvrir la configuration
            </Link>
          </div>
        </section>
      </div>
    )
  }

  const sessionDate = data?.sessionDate ?? ''
  const left = sessionDate ? daysTo(sessionDate) : 0
  // Deux situations differentes, qu'un seul libelle confondait.
  //
  //   « hors cycle »   — la date ne tombe pas sur la grille du club.
  //   « autre session » — elle y tombe, mais ce n'est pas la prochaine.
  //
  // Tout ce qui n'etait pas la prochaine date etait etiquete « hors cycle » :
  // le 1er decembre, une vraie session du cycle, passait pour une exception.
  const onGrid = data ? isOnGrid(data.anchorMonth, sessionDate) : true
  const moved = Boolean(date) && date !== data?.nextSessionDate

  return (
    <EditablePage
      page="grades"
      me={me}
      title="Passage de grade"
      subtitle={data ? `${data.stats.pending} passage${data.stats.pending > 1 ? 's' : ''} programmé${data.stats.pending > 1 ? 's' : ''}` : 'Chargement…'}
      actions={canWrite && data ? (
        <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                onClick={() => setScheduling(true)}>
          <CalendarPlus size={16} strokeWidth={2.3} /> Programmer un passage
        </button>
      ) : undefined}
    >
      <PageState error={error} onRetry={load} />

      <div aria-live="polite">
        {notice && !error && (
          <p role="status" style={{
            padding: '0.7rem 1rem', borderRadius: 14,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
            color: '#6ee7b7', fontSize: '0.85rem', fontWeight: 600,
          }}>{notice}</p>
        )}
      </div>

      {/* Filtre discipline : seulement celles que le club a configurées. */}
      {(data?.disciplines.length ?? 0) > 1 && (
        <SlidingTabs
          items={[{ key: 'all', label: 'Toutes' },
                  ...data!.disciplines.map(d => ({ key: d.id, label: d.name }))]}
          value={discipline}
          onChange={setDiscipline}
        />
      )}

      {/* ── Les trois chiffres de tête ── */}
      <div className="grade-kpis">
        <section className="dz-card grade-kpi">
          <span className="grade-kpi-icon"><CalendarClock size={18} strokeWidth={2.1} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="grade-kpi-value">
              {data ? (left > 0 ? `J-${left}` : left === 0 ? "Aujourd'hui" : `+${-left} j`) : '—'}
            </div>
            <div className="grade-kpi-label">
              {data ? longDay(sessionDate) : 'Prochaine session'}
            </div>
          </div>
        </section>

        {/* Un chiffre, une mesure, et la mesure est écrite dessous.
            « Convoqués / réussis » mêlait les convocations d'une session aux
            réussites de tout l'historique : la barre oblique laissait croire
            à un rapport entre les deux. */}
        <section className="dz-card grade-kpi">
          <span className="grade-kpi-icon"><Award size={18} strokeWidth={2.1} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="grade-kpi-value">{data ? data.stats.pendingForSession : '—'}</div>
            <div className="grade-kpi-label">
              {data ? `convoqués pour le ${day(sessionDate)}` : 'Convoqués'}
            </div>
            {/* Sans cette ligne, la tuile pouvait afficher « 0 convoqués »
                pendant que la section juste en dessous en listait un : la
                convocation existait, mais pour une autre date. Deux chiffres
                qui se contredisent a l'ecran, et rien pour l'expliquer. */}
            {data && data.stats.pending > data.stats.pendingForSession && (
              <button className="grade-kpi-extra"
                      title="Afficher la date de ce passage"
                      onClick={() => {
                        const other = data.sessions.find(
                          s => s.status === 'pending'
                            && s.scheduled_date.slice(0, 10) !== sessionDate.slice(0, 10))
                        if (other) setDate(other.scheduled_date.slice(0, 10))
                      }}>
                + {data.stats.pending - data.stats.pendingForSession} sur une autre date
              </button>
            )}
          </div>
        </section>

        <section className="dz-card grade-kpi">
          <span className="grade-kpi-icon"><Percent size={18} strokeWidth={2.1} /></span>
          <div style={{ minWidth: 0 }}>
            <div className="grade-kpi-value">
              {/* Aucun résultat, aucun taux : « 0 % » se lirait comme un échec
                  complet alors que rien n'a encore eu lieu. */}
              {!data || data.stats.successRate === null ? '—' : `${data.stats.successRate} %`}
            </div>
            <div className="grade-kpi-label">
              {/* Le dénominateur est écrit : un taux sans son assiette ne
                  veut rien dire. */}
              {data && data.stats.decided > 0
                ? `de réussite sur ${data.stats.decided} passage${data.stats.decided > 1 ? 's' : ''}`
                : 'aucun passage jugé'}
            </div>
          </div>
        </section>
      </div>

      {/* ── Calendrier ──
          Il remplace le bandeau de cartes : les jours de cycle, les
          convocations posees et leurs resultats, sur le meme quadrillage.
          Cliquer un jour choisit la date de session — c'est le meme reglage
          que le champ date plus bas, en plus lisible. */}
      {data && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Calendrier des passages</h2>
            <span className="dz-card-note">
              cycle de 3 mois · ancré en {MONTHS[data.anchorMonth - 1]}
            </span>
          </div>
          <div className="gcal-split">
            <GradeCalendar
              anchorMonth={data.anchorMonth}
              selected={sessionDate.slice(0, 10)}
              today={new Date().toISOString().slice(0, 10)}
              sessions={data.sessions.map(s => ({
                date: s.scheduled_date, status: s.status, name: s.member_name,
              }))}
              onPick={d => setDate(d)}
            />

            {/* Ce que porte le jour choisi. Sans ce panneau, le calendrier ne
                serait qu'un decor : on verrait qu'un jour est marque sans
                pouvoir savoir par qui. */}
            <div>
              <div className="gcal-day-title">{longDay(sessionDate)}</div>
              {(() => {
                const onDay = data.sessions.filter(
                  s => s.scheduled_date.slice(0, 10) === sessionDate.slice(0, 10))
                if (onDay.length === 0) {
                  return (
                    <p className="gcal-day-empty">
                      Aucun passage ce jour-là. Convoquez depuis la liste des éligibles :
                      elle est calculée pour cette date.
                    </p>
                  )
                }
                return (
                  <div className="gcal-day-list">
                    {onDay.map(s => (
                      <div key={s.id} className="gcal-day-row">
                        <span className={`gcal-dot ${s.status}`} aria-hidden="true" />
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                                       textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {s.member_name}
                        </span>
                        <BeltChip label={s.to_label ?? 'niveau suivant'} color={s.to_color} />
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
        </section>
      )}

      {/* ── Passages programmés ── */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title">Passages programmés</h2>
          <span className="dz-card-note">{pending.length}</span>
        </div>

        {!data && (
          <div className="members-skeleton-row"
               style={{ height: 56, border: 'none', borderRadius: 16, marginTop: 16 }} />
        )}

        {data && pending.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucun passage programmé. Convoquez un membre depuis la liste ci-dessous.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: pending.length ? 16 : 0 }}>
          {pending.map(s => {
            const d = daysTo(s.scheduled_date)
            // Le résultat ne se confirme qu'à partir du jour de la session :
            // valider la veille reviendrait à noter un passage qui n'a pas eu lieu.
            const open = d <= 0
            return (
              <div key={s.id} className="grade-row">
                <div style={{ flex: 1, minWidth: 170 }}>
                  <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{s.member_name}</div>
                  <div className="grade-progress">
                    <BeltChip label={s.from_label ?? 'sans grade'} color={s.from_color} />
                    <span className="grade-arrow" aria-hidden="true">→</span>
                    <BeltChip label={s.to_label ?? 'niveau suivant'} color={s.to_color} />
                    <span className="dz-card-note">· {day(s.scheduled_date)}</span>
                  </div>
                  {/* Le motif reste visible : c'est ce qui distingue un
                      passage accorde par exception d'un passage ordinaire. */}
                  {s.notes && <div className="grade-note">« {s.notes} »</div>}
                </div>

                <span className={`grade-count${d < 0 ? ' late' : ''}`}>
                  {d < 0 ? `en retard de ${-d} j` : d === 0 ? "aujourd'hui" : `J-${d}`}
                </span>

                {canWrite && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="grade-btn primary" disabled={busy !== null || !open}
                            title={open ? 'Confirmer le résultat'
                                        : `Confirmable à partir du ${day(s.scheduled_date)}`}
                            onClick={() => act(s.id, () =>
                              api.post(`/api/grades/sessions/${s.id}/decision`, { passed: true }))}>
                      <Check size={13} strokeWidth={2.4} /> Réussi
                    </button>
                    <button className="grade-btn" disabled={busy !== null || !open}
                            title={open ? 'Le grade reste inchangé'
                                        : `Confirmable à partir du ${day(s.scheduled_date)}`}
                            onClick={() => act(s.id, () =>
                              api.post(`/api/grades/sessions/${s.id}/decision`, { passed: false }))}>
                      <X size={13} strokeWidth={2.4} /> Échoué
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Éligibles ── */}
      {canWrite && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Membres éligibles</h2>
            <span className="dz-card-note">{data?.eligible.length ?? 0}</span>
          </div>
          <p className="dz-card-note" style={{ marginTop: 8 }}>
            Abonnement à jour, trois mois depuis l&apos;inscription ou depuis le dernier
            passage, et pas déjà convoqués. L&apos;ancienneté se mesure à la date de la
            session, pas aujourd&apos;hui.
          </p>

          <div className="grade-date-row">
            <label htmlFor="grade-date" style={{ fontSize: '0.78rem', color: 'var(--muted)', fontWeight: 600 }}>
              Date de la session
            </label>
            <input id="grade-date" className="input-dark" type="date" style={{ width: 'auto' }}
                   value={sessionDate.slice(0, 10)}
                   onChange={e => setDate(e.target.value || null)} />
            {moved && (
              <>
                <span className="grade-offgrid">
                  {onGrid ? 'autre session du cycle' : 'hors cycle'}
                </span>
                <button className="grade-btn" onClick={() => setDate(null)}>
                  <RefreshCw size={12} strokeWidth={2.2} /> Revenir à la prochaine
                </button>
              </>
            )}
          </div>

          {data && data.eligible.length === 0 ? (
            <p className="dz-card-note" style={{ marginTop: 14 }}>
              Personne n&apos;est éligible pour cette session.
            </p>
          ) : (
            <div className="grade-list">
              {data?.eligible.map(m => {
                const ladder = data.ladders[m.discipline_id ?? ''] ?? []
                const chosen = target[m.id] ?? m.next_id ?? ''
                return (
                  <div key={m.id} className="grade-row">
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                                   textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>

                    <BeltChip label={m.current_label ?? 'sans grade'} color={m.current_color} />
                    <span className="grade-arrow" aria-hidden="true">→</span>

                    {/* La visée est proposée, pas imposée : un instructeur
                        peut sauter un niveau ou en viser un plus bas. */}
                    {ladder.length > 0 ? (
                      <select className="input-dark grade-select" value={chosen}
                              aria-label={`Ceinture visée pour ${m.name}`}
                              onChange={e => setTarget(t => ({ ...t, [m.id]: e.target.value }))}>
                        {ladder.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                      </select>
                    ) : (
                      <span className="dz-card-note">échelle non configurée</span>
                    )}

                    <button className="grade-btn primary" disabled={busy !== null || !chosen}
                            onClick={() => act(m.id, () =>
                              api.post('/api/grades/sessions', {
                                memberId: m.id,
                                scheduledDate: sessionDate.slice(0, 10),
                                toGradeId: chosen || null,
                              }))}>
                      <CalendarPlus size={13} strokeWidth={2.2} /> Convoquer
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Abonnement expiré : montrés, pas cachés ── */}
      {canWrite && (data?.blocked.length ?? 0) > 0 && (
        <section className="dz-card grade-blocked">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Ambre : c'est l'avertissement de la plateforme, pas un
                  accent. Un accent doit suivre le club ; un avertissement
                  doit vouloir dire la meme chose partout. */}
              <TriangleAlert size={16} strokeWidth={2.2} className="grade-warn" />
              À vérifier — abonnement expiré
            </h2>
            <span className="dz-card-note">{data!.blocked.length}</span>
          </div>
          <p className="dz-card-note" style={{ marginTop: 8 }}>
            Ces membres remplissent la condition d&apos;ancienneté mais leur abonnement
            n&apos;est pas à jour à la date de la session. Régularisez pour les convoquer.
          </p>

          <div className="grade-list">
            {data!.blocked.map(m => (
              <div key={m.id} className="grade-row">
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                               textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                <BeltChip label={m.current_label ?? 'sans grade'} color={m.current_color} />
                <span className="dz-card-note" style={{ flex: 'none' }}>
                  {m.sub_expiry ? `expiré le ${day(m.sub_expiry)}` : 'sans abonnement'}
                </span>
                <button className="grade-btn primary" disabled={busy !== null}
                        onClick={() => act(`renew-${m.id}`, () =>
                          api.post(`/api/members/${m.id}/renew`, {}))}>
                  <RefreshCw size={13} strokeWidth={2.2} /> Renouveler abo
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Progression des grades ── */}
      {(data?.distribution.length ?? 0) > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Progression des grades</h2>
          </div>
          <div className="grade-dist">
            {data!.distribution.map(g => {
              const max = Math.max(...data!.distribution.map(x => x.count), 1)
              return (
                <div key={g.label} className="grade-dist-row">
                  <span className="grade-dist-dot" style={{ background: g.color ?? 'var(--muted)' }} />
                  <span className="grade-dist-label">{g.label}</span>
                  <span className="grade-dist-track">
                    {/* La barre prend la couleur de la ceinture, pas l'accent :
                        c'est la ceinture que la barre represente. */}
                    <span className="grade-dist-fill"
                          style={{ width: `${(g.count / max) * 100}%`,
                                   background: g.color ?? 'var(--gold)' }} />
                  </span>
                  <span className="grade-dist-count">{g.count}</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {scheduling && (
        <GradeScheduleModal
          defaultDate={sessionDate.slice(0, 10)}
          onClose={() => setScheduling(false)}
          onDone={async name => {
            setScheduling(false)
            await load()
            setNotice(`${name} est convoqué.`)
          }}
        />
      )}

      {/* ── Historique ── */}
      {history.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Historique</h2>
          </div>
          <div className="grade-list">
            {history.map(s => (
              <div key={s.id} className="grade-row">
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                               whiteSpace: 'nowrap', fontSize: '0.85rem' }}>{s.member_name}</span>
                <BeltChip label={s.to_label ?? '—'} color={s.to_color} />
                <span className={`badge ${s.status === 'passed'
                        ? 'text-emerald-300 bg-emerald-500/10 ring-emerald-500/30'
                        : 'text-red-300 bg-red-500/10 ring-red-500/30'}`}
                      style={{ fontSize: '0.58rem', flex: 'none' }}>
                  {s.status === 'passed' ? 'Réussi' : 'Échoué'}
                </span>
                <span className="dz-card-note" style={{ flex: 'none' }}>{day(s.scheduled_date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </EditablePage>
  )
}

/**
 * Pastille de ceinture.
 *
 * La SEULE couleur de cette page qui ne suive pas l'habillage. Une ceinture
 * verte est verte partout : c'est une donnee du club, pas un accent. Le texte
 * reste dans la couleur du theme pour rester lisible en clair comme en
 * sombre — seule la pastille porte la teinte.
 */
function BeltChip({ label, color }: { label: string; color: string | null }) {
  return (
    <span className="grade-belt">
      <span className="grade-belt-dot" style={{ background: color ?? 'var(--muted)' }} />
      {label}
    </span>
  )
}
