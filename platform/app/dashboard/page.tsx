'use client'

import { useEffect, useState } from 'react'
import { api, ApiError, type CardPlacement, type CardSpec, type Me } from '@/lib/client'
import DashboardGrid from '@/components/DashboardGrid'
import BrandingPanel from '@/components/BrandingPanel'
import styles from './dashboard.module.css'

interface Stats {
  memberCount: number
  activeSubs: number
  revenueMonthCents: number
  lastActivityAt: string | null
}

const LABELS: Record<string, string> = {
  members_total: 'Membres', members_active: 'Membres actifs',
  subs_expiring: 'Abonnements a renouveler', insurance_missing: 'Assurances manquantes',
  revenue_month: 'Recette du mois', alerts_unread: 'Alertes',
  growth_chart: 'Croissance', revenue_chart: 'Recettes',
  grade_progress: 'Progression des grades', recent_members: 'Derniers inscrits',
  upcoming_grades: 'Passages a venir', branch_split: 'Repartition par salle',
}

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [layout, setLayout] = useState<CardPlacement[] | null>(null)
  const [specs, setSpecs] = useState<Record<string, CardSpec>>({})
  const [stats, setStats] = useState<Stats | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CardPlacement[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([
      api.get<Me>('/api/me'),
      api.get<{ layout: CardPlacement[]; cards: Record<string, CardSpec> }>('/api/dashboard/layout'),
      api.get<{ stats: Stats }>('/api/dashboard/stats'),
      api.get<{ configured: boolean }>('/api/setup/status'),
    ])
      .then(([meData, layoutData, statsData, setup]) => {
        if (!alive) return
        setMe(meData)
        setLayout(layoutData.layout)
        setSpecs(layoutData.cards)
        setStats(statsData.stats)
        setConfigured(setup.configured)
      })
      .catch(e => { if (alive) setError(e instanceof ApiError ? e.message : 'Chargement impossible') })
    return () => { alive = false }
  }, [])

  const canEdit = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin'].includes(me.org?.role ?? ''))
    : false

  async function save() {
    if (!draft) return
    setSaving(true)
    setError(null)
    try {
      await api.put('/api/dashboard/layout', { layout: draft })
      setLayout(draft)
      setDraft(null)
      setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally {
      setSaving(false)
    }
  }

  if (error && !layout) {
    return <p className={styles.alert} role="alert">{error}</p>
  }

  const active = draft ?? layout

  return (
    <>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1>{me?.branding?.name ?? 'Tableau de bord'}</h1>
          <p className={styles.sub}>
            {editing
              ? 'Deplacez les cartes, redimensionnez-les par le coin, masquez celles qui ne servent pas.'
              : today()}
          </p>
        </div>

        {canEdit && (
          <div className={styles.headActions}>
            {editing ? (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={() => { setDraft(null); setEditing(false); setError(null) }}
                  disabled={saving}
                >
                  Annuler
                </button>
                <button className="btn btn-primary" onClick={save} data-busy={saving}>
                  Enregistrer
                </button>
              </>
            ) : (
              <button className="btn btn-secondary" onClick={() => { setDraft(layout); setEditing(true) }}>
                Modifier
              </button>
            )}
          </div>
        )}
      </header>

      <div aria-live="polite">
        {error && layout && <p className={styles.alert} role="alert">{error}</p>}
      </div>

      {/* Un club qui n'a declare ni salle ni sport ne peut rien faire d'utile :
          on le dit avant d'afficher une grille de zeros. */}
      {configured === false && !editing && (
        <div className={styles.setup}>
          <h2 className={styles.setupTitle}>Configurons votre club</h2>
          <p className={styles.setupBody}>
            Indiquez vos salles et les sports que vous enseignez. Rien n&apos;est
            presuppose : vos grades, vos categories, vos noms.
          </p>
          <a className="btn btn-primary" href="/setup">Commencer</a>
        </div>
      )}

      {editing && <BrandingPanel initial={me?.branding ?? null} onSaved={b => setMe(m => m && { ...m, branding: b })} />}

      {!active && <GridSkeleton />}

      {active && (
        <DashboardGrid
          layout={active}
          specs={specs}
          editing={editing}
          labelFor={id => LABELS[id] ?? id}
          onChange={setDraft}
          renderCard={id => <Card id={id} stats={stats} label={LABELS[id] ?? id} />}
        />
      )}
    </>
  )
}

function Card({ id, stats, label }: { id: string; stats: Stats | null; label: string }) {
  if (!stats) return <span className="skeleton" style={{ display: 'block', height: '100%' }} />

  const figures: Record<string, { value: string; note?: string }> = {
    members_total:  { value: stats.memberCount.toLocaleString('fr-MA') },
    members_active: { value: stats.activeSubs.toLocaleString('fr-MA'), note: 'abonnement en cours' },
    revenue_month:  { value: `${(stats.revenueMonthCents / 100).toLocaleString('fr-MA')} DH`, note: 'ce mois-ci' },
  }

  const figure = figures[id]
  if (figure) {
    return (
      <div className={styles.metric}>
        <span className={styles.metricLabel}>{label}</span>
        <span className={`${styles.metricValue} num`}>{figure.value}</span>
        {figure.note && <span className={styles.metricNote}>{figure.note}</span>}
      </div>
    )
  }

  // Les cartes non encore branchees le disent, plutot que d'afficher un zero
  // qui passerait pour une mesure.
  return (
    <div className={styles.pending}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.pendingNote}>Bientot disponible</span>
    </div>
  )
}

function today(): string {
  return new Date().toLocaleDateString('fr-MA', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

function GridSkeleton() {
  return (
    <div className={styles.skeletonGrid} aria-hidden="true">
      {[3, 3, 3, 3, 8, 4].map((span, i) => (
        <span key={i} className="skeleton" style={{ gridColumn: `span ${span}`, height: 88 }} />
      ))}
    </div>
  )
}
