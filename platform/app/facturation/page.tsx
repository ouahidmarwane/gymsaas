'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Receipt, Wallet, AlertTriangle, Clock, CheckCircle2, MessageCircle,
  Plus, Settings2, ChevronDown, Undo2, Trash2,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
  PieChart, Pie, Cell,
} from 'recharts'
import { api, ApiError, type Theme } from '@/lib/client'

// Donnees ----------------------------------------------------------------

interface ClubBilling {
  id: string
  name: string
  slug: string
  theme: Theme
  plan: string
  status: string
  price_cents: number | null
  cycle_months: number | null
  phone: string | null
  started_at: string | null
  expires_at: string | null
  notes: string | null
  unpaid_count: number
  unpaid_cents: number
  next_due: string | null
  last_paid_at: string | null
}

interface Invoice {
  id: string
  org_id: string
  org_name: string
  org_slug: string
  phone: string | null
  period_start: string
  period_end: string
  amount_cents: number
  due_date: string
  paid_at: string | null
  method: string | null
  note: string | null
}

interface Payload {
  year: number
  month: number | null
  years: number[]
  clubs: ClubBilling[]
  invoices: Invoice[]
  chart: Array<{ month: number; billed: number; paid: number }>
  today: string
}

const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc']

const dh = (cents: number) => `${Math.round(cents / 100).toLocaleString('fr-FR')} DH`
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '—')

/** Jours restants avant une date, negatif si elle est passee. */
function daysUntil(iso: string | null, today: string): number | null {
  if (!iso) return null
  return Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}

/**
 * Etat d'abonnement d'un club.
 *
 * Calcule a partir de la date de fin, jamais stocke : un statut fige se
 * desynchronise des que le temps passe, une date se compare.
 */
type State = 'expired' | 'renew' | 'soon' | 'active' | 'unset'
const SOON_DAYS = 14

/**
 * Deux facons de n'etre plus couvert, et elles n'appellent pas le meme geste.
 *
 * « Expire » veut dire : une echeance est ouverte et n'a pas ete reglee — on
 * relance le club. « A renouveler » veut dire : tout ce qui a ete facture est
 * paye, mais aucune echeance ne couvre la periode en cours — c'est a nous
 * d'en emettre une.
 *
 * Les confondre affichait « Expire » a un club qui venait de tout regler, et
 * lui reclamait un montant qui n'avait jamais ete facture.
 */
function stateOf(club: ClubBilling, today: string): State {
  if (!club.expires_at) return club.unpaid_cents > 0 ? 'expired' : 'unset'
  const left = daysUntil(club.expires_at, today)!
  if (left < 0) return club.unpaid_cents > 0 ? 'expired' : 'renew'
  return left <= SOON_DAYS ? 'soon' : 'active'
}

const STATE_LABEL: Record<State, string> = {
  expired: 'Expiré · impayé', renew: 'À renouveler', soon: 'Expire bientôt',
  active: 'À jour', unset: 'Pas d’abonnement',
}
const STATE_COLOR: Record<State, string> = {
  expired: '#ef4444', renew: '#38bdf8', soon: '#f59e0b',
  active: '#16a34a', unset: '#64748b',
}

/**
 * Lien WhatsApp « click to chat ».
 *
 * Pas d'envoi automatique : l'API WhatsApp Business demande un compte
 * verifie, des modeles approuves et un cout par message. Le lien ouvre la
 * conversation avec le texte pret, et c'est l'exploitant qui appuie sur
 * envoyer — ce qui vaut relecture avant qu'un client ne recoive une
 * relance fausse.
 */
