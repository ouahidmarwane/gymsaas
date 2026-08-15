'use client'

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { gradeGrid } from '@/src/club/grade-cycle'

/**
 * Calendrier des passages.
 *
 * Il montre trois choses que le compte a rebours seul ne dit pas : ou tombent
 * les sessions du cycle, quels jours portent deja des convocations, et ce que
 * ces convocations sont devenues. Cliquer un jour choisit la date de session
 * — c'est le meme reglage que le champ date, en plus lisible.
 *
 * Les couleurs viennent du theme. L'accent du club marque les jours de cycle
 * et le jour choisi ; les pastilles de resultat gardent le vert et le rouge
 * de la plateforme, parce que reussi et echoue veulent dire la meme chose
 * partout et ne sont pas des accents.
 *
 * Tout se calcule sur des chaines « AAAA-MM-JJ ». Aucune arithmetique de
 * dates : c'est la que se logent les erreurs de fuseau, et un club marocain
 * qui verrait ses sessions decalees d'un jour n'aurait aucun moyen de
 * comprendre pourquoi.
 */

const WEEKDAYS = ['L', 'M', 'M', 'J', 'V', 'S', 'D']

interface Mark {
  date: string
  status: 'pending' | 'passed' | 'failed'
  name: string
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

/** Jours du mois, precedes des cases vides jusqu'au premier lundi. */
function monthCells(year: number, month: number): Array<string | null> {
  const first = new Date(Date.UTC(year, month - 1, 1))
  // getUTCDay rend 0 pour dimanche ; la semaine francaise commence lundi.
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => iso(year, month, i + 1)),
  ]
}

export default function GradeCalendar({
  anchorMonth, sessions, selected, today, onPick,
}: {
  anchorMonth: number
  sessions: Mark[]
  /** Date de session courante, mise en avant. */
  selected: string
  today: string
  onPick: (date: string) => void
}) {
  // Le calendrier s'ouvre sur le mois de la session choisie, pas sur le mois
  // courant : c'est la que l'on a quelque chose a regarder.
  const [cursor, setCursor] = useState(() => selected.slice(0, 7))
  const [year, month] = cursor.split('-').map(Number) as [number, number]

  const cells = useMemo(() => monthCells(year, month), [year, month])
  const cycle = useMemo(() => new Set(gradeGrid(anchorMonth, year)), [anchorMonth, year])

  const byDay = useMemo(() => {
    const map = new Map<string, Mark[]>()
    for (const s of sessions) {
      const d = s.date.slice(0, 10)
      map.set(d, [...(map.get(d) ?? []), s])
    }
    return map
  }, [sessions])

  function shift(by: number) {
    const m = month + by
    const y = year + Math.floor((m - 1) / 12)
    const mm = ((m - 1) % 12 + 12) % 12 + 1
    setCursor(`${y}-${String(mm).padStart(2, '0')}`)
  }

  const title = new Date(Date.UTC(year, month - 1, 1))
    .toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' })

  return (
    <div className="gcal">
      <div className="gcal-head">
        <button className="gcal-nav" onClick={() => shift(-1)} aria-label="Mois précédent">
          <ChevronLeft size={16} strokeWidth={2.3} />
        </button>
        <span className="gcal-title">{title}</span>
        <button className="gcal-nav" onClick={() => shift(1)} aria-label="Mois suivant">
          <ChevronRight size={16} strokeWidth={2.3} />
        </button>
      </div>

      <div className="gcal-grid" role="grid" aria-label={`Passages de ${title}`}>
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="gcal-weekday" aria-hidden="true">{d}</span>
        ))}

        {cells.map((date, i) => {
          if (!date) return <span key={`v${i}`} className="gcal-cell empty" aria-hidden="true" />

          const marks = byDay.get(date) ?? []
          const classes = ['gcal-cell']
          if (cycle.has(date)) classes.push('cycle')
          if (date === selected) classes.push('selected')
          if (date === today) classes.push('today')
          if (marks.length > 0) classes.push('has-marks')

          const label = [
            new Date(`${date}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' }),
            cycle.has(date) ? 'session du cycle' : null,
            marks.length ? `${marks.length} passage${marks.length > 1 ? 's' : ''}` : null,
          ].filter(Boolean).join(' — ')

          return (
            <button key={date} className={classes.join(' ')} role="gridcell"
                    aria-label={label} title={label}
                    aria-current={date === selected ? 'date' : undefined}
                    onClick={() => onPick(date)}>
              <span className="gcal-num">{Number(date.slice(8, 10))}</span>
              {marks.length > 0 && (
                <span className="gcal-dots" aria-hidden="true">
                  {/* Trois points au plus : au-dela, le compte parle mieux
                      qu'une rangee de pastilles qu'on ne peut pas denombrer. */}
                  {marks.slice(0, 3).map((m, k) => (
                    <span key={k} className={`gcal-dot ${m.status}`} />
                  ))}
                  {marks.length > 3 && <span className="gcal-more">+{marks.length - 3}</span>}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="gcal-legend">
        <span><span className="gcal-key cycle" /> session du cycle</span>
        <span><span className="gcal-dot pending" /> convoqué</span>
        <span><span className="gcal-dot passed" /> réussi</span>
        <span><span className="gcal-dot failed" /> échoué</span>
      </div>
    </div>
  )
}
