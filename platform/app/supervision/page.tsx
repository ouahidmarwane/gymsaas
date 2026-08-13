'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ShieldAlert, LogOut, Check, Activity, Lock, Ban, MapPin, Unlock, ChevronDown,
} from 'lucide-react'
import { api, ApiError } from '@/lib/client'
import ClubsMap, { type MapClub } from '@/components/ClubsMap'

interface Session {
  user_id: string
  org_id: string | null
  created_at: string
  last_seen_at: string
  ip: string | null
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

/** Echecs regroupes par ADRESSE : c'est la maille d'une attaque, pas le compte. */
interface Offender {
  ip: string
  failures: number
  accounts: number
  last_attempt: string
  blocked: number
}

interface Blocked {
  ip: string
  reason: string | null
  created_at: string
  created_by_name: string | null
}

interface Payload {
  sessions: Session[]
  events: SecurityEvent[]
  offenders: Offender[]
  blocklist: Blocked[]
  clubs: MapClub[]
}

const REFRESH_MS = 10_000
const ONLINE_MS = 130_000       // deux battements de coeur
const BLOCK_SUGGESTED = 5       // au-dela, on propose le blocage d'emblee

const ROLES: Record<string, string> = {
  owner: 'Proprietaire', admin: 'Admin', staff: 'Staff',
  receptionist: 'Reception', viewer: 'Lecture',
}

export default function SupervisionPage() {
  const router = useRouter()
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [busy, setBusy] = useState<string | null>(null)
  const [meId, setMeId] = useState<string | null>(null)

  // Sert a ne pas proposer « Deconnecter » sur son propre compte : le
  // serveur le refuse, et un bouton qui echoue toujours est un piege.
  useEffect(() => {
    api.get<{ user: { id: string } }>('/api/me').then(m => setMeId(m.user.id)).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    try {
      const d = await api.get<Payload>('/api/admin/supervision')
      setData(d); setError(null); setNow(Date.now())
    } catch (e) {
      if (e instanceof ApiError && e.status === 403) router.replace('/dashboard')
      else setError(e instanceof ApiError ? e.message : 'Chargement impossible')
    }
  }, [router])

  useEffect(() => {
    load()
    const poll = setInterval(load, REFRESH_MS)
    // La duree affichee avance chaque seconde sans recharger pour autant.
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
  }, [load])

  async function act(key: string, run: () => Promise<unknown>, done?: string) {
    setBusy(key); setError(null); setNotice(null)
    try { await run(); await load(); if (done) setNotice(done) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Action impossible') }
    finally { setBusy(null) }
  }

  const sessions = data?.sessions ?? []
  const events = data?.events ?? []
  const offenders = data?.offenders ?? []
  const blocklist = data?.blocklist ?? []
  const clubs = useMemo(() => data?.clubs ?? [], [data])

  const online = sessions.filter(s => now - Date.parse(s.last_seen_at) < ONLINE_MS).length
  const openEvents = events.filter(e => !e.handled_at).length

  // Les sessions en ligne d'abord : c'est ce qui se regarde en premier, et
  // c'est ce qui doit survivre au repli.
  const ordered = useMemo(() => {
    const live = (s: Session) => Date.now() - Date.parse(s.last_seen_at) < ONLINE_MS
    return [...sessions].sort((a, b) => Number(live(b)) - Number(live(a))
      || Date.parse(b.last_seen_at) - Date.parse(a.last_seen_at))
  }, [sessions])

  const foldSessions = useFold(ordered, 6)
  const foldOffenders = useFold(offenders, 5)
  const foldBlocked = useFold(blocklist, 5)
  const foldEvents = useFold(events, 6)

  return (
    <div className="dashboard-shell">
      <div>
        <p className="section-heading" style={{ marginBottom: 6 }}>Plateforme</p>
        <h1 className="dz-hello">Supervision</h1>
        <p className="dz-sub">
          {data
            ? `${sessions.length} session(s) · ${online} en ligne · ${openEvents} alerte(s) a traiter`
            : 'Chargement…'}
        </p>
      </div>

      <div aria-live="polite">
        {error && <Banner tone="danger">{error}</Banner>}
        {notice && !error && <Banner tone="ok">{notice}</Banner>}
      </div>

      {/* Comptes connectes, en tete : c'est ce qu'on vient verifier. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Activity size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Comptes connectes
          </h2>
          <span className="dz-card-note" style={{ display: 'flex', alignItems: 'center' }}>
            <span className={online ? 'gf-dot-online' : 'gf-dot-off'} />{online} en ligne
          </span>
        </div>

        {!data && <Skeleton />}
        {data && sessions.length === 0 && (
          <p className="dz-card-note" style={{ marginTop: 16 }}>Personne de connecte.</p>
        )}

        {sessions.length > 0 && (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr>
                  <th>Utilisateur</th><th>Role</th><th>Club</th><th>Adresse</th>
                  <th>Connexion</th><th>Depuis</th><th>Statut</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {foldSessions.shown.map((s, i) => {
                  const isOnline = now - Date.parse(s.last_seen_at) < ONLINE_MS
                  const unknownIp = s.ip_known === 0 && s.ip
                  return (
                    <tr key={`${s.user_id}-${i}`}>
                      <td>
                        <div className="gf-table-name">{s.user_name}</div>
                        <div className="gf-table-sub">{s.email}</div>
                      </td>
                      <td>{s.is_platform_admin === 1 ? 'Plateforme' : (ROLES[s.role ?? ''] ?? s.role ?? '—')}</td>
                      <td>
                        {s.org_name ?? '—'}
                        {s.support_org_id && <div className="gf-table-sub" style={{ color: '#f87171' }}>en support</div>}
                      </td>
                      <td>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{s.ip ?? '—'}</span>
                        {unknownIp && <div className="gf-table-sub" style={{ color: '#f59e0b' }}>adresse inconnue</div>}
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{clock(s.created_at)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{elapsed(s.created_at, now)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={isOnline ? 'gf-dot-online' : 'gf-dot-off'} />
                        <span style={{ color: isOnline ? 'var(--positive)' : 'var(--muted)', fontWeight: 600 }}>
                          {isOnline ? 'En ligne' : 'Inactif'}
                        </span>
                      </td>
                      <td>
                        {/* On ne se coupe pas son propre compte depuis ici :
                            le serveur refuse, autant ne pas le proposer. */}
                        {s.user_id === meId ? (
                          <span className="gf-table-sub">Vous</span>
                        ) : (
                          <button className="gf-mini-btn" data-tone="danger"
                                  disabled={busy !== null}
                                  onClick={() => act(`u-${s.user_id}`,
                                    () => api.del(`/api/admin/users/${s.user_id}/sessions`),
                                    `${s.user_name} a ete deconnecte.`)}>
                            <LogOut size={12} strokeWidth={2.4} /> Deconnecter
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <FoldButton fold={foldSessions} singular="session restante" plural="sessions restantes" />

        <p className="dz-card-note" style={{ marginTop: 14 }}>
          « En ligne » = battement recu il y a moins de 2 min. « Deconnecter » revoque
          immediatement toutes les sessions du compte, sur tous ses appareils.
        </p>
      </section>

      {/* Carte : ou sont les salles, et laquelle bouge en ce moment. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <MapPin size={17} strokeWidth={2.1} style={{ color: 'var(--gold)' }} /> Salles abonnees
          </h2>
          <span className="dz-card-note">{clubs.length} club(s)</span>
        </div>
        <ClubsMap
          clubs={clubs}
          onEnter={club => router.push(`/admin?club=${encodeURIComponent(club.slug)}`)}
          onLocate={async (club, at) => {
            await api.put(`/api/admin/clubs/${club.id}/location`, at)
            await load()
          }}
        />
      </section>

      {/* Adresses en echec : la maille utile pour bloquer. */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Ban size={17} strokeWidth={2.1}
                 style={{ color: offenders.some(o => !o.blocked) ? '#f59e0b' : 'var(--muted)' }} />
            Echecs de connexion par adresse
          </h2>
          <span className="dz-card-note">24 dernieres heures</span>
        </div>

        {offenders.length === 0 ? (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Aucune adresse au-dela de trois echecs.
          </p>
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr><th>Adresse</th><th>Echecs</th><th>Comptes vises</th><th>Dernier</th><th>Action</th></tr>
              </thead>
              <tbody>
                {foldOffenders.shown.map(o => (
                  <tr key={o.ip}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{o.ip}</td>
                    <td>
                      <span style={{
                        fontWeight: 800,
                        color: o.failures >= BLOCK_SUGGESTED ? '#f87171' : '#f59e0b',
                      }}>{o.failures}</span>
                    </td>
                    <td>
                      {o.accounts}
                      {/* Plusieurs comptes depuis une seule adresse : ce n'est
                          plus un mot de passe oublie, c'est un balayage. */}
                      {o.accounts > 1 && (
                        <div className="gf-table-sub" style={{ color: '#f59e0b' }}>balayage de comptes</div>
                      )}
                    </td>
                    <td className="gf-table-sub">{relative(o.last_attempt, now)}</td>
                    <td>
                      {o.blocked ? (
                        <span className="gf-table-sub" style={{ color: '#f87171', fontWeight: 700 }}>Bloquee</span>
                      ) : (
                        <button className="gf-mini-btn" data-tone="danger" disabled={busy !== null}
                                onClick={() => act(`b-${o.ip}`,
                                  () => api.post('/api/admin/blocklist', {
                                    ip: o.ip,
                                    reason: `${o.failures} echecs sur ${o.accounts} compte(s)`,
                                  }),
                                  `${o.ip} est bloquee et ses sessions sont coupees.`)}>
                          <Ban size={12} strokeWidth={2.4} /> Bloquer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FoldButton fold={foldOffenders} singular="adresse restante" plural="adresses restantes" />
      </section>

      {blocklist.length > 0 && (
        <section className="dz-card">
          <div className="dz-card-head">
            <h2 className="dz-card-title">Adresses bloquees</h2>
            <span className="dz-card-note">{blocklist.length}</span>
          </div>
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead><tr><th>Adresse</th><th>Motif</th><th>Par</th><th>Quand</th><th>Action</th></tr></thead>
              <tbody>
                {foldBlocked.shown.map(b => (
                  <tr key={b.ip}>
                    <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{b.ip}</td>
                    <td className="gf-table-sub">{b.reason ?? '—'}</td>
                    <td className="gf-table-sub">{b.created_by_name ?? '—'}</td>
                    <td className="gf-table-sub">{relative(b.created_at, now)}</td>
                    <td>
                      <button className="gf-mini-btn" disabled={busy !== null}
                              onClick={() => act(`ub-${b.ip}`,
                                () => api.del(`/api/admin/blocklist/${encodeURIComponent(b.ip)}`),
                                `${b.ip} est de nouveau autorisee.`)}>
                        <Unlock size={12} strokeWidth={2.4} /> Debloquer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <FoldButton fold={foldBlocked} singular="adresse restante" plural="adresses restantes" />
        </section>
      )}

      {/* Evenements de securite */}
      <section className="dz-card">
        <div className="dz-card-head">
          <h2 className="dz-card-title" style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <ShieldAlert size={17} strokeWidth={2.1}
                         style={{ color: openEvents ? '#f59e0b' : 'var(--muted)' }} />
            Evenements de securite
          </h2>
          <span className="dz-card-note">7 derniers jours</span>
        </div>

        {events.length === 0 ? (
          <p className="dz-card-note" style={{ marginTop: 16 }}>
            Rien a signaler. Une connexion depuis une adresse jamais vue, ou une rafale
            d&apos;echecs de mot de passe, apparaitrait ici.
          </p>
        ) : (
          <div className="gf-table-wrap">
            <table className="gf-table">
              <thead>
                <tr><th>Type</th><th>Compte</th><th>Detail</th><th>Adresse</th><th>Quand</th><th>Action</th></tr>
              </thead>
              <tbody>
                {foldEvents.shown.map(ev => (
                  <tr key={ev.id} style={{ opacity: ev.handled_at ? 0.5 : 1 }}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <Lock size={13} strokeWidth={2.4}
                            style={{ color: tone(ev.type), marginInlineEnd: 6, verticalAlign: '-2px' }} />
                      <span style={{ color: tone(ev.type), fontWeight: 700 }}>{label(ev.type)}</span>
                    </td>
                    <td>
                      <span className="gf-table-name">{ev.user_name ?? ev.detail ?? '—'}</span>
                      {ev.org_name && <span className="gf-table-sub"> ({ev.org_name})</span>}
                    </td>
                    <td className="gf-table-sub">{describe(ev)}</td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{ev.ip ?? '—'}</td>
                    <td className="gf-table-sub" style={{ whiteSpace: 'nowrap' }}>{stamp(ev.created_at)}</td>
                    <td style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {ev.ip && !blocklist.some(b => b.ip === ev.ip) && (
                        <button className="gf-mini-btn" data-tone="danger" disabled={busy !== null}
                                onClick={() => act(`eb-${ev.id}`,
                                  () => api.post('/api/admin/blocklist', {
                                    ip: ev.ip, reason: label(ev.type),
                                  }),
                                  `${ev.ip} est bloquee.`)}>
                          <Ban size={12} strokeWidth={2.4} /> Bloquer
                        </button>
                      )}
                      {!ev.handled_at && (
                        <button className="gf-mini-btn" disabled={busy !== null}
                                onClick={() => act(`ev-${ev.id}`,
                                  () => api.post(`/api/admin/events/${ev.id}/handled`))}>
                          <Check size={12} strokeWidth={2.4} /> Ignorer
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <FoldButton fold={foldEvents} singular="evenement restant" plural="evenements restants" />
      </section>
    </div>
  )
}

// Presentation -----------------------------------------------------------

function Banner({ tone: t, children }: { tone: 'danger' | 'ok'; children: React.ReactNode }) {
  const danger = t === 'danger'
  return (
    <p role={danger ? 'alert' : 'status'} style={{
      padding: '0.7rem 1rem', borderRadius: 14, fontSize: '0.85rem', fontWeight: 600,
      background: danger ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
      border: `1px solid ${danger ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)'}`,
      color: danger ? '#fca5a5' : '#6ee7b7',
    }}>{children}</p>
  )
}

const Skeleton = () => (
  <div className="members-skeleton-row"
       style={{ height: 56, borderRadius: 16, border: 'none', marginTop: 16 }} />
)

/**
 * Devoile une liste par paliers.
 *
 * Cinquante sessions et trente-cinq salles depliees d'emblee, c'est trois
 * ecrans de defilement avant d'atteindre les alertes — donc une page de
 * securite ou l'on ne voit plus ce qui compte. Mais tout ouvrir d'un coup
 * ramene le meme mur : on avance donc par paliers, un clic a la fois.
 */
export function useFold<T>(rows: T[], step: number) {
  const [count, setCount] = useState(step)
  const hidden = Math.max(0, rows.length - count)
  return {
    shown: rows.slice(0, count),
    hidden,
    /** Combien le prochain clic ajoutera reellement. */
    next: Math.min(step, hidden),
    expanded: count > step,
    more: () => setCount(c => c + step),
    reset: () => setCount(step),
  }
}

function FoldButton({ fold, singular, plural }: {
  fold: ReturnType<typeof useFold<unknown>>
  singular: string
  plural: string
}) {
  if (fold.hidden === 0 && !fold.expanded) return null
  const noun = fold.hidden > 1 ? plural : singular
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      {fold.hidden > 0 && (
        <button className="gf-fold" onClick={fold.more}>
          <ChevronDown size={15} strokeWidth={2.4} />
          Afficher {fold.next} de plus
          {/* Le reste a parcourir : sans ce chiffre on clique sans savoir
              s'il en reste trois ou trois cents. */}
          <span className="gf-fold-rest">{fold.hidden} {noun}</span>
        </button>
      )}
      {fold.expanded && (
        <button className="gf-fold" onClick={fold.reset}>
          <ChevronDown size={15} strokeWidth={2.4} data-open="true" /> Réduire
        </button>
      )}
    </div>
  )
}

const tone = (t: SecurityEvent['type']) =>
  t === 'failed_burst' ? '#f87171' : t === 'new_ip' ? '#f59e0b' : '#a78bfa'

const label = (t: SecurityEvent['type']) =>
  t === 'failed_burst' ? 'Rafale d’echecs' : t === 'new_ip' ? 'Nouvelle connexion' : 'Ecriture en support'

function describe(ev: SecurityEvent): string {
  if (ev.type === 'new_ip') return 'Connexion depuis un nouvel appareil'
  if (ev.type === 'failed_burst') return `Mots de passe repetes sur ${ev.detail ?? 'un compte'}`
  return ev.detail ?? 'Modification effectuee en mode support'
}

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

const stamp = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${clock(iso)}`
}

/** Duree de session, en compteur qui avance. */
function elapsed(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h ${m % 60}` : `${Math.floor(h / 24)} j`
}

function relative(iso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000))
  if (s < 60) return "a l'instant"
  const m = Math.floor(s / 60)
  if (m < 60) return `il y a ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `il y a ${h} h`
  return `il y a ${Math.floor(h / 24)} j`
}
