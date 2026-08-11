'use client'
// components/DashboardClient.tsx
// Disposition reprise de la maquette « Activity Planner » (rail + 2 colonnes),
// adaptée aux données réelles du club — aucune fonctionnalité renommée.
import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import GradeBadge from '@/components/GradeBadge'
import SlidingTabs from '@/components/SlidingTabs'
import PopNumber from '@/components/PopNumber'
import { mediaUrl } from '@/lib/media'
import { useT } from '@/lib/i18n'
import { Search, Plus, ArrowUpRight, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'

// Recharts chargé en différé (hors bundle initial du dashboard)
const DashboardCharts = dynamic(() => import('@/components/DashboardCharts'), { ssr: false })
const MetricSpark = dynamic(() => import('@/components/MetricSpark'), { ssr: false })

interface MemberChartData {
  id: string; join_date: string | null; sub_expiry: string | null
  is_insured: boolean; sub_status: string; ins_status: string; branch: string; grade: number | null
  name?: string | null; photo_url?: string | null
}

interface ChampionshipSummary {
  id: string; name: string; date: string; location: string | null; status: string; branch: string | null
}

interface Props {
  today: string
  profileName?: string | null
  canEdit?: boolean
  activeBranch: string
  stats: { total: number; active: number; uninsured: number; notifications: number; renewal: number; grades: number }
  branches: Array<{ key: string; count: number; active: boolean; icon: string }>
  upcomingGrades: any[]
  members: MemberChartData[]
  allMembers: MemberChartData[]
  upcomingChampionships?: ChampionshipSummary[] | null
}

const AVATAR_COLORS = ['#2f6bff', '#4d8cff', '#9b72ff', '#7ea5ff', '#8b5cf6', '#16a34a']

// ─── Mini-courbe de métrique (colonne façon maquette) ────────────────────────
function Metric({ name, value, color, data, rows }: {
  name: string; value: string | number; color: string
  data: Array<{ v: number }>
  rows: Array<{ label: string; val: string | number }>
}) {
  return (
    <div className="dz-metric">
      <div className="dz-metric-chart">
        <MetricSpark data={data} color={color} />
      </div>
      <div className="dz-metric-name">{name}</div>
      <div className="dz-metric-value"><PopNumber value={value} /></div>
      {rows.map(r => (
        <div key={r.label} className="dz-metric-row">
          <span>{r.label}</span>
          <b>{r.val}</b>
        </div>
      ))}
    </div>
  )
}

// ─── Anneau de progression SVG ────────────────────────────────────────────────
function Ring({ pct }: { pct: number }) {
  const R = 52
  const C = 2 * Math.PI * R
  const filled = Math.max(0, Math.min(100, pct)) / 100 * C
  return (
    <div className="dz-ring-wrap">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="rgba(255,255,255,0.09)" strokeWidth="12" />
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--gold)" strokeWidth="12"
          strokeLinecap="round" strokeDasharray={`${filled} ${C - filled}`}
          transform="rotate(-90 64 64)" />
      </svg>
      <div className="dz-ring-val"><PopNumber value={`${Math.round(pct)}%`} /></div>
    </div>
  )
}

