'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil, Check, Undo2, Settings2 } from 'lucide-react'
import { api, ApiError, type CardPlacement, type CardSpec, type Me } from '@/lib/client'
import DashboardGrid from '@/components/DashboardGrid'
import BrandingPanel from '@/components/BrandingPanel'

interface Stats {
  memberCount: number
  activeSubs: number
  revenueMonthCents: number
  lastActivityAt: string | null
}

const LABELS: Record<string, string> = {
  members_total: 'Membres', members_active: 'Membres actifs',
  subs_expiring: 'A renouveler', insurance_missing: 'Assurances manquantes',
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
        setMe(meData); setLayout(layoutData.layout); setSpecs(layoutData.cards)
        setStats(statsData.stats); setConfigured(setup.configured)
      })
      .catch(e => { if (alive) setError(e instanceof ApiError ? e.message : 'Chargement impossible') })
    return () => { alive = false }
  }, [])

  const canEdit = me
    ? (me.scope.mode === 'support' ? me.scope.canWrite : ['owner', 'admin'].includes(me.org?.role ?? ''))
    : false

  async function save() {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await api.put('/api/dashboard/layout', { layout: draft })
      setLayout(draft); setDraft(null); setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setSaving(false) }
  }

  const active = draft ?? layout
  const firstName = me?.user.name.split(' ')[0] ?? ''
  // En support, on regarde le club de quelqu'un d'autre : le saluer par son
  // propre prenom laisse croire qu'on est chez soi. On nomme le club.
  const inSupport = me?.scope.mode === 'support'

  return (
    <div className="dashboard-shell">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div>
          {inSupport ? (
            <>
              <h1 className="dz-hello">{me?.branding?.name ?? 'Club'}</h1>
              <p className="dz-sub">Tableau de bord du club, vu depuis la plateforme</p>
            </>
          ) : (
            <>
              <h1 className="dz-hello">
                Bonjour, <span>{firstName}</span> !
              </h1>
              <p className="dz-sub">
                {new Date().toLocaleDateString('fr-MA', {
                  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
                })}
              </p>
            </>
          )}
        </div>

        {canEdit && !editing && (
          <button
            className="btn-dark"
            style={{ background: 'var(--gold)', borderColor: 'transparent' }}
            onClick={() => { setDraft(layout); setEditing(true) }}
          >
            <Pencil size={15} strokeWidth={2.2} /> Modifier
          </button>
        )}
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

      {editing && (
        <>
          <div className="gf-editbar">
            <Settings2 size={16} strokeWidth={2.2} style={{ color: 'var(--gold)', flex: 'none' }} />
            <span className="gf-editbar-text">
              Glissez une carte par sa poignee, tirez le coin pour la redimensionner.
              Au clavier : fleches pour deplacer, Maj + fleches pour redimensionner.
            </span>
            <span className="gf-editbar-actions">
              <button className="btn-ghost" style={{ padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                      disabled={saving}
                      onClick={() => { setDraft(null); setEditing(false); setError(null) }}>
                <Undo2 size={14} strokeWidth={2.2} /> Annuler
              </button>
              <button className="btn-dark"
                      style={{ background: 'var(--gold)', borderColor: 'transparent', padding: '0.45rem 1rem', fontSize: '0.8rem' }}
                      onClick={save} disabled={saving}>
                <Check size={14} strokeWidth={2.4} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </span>
          </div>

          <BrandingPanel
            initial={me?.branding ?? null}
            onSaved={b => setMe(m => (m ? { ...m, branding: b } : m))}
          />
        </>
      )}

      {/* Un club sans salle ni sport ne peut rien faire d'utile : on le dit
          avant d'afficher une grille de zeros. */}
      {configured === false && !editing && (
        <section className="dz-card" style={{ borderColor: 'rgba(47,107,255,0.4)' }}>
          <h2 className="dz-card-title">Configurons votre club</h2>
          <p className="dz-card-note" style={{ margin: '8px 0 16px', maxWidth: '52ch' }}>
            Indiquez vos salles et les sports que vous enseignez. Rien n&apos;est presuppose :
            vos grades, vos categories, vos noms.
          </p>
          <Link className="btn-dark" href="/setup"
                style={{ background: 'var(--gold)', borderColor: 'transparent' }}>
            Commencer
          </Link>
        </section>
      )}

      {!active && <div className="members-skeleton-row" style={{ height: 200, borderRadius: 28, border: 'none' }} />}

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
    </div>
  )
}

function Card({ id, stats, label }: { id: string; stats: Stats | null; label: string }) {
  if (!stats) {
    return <span className="members-skeleton-row" style={{ display: 'block', height: '100%', border: 'none' }} />
  }

  const figures: Record<string, { value: string; note?: string }> = {
    members_total:  { value: stats.memberCount.toLocaleString('fr-MA'), note: 'inscrits' },
    members_active: { value: stats.activeSubs.toLocaleString('fr-MA'), note: 'abonnement en cours' },
    revenue_month:  { value: `${(stats.revenueMonthCents / 100).toLocaleString('fr-MA')} DH`, note: 'ce mois-ci' },
  }

  const figure = figures[id]
  if (figure) {
    return (
      <div className="dz-metric" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%' }}>
        <span className="dz-metric-name">{label}</span>
        <span className="dz-metric-value" style={{ margin: '4px 0 2px' }}>{figure.value}</span>
        {figure.note && <span className="dz-card-note">{figure.note}</span>}
      </div>
    )
  }

  // Les cartes non encore branchees le disent, plutot que d'afficher un zero
  // qui passerait pour une mesure.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', gap: 4 }}>
      <span className="dz-metric-name">{label}</span>
      <span className="dz-card-note">Bientot disponible</span>
    </div>
  )
}
