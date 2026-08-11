'use client'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useAnimPresence } from '@/lib/use-anim-presence'
import { getAuditLogs } from '@/lib/actions'
import type { AuditLog, AuditAction } from '@/types'
import { format, isToday, isYesterday, parseISO } from 'date-fns'
import { fr } from 'date-fns/locale'

const ACTION_CONFIG: Record<AuditAction, { icon: string; label: string; color: string }> = {
  member_add:            { icon: '➕', label: 'Membre ajouté',          color: '#22c55e' },
  member_update:         { icon: '✏️', label: 'Membre modifié',          color: '#3b82f6' },
  member_delete:         { icon: '🗑️', label: 'Membre supprimé',         color: '#ef4444' },
  subscription_renew:    { icon: '🔄', label: 'Abonnement renouvelé',    color: '#f59e0b' },
  insurance_renew:       { icon: '🛡️', label: 'Assurance renouvelée',    color: '#8b5cf6' },
  grade_session_create:  { icon: '🥋', label: 'Session de grade créée',  color: '#06b6d4' },
  grade_session_confirm: { icon: '🏆', label: 'Grade confirmé',          color: '#f97316' },
  staff_add:             { icon: '👤', label: 'Staff ajouté',            color: '#22c55e' },
  staff_update_role:     { icon: '🔑', label: 'Rôle modifié',            color: '#3b82f6' },
  staff_delete:          { icon: '❌', label: 'Staff supprimé',           color: '#ef4444' },
}

function groupByDate(logs: AuditLog[]): Record<string, AuditLog[]> {
  const groups: Record<string, AuditLog[]> = {}
  for (const log of logs) {
    const date = log.created_at.split('T')[0]
    if (!groups[date]) groups[date] = []
    groups[date].push(log)
  }
  return groups
}

function dateLabel(dateStr: string): string {
  const d = parseISO(dateStr)
  if (isToday(d))     return "Aujourd'hui"
  if (isYesterday(d)) return 'Hier'
  return format(d, 'EEEE d MMMM yyyy', { locale: fr })
}

function detailText(log: AuditLog): string {
  const d = log.details as Record<string, unknown> | null
  if (!d) return ''
  if (log.action === 'member_update' && Array.isArray(d.changes)) {
    return `Champs modifiés : ${(d.changes as string[]).join(', ')}`
  }
  if (log.action === 'subscription_renew' && d.new_expiry) {
    return `Nouveau expiry : ${d.new_expiry}`
  }
  if (log.action === 'insurance_renew' && d.new_expiry) {
    return `Nouvelle expiry assurance : ${d.new_expiry}`
  }
  if (log.action === 'grade_session_confirm') {
    const r = d.result === 'passed' ? '✅ Réussi' : '❌ Échoué'
    return `${r} · Ceinture ${d.grade_before} → ${d.grade_after}`
  }
  if (log.action === 'grade_session_create' && d.scheduled_date) {
    return `Séance prévue le ${d.scheduled_date}`
  }
  if (log.action === 'staff_update_role') {
    return `${d.old_role} → ${d.new_role}`
  }
  if (log.action === 'staff_add' && d.role) {
    return `Rôle : ${d.role}${d.branch ? ` · Branche : ${d.branch}` : ''}`
  }
  return ''
}

const ROLE_BADGE: Record<string, string> = {
  admin:         'bg-violet-500/20 text-violet-300',
  receptionist:  'bg-blue-500/20 text-blue-300',
  viewer:        'bg-gray-500/20 text-gray-400',
}

