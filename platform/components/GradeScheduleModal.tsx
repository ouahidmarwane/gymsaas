'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { X, CalendarPlus, TriangleAlert } from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'

/**
 * Convocation posee a la main.
 *
 * La liste des eligibles applique la regle des trois mois. Celle-ci ne
 * l'applique pas — elle sert precisement aux cas que la regle ne prevoit
 * pas : un membre arrive d'un autre club avec son grade, un rattrapage apres
 * blessure, une promotion que l'instructeur juge meritee.
 *
 * Mais elle ne fait pas semblant. Quand le membre choisi sort des regles,
 * l'ecran le dit et demande un motif. Sans cela, un passage accorde par
 * exception serait indiscernable d'un passage ordinaire dans l'historique,
 * et personne ne saurait plus, six mois apres, pourquoi il a eu lieu.
 */

interface Schedulable {
  id: string
  name: string
  discipline_id: string | null
  discipline_name: string | null
  current_label: string | null
  current_color: string | null
  next_id: string | null
  next_label: string | null
  sub_ok: number
  senior_ok: number
}

interface Level { id: string; label: string; color: string | null; rank: number }

export default function GradeScheduleModal({ defaultDate, onClose, onDone }: {
  defaultDate: string
  onClose: () => void
  onDone: (name: string) => void | Promise<void>
}) {
  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  const [date, setDate] = useState(defaultDate.slice(0, 10))
  const [search, setSearch] = useState('')
  const [memberId, setMemberId] = useState('')
  const [gradeId, setGradeId] = useState('')
  const [reason, setReason] = useState('')

  const [people, setPeople] = useState<Schedulable[] | null>(null)
  const [ladders, setLadders] = useState<Record<string, Level[]>>({})
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  // La liste depend de la date : c'est a cette date que se juge l'anciennete,
  // donc le meme membre peut sortir ou entrer dans les regles selon le jour.
  useEffect(() => {
    let alive = true
    api.get<{ members: Schedulable[]; ladders: Record<string, Level[]> }>(
      `/api/grades/schedulable?date=${date}`)
      .then(d => { if (alive) { setPeople(d.members); setLadders(d.ladders) } })
      .catch(e => { if (alive) setProblem(e instanceof ApiError ? e.message : 'Chargement impossible') })
    return () => { alive = false }
  }, [date])

  const chosen = people?.find(p => p.id === memberId) ?? null
  const ladder = chosen ? ladders[chosen.discipline_id ?? ''] ?? [] : []

  // Le niveau suivant est propose des qu'on choisit quelqu'un, sans effacer
  // un choix deja fait a la main.
  useEffect(() => {
    if (chosen) setGradeId(g => g || chosen.next_id || '')
  }, [chosen])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (people ?? []).filter(p => !q || p.name.toLowerCase().includes(q))
  }, [people, search])

  const offRules = chosen ? (chosen.senior_ok !== 1 || chosen.sub_ok !== 1) : false
  // Un motif n'est exige que pour une exception : l'imposer partout ferait
  // taper « ok » a longueur de journee, et la note ne voudrait plus rien dire.
  const ready = Boolean(memberId && gradeId && date) && (!offRules || reason.trim().length >= 3)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!ready || !chosen) return
    setBusy(true); setProblem(null)
    try {
      await api.post('/api/grades/sessions', {
        memberId, scheduledDate: date, toGradeId: gradeId,
        notes: reason.trim() || null,
      })
      await onDone(chosen.name)
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Convocation impossible')
      setBusy(false)
    }
  }

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss}
         role="dialog" aria-modal="true" aria-label="Programmer un passage">
      <div ref={cardRef} className="compta-modal" style={{ width: 520 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      marginBottom: 6 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 700, letterSpacing: '-0.02em' }}>
            Programmer un passage
          </h2>
          <button className="gf-hide" onClick={dismiss} aria-label="Fermer"><X size={15} /></button>
        </div>
        <p className="dz-card-note" style={{ marginBottom: 18 }}>
          Hors de la liste des éligibles : n&apos;importe quel membre d&apos;une discipline
          graduée, à la date de votre choix.
        </p>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="gsm-label">Date du passage</span>
            <input className="input-dark" type="date" value={date}
                   onChange={e => setDate(e.target.value)} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span className="gsm-label">Membre</span>
            <input className="input-dark" placeholder="Chercher un nom…"
                   value={search} onChange={e => setSearch(e.target.value)} />
          </label>

          {!people && <div className="members-skeleton-row"
                           style={{ height: 120, border: 'none', borderRadius: 14 }} />}

          {people && filtered.length === 0 && (
            <p className="dz-card-note">
              {people.length === 0
                ? 'Tous les membres gradables ont déjà une convocation en attente.'
                : 'Aucun membre ne correspond.'}
            </p>
          )}

          {people && filtered.length > 0 && (
            <div className="gsm-people" role="radiogroup" aria-label="Membre à convoquer">
              {filtered.slice(0, 60).map(p => {
                const off = p.senior_ok !== 1 || p.sub_ok !== 1
                return (
                  <button key={p.id} type="button" role="radio"
                          aria-checked={memberId === p.id}
                          className={`gsm-person${memberId === p.id ? ' on' : ''}`}
                          onClick={() => { setMemberId(p.id); setGradeId('') }}>
                    <span className="gsm-person-name">{p.name}</span>
                    <span className="gsm-person-belt">
                      <span className="grade-belt-dot"
                            style={{ background: p.current_color ?? 'var(--muted)' }} />
                      {p.current_label ?? 'sans grade'}
                    </span>
                    {off && <span className="gsm-flag">hors règles</span>}
                  </button>
                )
              })}
              {filtered.length > 60 && (
                <p className="dz-card-note">
                  {filtered.length - 60} autres — affinez la recherche.
                </p>
              )}
            </div>
          )}

          {chosen && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="gsm-label">
                Ceinture visée {chosen.discipline_name && `· ${chosen.discipline_name}`}
              </span>
              {ladder.length > 0 ? (
                <select className="input-dark" value={gradeId}
                        onChange={e => setGradeId(e.target.value)}>
                  {ladder.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
                </select>
              ) : (
                <span className="dz-card-note">
                  Cette discipline n&apos;a pas d&apos;échelle configurée.
                </span>
              )}
            </label>
          )}

          {/* L'exception est nommee, et elle demande une raison. */}
          {offRules && chosen && (
            <div className="gsm-warn">
              <TriangleAlert size={15} strokeWidth={2.2} className="grade-warn" />
              <div>
                <strong>Hors des règles habituelles.</strong>{' '}
                {chosen.senior_ok !== 1 && 'Moins de trois mois depuis son inscription ou son dernier passage. '}
                {chosen.sub_ok !== 1 && 'Abonnement non à jour à cette date. '}
                Indiquez pourquoi : la raison reste attachée au passage.
              </div>
            </div>
          )}

          {chosen && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span className="gsm-label">
                Motif {offRules ? '' : '· facultatif'}
              </span>
              <input className="input-dark" maxLength={500} value={reason}
                     placeholder={offRules ? 'Ex. : arrivé d’un autre club, grade déjà acquis'
                                           : 'Ex. : rattrapage de la session de mars'}
                     onChange={e => { setReason(e.target.value); setProblem(null) }} />
            </label>
          )}

          <div aria-live="polite">
            {problem && (
              <p role="alert" className="mdet-problem" style={{ marginTop: 0 }}>{problem}</p>
            )}
          </div>

          <div className="compta-modal-actions" style={{ marginTop: 6 }}>
            <button type="button" className="compta-modal-cancel" onClick={dismiss} disabled={busy}>
              Annuler
            </button>
            <button type="submit" className="compta-modal-save" disabled={busy || !ready}
                    title={!memberId ? 'Choisissez un membre'
                      : offRules && reason.trim().length < 3 ? 'Indiquez le motif'
                      : 'Programmer'}>
              <CalendarPlus size={14} strokeWidth={2.3}
                            style={{ verticalAlign: '-2px', marginInlineEnd: 5 }} />
              {busy ? 'Enregistrement…' : 'Programmer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
