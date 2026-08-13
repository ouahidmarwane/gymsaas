'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Clock } from 'lucide-react'
import { api } from '@/lib/client'

/**
 * Encart d'abonnement sur le tableau de bord du club.
 *
 * Ne s'affiche que s'il y a quelque chose a faire : echeance ouverte ou fin
 * de couverture proche. Un bandeau permanent qui dit « tout va bien » cesse
 * d'etre lu, et le jour ou il dit autre chose personne ne le remarque.
 *
 * Il ne bloque rien et n'emporte jamais la page : si l'appel echoue, le
 * tableau de bord s'affiche comme si de rien n'etait. La facturation ne doit
 * pas pouvoir casser l'outil de travail du club.
 */
export default function SubscriptionNotice() {
  const [state, setState] = useState<{
    expired: boolean; daysLeft: number | null; dueCents: number; configured: boolean
  } | null>(null)

  useEffect(() => {
    let alive = true
    api.get<{ expired: boolean; daysLeft: number | null; dueCents: number; configured: boolean }>(
      '/api/subscription',
    ).then(s => { if (alive) setState(s) }).catch(() => {})
    return () => { alive = false }
  }, [])

  if (!state?.configured) return null
  const soon = state.daysLeft !== null && state.daysLeft >= 0 && state.daysLeft <= 14
  if (!state.expired && !soon && state.dueCents === 0) return null

  const urgent = state.expired
  const tone = urgent ? '#ef4444' : '#f59e0b'

  return (
    <section className="dz-card" style={{ borderColor: `${tone}59` }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {urgent
          ? <AlertTriangle size={19} strokeWidth={2.2} style={{ color: tone, flex: 'none', marginTop: 2 }} />
          : <Clock size={19} strokeWidth={2.2} style={{ color: tone, flex: 'none', marginTop: 2 }} />}

        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <h2 className="dz-card-title">
            {urgent ? 'Votre abonnement a expiré' : 'Votre abonnement arrive à échéance'}
          </h2>
          <p dir="rtl" lang="ar" className="dz-card-note" style={{ marginTop: 3 }}>
            {urgent ? 'انتهت صلاحية اشتراككم' : 'اشتراككم على وشك الانتهاء'}
          </p>
          <p className="dz-card-note" style={{ marginTop: 8 }}>
            {state.dueCents > 0
              ? `${Math.round(state.dueCents / 100).toLocaleString('fr-FR')} DH à régler.`
              : 'Aucune échéance ouverte pour l’instant.'}
            {!urgent && state.daysLeft !== null && ` Il reste ${state.daysLeft} jour(s).`}
          </p>
        </div>

        <Link className="btn-dark" href="/abonnement"
              style={{ background: tone, borderColor: 'transparent', flex: 'none' }}>
          Voir mon abonnement
        </Link>
      </div>
    </section>
  )
}
