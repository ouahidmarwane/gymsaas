'use client'

import { ArrowDownRight, ArrowUpRight, Download } from 'lucide-react'
import { getReasonPresentation, formatDirection } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>

export default function HistoryTab({
  historyRows,
  historyNext,
  historyBusy,
  search,
  decision,
  direction,
  onSearchChange,
  onDecisionChange,
  onDirectionChange,
  onResetFilters,
  onLoadMore,
  onSelectMember,
  onExportCsv,
}: {
  historyRows: AccessRow[]
  historyNext: string | null
  historyBusy: boolean
  search: string
  decision: string
  direction: string
  onSearchChange: (v: string) => void
  onDecisionChange: (v: string) => void
  onDirectionChange: (v: string) => void
  onResetFilters: () => void
  onLoadMore: () => void
  onSelectMember: (memberId: string) => void
  onExportCsv: () => void
}) {
  const when = (iso: unknown) =>
    typeof iso === 'string'
      ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
      : '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filters Toolbar */}
      <div className={styles.filterToolbar}>
        <div className={styles.filterGroup}>
          <input
            type="search"
            className={styles.filterInput}
            placeholder="Rechercher membre ou badge…"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
          />

          <select className={styles.filterSelect} value={decision} onChange={e => onDecisionChange(e.target.value)}>
            <option value="">Toutes décisions</option>
            <option value="allow">Autorisés uniquement</option>
            <option value="deny">Refusés uniquement</option>
          </select>

          <select className={styles.filterSelect} value={direction} onChange={e => onDirectionChange(e.target.value)}>
            <option value="">Toutes directions</option>
            <option value="entry">Entrées</option>
            <option value="exit">Sorties</option>
          </select>

          {(search || decision || direction) && (
            <button type="button" className={styles.filterResetBtn} onClick={onResetFilters}>
              Réinitialiser
            </button>
          )}
        </div>

        <button
          type="button"
          className={styles.csvExportBtn}
          onClick={onExportCsv}
          title="Exporte uniquement les événements actuellement affichés avec les filtres actifs"
        >
          <Download size={14} /> Exporter les lignes affichées (CSV)
        </button>
      </div>

      {/* History table */}
      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Date & Heure</th>
              <th>Membre</th>
              <th>Direction</th>
              <th>Point d’accès</th>
              <th>Identifiant masqué</th>
              <th>Décision</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                  {historyBusy ? 'Chargement en cours…' : 'Aucun événement correspondant aux critères.'}
                </td>
              </tr>
            ) : (
              historyRows.map(ev => {
                const isAllow = ev.decision === 'allow'
                const reason = getReasonPresentation(ev.reason_code as string)
                const dir = formatDirection(ev.direction as string)
                return (
                  <tr key={String(ev.id)}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{when(ev.occurred_at)}</td>
                    <td>
                      {ev.member_id ? (
                        <button
                          type="button"
                          className={styles.memberTableLink}
                          onClick={() => onSelectMember(String(ev.member_id))}
                        >
                          {ev.member_name || 'Membre'}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--muted)' }}>Inconnu</span>
                      )}
                    </td>
                    <td>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontWeight: 600,
                          color: ev.direction === 'exit' ? 'var(--muted)' : 'var(--positive)',
                        }}
                      >
                        {ev.direction === 'exit' ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                        {dir.label}
                      </span>
                    </td>
                    <td>{ev.access_point_name || ev.access_point_id || '—'}</td>
                    <td>
                      <code style={{ fontSize: '0.7rem', color: 'var(--muted)' }}>
                        {ev.identifier_mask
                          ? `${String(ev.credential_type ?? '').toUpperCase()} · ${ev.identifier_mask}`
                          : '—'}
                      </code>
                    </td>
                    <td>
                      <span className={`${styles.badge} ${isAllow ? styles.badgeSuccess : styles.badgeDanger}`}>
                        {isAllow ? 'Autorisé' : 'Refusé'}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: '0.72rem', color: isAllow ? 'var(--positive)' : 'var(--danger)' }}>
                        {reason.label}
                      </span>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {historyNext && (
        <button
          type="button"
          className={styles.secondaryBtn}
          style={{ margin: '8px auto', display: 'block' }}
          disabled={historyBusy}
          onClick={onLoadMore}
        >
          {historyBusy ? 'Chargement…' : 'Charger la suite des événements'}
        </button>
      )}
    </div>
  )
}
