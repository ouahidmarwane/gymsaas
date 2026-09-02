'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, Clock, HelpCircle, User, X } from 'lucide-react'
import { api } from '@/lib/client'
import { getReasonPresentation, formatDirection } from '@/src/access-reasons'
import styles from './access.module.css'

type AccessRow = Record<string, string | number | null>

export default function MemberAccessDrawer({
  memberId,
  onClose,
  onOpenFullDetail,
}: {
  memberId: string
  onClose: () => void
  onOpenFullDetail: (id: string) => void
}) {
  const [member, setMember] = useState<any | null>(null)
  const [events, setEvents] = useState<AccessRow[]>([])
  const [credentials, setCredentials] = useState<AccessRow[]>([])
  const [summary, setSummary] = useState<{ visitsLast30Days: number; averageVisitsPerWeek: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showDisclaimer, setShowDisclaimer] = useState(false)

  useEffect(() => {
    async function fetchMemberAccess() {
      setLoading(true)
      try {
        const [memRes, evRes, credRes, sumRes] = await Promise.all([
          api.get<{ member: any }>(`/api/members/${memberId}`),
          api.get<{ items: AccessRow[] }>(`/api/access/events?memberId=${memberId}&limit=10`),
          api.get<{ items: AccessRow[] }>(`/api/access/credentials?memberId=${memberId}&limit=20`),
          api.get<{ visitsLast30Days: number; averageVisitsPerWeek: number }>(`/api/access/members/${memberId}/summary`).catch(() => null),
        ])
        setMember(memRes.member)
        setEvents(evRes.items)
        setCredentials(credRes.items)
        setSummary(sumRes)
      } catch (err) {
        console.error('Erreur chargement profil membre access', err)
      } finally {
        setLoading(false)
      }
    }
    void fetchMemberAccess()
  }, [memberId])

  const latest = events[0] ?? null
  const isEstimatedInside = latest?.decision === 'allow' && (latest.direction === 'entry' || !latest.direction)

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div className={styles.drawerPanel} onClick={e => e.stopPropagation()}>
        <div className={styles.drawerHeader}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <User size={18} />
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Historique de passage membre</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.drawerBody}>
          {loading ? (
            <p style={{ textAlign: 'center', color: 'var(--muted)', padding: 30 }}>Chargement des données membre…</p>
          ) : member ? (
            <>
              {/* Identity card */}
              <div className={styles.memberIdentityCard}>
                <div className={styles.memberAvatarCircle}>
                  {member.name ? member.name.charAt(0).toUpperCase() : 'M'}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text)' }}>{member.name}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
                    {member.phone} · {member.branch_name || 'Salle principale'}
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                    <span
                      className={`${styles.badge} ${
                        member.status === 'active' ? styles.badgeSuccess : styles.badgeDanger
                      }`}
                    >
                      {member.status === 'active' ? 'Membre actif' : 'Membre inactif'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Estimated presence */}
              <div
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  background: 'var(--overlay-soft)',
                  border: '1px solid var(--border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  fontSize: '0.74rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: isEstimatedInside ? 'var(--positive)' : 'var(--muted)',
                    }}
                  />
                  <span>
                    Présence estimée :{' '}
                    <strong style={{ color: isEstimatedInside ? 'var(--positive)' : 'var(--muted)' }}>
                      {isEstimatedInside ? 'En salle' : 'Hors salle'}
                    </strong>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDisclaimer(s => !s)}
                  title="Détails"
                  style={{ background: 'none', border: 0, color: 'var(--muted)', cursor: 'pointer', display: 'flex' }}
                >
                  <HelpCircle size={14} />
                </button>
              </div>

              {showDisclaimer && (
                <div
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'var(--overlay-soft)',
                    color: 'var(--muted)',
                    fontSize: '0.67rem',
                    lineHeight: 1.4,
                  }}
                >
                  Estimation basée sur les événements d’accès récents. La présence physique exacte nécessite des capteurs
                  physiques de passage.
                </div>
              )}

              {/* 30-day metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div
                  style={{
                    padding: '10px',
                    borderRadius: 10,
                    background: 'var(--overlay-soft)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '0.64rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Visites (30 jours)
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                    {summary?.visitsLast30Days ?? 0}
                  </div>
                </div>
                <div
                  style={{
                    padding: '10px',
                    borderRadius: 10,
                    background: 'var(--overlay-soft)',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div style={{ fontSize: '0.64rem', color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>
                    Moyenne / semaine
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text)', marginTop: 2 }}>
                    ~{summary?.averageVisitsPerWeek ?? 0}
                  </div>
                </div>
              </div>

              {/* Action to view full profile */}
              <button
                type="button"
                className={styles.primaryBtn}
                style={{ width: '100%', minHeight: 42 }}
                onClick={() => onOpenFullDetail(member.id)}
              >
                Voir le profil complet du membre <ChevronRight size={15} />
              </button>

              {/* Registered badges */}
              <div>
                <div className={styles.formLabel} style={{ marginBottom: 6 }}>
                  Badges & Identifiants
                </div>
                {credentials.length === 0 ? (
                  <p style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Aucun badge enregistré.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {credentials.map(c => (
                      <div
                        key={String(c.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: 'var(--overlay-soft)',
                          fontSize: '0.74rem',
                        }}
                      >
                        <code>
                          {String(c.type).toUpperCase()} · {c.identifier_mask}
                        </code>
                        <span
                          className={`${styles.badge} ${
                            c.status === 'active' ? styles.badgeSuccess : styles.badgeMuted
                          }`}
                        >
                          {String(c.status)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent passages table */}
              <div>
                <div className={styles.formLabel} style={{ marginBottom: 6 }}>
                  10 Derniers passages
                </div>
                {events.length === 0 ? (
                  <p style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>Aucun passage récent enregistré.</p>
                ) : (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {events.map(ev => {
                      const isAllow = ev.decision === 'allow'
                      const reason = getReasonPresentation(ev.reason_code as string)
                      const dir = formatDirection(ev.direction as string)
                      return (
                        <div
                          key={String(ev.id)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: 'var(--overlay-soft)',
                            border: '1px solid var(--border)',
                            fontSize: '0.72rem',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text)' }}>
                              {dir.label} · {ev.access_point_name || 'Point d’accès'}
                            </div>
                            <div style={{ fontSize: '0.64rem', color: 'var(--muted)' }}>
                              {ev.occurred_at ? new Date(String(ev.occurred_at)).toLocaleString('fr-FR') : '—'}
                            </div>
                          </div>
                          <span className={`${styles.badge} ${isAllow ? styles.badgeSuccess : styles.badgeDanger}`}>
                            {isAllow ? 'Autorisé' : reason.label}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p style={{ textAlign: 'center', color: 'var(--danger)', padding: 20 }}>Membre introuvable.</p>
          )}
        </div>
      </div>
    </div>
  )
}
