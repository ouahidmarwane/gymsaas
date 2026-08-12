'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Wallet, ShieldCheck, Receipt, BarChart3, Settings2, HandCoins, Download,
  type LucideIcon,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'
import SlidingTabs from '@/components/SlidingTabs'
import PopNumber from '@/components/PopNumber'

// Donnees ----------------------------------------------------------------

interface Prices { monthlyCents: number; insuranceCents: number; registrationCents: number }
interface Branch { id: string; name: string; total: number; insured: number }

interface Finance {
  prices: Prices
  chartYear: number
  years: number[]
  branches: Branch[]
  scope: { total: number; insured: number; registrations: number }
  byMonth: Array<{ month: number; counts: Record<string, number> }>
}

interface Payment {
  id: string
  member_name: string | null
  branch_name: string | null
  amount_cents: number
  type: string
  paid_at: string
  notes: string | null
}

const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

const TYPE_LABEL: Record<string, string> = {
  monthly: 'Abonnement', insurance: 'Assurance', registration: 'Inscription', other: 'Autre',
}

const COLORS = { ins: '#9b72ff', reg: '#22c55e', total: '#7ea5ff' }

// Le club definit ses salles ; la palette doit donc en couvrir un nombre
// inconnu. Elle demarre sur le bleu de la marque et boucle au-dela — mieux
// vaut deux salles de la meme teinte que des barres sans couleur.
const BRANCH_COLORS = ['#2f6bff', '#4d8cff', '#9b72ff', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#f43f5e']
const branchColor = (i: number) => BRANCH_COLORS[i % BRANCH_COLORS.length]!

const dh = (cents: number) => `${Math.round(cents / 100).toLocaleString('fr-FR')} DH`

// Briques d'affichage ----------------------------------------------------

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string; icon: LucideIcon; color: string
}) {
  return (
    <div className="compta-kpi-card" style={{ borderLeftColor: color }}>
      <div className="compta-kpi-icon" style={{ background: color + '22', color }}>
        <Icon size={19} strokeWidth={2.1} />
      </div>
      <div className="compta-kpi-body">
        <div className="compta-kpi-label">{label}</div>
        <div className="compta-kpi-value"><PopNumber value={value} /></div>
        {sub && <div className="compta-kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  return (
    <div className="compta-tooltip">
      <div className="compta-tooltip-label">{label}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div key={p.name} className="compta-tooltip-row" style={{ color: p.color }}>
          <span>{p.name}</span>
          <strong>{typeof p.value === 'number' ? p.value.toLocaleString('fr-FR') + ' DH' : p.value}</strong>
        </div>
      ))}
    </div>
  )
}

function ChartCard({ title, subtitle, onExpand, children }: {
  title: string; subtitle: string; onExpand: () => void; children: ReactNode
}) {
  return (
    <div className="compta-chart-card">
      <div className="compta-chart-card-header">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <button className="compta-expand-btn" onClick={onExpand} title="Agrandir" aria-label={`Agrandir : ${title}`}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
            <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
          </svg>
        </button>
      </div>
      {children}
    </div>
  )
}

/** Deux frames avant d'ouvrir : sans cela l'etat initial n'est jamais peint
 *  et la transition d'entree ne joue pas. */
function useOpenAnimation() {
  const [anim, setAnim] = useState<'pre' | 'open'>('pre')
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setAnim('open')))
    return () => cancelAnimationFrame(id)
  }, [])
  return anim === 'open' ? 'is-open' : ''
}

function ExpandModal({ title, subtitle, onClose, children }: {
  title: string; subtitle: string; onClose: () => void; children: ReactNode
}) {
  const open = useOpenAnimation()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="compta-modal-overlay" onClick={onClose}>
      <div className={`t-modal ${open} compta-expand-modal`} role="dialog" aria-modal="true"
           aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="compta-expand-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="compta-expand-close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="compta-expand-modal-body">{children}</div>
      </div>
    </div>
  )
}

