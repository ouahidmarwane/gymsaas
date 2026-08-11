'use client'
// components/SupervisionClient.tsx
// Tableau live des comptes connectés (admin). Rafraîchit la liste toutes
// les 15 s et met à jour les durées chaque seconde.
import { useEffect, useState, useTransition } from 'react'
import { getActiveSessions, forceSignOutUser, getSecurityEvents, dismissSecurityEvent } from '@/lib/actions'
import { DISCIPLINE_LABELS } from '@/types'
import { Activity, Circle, LogOut, ShieldAlert } from 'lucide-react'

interface Session {
  user_id: string
  name: string | null
  email: string | null
  role: string | null
  branch: string | null
  discipline: string | null
  login_at: string
  last_seen_at: string
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin', receptionist: 'Réceptionniste', viewer: 'Lecteur',
}
const BRANCH_LABELS: Record<string, string> = { sbata: 'Sbata', rachad: 'Rachad' }

function formatDuration(fromISO: string, now: number): string {
  const ms = Math.max(0, now - new Date(fromISO).getTime())
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}min`
  if (m > 0) return `${m}min ${sec}s`
  return `${sec}s`
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

interface SecurityEvent {
  id: string
  user_id: string | null
  name: string | null
  role: string | null
  event_type: string
  detail: string | null
  ip: string | null
  created_at: string
  handled_at: string | null
}

const EVENT_META: Record<string, { icon: string; label: string; color: string }> = {
  new_device_login:   { icon: '🔐', label: 'Nouvelle connexion', color: '#f59e0b' },
  failed_login_burst: { icon: '🚨', label: 'Tentatives échouées', color: '#ef4444' },
  access_denied:      { icon: '🚫', label: 'Action non autorisée', color: '#ef4444' },
}

export default function SupervisionClient({ initial, security, currentUserId }: { initial: Session[]; security: SecurityEvent[]; currentUserId: string }) {
  const [sessions, setSessions] = useState<Session[]>(initial ?? [])
  const [events, setEvents] = useState<SecurityEvent[]>(security ?? [])
  const [now, setNow] = useState(() => Date.now())
  const [kicking, setKicking] = useState<string | null>(null)
  const [, startKick] = useTransition()

  const refresh = () => {
    getActiveSessions().then(d => setSessions(d as Session[])).catch(() => {})
    getSecurityEvents().then(d => setEvents(d as SecurityEvent[])).catch(() => {})
  }

  // Rafraîchit les listes toutes les 30 s
  useEffect(() => {
    const iv = setInterval(refresh, 30_000)
    return () => clearInterval(iv)
  }, [])

  // ── Actions depuis une alerte de sécurité ──
  const handleEventLogout = (e: SecurityEvent) => {
    if (!e.user_id) return
    if (!confirm(`Déconnecter « ${e.name ?? 'ce compte'} » ?\nSa session sera révoquée immédiatement.`)) return
    setKicking(e.id)
    startKick(async () => {
      const res = await forceSignOutUser(e.user_id!)
      if ((res as any)?.error) alert((res as any).error)
      else await dismissSecurityEvent(e.id).catch(() => {})
      setKicking(null)
      refresh()
    })
  }

  const handleEventDismiss = (e: SecurityEvent) => {
    setKicking(e.id)
    startKick(async () => {
      await dismissSecurityEvent(e.id).catch(() => {})
      setEvents(prev => prev.map(x => x.id === e.id ? { ...x, handled_at: new Date().toISOString() } : x))
      setKicking(null)
    })
  }

  const handleForceLogout = (s: Session) => {
    if (!confirm(`Forcer la déconnexion de « ${s.name ?? s.email} » ?\nSa session sera révoquée immédiatement.`)) return
    setKicking(s.user_id)
    startKick(async () => {
      await forceSignOutUser(s.user_id).catch(() => {})
      setSessions(prev => prev.filter(x => x.user_id !== s.user_id))
      setKicking(null)
      refresh()
    })
  }

  // Tic chaque seconde pour les durées live
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(iv)
  }, [])

  return (
    <div className="dashboard-shell">
      <div className="dz-card" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards' }}>
        <div className="dz-card-head" style={{ marginBottom: 18 }}>
          <div className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={18} strokeWidth={2.2} />
            Comptes connectés
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
            <Circle size={9} fill="#22c55e" color="#22c55e" />
            {sessions.length} en ligne
          </div>
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: '32px 8px', textAlign: 'center', color: 'var(--muted)' }}>
            Aucun compte connecté pour le moment.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full supervision-table" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  <th style={{ padding: '10px 12px' }}>Utilisateur</th>
                  <th style={{ padding: '10px 12px' }}>Rôle</th>
                  <th style={{ padding: '10px 12px' }}>Succursale</th>
                  <th style={{ padding: '10px 12px' }}>Discipline</th>
                  <th style={{ padding: '10px 12px' }}>Connexion</th>
                  <th style={{ padding: '10px 12px' }}>Depuis</th>
                  <th style={{ padding: '10px 12px' }}>Statut</th>
                  <th style={{ padding: '10px 12px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map(s => (
                  <tr key={s.user_id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <td style={{ padding: '12px' }}>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{s.name ?? '—'}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>{s.email ?? ''}</div>
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>{ROLE_LABELS[s.role ?? ''] ?? s.role ?? '—'}</td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>{s.branch ? (BRANCH_LABELS[s.branch] ?? s.branch) : 'Toutes'}</td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>
                      {s.discipline ? (DISCIPLINE_LABELS[s.discipline as keyof typeof DISCIPLINE_LABELS] ?? s.discipline) : 'Toutes'}
                    </td>
                    <td style={{ padding: '12px', color: 'var(--text)' }}>{formatTime(s.login_at)}</td>
                    <td style={{ padding: '12px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{formatDuration(s.login_at, now)}</td>
                    <td style={{ padding: '12px' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#22c55e', fontWeight: 600 }}>
                        <Circle size={8} fill="#22c55e" color="#22c55e" /> En ligne
                      </span>
                    </td>
                    <td style={{ padding: '12px' }}>
                      {s.user_id === currentUserId ? (
                        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Vous</span>
                      ) : (
                        <button
                          onClick={() => handleForceLogout(s)}
                          disabled={kicking === s.user_id}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1.5 transition-colors disabled:opacity-50"
                          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                          title="Forcer la déconnexion de ce compte"
                        >
                          <LogOut size={13} strokeWidth={2.2} />
                          {kicking === s.user_id ? 'Déconnexion…' : 'Déconnecter'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
          « En ligne » = battement reçu il y a moins de 2 min. Déconnexion automatique après 10 min d'inactivité
          (et re-connexion forcée au-delà de 3 h de session). « Déconnecter » révoque immédiatement la session du compte.
        </p>
      </div>

      {/* ── Événements de sécurité (7 derniers jours) ── */}
      <div className="dz-card" style={{ marginTop: 22, animation: 'fadeUp 0.5s var(--ease-out) forwards' }}>
        <div className="dz-card-head" style={{ marginBottom: 18 }}>
          <div className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldAlert size={18} strokeWidth={2.2} />
            Événements de sécurité
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 13 }}>7 derniers jours</div>
        </div>

        {events.length === 0 ? (
          <div style={{ padding: '28px 8px', textAlign: 'center', color: 'var(--muted)' }}>
            Aucun événement suspect. ✅
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="w-full supervision-table" style={{ borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  <th style={{ padding: '10px 12px' }}>Type</th>
                  <th style={{ padding: '10px 12px' }}>Compte</th>
                  <th style={{ padding: '10px 12px' }}>Détail</th>
                  <th style={{ padding: '10px 12px' }}>IP</th>
                  <th style={{ padding: '10px 12px' }}>Quand</th>
                  <th style={{ padding: '10px 12px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {events.map(e => {
                  const meta = EVENT_META[e.event_type] ?? { icon: 'ℹ️', label: e.event_type, color: 'var(--muted)' }
                  return (
                    <tr key={e.id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)', opacity: e.handled_at ? 0.5 : 1 }}>
                      <td style={{ padding: '12px', color: meta.color, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {meta.icon} {meta.label}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--text)' }}>
                        {e.name ?? '—'}{e.role ? <span style={{ color: 'var(--muted)', fontSize: 12 }}> ({e.role})</span> : null}
                      </td>
                      <td style={{ padding: '12px', color: 'var(--muted)', fontSize: 13 }}>{e.detail ?? '—'}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)', fontSize: 13, fontVariantNumeric: 'tabular-nums' }}>{e.ip ?? '—'}</td>
                      <td style={{ padding: '12px', color: 'var(--muted)', fontSize: 13, whiteSpace: 'nowrap' }}>
                        {new Date(e.created_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '12px', whiteSpace: 'nowrap' }}>
                        {e.handled_at ? (
                          <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 600 }}>✓ Traité</span>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            {e.user_id && e.user_id !== currentUserId && (
                              <button
                                onClick={() => handleEventLogout(e)}
                                disabled={kicking === e.id}
                                title="Révoquer la session de ce compte"
                                className="inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
                                style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171' }}
                              >
                                <LogOut size={12} strokeWidth={2.2} />
                                Déconnecter
                              </button>
                            )}
                            <button
                              onClick={() => handleEventDismiss(e)}
                              disabled={kicking === e.id}
                              title="Marquer comme traité (rien à faire)"
                              className="text-xs font-semibold rounded-full px-2.5 py-1 transition-colors disabled:opacity-50"
                              style={{ background: 'rgba(255,255,255,0.08)', color: '#cbd5e1' }}
                            >
                              Ignorer
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
          Les connexions depuis un nouvel appareil, les tentatives de connexion répétées et les actions non autorisées sont aussi envoyées sur Telegram.
        </p>
      </div>
    </div>
  )
}