// ─── Calendrier pleine couleur ────────────────────────────────────────────────
function BlueCalendar() {
  const [offset, setOffset] = useState(0)
  const now = new Date()
  const view = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const monthLabel = view.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })

  const firstDow = (view.getDay() + 6) % 7 // lundi = 0
  const daysInMonth = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const daysPrev = new Date(view.getFullYear(), view.getMonth(), 0).getDate()

  const cells: Array<{ n: number; out: boolean; today: boolean }> = []
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ n: daysPrev - i, out: true, today: false })
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = offset === 0 && d === now.getDate()
    cells.push({ n: d, out: false, today: isToday })
  }
  while (cells.length % 7 !== 0) cells.push({ n: cells.length % 7, out: true, today: false })
  const trailing = cells.filter(c => c.out && cells.indexOf(c) >= firstDow + daysInMonth)
  trailing.forEach((c, i) => { c.n = i + 1 })

  return (
    <div className="dz-card dz-cal-card">
      <div className="dz-cal-head">
        <span style={{ textTransform: 'capitalize' }}>{monthLabel}</span>
        <div className="dz-cal-nav">
          <button onClick={() => setOffset(o => o - 1)} aria-label="Mois précédent"><ChevronLeft size={16} /></button>
          <button onClick={() => setOffset(o => o + 1)} aria-label="Mois suivant"><ChevronRight size={16} /></button>
        </div>
      </div>
      <div className="dz-cal-grid">
        {['Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa', 'Di'].map(d => <div key={d} className="dz-cal-dow">{d}</div>)}
        {cells.map((c, i) => (
          <div key={i} className={`dz-cal-day${c.out ? ' out' : ''}${c.today ? ' today' : ''}`}>{c.n}</div>
        ))}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardClient({ today, profileName, canEdit = true, activeBranch, stats, branches, upcomingGrades, members, allMembers, upcomingChampionships }: Props) {
  const championships = upcomingChampionships ?? []
  const { t } = useT()
  const [tileTab, setTileTab] = useState<'all' | 'grades' | 'champs'>('all')

  const activeBranchLabel = activeBranch === 'rachad' ? t('branch_rachad') : t('branch_sbata')
  const firstName = profileName?.split(' ')[0]

  // ── Données des mini-courbes (12 derniers mois) ──
  const monthKeys = useMemo(() => {
    const keys: string[] = []
    const d = new Date(); d.setDate(1)
    for (let i = 11; i >= 0; i--) {
      const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
      keys.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
    }
    return keys
  }, [])

  const growthData = useMemo(() => {
    const counts = new Map(monthKeys.map(k => [k, 0]))
    let before = 0
    for (const m of allMembers) {
      if (!m.join_date) continue
      const k = m.join_date.slice(0, 7)
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
      else if (k < monthKeys[0]) before++
    }
    let acc = before
    return monthKeys.map(k => { acc += counts.get(k) ?? 0; return { v: acc } })
  }, [allMembers, monthKeys])

  const newData = useMemo(() => {
    const counts = new Map(monthKeys.map(k => [k, 0]))
    for (const m of allMembers) {
      if (!m.join_date) continue
      const k = m.join_date.slice(0, 7)
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return monthKeys.map(k => ({ v: counts.get(k) ?? 0 }))
  }, [allMembers, monthKeys])

  const newThisMonth = newData[newData.length - 1]?.v ?? 0
  const newTwelveMonths = newData.reduce((s, d) => s + d.v, 0)

  const expiryData = useMemo(() => {
    const counts = new Map(monthKeys.map(k => [k, 0]))
    for (const m of allMembers) {
      if (!m.sub_expiry) continue
      const k = m.sub_expiry.slice(0, 7)
      if (counts.has(k)) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return monthKeys.map(k => ({ v: counts.get(k) ?? 0 }))
  }, [allMembers, monthKeys])

  // ── Derniers membres inscrits (rangée d'avatars) ──
  const recentMembers = useMemo(() =>
    [...members]
      .sort((a, b) => (b.join_date ?? '').localeCompare(a.join_date ?? ''))
      .slice(0, 8),
  [members])

  // ── Assurés / abonnements ──
  const insured = stats.total - stats.uninsured
  const insuredPct = stats.total > 0 ? (insured / stats.total) * 100 : 0
  const activePct = stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0

  // ── Tuiles (grades en attente + championnats) ──
  const tiles = useMemo(() => {
    const g = upcomingGrades.map((m: any) => ({
      kind: 'grade' as const,
      id: `g-${m.id}`,
      name: m.name as string,
      sub: `${t('since_months')} ${m.months_since} ${t('months')}`,
      grade: (m.grade ?? 0) as number,
      href: '/grades',
    }))
    const c = championships.map(ch => ({
      kind: 'champ' as const,
      id: `c-${ch.id}`,
      name: ch.name,
      sub: new Date(ch.date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' }) + (ch.location ? ` · ${ch.location}` : ''),
      grade: null,
      href: '/championships',
    }))
    const list = tileTab === 'grades' ? g : tileTab === 'champs' ? c : [...g, ...c]
    return list.slice(0, 7)
  }, [upcomingGrades, championships, tileTab, t])

  const adminBranches = branches.filter(b => b.count > 0 || branches.some(x => x.count > 0))

  return (
    <div className="dashboard-shell">

      {/* ── Héro : bannière pleine largeur + salutation et actions fusionnées ── */}
      <div className="dz-hero-banner" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards' }}>
        <img src="/banniere-club.webp" alt="Association Sportive Noujoum El Chaouia — Since 1993" className="dz-hero-img" />
        <div className="dz-hero-shade" aria-hidden="true" />
        <div className="dz-hero-content">
          <div>
            <h1 className="dz-hello">
              {firstName ? <>Bonjour, <span>{firstName}</span> !</> : t('dashboard_title')}
            </h1>
            <p className="dz-sub" style={{ textTransform: 'capitalize' }}>{today}</p>
          </div>
          <div className="dz-header-actions">
            <Link href="/members" className="dz-search">
              <Search size={15} strokeWidth={2.2} />
              <span>{t('members_search')}</span>
            </Link>
            {canEdit && (
              <Link href="/members" className="btn-dark" style={{ background: 'var(--gold)' }}>
                <Plus size={16} strokeWidth={2.4} /> {t('members_add')}
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* ── Grille principale façon maquette ── */}
      <div className="dz-grid">

        {/* Colonne gauche */}
        <div className="dz-col">

          {/* Carte métriques (3 mini-courbes) */}
          <section className="dz-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards' }}>
            <div className="dz-card-head">
              <div className="dz-card-title">{t('section_stats')}</div>
              <div className="dz-card-note">{t('chart_growth_sub')}</div>
            </div>
            <div className="dz-metrics">
              <Metric
                name={t('chart_growth_title')}
                value={stats.total}
                color="#2f6bff"
                data={growthData}
                rows={[
                  { label: t('stat_active'), val: stats.active },
                  { label: t('stat_alerts'), val: stats.notifications },
                ]}
              />
              <Metric
                name={t('chart_new_title')}
                value={newThisMonth}
                color="#9b72ff"
                data={newData}
                rows={[
                  { label: t('chart_growth_sub'), val: newTwelveMonths },
                  { label: t('stat_grades'), val: stats.grades },
                ]}
              />
              <Metric
                name={t('chart_sub_title')}
                value={stats.renewal}
                color="#2dd4bf"
                data={expiryData}
                rows={[
                  { label: t('stat_uninsured'), val: stats.uninsured },
                  { label: t('stat_total'), val: stats.total },
                ]}
              />
            </div>
          </section>

          {/* Carte membres (rangée d'avatars, concept « Assigned Leads ») */}
          <section className="dz-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards', animationDelay: '60ms', opacity: 0 }}>
            <div className="dz-card-head">
              <div className="dz-card-title">{t('nav_members')}</div>
              <Link href="/members" className="dz-people-link">{t('activity_view_all')}</Link>
            </div>
            <div className="dz-people-row">
              <Link href="/members" className="dz-person" title={t('members_add')}>
                <span className="dz-person-avatar dz-person-new"><Plus size={22} strokeWidth={2.6} /></span>
                <span className="dz-person-name">Nouveau</span>
              </Link>
              {recentMembers.map(m => (
                <Link key={m.id} href="/members" className="dz-person" title={m.name ?? ''}>
                  {m.photo_url ? (
                    <img src={mediaUrl(m.photo_url) ?? undefined} alt={m.name ?? ''} className="dz-person-avatar" />
                  ) : (
                    <span className="dz-person-avatar" style={{ background: AVATAR_COLORS[(m.name ?? 'A').charCodeAt(0) % AVATAR_COLORS.length] }}>
                      {(m.name ?? '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                  )}
                  <span className="dz-person-name">{(m.name ?? '').split(' ')[0]}</span>
                </Link>
              ))}
            </div>
          </section>

          {/* Carte activités (tuiles) */}
          <section className="dz-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards', animationDelay: '80ms', opacity: 0 }}>
            <div className="dz-card-head">
              <div className="dz-card-title">{t('section_activity')}</div>
              <div className="dz-card-note">
                {stats.grades} {t('stat_grades').toLowerCase()} · {championships.length} {t('nav_championships').toLowerCase()}
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <SlidingTabs
                items={[
                  { key: 'all', label: t('grades_filter_all') },
                  { key: 'grades', label: t('nav_grades') },
                  { key: 'champs', label: t('nav_championships') },
                ]}
                value={tileTab}
                onChange={key => setTileTab(key as 'all' | 'grades' | 'champs')}
              />
            </div>

            <div className="dz-tiles">
              {tiles.map((tile, i) => (
                <Link key={tile.id} href={tile.href} className={`dz-tile${i === 0 ? ' primary' : ''}`}>
                  <div className="dz-tile-top">
                    {tile.kind === 'grade'
                      ? <GradeBadge grade={tile.grade ?? 0} size="sm" />
                      : <span style={{ fontSize: '1.3rem' }}>🏆</span>}
                    <span className="dz-tile-arrow"><ArrowUpRight size={15} strokeWidth={2.4} /></span>
                  </div>
                  <div>
                    <div className="dz-tile-name">{tile.name}</div>
                    <div className="dz-tile-time">{tile.sub}</div>
                  </div>
                </Link>
              ))}
              <Link href="/grades" className="dz-tile dz-tile-add">
                <Plus size={22} strokeWidth={2.2} />
                <span>{t('grades_create')}</span>
              </Link>
            </div>
          </section>
        </div>

        {/* Colonne droite */}
        <div className="dz-col">

          {/* Anneau : assurances */}
          <section className="dz-card dz-ring-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards', animationDelay: '120ms', opacity: 0 }}>
            <div>
              <div className="dz-card-title">{t('chart_ins_title')}</div>
              <div className="dz-ring-goal">
                {insured} / {stats.total} {t('chart_sub_members')}
                <br />
                <span style={{ color: 'var(--text)', fontWeight: 700 }}>{stats.uninsured}</span> {t('stat_uninsured').toLowerCase()}
              </div>
            </div>
            <Ring pct={insuredPct} />
          </section>

          {/* Barre : abonnements actifs */}
          <section className="dz-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards', animationDelay: '180ms', opacity: 0 }}>
            <div className="dz-card-head">
              <div className="dz-card-title">{t('stat_active')}</div>
              <div className="dz-card-note" style={{ color: 'var(--gold)', fontWeight: 700 }}>{activePct}%</div>
            </div>
            <div className="dz-bar-track">
              <div className="dz-bar-fill" style={{ width: `${activePct}%` }} />
            </div>
            <div className="dz-bar-meta">
              <span><b>{stats.active}</b> {t('stat_active').toLowerCase()}</span>
              <span><b>{stats.total}</b> {t('stat_total').toLowerCase()}</span>
            </div>
            {adminBranches.length > 0 && (
              <div className="dz-bar-meta" style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                {branches.map(b => (
                  <span key={b.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={13} style={{ color: b.active ? 'var(--gold)' : 'var(--muted)' }} />
                    {b.key === 'sbata' ? t('branch_sbata') : t('branch_rachad')} <b>{b.count}</b>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Calendrier pleine couleur */}
          <div style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards', animationDelay: '240ms', opacity: 0 }}>
            <BlueCalendar />
          </div>
        </div>
      </div>

      {/* ── Graphiques détaillés (fonctionnalité conservée) ── */}
      <div className="section-heading" style={{ marginTop: 30 }}>
        <span>{t('section_charts')}</span>
        <span className="section-line" />
      </div>
      <DashboardCharts members={members} allMembers={allMembers} activeBranch={activeBranch} />
    </div>
  )
}
