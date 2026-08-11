'use client'
// components/GlobalDisciplineFilter.tsx
// Filtre discipline GLOBAL, affiché en haut et centré sur toutes les pages.
// Pilote l'ensemble de l'application : changer la discipline ici met à jour
// le dashboard, les membres, la comptabilité, etc. (cookie partagé +
// router.refresh() pour refetcher les server components).
// Visible seulement pour l'admin / un poste transversal ; un membre du
// personnel rattaché à une discipline y est verrouillé → rien à afficher.
import { useDiscipline } from '@/lib/discipline-context'
import { useRouter } from 'next/navigation'
import SlidingTabs from '@/components/SlidingTabs'
import { DISCIPLINE_LABELS, DISCIPLINES } from '@/types'

export default function GlobalDisciplineFilter() {
  const { activeDiscipline, setActiveDiscipline, canSwitchDiscipline } = useDiscipline()
  const router = useRouter()
  if (!canSwitchDiscipline) return null

  const switchDiscipline = (d: typeof activeDiscipline) => {
    if (d === activeDiscipline) return
    setActiveDiscipline(d)
    router.refresh()
  }

  return (
    <div className="global-disc-filter">
      <SlidingTabs
        items={[
          { key: 'all', label: 'Toutes disciplines' },
          ...DISCIPLINES.map(d => ({ key: d, label: DISCIPLINE_LABELS[d] })),
        ]}
        value={activeDiscipline}
        onChange={key => switchDiscipline(key as typeof activeDiscipline)}
      />
    </div>
  )
}
