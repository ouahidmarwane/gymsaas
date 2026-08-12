'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, Users, Wallet, Building2 } from 'lucide-react'
import { api, ApiError, type ClubRow } from '@/lib/client'

const REFRESH_MS = 15_000

export default function AdminPage() {
  const router = useRouter()
  const [clubs, setClubs] = useState<ClubRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [entering, setEntering] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    const load = () =>
      api.get<{ clubs: ClubRow[] }>('/api/admin/overview')
        .then(d => { if (alive) { setClubs(d.clubs); setError(null); setNow(Date.now()) } })
        .catch(e => {
          if (!alive) return
          if (e instanceof ApiError && e.status === 403) router.replace('/dashboard')
          else setError(e instanceof ApiError ? e.message : 'Chargement impossible')
        })
    load()
    // Interrogation reguliere plutot qu'un flux : pour du support c'est
    // indiscernable, et le cache d'agregats est rafraichi toutes les 5 min.
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [router])

  async function enter(club: ClubRow) {
    setEntering(club.id)
    try {
      await api.post(`/api/admin/clubs/${club.id}/support`)
      router.push('/dashboard')
      router.refresh()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Entree impossible')
      setEntering(null)
    }
  }

  const totals = clubs?.reduce(
    (acc, c) => ({
      members: acc.members + (c.member_count ?? 0),
      revenue: acc.revenue + (c.revenue_month_cents ?? 0),
    }),
    { members: 0, revenue: 0 },
  )

  return (
    <div className="dashboard-shell">
      <div style={{ animation: 'fadeUp 0.45s cubic-bezier(0.22,1,0.36,1) both' }}>
        <h1 className="dz-hello">Clubs</h1>
        <p className="dz-sub">
          {clubs
            ? `${clubs.length} club${clubs.length > 1 ? 's' : ''} · ${totals!.members} membres · ${(totals!.revenue / 100).toLocaleString('fr-MA')} DH ce mois`
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

      {!clubs && <SkeletonList />}

      {clubs && clubs.length === 0 && (
        <section className="dz-card" style={{ textAlign: 'center', padding: '3.5rem 1.5rem' }}>
          <Building2 size={34} style={{ opacity: 0.35, marginBottom: 12 }} />
          <h2 className="dz-card-title" style={{ marginBottom: 6 }}>Aucun club pour l&apos;instant</h2>
          <p className="dz-card-note" style={{ maxWidth: 460, margin: '0 auto' }}>
            Un club cree ici demarre vide : c&apos;est ensuite lui, ou vous, qui declarez
            ses salles et ses sports. Rien n&apos;est presuppose.
          </p>
        </section>
      )}

      {clubs && clubs.length > 0 && (
        <div className="admin-club-grid">
          {clubs.map((club, i) => (
            <article
              key={club.id}
              className="dz-card admin-club-card"
              style={{
                animation: 'fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) forwards',
                animationDelay: `${i * 60}ms`,
                opacity: 0,
              }}
            >
              <header className="admin-club-head">
                <span className="admin-club-avatar" style={{ background: club.theme.accent }} aria-hidden="true">
                  {club.name.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <h2 className="admin-club-name">{club.name}</h2>
                  <span className="admin-club-slug">{club.slug}</span>
                </div>
                <Status club={club} now={now} />
              </header>

              <dl className="admin-club-figures">
                <Figure icon={<Users size={14} />} label="Membres" value={club.member_count} />
                <Figure icon={<Users size={14} />} label="Abonnes" value={club.active_subs} />
                <Figure
                  icon={<Wallet size={14} />}
                  label="Ce mois"
                  value={club.revenue_month_cents}
                  format={c => `${(c / 100).toLocaleString('fr-MA')} DH`}
                />
              </dl>

              <footer className="admin-club-foot">
                <span className="admin-club-fresh">{freshness(club.refreshed_at, now)}</span>
                <button
                  className="btn-dark"
                  style={{ background: 'var(--gold)', borderColor: 'transparent', padding: '0.5rem 1.1rem' }}
                  disabled={entering !== null}
                  onClick={() => enter(club)}
                >
                  <LogIn size={15} strokeWidth={2.2} />
                  {entering === club.id ? 'Ouverture…' : 'Entrer'}
                  <span className="sr-only"> dans le club {club.name}</span>
                </button>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

function Figure({
  icon, label, value, format,
}: { icon: React.ReactNode; label: string; value: number | null; format?: (n: number) => string }) {
  // Un club jamais mesure affiche un tiret, pas un zero : « pas encore
  // mesure » et « aucun membre » ne veulent pas dire la meme chose.
  const shown = value === null || value === undefined
    ? '—'
    : (format ? format(value) : value.toLocaleString('fr-MA'))
  return (
    <div className="admin-figure">
      <dt className="admin-figure-label">{icon}{label}</dt>
      <dd className="admin-figure-value">{shown}</dd>
    </div>
  )
}

function Status({ club, now }: { club: ClubRow; now: number }) {
  const base = { fontSize: '0.62rem', letterSpacing: '0.1em' }
  if (club.status === 'suspended')
    return <span className="badge text-red-300 bg-red-500/10 ring-red-500/30" style={base}>Suspendu</span>
  if (club.status === 'cancelled')
    return <span className="badge" style={base}>Resilie</span>

  if (club.plan === 'trial' && club.trial_ends_at) {
    const days = Math.ceil((Date.parse(club.trial_ends_at) - now) / 86_400_000)
    if (days <= 0)
      return <span className="badge text-red-300 bg-red-500/10 ring-red-500/30" style={base}>Essai fini</span>
    return <span className="badge text-amber-300 bg-amber-500/10 ring-amber-500/30" style={base}>Essai {days}j</span>
  }
  return <span className="badge text-emerald-300 bg-emerald-500/10 ring-emerald-500/30" style={base}>{club.plan}</span>
}

/** Fraicheur du cache : dit quand les chiffres ont ete mesures, pas maintenant. */
function freshness(refreshedAt: string | null, now: number): string {
  if (!refreshedAt) return 'jamais mesure'
  const minutes = Math.floor((now - Date.parse(refreshedAt)) / 60_000)
  if (minutes < 1) return 'mesure a l’instant'
  if (minutes < 60) return `mesure il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `mesure il y a ${hours} h`
  return `mesure il y a ${Math.floor(hours / 24)} j`
}

function SkeletonList() {
  return (
    <div className="admin-club-grid" aria-hidden="true">
      {[0, 1, 2].map(i => (
        <div key={i} className="dz-card" style={{ height: 208 }}>
          <div className="members-skeleton-row" style={{ height: 48, border: 'none', borderRadius: 14 }} />
        </div>
      ))}
    </div>
  )
}