export default function HistoryPanel() {
  const panel = useAnimPresence(160)
  const [newCount, setNewCount] = useState(0)
  const [seenBeforeOpen, setSeenBeforeOpen] = useState<string | null>(null)
  const [logs, setLogs]         = useState<AuditLog[]>([])
  const [loading, setLoading]   = useState(false)
  const [filter, setFilter]     = useState<string>('all')
  const [, startTransition]     = useTransition()
  const ref                     = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) panel.close()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const fetchLogs = () => {
    setLoading(true)
    startTransition(async () => {
      try {
        const data = await getAuditLogs(300)
        setLogs(data as AuditLog[])
      } finally {
        setLoading(false)
      }
    })
  }

  // Compte les actions plus récentes que la dernière consultation
  const SEEN_KEY = 'gymflow-history-seen'
  useEffect(() => {
    const poll = async () => {
      try {
        const data = await getAuditLogs(50)
        const seen = localStorage.getItem(SEEN_KEY)
        setNewCount((data ?? []).filter((l: any) => !seen || l.created_at > seen).length)
      } catch {}
    }
    poll()
    const interval = setInterval(poll, 30000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOpen = () => {
    if (panel.isOpen) {
      panel.close()
    } else {
      panel.open()
      fetchLogs()
      // Consultation = vu : le badge tombe à zéro jusqu'aux prochaines actions.
      // On garde l'ancien repère pour surligner les nouveautés de CETTE consultation.
      setSeenBeforeOpen(localStorage.getItem(SEEN_KEY))
      localStorage.setItem(SEEN_KEY, new Date().toISOString())
      setNewCount(0)
    }
  }

  const FILTERS = [
    { key: 'all',          label: 'Tout' },
    { key: 'member',       label: 'Membres' },
    { key: 'subscription', label: 'Abonnements' },
    { key: 'insurance',    label: 'Assurances' },
    { key: 'grade',        label: 'Grades' },
    { key: 'staff',        label: 'Staff' },
  ]

  const filtered = filter === 'all'
    ? logs
    : logs.filter(l => l.action.startsWith(filter === 'member' ? 'member' : filter === 'subscription' ? 'subscription' : filter === 'insurance' ? 'insurance' : filter === 'grade' ? 'grade' : 'staff'))

  const grouped = groupByDate(filtered)
  const dates   = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  return (
    <div ref={ref} className="relative">
      {/* Icon button */}
      <button
        onClick={handleOpen}
        className="icon-btn relative"
        aria-label="Historique des actions"
        title="Historique"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="t-badge" data-open={newCount > 0 ? 'true' : 'false'}>
          <span className="t-badge-dot min-w-[1.1rem] h-[1.1rem] rounded-full bg-red-500 text-white text-[0.6rem] font-bold flex items-center justify-center px-1">
            {newCount > 99 ? '99+' : newCount}
          </span>
        </span>
      </button>

      {/* Dropdown panel */}
      {panel.mounted && (
        <div className={`history-panel t-dropdown ${panel.stateClass}`} data-origin="top-right">
          {/* Header */}
          <div className="history-header">
            <div className="flex items-center gap-2">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              <span className="font-semibold text-white text-sm">Historique</span>
              <span className="text-xs text-slate-400">({filtered.length} actions)</span>
            </div>
            <button onClick={fetchLogs} className="text-slate-400 hover:text-white transition-colors" title="Rafraîchir">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>

          {/* Filters */}
          <div className="history-filters">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`history-filter-chip ${filter === f.key ? 'history-filter-chip-active' : ''}`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="history-body">
            {loading && (
              <div className="history-empty">
                <div className="animate-spin w-5 h-5 border-2 border-white/20 border-t-white/80 rounded-full mx-auto" />
              </div>
            )}

            {!loading && filtered.length === 0 && (
              <div className="history-empty">
                <span className="text-2xl">📋</span>
                <p>Aucune action enregistrée</p>
              </div>
            )}

            {!loading && dates.map(date => (
              <div key={date}>
                {/* Date group header */}
                <div className="history-date-label">
                  {dateLabel(date)}
                  <span className="ml-2 text-slate-500 text-xs">({grouped[date].length})</span>
                </div>

                {/* Logs for this date */}
                {grouped[date].map(log => {
                  const cfg = ACTION_CONFIG[log.action] ?? { icon: '📝', label: log.action, color: '#6b7280' }
                  const detail = detailText(log)
                  const time = format(parseISO(log.created_at), 'HH:mm')
                  return (
                    <div key={log.id} className={`history-item${seenBeforeOpen === null || log.created_at > seenBeforeOpen ? ' glossy-new' : ''}`}>
                      <div className="history-item-icon" style={{ color: cfg.color }}>
                        {cfg.icon}
                      </div>
                      <div className="history-item-body">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="history-item-action">{cfg.label}</span>
                          {log.branch && (
                            <span className="history-branch-badge">
                              {log.branch}
                            </span>
                          )}
                        </div>
                        {log.entity_name && (
                          <div className="history-item-name">{log.entity_name}</div>
                        )}
                        {detail && (
                          <div className="history-item-detail">{detail}</div>
                        )}
                        <div className="history-item-meta">
                          <span className="history-item-time">{time}</span>
                          {log.performer_name && (
                            <>
                              <span className="text-slate-600">·</span>
                              <span className="history-item-performer">{log.performer_name}</span>
                              {log.performer_role && (
                                <span className={`history-role-badge ${ROLE_BADGE[log.performer_role] ?? 'bg-gray-500/20 text-gray-400'}`}>
                                  {log.performer_role}
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
