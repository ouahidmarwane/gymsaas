'use client'
import { useMemo, useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns'
import { fr } from 'date-fns/locale'
import GradeBadge from '@/components/GradeBadge'
import type { GradeSession } from '@/types'

interface Props {
  sessions: GradeSession[]
  initialDate?: string | null   // ouvre le calendrier sur ce mois (ex : prochaine session)
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

export default function GradeCalendar({ sessions, initialDate }: Props) {
  const [viewDate, setViewDate] = useState(() => initialDate ? new Date(initialDate) : new Date())
  const [selected, setSelected] = useState<Date | null>(null)

  const monthStart = startOfMonth(viewDate)
  const monthEnd = endOfMonth(viewDate)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Monday = 0 offset
  const startOffset = (getDay(monthStart) + 6) % 7

  // Group sessions by date string
  const byDate = useMemo(() => {
    const map: Record<string, GradeSession[]> = {}
    for (const s of sessions) {
      if (s.status !== 'pending') continue
      const key = s.scheduled_date.slice(0, 10)
      if (!map[key]) map[key] = []
      map[key].push(s)
    }
    return map
  }, [sessions])

  const selectedKey = selected ? format(selected, 'yyyy-MM-dd') : null
  const selectedSessions = selectedKey ? (byDate[selectedKey] ?? []) : []

  const prevMonth = () => setViewDate(d => { const n = new Date(d); n.setMonth(n.getMonth() - 1); return n })
  const nextMonth = () => setViewDate(d => { const n = new Date(d); n.setMonth(n.getMonth() + 1); return n })

  return (
    <div className="grade-cal-shell">
      {/* Header */}
      <div className="grade-cal-header">
        <button className="grade-cal-nav" onClick={prevMonth}>‹</button>
        <span className="grade-cal-month">{format(viewDate, 'MMMM yyyy', { locale: fr })}</span>
        <button className="grade-cal-nav" onClick={nextMonth}>›</button>
      </div>

      {/* Day labels */}
      <div className="grade-cal-grid">
        {DAY_LABELS.map(d => (
          <div key={d} className="grade-cal-day-label">{d}</div>
        ))}

        {/* Empty cells before month start */}
        {Array.from({ length: startOffset }).map((_, i) => (
          <div key={`empty-${i}`} className="grade-cal-cell grade-cal-empty" />
        ))}

        {/* Day cells */}
        {days.map(day => {
          const key = format(day, 'yyyy-MM-dd')
          const hasSessions = !!byDate[key]?.length
          const count = byDate[key]?.length ?? 0
          const isSelected = selected ? isSameDay(day, selected) : false
          const todayCell = isToday(day)
          return (
            <button
              key={key}
              className={[
                'grade-cal-cell',
                todayCell ? 'grade-cal-today' : '',
                isSelected ? 'grade-cal-selected' : '',
                hasSessions ? 'grade-cal-has-sessions' : '',
              ].join(' ')}
              onClick={() => setSelected(isSelected ? null : day)}
            >
              <span className="grade-cal-day-num">{format(day, 'd')}</span>
              {hasSessions && (
                <span className="grade-cal-count">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Session detail panel */}
      {selected && (
        <div className="grade-cal-detail">
          <div className="grade-cal-detail-date">
            {format(selected, 'EEEE d MMMM yyyy', { locale: fr })}
          </div>
          {selectedSessions.length === 0 ? (
            <div className="grade-cal-detail-empty">Aucune session ce jour</div>
          ) : (
            <div className="grade-cal-session-list">
              {selectedSessions.map(s => (
                <div key={s.id} className="grade-cal-session-row">
                  <div className="flex-1 min-w-0">
                    <div className="grade-cal-session-name">{s.members?.name ?? '—'}</div>
                    <div className="grade-cal-session-phone">{s.members?.phone ?? ''}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <GradeBadge grade={s.grade_before} size="sm" />
                    <span className="text-slate-400 text-xs">→</span>
                    <GradeBadge grade={Math.min(s.grade_before + 1, 12)} size="sm" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
