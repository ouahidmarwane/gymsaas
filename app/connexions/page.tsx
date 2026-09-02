'use client'

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  Activity, Clock3, Laptop, RefreshCw, Search, ShieldCheck, Smartphone, Wifi,
} from 'lucide-react'
import { api, ApiError, type Me } from '@/lib/client'
import PageState from '@/components/PageState'

interface ConnectionRow {
  session_hash: string
  user_id: string
  name: string
  email: string
  role: 'owner' | 'admin' | 'staff' | 'viewer' | 'revoked'
  connected_at: string
  last_seen_at: string
  disconnected_at: string | null
  ip: string | null
  user_agent: string | null
  session_active: number
  is_current: number
}

const ONLINE_WINDOW_MS = 130_000
const REFRESH_MS = 15_000
const ROLE_LABELS: Record<ConnectionRow['role'], string> = {
  owner: 'Proprietaire',
  admin: 'Administrateur',
  staff: 'Reception',
  viewer: 'Lecture seule',
  revoked: 'Acces retire',
}

export default function ConnectionsPage() {
  const router = useRouter()
  const [rows, setRows] = useState<ConnectionRow[] | null>(null)
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true)
    try {
      const me = await api.get<Me>('/api/me')
      if (me.scope.mode !== 'member' || !['owner', 'admin'].includes(me.org?.role ?? '')) {
        router.replace('/dashboard')
        return
      }
      const data = await api.get<{ connections: ConnectionRow[] }>('/api/club/connections')
      setRows(data.connections)
      setError(null)
      setNow(Date.now())
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 403) router.replace('/dashboard')
      else setError(cause instanceof ApiError ? cause.message : 'Chargement impossible')
    } finally {
      setRefreshing(false)
    }
  }, [router])

  useEffect(() => {
    void load()
    const refresh = window.setInterval(() => void load(true), REFRESH_MS)
    const tick = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => { window.clearInterval(refresh); window.clearInterval(tick) }
  }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('fr')
    if (!needle) return rows ?? []
    return (rows ?? []).filter(row =>
      [row.name, row.email, row.ip ?? '', ROLE_LABELS[row.role], deviceName(row.user_agent)]
        .some(value => value.toLocaleLowerCase('fr').includes(needle)))
  }, [query, rows])

  const online = (rows ?? []).filter(row => isOnline(row, now)).length
  const today = (rows ?? []).filter(row => sameLocalDay(row.connected_at, now)).length
  const people = new Set((rows ?? []).map(row => row.user_id)).size

  return (
    <div className="dashboard-shell connections-page">
      <header className="connections-heading">
        <div>
          <p className="section-heading">Securite du club</p>
          <h1 className="dz-hello">Supervision des connexions</h1>
          <p className="dz-sub">
            Suivez les acces de votre equipe, leurs appareils et leur temps passe sur la plateforme.
          </p>
        </div>
        <button className="btn-ghost connections-refresh" onClick={() => void load()}
                disabled={refreshing} aria-label="Actualiser les connexions">
          <RefreshCw size={16} className={refreshing ? 'connections-spin' : undefined} />
          Actualiser
        </button>
      </header>

      <PageState error={error} onRetry={() => void load()} />

      <section className="connections-summary" aria-label="Resume des connexions">
        <Summary icon={<Wifi size={18} />} value={online} label="En ligne maintenant" />
        <Summary icon={<Clock3 size={18} />} value={today} label="Connexions aujourd'hui" />
        <Summary icon={<ShieldCheck size={18} />} value={people} label="Comptes observes" />
      </section>

      <section className="dz-card connections-card">
        <div className="connections-card-head">
          <div>
            <h2 className="dz-card-title">
              <Activity size={18} aria-hidden="true" /> Historique recent
            </h2>
            <p className="dz-card-note">100 dernieres connexions du club, les plus recentes en premier.</p>
          </div>
          <label className="connections-search">
            <Search size={16} aria-hidden="true" />
            <input value={query} onChange={event => setQuery(event.target.value)}
                   aria-label="Rechercher une connexion"
                   placeholder="Nom, e-mail, IP ou appareil" />
          </label>
        </div>

        {!rows && !error && <div className="members-skeleton-row connections-skeleton" />}

        {rows && filtered.length === 0 && (
          <div className="connections-empty">
            <ShieldCheck size={28} aria-hidden="true" />
            <strong>{query ? 'Aucun resultat' : 'Aucune connexion enregistree'}</strong>
            <span>{query ? 'Essayez une autre recherche.' : 'Les prochaines connexions apparaitront ici.'}</span>
          </div>
        )}

        {filtered.length > 0 && (
          <div className="gf-table-wrap">
            <table className="gf-table connections-table">
              <thead>
                <tr>
                  <th>Utilisateur</th><th>Adresse IP</th><th>Appareil</th>
                  <th>Connexion</th><th>Derniere activite</th><th>Duree</th><th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => {
                  const live = isOnline(row, now)
                  const end = row.session_active ? now : Date.parse(row.disconnected_at ?? row.last_seen_at)
                  return (
                    <tr key={row.session_hash}>
                      <td>
                        <div className="gf-table-name">
                          {row.name}{row.is_current === 1 && <span className="connections-you">Vous</span>}
                        </div>
                        <div className="gf-table-sub">{row.email} · {ROLE_LABELS[row.role]}</div>
                      </td>
                      <td className="connections-mono">{row.ip ?? 'Non disponible'}</td>
                      <td>
                        <div className="connections-device">
                          {isMobile(row.user_agent) ? <Smartphone size={15} /> : <Laptop size={15} />}
                          <span>{deviceName(row.user_agent)}</span>
                        </div>
                        <div className="gf-table-sub connections-agent">{row.user_agent ?? 'Appareil non identifie'}</div>
                      </td>
                      <td className="connections-date">{dateTime(row.connected_at)}</td>
                      <td className="connections-date">{relative(row.last_seen_at, now)}</td>
                      <td className="connections-mono">{duration(Date.parse(row.connected_at), end)}</td>
                      <td>
                        <span className={`connections-status ${live ? 'online' : row.session_active ? 'idle' : 'ended'}`}>
                          <i />{live ? 'En ligne' : row.session_active ? 'Inactive' : 'Terminee'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="connections-privacy">
        Les adresses IP et informations d&apos;appareil sont visibles uniquement par le proprietaire et les administrateurs du club.
      </p>
    </div>
  )
}

function Summary({ icon, value, label }: { icon: ReactNode; value: number; label: string }) {
  return (
    <div className="connections-summary-item">
      <span className="connections-summary-icon">{icon}</span>
      <span><strong>{value}</strong><small>{label}</small></span>
    </div>
  )
}

function isOnline(row: ConnectionRow, now: number) {
  return row.session_active === 1 && now - Date.parse(row.last_seen_at) < ONLINE_WINDOW_MS
}

function sameLocalDay(iso: string, now: number) {
  const a = new Date(iso)
  const b = new Date(now)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isMobile(agent: string | null) {
  return /Android|iPhone|iPad|Mobile/i.test(agent ?? '')
}

function deviceName(agent: string | null) {
  if (!agent) return 'Appareil inconnu'
  const os = /iPhone|iPad/i.test(agent) ? 'iOS'
    : /Android/i.test(agent) ? 'Android'
      : /Windows/i.test(agent) ? 'Windows'
        : /Mac OS|Macintosh/i.test(agent) ? 'macOS'
          : /Linux/i.test(agent) ? 'Linux' : 'Appareil'
  const browser = /Edg\//i.test(agent) ? 'Edge'
    : /Firefox\//i.test(agent) ? 'Firefox'
      : /Chrome\//i.test(agent) ? 'Chrome'
        : /Safari\//i.test(agent) ? 'Safari' : 'Navigateur'
  return `${browser} sur ${os}`
}

function dateTime(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function relative(iso: string, now: number) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1_000))
  if (seconds < 60) return "A l'instant"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `Il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `Il y a ${hours} h`
  return `Il y a ${Math.floor(hours / 24)} j`
}

function duration(start: number, end: number) {
  const minutes = Math.max(0, Math.floor((end - start) / 60_000))
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ${minutes % 60} min`
  return `${Math.floor(hours / 24)} j ${hours % 24} h`
}