// Page -------------------------------------------------------------------

export default function ComptabilitePage() {
  const [me, setMe] = useState<Me | null>(null)
  const [data, setData] = useState<Finance | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [error, setError] = useState<string | null>(null)

  const [branch, setBranch] = useState<string>('all')
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [editPrices, setEditPrices] = useState(false)
  const [draft, setDraft] = useState<Prices>({ monthlyCents: 0, insuranceCents: 0, registrationCents: 0 })
  const [savingPrices, setSavingPrices] = useState(false)
  const [priceError, setPriceError] = useState('')

  useEffect(() => { api.get<Me>('/api/me').then(setMe).catch(() => {}) }, [])

  const load = useCallback(async () => {
    const query = new URLSearchParams()
    if (branch !== 'all') query.set('branchId', branch)
    if (year !== 'all') query.set('year', String(year))
    if (month !== 'all') query.set('month', String(month))
    try {
      const [finance, cash] = await Promise.all([
        api.get<Finance>(`/api/finance?${query}`),
        // Les encaissements suivent l'annee et le mois, jamais la salle : le
        // filtre par salle porte sur l'effectif, pas sur la caisse.
        api.get<{ payments: Payment[] }>(
          `/api/payments?${new URLSearchParams(
            year === 'all' ? {} : month === 'all'
              ? { year: String(year) }
              : { year: String(year), month: String(month + 1) },
          )}`,
        ),
      ])
      setData(finance)
      setPayments(cash.payments)
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setData(null)
    }
  }, [branch, year, month])

  useEffect(() => { load() }, [load])

  const prices = data?.prices ?? { monthlyCents: 10_000, insuranceCents: 5_000, registrationCents: 15_000 }
  const branches = useMemo(() => data?.branches ?? [], [data])
  const scope = data?.scope ?? { total: 0, insured: 0, registrations: 0 }
  const yearLabel = data?.chartYear ?? new Date().getFullYear()

  // Une salle disparue du club ne doit pas laisser un onglet actif orphelin,
  // sinon la page reste bloquee sur un filtre qui ne renvoie plus rien.
  useEffect(() => {
    if (branch !== 'all' && data && !branches.some(b => b.id === branch)) setBranch('all')
  }, [branch, branches, data])

  const shown = useMemo(
    () => branches.filter(b => branch === 'all' || b.id === branch),
    [branches, branch],
  )

  const monthlyTotal = scope.total * prices.monthlyCents
  const insTotal = scope.insured * prices.insuranceCents
  const regTotal = scope.registrations * prices.registrationCents
  const grandTotal = monthlyTotal + insTotal + regTotal

  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount_cents, 0)

  // Series par salle. Recharts indexe par cle, et un identifiant de salle
  // peut contenir n'importe quoi : on prefixe pour ne jamais entrer en
  // collision avec `label`.
  const chartData = useMemo(() => (data?.byMonth ?? []).map(bucket => {
    const row: Record<string, number | string> = { label: MONTHS_FR[bucket.month]! }
    for (const b of branches) {
      const n = bucket.counts[b.id] ?? 0
      row[`r_${b.id}`] = n * (prices.registrationCents / 100)
      row[`n_${b.id}`] = n
    }
    return row
  }), [data, branches, prices.registrationCents])

  const pieData = [
    { name: 'Abonnements', value: Math.round(monthlyTotal / 100), color: COLORS.total },
    { name: 'Assurances', value: Math.round(insTotal / 100), color: COLORS.ins },
    { name: 'Inscriptions', value: Math.round(regTotal / 100), color: COLORS.reg },
  ]

  // La couleur suit le rang de la salle dans le club, pas son rang dans la
  // vue filtree : une salle garde la meme teinte quel que soit l'onglet actif.
  const branchPie = shown.map(b => ({
    name: b.name || 'Sans salle',
    value: b.total,
    color: branchColor(branches.indexOf(b)),
  }))

  // Rendus reutilises tels quels dans la carte et dans la modale agrandie :
  // un seul jeu de series, donc aucune divergence possible entre les deux.
  const barChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false}
               tickFormatter={v => (v > 0 ? `${v / 1000}k` : '0')} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8c95a8', paddingTop: 8 }} />
        {shown.map(b => (
          <Bar key={b.id} dataKey={`r_${b.id}`} name={b.name || 'Sans salle'}
               fill={branchColor(branches.indexOf(b))} radius={[4, 4, 0, 0]} maxBarSize={32} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )

  const lineChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="label" tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}
                 labelStyle={{ color: '#f5f3ef' }} itemStyle={{ color: '#8c95a8' }} />
        <Legend wrapperStyle={{ fontSize: 12, color: '#8c95a8', paddingTop: 8 }} />
        {shown.map(b => (
          <Line key={b.id} type="monotone" dataKey={`n_${b.id}`} name={b.name || 'Sans salle'}
                stroke={branchColor(branches.indexOf(b))} strokeWidth={2}
                dot={{ fill: branchColor(branches.indexOf(b)), r: 3 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )

  const revenuePie = (h: number, inner: number, outer: number) => (
    <>
      <ResponsiveContainer width="100%" height={h}>
        <PieChart>
          <Pie data={pieData} cx="50%" cy="50%" innerRadius={inner} outerRadius={outer} dataKey="value" paddingAngle={3}>
            {pieData.map(e => <Cell key={e.name} fill={e.color} />)}
          </Pie>
          <Tooltip formatter={(v: unknown) => `${Number(v).toLocaleString('fr-FR')} DH`}
                   contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
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
            {branchPie.map(e => <Cell key={e.name} fill={e.color} />)}
          </Pie>
          <Tooltip contentStyle={{ background: '#0e1220', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="compta-legend">
        {branchPie.map(d => (
          <div key={d.name} className="compta-legend-item">
            <span className="compta-legend-dot" style={{ background: d.color }} />
            <span>{d.name}</span>
            <strong>{d.value} membres</strong>
          </div>
        ))}
      </div>
      <div className="compta-branch-detail">
        {branches.map((b, i) => (
          <div key={b.id} className="compta-branch-row">
            <span style={{ color: branchColor(i) }}>{b.name || 'Sans salle'} assurés</span>
            <strong>{b.insured} / {b.total}</strong>
          </div>
        ))}
      </div>
    </>
  )

  /** Export avec BOM : sans lui, Excel massacre les accents. */
  function exportCsv() {
    if (!payments.length) return
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const rows = [
      ['Date', 'Membre', 'Type', 'Montant (DH)', 'Salle', 'Note'].map(esc),
      ...payments.map(p => [
        esc(new Date(p.paid_at).toLocaleDateString('fr-FR')),
        esc(p.member_name ?? ''),
        esc(TYPE_LABEL[p.type] ?? p.type),
        esc((p.amount_cents / 100).toFixed(2)),
        esc(p.branch_name ?? ''),
        esc(p.notes ?? ''),
      ]),
      ['', '', esc('TOTAL'), esc((paymentsTotal / 100).toFixed(2)), '', ''],
    ]
    const csv = rows.map(r => r.join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `comptabilite-${branch === 'all' ? 'global' : branch}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function savePrices() {
    setSavingPrices(true); setPriceError('')
    try {
      await api.put('/api/finance/prices', draft)
      setEditPrices(false)
      await load()
    } catch (e) {
      setPriceError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setSavingPrices(false) }
  }

  const canEditPrices = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin'].includes(me.org?.role ?? ''))
    : false

  const tabs = useMemo(
    () => [{ key: 'all', label: 'Global' }, ...branches.map(b => ({ key: b.id, label: b.name || 'Sans salle' }))],
    [branches],
  )

  const scopeName = branch === 'all'
    ? branches.map(b => b.name || 'Sans salle').join(' & ')
    : (branches.find(b => b.id === branch)?.name ?? '')

  return (
    <EditablePage
      page="comptabilite"
      me={me}
      eyebrow="Comptabilité"
      title="Tableau de bord financier"
      subtitle={scopeName ? `Estimation selon les tarifs configurés · ${scopeName}` : 'Estimation selon les tarifs configurés'}
      actions={
        <div className="compta-filters">
          {tabs.length > 1 && <SlidingTabs items={tabs} value={branch} onChange={setBranch} />}

          <select className="compta-select" aria-label="Année" value={year}
                  onChange={e => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Toutes les années</option>
            {(data?.years ?? [new Date().getFullYear()]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <select className="compta-select" aria-label="Mois" value={month}
                  onChange={e => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Tous les mois</option>
            {MONTHS_FR.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>

          <button className="btn-ghost" onClick={exportCsv} disabled={payments.length === 0}
                  title="Exporter les encaissements filtrés en CSV">
            <Download size={15} strokeWidth={2.2} /> Exporter CSV
          </button>

          {canEditPrices && (
            <button className="btn-dark" style={{ background: 'var(--gold)', borderColor: 'transparent' }}
                    onClick={() => { setDraft(prices); setPriceError(''); setEditPrices(true) }}>
              <Settings2 size={15} strokeWidth={2.2} /> Prix
            </button>
          )}
        </div>
      }
    >
      <PageState error={error} onRetry={load} />

      <div className="compta-shell">
        {/* Ce qui est reellement rentre. Distinct des estimations plus bas :
            l'ecart entre les deux est l'information qui compte. */}
        {payments.length > 0 && (
          <section className="dz-card">
            <div className="dz-card-head">
              <div className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <HandCoins size={17} strokeWidth={2.1} style={{ color: '#4ade80' }} /> Encaissements réels
              </div>
              <div className="dz-card-note" style={{ color: '#4ade80', fontWeight: 800 }}>
                <PopNumber value={dh(paymentsTotal)} />
              </div>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#8c95a8', fontSize: '0.68rem',
                               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Membre</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Type</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => (
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                      <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>{p.member_name ?? '—'}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#8c95a8' }}>{TYPE_LABEL[p.type] ?? p.type}</td>
                      <td style={{ padding: '0.6rem 0.75rem', color: '#8c95a8' }}>
                        {new Date(p.paid_at).toLocaleDateString('fr-FR')}
                      </td>
                      <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right',
                                   color: '#86efac', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {dh(p.amount_cents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Estimations tarifaires */}
        <div className="compta-kpi-grid">
          <KpiCard label="Revenu mensuel" value={dh(monthlyTotal)} icon={Wallet} color="#2f6bff"
                   sub={`${scope.total} membres × ${prices.monthlyCents / 100} DH`} />
          <KpiCard label="Assurances" value={dh(insTotal)} icon={ShieldCheck} color="#9b72ff"
                   sub={`${scope.insured} assurés × ${prices.insuranceCents / 100} DH`} />
          <KpiCard label="Inscriptions" value={dh(regTotal)} icon={Receipt} color="#22c55e"
                   sub={`${scope.registrations} inscriptions × ${prices.registrationCents / 100} DH`} />
          <KpiCard label="Total général" value={dh(grandTotal)} icon={BarChart3} color="#4d8cff"
                   sub="Abonnements + Assurances + Inscriptions" />
        </div>

        <div className="compta-charts-row">
          <ChartCard title={`Inscriptions par mois — ${yearLabel}`}
                     subtitle="Revenus d'inscription (DH) par salle"
                     onExpand={() => setExpanded('bar')}>
            {barChart(240)}
          </ChartCard>
          <ChartCard title="Répartition revenus" subtitle="Par type de revenu"
                     onExpand={() => setExpanded('pie-rev')}>
            {revenuePie(200, 55, 80)}
          </ChartCard>
        </div>

        <div className="compta-charts-row">
          <ChartCard title={`Tendance inscriptions — ${yearLabel}`}
                     subtitle="Nombre de nouveaux membres par mois"
                     onExpand={() => setExpanded('line')}>
            {lineChart(220)}
          </ChartCard>
          <ChartCard title="Membres par salle" subtitle="Répartition totale actuelle"
                     onExpand={() => setExpanded('pie-branch')}>
            {branchPieChart(200, 55, 80)}
          </ChartCard>
        </div>
      </div>

      {expanded === 'bar' && (
        <ExpandModal title={`Inscriptions par mois — ${yearLabel}`} subtitle="Revenus d'inscription (DH) par salle"
                     onClose={() => setExpanded(null)}>{barChart(420)}</ExpandModal>
      )}
      {expanded === 'line' && (
        <ExpandModal title={`Tendance inscriptions — ${yearLabel}`} subtitle="Nombre de nouveaux membres par mois"
                     onClose={() => setExpanded(null)}>{lineChart(420)}</ExpandModal>
      )}
      {expanded === 'pie-rev' && (
        <ExpandModal title="Répartition revenus" subtitle="Par type de revenu"
                     onClose={() => setExpanded(null)}>{revenuePie(380, 90, 140)}</ExpandModal>
      )}
      {expanded === 'pie-branch' && (
        <ExpandModal title="Membres par salle" subtitle="Répartition totale actuelle"
                     onClose={() => setExpanded(null)}>{branchPieChart(380, 90, 140)}</ExpandModal>
      )}

      {editPrices && (
        <PriceModal
          draft={draft} setDraft={setDraft} error={priceError} saving={savingPrices}
          onCancel={() => setEditPrices(false)} onSave={savePrices}
        />
      )}
    </EditablePage>
  )
}

function PriceModal({ draft, setDraft, error, saving, onCancel, onSave }: {
  draft: Prices
  setDraft: (fn: (p: Prices) => Prices) => void
  error: string
  saving: boolean
  onCancel: () => void
  onSave: () => void
}) {
  const open = useOpenAnimation()
  const fields = [
    { key: 'monthlyCents', label: 'Abonnement mensuel (DH)' },
    { key: 'insuranceCents', label: 'Assurance (DH)' },
    { key: 'registrationCents', label: 'Frais d’inscription (DH)' },
  ] as const

  return (
    <div className="compta-modal-overlay" onClick={onCancel}>
      <div className={`t-modal ${open} compta-modal`} role="dialog" aria-modal="true"
           aria-label="Tarifs du club" onClick={e => e.stopPropagation()}>
        <h3 className="compta-modal-title">Tarifs du club</h3>
        <div className="compta-modal-fields">
          {fields.map(({ key, label }) => (
            <label key={key} className="compta-modal-field">
              <span>{label}</span>
              {/* Saisie en dirhams, stockage en centimes : l'arrondi se fait
                  ici plutot que dans la base, ou il serait invisible. */}
              <input type="number" min={0} step="0.01" className="compta-modal-input"
                     value={draft[key] / 100}
                     onChange={e => {
                       const dhValue = Number(e.target.value)
                       setDraft(p => ({ ...p, [key]: Number.isFinite(dhValue) ? Math.round(dhValue * 100) : 0 }))
                     }} />
            </label>
          ))}
        </div>
        {error && (
          <p role="alert" style={{
            borderRadius: 12, background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)', padding: '0.7rem 1rem',
            color: '#fca5a5', fontSize: '0.85rem', marginBottom: 12,
          }}>{error}</p>
        )}
        <div className="compta-modal-actions">
          <button className="compta-modal-cancel" onClick={onCancel}>Annuler</button>
          <button className="compta-modal-save" disabled={saving} onClick={onSave}>
            {saving ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
