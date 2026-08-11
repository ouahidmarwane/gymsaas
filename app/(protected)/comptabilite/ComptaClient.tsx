'use client'
import { useState, useMemo, useEffect, ReactNode } from 'react'
import { getPayments, updatePrices } from '@/lib/actions'
import { DEFAULT_PRICES, type Prices } from '@/lib/prices'
import PopNumber from '@/components/PopNumber'
import SlidingTabs from '@/components/SlidingTabs'
import { Wallet, ShieldCheck, Receipt, BarChart3, Settings2, HandCoins, Download, type LucideIcon } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useDiscipline } from '@/lib/discipline-context'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell
} from 'recharts'
import { parseISO, getYear, getMonth } from 'date-fns'

interface Member {
  id: string
  branch: string
  discipline?: string
  join_date: string
  is_insured: boolean
  sub_status: string
  ins_status: string
}

interface Props {
  members: Member[]
  activeBranch: 'sbata' | 'rachad'
  initialPrices?: Prices
}

const MONTHS_FR = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - 4 + i)

const COLORS = {
  sbata:  '#2f6bff',
  rachad: '#4d8cff',
  ins:    '#9b72ff',
  reg:    '#22c55e',
  total:  '#7ea5ff',
}

function KpiCard({ label, value, sub, icon: Icon, color }: { label: string; value: string; sub?: string; icon: LucideIcon; color: string }) {
  return (
    <div className="compta-kpi-card" style={{ borderLeftColor: color }}>
      <div className="compta-kpi-icon" style={{ background: color + '22', color }}><Icon size={19} strokeWidth={2.1} /></div>
      <div className="compta-kpi-body">
        <div className="compta-kpi-label">{label}</div>
        <div className="compta-kpi-value"><PopNumber value={value} /></div>
        {sub && <div className="compta-kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="compta-tooltip">
      <div className="compta-tooltip-label">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="compta-tooltip-row" style={{ color: p.color }}>
          <span>{p.name}</span>
          <strong>{typeof p.value === 'number' ? p.value.toLocaleString('fr-FR') + ' DH' : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

// ── Chart card with expand button ──────────────────────────────
function ChartCard({
  title, subtitle, onExpand, children, wide = false
}: {
  title: string
  subtitle: string
  onExpand: () => void
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={`compta-chart-card${wide ? ' compta-chart-wide' : ''}`}>
      <div className="compta-chart-card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button className="compta-expand-btn" onClick={onExpand} title="Agrandir">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
            <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
        </button>
      </div>
      {children}
    </div>
  )
}

// ── Coquille animée pour la modale des prix ────────────────────
function PriceModalShell({ children }: { children: ReactNode }) {
  const [anim, setAnim] = useState<'pre' | 'open'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className={`t-modal ${anim === 'open' ? 'is-open' : ''} compta-modal`} onClick={e => e.stopPropagation()}>
      {children}
    </div>
  )
}

// ── Expand modal ───────────────────────────────────────────────
function ExpandModal({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: ReactNode
}) {
  const [anim, setAnim] = useState<'pre' | 'open'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div className="compta-modal-overlay" onClick={onClose}>
      <div className={`t-modal ${anim === 'open' ? 'is-open' : ''} compta-expand-modal`} onClick={e => e.stopPropagation()}>
        <div className="compta-expand-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="compta-expand-close" onClick={onClose}>✕</button>
        </div>
        <div className="compta-expand-modal-body">
          {children}
        </div>
      </div>
    </div>
  )
}

export default function ComptaClient({ members, activeBranch, initialPrices }: Props) {
  const [filterYear, setFilterYear]   = useState<number | 'all'>(CURRENT_YEAR)
  const [filterMonth, setFilterMonth] = useState<number | 'all'>('all')
  const [prices, setPrices]           = useState<Prices>(initialPrices ?? DEFAULT_PRICES)
  const [editPrices, setEditPrices]   = useState(false)
  const [draft, setDraft]             = useState<Prices>(initialPrices ?? DEFAULT_PRICES)
  const [savingPrices, setSavingPrices] = useState(false)
  const [priceError, setPriceError]   = useState('')
  const [expanded, setExpanded]       = useState<string | null>(null)
  const [branchFilter, setBranchFilter] = useState<'all' | 'sbata' | 'rachad'>('all')
  const [payments, setPayments] = useState<any[]>([])
  const { t } = useT()
  // Discipline pilotée par le filtre GLOBAL (barre du haut), pas de filtre local
  const { activeDiscipline } = useDiscipline()

  // Filtre discipline appliqué en amont de tous les calculs
  const scopedMembers = useMemo(
    () => activeDiscipline === 'all' ? members : members.filter(m => m.discipline === activeDiscipline),
    [members, activeDiscipline],
  )

  useEffect(() => {
    getPayments({
      branch: branchFilter === 'all' ? undefined : branchFilter,
      discipline: activeDiscipline === 'all' ? undefined : activeDiscipline,
      year: filterYear === 'all' ? undefined : filterYear,
    }).then(p => setPayments(p as any[])).catch(() => setPayments([]))
  }, [branchFilter, activeDiscipline, filterYear])

  const paymentsFiltered = useMemo(() => payments.filter((p: any) => {
    if (filterMonth === 'all') return true
    return new Date(p.paid_at).getMonth() === filterMonth
  }), [payments, filterMonth])
  const paymentsTotal = paymentsFiltered.reduce((sum: number, p: any) => sum + Number(p.amount), 0)

  // ── Export CSV des encaissements filtrés ──
  const TYPE_LABELS: Record<string, string> = {
    monthly: 'Mensuel', insurance: 'Assurance', registration: 'Inscription', other: 'Autre',
  }
  const DISC_LABELS: Record<string, string> = {
    karate: 'Karaté', full_contact: 'Full contact', aerobic: 'Aérobic',
  }
  const escapeCsv = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const handleExportCsv = () => {
    const headers = ['Date', 'Membre', 'Type', 'Montant (DH)', 'Succursale', 'Discipline', 'Notes']
    const rows = paymentsFiltered.map((p: any) => [
      escapeCsv(p.paid_at ? new Date(p.paid_at).toLocaleDateString('fr-FR') : ''),
      escapeCsv(p.members?.name ?? ''),
      escapeCsv(TYPE_LABELS[p.type] ?? p.type ?? ''),
      escapeCsv(Number(p.amount)),
      escapeCsv(p.branch === 'rachad' ? 'Rachad' : p.branch === 'sbata' ? 'Sbata' : ''),
      escapeCsv(p.discipline ? (DISC_LABELS[p.discipline] ?? p.discipline) : ''),
      escapeCsv(p.notes ?? ''),
    ])
    // Ligne de total
    rows.push(['', '', escapeCsv('TOTAL'), escapeCsv(paymentsTotal), '', '', ''])
    const csv = [headers.map(escapeCsv).join(','), ...rows.map(r => r.join(','))].join('\r\n')
    // BOM pour qu'Excel lise correctement les accents
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const scope = `${activeDiscipline === 'all' ? 'toutes' : activeDiscipline}-${branchFilter}`
    link.download = `comptabilite-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Vision globale par défaut ; chaque branche isolable via les pilules
  const sbata  = branchFilter === 'rachad' ? [] : scopedMembers.filter(m => m.branch === 'sbata')
  const rachad = branchFilter === 'sbata' ? [] : scopedMembers.filter(m => m.branch === 'rachad')
  const scoped = branchFilter === 'all' ? scopedMembers : scopedMembers.filter(m => m.branch === branchFilter)

  const filtered = useMemo(() => scoped.filter(m => {
    if (!m.join_date) return false
    const d = parseISO(m.join_date)
    if (filterYear !== 'all' && getYear(d) !== filterYear) return false
    if (filterMonth !== 'all' && getMonth(d) !== filterMonth) return false
    return true
  }), [scoped, filterYear, filterMonth])

  const monthlyData = useMemo(() => {
    const year = filterYear === 'all' ? CURRENT_YEAR : filterYear
    return MONTHS_FR.map((label, i) => {
      const sbataReg  = sbata.filter(m => m.join_date && getYear(parseISO(m.join_date)) === year && getMonth(parseISO(m.join_date)) === i).length
      const rachadReg = rachad.filter(m => m.join_date && getYear(parseISO(m.join_date)) === year && getMonth(parseISO(m.join_date)) === i).length
      return { label, 'Sbata': sbataReg * prices.registration, 'Rachad': rachadReg * prices.registration, sbataReg, rachadReg }
    })
  }, [sbata, rachad, filterYear, prices])

  const totalSbata    = sbata.length
  const totalRachad   = rachad.length
  const insuredSbata  = sbata.filter(m => m.is_insured).length
  const insuredRachad = rachad.filter(m => m.is_insured).length
  const monthlyTotal  = (totalSbata + totalRachad) * prices.monthly
  const insTotal      = (insuredSbata + insuredRachad) * prices.insurance
  const regTotal      = filtered.length * prices.registration
  const grandTotal    = monthlyTotal + insTotal + regTotal

  const pieData = [
    { name: t('pie_subs'), value: monthlyTotal, color: COLORS.total },
    { name: t('pie_ins'),  value: insTotal,     color: COLORS.ins   },
    { name: t('pie_reg'),  value: regTotal,     color: COLORS.reg   },
  ]
  const branchPie = [
    { name: 'Sbata',  value: totalSbata,  color: COLORS.sbata  },
    { name: 'Rachad', value: totalRachad, color: COLORS.rachad },
  ]

  // Chart renderers (reused in card + modal)
  const barChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={monthlyData} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => v > 0 ? `${v/1000}k` : '0'} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8c95a8', paddingTop: 8 }} />
        <Bar dataKey="Sbata"  fill={COLORS.sbata}  radius={[4,4,0,0]} maxBarSize={32} />
        <Bar dataKey="Rachad" fill={COLORS.rachad} radius={[4,4,0,0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )

  const lineChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={monthlyData}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} labelStyle={{ color: '#f5f3ef' }} itemStyle={{ color: '#8c95a8' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8c95a8', paddingTop: 8 }} />
        <Line type="monotone" dataKey="sbataReg"  name="Sbata"  stroke={COLORS.sbata}  strokeWidth={2} dot={{ fill: COLORS.sbata,  r: 3 }} />
        <Line type="monotone" dataKey="rachadReg" name="Rachad" stroke={COLORS.rachad} strokeWidth={2} dot={{ fill: COLORS.rachad, r: 3 }} />
      </LineChart>
    </ResponsiveContainer>
  )

  const revenuePie = (h: number, inner: number, outer: number) => (
    <>
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={inner} outerRadius={outer} dataKey="value" paddingAngle={3}>
            {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Pie>
          <Tooltip formatter={(v: any) => `${Number(v).toLocaleString('fr-FR')} DH`} contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="compta-legend">
        {pieData.map(d => (
          <div key={d.name} className="compta-legend-item">
            <span className="compta-legend-dot" style={{ background: d.color }} />
            <span>{d.name}</span>
            <strong>{d.value.toLocaleString('fr-FR')} DH</strong>
          </div>
        ))}
      </div>
    </>
  )

  const branchPieChart = (h: number, inner: number, outer: number) => (
    <>
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie data={branchPie} cx="50%" cy="50%" innerRadius={inner} outerRadius={outer} dataKey="value" paddingAngle={3}>
            {branchPie.map((e, i) => <Cell key={i} fill={e.color} />)}
          </Pie>
          <Tooltip contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="compta-legend">
        {branchPie.map(d => (
          <div key={d.name} className="compta-legend-item">
            <span className="compta-legend-dot" style={{ background: d.color }} />
            <span>{d.name}</span>
            <strong>{d.value} {t('pie_members')}</strong>
          </div>
        ))}
      </div>
      <div className="compta-branch-detail">
        <div className="compta-branch-row"><span style={{ color: COLORS.sbata }}>{t('branch_sbata')} {t('assured')}</span><strong>{insuredSbata} / {totalSbata}</strong></div>
        <div className="compta-branch-row"><span style={{ color: COLORS.rachad }}>{t('branch_rachad')} {t('assured')}</span><strong>{insuredRachad} / {totalRachad}</strong></div>
      </div>
    </>
  )

  const yearLabel = filterYear === 'all' ? CURRENT_YEAR : filterYear

  return (
    <div className="compta-shell">

      {/* Header */}
      <div className="compta-header">
        <div>
          <p className="section-heading">{t('compta_title')}</p>
          <h1 className="dashboard-title">{t('compta_dashboard')}</h1>
          <p className="dashboard-copy">{t('compta_copy')}</p>
        </div>
        <div className="compta-filters">
          <SlidingTabs
            items={[
              { key: 'all', label: 'Global' },
              { key: 'sbata', label: t('branch_sbata') },
              { key: 'rachad', label: t('branch_rachad') },
            ]}
            value={branchFilter}
            onChange={key => setBranchFilter(key as 'all' | 'sbata' | 'rachad')}
          />
          <select className="compta-select" value={filterYear} onChange={e => setFilterYear(e.target.value === 'all' ? 'all' : +e.target.value)}>
            <option value="all">{t('compta_all_years')}</option>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="compta-select" value={filterMonth} onChange={e => setFilterMonth(e.target.value === 'all' ? 'all' : +e.target.value)}>
            <option value="all">{t('compta_all_months')}</option>
            {MONTHS_FR.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <button
            className="inline-flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors disabled:opacity-40"
            onClick={handleExportCsv}
            disabled={paymentsFiltered.length === 0}
            title="Exporter les encaissements filtrés en CSV"
          >
            <Download size={15} strokeWidth={2.2} /> Exporter CSV
          </button>
          <button
            className="inline-flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full text-sm font-bold transition-colors"
            onClick={() => { setDraft(prices); setEditPrices(true) }}
          >
            <Settings2 size={15} strokeWidth={2.2} /> {t('compta_prices')}
          </button>
        </div>
      </div>

      {/* Encaissements réels */}
      {payments.length > 0 && (
        <section className="dz-card" style={{ marginBottom: 22 }}>
          <div className="dz-card-head">
            <div className="dz-card-title flex items-center gap-2">
              <HandCoins size={17} className="text-emerald-400" /> Encaissements réels
            </div>
            <div className="dz-card-note" style={{ color: '#4ade80', fontWeight: 800 }}>
              <PopNumber value={`${paymentsTotal.toLocaleString('fr-FR')} DH`} />
            </div>
          </div>
          <div className="overflow-x-auto mt-3" style={{ maxHeight: 260, overflowY: 'auto' }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/08 text-left text-xs font-bold text-slate-400 uppercase tracking-wide">
                  <th className="px-3 py-2">{t('col_member')}</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">{t('col_date')}</th>
                  <th className="px-3 py-2 text-right">Montant</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/05">
                {paymentsFiltered.map((p: any) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2.5 text-white font-semibold">{p.members?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-slate-400">
                      {p.type === 'monthly' ? t('price_monthly') : p.type === 'insurance' ? t('price_insurance') : p.type === 'registration' ? t('price_registration') : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-slate-400">{new Date(p.paid_at).toLocaleDateString('fr-FR')}</td>
                    <td className="px-3 py-2.5 text-right text-emerald-300 font-bold">{Number(p.amount).toLocaleString('fr-FR')} DH</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* KPIs (estimations tarifaires) */}
      <div className="compta-kpi-grid">
        <KpiCard label={t('kpi_monthly')}      value={`${monthlyTotal.toLocaleString('fr-FR')} DH`} sub={`${totalSbata + totalRachad} ${t('pie_members')} × ${prices.monthly} DH`}              icon={Wallet} color="#2f6bff" />
        <KpiCard label={t('kpi_insurance')}   value={`${insTotal.toLocaleString('fr-FR')} DH`}     sub={`${insuredSbata + insuredRachad} ${t('assured')} × ${prices.insurance} DH`}         icon={ShieldCheck} color="#9b72ff" />
        <KpiCard label={t('kpi_registration')}value={`${regTotal.toLocaleString('fr-FR')} DH`}     sub={`${filtered.length} ${t('kpi_registration')} × ${prices.registration} DH`}          icon={Receipt} color="#22c55e" />
        <KpiCard label={t('kpi_total')}       value={`${grandTotal.toLocaleString('fr-FR')} DH`}   sub={t('kpi_total_sub')}                                                                  icon={BarChart3} color="#4d8cff" />
      </div>

      {/* Row 1 */}
      <div className="compta-charts-row">
        <ChartCard title={`${t('chart_reg_title')} — ${yearLabel}`} subtitle={t('reg_by_month')} onExpand={() => setExpanded('bar')} wide>
          {barChart(240)}
        </ChartCard>
        <ChartCard title={t('chart_rev_title')} subtitle={t('chart_rev_sub')} onExpand={() => setExpanded('pie-rev')}>
          {revenuePie(200, 55, 80)}
        </ChartCard>
      </div>

      {/* Row 2 */}
      <div className="compta-charts-row">
        <ChartCard title={`${t('chart_trend_title')} — ${yearLabel}`} subtitle={t('chart_trend_sub')} onExpand={() => setExpanded('line')} wide>
          {lineChart(220)}
        </ChartCard>
        <ChartCard title={t('chart_branch_title')} subtitle={t('chart_branch_sub')} onExpand={() => setExpanded('pie-branch')}>
          {branchPieChart(200, 55, 80)}
        </ChartCard>
      </div>

      {/* Expand modals */}
      {expanded === 'bar' && (
        <ExpandModal title={`${t('chart_reg_title')} — ${yearLabel}`} subtitle={t('reg_by_month')} onClose={() => setExpanded(null)}>
          {barChart(420)}
        </ExpandModal>
      )}
      {expanded === 'line' && (
        <ExpandModal title={`${t('chart_trend_title')} — ${yearLabel}`} subtitle={t('chart_trend_sub')} onClose={() => setExpanded(null)}>
          {lineChart(420)}
        </ExpandModal>
      )}
      {expanded === 'pie-rev' && (
        <ExpandModal title={t('chart_rev_title')} subtitle={t('chart_rev_sub')} onClose={() => setExpanded(null)}>
          {revenuePie(380, 90, 140)}
        </ExpandModal>
      )}
      {expanded === 'pie-branch' && (
        <ExpandModal title={t('chart_branch_title')} subtitle={t('chart_branch_sub')} onClose={() => setExpanded(null)}>
          {branchPieChart(380, 90, 140)}
        </ExpandModal>
      )}

      {/* Price editor */}
      {editPrices && (
        <div className="compta-modal-overlay" onClick={() => setEditPrices(false)}>
          <PriceModalShell>
            <h3 className="compta-modal-title">{t('modal_prices_title')}</h3>
            <div className="compta-modal-fields">
              {([
                { key: 'monthly',      labelKey: 'price_monthly'      },
                { key: 'insurance',    labelKey: 'price_insurance'    },
                { key: 'registration', labelKey: 'price_registration' },
              ] as const).map(({ key, labelKey }) => (
                <label key={key} className="compta-modal-field">
                  <span>{t(labelKey)}</span>
                  <input type="number" min={0} value={draft[key]}
                    onChange={e => setDraft(p => ({ ...p, [key]: +e.target.value }))}
                    className="compta-modal-input" />
                </label>
              ))}
            </div>
            {priceError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300 mb-3">
                {priceError}
              </div>
            )}
            <div className="compta-modal-actions">
              <button className="compta-modal-cancel" onClick={() => setEditPrices(false)}>{t('btn_cancel_prices')}</button>
              <button
                className="compta-modal-save"
                disabled={savingPrices}
                onClick={async () => {
                  setSavingPrices(true)
                  setPriceError('')
                  const res = await updatePrices(draft)
                  setSavingPrices(false)
                  if (res?.error) { setPriceError(res.error); return }
                  setPrices(draft)
                  setEditPrices(false)
                }}
              >
                {savingPrices ? '…' : t('btn_save_prices')}
              </button>
            </div>
          </PriceModalShell>
        </div>
      )}
    </div>
  )
}
