'use client'
// components/BranchTabs.tsx — sélecteur de succursale (pilule glissante).
// Placé localement dans les pages qui dépendent de la succursale
// (Membres, Grades) — plus dans la barre du haut.
import { useBranch } from '@/lib/branch-context'
import { useT } from '@/lib/i18n'
import SlidingTabs from '@/components/SlidingTabs'

export default function BranchTabs() {
  const { activeBranch, setActiveBranch, canSwitchBranch } = useBranch()
  const { t } = useT()

  return (
    <SlidingTabs
      items={[
        { key: 'sbata', label: t('branch_sbata') },
        { key: 'rachad', label: t('branch_rachad') },
      ]}
      value={activeBranch}
      onChange={key => setActiveBranch(key as 'sbata' | 'rachad')}
      disabled={!canSwitchBranch}
    />
  )
}
