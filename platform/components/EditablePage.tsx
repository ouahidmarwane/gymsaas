'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Pencil, Check, Undo2, Settings2, RotateCcw } from 'lucide-react'
import { api, ApiError, type CardPlacement, type CardSpec, type Me } from '@/lib/client'
import DashboardGrid from '@/components/DashboardGrid'
import BrandingPanel from '@/components/BrandingPanel'
import { renderCard, type Stats } from '@/components/DashboardCards'

/**
 * Bandeau de cartes modifiable, commun a tous les ecrans.
 *
 * Le mode modification n'appartient pas au tableau de bord : c'est une
 * capacite de l'application. Chaque page passe sa cle, recupere sa propre
 * disposition et son propre catalogue, et le reste — glisser, redimensionner,
 * palette, enregistrement — est identique partout.
 */
export default function EditablePage({
  page, me, eyebrow, title, subtitle, actions, hero, children,
}: {
  page: string
  me: Me | null
  eyebrow?: ReactNode
  /** Ignore quand `hero` est fourni : la banniere porte alors le titre. */
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  /** En-tete pleine largeur, a la place du titre ordinaire. */
  hero?: ReactNode
  children?: ReactNode
}) {
  const [layout, setLayout] = useState<CardPlacement[] | null>(null)
  const [specs, setSpecs] = useState<Record<string, CardSpec>>({})
  const [stats, setStats] = useState<Stats | null>(null)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<CardPlacement[] | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([
        api.get<{ layout: CardPlacement[]; cards: Record<string, CardSpec> }>(`/api/layout/${page}`),
        api.get<{ stats: Stats }>('/api/dashboard/stats'),
      ])
      setLayout(l.layout); setSpecs(l.cards); setStats(s.stats)
    } catch (e) {
      // Un bandeau qui ne charge pas ne doit pas emporter la page : le
      // contenu principal reste utilisable.
      setError(e instanceof ApiError ? e.message : null)
      setLayout([])
    }
  }, [page])

  useEffect(() => { load() }, [load])

  // La disposition des ecrans appartient a la plateforme, pas aux clubs.
  // Un proprietaire qui deplace ses cartes cree une variante que le support
  // devra comprendre a chaque intervention ; et l'apparence du produit se
  // pilote depuis un seul endroit. Le serveur applique la meme regle : cacher
  // le bouton sans fermer la route ne serait qu'un decor.
  const canEdit = me?.isPlatformAdmin === true
    && (me.scope.mode !== 'support' || me.scope.canWrite)

  async function save() {
    if (!draft) return
    setSaving(true); setError(null)
    try {
      await api.put(`/api/layout/${page}`, { layout: draft })
      setLayout(draft); setDraft(null); setEditing(false)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Enregistrement impossible')
    } finally { setSaving(false) }
  }

  async function reset() {
    setSaving(true)
    try {
      const d = await api.del<{ layout: CardPlacement[] }>(`/api/layout/${page}`)
      setLayout(d.layout); setDraft(d.layout)
    } finally { setSaving(false) }
  }

  const active = draft ?? layout
  const labelFor = (id: string) => specs[id]?.label ?? id

  return (
    <div className="dashboard-shell">
      {hero}

      {(!hero || actions || (canEdit && !editing)) && (
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
                      gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            {!hero && eyebrow && <p className="section-heading" style={{ marginBottom: 6 }}>{eyebrow}</p>}
            {!hero && <h1 className="dz-hello">{title}</h1>}
            {!hero && subtitle && <p className="dz-sub">{subtitle}</p>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {actions}
            {canEdit && !editing && (
              <button className="btn-ghost" onClick={() => { setDraft(layout); setEditing(true) }}>
                <Pencil size={15} strokeWidth={2.2} /> Modifier
              </button>
            )}
          </div>
        </div>
      )}

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
              <button className="btn-ghost" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                      disabled={saving} onClick={reset} title="Revenir a la disposition d origine">
                <RotateCcw size={14} strokeWidth={2.2} /> Reinitialiser
              </button>
              <button className="btn-ghost" style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                      disabled={saving}
                      onClick={() => { setDraft(null); setEditing(false); setError(null) }}>
                <Undo2 size={14} strokeWidth={2.2} /> Annuler
              </button>
              <button className="btn-dark"
                      style={{ background: 'var(--gold)', borderColor: 'transparent',
                               padding: '0.45rem 0.9rem', fontSize: '0.8rem' }}
                      onClick={save} disabled={saving}>
                <Check size={14} strokeWidth={2.4} /> {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </span>
          </div>

          {/* L'apparence se regle depuis n'importe quel ecran en modification :
              c'est la marque du club, pas une propriete du tableau de bord. */}
          <BrandingPanel initial={me?.branding ?? null} onSaved={() => { /* la coquille se rafraichit seule */ }} />
        </>
      )}

      {active && active.some(c => c.visible) || editing ? (
        <DashboardGrid
          layout={active ?? []}
          specs={specs}
          editing={editing}
          labelFor={labelFor}
          onChange={setDraft}
          renderCard={id => (stats
            ? renderCard(id, stats, labelFor(id))
            : <span className="members-skeleton-row"
                    style={{ display: 'block', height: '100%', border: 'none' }} />)}
        />
      ) : null}

      {children}
    </div>
  )
}
