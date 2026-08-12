'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api, ApiError, type Me } from '@/lib/client'
import EditablePage from '@/components/EditablePage'
import PageState from '@/components/PageState'

export default function DashboardPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.get<Me>('/api/me')
      .then(data => {
        if (!alive) return
        setMe(data)
        setConfigured(data.capabilities?.configured ?? null)
      })
      .catch(e => { if (alive) setError(e instanceof ApiError ? e.message : 'Chargement impossible') })
    return () => { alive = false }
  }, [])

  const firstName = me?.user.name.split(' ')[0] ?? ''
  // En support, on regarde le club de quelqu'un d'autre : le saluer par son
  // propre prenom laisse croire qu'on est chez soi. On nomme le club.
  const inSupport = me?.scope.mode === 'support'

  return (
    <EditablePage
      page="dashboard"
      me={me}
      title={inSupport
        ? (me?.branding?.name ?? 'Club')
        : <>Bonjour, <span>{firstName}</span> !</>}
      subtitle={inSupport
        ? 'Tableau de bord du club, vu depuis la plateforme'
        : new Date().toLocaleDateString('fr-MA', {
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
          })}
    >
      <PageState error={error} />

      {/* Un club sans salle ni sport ne peut rien faire d'utile : on le dit
          avant d'afficher une grille de zeros. */}
      {configured === false && (
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
    </EditablePage>
  )
}
