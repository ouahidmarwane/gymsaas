'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldAlert, LogOut, Check, Wifi, AlertTriangle } from 'lucide-react'
import { api, ApiError } from '@/lib/client'

interface Session {
  user_id: string
  org_id: string | null
  created_at: string
  last_seen_at: string
  ip: string | null
  user_agent: string | null
  support_org_id: string | null
  user_name: string
  email: string
  is_platform_admin: number
  org_name: string | null
  role: string | null
  ip_known: number
}

interface SecurityEvent {
  id: number
  type: 'new_ip' | 'failed_burst' | 'support_write'
  detail: string | null
  ip: string | null
  created_at: string
  handled_at: string | null
  user_name: string | null
  email: string | null
  org_name: string | null
}

interface FailedAttempt {
  identifier: string
  ip: string | null
  failures: number
  last_attempt: string
}

const REFRESH_MS = 10_000
const ONLINE_MS = 130_000   // deux battements de coeur, comme avant

export default function SupervisionPage() {
  const router = useRouter()
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [events, setEvents] = useState<SecurityEvent[]>([])
  const [attempts, setAttempts] = useState<FailedAttempt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    try {
      const d = await api.get<{
        sessions: Session[]; events: SecurityEvent[]; failedAttempts: FailedAttempt[]
      }>('/api/admin/supervision')
      setSessions(d.sessions); setEvents(d.events); setAttempts(d.failedAttempts)
      setError(null); setNow(Date.now())
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) router.replace('/dashboard')
      else setError(e instanceof ApiError ? e.message : 'Chargement impossible')
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, REFRESH_MS)
    // La duree affichee avance chaque seconde, sans recharger pour autant.
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(timer); clearInterval(tick) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openEvents = events.filter(e => !e.handled_at)
  const platformSessions = sessions?.filter(s => s.is_platform_admin === 1) ?? []
  const clubSessions = sessions?.filter(s => s.is_platform_admin !== 1) ?? []

  return (
    <div className="dashboard-shell">
      <div>
        <h1 className="dz-hello">Supervision</h1>
        <p className="dz-sub">
          {sessions
            ? `${sessions.length} session(s) active(s) · ${openEvents.length} alerte(s) a traiter`
            : 'Chargement…'}
        </p>
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" style={{
            padding: '0.7rem 1rem', borderRadius: 14,
            background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#fca5a5', fontSize: '0.85rem', fontWeight: 600,
          }}>{error}</p>
        )}
      </div>

      {/* Alertes d'abord : c'est ce qu'on vient voir. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ShieldAlert size={17} strokeWidth={2.1} style={{ color: openEvents.length ? '#f59e0b' : 'var(--muted)' }} />
            Evenements de securite
          </h2>
          <span className="dz-card-note">7 derniers jours</span>
        </div>

        {events.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Rien a signaler. Une connexion depuis une adresse jamais vue, ou une rafale
            d&apos;echecs de mot de passe, apparaitrait ici.
          </p>
        )}

        <ul style={{ listStyle: 'none', padding: 0, margin: events.length ? '16px 0 0' : 0,
                     display: 'flex', flexDirection: 'column', gap: 8 }}>
          {events.map(ev => (
            <li key={ev.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0.75rem 1rem', borderRadius: 16,
              background: ev.handled_at ? 'rgba(255,255,255,0.03)' : 'rgba(245,158,11,0.08)',
              border: `1px solid ${ev.handled_at ? 'rgba(255,255,255,0.06)' : 'rgba(245,158,11,0.25)'}`,
              opacity: ev.handled_at ? 0.55 : 1,
            }}>
              <EventIcon type={ev.type} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                  {eventTitle(ev)}
                </div>
                <div className="dz-card-note">
                  {[ev.org_name ?? 'Plateforme', ev.ip, relative(ev.created_at, now)]
                    .filter(Boolean).join(' · ')}
                </div>
              </div>
              {!ev.handled_at && (
                <button
                  className="btn-ghost"
                  style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem' }}
                  disabled={busy !== null}
                  onClick={async () => {
                    setBusy(`ev-${ev.id}`)
                    try { await api.post(`/api/admin/events/${ev.id}/handled`); await load() }
                    finally { setBusy(null) }
                  }}
                >
                  <Check size={13} strokeWidth={2.4} /> Traite
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* Sessions plateforme : les votres. */}
      <SessionList
        title="Comptes plateforme connectes"
        note="Vos propres sessions"
        sessions={platformSessions}
        now={now}
        busy={busy}
        loading={sessions === null}
        onRevoke={async userId => {
          setBusy(`u-${userId}`)
          try { await api.del(`/api/admin/users/${userId}/sessions`); await load() }
          catch (e) { setError(e instanceof ApiError ? e.message : 'Deconnexion impossible') }
          finally { setBusy(null) }
        }}
      />

      {/* Sessions des clubs, sur la meme page : c'est la comparaison qui
          rend une connexion suspecte visible. */}
      <SessionList
        title="Comptes de clubs connectes"
        note="Toutes salles confondues"
        sessions={clubSessions}
        now={now}
        busy={busy}
        loading={sessions === null}
        showClub
        onRevoke={async userId => {
          setBusy(`u-${userId}`)
          try { await api.del(`/api/admin/users/${userId}/sessions`); await load() }
          catch (e) { setError(e instanceof ApiError ? e.message : 'Deconnexion impossible') }
          finally { setBusy(null) }
        }}
      />

      {attempts.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Echecs de connexion</h2>
            <span className="dz-card-note">24 dernieres heures</span>
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: '16px 0 0',
                       display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attempts.map((a, i) => (
              <li key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: '0.82rem' }}>
                <span className="badge text-red-300 bg-red-500/10 ring-red-500/30"
                      style={{ fontSize: '0.62rem' }}>{a.failures}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.identifier}
                </span>
                <span className="dz-card-note">{a.ip ?? '—'}</span>
                <span className="dz-card-note">{relative(a.last_attempt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function SessionList({
  title, note, sessions, now, busy, showClub, loading, onRevoke,
}: {
  title: string; note: string; sessions: Session[]; now: number
  busy: string | null; showClub?: boolean; loading?: boolean
  onRevoke: (userId: string) => void
}) {
  return (
    <section className="dz-card">
      <div className="dz-card-head">
        <h2 className="dz-card-title">{title}</h2>
        <span className="dz-card-note">{note}{loading ? '' : ` · ${sessions.length}`}</span>
      </div>

      {/* Distinguer « pas encore charge » de « personne » : afficher
          « Personne de connecte » pendant le chargement est un mensonge
          que la page racontait a chaque ouverture. */}
      {loading && (
        <div className="members-skeleton-row"
             style={{ height: 56, borderRadius: 16, border: 'none', marginTop: 16 }} />
      )}
      {!loading && sessions.length === 0 && (
        <p className="dz-card-note" style={{ marginTop: 16 }}>Personne de connecte.</p>
      )}

      <ul style={{ listStyle: 'none', padding: 0, margin: sessions.length ? '16px 0 0' : 0,
                   display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sessions.map((s, i) => {
          const online = now - Date.parse(s.last_seen_at) < ONLINE_MS
          // Une adresse jamais vue pour ce compte : le signal principal.
          const unknownIp = s.ip_known === 0 && s.ip
          return (
            <li key={`${s.user_id}-${i}`} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '0.75rem 1rem', borderRadius: 16,
              background: unknownIp ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.045)',
              border: `1px solid ${unknownIp ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.06)'}`,
            }}>
              <span title={online ? 'En ligne' : 'Inactif'} aria-label={online ? 'En ligne' : 'Inactif'}
                    style={{
                      width: 8, height: 8, borderRadius: '50%', flex: 'none',
                      background: online ? '#10b981' : 'var(--muted)',
                      boxShadow: online ? '0 0 8px 1px rgba(16,185,129,0.5)' : 'none',
                    }} />

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.875rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.user_name}
                  </span>
                  {s.support_org_id && (
                    <span className="badge text-red-300 bg-red-500/10 ring-red-500/30"
                          style={{ fontSize: '0.58rem' }}>support</span>
                  )}
                  {unknownIp && (
                    <span className="badge text-amber-300 bg-amber-500/10 ring-amber-500/30"
                          style={{ fontSize: '0.58rem' }}>adresse inconnue</span>
                  )}
                </div>
                <div className="dz-card-note" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[showClub ? (s.org_name ?? 'sans club') : null, s.role, s.ip ?? 'adresse inconnue',
                    `vu ${relative(s.last_seen_at, now)}`].filter(Boolean).join(' · ')}
                </div>
              </div>

              <button
                className="btn-ghost"
                style={{ padding: '0.35rem 0.8rem', fontSize: '0.75rem', flex: 'none' }}
                disabled={busy !== null}
                onClick={() => onRevoke(s.user_id)}
                title={`Deconnecter ${s.user_name}`}
              >
                <LogOut size={13} strokeWidth={2.2} /> Deconnecter
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function EventIcon({ type }: { type: SecurityEvent['type'] }) {
  const common = { size: 16, strokeWidth: 2.2, style: { flex: 'none' as const } }
  if (type === 'failed_burst') return <AlertTriangle {...common} style={{ ...common.style, color: '#ef4444' }} />
  if (type === 'new_ip') return <Wifi {...common} style={{ ...common.style, color: '#f59e0b' }} />
  return <ShieldAlert {...common} style={{ ...common.style, color: '#9b72ff' }} />
}

function eventTitle(ev: SecurityEvent): string {
  const who = ev.user_name ?? ev.email ?? ev.detail ?? 'Compte inconnu'
  if (ev.type === 'new_ip') return `${who} s'est connecte depuis une adresse jamais vue`
  if (ev.type === 'failed_burst') return `Rafale d'echecs de mot de passe sur ${ev.detail ?? who}`
  return `${who} — modification en mode support`
}

function relative(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (seconds < 60) return "a l'instant"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}
