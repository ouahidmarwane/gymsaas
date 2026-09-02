'use client'

import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Clock,
  DoorOpen,
  Server,
  ShieldAlert,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { getReasonPresentation, formatDirection } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>

export interface AccessSummary {
  today: {
    totalAttempts: number
    allowedCount: number
    deniedCount: number
    uniqueMembers: number
    deltaAttemptsPct: number
    deltaAllowedPct: number
    deltaDeniedPct: number
    deltaMembersPct: number
  }
  securityBreakdown: {
    deniedTotal: number
    subscriptionExpired: number
    memberInactive: number
    credentialUnknown: number
    credentialLostOrRevoked: number
    infrastructureDenied: number
  }
  hourly: Array<{ hour: string; count: number }>
  topPoints: Array<{ name: string; count: number }>
  infrastructure: {
    gatewaysTotal: number
    gatewaysOnline: number
    gatewaysOffline: number
    devicesTotal: number
    devicesActive: number
  }
}

export default function OverviewTab({
  summary,
  liveRows,
  onSelectMember,
  onNavigateTab,
  onFilterDenial,
}: {
  summary: AccessSummary | null
  liveRows: AccessRow[]
  onSelectMember: (memberId: string) => void
  onNavigateTab: (tab: 'live' | 'history' | 'devices') => void
  onFilterDenial: () => void
}) {
  return (
    <>
      {/* 3 Top Metric Cards */}
      <div className={styles.metricCardsGrid}>
        {/* Card 1: Passages aujourd'hui */}
        <div className={styles.statCard}>
          <div>
            <div className={styles.statCardLabel}>Passages aujourd’hui</div>
            <div className={styles.statCardValue}>
              {summary ? summary.today.allowedCount + summary.today.deniedCount : '—'}
            </div>
            <div className={styles.statCardMeta}>
              {summary && summary.today.deltaAttemptsPct !== 0 ? (
                <span
                  className={`${styles.deltaPill} ${
                    summary.today.deltaAttemptsPct > 0 ? styles.deltaPositive : styles.deltaNegative
                  }`}
                >
                  {summary.today.deltaAttemptsPct > 0 ? '+' : ''}
                  {summary.today.deltaAttemptsPct}%
                </span>
              ) : null}
              <span>{summary ? `${summary.today.allowedCount} autorisés` : 'Chargement…'}</span>
            </div>
          </div>
          <div className={styles.statCardIcon}>
            <DoorOpen size={22} />
          </div>
        </div>

        {/* Card 2: Membres uniques */}
        <div className={styles.statCard}>
          <div>
            <div className={styles.statCardLabel}>Membres uniques</div>
            <div className={styles.statCardValue}>{summary ? summary.today.uniqueMembers : '—'}</div>
            <div className={styles.statCardMeta}>
              {summary && summary.today.deltaMembersPct !== 0 ? (
                <span
                  className={`${styles.deltaPill} ${
                    summary.today.deltaMembersPct > 0 ? styles.deltaPositive : styles.deltaNegative
                  }`}
                >
                  {summary.today.deltaMembersPct > 0 ? '+' : ''}
                  {summary.today.deltaMembersPct}%
                </span>
              ) : null}
              <span>Membres distincts</span>
            </div>
          </div>
          <div className={styles.statCardIcon}>
            <Users size={22} />
          </div>
        </div>

        {/* Card 3: Refusés aujourd'hui */}
        <div className={styles.statCard}>
          <div>
            <div className={styles.statCardLabel}>Refusés aujourd’hui</div>
            <div
              className={styles.statCardValue}
              style={{ color: summary && summary.today.deniedCount > 0 ? 'var(--danger)' : 'var(--text)' }}
            >
              {summary ? summary.today.deniedCount : '—'}
            </div>
            <div className={styles.statCardMeta}>
              {summary && summary.today.deniedCount > 0 ? (
                <span className={`${styles.deltaPill} ${styles.deltaNegative}`}>
                  {summary.today.deniedCount} bloqués
                </span>
              ) : (
                <span className={`${styles.deltaPill} ${styles.deltaPositive}`}>0 incident</span>
              )}
              <span>Tentatives refusées</span>
            </div>
          </div>
          <div className={styles.statCardIcon}>
            <ShieldAlert size={22} />
          </div>
        </div>
      </div>

      {/* 3-Column Main Grid */}
      <div className={styles.overviewMainGrid}>
        {/* Col 1: LIVE ACCESS */}
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <div className={styles.overviewCardTitle}>
              <DoorOpen size={16} /> Flux en direct
            </div>
            <button type="button" className={styles.overviewCardLink} onClick={() => onNavigateTab('live')}>
              Voir tout <ChevronRight size={14} />
            </button>
          </div>
          <div className={styles.overviewCardBody}>
            {liveRows.length === 0 ? (
              <p style={{ fontSize: '0.76rem', color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>
                Aucun passage enregistré pour l’instant.
              </p>
            ) : (
              <div className={styles.streamList}>
                {liveRows.slice(0, 5).map(ev => {
                  const reason = getReasonPresentation(ev.reason_code as string)
                  const dir = formatDirection(ev.direction as string)
                  const isAllow = ev.decision === 'allow'
                  return (
                    <div key={String(ev.id)} className={styles.streamRow}>
                      <div className={styles.streamRowLeft}>
                        <div
                          className={styles.streamDirIcon}
                          style={{
                            background: isAllow ? 'var(--positive-bg)' : 'var(--danger-bg)',
                            color: isAllow ? 'var(--positive)' : 'var(--danger)',
                          }}
                        >
                          {ev.direction === 'exit' ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
                        </div>
                        <div>
                          {ev.member_id ? (
                            <button
                              type="button"
                              className={styles.streamMemberBtn}
                              onClick={() => onSelectMember(String(ev.member_id))}
                            >
                              {ev.member_name || 'Membre sans nom'}
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted)' }}>
                              Badge non associé
                            </span>
                          )}
                          <div className={styles.streamSubtext}>
                            <span>{dir.label}</span>
                            <span>·</span>
                            <span>{ev.access_point_name || 'Point d’accès'}</span>
                          </div>
                        </div>
                      </div>
                      <div className={styles.streamRowRight}>
                        <span className={`${styles.badge} ${isAllow ? styles.badgeSuccess : styles.badgeDanger}`}>
                          {isAllow ? 'Autorisé' : reason.label}
                        </span>
                        <span style={{ fontSize: '0.64rem', color: 'var(--muted)' }}>
                          {ev.occurred_at ? new Date(String(ev.occurred_at)).toLocaleTimeString('fr-FR') : ''}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Col 2: ACCESS HISTORY (Compact table) */}
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <div className={styles.overviewCardTitle}>
              <Clock size={16} /> Derniers passages
            </div>
            <button type="button" className={styles.overviewCardLink} onClick={() => onNavigateTab('history')}>
              Historique complet <ChevronRight size={14} />
            </button>
          </div>
          <div className={styles.overviewCardBody} style={{ padding: 0 }}>
            {liveRows.length === 0 ? (
              <p style={{ fontSize: '0.76rem', color: 'var(--muted)', textAlign: 'center', padding: '24px 0' }}>
                Aucun historique récent.
              </p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.74rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--overlay-soft)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--muted)', fontWeight: 700 }}>
                      Membre
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'left', color: 'var(--muted)', fontWeight: 700 }}>
                      Point
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)', fontWeight: 700 }}>
                      Heure
                    </th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', color: 'var(--muted)', fontWeight: 700 }}>
                      État
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {liveRows.slice(0, 5).map(ev => {
                    const isAllow = ev.decision === 'allow'
                    return (
                      <tr key={String(ev.id)} style={{ borderBottom: '1px solid var(--hairline)' }}>
                        <td style={{ padding: '10px 12px' }}>
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
                        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                          {ev.access_point_name || 'Point d’accès'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--muted)' }}>
                          {ev.occurred_at ? new Date(String(ev.occurred_at)).toLocaleTimeString('fr-FR') : ''}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          <span className={`${styles.badge} ${isAllow ? styles.badgeSuccess : styles.badgeDanger}`}>
                            {isAllow ? 'OK' : 'Refus'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Col 3: INFRASTRUCTURE & SECURITY EVENTS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Infrastructure mini card */}
          <div className={styles.overviewCard}>
            <div className={styles.overviewCardHeader}>
              <div className={styles.overviewCardTitle}>
                <Server size={16} /> Infrastructure
              </div>
              <button type="button" className={styles.overviewCardLink} onClick={() => onNavigateTab('devices')}>
                Gérer <ChevronRight size={14} />
              </button>
            </div>
            <div className={styles.overviewCardBody}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--overlay-soft)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '0.64rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Passerelles
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                    {summary?.infrastructure.gatewaysOnline ?? 0}
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>
                      /{summary?.infrastructure.gatewaysTotal ?? 0}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--positive)', marginTop: 2, fontWeight: 600 }}>
                    En ligne
                  </div>
                </div>
                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--overlay-soft)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '0.64rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Équipements
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                    {summary?.infrastructure.devicesActive ?? 0}
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted)', fontWeight: 600 }}>
                      /{summary?.infrastructure.devicesTotal ?? 0}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.64rem', color: 'var(--muted)', marginTop: 2, fontWeight: 600 }}>
                    Opérationnels
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Security breakdown card */}
          <div className={styles.overviewCard}>
            <div className={styles.overviewCardHeader}>
              <div className={styles.overviewCardTitle}>
                <ShieldAlert size={16} /> Motifs de refus (aujourd’hui)
              </div>
            </div>
            <div className={styles.overviewCardBody}>
              {summary && summary.today.deniedCount === 0 ? (
                <div style={{ textAlign: 'center', padding: '16px 0', color: 'var(--positive)', fontSize: '0.75rem' }}>
                  <ShieldCheck size={28} style={{ margin: '0 auto 6px', display: 'block' }} />
                  Aucun refus aujourd’hui.
                </div>
              ) : (
                <div className={styles.securityBreakdownList}>
                  <div className={styles.securityBreakdownItem} onClick={onFilterDenial}>
                    <span>Abonnements expirés</span>
                    <span
                      className={styles.securityBreakdownCount}
                      style={{
                        background:
                          summary && summary.securityBreakdown.subscriptionExpired > 0
                            ? 'var(--danger-bg)'
                            : 'var(--overlay-soft)',
                        color:
                          summary && summary.securityBreakdown.subscriptionExpired > 0
                            ? 'var(--danger)'
                            : 'var(--muted)',
                      }}
                    >
                      {summary?.securityBreakdown.subscriptionExpired ?? 0}
                    </span>
                  </div>
                  <div className={styles.securityBreakdownItem} onClick={onFilterDenial}>
                    <span>Membres inactifs / suspendus</span>
                    <span
                      className={styles.securityBreakdownCount}
                      style={{
                        background:
                          summary && summary.securityBreakdown.memberInactive > 0
                            ? 'var(--danger-bg)'
                            : 'var(--overlay-soft)',
                        color:
                          summary && summary.securityBreakdown.memberInactive > 0
                            ? 'var(--danger)'
                            : 'var(--muted)',
                      }}
                    >
                      {summary?.securityBreakdown.memberInactive ?? 0}
                    </span>
                  </div>
                  <div className={styles.securityBreakdownItem} onClick={onFilterDenial}>
                    <span>Badges non reconnus</span>
                    <span
                      className={styles.securityBreakdownCount}
                      style={{
                        background:
                          summary && summary.securityBreakdown.credentialUnknown > 0
                            ? 'var(--warning-bg)'
                            : 'var(--overlay-soft)',
                        color:
                          summary && summary.securityBreakdown.credentialUnknown > 0
                            ? 'var(--warning)'
                            : 'var(--muted)',
                      }}
                    >
                      {summary?.securityBreakdown.credentialUnknown ?? 0}
                    </span>
                  </div>
                  <div className={styles.securityBreakdownItem} onClick={onFilterDenial}>
                    <span>Badges déclarés perdus ou révoqués</span>
                    <span
                      className={styles.securityBreakdownCount}
                      style={{
                        background:
                          summary && summary.securityBreakdown.credentialLostOrRevoked > 0
                            ? 'var(--danger-bg)'
                            : 'var(--overlay-soft)',
                        color:
                          summary && summary.securityBreakdown.credentialLostOrRevoked > 0
                            ? 'var(--danger)'
                            : 'var(--muted)',
                      }}
                    >
                      {summary?.securityBreakdown.credentialLostOrRevoked ?? 0}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Analytics Row */}
      <div className={styles.analyticsRow}>
        {/* Chart 1: Passages par heure */}
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <div className={styles.overviewCardTitle}>
              <Activity size={16} /> Passages par heure
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Aujourd’hui</span>
          </div>
          <div className={styles.overviewCardBody}>
            {summary && summary.hourly.length > 0 ? (
              <div className={styles.hourlyChartWrap}>
                {summary.hourly.map(item => {
                  const maxVal = Math.max(...summary.hourly.map(h => h.count), 1)
                  const pct = Math.round((item.count / maxVal) * 100)
                  return (
                    <div key={item.hour} className={styles.hourlyBarCol}>
                      <div className={styles.hourlyBarTrack} title={`${item.hour}h : ${item.count} passages`}>
                        <div className={styles.hourlyBarFill} style={{ height: `${pct}%` }} />
                      </div>
                      <span className={styles.hourlyBarLabel}>{item.hour}h</span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: '0.74rem' }}>
                Aucune donnée horaire pour l’instant.
              </div>
            )}
          </div>
        </div>

        {/* Chart 2: Top Points d'accès */}
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <div className={styles.overviewCardTitle}>
              <DoorOpen size={16} /> Top Points d’accès
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Volume</span>
          </div>
          <div className={styles.overviewCardBody}>
            {summary && summary.topPoints.length > 0 ? (
              <div className={styles.rankingList}>
                {summary.topPoints.map(p => {
                  const maxPoint = Math.max(...summary.topPoints.map(x => x.count), 1)
                  const pct = Math.round((p.count / maxPoint) * 100)
                  return (
                    <div key={p.name} className={styles.rankingItem}>
                      <div className={styles.rankingHead}>
                        <span className={styles.rankingName}>{p.name}</span>
                        <span className={styles.rankingCount}>{p.count}</span>
                      </div>
                      <div className={styles.rankingTrack}>
                        <div className={styles.rankingProgress} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: '0.74rem' }}>
                Aucun passage enregistré aujourd’hui.
              </div>
            )}
          </div>
        </div>

        {/* Chart 3: Ratio Décisions */}
        <div className={styles.overviewCard}>
          <div className={styles.overviewCardHeader}>
            <div className={styles.overviewCardTitle}>
              <ShieldCheck size={16} /> Décisions
            </div>
            <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Taux d’acceptation</span>
          </div>
          <div className={styles.overviewCardBody}>
            {summary && summary.today.totalAttempts > 0 ? (
              <div className={styles.donutWrap}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--positive)', lineHeight: 1 }}>
                    {Math.round((summary.today.allowedCount / summary.today.totalAttempts) * 100)}%
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--muted)' }}>Taux d’autorisation</span>
                </div>

                <div className={styles.donutLegend}>
                  <div className={styles.donutLegendItem}>
                    <span className={styles.donutLegendDot} style={{ background: 'var(--positive)' }} />
                    <span>{summary.today.allowedCount} Autorisés</span>
                  </div>
                  <div className={styles.donutLegendItem}>
                    <span className={styles.donutLegendDot} style={{ background: 'var(--danger)' }} />
                    <span>{summary.today.deniedCount} Refusés</span>
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--muted)', fontSize: '0.74rem' }}>
                Aucune décision évaluée aujourd’hui.
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
