'use client'
// app/(protected)/grades/page.tsx
// Layout 2 colonnes : sessions + historique à gauche, calendrier bleu à droite,
// mini-stats en tête — même langage visuel que le dashboard maquette.
import { useEffect, useMemo, useState, useTransition } from 'react'
import { useBranch } from '@/lib/branch-context'
import { useKarateOnlyGuard } from '@/lib/discipline-context'
import { useT } from '@/lib/i18n'
import { getGradeSessions, getPendingGradeChecks, createGradeSession, confirmGradeSession, getMembers } from '@/lib/actions'
import { enrichMember, nextGradePassageDate } from '@/lib/gym'
import GradeBadge from '@/components/GradeBadge'
import GradeCalendar from '@/components/GradeCalendar'
import ToastRise from '@/components/ToastRise'
import PopNumber from '@/components/PopNumber'
import SlidingTabs from '@/components/SlidingTabs'
import BranchTabs from '@/components/BranchTabs'
import { GRADE_LABELS } from '@/types'
import type { GradeSession } from '@/types'
import { ArrowRight, CalendarClock, CheckCircle2, Percent, StickyNote } from 'lucide-react'
import clsx from 'clsx'

// ─── Toast ────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return (
    <ToastRise className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-2xl shadow-xl">
      {msg}
    </ToastRise>
  )
}

// ─── Avatar initiales ─────────────────────────────────────────
const AVATAR_COLORS = ['#2f6bff', '#4d8cff', '#9b72ff', '#7ea5ff', '#8b5cf6', '#16a34a']
function InitialsAvatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const color = AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
  return (
    <span
      className="inline-flex items-center justify-center rounded-full text-white font-bold flex-shrink-0"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initials}
    </span>
  )
}

