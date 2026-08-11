'use client'

import { useEffect, useMemo, useState, useTransition, useCallback } from 'react'
import type { Championship, ChampionshipAthlete, ChampionshipStatus } from '@/types'
import {
  getChampionships,
  getChampionshipWithAthletes,
  createChampionship,
  updateChampionship,
  deleteChampionship,
  addAthletesToChampionship,
  removeAthleteFromChampionship,
  enterAthleteResult,
  enterAllResults,
} from '@/lib/actions'
import { createClient } from '@/lib/supabase/client'
import ToastRise from '@/components/ToastRise'
import { useT } from '@/lib/i18n'
import { useKarateOnlyGuard } from '@/lib/discipline-context'
import SlidingTabs from '@/components/SlidingTabs'
import { Calendar, MapPin, Users, Plus, MoreHorizontal, Pencil, Trash2, TriangleAlert } from 'lucide-react'

// ─── Types locaux ──────────────────────────────────────────────────────────────

type ChampSummary = Championship & {
  athlete_count: number
  qualified_count: number
  medals: { gold: number; silver: number; bronze: number }
}

type ChampDetail = ChampSummary & {
  athletes: ChampionshipAthlete[]
  total_athletes: number
}

interface MemberRow {
  id: string; name: string; grade: number; branch: string; phone: string
}

// ─── Constantes ────────────────────────────────────────────────────────────────

const GRADE_LABELS: Record<number, string> = {
  0: 'Blanche', 1: 'Blanche+', 2: 'Jaune', 3: 'Jaune+', 4: 'Orange',
  5: 'Orange+', 6: 'Verte', 7: 'Verte+', 8: 'Bleue', 9: 'Bleue+',
  10: 'Marron', 11: 'Marron+', 12: 'Noire',
}

const BELT_COLORS: Record<number, string> = {
  0: '#e5e7eb', 1: '#e5e7eb', 2: '#facc15', 3: '#facc15',
  4: '#fb923c', 5: '#fb923c', 6: '#22c55e', 7: '#22c55e',
  8: '#3b82f6', 9: '#3b82f6', 10: '#92400e', 11: '#92400e', 12: '#111827',
}

const STATUS_LABELS: Record<ChampionshipStatus, string> = {
  upcoming:  'À venir',
  ongoing:   'En cours',
  completed: 'Terminé',
}

// Statut effectif : une date passée sans résultats = « à saisir »
function effectiveStatus(c: { status: ChampionshipStatus; date: string }): ChampionshipStatus | 'overdue' {
  if (c.status === 'completed') return 'completed'
  if (daysUntil(c.date) < 0) return 'overdue'
  return c.status
}

const STATUS_CLASSES: Record<string, string> = {
  upcoming:  'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  ongoing:   'bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30 animate-pulse',
  completed: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30',
  overdue:   'bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40',
}

const BRANCH_LABELS: Record<string, string> = { sbata: 'Sbata', rachad: 'Rachad', both: 'Les deux' }
const BRANCH_CLASSES: Record<string, string> = {
  sbata:  'bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/30',
  rachad: 'bg-orange-500/15 text-orange-300 ring-1 ring-orange-500/30',
  both:   'bg-violet-500/15 text-violet-300 ring-1 ring-violet-500/30',
}

// ─── Toast ─────────────────────────────────────────────────────────────────────

function useToast() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; ok: boolean }[]>([])
  const show = useCallback((msg: string, ok = true) => {
    const id = Date.now()
    setToasts(t => [...t, { id, msg, ok }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000)
  }, [])
  return { toasts, show }
}

