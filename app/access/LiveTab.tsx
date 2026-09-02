'use client'

import { ArrowDownRight, ArrowUpRight, Pause, Play } from 'lucide-react'
import { getReasonPresentation, formatDirection } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>

export default function LiveTab({
  liveRows,
  isPaused,
  lastRefreshed,
  onTogglePause,
  onSelectMember,
}: {
  liveRows: AccessRow[]
  isPaused: boolean
  lastRefreshed: Date
  onTogglePause: () => void
  onSelectMember: (memberId: string) => void
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className={styles.filterToolbar}>
        <div className={styles.filterGroup}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={onTogglePause}
            style={{ minHeight: 36 }}
          >
            {isPaused ? <Play size={14} /> : <Pause size={14} />}
            {isPaused ? 'Reprendre le flux' : 'Suspendre le flux'}
          </button>
          <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
            {isPaused ? 'Flux suspendu manuellement' : 'Actualisation automatique toutes les 10 secondes'}
          </span>
        </div>
        <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
          Dernière réception : {lastRefreshed.toLocaleTimeString('fr-FR')}
        </div>
      </div>

      <div className={styles.tableWrap}>
        <table>
          <thead>
            <tr>
              <th>Heure</th>
              <th>Membre</th>
              <th>Direction</th>
              <th>Point d’accès</th>
              <th>Badge / Identifiant</th>
              <th>Décision</th>
              <th>Motif</th>
            </tr>
          </thead>
          <tbody>
            {liveRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
                  En attente du premier passage en direct…
                </td>
              </tr>
            ) : (
              liveRows.map(ev => {
                const isAllow = ev.decision === 'allow'
                const reason = getReasonPresentation(ev.reason_code as string)
                const dir = formatDirection(ev.direction as string)
                return (
                  <tr key={String(ev.id)}>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {ev.occurred_at ? new Date(String(ev.occurred_at)).toLocaleTimeString('fr-FR') : '—'}
                    </td>
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
    </div>
  )
}