function waLink(phone: string, message: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`
}

function reminderText(club: ClubBilling, state: State, today: string): string {
  const left = daysUntil(club.expires_at, today)
  // On ne cite un montant que s'il a ete facture. Annoncer le tarif du
  // catalogue a un club qui n'a recu aucune echeance, c'est lui reclamer
  // quelque chose qu'on ne lui a jamais demande.
  const due = club.unpaid_cents > 0 ? ` Montant dû : ${dh(club.unpaid_cents)}.` : ''
  if (state === 'expired') {
    return `Bonjour, l'abonnement GymFlow de ${club.name} a expiré le ${day(club.expires_at)}`
      + ` (${Math.abs(left ?? 0)} jour(s)).${due}`
      + ` Merci de régulariser pour rétablir l'accès.`
  }
  return `Bonjour, l'abonnement GymFlow de ${club.name} arrive à échéance le ${day(club.expires_at)}`
    + ` (dans ${left} jour(s)).${due} Merci de prévoir le renouvellement.`
}

// Page -------------------------------------------------------------------

export default function FacturationPage() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [month, setMonth] = useState<number | 'all'>('all')
  const [editing, setEditing] = useState<ClubBilling | null>(null)
  const [invoicing, setInvoicing] = useState<ClubBilling | null>(null)
  const [shownClubs, setShownClubs] = useState(6)
  const [shownInvoices, setShownInvoices] = useState(6)

  const load = useCallback(async () => {
    const q = new URLSearchParams({ year: String(year) })
    if (month !== 'all') q.set('month', String(month))
    try {
      setData(await api.get<Payload>(`/api/admin/billing?${q}`))
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) router.replace('/dashboard')
      else setError(e instanceof ApiError ? e.message : 'Chargement impossible')
    }
  }, [year, month, router])

  useEffect(() => { load() }, [load])

  async function act(key: string, run: () => Promise<unknown>, done?: string) {
    setBusy(key); setError(null); setNotice(null)
    try { await run(); await load(); if (done) setNotice(done) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action impossible') }
    finally { setBusy(null) }
  }

  const today = data?.today ?? new Date().toISOString().slice(0, 10)
  const clubs = useMemo(() => data?.clubs ?? [], [data])
  const invoices = data?.invoices ?? []

  // Tri par urgence : expire d'abord, puis ce qui va expirer. L'ordre
  // alphabetique enterrerait un impaye au milieu de la liste.
  const RANK: Record<State, number> = { expired: 0, renew: 1, soon: 2, unset: 3, active: 4 }
  const ranked = useMemo(
    () => [...clubs].sort((a, b) =>
      RANK[stateOf(a, today)] - RANK[stateOf(b, today)] || a.name.localeCompare(b.name, 'fr')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clubs, today],
  )

  const counts = ranked.reduce((acc, c) => {
    acc[stateOf(c, today)]++
    return acc
  }, { expired: 0, renew: 0, soon: 0, active: 0, unset: 0 } as Record<State, number>)

  const billed = (data?.chart ?? []).reduce((s, m) => s + m.billed, 0)
  const cashed = (data?.chart ?? []).reduce((s, m) => s + m.paid, 0)
  const outstanding = clubs.reduce((s, c) => s + c.unpaid_cents, 0)

  const chartData = (data?.chart ?? []).map(m => ({
    label: MONTHS[m.month]!,
    'Facturé': Math.round(m.billed / 100),
    'Encaissé': Math.round(m.paid / 100),
  }))

  const pie = (['expired', 'renew', 'soon', 'active', 'unset'] as State[])
    .map(s => ({ name: STATE_LABEL[s], value: counts[s], color: STATE_COLOR[s] }))
    .filter(d => d.value > 0)

  // Tout ce qui demande un geste, quel qu'il soit : relancer un impaye,
  // emettre l'echeance suivante, ou prevenir avant l'expiration.
  const toHandle = ranked.filter(c => ['expired', 'renew', 'soon'].includes(stateOf(c, today)))

  return (
    <div className="dashboard-shell">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                    gap: 16, flexWrap: 'wrap' }}>
        <div>
          <p className="section-heading" style={{ marginBottom: 6 }}>Plateforme</p>
          <h1 className="dz-hello">Facturation</h1>
          <p className="dz-sub">
            {data
              ? `${clubs.length} club(s) · ${counts.active} à jour · ${counts.soon} bientôt · ${counts.expired} expiré(s)`
              : 'Chargement…'}
          </p>
        </div>
        <div className="compta-filters">
          <select className="compta-select" aria-label="Année" value={year}
                  onChange={e => setYear(Number(e.target.value))}>
            {(data?.years ?? [new Date().getFullYear()]).map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="compta-select" aria-label="Mois" value={month}
                  onChange={e => setMonth(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">Tous les mois</option>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </select>
        </div>
      </div>

      <div aria-live="polite">
        {error && <Banner tone="danger">{error}</Banner>}
        {notice && !error && <Banner tone="ok">{notice}</Banner>}
      </div>

      {/* Chiffres de l'annee retenue. */}
      <div className="compta-kpi-grid">
        <Kpi label="Encaissé" value={dh(cashed)} icon={Wallet} color="#16a34a"
             sub={`sur ${dh(billed)} facturés en ${year}`} />
        <Kpi label="Reste à encaisser" value={dh(outstanding)} icon={Clock} color="#f59e0b"
             sub={`${clubs.reduce((s, c) => s + c.unpaid_count, 0)} échéance(s) ouverte(s)`} />
        <Kpi label="Clubs à jour" value={String(counts.active)} icon={CheckCircle2} color="#2f6bff"
             sub={`${counts.unset} sans abonnement défini`} />
        <Kpi label="À traiter" value={String(counts.expired + counts.renew + counts.soon)}
             icon={AlertTriangle} color="#ef4444"
             sub={`${counts.expired} impayé(s), ${counts.renew} à renouveler, ${counts.soon} sous ${SOON_DAYS} j`} />
      </div>

      <div className="compta-charts-row">
        <div className="compta-chart-card">
          <div className="compta-chart-card-header">
            <div>
              <h3>Facturé et encaissé — {year}</h3>
              <p>L&apos;écart entre les deux barres est le retard de paiement</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.18)" />
              <XAxis dataKey="label" tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#8c95a8', fontSize: 11 }} axisLine={false} tickLine={false}
                     tickFormatter={v => (v > 0 ? `${v / 1000}k` : '0')} />
              <Tooltip formatter={(v: unknown) => `${Number(v).toLocaleString('fr-FR')} DH`}
                       contentStyle={{ background: 'var(--surface)', border: '1px solid var(--card-border)',
                                       borderRadius: 10, color: 'var(--text)' }} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#8c95a8', paddingTop: 8 }} />
              <Bar dataKey="Facturé" fill="#4d8cff" radius={[4, 4, 0, 0]} maxBarSize={28} />
              <Bar dataKey="Encaissé" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="compta-chart-card">
          <div className="compta-chart-card-header">
            <div>
              <h3>État des abonnements</h3>
              <p>Situation du jour, tous clubs</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={pie} cx="50%" cy="50%" innerRadius={55} outerRadius={80} dataKey="value" paddingAngle={3}>
                {pie.map(e => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--surface)', border: '1px solid var(--card-border)',
                                       borderRadius: 10, color: 'var(--text)' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="compta-legend">
            {pie.map(d => (
              <div key={d.name} className="compta-legend-item">
                <span className="compta-legend-dot" style={{ background: d.color }} />
                <span>{d.name}</span><strong>{d.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Relances : la raison d'etre de l'ecran. */}
      {toHandle.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <MessageCircle size={17} strokeWidth={2.1} style={{ color: '#25D366' }} />
              À traiter
            </h2>
            <span className="dz-card-note">{toHandle.length} club(s)</span>
          </div>

          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr><th>Club</th><th>Couvert jusqu&apos;au</th><th>Reste</th>
                    <th>Dû</th><th>Situation</th><th>Action</th></tr>
              </thead>
              <tbody>
                {toHandle.map(club => {
                  const state = stateOf(club, today)
                  const left = daysUntil(club.expires_at, today)
                  return (
                    <tr key={club.id}>
                      <td>
                        <div className="gf-table-name">{club.name}</div>
                        <div className="gf-table-sub">{club.slug}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{day(club.expires_at)}</td>
                      <td style={{ whiteSpace: 'nowrap', color: STATE_COLOR[state], fontWeight: 700 }}>
                        {left === null ? '—'
                          : left < 0 ? `${Math.abs(left)} j de retard`
                          : `${left} j`}
                      </td>
                      {/* Un tiret quand rien n'est facture : c'est different de zero. */}
                      <td style={{ fontWeight: 700 }}>
                        {club.unpaid_cents > 0 ? dh(club.unpaid_cents) : '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap', color: STATE_COLOR[state], fontWeight: 700 }}>
                        {STATE_LABEL[state]}
                      </td>
                      <td>
                        {/* Rien n'est du : le geste attendu n'est pas de
                            relancer, c'est d'emettre la periode suivante. */}
                        {state === 'renew' ? (
                          <button className="gf-mini-btn" onClick={() => setInvoicing(club)}
                                  disabled={club.price_cents === null}
                                  style={{ background: 'rgba(56,189,248,0.14)',
                                           borderColor: 'rgba(56,189,248,0.35)', color: '#38bdf8' }}>
                            <Plus size={12} strokeWidth={2.6} /> Créer l’échéance
                          </button>
                        ) : club.phone ? (
                          <a className="gf-mini-btn" data-tone="whatsapp"
                             href={waLink(club.phone, reminderText(club, state, today))}
                             target="_blank" rel="noopener noreferrer">
                            <MessageCircle size={12} strokeWidth={2.4} /> Relancer
                          </a>
                        ) : (
                          <button className="gf-mini-btn" onClick={() => setEditing(club)}>
                            Ajouter un numéro
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="dz-card-note" style={{ marginTop: 12 }}>
            <strong>Expiré · impayé</strong> : une échéance est ouverte, on relance le club.
            <strong> À renouveler</strong> : tout est réglé, mais aucune échéance ne couvre
            la période en cours — c&apos;est à vous d&apos;en émettre une.
            Le lien WhatsApp ouvre la conversation avec le message prérempli ; vous relisez,
            puis vous envoyez.
          </p>
        </section>
      )}

      {/* Abonnements, club par club. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Receipt size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Abonnements
          </h2>
          <span className="dz-card-note">{clubs.length} club(s)</span>
        </div>

        <div className="gf-table-wrap">
          <table className="gf-table">
            <thead>
              <tr>
                <th>Club</th><th>Tarif</th><th>Cycle</th><th>Depuis</th>
                <th>Couvert jusqu&apos;au</th><th>État</th><th>Impayé</th><th>Action</th>
              </tr>
            </thead>
            <tbody>
              {ranked.slice(0, shownClubs).map(club => {
                const state = stateOf(club, today)
                return (
                  <tr key={club.id}>
                    <td>
                      <div className="gf-table-name">{club.name}</div>
                      <div className="gf-table-sub">{club.phone ?? 'sans numéro'}</div>
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {club.price_cents === null ? '—' : dh(club.price_cents)}
                    </td>
                    <td>{club.cycle_months ? `${club.cycle_months} mois` : '—'}</td>
                    <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>{day(club.started_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{day(club.expires_at)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{
                        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                        background: STATE_COLOR[state], marginInlineEnd: 6,
                      }} />
                      <span style={{ color: STATE_COLOR[state], fontWeight: 700 }}>{STATE_LABEL[state]}</span>
                    </td>
                    <td style={{ fontWeight: 700, color: club.unpaid_cents > 0 ? '#f59e0b' : 'var(--muted)' }}>
                      {club.unpaid_cents > 0 ? dh(club.unpaid_cents) : '—'}
                    </td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="gf-mini-btn" onClick={() => setEditing(club)}
                              title="Tarif, cycle, numéro">
                        <Settings2 size={12} strokeWidth={2.4} />
                      </button>
                      <button className="gf-mini-btn" onClick={() => setInvoicing(club)}
                              disabled={club.price_cents === null} title="Nouvelle échéance">
                        <Plus size={12} strokeWidth={2.6} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <Fold total={ranked.length} shown={shownClubs} step={6}
              onMore={() => setShownClubs(n => n + 6)} onReset={() => setShownClubs(6)}
              noun="club" />
      </section>

      {/* Echeances de la periode retenue. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title">Échéances</h2>
          <span className="dz-card-note">
            {month === 'all' ? `année ${year}` : `${MONTHS[month]} ${year}`} · {invoices.length}
          </span>
        </div>

        {invoices.length === 0 ? (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucune échéance sur cette période. Créez-en une depuis la ligne d&apos;un club.
          </p>
        ) : (
          <>
            <div className="gf-table-wrap">
              <table className="gf-table">
                <thead>
                  <tr><th>Club</th><th>Période</th><th>Montant</th><th>Échéance</th>
                      <th>Statut</th><th>Action</th></tr>
                </thead>
                <tbody>
                  {invoices.slice(0, shownInvoices).map(inv => {
                    const late = !inv.paid_at && inv.due_date < today
                    return (
                      <tr key={inv.id}>
                        <td className="gf-table-name">{inv.org_name}</td>
                        <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>
                          {day(inv.period_start)} → {day(inv.period_end)}
                        </td>
                        <td style={{ fontWeight: 700 }}>{dh(inv.amount_cents)}</td>
                        <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>{day(inv.due_date)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          {inv.paid_at ? (
                            <span style={{ color: '#16a34a', fontWeight: 700 }}>
                              Payé le {day(inv.paid_at)}
                            </span>
                          ) : (
                            <span style={{ color: late ? '#ef4444' : '#f59e0b', fontWeight: 700 }}>
                              {late ? 'En retard' : 'À échoir'}
                            </span>
                          )}
                        </td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          {inv.paid_at ? (
                            <button className="gf-mini-btn" disabled={busy !== null}
                                    onClick={() => act(`u-${inv.id}`,
                                      () => api.del(`/api/admin/invoices/${inv.id}/paid`),
                                      'Paiement annulé.')}>
                              <Undo2 size={12} strokeWidth={2.4} /> Annuler
                            </button>
                          ) : (
                            <button className="gf-mini-btn" disabled={busy !== null}
                                    style={{ background: 'rgba(22,163,74,0.15)',
                                             borderColor: 'rgba(22,163,74,0.35)', color: '#4ade80' }}
                                    onClick={() => act(`p-${inv.id}`,
                                      () => api.post(`/api/admin/invoices/${inv.id}/paid`, {}),
                                      `${inv.org_name} : échéance réglée.`)}>
                              <CheckCircle2 size={12} strokeWidth={2.4} /> Marquer payé
                            </button>
                          )}
                          <button className="gf-mini-btn" data-tone="danger" disabled={busy !== null}
                                  title="Supprimer l’échéance"
                                  onClick={() => act(`d-${inv.id}`,
                                    () => api.del(`/api/admin/invoices/${inv.id}`),
                                    'Échéance supprimée.')}>
                            <Trash2 size={12} strokeWidth={2.4} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <Fold total={invoices.length} shown={shownInvoices} step={6}
                  onMore={() => setShownInvoices(n => n + 6)} onReset={() => setShownInvoices(6)}
                  noun="échéance" />
          </>
        )}
      </section>

      {editing && (
        <BillingModal club={editing} onClose={() => setEditing(null)}
                      onSaved={() => { setEditing(null); load(); setNotice('Abonnement enregistré.') }} />
      )}
      {invoicing && (
        <InvoiceModal club={invoicing} today={today} onClose={() => setInvoicing(null)}
                      onSaved={() => { setInvoicing(null); load(); setNotice('Échéance créée.') }} />
      )}
    </div>
  )
}

// Briques ----------------------------------------------------------------

function Banner({ tone, children }: { tone: 'danger' | 'ok'; children: React.ReactNode }) {
  const danger = tone === 'danger'
  return (
    <p role={danger ? 'alert' : 'status'} style={{
      padding: '0.7rem 1rem', borderRadius: 14, fontSize: '0.85rem', fontWeight: 600,
      background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
      border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
      color: danger ? '#fca5a5' : '#6ee7b7',
    }}>{children}</p>
  )
}

function Kpi({ label, value, sub, icon: Icon, color }: {
  label: string; value: string; sub?: string
  icon: typeof Wallet; color: string
}) {
  return (
    <div className="compta-kpi-card" style={{ borderLeftColor: color }}>
      <div className="compta-kpi-icon" style={{ background: color + '22', color }}>
        <Icon size={19} strokeWidth={2.1} />
      </div>
      <div className="compta-kpi-body">
        <div className="compta-kpi-label">{label}</div>
        <div className="compta-kpi-value">{value}</div>
        {sub && <div className="compta-kpi-sub">{sub}</div>}
      </div>
    </div>
  )
}

function Fold({ total, shown, step, onMore, onReset, noun }: {
  total: number; shown: number; step: number
  onMore: () => void; onReset: () => void; noun: string
}) {
  const rest = Math.max(0, total - shown)
  if (rest === 0 && shown <= step) return null
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {rest > 0 && (
        <button className="gf-fold" onClick={onMore}>
          <ChevronDown size={15} strokeWidth={2.4} />
          Afficher {Math.min(step, rest)} de plus
          <span className="gf-fold-rest">{rest} {noun}{rest > 1 ? 's' : ''}</span>
        </button>
      )}
      {shown > step && (
        <button className="gf-fold" onClick={onReset}>
          <ChevronDown size={15} strokeWidth={2.4} data-open="true" /> Réduire
        </button>
      )}
    </div>
  )
}

function BillingModal({ club, onClose, onSaved }: {
  club: ClubBilling; onClose: () => void; onSaved: () => void
}) {
  const [price, setPrice] = useState(String((club.price_cents ?? 0) / 100))
  const [cycle, setCycle] = useState(String(club.cycle_months ?? 1))
  const [phone, setPhone] = useState(club.phone ?? '')
  const [startedAt, setStartedAt] = useState(club.started_at ?? '')
  const [notes, setNotes] = useState(club.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={`Abonnement de ${club.name}`}>
      <div className="compta-modal" style={{ width: 440 }} onClick={e => e.stopPropagation()}>
        <h3 className="compta-modal-title">Abonnement — {club.name}</h3>

        <div className="compta-modal-fields">
          <label className="compta-modal-field">
            <span>Tarif par cycle (DH)</span>
            <input className="compta-modal-input" type="number" min={0} step="0.01"
                   value={price} onChange={e => setPrice(e.target.value)} />
          </label>
          <label className="compta-modal-field">
            <span>Durée du cycle (mois)</span>
            <input className="compta-modal-input" type="number" min={1} max={24}
                   value={cycle} onChange={e => setCycle(e.target.value)} />
          </label>
          <label className="compta-modal-field">
            <span>WhatsApp du responsable</span>
            <input className="compta-modal-input" value={phone} placeholder="212661000001"
                   onChange={e => setPhone(e.target.value)} />
            {/* Format international sans « + » : c'est ce qu'attend wa.me. */}
            <span style={{ fontSize: '0.7rem', fontWeight: 500 }}>
              Indicatif compris, sans le « + ». Exemple : 212661000001
            </span>
          </label>
          <label className="compta-modal-field">
            <span>Client depuis</span>
            <input className="compta-modal-input" type="date"
                   value={startedAt} onChange={e => setStartedAt(e.target.value)} />
          </label>
          <label className="compta-modal-field">
            <span>Note</span>
            <input className="compta-modal-input" value={notes} maxLength={500}
                   onChange={e => setNotes(e.target.value)} />
          </label>
        </div>

        {problem && (
          <p role="alert" style={{
            borderRadius: 12, background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)', padding: '0.7rem 1rem',
            color: '#fca5a5', fontSize: '0.85rem', marginBottom: 12,
          }}>{problem}</p>
        )}

        <div className="compta-modal-actions">
          <button className="compta-modal-cancel" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="compta-modal-save" disabled={busy} onClick={async () => {
            setBusy(true); setProblem(null)
            try {
              await api.put(`/api/admin/billing/${club.id}`, {
                priceCents: Math.round(Number(price) * 100),
                cycleMonths: Number(cycle),
                phone: phone.trim() || null,
                startedAt: startedAt || null,
                expiresAt: club.expires_at,
                notes: notes.trim() || null,
              })
              onSaved()
            } catch (e) {
              setProblem(e instanceof ApiError ? e.message : 'Enregistrement impossible')
              setBusy(false)
            }
          }}>{busy ? '…' : 'Enregistrer'}</button>
        </div>
      </div>
    </div>
  )
}

function InvoiceModal({ club, today, onClose, onSaved }: {
  club: ClubBilling; today: string; onClose: () => void; onSaved: () => void
}) {
  // La periode enchaine sur la couverture actuelle : c'est le cas courant.
  const start = club.expires_at
    ? new Date(Date.parse(`${club.expires_at}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
    : today
  const [periodStart, setPeriodStart] = useState(start)
  const [amount, setAmount] = useState(String((club.price_cents ?? 0) / 100))
  const [dueDate, setDueDate] = useState(start)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div className="compta-modal-overlay" onClick={onClose} role="dialog" aria-modal="true"
         aria-label={`Nouvelle échéance pour ${club.name}`}>
      <div className="compta-modal" style={{ width: 420 }} onClick={e => e.stopPropagation()}>
        <h3 className="compta-modal-title">Nouvelle échéance — {club.name}</h3>
        <p className="dz-card-note" style={{ marginTop: -12, marginBottom: 16 }}>
          Période de {club.cycle_months ?? 1} mois à partir de la date choisie.
        </p>

        <div className="compta-modal-fields">
          <label className="compta-modal-field">
            <span>Début de période</span>
            <input className="compta-modal-input" type="date" value={periodStart}
                   onChange={e => { setPeriodStart(e.target.value); setDueDate(e.target.value) }} />
          </label>
          <label className="compta-modal-field">
            <span>Montant (DH)</span>
            <input className="compta-modal-input" type="number" min={0} step="0.01"
                   value={amount} onChange={e => setAmount(e.target.value)} />
          </label>
          <label className="compta-modal-field">
            <span>Date d’échéance</span>
            <input className="compta-modal-input" type="date" value={dueDate}
                   onChange={e => setDueDate(e.target.value)} />
          </label>
        </div>

        {problem && (
          <p role="alert" style={{
            borderRadius: 12, background: 'rgba(239,68,68,0.12)',
            border: '1px solid rgba(239,68,68,0.25)', padding: '0.7rem 1rem',
            color: '#fca5a5', fontSize: '0.85rem', marginBottom: 12,
          }}>{problem}</p>
        )}

        <div className="compta-modal-actions">
          <button className="compta-modal-cancel" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="compta-modal-save" disabled={busy} onClick={async () => {
            setBusy(true); setProblem(null)
            try {
              await api.post(`/api/admin/billing/${club.id}/invoices`, {
                periodStart,
                amountCents: Math.round(Number(amount) * 100),
                dueDate,
              })
              onSaved()
            } catch (e) {
              setProblem(e instanceof ApiError ? e.message : 'Création impossible')
              setBusy(false)
            }
          }}>{busy ? '…' : 'Créer'}</button>
        </div>
      </div>
    </div>
  )
}