function ToastContainer({ toasts }: { toasts: { id: number; msg: string; ok: boolean }[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <ToastRise key={t.id} className={`px-4 py-3 rounded-xl shadow-lg text-sm font-semibold text-white ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}>
          {t.ok ? '✓' : '✗'} {t.msg}
        </ToastRise>
      ))}
    </div>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const colors = ['#2f6bff', '#4d8cff', '#9b72ff', '#7ea5ff', '#8b5cf6', '#16a34a']
  const bg = colors[name.charCodeAt(0) % colors.length]
  return (
    <div style={{ width: size, height: size, background: bg, borderRadius: '50%', fontSize: size * 0.38, flexShrink: 0 }}
      className="flex items-center justify-center text-white font-bold">
      {initials(name)}
    </div>
  )
}

function BeltBadge({ grade }: { grade: number }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: BELT_COLORS[grade] + '22', color: grade === 12 ? '#111' : 'inherit', border: `1px solid ${BELT_COLORS[grade]}` }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: BELT_COLORS[grade], display: 'inline-block' }} />
      {GRADE_LABELS[grade] ?? `G${grade}`}
    </span>
  )
}

function ResultBadge({ athlete }: { athlete: ChampionshipAthlete }) {
  const { t } = useT()
  if (athlete.qualified === null) return <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-slate-300">{t('champ_pending')}</span>
  if (athlete.qualified === false) return <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300 ring-1 ring-red-500/30">✗ {t('champ_badge_notq')}</span>
  if (athlete.place === 1) return <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/30">🥇 {t('champ_place1')}</span>
  if (athlete.place === 2) return <span className="text-xs px-2 py-0.5 rounded-full bg-slate-400/15 text-slate-300 ring-1 ring-slate-400/30">🥈 {t('champ_place2')}</span>
  if (athlete.place === 3) return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-600/15 text-amber-300 ring-1 ring-amber-600/30">🥉 {t('champ_place3')}</span>
  return <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30">✓ {t('champ_badge_q')}</span>
}

// ─── Modal championnat ─────────────────────────────────────────────────────────

interface ChampModalProps {
  editing: ChampSummary | null
  onClose: () => void
  onSaved: () => void
  show: (msg: string, ok?: boolean) => void
}

function ChampModal({ editing, onClose, onSaved, show }: ChampModalProps) {
  const { t } = useT()
  const [pending, start] = useTransition()
  const [form, setForm] = useState({
    name:        editing?.name ?? '',
    date:        editing?.date ?? '',
    location:    editing?.location ?? '',
    branch:      editing?.branch ?? '',
    status:      (editing?.status ?? 'upcoming') as ChampionshipStatus,
    description: editing?.description ?? '',
  })

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    start(async () => {
      const payload = {
        name:        form.name,
        date:        form.date,
        location:    form.location || undefined,
        branch:      form.branch || undefined,
        status:      form.status,
        description: form.description || undefined,
      }
      const res = editing
        ? await updateChampionship(editing.id, payload)
        : await createChampionship(payload)
      if (res.error) { show(res.error, false); return }
      show(editing ? t('champ_toast_saved') : t('champ_toast_created'))
      onSaved()
    })
  }

  const inputCls = 'input-dark !rounded-xl'
  const [anim, setAnim] = useState<'pre' | 'open'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`t-modal ${anim === 'open' ? 'is-open' : ''} rounded-3xl shadow-2xl w-full max-w-md border border-white/10`} style={{ background: '#101320' }}>
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-bold text-white text-lg">
            {editing ? t('champ_modal_edit') : t('champ_modal_new')}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_name')}</label>
            <input required value={form.name} onChange={e => set('name', e.target.value)} className={inputCls} placeholder="ex: Championnat National Judo 2026" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_date')}</label>
              <input required type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_status')}</label>
              <select value={form.status} onChange={e => set('status', e.target.value)} className={inputCls}>
                <option value="upcoming">{t('champ_status_upcoming')}</option>
                <option value="ongoing">{t('champ_status_ongoing')}</option>
                <option value="completed">{t('champ_status_completed')}</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_location')}</label>
            <input value={form.location} onChange={e => set('location', e.target.value)} className={inputCls} placeholder="ex: Salle omnisports de Casablanca" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_branch')}</label>
            <select value={form.branch} onChange={e => set('branch', e.target.value)} className={inputCls}>
              <option value="">{t('champ_all_branches')}</option>
              <option value="sbata">{t('branch_sbata')}</option>
              <option value="rachad">{t('branch_rachad')}</option>
              <option value="both">{t('staff_both')}</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-400 mb-1">{t('champ_field_desc')}</label>
            <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} className={inputCls + ' resize-none'} placeholder="Informations supplémentaires…" />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-full border border-white/15 text-sm font-semibold text-slate-300 hover:bg-white/10 transition">
              {t('btn_cancel')}
            </button>
            <button type="submit" disabled={pending} className="flex-1 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50 transition">
              {pending ? '…' : t('champ_save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Tab: Liste ────────────────────────────────────────────────────────────────

function TabList({ champs, isAdmin, onRefresh, onManage, onResults, show }: {
  champs: ChampSummary[]
  isAdmin: boolean
  onRefresh: () => void
  onManage: (c: ChampSummary) => void
  onResults: (c: ChampSummary) => void
  show: (msg: string, ok?: boolean) => void
}) {
  const { t } = useT()
  const [pending, start] = useTransition()
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing]     = useState<ChampSummary | null>(null)
  const [filter, setFilter]       = useState('all')
  const [menuFor, setMenuFor]     = useState<string | null>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.('[data-rowmenu]')) setMenuFor(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const counts = {
    all: champs.length,
    upcoming: champs.filter(c => effectiveStatus(c) === 'upcoming').length,
    ongoing: champs.filter(c => effectiveStatus(c) === 'ongoing').length,
    overdue: champs.filter(c => effectiveStatus(c) === 'overdue').length,
    completed: champs.filter(c => effectiveStatus(c) === 'completed').length,
  }
  const filterItems = useMemo(() => {
    const items: { key: string; label: React.ReactNode }[] = [
      { key: 'all',       label: <>{t('grades_filter_all')} <b>{counts.all}</b></> },
      { key: 'upcoming',  label: <>{t('champ_filter_upcoming')} <b>{counts.upcoming}</b></> },
      { key: 'ongoing',   label: <>{t('champ_filter_ongoing')} <b>{counts.ongoing}</b></> },
      { key: 'completed', label: <>{t('champ_filter_completed')} <b>{counts.completed}</b></> },
    ]
    if (counts.overdue > 0) items.splice(3, 0, { key: 'overdue', label: <>{t('champ_filter_overdue')} <b>{counts.overdue}</b></> })
    return items
  }, [counts.all, counts.upcoming, counts.ongoing, counts.overdue, counts.completed])

  const visible = filter === 'all' ? champs : champs.filter(c => effectiveStatus(c) === filter)

  function openEdit(c: ChampSummary) { setEditing(c); setShowModal(true) }
  function openNew()                  { setEditing(null); setShowModal(true) }

  function handleDelete(c: ChampSummary) {
    if (!confirm(`${c.name} — ${t('champ_confirm_delete')}`)) return
    start(async () => {
      const res = await deleteChampionship(c.id)
      if (res.error) { show(res.error, false); return }
      show(t('champ_toast_deleted'))
      onRefresh()
    })
  }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
        <SlidingTabs items={filterItems} value={filter} onChange={setFilter} />
        <button onClick={openNew} className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-bold transition inline-flex items-center gap-1.5">
          <Plus size={15} strokeWidth={2.5} /> {t('champ_new')}
        </button>
      </div>

      {champs.length === 0 && (
        <div className="text-center py-20 text-slate-500">
          <div className="text-5xl mb-3">🏆</div>
          <p className="font-semibold">{t('champ_none')}</p>
          <p className="text-sm mt-1">{t('champ_none_hint')}</p>
        </div>
      )}

      <div className="space-y-4">
        {visible.map(c => {
          const days = daysUntil(c.date)
          const eff = effectiveStatus(c)
          const urgency = days < 14 ? 'text-red-400 font-bold' : days < 30 ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'
          return (
            <div key={c.id} className="rounded-2xl border border-white/10 bg-[#10131c] p-5 transition-colors hover:border-white/20">
              <div className="flex flex-col sm:flex-row items-start gap-4">
                <div className="flex-1 min-w-0">
                  {/* Titre + badges */}
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <h3 className="font-bold text-white text-base">{c.name}</h3>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${STATUS_CLASSES[eff]}`}>
                      {eff === 'overdue' ? <><TriangleAlert size={11} /> {t('champ_status_overdue')}</> : t(('champ_status_' + c.status) as any)}
                    </span>
                    {c.branch && (
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${BRANCH_CLASSES[c.branch] ?? ''}`}>
                        {c.branch === 'sbata' ? t('branch_sbata') : c.branch === 'rachad' ? t('branch_rachad') : c.branch === 'both' ? t('staff_both') : c.branch}
                      </span>
                    )}
                  </div>

                  {/* Infos */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-400 items-center">
                    <span className="inline-flex items-center gap-1.5"><Calendar size={13} /> {fmtDate(c.date)}</span>
                    {c.location && <span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {c.location}</span>}
                    <span className="inline-flex items-center gap-1.5"><Users size={13} /> {c.athlete_count} {t('champ_participants_count')}</span>
                    {eff === 'upcoming' && days >= 0 && (
                      <span className={urgency}>J-{days}</span>
                    )}
                  </div>

                  {/* Résultats si terminé */}
                  {c.status === 'completed' && c.athlete_count > 0 && (
                    <div className="flex gap-4 mt-2 text-sm">
                      <span>🥇 {c.medals.gold}</span>
                      <span>🥈 {c.medals.silver}</span>
                      <span>🥉 {c.medals.bronze}</span>
                      <span className="text-emerald-300">✓ {c.qualified_count}/{c.athlete_count} {t('champ_qualified_of')}</span>
                    </div>
                  )}
                </div>

                {/* Actions : principale + menu ⋯ */}
                <div className="champ-card-actions flex items-center gap-2 shrink-0 flex-wrap">
                  {eff === 'completed' || eff === 'overdue' ? (
                    <button onClick={() => onResults(c)} className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition whitespace-nowrap ${eff === 'overdue' ? 'bg-amber-500/90 hover:bg-amber-400 text-black' : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25'}`}>
                      {eff === 'overdue' ? t('champ_enter_results') : t('champ_see_results')}
                    </button>
                  ) : (
                    <button onClick={() => onManage(c)} className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3.5 py-1.5 rounded-full font-semibold transition whitespace-nowrap inline-flex items-center gap-1.5">
                      <Users size={13} /> {t('champ_manage')}
                    </button>
                  )}
                  <div className="relative" data-rowmenu>
                    <button
                      onClick={() => setMenuFor(menuFor === c.id ? null : c.id)}
                      title="Plus d'actions"
                      className="inline-flex items-center justify-center w-[30px] h-[30px] rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                    >
                      <MoreHorizontal size={15} strokeWidth={2.1} />
                    </button>
                    {menuFor === c.id && (
                      <div className="row-menu t-dropdown is-open" data-origin="top-right">
                        <button onClick={() => { setMenuFor(null); openEdit(c) }}>
                          <Pencil size={13} strokeWidth={2.1} /> {t('champ_modify')}
                        </button>
                        {isAdmin && (
                          <button className="row-menu-danger" disabled={pending} onClick={() => { setMenuFor(null); handleDelete(c) }}>
                            <Trash2 size={13} strokeWidth={2.1} /> {t('btn_delete')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {showModal && (
        <ChampModal
          editing={editing}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); onRefresh() }}
          show={show}
        />
      )}
    </>
  )
}

// ─── Tab: Participants ─────────────────────────────────────────────────────────

function TabParticipants({ champs, show, onRefresh }: {
  champs: ChampSummary[]
  show: (msg: string, ok?: boolean) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const [selectedId, setSelectedId] = useState<string>(champs[0]?.id ?? '')
  const [detail, setDetail]         = useState<ChampDetail | null>(null)
  const [allMembers, setAllMembers] = useState<MemberRow[]>([])
  const [search, setSearch]         = useState('')
  const [checked, setChecked]       = useState<Map<string, { category: string; weight_class: string }>>(new Map())
  const [pending, start]            = useTransition()
  const [loading, setLoading]       = useState(false)

  // Load detail when championship changes
  useEffect(() => {
    if (!selectedId) return
    setLoading(true)
    getChampionshipWithAthletes(selectedId).then(d => {
      setDetail(d as any)
      setLoading(false)
    })
  }, [selectedId])

  // Load all members once
  useEffect(() => {
    const supabase = createClient()
    supabase.from('members').select('id, name, grade, branch, phone').order('name').then(({ data }) => {
      setAllMembers(data ?? [])
    })
  }, [])

  const champ = champs.find(c => c.id === selectedId)
  const existingIds = new Set(detail?.athletes.map(a => a.member_id) ?? [])
  const filtered = allMembers.filter(m =>
    !existingIds.has(m.id) && m.name.toLowerCase().includes(search.toLowerCase())
  )

  function toggleMember(id: string) {
    setChecked(prev => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, { category: '', weight_class: '' })
      return next
    })
  }

  function handleAdd() {
    if (checked.size === 0 || !selectedId) return
    start(async () => {
      const athletes = Array.from(checked.entries()).map(([member_id, v]) => ({
        member_id,
        category:     v.category || undefined,
        weight_class: v.weight_class || undefined,
      }))
      const res = await addAthletesToChampionship(selectedId, athletes)
      if (res.error) { show(res.error, false); return }
      show(`${checked.size} ${t('champ_toast_added')}`)
      setChecked(new Map())
      setSearch('')
      onRefresh()
      const d = await getChampionshipWithAthletes(selectedId)
      setDetail(d as any)
    })
  }

  function handleRemove(memberId: string, memberName: string) {
    if (!confirm(`${memberName} — ${t('champ_confirm_remove')}`)) return
    start(async () => {
      const res = await removeAthleteFromChampionship(selectedId, memberId)
      if (res.error) { show(res.error, false); return }
      show(`${memberName} ${t('champ_toast_removed')}`)
      onRefresh()
      const d = await getChampionshipWithAthletes(selectedId)
      setDetail(d as any)
    })
  }

  return (
    <div className="space-y-6">
      {/* Sélecteur championnat */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('champ_select')}</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="input-dark !rounded-xl max-w-sm"
        >
          {champs.length === 0 && <option value="">{t('champ_none')}</option>}
          {champs.map(c => <option key={c.id} value={c.id}>{c.name} — {fmtDate(c.date)}</option>)}
        </select>
      </div>

      {!selectedId && (
        <p className="text-gray-400 text-sm">{t('champ_select_hint')}</p>
      )}

      {loading && <p className="text-gray-400 text-sm">{t('champ_loading')}</p>}

      {detail && champ && !loading && (
        <>
          {/* Ajouter participants */}
          {champ.status !== 'completed' && (
            <div className="rounded-2xl border border-white/10 bg-[#10131c] p-5">
              <h3 className="font-bold text-white mb-4">{t('champ_add_participants')}</h3>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('champ_search_member')}
                className="input-dark !rounded-xl mb-3"
              />
              <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                {filtered.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">{t('champ_no_members')}</p>
                )}
                {filtered.map(m => {
                  const isChecked = checked.has(m.id)
                  const entry = checked.get(m.id)
                  return (
                    <div key={m.id}>
                      <label className={`flex items-center gap-3 p-2.5 rounded-xl border-2 cursor-pointer transition ${isChecked ? 'border-blue-500 bg-blue-500/10' : 'border-transparent hover:border-white/15'}`}>
                        <input type="checkbox" checked={isChecked} onChange={() => toggleMember(m.id)} className="accent-blue-600" />
                        <Avatar name={m.name} size={28} />
                        <span className="text-sm font-semibold text-white flex-1">{m.name}</span>
                        <BeltBadge grade={m.grade} />
                        <span className="text-xs text-gray-400">{m.branch}</span>
                      </label>
                      {isChecked && entry && (
                        <div className="flex gap-2 mt-1 ml-9 mb-1">
                          <input
                            value={entry.category}
                            onChange={e => setChecked(prev => { const n = new Map(prev); n.set(m.id, { ...entry, category: e.target.value }); return n })}
                            placeholder={t('champ_category_ph')}
                            className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                          />
                          <input
                            value={entry.weight_class}
                            onChange={e => setChecked(prev => { const n = new Map(prev); n.set(m.id, { ...entry, weight_class: e.target.value }); return n })}
                            placeholder={t('champ_weight_ph')}
                            className="flex-1 bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {checked.size > 0 && (
                <button onClick={handleAdd} disabled={pending} className="mt-4 w-full bg-blue-600 hover:bg-blue-500 text-white py-2.5 rounded-full text-sm font-bold disabled:opacity-50 transition">
                  {pending ? '…' : `${t('champ_add')} ${checked.size}`}
                </button>
              )}
            </div>
          )}

          {/* Liste participants */}
          <div className="rounded-2xl border border-white/10 bg-[#10131c] overflow-hidden">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="font-bold text-white">
                {t('champ_selected')}
                <span className="ml-2 text-sm font-normal text-gray-400">({detail.athletes.length})</span>
              </h3>
            </div>
            {detail.athletes.length === 0 ? (
              <p className="text-center py-10 text-gray-400 text-sm">{t('champ_no_participants')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-white/5 text-xs text-slate-400 uppercase tracking-wider">
                      <th className="px-4 py-3 text-left font-semibold">{t('col_member')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('col_belt')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('champ_col_category')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('champ_col_weight')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('col_result')}</th>
                      <th className="px-4 py-3 text-left font-semibold">{t('col_actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {detail.athletes.map(a => {
                      const m = a.members
                      return (
                        <tr key={a.id} className="hover:bg-white/5 transition">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {m && <Avatar name={m.name} size={28} />}
                              <span className="font-semibold text-white">{m?.name ?? '—'}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3">{m ? <BeltBadge grade={m.grade} /> : '—'}</td>
                          <td className="px-4 py-3 text-slate-400">{a.category ?? '—'}</td>
                          <td className="px-4 py-3 text-slate-400">{a.weight_class ?? '—'}</td>
                          <td className="px-4 py-3"><ResultBadge athlete={a} /></td>
                          <td className="px-4 py-3">
                            {champ.status !== 'completed' && a.qualified === null && m && (
                              <button
                                onClick={() => handleRemove(a.member_id, m.name)}
                                disabled={pending}
                                className="text-xs text-red-300 hover:underline disabled:opacity-40"
                              >
                                🗑️ {t('champ_remove')}
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
          </div>
        </>
      )}
    </div>
  )
}

// ─── Modal saisie groupée ──────────────────────────────────────────────────────

function BulkResultModal({ athletes, championshipId, onClose, onSaved, show }: {
  athletes: ChampionshipAthlete[]
  championshipId: string
  onClose: () => void
  onSaved: () => void
  show: (msg: string, ok?: boolean) => void
}) {
  const { t } = useT()
  const [pending, start] = useTransition()
  const [entries, setEntries] = useState<Map<string, { qualified: boolean | null; place: 1 | 2 | 3 | null; notes: string }>>(
    new Map(athletes.map(a => [a.id, { qualified: a.qualified, place: a.place, notes: a.result_notes ?? '' }]))
  )

  function set(id: string, k: string, v: unknown) {
    setEntries(prev => { const n = new Map(prev); n.set(id, { ...n.get(id)!, [k]: v }); return n })
  }

  function handleSubmit() {
    const results = Array.from(entries.entries())
      .filter(([, v]) => v.qualified !== null)
      .map(([athlete_id, v]) => ({
        athlete_id,
        qualified:    v.qualified!,
        place:        v.qualified ? v.place ?? undefined : undefined,
        result_notes: v.notes || undefined,
      }))
    if (results.length === 0) { show(t('champ_toast_none'), false); return }
    start(async () => {
      const res = await enterAllResults(championshipId, results)
      if (res.error) { show(res.error, false); return }
      show(t('champ_toast_all_results'))
      onSaved()
    })
  }

  const [anim, setAnim] = useState<'pre' | 'open'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className={`t-modal ${anim === 'open' ? 'is-open' : ''} rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col border border-white/10`} style={{ background: '#101320' }}>
        <div className="px-6 py-5 border-b border-white/10 flex items-center justify-between shrink-0">
          <h2 className="font-bold text-white text-lg">📋 {t('champ_bulk_title')}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {athletes.map(a => {
            const m = a.members
            const entry = entries.get(a.id)!
            return (
              <div key={a.id} className="border border-white/10 rounded-xl p-4 space-y-3">
                <div className="flex items-center gap-2">
                  {m && <Avatar name={m.name} size={28} />}
                  <span className="font-semibold text-white">{m?.name ?? '—'}</span>
                  {m && <BeltBadge grade={m.grade} />}
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  <span className="text-xs text-slate-400 w-20">{t('champ_qualified_q')}</span>
                  <button
                    type="button"
                    onClick={() => set(a.id, 'qualified', true)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${entry.qualified === true ? 'bg-green-600 text-white border-green-600' : 'border-gray-200 dark:border-gray-700 text-slate-300 hover:border-green-400'}`}
                  >✓ {t('champ_yes')}</button>
                  <button
                    type="button"
                    onClick={() => { set(a.id, 'qualified', false); set(a.id, 'place', null) }}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${entry.qualified === false ? 'bg-red-600 text-white border-red-600' : 'border-gray-200 dark:border-gray-700 text-slate-300 hover:border-red-400'}`}
                  >✗ {t('champ_no')}</button>
                  {entry.qualified === true && (
                    <>
                      <span className="text-xs text-slate-400 ml-3">{t('champ_place')}</span>
                      {([1, 2, 3] as const).map(p => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => set(a.id, 'place', p)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold border-2 transition ${entry.place === p ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-slate-300 hover:border-gray-400'}`}
                        >
                          {p === 1 ? '🥇' : p === 2 ? '🥈' : '🥉'} {p}
                        </button>
                      ))}
                    </>
                  )}
                </div>
                <input
                  value={entry.notes}
                  onChange={e => set(a.id, 'notes', e.target.value)}
                  placeholder={t('champ_notes_ph')}
                  className="w-full bg-white/5 border border-white/15 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-slate-500 focus:outline-none"
                />
              </div>
            )
          })}
        </div>
        <div className="px-6 py-4 border-t border-white/10 shrink-0 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-full border border-white/15 text-sm font-semibold text-slate-300 hover:bg-white/10 transition">
            {t('btn_cancel')}
          </button>
          <button onClick={handleSubmit} disabled={pending} className="flex-1 py-2.5 rounded-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold disabled:opacity-50 transition">
            {pending ? '…' : t('champ_save_all')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Tab: Résultats ────────────────────────────────────────────────────────────

function TabResults({ champs, show, onRefresh }: {
  champs: ChampSummary[]
  show: (msg: string, ok?: boolean) => void
  onRefresh: () => void
}) {
  const { t } = useT()
  const [selectedId, setSelectedId] = useState<string>(champs[0]?.id ?? '')
  const [detail, setDetail]         = useState<ChampDetail | null>(null)
  const [loading, setLoading]       = useState(false)
  const [showBulk, setShowBulk]     = useState(false)
  const [pending, start]            = useTransition()

  async function loadDetail(id: string) {
    if (!id) return
    setLoading(true)
    const d = await getChampionshipWithAthletes(id)
    setDetail(d as any)
    setLoading(false)
  }

  useEffect(() => { loadDetail(selectedId) }, [selectedId])

  function handleSingleResult(athleteId: string, qualified: boolean, place?: 1 | 2 | 3 | null) {
    start(async () => {
      const res = await enterAthleteResult(athleteId, { qualified, place })
      if (res.error) { show(res.error, false); return }
      show(t('champ_toast_result'))
      onRefresh()
      await loadDetail(selectedId)
    })
  }

  const champ = champs.find(c => c.id === selectedId)
  const allEntered = detail ? detail.athletes.every(a => a.qualified !== null) : false
  const allResultsEntered = allEntered && detail && detail.athletes.length > 0

  return (
    <div className="space-y-6">
      {/* Sélecteur */}
      <div>
        <label className="block text-xs font-semibold text-slate-400 mb-1.5">{t('champ_select')}</label>
        <select
          value={selectedId}
          onChange={e => setSelectedId(e.target.value)}
          className="input-dark !rounded-xl max-w-sm"
        >
          {champs.length === 0 && <option value="">{t('champ_none')}</option>}
          {champs.map(c => <option key={c.id} value={c.id}>{c.name} — {fmtDate(c.date)}</option>)}
        </select>
      </div>

      {loading && <p className="text-gray-400 text-sm">{t('champ_loading')}</p>}

      {champ?.status === 'upcoming' && (
        <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl px-4 py-3 text-sm text-amber-300">
          {t('champ_not_started')}
        </div>
      )}

      {detail && champ && (champ.status === 'ongoing' || champ.status === 'completed') && !loading && (
        <>
          {/* Résumé si terminé */}
          {champ.status === 'completed' && detail.athletes.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: t('champ_stat_participants'), value: detail.total_athletes, icon: '👥' },
                { label: t('champ_stat_qualified'), value: `${detail.qualified_count} (${Math.round(detail.qualified_count / detail.total_athletes * 100)}%)`, icon: '✓' },
                { label: t('champ_stat_medals'), value: `🥇${detail.medals.gold} 🥈${detail.medals.silver} 🥉${detail.medals.bronze}`, icon: '' },
                { label: t('champ_stat_not_qualified'), value: detail.total_athletes - detail.qualified_count, icon: '✗' },
              ].map(s => (
                <div key={s.label} className="rounded-xl border border-white/10 bg-[#10131c] px-4 py-3 text-center">
                  <div className="text-lg font-bold text-white">{s.value}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Tableau de saisie */}
          {detail.athletes.length === 0 ? (
            <p className="text-center text-gray-400 text-sm py-10">{t('champ_no_participants')}</p>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-[#10131c] overflow-hidden">
              <div className="px-5 py-4 border-b border-white/10">
                <h3 className="font-bold text-white">{t('champ_results_entry')}</h3>
              </div>
              <div className="divide-y divide-white/5">
                {detail.athletes.map(a => {
                  const m = a.members
                  return (
                    <div key={a.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Identité */}
                        <div className="flex items-center gap-2 min-w-[160px]">
                          {m && <Avatar name={m.name} size={32} />}
                          <div>
                            <div className="font-semibold text-white text-sm">{m?.name ?? '—'}</div>
                            {(a.category || a.weight_class) && (
                              <div className="text-xs text-gray-400">{[a.category, a.weight_class].filter(Boolean).join(' · ')}</div>
                            )}
                          </div>
                          {m && <BeltBadge grade={m.grade} />}
                        </div>

                        {/* Qualifié ? */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {a.qualified === null ? (
                            <>
                              <button onClick={() => handleSingleResult(a.id, true)} disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition">
                                ✓ {t('champ_yes')}
                              </button>
                              <button onClick={() => handleSingleResult(a.id, false)} disabled={pending} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition">
                                ✗ {t('champ_no')}
                              </button>
                            </>
                          ) : (
                            <>
                              <ResultBadge athlete={a} />
                              <button onClick={() => handleSingleResult(a.id, a.qualified!, null)} disabled={pending} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline disabled:opacity-40">
                                {t('champ_modify')}
                              </button>
                            </>
                          )}

                          {/* Place si qualifié */}
                          {a.qualified === true && (
                            <div className="flex gap-1.5 ml-2">
                              {([1, 2, 3] as const).map(p => (
                                <button
                                  key={p}
                                  onClick={() => handleSingleResult(a.id, true, p)}
                                  disabled={pending}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border-2 transition disabled:opacity-40 ${a.place === p ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-700 text-slate-300 hover:border-gray-400'}`}
                                >
                                  {p === 1 ? '🥇' : p === 2 ? '🥈' : '🥉'}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Bouton saisie groupée */}
          {detail.athletes.length > 0 && (
            <button
              onClick={() => setShowBulk(true)}
              className="w-full bg-white/5 text-slate-200 py-3 rounded-full text-sm font-semibold hover:bg-white/10 transition"
            >
              📋 {t('champ_bulk')}
            </button>
          )}

          {/* Podium final */}
          {allResultsEntered && detail && (
            <div className="rounded-2xl border border-white/10 bg-[#10131c] p-6">
              <h3 className="font-bold text-white text-lg mb-5 text-center">🏆 {t('champ_final_ranking')}</h3>
              <div className="space-y-4">
                {([
                  { place: 1, icon: '🥇', label: t('champ_place1'), cls: 'bg-yellow-500/10 border-yellow-500/25' },
                  { place: 2, icon: '🥈', label: t('champ_place2'), cls: 'bg-white/5 border-gray-200 dark:border-gray-700' },
                  { place: 3, icon: '🥉', label: t('champ_place3'), cls: 'bg-amber-600/10 border-amber-600/25' },
                ] as const).map(({ place, icon, label, cls }) => {
                  const winners = detail.athletes.filter(a => a.place === place)
                  if (winners.length === 0) return null
                  return (
                    <div key={place} className={`border rounded-xl px-4 py-3 ${cls}`}>
                      <div className="text-sm font-bold text-slate-200 mb-2">{icon} {label}</div>
                      <div className="flex flex-wrap gap-2">
                        {winners.map(a => (
                          <div key={a.id} className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                            {a.members && <Avatar name={a.members.name} size={20} />}
                            <span className="text-sm font-semibold text-white">{a.members?.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
                {(() => {
                  const qualified = detail.athletes.filter(a => a.qualified && !a.place)
                  return qualified.length > 0 ? (
                    <div className="border rounded-xl px-4 py-3 bg-emerald-500/10 border-emerald-500/25">
                      <div className="text-sm font-bold text-slate-200 mb-2">✓ {t('champ_qualified_nomedal')}</div>
                      <div className="flex flex-wrap gap-2">
                        {qualified.map(a => (
                          <div key={a.id} className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                            {a.members && <Avatar name={a.members.name} size={20} />}
                            <span className="text-sm font-semibold text-white">{a.members?.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}
                {(() => {
                  const notQ = detail.athletes.filter(a => a.qualified === false)
                  return notQ.length > 0 ? (
                    <div className="border rounded-xl px-4 py-3 bg-red-500/10 border-red-500/25">
                      <div className="text-sm font-bold text-slate-200 mb-2">✗ {t('champ_stat_not_qualified')}</div>
                      <div className="flex flex-wrap gap-2">
                        {notQ.map(a => (
                          <div key={a.id} className="flex items-center gap-1.5 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                            {a.members && <Avatar name={a.members.name} size={20} />}
                            <span className="text-sm font-semibold text-white">{a.members?.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null
                })()}
              </div>
            </div>
          )}
        </>
      )}

      {showBulk && detail && (
        <BulkResultModal
          athletes={detail.athletes}
          championshipId={selectedId}
          onClose={() => setShowBulk(false)}
          onSaved={async () => {
            setShowBulk(false)
            onRefresh()
            await loadDetail(selectedId)
          }}
          show={show}
        />
      )}
    </div>
  )
}

// ─── Page principale ───────────────────────────────────────────────────────────

export default function ChampionshipsPage() {
  // Isolation disciplines : Championnats = karaté uniquement
  const blocked = useKarateOnlyGuard()
  if (blocked) return null
  return <ChampionshipsPageInner />
}

function ChampionshipsPageInner() {
  const { t } = useT()
  const [tab, setTab]       = useState<'list' | 'participants' | 'results'>('list')
  const [champs, setChamps] = useState<ChampSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const { toasts, show }    = useToast()

  async function load() {
    setLoading(true)
    const [data, userRes] = await Promise.all([
      getChampionships(),
      createClient().from('profiles').select('role').limit(1).single(),
    ])
    setChamps(data as ChampSummary[])
    setIsAdmin((userRes.data as any)?.role === 'admin')
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function goManage(c: ChampSummary) { setTab('participants') }
  function goResults(c: ChampSummary) { setTab('results') }

  const TABS = [
    { key: 'list',         label: t('champ_tab_list') },
    { key: 'participants', label: t('champ_tab_participants') },
    { key: 'results',      label: t('champ_tab_results') },
  ] as const

  return (
    <div className="max-w-6xl mx-auto">
      {/* En-tête standard + onglets pilule */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black" style={{ color: '#ffffff' }}>{t('nav_championships')}</h1>
          <p className="text-slate-400 mt-0.5">
            {champs.filter(c => c.status !== 'completed').length} {t('champ_active')}
          </p>
        </div>
        <SlidingTabs
          items={TABS.map(t => ({ key: t.key, label: t.label }))}
          value={tab}
          onChange={key => setTab(key as 'list' | 'participants' | 'results')}
        />
      </div>

      <div>
        {loading ? (
          <div className="text-center py-20 text-gray-400">{t('champ_loading')}</div>
        ) : (
          <>
            {tab === 'list' && (
              <TabList
                champs={champs}
                isAdmin={isAdmin}
                onRefresh={load}
                onManage={goManage}
                onResults={goResults}
                show={show}
              />
            )}
            {tab === 'participants' && (
              <TabParticipants champs={champs} show={show} onRefresh={load} />
            )}
            {tab === 'results' && (
              <TabResults champs={champs} show={show} onRefresh={load} />
            )}
          </>
        )}
      </div>

      <ToastContainer toasts={toasts} />
    </div>
  )
}
