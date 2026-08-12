'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Award } from 'lucide-react'
import { api, type Me } from '@/lib/client'

/**
 * Passage de grade.
 *
 * L'ecran n'existe que pour un club dont au moins une discipline est gradee.
 * Masquer le lien ne suffisait pas : l'URL reste tapable, et depuis le mode
 * support on peut arriver ici en changeant de club. On verifie donc a
 * l'affichage, pas seulement dans le rail.
 */
export default function GradesPage() {
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    api.get<Me>('/api/me')
      .then(data => {
        setMe(data)
        if (data.capabilities && !data.capabilities.hasGrading) {
          // Club sans grade : rien a faire ici.
          router.replace('/dashboard')
        }
      })
      .catch(() => router.replace('/dashboard'))
  }, [router])

  if (!me) {
    return (
      <div className="dashboard-shell">
        <span className="members-skeleton-row" style={{ height: 120, borderRadius: 28, border: 'none' }} />
      </div>
    )
  }

  if (me.capabilities && !me.capabilities.hasGrading) {
    return (
      <div className="dashboard-shell">
        <section className="dz-card">
          <div className="gf-placeholder">
            <Award size={38} strokeWidth={1.6} className="gf-placeholder-icon" />
            <h2 className="gf-placeholder-title">Aucune discipline gradee</h2>
            <p className="gf-placeholder-body">
              Ce club n&apos;enseigne aucun sport a ceintures ou a grades. Ajoutez une
              echelle a une discipline pour activer cet ecran.
            </p>
            <Link className="btn-ghost" href="/setup" style={{ marginTop: 8 }}>
              Ouvrir la configuration
            </Link>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="dashboard-shell">
      <div>
        <h1 className="dz-hello">Passage de grade</h1>
        <p className="dz-sub">Sessions de passage, eligibilite et historique.</p>
      </div>
      <section className="dz-card">
        <div className="gf-placeholder">
          <Award size={38} strokeWidth={1.6} className="gf-placeholder-icon" />
          <h2 className="gf-placeholder-title">En cours de portage</h2>
          <p className="gf-placeholder-body">
            Le moteur de passage de grade arrive : dates de saison, eligibilite,
            confirmation. Les echelles de votre club sont deja en place.
          </p>
          <Link className="btn-ghost" href="/setup" style={{ marginTop: 8 }}>
            Voir les echelles du club
          </Link>
        </div>
      </section>
    </div>
  )
}