// ─── Confirm Modal ────────────────────────────────────────────
function ConfirmModal({ session, onClose, onDone }: {
  session: GradeSession
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const [anim, setAnim] = useState<'pre' | 'open' | 'closing'>('pre')
  const { t } = useT()
  const currentGrade = session.grade_before
  const nextGrade = Math.min(currentGrade + 1, 12)
  const memberName = session.members?.name ?? ''

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  const handleClose = () => { setAnim('closing'); setTimeout(onClose, 160) }

  const handleConfirm = (result: 'passed' | 'failed') => {
    startTransition(async () => {
      const res = await confirmGradeSession(session.id, result, notes)
      if (res?.error) { onDone(`❌ ${res.error}`); return }
      if (result === 'passed') {
        onDone(`🎉 ${memberName} ${t('result_pass_to')} ${GRADE_LABELS[nextGrade]} !`)
      } else {
        onDone(`${memberName} ${t('result_stay')} ${GRADE_LABELS[currentGrade]}.`)
      }
      handleClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={handleClose}>
      <div
        className={`t-modal ${anim === 'open' ? 'is-open' : anim === 'closing' ? 'is-closing' : ''} bg-[#0e1220] border border-white/10 rounded-3xl w-full max-w-md p-7 shadow-2xl`}
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-white mb-1">{t('modal_grade_title')}</h2>
        <p className="text-sm text-slate-400 mb-6">{memberName} — {new Date(session.scheduled_date).toLocaleDateString('fr-FR')}</p>

        <div className="flex items-center justify-center gap-4 mb-7">
          <GradeBadge grade={currentGrade} size="lg" />
          <span className="text-2xl text-slate-400">→</span>
          <GradeBadge grade={nextGrade} size="lg" />
        </div>

        <div className="mb-5">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5 uppercase tracking-widest">{t('notes_optional')}</label>
          <textarea
            className="w-full rounded-2xl px-4 py-3 bg-white/5 border border-white/10 text-white placeholder:text-slate-500 text-sm resize-none focus:outline-none focus:border-white/20"
            rows={2}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder={t('notes_placeholder')}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => handleConfirm('passed')}
            disabled={isPending}
            className="flex flex-col items-center gap-1 py-4 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors disabled:opacity-50"
          >
            <span className="text-xl">✓</span>
            <span className="text-sm">{t('result_passed')}</span>
            <span className="text-xs opacity-75">{t('result_pass_to')} {GRADE_LABELS[nextGrade]}</span>
          </button>
          <button
            onClick={() => handleConfirm('failed')}
            disabled={isPending}
            className="flex flex-col items-center gap-1 py-4 rounded-2xl bg-red-700 hover:bg-red-600 text-white font-bold transition-colors disabled:opacity-50"
          >
            <span className="text-xl">✗</span>
            <span className="text-sm">{t('result_failed')}</span>
            <span className="text-xs opacity-75">{t('result_stay')} {GRADE_LABELS[currentGrade]}</span>
          </button>
        </div>

        <button onClick={handleClose} className="w-full mt-3 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-slate-400 text-sm font-medium transition-colors">
          {t('btn_cancel')}
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function GradesPage() {
  // Isolation disciplines : Grades = karaté uniquement
  const blocked = useKarateOnlyGuard()
  if (blocked) return null
  return <GradesPageInner />
}

function GradesPageInner() {
  const { activeBranch, profileRole } = useBranch()
  const { t } = useT()
  const [sessions, setSessions] = useState<GradeSession[]>([])
  const [pending, setPending] = useState<any[]>([])
  const [branchMembers, setBranchMembers] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmSession, setConfirmSession] = useState<GradeSession | null>(null)
  const [toast, setToast] = useState('')
  const [search, setSearch] = useState('')
  const [filterResult, setFilterResult] = useState('all')
  const [showAllHistory, setShowAllHistory] = useState(false)
  const [creating, startCreate] = useTransition()

  const canEdit = ['admin', 'receptionist'].includes(profileRole)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(''), 5000)
  }

  const fetchAll = async () => {
    try {
      const [s, p, mb] = await Promise.all([
        getGradeSessions(activeBranch),
        getPendingGradeChecks(activeBranch),
        getMembers(activeBranch),
      ])
      setSessions(s as GradeSession[])
      setPending(p)
      setBranchMembers((mb ?? []).map(enrichMember))
    } catch {
      setSessions([])
      setPending([])
      setBranchMembers([])
    }
    setLoading(false)
  }

  useEffect(() => { fetchAll() }, [activeBranch])

  const handleCreateSession = (memberId: string) => {
    // Dates de passage fixes du club : 1 sept / 1 déc / 1 mars / 1 juin
    const date = nextGradePassageDate(new Date())
    startCreate(async () => {
      const res = await createGradeSession(memberId, date.toISOString().split('T')[0])
      if (res?.error) { showToast(`❌ ${res.error}`); return }
      showToast(`✅ ${t('session_created')}`)
      await fetchAll()
    })
  }

  const allPending = useMemo(
    () => sessions.filter(s => s.status === 'pending').sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)),
    [sessions],
  )

  // Toutes les sessions en attente sont affichées (l'ancien code masquait
  // celles à plus de 30 jours, ce qui rendait des membres « invisibles »)
  const pendingSessions = allPending
  const historySessions = useMemo(() => sessions.filter(s => s.status !== 'pending'), [sessions])

  // ── Stats de tête ──
  const nextSession = allPending[0] ?? null
  // La prochaine échéance est une date FIXE du club (1 sept/déc/mars/juin),
  // qu'il y ait déjà des sessions planifiées ou non
  const nextFixedDate = nextGradePassageDate(new Date())
  const daysToNext = Math.ceil((nextFixedDate.getTime() - Date.now()) / 86400000)
  const passedCount = historySessions.filter(s => s.status === 'passed').length
  const failedCount = historySessions.filter(s => s.status === 'failed').length
  const successRate = passedCount + failedCount > 0
    ? Math.round((passedCount / (passedCount + failedCount)) * 100)
    : null

  // ── Éligibles au passage mais abonnement expiré (bloqués par la règle) ──
  const blockedByExpiredSub = useMemo(() => {
    const withPending = new Set(allPending.map(s => s.member_id))
    const now = Date.now()
    return branchMembers.filter((m: any) =>
      m.sub_status === 'expired' &&
      (m.grade ?? 0) < 12 &&
      m.join_date && (now - new Date(m.join_date).getTime()) / 86400000 >= 91 &&
      !withPending.has(m.id)
    )
  }, [branchMembers, allPending])

  // ── Historique : filtres pilules + compteurs ──
  const historyItems = useMemo(() => [
    { key: 'all',    label: <>{t('grades_filter_all')} <b>{historySessions.length}</b></> },
    { key: 'passed', label: <>{t('grades_filter_pass')} <b>{passedCount}</b></> },
    { key: 'failed', label: <>{t('grades_filter_fail')} <b>{failedCount}</b></> },
  ], [historySessions.length, passedCount, failedCount, t])

  const filteredHistory = historySessions.filter(s => {
    const matchSearch = !search || s.members?.name.toLowerCase().includes(search.toLowerCase())
    const matchResult = filterResult === 'all' || s.status === filterResult
    return matchSearch && matchResult
  })
  const visibleHistory = showAllHistory ? filteredHistory : filteredHistory.slice(0, 15)

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full" />
    </div>
  )

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black" style={{ color: '#ffffff' }}>{t('grades_title')}</h1>
          <p className="text-slate-400 mt-0.5">{t('grades_sub')}</p>
        </div>
        <BranchTabs />
      </div>

      {/* ── Mini-stats ── */}
      <div className="grade-stats-row">
        <div className="dz-card grade-stat">
          <span className="grade-stat-icon" style={{ background: 'rgba(47,107,255,0.15)', color: '#7ea5ff' }}><CalendarClock size={18} /></span>
          <div>
            <div className="grade-stat-value">
              <PopNumber value={`J-${Math.max(0, daysToNext)}`} />
            </div>
            <div className="grade-stat-label">
              {nextFixedDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
        </div>
        <div className="dz-card grade-stat">
          <span className="grade-stat-icon" style={{ background: 'rgba(16,185,129,0.15)', color: '#4ade80' }}><CheckCircle2 size={18} /></span>
          <div>
            <div className="grade-stat-value"><PopNumber value={passedCount} /></div>
            <div className="grade-stat-label">{t('badge_passed')}</div>
          </div>
        </div>
        <div className="dz-card grade-stat">
          <span className="grade-stat-icon" style={{ background: 'rgba(155,114,255,0.15)', color: '#c4b5fd' }}><Percent size={18} /></span>
          <div>
            <div className="grade-stat-value">{successRate !== null ? <PopNumber value={`${successRate}%`} /> : '—'}</div>
            <div className="grade-stat-label">{t('grades_history')}</div>
          </div>
        </div>
      </div>

      {/* ── Section : À vérifier ── */}
      {pending.length > 0 && (
        <div className="mb-6">
          <div className="section-heading">
            <span>{t('grades_to_check')}</span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[0.6rem] font-bold ml-1">{pending.length}</span>
            <span className="section-line" />
          </div>
          <div className="grid gap-3">
            {pending.map((m: any) => (
              <div key={m.id} className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-red-500/10 border border-red-500/20">
                <InitialsAvatar name={m.name} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white">{m.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {t('months_since')} {m.months_since} {t('months')} · {m.missing} {t('missing_checks')}
                  </div>
                </div>
                <GradeBadge grade={m.grade ?? 0} size="sm" />
                {canEdit && (
                  <button
                    onClick={() => handleCreateSession(m.id)}
                    disabled={creating}
                    className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-full font-semibold transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {t('grades_create')}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Éligibles mais abonnement expiré ── */}
      {blockedByExpiredSub.length > 0 && (
        <div className="mb-6">
          <div className="section-heading">
            <span>{t('grades_to_check')} — {t('members_filter_sub_expired')}</span>
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-black text-[0.6rem] font-bold ml-1">{blockedByExpiredSub.length}</span>
            <span className="section-line" />
          </div>
          <div className="grid gap-3">
            {blockedByExpiredSub.map((m: any) => (
              <div key={m.id} className="flex items-center gap-4 px-5 py-4 rounded-2xl bg-amber-500/08 border border-amber-500/20">
                <InitialsAvatar name={m.name} size={34} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-white">{m.name}</div>
                  <div className="text-xs text-amber-300/80 mt-0.5">
                    {t('members_filter_sub_expired')} — {t('btn_renew_sub')} {t('grades_create').toLowerCase()}
                  </div>
                </div>
                <GradeBadge grade={m.grade ?? 0} size="sm" />
                <a href="/members" className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-full font-semibold transition-colors whitespace-nowrap">
                  {t('btn_renew_sub')}
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Grille 2 colonnes ── */}
      <div className="grades-grid">

        {/* Colonne gauche : sessions + historique */}
        <div className="dz-col">

          {/* Sessions planifiées */}
          <section className="dz-card">
            <div className="dz-card-head">
              <div className="dz-card-title">{t('grades_planned')}</div>
              <div className="dz-card-note">{pendingSessions.length}</div>
            </div>
            {pendingSessions.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">{t('grades_no_planned')}</div>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/08">
                      {[t('col_member'), t('col_current_belt'), '', t('col_target_belt'), t('col_date'), ''].map((h, i) => (
                        <th key={i} className="px-3 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/05">
                    {pendingSessions.map(s => {
                      const daysLeft = Math.ceil((new Date(s.scheduled_date).getTime() - Date.now()) / 86400000)
                      const isOverdue = daysLeft < 0
                      const isSoon = daysLeft >= 0 && daysLeft <= 14
                      return (
                        <tr key={s.id} className="hover:bg-white/03 transition-colors">
                          <td className="px-3 py-3.5">
                            <div className="flex items-center gap-2.5">
                              <InitialsAvatar name={s.members?.name ?? '—'} size={30} />
                              <span className="font-semibold text-white text-sm">{s.members?.name ?? '—'}</span>
                            </div>
                          </td>
                          <td className="px-3 py-3.5"><GradeBadge grade={s.grade_before} size="sm" /></td>
                          <td className="px-1 py-3.5 text-slate-500"><ArrowRight size={14} /></td>
                          <td className="px-3 py-3.5"><GradeBadge grade={Math.min(s.grade_before + 1, 12)} size="sm" /></td>
                          <td className="px-3 py-3.5">
                            <div className="text-sm text-white">{new Date(s.scheduled_date).toLocaleDateString('fr-FR')}</div>
                            <div className={clsx('text-xs mt-0.5 font-semibold', isOverdue ? 'text-red-400' : isSoon ? 'text-amber-400' : 'text-emerald-400')}>
                              {isOverdue ? `${t('overdue')} ${Math.abs(daysLeft)} ${t('days')}` : `${t('in_days')} ${daysLeft} ${t('days')}`}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-right">
                            {canEdit && (
                              <button
                                onClick={() => setConfirmSession(s)}
                                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-full font-semibold transition-colors whitespace-nowrap"
                              >
                                {t('grades_confirm')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Historique */}
          <section className="dz-card">
            <div className="dz-card-head">
              <div className="dz-card-title">{t('grades_history')}</div>
            </div>

            <div className="flex gap-3 mt-4 mb-2 flex-wrap items-center">
              <input
                className="flex-1 min-w-48 rounded-full px-5 py-2.5 bg-white/05 border border-white/10 text-white placeholder:text-slate-500 text-sm focus:outline-none focus:border-white/20"
                placeholder={t('grades_search')}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              <SlidingTabs items={historyItems} value={filterResult} onChange={setFilterResult} />
            </div>

            {filteredHistory.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-sm">{t('grades_no_history')}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-white/08">
                      {[t('col_member'), t('col_from'), t('col_to'), t('col_date'), t('col_result'), ''].map((h, i) => (
                        <th key={i} className="px-3 py-3 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/05">
                    {visibleHistory.map(s => (
                      <tr key={s.id} className="hover:bg-white/03 transition-colors">
                        <td className="px-3 py-3.5">
                          <div className="flex items-center gap-2.5">
                            <InitialsAvatar name={s.members?.name ?? '—'} size={28} />
                            <span className="font-semibold text-white text-sm">{s.members?.name ?? '—'}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3.5"><GradeBadge grade={s.grade_before} size="sm" /></td>
                        <td className="px-3 py-3.5">
                          {s.grade_after !== null ? <GradeBadge grade={s.grade_after} size="sm" /> : '—'}
                        </td>
                        <td className="px-3 py-3.5">
                          <div className="text-sm text-slate-200">
                            {new Date(s.confirmed_at ?? s.scheduled_date).toLocaleDateString('fr-FR')}
                          </div>
                          {s.confirmed_at && (
                            <div className="text-xs text-slate-500 mt-0.5">
                              {t('col_date')} {new Date(s.scheduled_date).toLocaleDateString('fr-FR')}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-3.5">
                          {s.status === 'passed'
                            ? <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-400 bg-emerald-400/10 px-2.5 py-1 rounded-full">{t('badge_passed')}</span>
                            : <span className="inline-flex items-center gap-1 text-xs font-bold text-red-400 bg-red-400/10 px-2.5 py-1 rounded-full">{t('badge_failed')}</span>
                          }
                        </td>
                        <td className="px-3 py-3.5 text-slate-400">
                          {s.notes ? (
                            <span title={s.notes} className="inline-flex cursor-help text-slate-400 hover:text-white transition-colors">
                              <StickyNote size={15} />
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredHistory.length > 15 && !showAllHistory && (
                  <button
                    onClick={() => setShowAllHistory(true)}
                    className="w-full mt-3 py-2.5 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-semibold transition-colors"
                  >
                    {t('activity_view_all')} ({filteredHistory.length - 15}+)
                  </button>
                )}
              </div>
            )}
          </section>
        </div>

        {/* Colonne droite : calendrier bleu */}
        <div className="dz-col">
          <GradeCalendar sessions={sessions} initialDate={nextSession?.scheduled_date ?? nextFixedDate.toISOString()} />
        </div>
      </div>

      {/* Confirm modal */}
      {confirmSession && (
        <ConfirmModal
          session={confirmSession}
          onClose={() => setConfirmSession(null)}
          onDone={msg => { showToast(msg); fetchAll() }}
        />
      )}

      {toast && <Toast msg={toast} />}
    </div>
  )
}
