'use client'

import Link from 'next/link'
import { Search, Plus } from 'lucide-react'
import type { Branding } from '@/lib/client'

/**
 * En-tete du tableau de bord : banniere pleine largeur, salutation, recherche.
 *
 * Reprise telle quelle de l'application d'origine, classes comprises. La
 * banniere n'est plus un fichier fige dans le dossier public : elle vient du
 * club, posee par la plateforme.
 *
 * Sans banniere, on ne montre pas un cadre vide : le degrade de l'accent du
 * club tient lieu de fond, et l'en-tete garde exactement la meme forme.
 */
export default function ClubHero({
  branding, greeting, subtitle, canEdit,
}: {
  branding: Branding | null
  greeting: React.ReactNode
  subtitle: string
  canEdit: boolean
}) {
  const banner = branding?.bannerUrl ?? null
  const accent = branding?.theme.accent ?? '#f05a28'

  return (
    <div className="dz-hero-banner" style={{ animation: 'fadeUp 0.5s var(--ease-out) forwards' }}>
      {banner ? (
        <img src={banner} alt="" className="dz-hero-img" />
      ) : (
        <div
          className="dz-hero-img"
          aria-hidden="true"
          style={{
            background:
              `radial-gradient(ellipse at 20% 20%, ${accent}55, transparent 60%),`
              + `radial-gradient(ellipse at 85% 30%, ${accent}33, transparent 55%),`
              + 'var(--panel-bg)',
          }}
        />
      )}
      <div className="dz-hero-shade" aria-hidden="true" />

      <div className="dz-hero-content">
        <div>
          <h1 className="dz-hello">{greeting}</h1>
          <p className="dz-sub" style={{ textTransform: 'capitalize' }}>{subtitle}</p>
        </div>
        <div className="dz-header-actions">
          <Link href="/members" className="dz-search">
            <Search size={15} strokeWidth={2.2} />
            <span>Nom, téléphone, e-mail…</span>
          </Link>
          {canEdit && (
            <Link href="/members" className="btn-dark" style={{ background: 'var(--gold)' }}>
              <Plus size={16} strokeWidth={2.4} /> Ajouter un membre
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}
