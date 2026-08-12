'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, ApiError, type ClubRow } from '@/lib/client'
import styles from './admin.module.css'

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
    // indiscernable, et le cache d'agregats est rafraichi toutes les 5 min
    // de toute facon.
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

  return (
    <>
      <header className={styles.head}>
        <div>
          <h1>Clubs</h1>
          <p className={styles.sub}>
            {clubs
              ? `${clubs.length} club${clubs.length > 1 ? 's' : ''} sur la plateforme`
              : 'Chargement…'}
          </p>
        </div>
      </header>

      <div aria-live="polite">
        {error && <p className={styles.alert} role="alert">{error}</p>}
      </div>

      {!clubs && <ClubsSkeleton />}

      {clubs && clubs.length === 0 && (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>Aucun club pour l&apos;instant</h2>
          <p className={styles.emptyBody}>
            Un club cree ici demarre vide : c&apos;est ensuite lui, ou vous, qui
            declarez ses salles et ses sports. Rien n&apos;est presuppose.
          </p>
        </div>
      )}

      {clubs && clubs.length > 0 && (
        <ul className={styles.list}>
          {clubs.map(club => (
            <li key={club.id} className={styles.row}>
              <div className={styles.identity}>
                <span className={styles.avatar} style={{ background: club.theme.accent }} aria-hidden="true">
                  {club.name.slice(0, 2).toUpperCase()}
                </span>
                <div className={styles.names}>
                  <span className={styles.name}>{club.name}</span>
                  <span className={styles.slug}>{club.slug}</span>
                </div>
              </div>

              <dl className={styles.figures}>
                <Figure label="Membres" value={club.member_count} />
                <Figure label="Abonnes" value={club.active_subs} />
                <Figure
                  label="Recette du mois"
                  value={club.revenue_month_cents}
                  format={cents => `${(cents / 100).toLocaleString('fr-MA')} DH`}
                />
                <Figure label="Comptes" value={club.staff_count} />
              </dl>

              <div className={styles.state}>
                <Status club={club} now={now} />
                <span className={styles.freshness}>{freshness(club.refreshed_at, now)}</span>
              </div>

              <button
                className="btn btn-secondary btn-sm"
                data-busy={entering === club.id}
                disabled={entering !== null}
                onClick={() => enter(club)}
              >
                Entrer
                <span className="sr-only"> dans le club {club.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Figure({
  label, value, format,
}: { label: string; value: number | null; format?: (n: number) => string }) {
  // Un club jamais rafraichi affiche un tiret, pas un zero : « pas encore
  // mesure » et « aucun membre » ne veulent pas dire la meme chose.
  const shown = value === null || value === undefined
    ? '—'
    : (format ? format(value) : value.toLocaleString('fr-MA'))
  return (
    <div className={styles.figure}>
      <dt className={styles.figureLabel}>{label}</dt>
      <dd className={`${styles.figureValue} num`}>{shown}</dd>
    </div>
  )
}

function Status({ club, now }: { club: ClubRow; now: number }) {
  if (club.status === 'suspended') return <span className="pill pill-danger">Suspendu</span>
  if (club.status === 'cancelled') return <span className="pill pill-muted">Resilie</span>

  if (club.plan === 'trial' && club.trial_ends_at) {
    const days = Math.ceil((Date.parse(club.trial_ends_at) - now) / 86_400_000)
    if (days <= 0) return <span className="pill pill-danger">Essai termine</span>
    return <span className="pill pill-warn">Essai &middot; {days} j</span>
  }
  return <span className="pill pill-ok">{club.plan}</span>
}

/** Fraicheur du cache : dit quand les chiffres ont ete mesures, pas maintenant. */
function freshness(refreshedAt: string | null, now: number): string {
  if (!refreshedAt) return 'jamais mesure'
  const minutes = Math.floor((now - Date.parse(refreshedAt)) / 60_000)
  if (minutes < 1) return 'a l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  return `il y a ${Math.floor(hours / 24)} j`
}

function ClubsSkeleton() {
  return (
    <ul className={styles.list} aria-hidden="true">
      {[0, 1, 2].map(i => (
        <li key={i} className={styles.row}>
          <div className={styles.identity}>
            <span className="skeleton" style={{ width: 36, height: 36, borderRadius: 8 }} />
            <div className={styles.names}>
              <span className="skeleton" style={{ width: '8rem', height: '0.875rem' }} />
              <span className="skeleton" style={{ width: '5rem', height: '0.75rem', marginTop: 4 }} />
            </div>
          </div>
          <span className="skeleton" style={{ height: '1.5rem', flex: 1 }} />
        </li>
      ))}
    </ul>
  )
}
