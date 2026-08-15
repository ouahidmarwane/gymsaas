'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Wallet, ShieldCheck, Receipt, BarChart3, Settings2, HandCoins, Download, Undo2, AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, PieChart, Pie, Cell,
} from 'recharts'
import { api, ApiError, type Me } from '@/lib/client'
import { useScrollLock } from '@/lib/scroll-lock'
import { useModalMotion } from '@/lib/modal-motion'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'
import SlidingTabs from '@/components/SlidingTabs'
import PopNumber from '@/components/PopNumber'
import { toCsv, download } from '@/lib/csv'

// Donnees ----------------------------------------------------------------

interface Prices { monthlyCents: number; insuranceCents: number; registrationCents: number }
interface Branch { id: string; name: string; total: number; insured: number }

interface Finance {
  prices: Prices
  chartYear: number
  month: number | null
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
  method: string | null
  paid_at: string
  notes: string | null
  /** Renseigne quand cette ligne annule une autre : montant negatif. */
  reverses_id: string | null
  reversal_kind: 'erreur' | 'remboursement' | null
  reversal_reason: string | null
}

interface MethodSplit { method: string; cents: number; lines: number }

/** Dette deduite de l'echeance d'abonnement, jamais stockee. */
interface Debtor {
  memberId: string
  name: string
  phone: string
  branchName: string | null
  dueSince: string
  daysLate: number
  monthsLate: number
  amountCents: number
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Espèces', transfer: 'Virement', card: 'Carte', cheque: 'Chèque', inconnu: 'Non précisé',
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

/**
 * Couleurs du theme, resolues en valeurs concretes.
 *
 * Recharts pose ses couleurs en ATTRIBUTS SVG (fill, stroke), et un attribut
 * de presentation n'interprete pas var(--x) : ecrire fill="var(--muted)"
 * donne un axe invisible. On lit donc les variables calculees, et on
 * reprend la lecture quand l'habillage change — sinon les graphiques
 * garderaient les couleurs du theme precedent jusqu'au rechargement.
 */
function useChartInk() {
  const [ink, setInk] = useState({
    muted: '#8c95a8', grid: 'rgba(255,255,255,0.05)',
    surface: '#0e1220', text: '#f5f3ef', border: 'rgba(255,255,255,0.1)',
  })

  useEffect(() => {
    const read = () => {
      const s = getComputedStyle(document.documentElement)
      const pick = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback
      setInk({
        muted: pick('--muted', '#8c95a8'),
        grid: pick('--grid-line', 'rgba(255,255,255,0.05)'),
        surface: pick('--surface', '#0e1220'),
        text: pick('--text', '#f5f3ef'),
        border: pick('--card-border', 'rgba(255,255,255,0.1)'),
      })
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-skin', 'data-theme'],
    })
    return () => observer.disconnect()
  }, [])

  return ink
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

  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss}>
      <div ref={cardRef} className={`t-modal ${open} compta-expand-modal`} role="dialog" aria-modal="true"
           aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="compta-expand-modal-header">
          <div>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button className="compta-expand-close" onClick={dismiss} aria-label="Fermer">✕</button>
        </div>
        <div className="compta-expand-modal-body">{children}</div>
      </div>
    </div>
  )
}

// Page -------------------------------------------------------------------

