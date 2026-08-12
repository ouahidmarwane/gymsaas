'use client'

import { useCallback, useEffect, useState } from 'react'
import { Wallet, Download } from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'
import EditablePage from '@/components/EditablePage'

interface Payment {
  id: string
  member_id: string
  member_name: string | null
  branch_name: string | null
  amount_cents: number
  type: string
  paid_at: string
  notes: string | null
}

const TYPE_LABEL: Record<string, string> = {
  monthly: 'Abonnement',
  insurance: 'Assurance',
  registration: 'Inscription',
  other: 'Autre',
}

const dh = (cents: number) => `${(cents / 100).toLocaleString('fr-MA')} DH`
const YEARS = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

export default function ComptabilitePage() {
  const [payments, setPayments] = useState<Payment[] | null>(null)
  const [byMonth, setByMonth] = useState<Array<{ month: string; cents: number }>>([])
  const [byType, setByType] = useState<Array<{ type: string; cents: number }>>([])
  const [year, setYear] = useState<number>(new Date().getFullYear())
  const [month, setMonth] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => { api.get<Me>('/api/me').then(setMe).catch(() => {}) }, [])

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams({ year: String(year) })
      if (month) query.set('month', month)
      const d = await api.get<{
        payments: Payment[]
        byMonth: Array<{ month: string; cents: number }>
        byType: Array<{ type: string; cents: number }>
      }>(`/api/payments?${query}`)
      setPayments(d.payments); setByMonth(d.byMonth); setByType(d.byType); setError(null)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Chargement impossible')
      setPayments([])
    }
  }, [year, month])

  useEffect(() => { load() }, [load])

  const total = payments?.reduce((sum, p) => sum + p.amount_cents, 0) ?? 0
  const maxMonth = Math.max(...byMonth.map(m => m.cents), 1)

  /** Export avec BOM : sans lui, Excel massacre les accents. */
  function exportCsv() {
    if (!payments?.length) return
    const rows = [
      ['Date', 'Membre', 'Type', 'Salle', 'Montant (DH)', 'Note'],
      ...payments.map(p => [
        p.paid_at, p.member_name ?? '', TYPE_LABEL[p.type] ?? p.type,
        p.branch_name ?? '', (p.amount_cents / 100).toFixed(2), p.notes ?? '',
      ]),
      ['', '', '', 'TOTAL', (total / 100).toFixed(2), ''],
    ]
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `encaissements-${year}${month ? `-${month}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <EditablePage
      page="comptabilite"
      me={me}
      title="Comptabilite"
      subtitle="Encaissements reels, en dirhams."
      actions={
        <button className="btn-ghost" onClick={exportCsv} disabled={!payments?.length}>
          <Download size={15} strokeWidth={2.2} /> Exporter en CSV
        </button>
      }
    >

      <PageState error={error} onRetry={load} />

      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Wallet size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Recettes par mois
          </h2>
          <span className="dz-card-note">12 derniers mois</span>
        </div>

        {byMonth.length === 0 ? (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucun encaissement enregistre. Ils apparaissent ici des le premier paiement saisi.
          </p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140, marginTop: 18 }}>
            {byMonth.map(m => (
              <div key={m.month} title={`${m.month} · ${dh(m.cents)}`}
                   style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                            justifyContent: 'flex-end', height: '100%', gap: 6 }}>
                <div style={{
                  width: '100%',
                  height: `${Math.max((m.cents / maxMonth) * 100, 2)}%`,
                  background: 'linear-gradient(180deg, var(--gold), rgba(47,107,255,0.35))',
                  borderRadius: '6px 6px 0 0', minHeight: 3,
                }} />
                <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {byType.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Repartition du mois</h2>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 16 }}>
            {byType.map(t => (
              <div key={t.type} style={{ minWidth: 120 }}>
                <span className="dz-metric-name">{TYPE_LABEL[t.type] ?? t.type}</span>
                <div className="dz-metric-value" style={{ fontSize: '1.3rem', margin: '2px 0 0' }}>
                  {dh(t.cents)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title">Encaissements</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="members-filter-select" value={year} aria-label="Annee"
                    onChange={e => setYear(Number(e.target.value))}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
            <select className="members-filter-select" value={month} aria-label="Mois"
                    onChange={e => setMonth(e.target.value)}>
              <option value="">Toute l&apos;annee</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(m => (
                <option key={m} value={m}>
                  {new Date(2000, Number(m) - 1).toLocaleDateString('fr-FR', { month: 'long' })}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!payments && (
          <div className="members-skeleton-row" style={{ height: 56, border: 'none', borderRadius: 16, marginTop: 16 }} />
        )}

        {payments?.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucun encaissement sur cette periode.
          </p>
        )}

        {payments && payments.length > 0 && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16,
                          maxHeight: 420, overflow: 'auto' }}>
              {payments.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '0.6rem 0.85rem', borderRadius: 14,
                  background: 'rgba(255,255,255,0.04)', fontSize: '0.85rem',
                }}>
                  <span className="dz-card-note" style={{ flex: 'none', width: '5.5rem' }}>
                    {new Date(p.paid_at).toLocaleDateString('fr-FR')}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden',
                                 textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.member_name ?? 'Membre supprime'}
                  </span>
                  <span className="badge" style={{ fontSize: '0.58rem', flex: 'none' }}>
                    {TYPE_LABEL[p.type] ?? p.type}
                  </span>
                  <span style={{ flex: 'none', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {dh(p.amount_cents)}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
              <span className="dz-card-note">{payments.length} encaissement(s)</span>
              <span style={{ fontSize: '1.15rem', fontWeight: 800, letterSpacing: '-0.02em' }}>
                {dh(total)}
              </span>
            </div>
          </>
        )}
      </section>
    </EditablePage>
  )
}