export default function ComptabilitePage() {
  const ink = useChartInk()
  const [me, setMe] = useState<Me | null>(null)
  const [data, setData] = useState<Finance | null>(null)
  const [payments, setPayments] = useState<Payment[]>([])
  const [byMethod, setByMethod] = useState<MethodSplit[]>([])
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [branch, setBranch] = useState<string>('all')
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  // Periode libre, pour un export qui ne tombe pas sur un mois calendaire.
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reversing, setReversing] = useState<Payment | null>(null)

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
      // Une periode explicite l'emporte sur annee/mois : c'est le geste le
      // plus precis, il ne doit pas etre corrige par le moins precis.
      const cashQuery = new URLSearchParams()
      if (from && to) { cashQuery.set('from', from); cashQuery.set('to', to) }
      else if (year !== 'all') {
        cashQuery.set('year', String(year))
        if (month !== 'all') cashQuery.set('month', String(month + 1))
      }

      const [finance, cash] = await Promise.all([
        api.get<Finance>(`/api/finance?${query}`),
        // Les encaissements suivent la periode, jamais la salle : le filtre
        // par salle porte sur l'effectif, pas sur la caisse.
        api.get<{ payments: Payment[]; byMethod: MethodSplit[]; outstanding: Debtor[] }>(
          `/api/payments?${cashQuery}`,
        ),
      ])
      setData(finance)
      setPayments(cash.payments)
      setByMethod(cash.byMethod ?? [])
      setDebtors(cash.outstanding ?? [])
      setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setData(null)
    }
  }, [branch, year, month, from, to])

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

  // Les annulations portent un montant negatif : une simple somme suffit,
  // aucune requete n'a a se souvenir d'un cas particulier.
  const paymentsTotal = payments.reduce((sum, p) => sum + p.amount_cents, 0)

  // Lignes deja annulees, pour ne pas proposer de les annuler deux fois.
  const reversedIds = useMemo(
    () => new Set(payments.map(p => p.reverses_id).filter((id): id is string => id !== null)),
    [payments],
  )

  /** Écrit l'écriture inverse. La modale a déjà validé le motif et le cas. */
  async function reverse(payment: Payment, input: ReversalInput) {
    setBusy(payment.id); setError(null); setNotice(null)
    try {
      const res = await api.post<{ paidAt: string }>(`/api/payments/${payment.id}/reverse`, input)
      await load()
      setReversing(null)
      setNotice(input.kind === 'erreur'
        ? `Correction enregistrée au ${new Date(res.paidAt).toLocaleDateString('fr-FR')} : ${dh(-payment.amount_cents)}.`
        : `Remboursement enregistré au ${new Date(res.paidAt).toLocaleDateString('fr-FR')} : ${dh(-payment.amount_cents)}.`)
    } catch (e) {
      // L'erreur remonte a la modale, qui reste ouverte : la refermer
      // obligerait a tout resaisir pour lire ce qui n'allait pas.
      throw e instanceof ApiError ? e : new Error('Annulation impossible')
    } finally { setBusy(null) }
  }

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
  // Le graphique reste annuel meme quand un mois est choisi : reduire douze
  // barres a une seule detruit la comparaison, qui est tout l'interet. Le
  // mois retenu ressort, les autres s'effacent — le filtre se voit sans que
  // le graphique cesse d'etre lisible.
  const picked = month === 'all' ? null : month
  const barChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} barGap={4}>
        <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} />
        <XAxis dataKey="label" tick={{ fill: ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: ink.muted, fontSize: 11 }} axisLine={false} tickLine={false}
               tickFormatter={v => (v > 0 ? `${v / 1000}k` : '0')} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: ink.grid }} />
        <Legend wrapperStyle={{ fontSize: 12, color: ink.muted, paddingTop: 8 }} />
        {shown.map(b => {
          const fill = branchColor(branches.indexOf(b))
          return (
            <Bar key={b.id} dataKey={`r_${b.id}`} name={b.name || 'Sans salle'}
                 fill={fill} radius={[4, 4, 0, 0]} maxBarSize={32}>
              {picked !== null && chartData.map((_, i) => (
                <Cell key={i} fill={fill} fillOpacity={i === picked ? 1 : 0.2} />
              ))}
            </Bar>
          )
        })}
      </BarChart>
    </ResponsiveContainer>
  )

  const lineChart = (height: number) => (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke={ink.grid} />
        <XAxis dataKey="label" tick={{ fill: ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fill: ink.muted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ background: ink.surface, border: `1px solid ${ink.border}`, borderRadius: 10, color: ink.text }}
                 labelStyle={{ color: ink.text }} itemStyle={{ color: ink.muted }} />
        <Legend wrapperStyle={{ fontSize: 12, color: ink.muted, paddingTop: 8 }} />
        {shown.map(b => {
          const stroke = branchColor(branches.indexOf(b))
          return (
            <Line key={b.id} type="monotone" dataKey={`n_${b.id}`} name={b.name || 'Sans salle'}
                  stroke={stroke} strokeWidth={2}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  dot={(p: any) => (
                    <circle key={`${b.id}-${p.index}`} cx={p.cx} cy={p.cy}
                            r={picked === p.index ? 5 : 3} fill={stroke}
                            opacity={picked === null || picked === p.index ? 1 : 0.3} />
                  )} />
          )
        })}
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
                   contentStyle={{ background: ink.surface, border: `1px solid ${ink.border}`, borderRadius: 10, color: ink.text }} />
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
          <Tooltip contentStyle={{ background: ink.surface, border: `1px solid ${ink.border}`, borderRadius: 10, color: ink.text }} />
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

  /**
   * Export des encaissements.
   *
   * Le BOM et le desamorcage des formules vivent dans `toCsv` : une note de
   * paiement commencant par « = » s'executerait a l'ouverture du fichier.
   */
  function exportCsv() {
    if (!payments.length) return
    const rows: unknown[][] = [
      ['Date', 'Membre', 'Type', 'Moyen', 'Montant (DH)', 'Salle', 'Annulation', 'Motif', 'Note'],
      ...payments.map(p => [
        new Date(p.paid_at).toLocaleDateString('fr-FR'),
        p.member_name ?? '',
        TYPE_LABEL[p.type] ?? p.type,
        METHOD_LABEL[p.method ?? 'inconnu'] ?? p.method,
        // Les annulations sortent en negatif : la colonne se somme telle
        // quelle dans un tableur, sans retraitement.
        (p.amount_cents / 100).toFixed(2),
        p.branch_name ?? '',
        p.reverses_id ? (p.reversal_kind === 'remboursement' ? 'Remboursement' : 'Correction') : '',
        p.reverses_id ? (p.reversal_reason ?? '') : '',
        p.notes ?? '',
      ]),
      ['', '', '', 'TOTAL', (paymentsTotal / 100).toFixed(2), '', '', '', ''],
    ]
    // Le nom du fichier porte la periode : trois exports dans le meme dossier
    // doivent rester distinguables sans les ouvrir.
    const span = from && to ? `${from}_${to}`
      : year === 'all' ? 'tout'
      : month === 'all' ? String(year)
      : `${year}-${String(month + 1).padStart(2, '0')}`
    download(toCsv(rows), `comptabilite-${branch === 'all' ? 'global' : branch}-${span}.csv`)
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

  const monthNote = picked === null ? '' : ` · ${MONTHS_FR[picked]} en avant`

  // Le sous-titre nomme la periode retenue. Sans lui, un chiffre plus bas que
  // prevu ressemble a une erreur alors que c'est le filtre qui parle.
  const periodLabel = year === 'all'
    ? 'toutes les années'
    : picked === null ? String(year) : `${MONTHS_FR[picked]} ${year}`

  return (
    <EditablePage
      page="comptabilite"
      me={me}
      eyebrow="Comptabilité"
      title="Tableau de bord financier"
      subtitle={`Estimation selon les tarifs configurés · ${periodLabel}${scopeName ? ` · ${scopeName}` : ''}`}
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

          {/* Periode libre : un exercice comptable tombe rarement sur un mois
              calendaire. Renseignee, elle l'emporte sur année/mois. */}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <input type="date" className="compta-select" aria-label="Début de période"
                   value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} />
            <span className="dz-card-note">→</span>
            <input type="date" className="compta-select" aria-label="Fin de période"
                   value={to} min={from || undefined} onChange={e => setTo(e.target.value)} />
            {(from || to) && (
              <button className="gf-mini-btn" onClick={() => { setFrom(''); setTo('') }}
                      title="Revenir au filtre année/mois">✕</button>
            )}
          </span>

          <button className="btn-ghost" onClick={exportCsv} disabled={payments.length === 0}
                  title="Exporter les encaissements de la période en CSV">
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

      <div aria-live="polite">
        {notice && !error && (
          <p role="status" style={{
            padding: '0.7rem 1rem', borderRadius: 14,
            background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(16,185,129,0.3)',
            color: '#6ee7b7', fontSize: '0.85rem', fontWeight: 600,
          }}>{notice}</p>
        )}
      </div>

      <div className="compta-shell">
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

        {/* Ce qui est reellement rentre, sous l'estimation : l'ecart entre
            les deux est l'information qui compte, et on ne le lit que si
            l'estimation a ete vue d'abord. */}
        {payments.length > 0 && (
          <section className="dz-card">
            <div className="dz-card-head">
              <div className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <HandCoins size={17} strokeWidth={2.1} style={{ color: 'var(--positive)' }} /> Encaissements réels
              </div>
              <div className="dz-card-note" style={{ color: 'var(--positive)', fontWeight: 800 }}>
                <PopNumber value={dh(paymentsTotal)} />
              </div>
            </div>
            <div style={{ maxHeight: 260, overflowY: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: '0.68rem',
                               fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Membre</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Type</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Moyen</th>
                    <th style={{ padding: '0.5rem 0.75rem' }}>Date</th>
                    <th style={{ padding: '0.5rem 0.75rem', textAlign: 'right' }}>Montant</th>
                    <th style={{ padding: '0.5rem 0.75rem' }} />
                  </tr>
                </thead>
                <tbody>
                  {payments.map(p => {
                    const reversal = p.reverses_id !== null
                    const cancelled = reversedIds.has(p.id)
                    return (
                      <tr key={p.id} style={{ borderTop: '1px solid var(--hairline)',
                                              opacity: cancelled ? 0.55 : 1 }}>
                        <td style={{ padding: '0.6rem 0.75rem', fontWeight: 600 }}>
                          {p.member_name ?? '—'}
                          {reversal && (
                            <div style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 600 }}>
                              {p.reversal_kind === 'remboursement' ? 'Remboursement' : 'Correction'}
                              {p.reversal_reason ? ` — ${p.reversal_reason}` : ''}
                            </div>
                          )}
                          {cancelled && (
                            <div style={{ fontSize: '0.7rem', color: 'var(--muted)', fontWeight: 600 }}>
                              Annulé
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)' }}>{TYPE_LABEL[p.type] ?? p.type}</td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)' }}>
                          {METHOD_LABEL[p.method ?? 'inconnu'] ?? p.method}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', color: 'var(--muted)' }}>
                          {new Date(p.paid_at).toLocaleDateString('fr-FR')}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem', textAlign: 'right', fontWeight: 700,
                                     fontVariantNumeric: 'tabular-nums',
                                     color: p.amount_cents < 0 ? '#f87171' : 'var(--positive-ink)' }}>
                          {dh(p.amount_cents)}
                        </td>
                        <td style={{ padding: '0.6rem 0.75rem' }}>
                          {/* Corriger, c'est ecrire l'inverse. On ne propose donc
                              rien sur une annulation ni sur une ligne deja annulee. */}
                          {canEditPrices && !reversal && !cancelled && (
                            <button className="gf-mini-btn" data-tone="danger" disabled={busy !== null}
                                    title="Corriger une erreur ou enregistrer un remboursement"
                                    onClick={() => setReversing(p)}>
                              <Undo2 size={12} strokeWidth={2.4} /> Annuler
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Ventilation par moyen : ce qui est en caisse contre ce qui est en
            banque. Un gerant rapproche l'un et l'autre chaque soir. */}
        {byMethod.length > 0 && (
          <section className="dz-card">
            <div className="dz-card-head">
              <h2 className="dz-card-title">Par moyen de paiement</h2>
              <span className="dz-card-note">{periodLabel}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 16 }}>
              {byMethod.map(m => (
                <div key={m.method} style={{ minWidth: 130 }}>
                  <span className="dz-metric-name">{METHOD_LABEL[m.method] ?? m.method}</span>
                  <div className="dz-metric-value" style={{ fontSize: '1.3rem', margin: '2px 0 0' }}>
                    {dh(m.cents)}
                  </div>
                  <span className="dz-card-note">{m.lines} ligne{m.lines > 1 ? 's' : ''}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Impayés : deduits des echeances, jamais stockes. Un abonnement
            renouvele fait disparaitre la ligne de lui-meme. */}
        {debtors.length > 0 && (
          <section className="dz-card">
            <div className="dz-card-head">
              <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <AlertTriangle size={17} strokeWidth={2.1} style={{ color: '#f59e0b' }} />
                Impayés
              </h2>
              <span className="dz-card-note" style={{ color: '#f59e0b', fontWeight: 800 }}>
                {dh(debtors.reduce((s, d) => s + d.amountCents, 0))}
              </span>
            </div>
            <div className="gf-table-wrap">
              <table className="gf-table">
                <thead>
                  <tr><th>Membre</th><th>Salle</th><th>Depuis</th><th>Retard</th><th>Estimation</th></tr>
                </thead>
                <tbody>
                  {debtors.slice(0, 12).map(d => (
                    <tr key={d.memberId}>
                      <td>
                        <div className="gf-table-name">{d.name}</div>
                        <div className="gf-table-sub">{d.phone}</div>
                      </td>
                      <td className="gf-table-sub">{d.branchName ?? '—'}</td>
                      <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>
                        {new Date(d.dueSince).toLocaleDateString('fr-FR')}
                      </td>
                      <td style={{ color: '#f59e0b', fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {d.daysLate} j
                      </td>
                      <td style={{ fontWeight: 700 }}>{dh(d.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="dz-card-note" style={{ marginTop: 12 }}>
              Estimation : {debtors[0] ? debtors[0].monthsLate : 0} mois entamé compte pour un mois
              dû, au tarif en vigueur. Le club ne tient pas de facturier par membre — ce montant
              sert à relancer, pas à comptabiliser.
            </p>
          </section>
        )}

        <div className="compta-charts-row">
          <ChartCard title={`Inscriptions par mois — ${yearLabel}`}
                     subtitle={`Revenus d'inscription (DH) par salle${monthNote}`}
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
                     subtitle={`Nombre de nouveaux membres par mois${monthNote}`}
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

      {reversing && (
        <ReversalModal payment={reversing} onClose={() => setReversing(null)}
                       onConfirm={input => reverse(reversing, input)} />
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

interface ReversalInput { kind: 'erreur' | 'remboursement'; reason: string; refundedAt?: string }

/**
 * Annuler un encaissement : deux gestes, pas un.
 *
 * Le choix ne peut pas etre devine, et il change la date de l'ecriture donc
 * le total d'un mois entier. Il est donc pose en premier, en toutes lettres,
 * avant le motif — c'est la seule decision que l'utilisateur doit vraiment
 * prendre ici.
 */
function ReversalModal({ payment, onClose, onConfirm }: {
  payment: Payment
  onClose: () => void
  onConfirm: (input: ReversalInput) => Promise<void>
}) {
  const open = useOpenAnimation()
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState<'erreur' | 'remboursement'>('erreur')
  const [reason, setReason] = useState('')
  const [refundedAt, setRefundedAt] = useState(today)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const originalDay = new Date(payment.paid_at).toLocaleDateString('fr-FR')
  // Validee ici plutot qu'au retour du serveur : un aller-retour pour
  // apprendre qu'un champ est vide est un aller-retour de trop.
  const ready = reason.trim().length >= 3
    && (kind === 'erreur' || refundedAt >= payment.paid_at.slice(0, 10))

  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onClose)

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss} role="dialog" aria-modal="true"
         aria-label="Annuler un encaissement">
      <div ref={cardRef} className={`t-modal ${open} compta-modal`} style={{ width: 460 }}
           onClick={e => e.stopPropagation()}>
        <h3 className="compta-modal-title">
          Annuler {dh(payment.amount_cents)} — {payment.member_name ?? 'membre supprimé'}
        </h3>
        <p className="dz-card-note" style={{ marginTop: -12, marginBottom: 18 }}>
          Encaissé le {originalDay}. La ligne d’origine est conservée ; une écriture
          inverse est ajoutée.
        </p>

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex',
                           flexDirection: 'column', gap: 8 }}>
          <legend className="compta-modal-field" style={{ marginBottom: 8 }}>
            <span>De quoi s’agit-il ?</span>
          </legend>

          <Choice
            checked={kind === 'erreur'} onChoose={() => setKind('erreur')}
            title="Erreur de saisie"
            body={`Doublon, mauvais montant, mauvais membre. L’écriture est datée du ${originalDay} :
                   cette ligne n’aurait jamais dû exister, le total de ce mois-là l’oublie.`}
          />
          <Choice
            checked={kind === 'remboursement'} onChoose={() => setKind('remboursement')}
            title="Remboursement"
            body="Le membre a réellement payé, et récupère son argent aujourd’hui. L’écriture est
                  datée du jour de la sortie : l’encaissement d’origine reste dans son mois, et le
                  décaissement apparaît dans le sien."
          />
        </fieldset>

        <div className="compta-modal-fields" style={{ marginTop: 18 }}>
          {kind === 'remboursement' && (
            <label className="compta-modal-field">
              <span>Date du remboursement</span>
              <input className="compta-modal-input" type="date" value={refundedAt}
                     min={payment.paid_at.slice(0, 10)} max={today}
                     onChange={e => { setRefundedAt(e.target.value); setProblem(null) }} />
            </label>
          )}
          <label className="compta-modal-field">
            <span>Motif</span>
            <input className="compta-modal-input" value={reason} maxLength={300} autoFocus
                   placeholder={kind === 'erreur' ? 'Ex. doublon de saisie' : 'Ex. abonnement interrompu'}
                   onChange={e => { setReason(e.target.value); setProblem(null) }} />
          </label>
        </div>

        <div aria-live="polite">
          {(problem || (reason.length > 0 && reason.trim().length < 3)) && (
            <p role="alert" style={{
              borderRadius: 12, background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)', padding: '0.7rem 1rem',
              color: '#fca5a5', fontSize: '0.85rem', marginBottom: 12,
            }}>{problem ?? 'Le motif doit faire au moins trois caractères.'}</p>
          )}
        </div>

        <div className="compta-modal-actions">
          <button className="compta-modal-cancel" onClick={dismiss} disabled={busy}>Annuler</button>
          <button className="compta-modal-save" disabled={busy || !ready}
                  style={{ background: '#dc2626' }}
                  onClick={async () => {
                    setBusy(true); setProblem(null)
                    try {
                      await onConfirm({
                        kind, reason: reason.trim(),
                        ...(kind === 'remboursement' ? { refundedAt } : {}),
                      })
                    } catch (e) {
                      setProblem(e instanceof Error ? e.message : 'Annulation impossible')
                    } finally { setBusy(false) }
                  }}>
            {busy ? '…' : kind === 'erreur' ? 'Corriger' : 'Enregistrer le remboursement'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Choice({ checked, onChoose, title, body }: {
  checked: boolean; onChoose: () => void; title: string; body: string
}) {
  return (
    <label style={{
      display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
      padding: '0.75rem 0.9rem', borderRadius: 14,
      background: checked ? 'var(--overlay)' : 'var(--overlay-soft)',
      border: `1px solid ${checked ? 'var(--gold)' : 'var(--hairline)'}`,
    }}>
      <input type="radio" name="reversal-kind" checked={checked} onChange={onChoose}
             style={{ marginTop: 3, accentColor: 'var(--gold)', flex: 'none' }} />
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 700 }}>{title}</span>
        <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--muted)', marginTop: 2 }}>
          {body}
        </span>
      </span>
    </label>
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

  useScrollLock()
  const { dismiss, cardRef, overlayClass } = useModalMotion(onCancel)

  return (
    <div className={`compta-modal-overlay${overlayClass}`} onClick={dismiss}>
      <div ref={cardRef} className={`t-modal ${open} compta-modal`} role="dialog" aria-modal="true"
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
          <button className="compta-modal-cancel" onClick={dismiss}>Annuler</button>
          <button className="compta-modal-save" disabled={saving} onClick={onSave}>
            {saving ? '…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
